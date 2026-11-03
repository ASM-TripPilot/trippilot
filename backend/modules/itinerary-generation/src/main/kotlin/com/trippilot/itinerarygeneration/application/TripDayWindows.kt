package com.trippilot.itinerarygeneration.application

import com.trippilot.trip.api.TripGenerationContext
import java.time.LocalDate
import java.time.LocalTime

/**
 * 그 날의 **기본** 일과 창 — 사용자가 여행에 적어 둔 값(첫날 시작·매일 시작·마지막 날 끝)이 있으면 그것, 없으면 09:00~21:00.
 * 첫날·마지막날 값은 **그 날에만** 걸린다(당일치기는 둘 다).
 *
 * 생성([GenerateItineraryService])과 편집 제안([RepairContexts.forEditProposal])이 같은 규칙을 쓴다 — 두 벌이면 한쪽만 고쳐진다.
 * 모순 검사(시작 ≥ 끝)·오늘 자르기(지금부터)·고정 블록 넓히기는 생성 몫이라 여기 없다.
 */
internal fun TripGenerationContext.baseDayWindow(date: LocalDate): Pair<LocalTime, LocalTime> {
    val start = (if (date == startDate) firstDayStartAt else null) ?: dayStartAt ?: DEFAULT_DAY_START
    val end = (if (date == endDate) lastDayEndAt else null) ?: DEFAULT_DAY_END
    return start to end
}

private val DEFAULT_DAY_START: LocalTime = LocalTime.of(9, 0)
private val DEFAULT_DAY_END: LocalTime = LocalTime.of(21, 0)
