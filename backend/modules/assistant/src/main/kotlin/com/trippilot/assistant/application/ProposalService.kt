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
 * ponytail: 1 의 지문 대조와 2 의 저장 사이에 다른 편집이 끼면 그 편집을 덮어쓴다 — 편집 퍼사드가 "이 일정일 때만"
 * 조건을 받지 않는다. 틈은 편집 경로가 일정을 다시 읽기까지의 수 밀리초다. 닫으려면 퍼사드에 기대 지문을 넘긴다.
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
            is Gate.Refused -> throw ConflictDetected(message = gate.message, errorCode = gate.code)
            is Gate.Claimed -> gate.proposal
        }
        val saved = runCatching {
            edits.edit(
                accountId, proposal.tripId,
                proposal.after.map { day -> EditDayCommand(day.date, day.slots.map { EditSlotCommand(it.poiId, it.startAt, it.endAt, it.isFixed, it.endsNextDay) }) },
                // 누가 바꿨는지는 출처가 말한다(편집 경로가 리비전 요약에 `[도우미]` 를 붙인다) — 사유에는 무엇을 바꿨는지를 적는다.
                AssistantTemplates.whatChanged(proposal.diff), ItineraryEditSource.ASSISTANT,
            )
        }.onFailure { log.warn("도우미 제안 적용 — 저장 실패. proposalId={} type={}", proposalId, it.javaClass.simpleName) }
        return tx.execute {
            val now = clock.instant()
            val (status, message) = saved.fold(
                { result -> ProposalStatus.APPLIED to AssistantTemplates.applied(proposal.diff, result.hasViolation, result.judged) },
                { ProposalStatus.FAILED to AssistantTemplates.applyFailed() },
            )
            proposals.close(proposalId, status, claimed = true)
            ProposalOutcome(proposalId, status, listOf(messages.appendNote(proposal.sessionId, accountId, proposalId, message, now)))
        }!!
    }

    private sealed interface Gate {
        data class Claimed(val proposal: AssistantProposal) : Gate
        data class Refused(val code: ErrorCode, val message: String) : Gate
    }

    private fun claim(accountId: UUID, proposalId: UUID, now: Instant): Gate {
        val proposal = proposals.findOwnedForUpdate(accountId, proposalId) ?: throw ResourceNotFound() // 남의 제안은 있는지도 모르게
        return when {
            proposal.status == ProposalStatus.STALE -> stale()
            proposal.status == ProposalStatus.EXPIRED -> expired()
            proposal.status != ProposalStatus.PROPOSED -> notApplicable() // 이미 적용·취소·실패로 끝났다
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
