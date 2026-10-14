package com.trippilot.assistant.application

import com.trippilot.assistant.domain.AssistantMessage
import com.trippilot.assistant.domain.AssistantMessageRepository
import com.trippilot.assistant.domain.AssistantProposal
import com.trippilot.assistant.domain.AssistantProposalRepository
import com.trippilot.assistant.domain.ProposalStatus
import com.trippilot.core.error.ConflictDetected
import com.trippilot.core.error.ErrorCode
import com.trippilot.core.error.ResourceNotFound
import com.trippilot.itinerarygeneration.api.EditDayCommand
import com.trippilot.itinerarygeneration.api.EditSlotCommand
import com.trippilot.itinerarygeneration.api.ItineraryEditFacade
import com.trippilot.itinerarygeneration.api.ItineraryEditSource
import com.trippilot.itinerarygeneration.api.ItineraryPlanFacade
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Service
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.TransactionTemplate
import java.time.Clock
import java.time.Instant
import java.util.UUID

data class ProposalOutcome(val proposalId: UUID, val status: ProposalStatus, val messages: List<AssistantMessage> = emptyList())

/**
 * 제안의 [적용]·[취소](FD §2.1 · US-ASSIST-04). **도우미 경로에서 일정이 바뀌는 길은 [apply] 하나뿐이다**(BR-U8-30).
 *
 * ## 적용은 세 걸음이다
 *
 * 1. 확인하고 **집는다** — 상태·만료·위반·기준 지문을 보고, 통과하면 이 제안을 집었다고 적는다 → 커밋
 * 2. 저장 — 기존 편집 경로([ItineraryEditFacade], 재검증·리비전·변경 이력 포함) — **트랜잭션 밖**
 * 3. 끝을 적는다 — `APPLIED` 또는 `FAILED`, 그리고 무엇을 했는지의 기록(`ACTION_LOG`) → 커밋
 *
 * 2 는 상대를 부르는 재검증이라 몇 초가 갈 수 있다 — 하나로 묶으면 그동안 DB 연결을 쥔다(PERF-U8-06).
 * 1 에서 집어 두므로 같은 제안의 [적용]이 겹쳐도 저장은 한 번이다(INV-U8-08).
 *
 * 기준 지문은 **두 번** 본다(INV-U8-04). 1 에서 한 번 — 이미 낡은 제안이면 상대를 부르지도 않는다. 그리고 2 의 저장
 * 트랜잭션 안에서 한 번 더 — 재검증이 도는 몇 초 사이에 끼어든 편집을 덮어쓰지 않는다.
 *
 * ponytail: 저장 트랜잭션 안의 "다시 읽기"와 "쓰기" 사이(수 밀리초)는 잠겨 있지 않다 — 그 틈에 커밋된 편집은 덮어쓴다.
 * 직접 편집(REST)끼리도 같은 틈이 있다. 닫으려면 편집 경로가 일정 행을 잠그고 읽는다.
 *
 * ponytail: 2 도중에 파드가 죽으면 제안은 "집힌 채"로 남는다(저장됐는지는 일정이 말한다). 다시 적용되지 않고,
 * 만료 뒤에는 `EXPIRED` 로 보인다. 행을 치우는 것은 보존 청소다(TRIP-1380).
 */
