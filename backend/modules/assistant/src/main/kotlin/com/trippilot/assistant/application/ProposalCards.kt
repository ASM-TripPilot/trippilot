package com.trippilot.assistant.application

import com.trippilot.assistant.domain.Intent
import com.trippilot.assistant.domain.MessageKind
import com.trippilot.assistant.domain.MessageRole
import com.trippilot.assistant.domain.NewMessage
import com.trippilot.assistant.domain.NewProposal
import com.trippilot.assistant.domain.NextAction
import com.trippilot.assistant.domain.ProposalDay
import com.trippilot.assistant.domain.ProposalDiffItem
import com.trippilot.assistant.domain.ProposalSlot
import com.trippilot.assistant.domain.ProposalSlotFace
import com.trippilot.assistant.domain.QuickReply
import com.trippilot.assistant.domain.QuickReplyAction
import com.trippilot.core.error.ConflictDetected
import com.trippilot.core.error.ResourceNotFound
import com.trippilot.core.error.UpstreamUnavailable
import com.trippilot.core.error.ValidationFailed
import com.trippilot.itinerarygeneration.api.EditDayCommand
import com.trippilot.itinerarygeneration.api.EditProposal
import com.trippilot.itinerarygeneration.api.EditProposalRequest
import com.trippilot.itinerarygeneration.api.ItineraryEditProposalFacade
import com.trippilot.itinerarygeneration.api.ItineraryPlanFacade
import com.trippilot.itinerarygeneration.api.PlannedSlotView
import com.trippilot.itinerarygeneration.api.ProposedDay
import com.trippilot.itinerarygeneration.api.ProposedSlot
import com.trippilot.itinerarygeneration.api.SlotCandidateFacade
import com.trippilot.placedata.api.PoiSurfaceFacade
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Component
import java.security.MessageDigest
import java.time.Duration
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit
import java.util.HexFormat
import java.util.UUID

/**
 * 변경형 응답(FD §4) — 대체 후보와 일정 변경 **제안**. 여기서는 **아무것도 저장하지 않는다**(BR-U8-30):
 * 상대가 `AUTO_APPLY` 라고 해도 카드를 낼 뿐이고, 일정이 바뀌는 길은 사용자가 [적용]을 누르는 [ProposalService] 하나다.
 *
 * 후보의 장소는 후보 경로가 준 실재 장소뿐이고(BR-U8-12 · INV-1), 카드의 시각·순서는 상대 조립이 검증해 돌려준 값이다
 * (BR-U8-35 · INV-2). 소요시간은 어디에도 없다(INV-3).
 */
