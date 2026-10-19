package com.trippilot.itinerarygeneration.application

import com.trippilot.itinerarygeneration.api.CheckedSlot
import com.trippilot.itinerarygeneration.api.DayCheck
import com.trippilot.itinerarygeneration.api.HoursVerdict
import com.trippilot.itinerarygeneration.api.ItineraryDayCheckFacade
import com.trippilot.itinerarygeneration.application.Revalidation.Companion.violations
import com.trippilot.itinerarygeneration.domain.DaySchedule
import com.trippilot.itinerarygeneration.domain.FreshnessMeta
import com.trippilot.itinerarygeneration.domain.Itinerary
import com.trippilot.itinerarygeneration.domain.ItineraryDay
import com.trippilot.itinerarygeneration.domain.ItineraryRepository
import com.trippilot.itinerarygeneration.domain.ScheduleAgentOutput
import com.trippilot.itinerarygeneration.domain.ScheduleAgentPort
import com.trippilot.itinerarygeneration.domain.VisitSlotDisplay
import com.trippilot.trip.api.TripFacade
import org.springframework.beans.factory.annotation.Value
import org.springframework.stereotype.Service
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.TransactionTemplate
import java.time.Clock
import java.time.LocalDate
import java.util.UUID

/**
 * 하루 점검(C8 · situation-awareness §7.1 · BR-SA-17) — 그 날 슬롯을 영업시간으로 다시 본다. 장소 감지(C9)의 재료다.
 *
 * 순서: 읽기 트랜잭션 하나로 소유·일정·그 날 슬롯·표면(확정분 동결 이름)을 읽고 **닫은 뒤** 편집 재검증과 같은
 * [Revalidation.attempt] 로 그 날 하루만 검증한다 — AI 를 기다리는 동안 DB 커넥션을 물지 않는다.
 *
 * 영업시간 원문 해석은 AI 한 곳이다 — 여기는 원문도 위반 detail 도 파싱하지 않고 위반의 **타입과 위치**만 읽는다.
 * 모름은 OK 로 채우지 않는다(INV-SA-2): AI 모드가 http 가 아님(가짜 검증의 빈 목록은 판정이 아니다) · 영업시간을 빼라고
 * 함 · 보류 · 영업시간 원문 없음은 전부 [HoursVerdict.UNKNOWN] 이다. 위치 없는 위반·HC2~HC4 는 슬롯에 붙이지 않는다.
 * **알려진 틈**: AI 는 원문이 있어도 해석하지 못하면 영업정보 없음으로 보고 HC1 을 적용하지 않는데, validate 응답은 위반만
 * 싣고 그 사실을 싣지 않는다 — 그런 슬롯은 OK 로 읽힌다. 슬롯별 'HC1 미판정'은 하위 코드와 함께 경계를 여는 PR-H1 몫이다
 * (이 변경은 포트·와이어를 바꾸지 않는다).
 *
 * AI 모드는 설정값으로 읽는다 — 그 설정 클래스(`ScheduleAgentProperties`)는 http 조건부라 주입받으면 fake 모드 기동이
 * 깨진다(안티패턴 로그). 어댑터를 켜는 조건(`@ConditionalOnProperty` — 대소문자 무시)과 같은 규칙으로 비교한다.
 */
@Service
class ItineraryDayCheckService(
    private val trips: TripFacade,
    private val itineraries: ItineraryRepository,
    private val surfaces: SlotSurfaceAssembler,
    private val scheduleAgent: ScheduleAgentPort,
    transactionManager: PlatformTransactionManager,
    private val clock: Clock,
    @param:Value("\${trippilot.ai.schedule.mode:fake}") private val aiMode: String,
) : ItineraryDayCheckFacade {

    private val readTx = TransactionTemplate(transactionManager).apply { isReadOnly = true }

    override fun checkDay(accountId: UUID, tripId: UUID, date: LocalDate, judgeHours: Boolean): DayCheck? {
        val read = readTx.execute { read(accountId, tripId, date) } ?: return null
        val (itinerary, day, surface) = read
        if (day.slots.isEmpty()) return DayCheck(judged = true, slots = emptyList()) // 볼 슬롯이 없다 — AI 0회
        // 영업시간을 아는 슬롯이 없으면 부르지 않는다 — 결과가 어차피 전부 UNKNOWN 이다(validate 1회 ≈ 20초를 아낀다).
        val ask = judgeHours && aiMode.equals(HTTP, ignoreCase = true) &&
            day.slots.any { surface[it.sourcePoiId]?.openingHoursKnown == true }
        val verdict = if (ask) Revalidation.attempt(scheduleAgent, outputOf(itinerary, day), tripId) else null
        // 하루만 보냈으니 그 날은 0번 날이다. 위치가 없거나 영업시간이 아닌 위반은 여기서 빠진다.
        val violated = verdict?.violations().orEmpty()
            .filter { it.dayIndex == 0 && ViolationText.isOpeningHours(it.type) }
            .mapNotNull { it.slotIndex }
            .toSet()
        return DayCheck(
            judged = verdict != Revalidation.Withheld, // 부르지 않은 날은 보류가 아니다 — 영업시간은 아래에서 UNKNOWN 이다
            slots = day.slots.mapIndexed { i, s ->
                val known = surface[s.sourcePoiId]
                CheckedSlot(
                    slotKey = SlotKey.of(date, s.sourcePoiId),
                    poiId = s.sourcePoiId,
                    nameKo = known?.nameKo,
                    startAt = s.startAt,
                    hours = when {
                        verdict !is Revalidation.Judged || known?.openingHoursKnown != true -> HoursVerdict.UNKNOWN
                        i in violated -> HoursVerdict.VIOLATED
                        else -> HoursVerdict.OK
                    },
                    reasonCode = null, // 경계에 하위 코드가 아직 없다 — PR-H1 이 와이어와 함께 연다
                    hoursWarnedBefore = s.hasViolation && ViolationText.mentionsOpeningHours(s.violationReason),
                )
            },
        )
    }

    /** 소유·일정·그 날 — 하나라도 없으면 null. 표면은 일정 조회와 같은 합성이다(확정 슬롯은 동결 이름이 이긴다). */
    private fun read(accountId: UUID, tripId: UUID, date: LocalDate): Read? {
        trips.findPeriod(accountId, tripId) ?: return null
        val itinerary = itineraries.findByTrip(tripId).firstOrNull() ?: return null
        val day = itinerary.days.firstOrNull { it.date == date } ?: return null
        return Read(itinerary, day, surfaces.assemble(itinerary))
    }

    /** 그 날 하루만 실은 검증 입력 — 편집 재검증과 같은 사영(시각·순서·고정. 거리·소요시간 없음 — INV-3). */
    private fun outputOf(itinerary: Itinerary, day: ItineraryDay) = ScheduleAgentOutput(
        days = listOf(DaySchedule(day.date, day.slots.map { VisitSlotDisplay(it.sourcePoiId, it.startAt, it.endAt, it.endsNextDay, null, it.isFixed) })),
        day1ReadyAt = null,
        explanations = emptyMap(),
        solveMode = itinerary.solveMode,
        isFallback = itinerary.isFallback,
        freshness = FreshnessMeta(clock.instant(), degraded = false),
    )

    private data class Read(val itinerary: Itinerary, val day: ItineraryDay, val surfaces: Map<UUID, SlotSurface>)

    private companion object {
        private const val HTTP = "http"
    }
}
