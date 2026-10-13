package com.trippilot.assistant.application

import com.trippilot.assistant.domain.AssistantSurface
import com.trippilot.assistant.domain.MessageKind
import com.trippilot.assistant.domain.NextAction
import com.trippilot.core.error.ConflictDetected
import com.trippilot.core.error.FieldError
import com.trippilot.core.error.ResourceNotFound
import com.trippilot.core.error.UpstreamUnavailable
import com.trippilot.core.error.ValidationFailed
import com.trippilot.itinerarygeneration.api.EditProposal
import com.trippilot.itinerarygeneration.api.EditProposalRequest
import com.trippilot.itinerarygeneration.api.ProposalViolation
import com.trippilot.itinerarygeneration.api.ProposedDay
import com.trippilot.itinerarygeneration.api.SlotCandidateView
import com.trippilot.itinerarygeneration.api.SlotCandidatesView
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldContainExactly
import io.kotest.matchers.shouldBe
import io.kotest.matchers.shouldNotBe
import io.kotest.property.Arb
import io.kotest.property.arbitrary.element
import io.kotest.property.arbitrary.int
import io.kotest.property.arbitrary.list
import io.kotest.property.checkAll
import java.time.Instant
import java.time.LocalDate
import java.util.UUID

/**
 * 변경형 카드(FD §4 · BR-U8-12·30·31·35). 지키려는 것은 둘이다 — **여기서는 아무것도 저장되지 않고**(제안일 뿐),
 * 카드에 나오는 장소·시각은 **상대가 돌려준 것 그대로**다. 못 만들면 지어내지 않고 편집 화면으로 보낸다.
 */
