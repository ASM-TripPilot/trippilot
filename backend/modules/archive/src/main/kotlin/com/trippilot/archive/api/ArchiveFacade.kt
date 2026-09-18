package com.trippilot.archive.api

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
     * 기준점 사다리 3단의 **마지막 완료 방문지**(BR-U4-19). 좌표가 아니라 `poiId` 를 준다 —
     * 실적은 좌표를 들고 있지 않고, 정본은 POI(C7)에 있다.
     */
    fun findLastCompletedPoi(tripId: UUID): UUID?
}
