package com.trippilot.savedaccommodation.domain

import java.time.LocalDate
import java.util.UUID

/** 하루 거점 판정(US-TRIP-06 차단형). AUTO=자동 확정 · GAP=공백(후보0) · OVERLAP=겹침(후보≥2). */
enum class CoverageStatus { AUTO, GAP, OVERLAP }

/** 구간 거점 스팬 — 반개구간 [dateFrom, dateTo). dateTo 당일은 체크아웃(숙박 없음). */
data class BaseSpan(val savedStayId: UUID, val dateFrom: LocalDate, val dateTo: LocalDate)

/** 하루 판정 결과. AUTO만 savedStayId 확정, GAP/OVERLAP은 미해결(null). */
data class DayCoverage(val date: LocalDate, val status: CoverageStatus, val savedStayId: UUID?)

/**
 * 커버리지 리졸버(LC-U1-7 · 순수 함수 · **PBT-U1-2 게이트**).
 * 여행 숙박일 [startDate, endDate) 각각을 덮는 거점 수로 판정:
 *   정확히 1 → AUTO · 0 → GAP · ≥2 → OVERLAP.
 * 하나라도 GAP/OVERLAP이면 blocked(일정 생성 진입 차단, INV-U1-16). 사용자 해소(user_pick)는 Sprint 3.
 */
object CoverageResolver {
    /** 숙박일별 판정. dateFrom <= day < dateTo 인 거점이 그 날을 덮는다. */
    fun resolve(startDate: LocalDate, endDate: LocalDate, bases: List<BaseSpan>): List<DayCoverage> =
        stayNights(startDate, endDate).map { day ->
            val covering = bases.filter { !day.isBefore(it.dateFrom) && day.isBefore(it.dateTo) }
            when (covering.size) {
                1 -> DayCoverage(day, CoverageStatus.AUTO, covering.single().savedStayId)
                0 -> DayCoverage(day, CoverageStatus.GAP, null)
                else -> DayCoverage(day, CoverageStatus.OVERLAP, null)
            }
        }

    /** 전 숙박일 자동 확정이면 게이트 통과. 미해결(GAP/OVERLAP)이 하나라도 있으면 차단. */
    fun blocked(coverage: List<DayCoverage>): Boolean = coverage.any { it.status != CoverageStatus.AUTO }

    /** 숙박일 = [startDate, endDate) — 마지막 날(endDate)은 체크아웃이라 제외. */
    private fun stayNights(startDate: LocalDate, endDate: LocalDate): List<LocalDate> =
        generateSequence(startDate) { it.plusDays(1) }.takeWhile { it.isBefore(endDate) }.toList()
}
