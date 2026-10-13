package com.trippilot.assistant.application

import com.trippilot.assistant.domain.NewMessage
import com.trippilot.assistant.domain.NextAction
import com.trippilot.itinerarygeneration.api.ItineraryFacade
import com.trippilot.itinerarygeneration.api.ItineraryPlanFacade
import com.trippilot.itinerarygeneration.api.PlannedSlotView
import com.trippilot.placedata.api.PoiSurfaceFacade
import com.trippilot.weathercontext.api.ContextFacade
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Component
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/**
 * 조회형 응답(FD §4) — 진행 검토·다음 장소·거리·장소·날씨. 대화 안에서 끝나는 것은 이것과 제안뿐이다.
 *
 * **보이는 값은 전부 기존 경로가 이미 저장·검증한 값이다**(INV-2). 여기서는 읽어서 옮길 뿐, 시각을 계산하거나
 * 거리를 재거나 "갈 수 있다/없다"를 판정하지 않는다(BR-U8-15·28). 소요시간은 어디에도 없다(INV-3).
 *
 * 사용자의 말에서 나온 인자는 **찾는 데만** 쓴다 — 카드에 그리는 이름·값은 저장된 것이다. 상대가 지어낸 인자가
 * 화면에 새는 길이 없다(SEC-U8-03).
 *
 * 원천 하나가 실패하면 추측하지 않고 가용한 범위만 말한다(BR-U8-16).
 */
