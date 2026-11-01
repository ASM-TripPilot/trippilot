package com.trippilot.archive.api

import java.time.Instant
import java.time.LocalDate
import java.util.UUID

/**
 * 방문 실적 조회 — 타 모듈이 쓰는 유일한 진입점(R1 · BR-U5-10).
 *
 * 지금 소비자는 재계획(C10) 하나다. 실적이 `archive` 로 이관되면서 재계획이 남의 `application`
 * 서비스를 직접 들고 있을 수 없게 됐다 — 그 자리를 이 계약이 대신한다.
 *
 * **방향은 한쪽뿐이다**: `itinerary-recalculation` → `archive`. 이 모듈은 재계획을 되부르지 않는다
 * (되부르면 "완료가 잠금을 만들고, 잠금이 완료를 읽는" 순환이 된다 · BR-U5-10).
 *
 * 계약에 싣는 것은 **경계 키**(`slotKey = "{date}#{poiId}"`)와 `poiId` 뿐이다 — 재계획으로 슬롯 행이
 * 갈려도 참조가 끊기지 않고, `archive` 내부 도메인(`VisitCheck`)이 밖으로 새지 않는다.
 */
interface ArchiveFacade {
    /**
     * 재계획에서 **잠글 슬롯 키**(INV-U4-04). 완료된 것만 — 도착만 한 곳은 아직 떠날 수 있어
     * 시각을 조정할 여지가 있고, 건너뛴 곳은 안 갔으니 바꿔도 된다.
     */
    fun getCompletedSlots(tripId: UUID): Set<String>

    /**
     * **다녀온 슬롯 키** — 도착했거나 완료한 곳(건너뛴 곳·자동 되돌림 억제 표식은 빼고). 재계획 되돌리기(TRIP-1412)가
     * "이 슬롯을 계획에서 떼면 그 실적이 계획 없이 남는가"를 묻는다. 잠금([getCompletedSlots])보다 넓다 — 잠금은
     * 아직 떠날 수 있는 도착을 풀어 주지만, 되돌리기는 이미 남은 도착 기록을 고아로 만들면 안 된다.
     */
    fun getVisitedSlots(tripId: UUID): Set<String>

    /**
     * **그 날짜에 건너뛴 POI** — 재계획이 후보에서 뺄 곳(U4 BR-U4-17 개정 2026-11-01). 잠금([getCompletedSlots])과
     * 반대 방향이다: 건너뛴 곳은 잠그지 않지만(바꿔도 된다) **다시 넣지도 않는다**. 같은 날 같은 곳을 다시 넣으면 새 슬롯의
     * 키(`{date}#{poiId}`)가 건너뜀 기록과 같아져 그 칸은 도착할 수 없다(BR-U5-02 · 유니크 `(trip_id, slot_key)` → 409).
     * 날짜는 슬롯 키의 날짜로 가른다 — 다른 날 건너뛴 같은 곳은 키가 달라 충돌하지 않으므로 빼지 않는다.
     */
    fun getSkippedPois(tripId: UUID, date: LocalDate): Set<UUID>

    /**
     * 기준점 사다리 3단의 **마지막 완료 방문지**(BR-U4-19). 좌표가 아니라 `poiId` 를 준다 —
     * 실적은 좌표를 들고 있지 않고, 정본은 POI(C7)에 있다.
     */
    fun findLastCompletedPoi(tripId: UUID): UUID?

    /**
     * 그 시각에 지오펜스 자동 기록이 **무장돼 있었나**(U10 FD §12.4) — 이동 지연·진행 중 체류 초과는 무장된 여행에만
     * 켠다(DEC-U10-9). 수동으로만 쓰는 사용자에게 "늦었다"는 신호를 지어내지 않기 위해서다(BR-U6-11).
     */
    fun isAutomationArmed(tripId: UUID, at: Instant): Boolean
}