@Component
class ProposalCards(
    private val editProposals: ItineraryEditProposalFacade,
    private val candidates: SlotCandidateFacade,
    private val plans: ItineraryPlanFacade,
    private val poiSurfaces: PoiSurfaceFacade,
    private val properties: AssistantProperties,
) {
    private val editItinerary = NextAction("OPEN_ITINERARY_EDIT", "직접 편집")
    private val viewItinerary = NextAction("OPEN_ITINERARY", "일정 보기")

    /**
     * 일정 변경 제안. 길은 둘이다 — 후보를 골라 온 **구조화 교체**(LLM 0회), 또는 말을 그대로 상대에 넘기는 **발화 편집**.
     * 어느 쪽도 못 되면 지어내지 않고 편집 화면으로 보낸다.
     */
    fun edit(ctx: DispatchContext): NewMessage {
        val tripId = requireNotNull(ctx.tripId)
        val slotKey = ctx.arguments[ARG_SLOT_KEY]
        val newPoiId = ctx.arguments[ARG_POI_ID]?.let { runCatching { UUID.fromString(it) }.getOrNull() }
        val (date, request) = when {
            slotKey != null && newPoiId != null ->
                (dateOf(slotKey) ?: return byHand(CANNOT)) to EditProposalRequest.ReplaceSlot(slotKey, newPoiId)
            ctx.utterance != null ->
                (targetDate(ctx) ?: return byHand("어느 날 일정을 바꿀지 알 수 없었어요. 편집 화면에서 직접 바꿀 수 있어요.")) to
                    EditProposalRequest.Utterance(ctx.utterance)
            else -> return byHand("일정은 편집 화면에서 바꿀 수 있어요.")
        }
        val result = try {
            editProposals.propose(ctx.accountId, tripId, date, request, ctx.deadlineMs)
        } catch (e: ResourceNotFound) {
            return AssistantTemplates.handoff("아직 일정이 없어요.", NextAction("OPEN_ITINERARY_METHOD", "일정 만들기"))
        } catch (e: ConflictDetected) {
            return AssistantTemplates.handoff(LOCKED, viewItinerary)
        } catch (e: ValidationFailed) {
            return byHand(CANNOT)
        }
        val message = when (result) {
            is EditProposal.Proposed -> proposed(ctx, tripId, result)
            is EditProposal.Rejected -> rejected(ctx, tripId, result)
            EditProposal.NotUnderstood -> byHand("어떻게 바꿀지 알아듣지 못했어요. 편집 화면에서 직접 바꿀 수 있어요.")
            // 버튼을 눌러 온 턴에는 [다시 시도]를 주지 않는다 — 다시 태울 "말"이 없다.
            EditProposal.Unavailable -> AssistantTemplates.fallback(FallbackCause.AI_UNAVAILABLE, retryable = ctx.utterance != null)
        }
        // 발화 편집은 상대가 LLM 으로 옮긴다 — 한 번으로 센다(COST-U8-02). 구조화 교체는 0회다.
        return if (request is EditProposalRequest.Utterance) message.copy(llmCalls = 1) else message
    }

    private fun proposed(ctx: DispatchContext, tripId: UUID, result: EditProposal.Proposed): NewMessage {
        val names = names(ctx, tripId, (result.baseDays + result.days).flatMap { it.slots }.map { it.poiId }.toSet())
        val start = ctx.trip?.startDate
        val diff = diff(result.baseDays, result.days, start) { names[it] ?: UNNAMED }
        if (diff.isEmpty()) return AssistantTemplates.handoff("바꿀 것이 없어요. 일정이 이미 그렇게 되어 있어요.", viewItinerary)
        return NewMessage(
            role = MessageRole.ASSISTANT, kind = MessageKind.PROPOSAL,
            text = "${start?.let { areas(result.dayAreas, it) } ?: "이렇게 바꾸면 돼요."} 적용하면 다시 검증한 뒤 반영해요.",
            nextActions = listOf(viewItinerary), outcome = "FRAME",
            footnote = "* 적용 전까지 일정은 그대로 · 최종 시각·이동은 검증값",
            proposal = NewProposal(
                tripId = tripId,
                // 전후 비교의 '전'과 지문은 **상대가 계산한 기준**으로 만든다 — 일정을 따로 다시 읽으면 그 사이의 편집이 섞인다.
                baseFingerprint = ItineraryFingerprint.of(result.baseDays),
                after = result.days.map { day ->
                    ProposalDay(day.date, day.slots.map { ProposalSlot(it.poiId, it.startAt, it.endAt, it.isFixed, it.endsNextDay) })
                },
                diff = diff, violations = emptyList(),
                applyHint = result.applyHint?.takeIf { it in APPLY_HINTS }, // 표시 힌트일 뿐이다(DEC-U8-2)
                expiresAt = ctx.now + Duration.ofMinutes(properties.proposalTtlMinutes),
            ),
        )
    }

    /**
     * 위반이 있는 안 — 카드는 내되 **[적용]은 없다**(BR-U8-31: 앱은 `violations` 가 비었을 때만 버튼을 그린다).
     * 상대는 위반인 안의 일정을 주지 않으므로 전후 비교는 비고, 적용할 내용도 없다.
     */
    private fun rejected(ctx: DispatchContext, tripId: UUID, result: EditProposal.Rejected): NewMessage {
        if (result.violations.isEmpty()) return byHand(CANNOT)
        return NewMessage(
            role = MessageRole.ASSISTANT, kind = MessageKind.PROPOSAL,
            text = "그렇게 바꾸면 일정이 맞지 않아요.",
            nextActions = listOf(editItinerary), outcome = "REJECTED",
            proposal = NewProposal(
                tripId = tripId, baseFingerprint = NO_BASE, after = emptyList(), diff = emptyList(),
                // 위반은 고치려던 날의 것이 아닐 수 있다 — 어느 날인지 알면 함께 말한다.
                violations = result.violations.take(MAX_VIOLATIONS).map { v -> listOfNotNull(v.date?.format(DATE), v.message).joinToString(" — ") },
                applyHint = null,
                expiresAt = ctx.now + Duration.ofMinutes(properties.proposalTtlMinutes),
            ),
        )
    }

    /** 대체 후보(US-ASSIST-02). 고르면 [edit] 의 구조화 교체로 이어진다. */
    fun alternatives(ctx: DispatchContext): NewMessage {
        val tripId = requireNotNull(ctx.tripId)
        val slots = runCatching { plans.findPlanSlots(ctx.accountId, tripId) }
            .onFailure { log.warn("도우미 대체 후보 — 일정 조회 실패. type={}", it.javaClass.simpleName) }
            .getOrElse { return AssistantTemplates.handoff("지금 일정을 확인할 수 없어요.", viewItinerary) }
        // 버튼이 실어 온 슬롯이 먼저다. 말로 가리켰으면 그 이름과 겹치는 슬롯이 하나뿐일 때만 — 넘겨짚지 않는다.
        val slot = ctx.arguments[ARG_SLOT_KEY]?.let { key -> slots.firstOrNull { it.slotKey == key } }
            ?: mentioned(slots, ctx.arguments[ARG_TARGET])
            ?: return byHand("어느 장소를 바꿀지 알 수 없었어요. 편집 화면에서 장소를 골라 바꿀 수 있어요.")
        val found = try {
            candidates.propose(ctx.accountId, tripId, slot.slotKey)
        } catch (e: ResourceNotFound) {
            return byHand(CANNOT)
        } catch (e: ConflictDetected) {
            return AssistantTemplates.handoff(LOCKED, viewItinerary)
        } catch (e: ValidationFailed) {
            return byHand(CANNOT)
        } catch (e: UpstreamUnavailable) {
            // 후보는 지어내지 않는다(INV-1).
            return AssistantTemplates.fallback(FallbackCause.SOURCE_UNAVAILABLE, retryable = ctx.utterance != null)
        }
        val names = surfaceNames(found.candidates.map { it.poiId }.toSet())
        // 이름을 모르는 후보는 보이지 않는다 — "이름 미확인 장소"로 바꾸자고 권할 수는 없다.
        val shown = found.candidates.filter { it.poiId in names }.take(MAX_CANDIDATES)
        if (shown.isEmpty()) {
            return byHand(if (found.emptyReason == "ALL_IN_ITINERARY") "근처 후보가 이미 일정에 있어요." else "근처에서 대신할 곳을 찾지 못했어요.")
        }
        return NewMessage(
            role = MessageRole.ASSISTANT, kind = MessageKind.CANDIDATES,
            text = "${slot.nameKo ?: "그 장소"} 대신 갈 만한 곳이에요. 고르면 바꾼 일정을 보여 드릴게요.",
            payload = mapOf(
                "candidates" to shown.map {
                    mapOf("poiId" to it.poiId.toString(), "name" to names[it.poiId], "distanceRange" to it.distanceRange, "reason" to it.rationale)
                },
            ),
            nextActions = listOf(viewItinerary), outcome = "FRAME",
            // id 에 슬롯까지 넣는다 — 같은 장소가 다른 슬롯의 후보로 또 나와도 옛 카드의 버튼이 새 카드의 슬롯을 바꾸지 않게.
            quickReplies = shown.map {
                QuickReply(
                    "qr-pick-${slot.slotKey}-${it.poiId}", names.getValue(it.poiId), QuickReplyAction.PICK_CANDIDATE,
                    mapOf(ARG_POI_ID to it.poiId.toString(), ARG_SLOT_KEY to slot.slotKey),
                )
            },
        )
    }

    /**
     * 고칠 하루. 상대가 뽑은 `day`(날짜 또는 "N일차"의 N) → 가리킨 장소가 놓인 날 → 여행 중이면 오늘.
     * **`day` 를 받았는데 못 읽었으면 다른 날로 넘겨짚지 않는다** — 엉뚱한 날을 고친 안을 내게 된다.
     */
    private fun targetDate(ctx: DispatchContext): LocalDate? {
        val trip = requireNotNull(ctx.trip)
        val days = trip.startDate..trip.endDate
        ctx.arguments[ARG_DAY]?.trim()?.let { day ->
            val date = runCatching { LocalDate.parse(day) }.getOrNull() ?: day.toLongOrNull()?.takeIf { it in 1..MAX_TRIP_DAYS }?.let { trip.startDate.plusDays(it - 1) }
            return date?.takeIf { it in days }
        }
        ctx.arguments[ARG_TARGET]?.let { target ->
            val slots = runCatching { plans.findPlanSlots(ctx.accountId, requireNotNull(ctx.tripId)) }
                .onFailure { log.warn("도우미 편집 제안 — 일정 조회 실패. type={}", it.javaClass.simpleName) }.getOrNull()
            mentioned(slots.orEmpty(), target)?.let { return it.date }
        }
        return LocalDate.ofInstant(ctx.now, TRAVEL_ZONE).takeIf { ctx.inTrip }
    }

    /**
     * 카드에 그릴 이름. 일정에 이미 있는 곳은 **일정이 가진 이름**을 쓴다(확정 슬롯은 확정 당시 이름이 이긴다, INV-U1-03) —
     * 새로 들어오는 곳만 장소 정본에서 읽는다. 못 읽으면 "이름 미확인 장소"다(지어내지 않는다).
     */
    private fun names(ctx: DispatchContext, tripId: UUID, poiIds: Set<UUID>): Map<UUID, String> {
        val planned = runCatching { plans.findPlanSlots(ctx.accountId, tripId) }
            .onFailure { log.warn("도우미 편집 제안 — 일정 이름 조회 실패. type={}", it.javaClass.simpleName) }
            .getOrDefault(emptyList()).mapNotNull { slot -> slot.nameKo?.let { slot.poiId to it } }.toMap()
        return planned + surfaceNames(poiIds - planned.keys)
    }

    private fun surfaceNames(poiIds: Set<UUID>): Map<UUID, String> =
        if (poiIds.isEmpty()) {
            emptyMap()
        } else {
            runCatching { poiSurfaces.findSurfaces(poiIds) }
                .onFailure { log.warn("도우미 제안 — 장소 표면 조회 실패. type={}", it.javaClass.simpleName) }
                .getOrDefault(emptyMap()).mapValues { it.value.nameKo }
        }

    private fun byHand(text: String) = AssistantTemplates.handoff(text, editItinerary)

    companion object {
        /** 서버가 발급한 버튼만 싣는 인자 — 해석이 돌려준 인자에서는 걸러 낸다(상대가 지어낸 슬롯·장소로 교체를 시키지 못하게). */
        const val ARG_SLOT_KEY = "slotKey"
        const val ARG_POI_ID = "poiId"

        /** 상대 인자표의 이름(`ai/src/trippilot/domain/dialogue.py` ARGUMENT_TABLE). */
        private const val ARG_DAY = "day"
        private const val ARG_TARGET = "target"

        private const val CANNOT = "그렇게는 바꿀 수 없어요. 편집 화면에서 직접 바꿀 수 있어요."
        private const val LOCKED = "지금은 이 일정을 여기서 바꿀 수 없어요."
        private const val UNNAMED = "이름 미확인 장소"

        /** 위반만 있는 제안은 견줄 기준이 없다 — 적용되지 않으므로 지문을 견줄 일도 없다. */
        private const val NO_BASE = "-"
        private const val MAX_CANDIDATES = 5

        /** "N일차"의 N 이 터무니없으면 날짜 계산이 넘친다 — 여행 길이의 상한보다 넉넉한 값에서 끊는다. */
        private const val MAX_TRIP_DAYS = 366L
        private const val MAX_VIOLATIONS = 5
        private val APPLY_HINTS = setOf("AUTO_APPLY", "CONFIRM_REQUIRED")
        private val TRAVEL_ZONE: ZoneId = ZoneId.of("Asia/Seoul")
        private val TIME: DateTimeFormatter = DateTimeFormatter.ofPattern("HH:mm")
        private val DATE: DateTimeFormatter = DateTimeFormatter.ofPattern("M월 d일")
        private val log = LoggerFactory.getLogger(ProposalCards::class.java)

        /** 그 슬롯의 대체 후보를 여는 빠른 답 — 해석 없이 곧장 간다(버튼 모드에서도 된다). */
        fun alternativesReply(slotKey: String) = QuickReply(
            "qr-alt-$slotKey", "다른 곳 추천", QuickReplyAction.SEND_TEXT,
            mapOf(StartQuickReplies.INTENT to Intent.SUGGEST_ALTERNATIVE.name, ARG_SLOT_KEY to slotKey),
        )

        private fun dateOf(slotKey: String): LocalDate? = runCatching { LocalDate.parse(slotKey.substringBefore('#')) }.getOrNull()

        /** 여행 시작일이 1일차다. */
        private fun dayNumber(start: LocalDate, date: LocalDate) = ChronoUnit.DAYS.between(start, date) + 1

        /**
         * 날마다 동네로 다시 짠 안 — 상대의 해석을 날짜순으로 되읽는다("1일차는 종로, 2일차는 강남구 쪽으로 다시 짠 안이에요.").
         * 동네는 상대가 정리해 준 표기 그대로다. '일차'의 '차'는 받침이 없어 주제 조사는 늘 '는'이다. 해석이 없으면 null.
         */
        private fun areas(dayAreas: Map<LocalDate, String>, start: LocalDate): String? {
            if (dayAreas.isEmpty()) return null
            return dayAreas.entries.sortedBy { it.key }
                .joinToString(", ", postfix = " 쪽으로 다시 짠 안이에요.") { (date, area) -> "${dayNumber(start, date)}일차는 $area" }
        }

        /**
         * 전후 비교(`b02`). 하루 안에서 장소로 견준다 — 같은 날 같은 장소는 한 번뿐이다(편집 규칙).
         * 빠진 수와 들어온 수가 같으면 자리 순서대로 짝지어 **교체**로 읽고, 다르면 따로 **삭제**·**추가**다.
         * 남은 장소는 순서가 바뀌었으면 **이동**, 시각만 바뀌었으면 **시각 변경**이다.
         * 줄마다 그 날(`1일차 · 10월 24일`)을 단다 — 여러 날을 고친 안을 앱이 날로 묶는다. [start] 를 모르면 비운다.
         */
        internal fun diff(before: List<ProposedDay>, after: List<ProposedDay>, start: LocalDate? = null, name: (UUID) -> String): List<ProposalDiffItem> {
            fun face(slot: ProposedSlot) = ProposalSlotFace(name(slot.poiId), slot.startAt.format(TIME), slot.distanceRange)
            return (before.map { it.date } + after.map { it.date }).distinct().sorted().flatMap { date ->
                val day = start?.let { "${dayNumber(it, date)}일차 · ${date.format(DATE)}" }
                val old = before.firstOrNull { it.date == date }?.slots.orEmpty()
                val new = after.firstOrNull { it.date == date }?.slots.orEmpty()
                val removed = old.filter { o -> new.none { it.poiId == o.poiId } }
                val added = new.filter { n -> old.none { it.poiId == n.poiId } }
                val kept = old.filter { o -> new.any { it.poiId == o.poiId } }
                val reordered = kept.map { it.poiId } != new.filter { n -> old.any { it.poiId == n.poiId } }.map { it.poiId }
                buildList {
                    if (removed.size == added.size) {
                        removed.zip(added).forEach { (o, n) -> add(ProposalDiffItem("REPLACED", "$date#${o.poiId}", face(o), face(n))) }
                    } else {
                        removed.forEach { add(ProposalDiffItem("REMOVED", "$date#${it.poiId}", face(it), null)) }
                        added.forEach { add(ProposalDiffItem("ADDED", "$date#${it.poiId}", null, face(it))) }
                    }
                    kept.forEach { o ->
                        val n = new.first { it.poiId == o.poiId }
                        if (o.startAt != n.startAt || o.endAt != n.endAt) {
                            add(ProposalDiffItem(if (reordered) "MOVED" else "RETIMED", "$date#${o.poiId}", face(o), face(n)))
                        }
                    }
                }.map { it.copy(dayLabel = day) }
            }
        }
    }
}