class ProposalCardsTest : StringSpec({

    val acc = UUID.randomUUID()
    val tripId = UUID.randomUUID()
    val d1 = LocalDate.parse("2026-11-01")
    val d2 = d1.plusDays(1)
    val noonDay2 = Instant.parse("2026-11-02T03:00:00Z")
    val moca = UUID.randomUUID()
    val beach = UUID.randomUUID()
    val book = UUID.randomUUID()

    /** 둘째 날에 카페 모카(14:00)와 해변(16:00). */
    fun data() = FakeTripData(
        acc,
        slots = listOf(
            plannedSlot(d2, 0, "14:00", "카페 모카", distance = "840m", poiId = moca),
            plannedSlot(d2, 1, "16:00", "해변", poiId = beach),
        ),
        surfaces = mapOf(book to surface(book, "책방카페")),
    )

    fun base() = listOf(ProposedDay(d1, emptyList()), ProposedDay(d2, listOf(proposedSlot(moca, "14:00", "840m"), proposedSlot(beach, "16:00"))))
    fun replaced() = listOf(ProposedDay(d1, emptyList()), ProposedDay(d2, listOf(proposedSlot(book, "14:00"), proposedSlot(beach, "16:00"))))

    fun ctx(
        arguments: Map<String, String> = emptyMap(),
        utterance: String? = null,
        inTrip: Boolean = true,
        now: Instant = noonDay2,
        deadlineMs: Long = 7_000,
    ) = DispatchContext(
        acc, tripId, TripContext(listOf("부산"), 2, "서면 호텔", d1, d1.plusDays(2)), inTrip, AssistantSurface.ITINERARY, arguments, now, utterance, deadlineMs,
    )

    fun cards(data: FakeTripData, editing: FakeEditing) = ProposalCards(editing, editing, data, data, AssistantProperties())
    val pick = mapOf("slotKey" to "$d2#$moca", "poiId" to book.toString())

    "후보를 고르면 그 슬롯을 그 장소로 바꾼 제안이 나온다 — 전후가 상대가 돌려준 값 그대로다" {
        val editing = FakeEditing().apply { proposal = { EditProposal.Proposed(base(), replaced(), "AUTO_APPLY") } }

        val card = cards(data(), editing).edit(ctx(pick))

        card.kind shouldBe MessageKind.PROPOSAL
        editing.proposed.single() shouldBe FakeEditing.Proposal(d2, EditProposalRequest.ReplaceSlot("$d2#$moca", book), 7_000)
        val proposal = card.proposal!!
        proposal.diff.map { listOf(it.change, it.slotKey, it.before?.name, it.before?.startAt, it.before?.distanceRange, it.after?.name, it.after?.startAt, it.after?.distanceRange) } shouldContainExactly
            listOf(listOf("REPLACED", "$d2#$moca", "카페 모카", "14:00", "840m", "책방카페", "14:00", null)) // 모르는 거리는 비운다
        proposal.violations shouldBe emptyList()
        // 적용하면 저장할 것은 **일정 전체**다 — 안 바뀐 날·슬롯까지
        proposal.after.map { day -> day.date to day.slots.map { it.poiId } } shouldContainExactly listOf(d1 to emptyList(), d2 to listOf(book, beach))
        // 지문은 상대가 계산한 기준으로 — 그 기준은 지금 저장된 일정과 같다
        proposal.baseFingerprint shouldBe ItineraryFingerprint.ofPlan(data().slots)
        proposal.expiresAt shouldBe noonDay2.plusSeconds(30 * 60)
        proposal.applyHint shouldBe "AUTO_APPLY" // 힌트는 싣되, 저장은 하지 않았다
        editing.edits shouldBe emptyList()
        card.llmCalls shouldBe null // 구조화 교체는 LLM 0회
    }

    "말로 바꾸라고 하면 그 말을 상대에 넘기고 LLM 한 번으로 센다 — 날은 여행 중이면 오늘이다" {
        val editing = FakeEditing().apply { proposal = { EditProposal.Proposed(base(), replaced(), "CONFIRM_REQUIRED") } }

        val card = cards(data(), editing).edit(ctx(utterance = "카페를 조용한 데로 바꿔줘"))

        editing.proposed.single().let { it.date to it.request } shouldBe (d2 to EditProposalRequest.Utterance("카페를 조용한 데로 바꿔줘"))
        card.kind shouldBe MessageKind.PROPOSAL
        card.llmCalls shouldBe 1
    }

    "고칠 날 — 상대가 뽑은 날짜·N일차·가리킨 장소 순이고, 받은 날을 못 읽으면 넘겨짚지 않는다" {
        fun dateFor(arguments: Map<String, String>, inTrip: Boolean = false): LocalDate? {
            val editing = FakeEditing()
            cards(data(), editing).edit(ctx(arguments, utterance = "바꿔줘", inTrip = inTrip))
            return editing.proposed.singleOrNull()?.date
        }

        dateFor(mapOf("day" to "2026-11-03")) shouldBe d1.plusDays(2)
        dateFor(mapOf("day" to "1")) shouldBe d1
        dateFor(mapOf("target" to "해변")) shouldBe d2
        dateFor(emptyMap(), inTrip = true) shouldBe d2
        // 여행 전인데 어느 날인지 모른다 · 여행 밖의 날 · 못 읽는 값 — 부르지 않는다(오늘로 넘겨짚으면 엉뚱한 날을 고친다)
        dateFor(emptyMap()) shouldBe null
        dateFor(mapOf("day" to "2026-12-25"), inTrip = true) shouldBe null
        dateFor(mapOf("day" to "9"), inTrip = true) shouldBe null
        dateFor(mapOf("day" to "모레쯤"), inTrip = true) shouldBe null
    }

    "고칠 날을 모르면 편집 화면으로 보낸다 — 말도 버튼 인자도 없으면 마찬가지다" {
        val editing = FakeEditing()

        cards(data(), editing).edit(ctx(utterance = "바꿔줘", inTrip = false)).nextActions.single().type shouldBe "OPEN_ITINERARY_EDIT"
        cards(data(), editing).edit(ctx()).nextActions.single().type shouldBe "OPEN_ITINERARY_EDIT"
        editing.proposed shouldBe emptyList()
    }

    /** BR-U8-31 — 위반이 있는 안에는 [적용]이 없다. 앱은 `violations` 가 비었을 때만 버튼을 그린다. */
    "위반이 있으면 사유를 실은 카드를 내고 적용할 내용은 싣지 않는다" {
        val editing = FakeEditing().apply {
            proposal = { EditProposal.Rejected(listOf(ProposalViolation(beach, d2, "영업시간과 맞지 않아요"), ProposalViolation(null, null, "꼭 갈 곳을 넣지 못했어요"))) }
        }

        val card = cards(data(), editing).edit(ctx(pick))

        card.kind shouldBe MessageKind.PROPOSAL
        card.proposal!!.violations shouldContainExactly listOf("11월 2일 — 영업시간과 맞지 않아요", "꼭 갈 곳을 넣지 못했어요")
        card.proposal!!.after shouldBe emptyList()
        card.proposal!!.diff shouldBe emptyList()
        card.nextActions.single().type shouldBe "OPEN_ITINERARY_EDIT"
    }

    "제안을 못 만든 까닭마다 지어내지 않고 갈 곳을 준다" {
        fun after(result: () -> EditProposal, utterance: String? = null) =
            cards(data(), FakeEditing().apply { proposal = result }).edit(ctx(pick.takeIf { utterance == null } ?: mapOf("day" to "2"), utterance))

        after({ EditProposal.Rejected(emptyList()) }).let { it.kind to it.nextActions.single().type } shouldBe (MessageKind.TEXT to "OPEN_ITINERARY_EDIT")
        after({ EditProposal.NotUnderstood }, "어떻게 좀 해줘").let { it.kind to it.nextActions.single().type } shouldBe (MessageKind.TEXT to "OPEN_ITINERARY_EDIT")
        // 상대가 안 닿았다 — 말로 온 턴에만 [다시 시도]를 준다(버튼에는 다시 태울 말이 없다)
        after({ EditProposal.Unavailable }, "바꿔줘").nextActions.map { it.type } shouldContainExactly listOf("RETRY_TURN", "CONTINUE_WITHOUT_ASSISTANT")
        after({ EditProposal.Unavailable }).nextActions.map { it.type } shouldContainExactly listOf("CONTINUE_WITHOUT_ASSISTANT")
        after({ throw ResourceNotFound() }).nextActions.single().type shouldBe "OPEN_ITINERARY_METHOD"
        after({ throw ConflictDetected() }).nextActions.single().type shouldBe "OPEN_ITINERARY" // 확정된 일정
        after({ throw ValidationFailed(listOf(FieldError("newPoiId", "없는 장소"))) }).nextActions.single().type shouldBe "OPEN_ITINERARY_EDIT"
        // 바뀐 것이 없으면 제안이 아니다 — 빈 비교 카드에 [적용]을 달지 않는다
        after({ EditProposal.Proposed(base(), base(), null) }).let { it.kind to it.proposal } shouldBe (MessageKind.TEXT to null)
    }

    "전후 비교 — 삭제·추가·이동·시각 변경을 가르고, 안 바뀐 것은 싣지 않는다" {
        val name = mapOf(moca to "카페 모카", beach to "해변", book to "책방카페")
        fun changes(after: List<ProposedDay>) = ProposalCards.diff(base(), after) { name.getValue(it) }.map { it.change to it.slotKey }

        changes(base()) shouldBe emptyList()
        changes(listOf(ProposedDay(d2, listOf(proposedSlot(beach, "16:00"))))) shouldContainExactly listOf("REMOVED" to "$d2#$moca")
        changes(listOf(ProposedDay(d2, listOf(proposedSlot(moca, "14:00", "840m"), proposedSlot(beach, "16:00"), proposedSlot(book, "18:00"))))) shouldContainExactly
            listOf("ADDED" to "$d2#$book")
        changes(listOf(ProposedDay(d2, listOf(proposedSlot(moca, "15:00"), proposedSlot(beach, "17:00"))))) shouldContainExactly
            listOf("RETIMED" to "$d2#$moca", "RETIMED" to "$d2#$beach")
        changes(listOf(ProposedDay(d2, listOf(proposedSlot(beach, "14:00"), proposedSlot(moca, "16:00"))))) shouldContainExactly
            listOf("MOVED" to "$d2#$moca", "MOVED" to "$d2#$beach")
        // 다른 날로 옮기면 한 날에서 빠지고 다른 날에 들어온다
        changes(listOf(ProposedDay(d1, listOf(proposedSlot(moca, "10:00"))), ProposedDay(d2, listOf(proposedSlot(beach, "16:00"))))) shouldContainExactly
            listOf("ADDED" to "$d1#$moca", "REMOVED" to "$d2#$moca")
    }

    "지문 — 저장되는 것이 바뀌면 달라지고, 보이기만 하는 값(이름·거리·위반)에는 그대로다" {
        val plan = data().slots
        val same = ItineraryFingerprint.ofPlan(plan)

        ItineraryFingerprint.of(base()) shouldBe same
        ItineraryFingerprint.ofPlan(plan.map { it.copy(nameKo = "개명", distanceRange = "9km", hasViolation = true) }) shouldBe same
        ItineraryFingerprint.ofPlan(plan.reversed()) shouldBe same // 읽은 순서가 아니라 일정의 순서로
        listOf(
            plan.dropLast(1),
            plan.map { if (it.poiId == moca) it.copy(startAt = it.startAt.plusMinutes(30)) else it },
            plan.map { if (it.poiId == moca) it.copy(isFixed = true) else it },
            plan.map { if (it.poiId == moca) it.copy(orderIndex = 2) else it }, // 순서가 바뀌었다
            plan.map { if (it.poiId == moca) it.copy(date = d1, slotKey = "$d1#$moca") else it },
        ).forEach { ItineraryFingerprint.ofPlan(it) shouldNotBe same }
    }

    /** BR-U8-12 · INV-1 — 후보는 후보 경로가 준 실재 장소뿐이다. 이름을 모르는 곳은 권하지 않는다. */
    "대체 후보 — 버튼이 실어 온 슬롯의 후보를 이름·거리·이유와 고르는 버튼으로 낸다" {
        val unnamed = UUID.randomUUID()
        val editing = FakeEditing().apply {
            candidates = {
                SlotCandidatesView(listOf(SlotCandidateView(book, "630m", "조용한 좌석"), SlotCandidateView(unnamed, "1km", "가까워요")), degraded = false, emptyReason = null)
            }
        }

        val card = cards(data(), editing).alternatives(ctx(mapOf("slotKey" to "$d2#$moca")))

        editing.asked shouldContainExactly listOf("$d2#$moca")
        card.kind shouldBe MessageKind.CANDIDATES
        card.text shouldBe "카페 모카 대신 갈 만한 곳이에요. 고르면 바꾼 일정을 보여 드릴게요."
        card.payload!!["candidates"] shouldBe listOf(mapOf("poiId" to book.toString(), "name" to "책방카페", "distanceRange" to "630m", "reason" to "조용한 좌석"))
        card.quickReplies!!.map { listOf(it.label, it.action, it.params) } shouldContainExactly
            listOf(listOf("책방카페", "PICK_CANDIDATE", mapOf("poiId" to book.toString(), "slotKey" to "$d2#$moca")))
        editing.proposed shouldBe emptyList() // 후보를 보였을 뿐 — 제안도 저장도 아직 없다
        editing.edits shouldBe emptyList()
    }

    "대체 후보 — 어느 장소인지 모르면 넘겨짚지 않고, 후보가 없으면 까닭을 말한다" {
        val editing = FakeEditing()
        fun alternatives(arguments: Map<String, String>) = cards(data(), editing).alternatives(ctx(arguments))

        alternatives(emptyMap()).nextActions.single().type shouldBe "OPEN_ITINERARY_EDIT"
        alternatives(mapOf("slotKey" to "$d2#${UUID.randomUUID()}")).nextActions.single().type shouldBe "OPEN_ITINERARY_EDIT" // 그 사이 사라진 슬롯
        editing.asked shouldBe emptyList()

        alternatives(mapOf("target" to "카페")).text shouldBe "근처에서 대신할 곳을 찾지 못했어요." // 말로 가리킨 곳이 하나뿐이면 찾는다
        editing.asked shouldContainExactly listOf("$d2#$moca")
        editing.candidates = { SlotCandidatesView(emptyList(), degraded = false, emptyReason = "ALL_IN_ITINERARY") }
        alternatives(mapOf("target" to "카페")).text shouldBe "근처 후보가 이미 일정에 있어요."
        editing.candidates = { throw UpstreamUnavailable("candidates", fallbackApplied = false) }
        alternatives(mapOf("target" to "카페")).kind shouldBe MessageKind.FALLBACK // 후보는 지어내지 않는다
        editing.candidates = { throw ConflictDetected() }
        alternatives(mapOf("target" to "카페")).nextActions.single().type shouldBe "OPEN_ITINERARY"
    }

    /** PBT-U8-8 · BR-U8-06 — 어떤 결과가 와도 카드는 막다르지 않고, 다음 행동은 앱이 아는 값이며, 소요시간이 없다. */
    "임의의 제안 결과에서 카드는 막다르지 않고 소요시간을 말하지 않는다" {
        val pois = listOf(moca, beach, book)
        checkAll(
            Arb.list(Arb.int(0..2), 0..3), Arb.element("PROPOSED", "REJECTED", "REJECTED_EMPTY", "NOT_UNDERSTOOD", "UNAVAILABLE"), Arb.element("AUTO_APPLY", "CONFIRM_REQUIRED", "엉뚱한 값", null),
            Arb.element(true, false),
        ) { order, kind, hint, byButton ->
            val after = listOf(ProposedDay(d2, order.distinct().mapIndexed { i, p -> proposedSlot(pois[p], "1$i:00", "1.2km".takeIf { i % 2 == 0 }) }))
            val editing = FakeEditing().apply {
                proposal = {
                    when (kind) {
                        "PROPOSED" -> EditProposal.Proposed(base(), after, hint)
                        "REJECTED" -> EditProposal.Rejected(listOf(ProposalViolation(moca, d2, "영업시간과 맞지 않아요")))
                        "REJECTED_EMPTY" -> EditProposal.Rejected(emptyList())
                        "NOT_UNDERSTOOD" -> EditProposal.NotUnderstood
                        else -> EditProposal.Unavailable
                    }
                }
            }

            val card = cards(data(), editing).edit(if (byButton) ctx(pick) else ctx(utterance = "바꿔줘"))

            (card.nextActions.isNotEmpty()) shouldBe true
            card.nextActions.forEach { (it.type in NextAction.TYPES) shouldBe true }
            (card.text.orEmpty() + card.proposal.toString()).let { said -> listOf("분 소요", "duration", "시간 걸").forEach { (it in said) shouldBe false } }
            card.proposal?.applyHint?.let { (it in setOf("AUTO_APPLY", "CONFIRM_REQUIRED")) shouldBe true } // 모르는 힌트는 싣지 않는다(DB CHECK)
            card.proposal?.let { (it.diff.isNotEmpty() || it.violations.isNotEmpty()) shouldBe true } // 빈 카드는 없다
            editing.edits shouldBe emptyList() // 무엇이 와도 저장하지 않는다(BR-U8-30)
        }
    }
})