@Service
class ProposalService(
    private val proposals: AssistantProposalRepository,
    private val messages: AssistantMessageRepository,
    private val plans: ItineraryPlanFacade,
    private val edits: ItineraryEditFacade,
    private val clock: Clock,
    transactionManager: PlatformTransactionManager,
) {
    private val tx = TransactionTemplate(transactionManager)

    fun apply(accountId: UUID, proposalId: UUID): ProposalOutcome {
        val proposal = when (val gate = tx.execute { claim(accountId, proposalId, clock.instant()) }!!) {
            // 거절은 커밋한 **뒤에** 던진다 — 안에서 던지면 방금 적은 STALE·EXPIRED 가 함께 되돌려진다.
            is Gate.Refused -> throw gate.toException()
            Gate.Done -> return ProposalOutcome(proposalId, ProposalStatus.APPLIED)
            is Gate.Claimed -> gate.proposal
        }
        val saved = runCatching {
            edits.edit(
                accountId, proposal.tripId,
                proposal.after.map { day -> EditDayCommand(day.date, day.slots.map { EditSlotCommand(it.poiId, it.startAt, it.endAt, it.isFixed, it.endsNextDay) }) },
                // 누가 바꿨는지는 출처가 말한다(편집 경로가 리비전 요약에 `[도우미]` 를 붙인다) — 사유에는 무엇을 바꿨는지를 적는다.
                AssistantTemplates.whatChanged(proposal.diff), ItineraryEditSource.ASSISTANT,
                onlyIf = { current -> ItineraryFingerprint.ofCurrent(current) == proposal.baseFingerprint },
            )
        }
        // 저장 직전에 일정이 바뀌어 있었다 — 저장되지 않았다. 처음부터 낡았던 제안과 같은 답이다.
        if ((saved.exceptionOrNull() as? ConflictDetected)?.errorCode == ErrorCode.STALE) {
            // 닫지 못해도 답은 같다 — 저장되지 않았다는 사실이 먼저다(못 닫은 제안은 집힌 채 남아 다시 적용되지 않는다).
            runCatching { tx.execute { proposals.close(proposalId, ProposalStatus.STALE, claimed = true) } }
                .onFailure { log.warn("도우미 제안 적용 — STALE 로 닫지 못했습니다. proposalId={} type={}", proposalId, it.javaClass.simpleName) }
            throw stale().toException()
        }
        saved.onFailure { log.warn("도우미 제안 적용 — 저장 실패. proposalId={} type={}", proposalId, it.javaClass.simpleName) }
        val (status, message) = saved.fold(
            { result -> ProposalStatus.APPLIED to AssistantTemplates.applied(proposal.diff, result.hasViolation, result.judged) },
            { ProposalStatus.FAILED to AssistantTemplates.applyFailed() },
        )
        val note = runCatching {
            tx.execute {
                proposals.close(proposalId, status, claimed = true)
                messages.appendNote(proposal.sessionId, accountId, proposalId, message, clock.instant())
            }
        }.getOrElse { e ->
            // 저장은 이미 끝났다(또는 실패로 끝났다) — 기록을 못 남겼다고 그 결과를 500 으로 뒤집지 않는다. 뒤집으면 일정은
            // 바뀌었는데 앱은 "적용하지 못했다"고 말한다. 흔한 까닭은 저장이 도는 사이 대화가 지워진 것이다(제안도 함께 사라졌다).
            log.warn("도우미 제안 적용 — 결과를 기록하지 못했습니다. proposalId={} status={} type={}", proposalId, status, e.javaClass.simpleName)
            // 기록 없이 상태만이라도 적는다 — 안 적으면 제안이 집힌 채 남아 카드가 만료까지 [적용]을 그린다.
            runCatching { tx.execute { proposals.close(proposalId, status, claimed = true) } }
            null
        }
        return ProposalOutcome(proposalId, status, listOfNotNull(note))
    }

    private sealed interface Gate {
        data class Claimed(val proposal: AssistantProposal) : Gate
        data class Refused(val code: ErrorCode, val message: String) : Gate {
            fun toException() = ConflictDetected(message = message, errorCode = code)
        }
        data object Done : Gate
    }

    private fun claim(accountId: UUID, proposalId: UUID, now: Instant): Gate {
        val proposal = proposals.findOwnedForUpdate(accountId, proposalId) ?: throw ResourceNotFound() // 남의 제안은 있는지도 모르게
        return when {
            // 이미 적용됐다 — 다시 저장하지 않고 그렇다고 답한다. 저장은 몇 초가 가서 응답을 못 받은 앱이 다시 누르기 쉽고,
            // 그때 "적용할 수 없다"고 하면 바뀐 일정을 두고 안 바뀐 것처럼 보인다.
            proposal.status == ProposalStatus.APPLIED -> Gate.Done
            proposal.status == ProposalStatus.STALE -> stale()
            proposal.status == ProposalStatus.EXPIRED -> expired()
            proposal.status != ProposalStatus.PROPOSED -> notApplicable() // 취소·실패로 끝났다
            proposal.claimed -> notApplicable() // 다른 [적용]이 저장 중이다(또는 끝을 못 적고 죽었다)
            proposal.expiresAt <= now -> expired().also { proposals.close(proposalId, ProposalStatus.EXPIRED, claimed = false) }
            // 위반이 있는 안에는 [적용]이 없다(BR-U8-31) — 여기 닿았다면 앱이 그리지 않은 버튼을 누른 것이다.
            proposal.violations.isNotEmpty() || proposal.after.isEmpty() -> notApplicable()
            // 제안을 만든 뒤 일정이 바뀌었다 — 옛 일정에 맞춘 전체 교체가 새 편집을 덮어쓰지 않는다(INV-U8-04).
            ItineraryFingerprint.ofPlan(plans.findPlanSlots(accountId, proposal.tripId)) != proposal.baseFingerprint ->
                stale().also { proposals.close(proposalId, ProposalStatus.STALE, claimed = false) }
            else -> Gate.Claimed(proposal).also { check(proposals.claim(proposalId, now)) { "잠근 제안을 집지 못했습니다." } }
        }
    }

    private fun stale() = Gate.Refused(ErrorCode.STALE, "일정이 바뀌어 이 제안은 적용할 수 없습니다.")
    private fun expired() = Gate.Refused(ErrorCode.EXPIRED, "제안이 만료됐습니다.")
    private fun notApplicable() = Gate.Refused(ErrorCode.NOT_APPLICABLE, "이 제안은 지금 적용할 수 없습니다.")

    /** 제안을 닫는다. 일정은 그대로다. 이미 끝난 제안이면 그 상태를 그대로 돌려준다 — 두 번 눌러도 오류가 아니다. */
    fun dismiss(accountId: UUID, proposalId: UUID): ProposalOutcome = tx.execute {
        val now = clock.instant()
        val proposal = proposals.findOwnedForUpdate(accountId, proposalId) ?: throw ResourceNotFound()
        val open = proposal.statusAt(now) == ProposalStatus.PROPOSED
        // 저장이 도는 중인 제안은 닫지 않는다 — 닫으면 일정은 바뀌었는데 제안은 "취소됨"으로 남는다.
        val closed = open && proposals.close(proposalId, ProposalStatus.DISMISSED, claimed = false)
        ProposalOutcome(proposalId, if (closed) ProposalStatus.DISMISSED else proposal.statusAt(now))
    }!!

    private companion object {
        private val log = LoggerFactory.getLogger(ProposalService::class.java)
    }
}