/**
 * 일정 내용의 지문(INV-U8-04) — 제안을 만든 기준과 [적용] 순간의 일정이 같은가를 견준다. 저장되는 것(날짜·장소·시각·고정·
 * 자정 넘김)만 넣는다: 이름·거리·위반 표시는 보이는 값일 뿐 편집이 덮어쓰는 내용이 아니다.
 */
object ItineraryFingerprint {
    fun of(days: List<ProposedDay>): String = hash(
        days.sortedBy { it.date }.flatMap { day -> day.slots.map { row(day.date, it.poiId, it.startAt, it.endAt, it.isFixed, it.endsNextDay) } },
    )

    /** 편집 경로가 저장 직전에 다시 읽은 일정 — [ItineraryEditFacade.edit] 의 `onlyIf` 가 받는 모양. */
    fun ofCurrent(days: List<EditDayCommand>): String = hash(
        days.sortedBy { it.date }.flatMap { day -> day.slots.map { row(day.date, it.poiId, it.startAt, it.endAt, it.isFixed, it.endsNextDay) } },
    )

    fun ofPlan(slots: List<PlannedSlotView>): String = hash(
        slots.sortedWith(compareBy({ it.date }, { it.orderIndex })).map { row(it.date, it.poiId, it.startAt, it.endAt, it.isFixed, it.endsNextDay) },
    )

    private fun row(date: LocalDate, poiId: UUID, startAt: LocalTime, endAt: LocalTime, isFixed: Boolean, endsNextDay: Boolean) =
        "$date|$poiId|$startAt|$endAt|$isFixed|$endsNextDay"

    private fun hash(rows: List<String>): String =
        HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(rows.joinToString("\n").toByteArray()))
}
