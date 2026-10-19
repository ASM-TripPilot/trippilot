package com.trippilot.placedata.api

import java.util.UUID

/**
 * POI 생애 상태 조회(C7 · situation-awareness `domain-entities.md` §7.2) — 장소 감지(C9)가 폐업을 알아보는 입구다.
 *
 * **상태 무관으로 찾는다** — ACTIVE 만 주는 조회로는 폐업을 볼 수 없다. [PoiSurfaceFacade] 에 얹지 않는 이유는 파급이다
 * (그쪽은 구현·대역이 여러 모듈에 있다).
 */
interface PoiStatusFacade {
    /** 있는 POI 만 담긴다 — 없는 id 는 키가 빠진다(모름을 상태로 지어내지 않는다). */
    fun statusOf(poiIds: Collection<UUID>): Map<UUID, PoiLifeStatus>
}

/**
 * 감지가 쓰는 세 갈래. 수집 상태 4종을 접는다 — `LOST`(원본 목록에서 빠짐)·`UNVERIFIED` 는 **폐업이 아니라 모름**이라
 * [OTHER] 다(BR-SA-17 ⑤). 폐업 판정은 [CLOSED] 하나뿐이다.
 */
enum class PoiLifeStatus { ACTIVE, CLOSED, OTHER }