@Component
class QueryCards(
    private val itineraries: ItineraryFacade,
    private val plans: ItineraryPlanFacade,
    private val poiSurfaces: PoiSurfaceFacade,
    private val weather: ContextFacade,
) {
    private val editItinerary = NextAction("OPEN_ITINERARY_EDIT", "일정 편집")
    private val viewItinerary = NextAction("OPEN_ITINERARY", "일정 보기")
    private val makeItinerary = NextAction("OPEN_ITINERARY_METHOD", "일정 만들기")

    /** 진행 검토(US-ASSIST-03 · DEC-U8-14). */
    fun review(ctx: DispatchContext): NewMessage {
        val trip = requireNotNull(ctx.trip)
        val tripId = requireNotNull(ctx.tripId)
        // 못 읽은 것과 없는 것을 가른다 — 못 읽었는데 "없다"고 하면 거짓이다(BR-U8-16).
        val current = loadCurrent(ctx)
        val slots = runCatching { plans.findPlanSlots(ctx.accountId, tripId) }
            .onFailure { log.warn("도우미 진행 검토 — 계획 슬롯 조회 실패. type={}", it.javaClass.simpleName) }.getOrNull()
        val itinerary = current?.value
        // 실제로 답에 구멍이 난 경우만 "일부를 못 봤다"고 한다 — 일정이 없다는 것을 확인했으면 슬롯을 못 읽어도 구멍이 아니다.
        val partial = current == null || (itinerary != null && slots == null)
        // 생성이 아직 돌고 있으면 뒤 일자는 "비어 있는" 것이 아니라 "만드는 중"이다 — 문제로 세지 않는다.
        val generating = itinerary?.generationState == "PARTIAL"
        // 생성이 중간에 멈췄으면 뒤 일자는 정말 비어 있다 — 손으로 채우는 것보다 다시 만드는 쪽이 맞는 길이다.
        val fillDay = if (itinerary?.generationState == "FAILED") NextAction("OPEN_REGENERATE", "일정 다시 만들기") else editItinerary

        val days = generateSequence(trip.startDate) { it.plusDays(1) }.takeWhile { it <= trip.endDate }.toList()
        val byDate = slots.orEmpty().groupBy { it.date }
        // 여행 날짜를 바꾸면 일정은 옛 날짜에 남는다 — 그 슬롯을 "0일차"라고 부르지 않고 날짜로 부른다.
        fun dayLabel(date: LocalDate) = days.indexOf(date).takeIf { it >= 0 }?.let { "${it + 1}일차" } ?: date.format(DATE)

        val problems = buildList {
            // 당일 여행에는 숙소가 없는 것이 문제가 아니다.
            if (trip.baseStayName == null && trip.nights > 0) add(ReviewProblem(null, "등록된 숙소가 없어요", NextAction("OPEN_STAY_SEARCH", "숙소 찾기")))
            if (current != null && itinerary == null) add(ReviewProblem(null, "아직 일정이 없어요", makeItinerary))
            if (itinerary != null && slots != null) {
                if (slots.any { it.date !in days }) add(ReviewProblem(null, "여행 날짜 밖에 놓인 일정이 있어요", editItinerary))
                if (!generating) {
                    val empty = days.filter { byDate[it].isNullOrEmpty() }
                    if (empty.size > MAX_EMPTY_DAY_ROWS) {
                        add(ReviewProblem(null, "일정이 비어 있는 날이 ${empty.size}일 있어요", fillDay))
                    } else {
                        empty.forEach { add(ReviewProblem(null, "${dayLabel(it)} 일정이 비어 있어요", fillDay)) }
                    }
                }
                // 위반은 **저장된 표기 그대로**다 — 사유가 없으면 사유를 짓지 않는다.
                val violations = slots.filter { it.hasViolation }.sortedWith(compareBy({ it.date }, { it.orderIndex }))
                violations.take(MAX_PROBLEMS).forEach {
                    val where = "${dayLabel(it.date)} ${it.startAt.format(TIME)} ${it.nameKo ?: "이름 미확인 장소"}"
                    add(ReviewProblem(it.slotKey, "$where — ${it.violationReason ?: "확인이 필요해요"}", editItinerary))
                }
                // 다 못 보였으면 그렇다고 말한다 — 다섯 건을 전부로 읽게 두지 않는다.
                if (violations.size > MAX_PROBLEMS) add(ReviewProblem(null, "확인이 필요한 곳이 ${violations.size - MAX_PROBLEMS}곳 더 있어요", editItinerary))
            }
        }
        val filled = "${days.size}일 중 ${days.count { !byDate[it].isNullOrEmpty() }}일 채움"
        val schedule = when {
            current == null || (itinerary != null && slots == null) -> "확인할 수 없어요"
            itinerary == null -> "아직 없음"
            generating -> "만드는 중 ($filled)"
            else -> filled
        }
        return AssistantTemplates.review(
            text = if (partial) "일부 정보를 확인할 수 없어 확인된 범위만 정리했어요." else "지금까지 진행 상태를 정리했어요.",
            summary = listOf("여행" to trip.span(), "숙소" to (trip.baseStayName?.let { "$it (등록됨)" } ?: "미등록"), "일정" to schedule),
            problems = problems,
            next = if (current != null && itinerary == null) makeItinerary else viewItinerary,
        )
    }

    /** 읽기에 성공했음을 값과 함께 든다 — "읽었는데 없다"(value = null)와 "못 읽었다"(Loaded 자체가 없다)를 가른다. */
    private class Loaded<T>(val value: T)

    /** 다음 장소 — 계획 시각이 지금 이후인 첫 슬롯. 방문 여부를 따지지 않는다(그건 여행 중 화면의 일이다). */
    fun nextSlot(ctx: DispatchContext): NewMessage {
        val slots = planned(ctx) ?: return cannotRead()
        // 슬롯이 0건인 것은 셋 중 하나다 — 일정이 없다 · 만드는 중이다 · 있는데 비었다. 뭉개면 만드는 중에 "일정이 없다"고 한다.
        if (slots.isEmpty()) {
            val current = loadCurrent(ctx) ?: return cannotRead()
            return when (current.value?.generationState) {
                null -> noItinerary()
                "PARTIAL" -> AssistantTemplates.handoff("일정을 만드는 중이에요.", viewItinerary)
                else -> AssistantTemplates.handoff("아직 일정에 장소가 없어요.", viewItinerary)
            }
        }
        val today = LocalDate.ofInstant(ctx.now, TRAVEL_ZONE)
        val nowTime = LocalTime.ofInstant(ctx.now, TRAVEL_ZONE)
        val next = slots.firstOrNull { it.date > today || (it.date == today && it.startAt >= nowTime) }
            // 생성이 아직 돌고 있으면 뒤 일자가 곧 온다 — "남은 일정이 없다"고 하지 않는다. 그걸 못 읽었으면 어느 쪽인지 모른다.
            ?: return when ((loadCurrent(ctx) ?: return cannotRead()).value?.generationState) {
                "PARTIAL" -> AssistantTemplates.handoff("일정을 만드는 중이에요.", viewItinerary)
                else -> AssistantTemplates.handoff("남은 일정이 없어요.", viewItinerary)
            }
        val rows = buildList {
            if (next.date != today) add("날짜" to next.date.format(DATE))
            add("계획 시각" to next.startAt.format(TIME))
            next.distanceRange?.let { add("직전 구간" to it) } // 모르면 줄을 빼지 0 으로 채우지 않는다
        }
        return AssistantTemplates.info(
            "NEXT_SLOT", "다음 장소예요.", next.nameKo ?: "이름 미확인 장소", rows,
            if (ctx.inTrip) NextAction("OPEN_LIVE", "여행 중 화면 열기") else viewItinerary,
        )
    }

    /**
     * 거리 — **일정상 그 장소의 직전 구간**만 답한다. 임의의 두 곳 사이는 재지 않는다(G-U8-5): 출발지를 말했는데
     * 그것이 일정에서 바로 앞 장소가 아니면, 적힌 거리는 묻는 구간의 것이 아니다 — 일정으로 보낸다.
     */
    fun distance(ctx: DispatchContext): NewMessage {
        val slots = planned(ctx) ?: return cannotRead()
        val asked = AssistantTemplates.handoff("구간 거리는 일정에서 확인할 수 있어요.", viewItinerary)
        val slot = mentioned(slots, ctx.arguments[ARG_DESTINATION]) ?: return asked
        ctx.arguments[ARG_ORIGIN]?.takeIf { it.isNotBlank() }?.let { origin ->
            val previous = slots.filter { it.date == slot.date }.lastOrNull { it.orderIndex < slot.orderIndex }
            if (previous == null || mentioned(slots, origin)?.slotKey != previous.slotKey) return asked
        }
        val distance = slot.distanceRange ?: return asked
        return AssistantTemplates.info("DISTANCE", "일정에 적힌 거리예요.", slot.nameKo ?: "이름 미확인 장소", listOf("직전 구간" to distance), viewItinerary)
    }

    /**
     * 장소 정보 — 가리키는 곳은 **지금 일정의 슬롯**에서 찾는다. 없는 값은 "미확인"이라고 한다.
     *
     * 이름·분류는 일정이 가진 값을 쓴다 — 확정된 슬롯은 확정 당시의 이름이 이기고(INV-U1-03), 그 판단은 일정 모듈 것이다.
     * 장소 정본에서는 일정에 없는 값(영업시간)만 얹는다. 둘을 뒤집으면 장소가 개명됐을 때 카드와 일정 화면의 이름이 갈린다.
     */
    fun place(ctx: DispatchContext): NewMessage {
        val slots = planned(ctx) ?: return cannotRead()
        val slot = mentioned(slots, ctx.arguments[ARG_PLACE])
            ?: return AssistantTemplates.handoff("장소 정보는 일정에서 장소를 눌러 볼 수 있어요.", viewItinerary)
        val hours = runCatching { poiSurfaces.findSurfaces(listOf(slot.poiId))[slot.poiId]?.openingHours }
            .onFailure { log.warn("도우미 장소 표면 조회 실패. type={}", it.javaClass.simpleName) }.getOrNull()
        val rows = listOf("분류" to (slot.category ?: "미확인"), "영업시간" to (hours?.takeIf { it.isNotBlank() } ?: "미확인"))
        return AssistantTemplates.info(
            "PLACE", "일정에 있는 장소예요.", slot.nameKo ?: "이름 미확인 장소", rows,
            NextAction("OPEN_PLACE", "장소 보기", mapOf("poiId" to slot.poiId.toString())),
        )
    }

    /**
     * 날씨 — 신선한 값이 있을 때만 말한다. 못 받아 왔거나 오래됐으면 잘못된 정보로 말하지 않는다(U4 BR 승계).
     * 원천이 주는 값은 **그 날의 최대 강수확률**이다 — "지금"의 값이 아니라서 그렇게 적는다.
     */
    fun weather(ctx: DispatchContext): NewMessage {
        val region = requireNotNull(ctx.trip).destinations.firstOrNull()?.takeIf { it.isNotBlank() }
        val reading = region?.let { r ->
            runCatching { weather.readingForDisplay(r, ctx.now) }
                .onFailure { log.warn("도우미 날씨 조회 실패. type={}", it.javaClass.simpleName) }.getOrNull()
        }
        if (region == null || reading == null || reading.stale) {
            return AssistantTemplates.handoff("지금 날씨를 확인할 수 없어요.", viewItinerary)
        }
        val rows = listOfNotNull("오늘 최대 강수확률" to "${reading.precipProbability}%", reading.warning?.takeIf { it.isNotBlank() }?.let { "특보" to it })
        return AssistantTemplates.info("WEATHER", "오늘 예보예요.", "$region 날씨", rows, viewItinerary)
    }

    /** 표시 순서대로의 계획 슬롯. **null 이면 못 읽은 것이다**(빈 목록 = 일정이 없거나 비었다). */
    private fun planned(ctx: DispatchContext): List<PlannedSlotView>? =
        runCatching { plans.findPlanSlots(ctx.accountId, requireNotNull(ctx.tripId)).sortedWith(compareBy({ it.date }, { it.orderIndex })) }
            .onFailure { log.warn("도우미 일정 조회 실패. type={}", it.javaClass.simpleName) }.getOrNull()

    /** 일정 요약. **null 이면 못 읽은 것이다** — 읽었는데 일정이 없으면 `Loaded(null)` 이다. */
    private fun loadCurrent(ctx: DispatchContext) =
        runCatching { Loaded(itineraries.findCurrent(ctx.accountId, requireNotNull(ctx.tripId))) }
            .onFailure { log.warn("도우미 일정 요약 조회 실패. type={}", it.javaClass.simpleName) }.getOrNull()

    private fun noItinerary() = AssistantTemplates.handoff("아직 일정이 없어요.", makeItinerary)

    /** 원천이 죽었다 — 추측하지 않고 그 화면을 연다(FD §6). 버튼을 눌러 온 턴이라 [다시 시도]로 되풀이할 말이 없다. */
    private fun cannotRead() = AssistantTemplates.handoff("지금 일정을 확인할 수 없어요.", viewItinerary)

    /**
     * 말에서 가리킨 장소 — 그 이름과 겹치는 슬롯이 **하나뿐일 때만**. 인자는 찾는 데만 쓴다.
     * 못 찾거나 여럿이면("카페"가 셋이면 어느 카페인가) 지어내지 않고 null — 호출측이 일정 화면으로 보낸다.
     */
    private fun mentioned(slots: List<PlannedSlotView>, said: String?): PlannedSlotView? {
        val word = said?.trim()?.takeIf { it.length >= MIN_MENTION_LENGTH } ?: return null
        // 이름이 한 글자거나 빈 슬롯은 거의 모든 말에 "들어 있다" — 그런 슬롯은 후보에서 뺀다.
        return slots.filter { slot -> slot.nameKo?.takeIf { it.length >= MIN_MENTION_LENGTH }?.let { word in it || it in word } == true }.singleOrNull()
    }

    private companion object {
        const val MAX_PROBLEMS = 5
        const val MAX_EMPTY_DAY_ROWS = 3

        /** 상대(ai) 인자표의 이름(`ai/src/trippilot/domain/dialogue.py` ARGUMENT_TABLE) — 장소를 가리키는 인자만 읽는다. */
        const val ARG_DESTINATION = "destination"
        const val ARG_ORIGIN = "origin"
        const val ARG_PLACE = "place"

        /** 한 글자 인자("카")로 엉뚱한 곳이 잡히지 않게. */
        const val MIN_MENTION_LENGTH = 2
        val TRAVEL_ZONE: ZoneId = ZoneId.of("Asia/Seoul")
        val TIME: DateTimeFormatter = DateTimeFormatter.ofPattern("HH:mm")
        val DATE: DateTimeFormatter = DateTimeFormatter.ofPattern("M월 d일")
        private val log = LoggerFactory.getLogger(QueryCards::class.java)
    }
}
