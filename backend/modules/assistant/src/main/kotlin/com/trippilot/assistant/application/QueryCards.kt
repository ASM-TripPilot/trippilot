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
        var partial = false
        val hasItinerary = runCatching { itineraries.findCurrent(ctx.accountId, tripId) != null }.getOrElse { partial = true; null }
        val slots = runCatching { plans.findPlanSlots(ctx.accountId, tripId) }.getOrElse { partial = true; null }

        val days = generateSequence(trip.startDate) { it.plusDays(1) }.takeWhile { it <= trip.endDate }.toList()
        val byDate = slots.orEmpty().groupBy { it.date }
        val problems = buildList {
            if (trip.baseStayName == null) add(ReviewProblem(null, "등록된 숙소가 없어요", NextAction("OPEN_STAY_SEARCH", "숙소 찾기")))
            when {
                hasItinerary == false -> add(ReviewProblem(null, "아직 일정이 없어요", makeItinerary))
                slots != null && hasItinerary == true -> {
                    days.forEachIndexed { i, date ->
                        if (byDate[date].isNullOrEmpty()) add(ReviewProblem(null, "${i + 1}일차 일정이 비어 있어요", editItinerary))
                    }
                    // 위반은 **저장된 표기 그대로**다 — 사유가 없으면 사유를 짓지 않는다.
                    slots.filter { it.hasViolation }.sortedWith(compareBy({ it.date }, { it.orderIndex })).take(MAX_PROBLEMS).forEach {
                        val where = "${days.indexOf(it.date) + 1}일차 ${it.startAt.format(TIME)} ${it.nameKo ?: "이름 미확인 장소"}"
                        add(ReviewProblem(it.slotKey, "$where — ${it.violationReason ?: "확인이 필요해요"}", editItinerary))
                    }
                }
            }
        }
        val schedule = when {
            hasItinerary == null || (hasItinerary && slots == null) -> "확인할 수 없어요"
            !hasItinerary -> "아직 없음"
            else -> "${days.size}일 중 ${days.count { !byDate[it].isNullOrEmpty() }}일 채움"
        }
        return AssistantTemplates.review(
            text = if (partial) "일부 정보를 확인할 수 없어 확인된 범위만 정리했어요." else "지금까지 진행 상태를 정리했어요.",
            summary = listOf("여행" to trip.span(), "숙소" to (trip.baseStayName?.let { "$it (등록됨)" } ?: "미등록"), "일정" to schedule),
            problems = problems,
            next = if (hasItinerary == false) makeItinerary else viewItinerary,
        )
    }

    /** 다음 장소 — 계획 시각이 지금 이후인 첫 슬롯. 방문 여부를 따지지 않는다(그건 여행 중 화면의 일이다). */
    fun nextSlot(ctx: DispatchContext): NewMessage {
        val slots = plannedOrNull(ctx) ?: return noItinerary()
        val today = LocalDate.ofInstant(ctx.now, TRAVEL_ZONE)
        val nowTime = LocalTime.ofInstant(ctx.now, TRAVEL_ZONE)
        val next = slots.sortedWith(compareBy({ it.date }, { it.orderIndex }))
            .firstOrNull { it.date > today || (it.date == today && it.startAt >= nowTime) }
            ?: return AssistantTemplates.handoff("남은 일정이 없어요.", viewItinerary)
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

    /** 거리 — **일정상 그 장소의 직전 구간**만 답한다. 임의의 두 곳 사이는 재지 않는다(G-U8-5). */
    fun distance(ctx: DispatchContext): NewMessage {
        val slot = mentioned(ctx) ?: return AssistantTemplates.handoff("구간 거리는 일정에서 확인할 수 있어요.", viewItinerary)
        val distance = slot.distanceRange ?: return AssistantTemplates.handoff("그 구간의 거리는 일정에서 확인할 수 있어요.", viewItinerary)
        return AssistantTemplates.info("DISTANCE", "일정에 적힌 거리예요.", slot.nameKo ?: "이름 미확인 장소", listOf("직전 구간" to distance), viewItinerary)
    }

    /** 장소 정보 — 가리키는 곳은 **지금 일정의 슬롯**에서 찾는다. 없는 값은 "미확인"이라고 한다. */
    fun place(ctx: DispatchContext): NewMessage {
        val slot = mentioned(ctx) ?: return AssistantTemplates.handoff("장소 정보는 일정에서 장소를 눌러 볼 수 있어요.", viewItinerary)
        val surface = runCatching { poiSurfaces.findSurfaces(listOf(slot.poiId))[slot.poiId] }
            .onFailure { log.warn("도우미 장소 표면 조회 실패. type={}", it.javaClass.simpleName) }.getOrNull()
        val rows = listOf(
            "분류" to (surface?.category ?: slot.category ?: "미확인"),
            "영업시간" to (surface?.openingHours?.takeIf { it.isNotBlank() } ?: "미확인"),
        )
        return AssistantTemplates.info(
            "PLACE", "일정에 있는 장소예요.", surface?.nameKo ?: slot.nameKo ?: "이름 미확인 장소", rows,
            NextAction("OPEN_PLACE", "장소 보기", mapOf("poiId" to slot.poiId.toString())),
        )
    }

    /** 날씨 — 신선한 값이 있을 때만 말한다. 못 받아 왔거나 오래됐으면 잘못된 정보로 말하지 않는다(U4 BR 승계). */
    fun weather(ctx: DispatchContext): NewMessage {
        val region = requireNotNull(ctx.trip).destinations.firstOrNull()?.takeIf { it.isNotBlank() }
        val reading = region?.let { r ->
            runCatching { weather.readingForDisplay(r, ctx.now) }
                .onFailure { log.warn("도우미 날씨 조회 실패. type={}", it.javaClass.simpleName) }.getOrNull()
        }
        if (region == null || reading == null || reading.stale) {
            return AssistantTemplates.handoff("지금 날씨를 확인할 수 없어요.", viewItinerary)
        }
        val rows = listOfNotNull("강수확률" to "${reading.precipProbability}%", reading.warning?.takeIf { it.isNotBlank() }?.let { "특보" to it })
        return AssistantTemplates.info("WEATHER", "지금 예보예요.", "$region 날씨", rows, viewItinerary)
    }

    private fun plannedOrNull(ctx: DispatchContext): List<PlannedSlotView>? =
        plans.findPlanSlots(ctx.accountId, requireNotNull(ctx.tripId)).takeIf { it.isNotEmpty() }

    private fun noItinerary() = AssistantTemplates.handoff("아직 일정이 없어요.", makeItinerary)

    /**
     * 말에서 가리킨 장소 — 인자 값 중 하나가 일정 슬롯의 이름과 겹치는 첫 슬롯. **인자는 찾는 데만 쓴다.**
     * 어느 슬롯인지 못 가리면 지어내지 않고 null — 호출측이 일정 화면으로 보낸다.
     */
    private fun mentioned(ctx: DispatchContext): PlannedSlotView? {
        val said = ctx.arguments.values.map { it.trim() }.filter { it.length >= MIN_MENTION_LENGTH }
        if (said.isEmpty()) return null
        return plannedOrNull(ctx)?.sortedWith(compareBy({ it.date }, { it.orderIndex }))?.firstOrNull { slot ->
            val name = slot.nameKo ?: return@firstOrNull false
            said.any { it in name || name in it }
        }
    }

    private companion object {
        const val MAX_PROBLEMS = 5

        /** 한 글자 인자("카")로 엉뚱한 곳이 잡히지 않게. */
        const val MIN_MENTION_LENGTH = 2
        val TRAVEL_ZONE: ZoneId = ZoneId.of("Asia/Seoul")
        val TIME: DateTimeFormatter = DateTimeFormatter.ofPattern("HH:mm")
        val DATE: DateTimeFormatter = DateTimeFormatter.ofPattern("M월 d일")
        private val log = LoggerFactory.getLogger(QueryCards::class.java)
    }
}
