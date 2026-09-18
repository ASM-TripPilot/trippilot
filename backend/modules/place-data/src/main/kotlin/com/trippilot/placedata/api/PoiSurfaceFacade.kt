package com.trippilot.placedata.api

import java.util.UUID

/**
 * 표시용 POI 표면 일괄 조회(C7 · BR-U3-09 · DEC-U3-9).
 * 일정 슬롯은 `poiId` 만 들고 있어, 화면이 장소명·좌표·사진·영업시간을 그리려면 정본을 합성해 줘야 한다.
 *
 * **상태 무관으로 돌려준다** — 후보풀(INV-U1-01 ACTIVE만)과 달리 여기는 *이미 일정에 들어간* 장소의 표시다.
 * 생성 후 POI 가 비활성으로 바뀌었다고 화면에서 장소가 사라지면 안 된다.
 */
interface PoiSurfaceFacade {
    /** 정본 표면 — 존재하는 것만 담긴다(삭제분은 키가 빠진다). */
    fun findSurfaces(poiIds: Collection<UUID>): Map<UUID, PoiSurfaceView>

    /**
     * 확정 시 동결된 표면(INV-U1-03) — 원본이 폐업·삭제돼도 유지된다.
     * 동결 범위는 이름·좌표·카테고리뿐이라 사진·영업시간은 담기지 않는다(poi_snapshot 스키마).
     */
    fun findFrozenSurfaces(poiSnapshotIds: Collection<UUID>): Map<UUID, FrozenPoiView>
}

/**
 * [openingHours] NULL = 미확인(허용). 값이 있어도 현재는 **자유형 원문 문자열**이라 기계 판정에 쓸 수 없다
 * — structured 스키마는 U6. [imageUrl] NULL = 미확보(기본 이미지를 지어내지 않는다, TRIP-219).
 */
data class PoiSurfaceView(
    val poiId: UUID,
    val nameKo: String,
    val lat: Double,
    val lng: Double,
    val category: String,
    val openingHours: String?,
    val imageUrl: String?,
    val tags: List<String>,
)

/** 동결 표면 — 확정 일정이 원본 변화에 흔들리지 않게 하는 값(INV-U1-03). */
data class FrozenPoiView(
    val poiSnapshotId: UUID,
    val sourcePoiId: UUID,
    val nameKo: String,
    val lat: Double,
    val lng: Double,
    val category: String,
)
