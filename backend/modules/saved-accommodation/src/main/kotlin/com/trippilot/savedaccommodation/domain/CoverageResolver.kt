package com.trippilot.savedaccommodation.domain

import java.time.LocalDate
import java.util.UUID

/** 하루 거점 판정(US-TRIP-06 차단형). AUTO=자동 확정 · GAP=공백(후보0) · OVERLAP=겹침(후보≥2). */
enum class CoverageStatus { AUTO, GAP, OVERLAP }

/**
 * 그 날 거점이 **어떻게** 정해졌나(정본 §2 `TripBaseDay.resolution`).
 * [PREV_STAY]·[DESTINATION_CENTER] 는 공백일 선택지(BR-U1-45)로 아직 구현하지 않았다 — 값만 둔다.
 */
enum class BaseResolution { AUTO, PREV_STAY, DESTINATION_CENTER, USER_PICK }

/** 구간 거점 스팬 — 반개구간 [dateFrom, dateTo). dateTo 당일은 체크아웃(숙박 없음). */
data class BaseSpan(val savedStayId: UUID, val dateFrom: LocalDate, val dateTo: LocalDate)

/**
 * 하루 판정 결과.
 *
 * [status] 는 **스팬이 말하는 판정**(왜 손이 필요한가)이고, [resolution] 은 **확정 여부**다 — 두 축이 다르다.
 * 겹침일을 사용자가 골라도 스팬은 여전히 겹쳐 있으므로 `status=OVERLAP · resolution=USER_PICK` 이 된다.
 * 화면은 이 조합으로 "겹쳤지만 내가 골라 뒀다"를 그린다.
 *
 * [candidates] 는 겹침일에 **고를 수 있는 숙소**(BR-U1-45 해소 시트의 선택지). 그 외 날짜는 빈 목록이다 —
 * 이걸 안 실으면 화면이 후보를 알아내려고 배정 목록을 받아 날짜 겹침을 다시 계산해야 한다.
 */
data class DayCoverage(
    val date: LocalDate,
    val status: CoverageStatus,
    val savedStayId: UUID?,
    val resolution: BaseResolution?,
    val candidates: List<UUID> = emptyList(),
) {
    /** 확정됐는가 — 게이트(INV-U1-16)의 단위. */
    val settled: Boolean get() = resolution != null
}

/**
 * 커버리지 리졸버(LC-U1-7 · 순수 함수 · **PBT-U1-2 게이트**).
 *
 * 여행 숙박일 [startDate, endDate) 각각을 덮는 거점 수로 판정: 정확히 1 → AUTO · 0 → GAP · ≥2 → OVERLAP.
 * 미해결(GAP/OVERLAP)이 하나라도 있으면 blocked — AI 일정 생성 진입 차단(INV-U1-16 · BR-U1-44).
 *
 * 사용자 해소([BaseResolution.USER_PICK], BR-U1-45)는 [picks] 로 덮어씌운다. **선택이 여전히 유효할 때만**
 * 인정한다 — 겹침일은 그 날 후보 중 하나여야 하고, 공백일은 이 여행에 배정된 숙소 중 하나여야 한다.
 * 배정이 바뀌어 선택이 무의미해졌는데도 확정으로 세면, 사라진 숙소를 거점으로 일정을 짜게 된다.
 */
object CoverageResolver {

    /**
     * 숙박일별 판정. `dateFrom <= day < dateTo` 인 거점이 그 날을 덮는다.
     *
     * @param picks 날짜별 사용자 선택(숙소). 유효하지 않은 선택은 **조용히 무시**되어 그 날은 미해결로 남는다 —
     *   화면이 다시 고르게 하는 것이 맞고, 무효한 선택을 확정으로 세는 것보다 낫다.
     */
    fun resolve(
        startDate: LocalDate,
        endDate: LocalDate,
        bases: List<BaseSpan>,
        picks: Map<LocalDate, UUID> = emptyMap(),
    ): List<DayCoverage> {
        val assignedStays = bases.map { it.savedStayId }.toSet()
        return stayNights(startDate, endDate).map { day ->
            val covering = bases.filter { !day.isBefore(it.dateFrom) && day.isBefore(it.dateTo) }
            val candidates = covering.map { it.savedStayId }.distinct()
            when (covering.size) {
                1 -> DayCoverage(day, CoverageStatus.AUTO, candidates.single(), BaseResolution.AUTO)
                0 -> unsettled(day, CoverageStatus.GAP, picks[day]?.takeIf { it in assignedStays }, emptyList())
                else -> unsettled(day, CoverageStatus.OVERLAP, picks[day]?.takeIf { it in candidates }, candidates)
            }
        }
    }

    /** 미해결 판정의 날 — 유효한 사용자 선택이 있으면 그것으로 확정된다. */
    private fun unsettled(day: LocalDate, status: CoverageStatus, pick: UUID?, candidates: List<UUID>) =
        DayCoverage(day, status, pick, pick?.let { BaseResolution.USER_PICK }, candidates)

    /** 확정되지 않은 날이 하나라도 있으면 차단. */
    fun blocked(coverage: List<DayCoverage>): Boolean = coverage.any { !it.settled }

    /** 숙박일 = [startDate, endDate) — 마지막 날(endDate)은 체크아웃이라 제외. */
    fun stayNights(startDate: LocalDate, endDate: LocalDate): List<LocalDate> =
        generateSequence(startDate) { it.plusDays(1) }.takeWhile { it.isBefore(endDate) }.toList()
}

/** 날짜별 확정 거점(정본 §2 `TripBaseDay`). `savedStayId` 는 destination_center 대비로 null 을 허용한다. */
data class TripBaseDay(
    val tripId: UUID,
    val dayDate: LocalDate,
    val savedStayId: UUID?,
    val resolution: BaseResolution,
)

interface TripBaseDayRepository {
    fun findByTrip(tripId: UUID): List<TripBaseDay>

    /** 하루 1행(PK = trip_id, day_date) — 다시 고르면 덮어쓴다. */
    fun save(day: TripBaseDay): TripBaseDay
}
