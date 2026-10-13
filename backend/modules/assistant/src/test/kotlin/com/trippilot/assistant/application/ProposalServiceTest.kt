package com.trippilot.assistant.application

import com.trippilot.assistant.domain.AssistantMessage
import com.trippilot.assistant.domain.AssistantMessageRepository
import com.trippilot.assistant.domain.MessageKind
import com.trippilot.assistant.domain.NewMessage
import com.trippilot.assistant.domain.NewProposal
import com.trippilot.assistant.domain.ProposalDay
import com.trippilot.assistant.domain.ProposalDiffItem
import com.trippilot.assistant.domain.ProposalSlot
import com.trippilot.assistant.domain.ProposalSlotFace
import com.trippilot.assistant.domain.ProposalStatus
import com.trippilot.core.error.ConflictDetected
import com.trippilot.core.error.ErrorCode
import com.trippilot.core.error.ResourceNotFound
import com.trippilot.itinerarygeneration.api.EditDayCommand
import com.trippilot.itinerarygeneration.api.EditSlotCommand
import com.trippilot.itinerarygeneration.api.ItineraryEditResult
import com.trippilot.itinerarygeneration.api.ItineraryEditSource
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldContainExactly
import io.kotest.matchers.shouldBe
import io.kotest.property.Arb
import io.kotest.property.arbitrary.element
import io.kotest.property.arbitrary.list
import io.kotest.property.checkAll
import org.springframework.dao.DataIntegrityViolationException
import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.util.UUID

/**
 * 제안의 [적용]·[취소](FD §2.1 · BR-U8-30~34). 지키려는 것은 **일정이 바뀌는 조건**이다 — 사용자가 누른 그 제안이,
 * 그 제안을 만든 일정 그대로일 때, 한 번만. 행 잠금과 실 저장은 `AssistantProposalIT` 가 잰다.
 */
