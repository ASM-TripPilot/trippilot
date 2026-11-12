package com.trippilot.itinerarygeneration.application

import com.trippilot.trip.api.TripGenerationContext
import java.time.LocalDate
import java.time.LocalTime

/**
 * 그 날의 **기본** 일과 창 — 사용자가 여행에 적어 둔 값(첫날 시작·매일 시작·마지막 날 끝)이 있으면 그것, 없으면 09:00~21:00.
 * 첫날·마지막날 값은 **그 날에만** 걸린다(당일치기는 둘 다).
 *
 * 생성([GenerateItineraryService])·편집 제안과 수리([RepairContexts])·재계획([ReplanFacadeService])이 같은 규칙을 쓴다 — 두 벌이면
 * 한쪽만 고쳐진다(재계획·수리는 2026-11-05 부터 — 종전엔 AI 어댑터가 09:00~21:00 상수를 실었다).
 * 모순 검사(시작 ≥ 끝)·오늘 자르기(지금부터)·고정 블록 넓히기·원 일정으로 넓히기는 쓰는 쪽 몫이라 여기 없다.
 */
internal fun TripGenerationContext.baseDayWindow(date: LocalDate): Pair<LocalTime, LocalTime> {
    val start = (if (date == startDate) firstDayStartAt else null) ?: dayStartAt ?: DEFAULT_DAY_START
    val end = (if (date == endDate) lastDayEndAt else null) ?: DEFAULT_DAY_END
    return start to end
}

/** 설정이 없는 날의 창. 재계획은 설정이 모순(시작 ≥ 끝)일 때도 이 값으로 간다 — 창이 필수라서. */
internal val DEFAULT_DAY_START: LocalTime = LocalTime.of(9, 0)
internal val DEFAULT_DAY_END: LocalTime = LocalTime.of(21, 0)