class ProposalServiceTest : StringSpec({

    val acc = UUID.randomUUID()
    val tripId = UUID.randomUUID()
    val sessionId = UUID.randomUUID()
    val day = LocalDate.parse("2026-11-02")
    val moca = UUID.randomUUID()
    val book = UUID.randomUUID()
    val start = Instant.parse("2026-11-02T03:00:00Z")

    class MovingClock(var now: Instant) : Clock() {
        override fun getZone(): ZoneId = ZoneId.of("UTC")
        override fun withZone(zone: ZoneId): Clock = this
        override fun instant(): Instant = now
    }

    class World(val clock: MovingClock, val data: FakeTripData) {
        val messages = FakeMessages()
        val proposals get() = messages.proposals
        val editing = FakeEditing()
        val service = ProposalService(proposals, messages, data, editing, clock, NOOP_TX)
    }

    fun world() = World(MovingClock(start), FakeTripData(acc, slots = listOf(plannedSlot(day, 0, "14:00", "카페 모카", poiId = moca))))

    /** 카페 모카를 책방카페로 바꾸는 제안 — 기준은 지금 저장된 일정이다. */
    fun World.propose(violations: List<String> = emptyList()): UUID = proposals.create(
        sessionId, acc,
        NewProposal(
            tripId, ItineraryFingerprint.ofPlan(data.slots),
            after = if (violations.isEmpty()) listOf(ProposalDay(day, listOf(ProposalSlot(book, LocalTime.parse("14:00"), LocalTime.parse("15:00"), true, false)))) else emptyList(),
            diff = if (violations.isEmpty()) {
                listOf(ProposalDiffItem("REPLACED", "$day#$moca", ProposalSlotFace("카페 모카", "14:00", "840m"), ProposalSlotFace("책방카페", "14:00", null)))
            } else {
                emptyList()
            },
            violations = violations, applyHint = "AUTO_APPLY", expiresAt = start.plusSeconds(1800),
        ),
        start,
    )

    fun World.refusal(id: UUID): ErrorCode = shouldThrow<ConflictDetected> { service.apply(acc, id) }.errorCode
    fun World.status(id: UUID) = proposals.rows.getValue(id).status

    "적용하면 제안의 일정 전체를 도우미 출처로 저장하고 무엇을 바꿨는지 기록한다" {
        val w = world()
        val id = w.propose()

        val outcome = w.service.apply(acc, id)

        outcome.status shouldBe ProposalStatus.APPLIED
        w.status(id) shouldBe ProposalStatus.APPLIED
        val edit = w.editing.edits.single()
        edit.source shouldBe ItineraryEditSource.ASSISTANT
        edit.reason shouldBe "카페 모카 → 책방카페" // 리비전·변경 이력에 남는 사유 — 무엇을 바꿨는지
        // 슬롯의 고정·자정 넘김까지 그대로 넘긴다 — 빠뜨리면 전체 교체가 그 값을 푼다
        edit.days.single().let { it.date to it.slots.map { s -> listOf(s.poiId, s.startAt.toString(), s.isFixed, s.endsNextDay) } } shouldBe
            (day to listOf(listOf(book, "14:00", true, false)))
        val log = outcome.messages.single()
        log.kind shouldBe MessageKind.ACTION_LOG
        log.text shouldBe "적용했어요."
        log.payload!!["what"] shouldBe "카페 모카 → 책방카페"
        log.nextActions.single().type shouldBe "OPEN_ITINERARY"
        log.proposal!!.let { it.id to it.status } shouldBe (id to "APPLIED") // 기록도 그 제안을 가리킨다
        w.messages.rows.single().sessionId shouldBe sessionId
    }

    /** INV-U8-04 — 옛 일정에 맞춘 전체 교체가 그 사이의 편집을 덮어쓰지 않는다. */
    "제안을 만든 뒤 일정이 바뀌었으면 저장하지 않고 STALE 로 닫는다" {
        val w = world()
        val id = w.propose()
        w.data.slots = w.data.slots + plannedSlot(day, 1, "16:00", "해변")

        w.refusal(id) shouldBe ErrorCode.STALE

        w.editing.edits shouldBe emptyList()
        w.status(id) shouldBe ProposalStatus.STALE
        w.refusal(id) shouldBe ErrorCode.STALE // 다시 눌러도 같은 답이다
        w.messages.rows shouldBe emptyList()
    }

    "만료된 제안은 저장하지 않고 EXPIRED 로 닫는다" {
        val w = world()
        val id = w.propose()
        w.clock.now = start.plusSeconds(1800)

        w.refusal(id) shouldBe ErrorCode.EXPIRED

        w.editing.edits shouldBe emptyList()
        w.status(id) shouldBe ProposalStatus.EXPIRED
    }

    /** BR-U8-31 — 카드에 [적용]이 없는 제안이다. 여기 닿았다면 앱이 그리지 않은 버튼을 누른 것이다. */
    "위반이 있는 제안은 적용되지 않는다" {
        val w = world()
        val id = w.propose(violations = listOf("영업시간과 맞지 않아요"))

        w.refusal(id) shouldBe ErrorCode.NOT_APPLICABLE

        w.editing.edits shouldBe emptyList()
        w.status(id) shouldBe ProposalStatus.PROPOSED
    }

    /**
     * 지문은 저장 트랜잭션 안에서 한 번 더 본다 — 재검증이 도는 몇 초 사이에 끼어든 편집을 덮어쓰지 않는다.
     * 미리 확인할 때는 같았으므로, 이 문이 없으면 그대로 저장된다.
     */
    "저장 직전에 일정이 바뀌어 있었으면 쓰지 않고 STALE 로 닫는다" {
        val w = world()
        val id = w.propose()
        w.editing.currentAtSave = listOf(EditDayCommand(day, listOf(EditSlotCommand(moca, LocalTime.parse("15:30"), LocalTime.parse("16:30"), false, false))))

        w.refusal(id) shouldBe ErrorCode.STALE

        w.editing.edits shouldBe emptyList()
        w.status(id) shouldBe ProposalStatus.STALE
        w.messages.rows shouldBe emptyList()
    }

    "저장 직전의 일정이 제안의 기준 그대로면 저장한다 — 같은 일정을 다르게 읽어 낡았다고 하지 않는다" {
        val w = world()
        val id = w.propose()
        w.editing.currentAtSave = listOf(EditDayCommand(day, listOf(EditSlotCommand(moca, LocalTime.parse("14:00"), LocalTime.parse("15:00"), false, false))))

        w.service.apply(acc, id).status shouldBe ProposalStatus.APPLIED
    }

    /**
     * 저장은 끝났는데 기록을 못 남겼다(저장이 도는 사이 대화가 지워졌다 등). 500 으로 뒤집으면 일정은 바뀌었는데 앱은
     * "적용하지 못했다"고 말한다 — 결과는 사실대로 돌려주고, 제안도 집힌 채 두지 않는다.
     */
    "적용 기록을 남기지 못해도 적용됐다는 사실은 그대로 돌려준다" {
        val w = world()
        val id = w.propose()
        val broken = object : AssistantMessageRepository by w.messages {
            override fun appendNote(sessionId: UUID, accountId: UUID, proposalId: UUID, message: NewMessage, at: Instant): AssistantMessage =
                throw DataIntegrityViolationException("fk_assistant_message_session")
        }
        val service = ProposalService(w.proposals, broken, w.data, w.editing, w.clock, NOOP_TX)

        val outcome = service.apply(acc, id)

        outcome.status shouldBe ProposalStatus.APPLIED
        outcome.messages shouldBe emptyList()
        w.editing.edits.size shouldBe 1
        w.status(id) shouldBe ProposalStatus.APPLIED
    }

    /** INV-U8-08 — 한 번만. 저장이 도는 중에 다시 눌러도, 끝난 뒤에 다시 눌러도. */
    "같은 제안은 두 번 적용되지 않는다 — 저장 중에 겹쳐 와도" {
        val w = world()
        val id = w.propose()
        var during: ErrorCode? = null
        w.editing.save = {
            during = w.refusal(id) // 저장이 도는 사이의 두 번째 [적용]
            ItineraryEditResult(UUID.randomUUID(), hasViolation = false, judged = true)
        }

        w.service.apply(acc, id).status shouldBe ProposalStatus.APPLIED

        during shouldBe ErrorCode.NOT_APPLICABLE
        // 끝난 뒤에 다시 누르면(응답을 못 받고 다시 누른 앱) 다시 저장하지 않고 "적용됐다"고 답한다 — 일정은 이미 바뀌어 있다
        w.service.apply(acc, id).let { it.status to it.messages } shouldBe (ProposalStatus.APPLIED to emptyList())
        w.editing.edits.size shouldBe 1
        w.messages.rows.size shouldBe 1 // 기록도 한 번뿐이다
    }

    /** BR-U8-34 — 저장할 때의 재검증이 제안 때와 다르게 판정하면 저장된 값이 이긴다. 숨기지 않는다. */
    "저장 뒤 위반이 생겼으면 그렇다고 말하고 고칠 곳으로 보낸다 — 검증을 못 했으면 문제없다고 하지 않는다" {
        fun applied(hasViolation: Boolean, judged: Boolean) = world().let { w ->
            w.editing.save = { ItineraryEditResult(UUID.randomUUID(), hasViolation, judged) }
            w.service.apply(acc, w.propose()).also { it.status shouldBe ProposalStatus.APPLIED }.messages.single()
        }

        applied(hasViolation = true, judged = true).let { it.text to it.nextActions.single().type } shouldBe
            ("적용했지만, 다시 검증하니 맞지 않는 곳이 있어요. 일정에서 확인해 주세요." to "OPEN_ITINERARY_EDIT")
        applied(hasViolation = false, judged = false).text shouldBe "적용했어요. 지금은 검증을 하지 못했어요 — 일정에서 확인해 주세요."
        applied(hasViolation = true, judged = false).text shouldBe "적용했어요. 지금은 검증을 하지 못했어요 — 일정에서 확인해 주세요."
    }

    "저장에 실패하면 FAILED 로 닫고 알린다 — 그 제안은 다시 적용되지 않는다" {
        val w = world()
        val id = w.propose()
        w.editing.save = { throw ConflictDetected(message = "확정된 일정은 수정할 수 없습니다.") }

        val outcome = w.service.apply(acc, id)

        outcome.status shouldBe ProposalStatus.FAILED
        outcome.messages.single().let { it.text to it.nextActions.map { a -> a.type } } shouldBe
            ("적용하지 못했어요. 일정은 그대로예요." to listOf("OPEN_ITINERARY_EDIT", "CONTINUE_WITHOUT_ASSISTANT"))
        w.refusal(id) shouldBe ErrorCode.NOT_APPLICABLE
        w.editing.edits.size shouldBe 1
    }

    "취소하면 닫히고 일정은 그대로다 — 두 번 눌러도, 이미 적용된 뒤에 눌러도 오류가 아니다" {
        val w = world()
        val id = w.propose()

        w.service.dismiss(acc, id).status shouldBe ProposalStatus.DISMISSED
        w.service.dismiss(acc, id).status shouldBe ProposalStatus.DISMISSED
        w.refusal(id) shouldBe ErrorCode.NOT_APPLICABLE // 취소한 것은 적용되지 않는다
        w.editing.edits shouldBe emptyList()

        val applied = w.propose()
        w.service.apply(acc, applied)
        w.service.dismiss(acc, applied).status shouldBe ProposalStatus.APPLIED // 적용된 것을 취소로 덮지 않는다
        w.status(applied) shouldBe ProposalStatus.APPLIED
    }

    /** 저장이 도는 중에 취소하면 일정은 바뀌는데 제안은 "취소됨"으로 남는다 — 닫지 않는다. */
    "저장 중인 제안은 취소로 닫히지 않는다" {
        val w = world()
        val id = w.propose()
        w.editing.save = {
            w.service.dismiss(acc, id).status shouldBe ProposalStatus.PROPOSED
            ItineraryEditResult(UUID.randomUUID(), hasViolation = false, judged = true)
        }

        w.service.apply(acc, id).status shouldBe ProposalStatus.APPLIED
    }

    "남의 제안은 있는지도 모르게 404 다" {
        val w = world()
        val id = w.propose()
        val other = UUID.randomUUID()

        shouldThrow<ResourceNotFound> { w.service.apply(other, id) }
        shouldThrow<ResourceNotFound> { w.service.dismiss(other, id) }
        shouldThrow<ResourceNotFound> { w.service.apply(acc, UUID.randomUUID()) }
        w.editing.edits shouldBe emptyList()
        w.status(id) shouldBe ProposalStatus.PROPOSED
    }

    /**
     * PBT-U8-6 — 임의의 사건 열(적용·취소·만료·일정 변경·저장 실패)에서: 저장은 많아야 한 번이고, 한 번 끝난 상태는
     * 다시 바뀌지 않으며, 일정이 바뀐 뒤에는 저장이 없다.
     */
    "임의의 사건 열에서 제안은 많아야 한 번 적용되고 끝난 상태에서 나가지 않는다" {
        checkAll(Arb.list(Arb.element("APPLY", "APPLY_FAILING", "DISMISS", "EXPIRE", "EDIT_ELSEWHERE"), 1..8)) { events ->
            val w = world()
            val id = w.propose()
            val seen = mutableListOf(w.status(id))
            var changed = false
            events.forEach { event ->
                val editsBefore = w.editing.edits.size
                when (event) {
                    "APPLY", "APPLY_FAILING" -> {
                        w.editing.save = { if (event == "APPLY_FAILING") error("save down") else ItineraryEditResult(UUID.randomUUID(), false, true) }
                        runCatching { w.service.apply(acc, id) }
                    }
                    "DISMISS" -> w.service.dismiss(acc, id)
                    "EXPIRE" -> w.clock.now = w.clock.now.plusSeconds(3600)
                    else -> { w.data.slots = w.data.slots + plannedSlot(day, w.data.slots.size, "1${w.data.slots.size}:00", "새 장소"); changed = true }
                }
                if (changed) w.editing.edits.size shouldBe editsBefore // 일정이 바뀐 뒤에는 저장이 없다
                seen += w.status(id)
            }
            (w.editing.edits.size <= 1) shouldBe true
            // 종결 상태에 들어선 뒤로는 그 상태 그대로다
            val closedAt = seen.indexOfFirst { it != ProposalStatus.PROPOSED }
            if (closedAt >= 0) seen.drop(closedAt).distinct().size shouldBe 1
            (seen.count { it == ProposalStatus.APPLIED } > 0) shouldBe (w.editing.edits.size == 1 && seen.last() == ProposalStatus.APPLIED)
        }
    }
})
