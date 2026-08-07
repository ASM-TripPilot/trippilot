package com.trippilot.placedata.application

import com.trippilot.core.error.FieldError
import com.trippilot.core.error.ValidationFailed
import com.trippilot.placedata.domain.BoundingBox
import com.trippilot.placedata.domain.Haversine
import com.trippilot.placedata.domain.Poi
import com.trippilot.placedata.domain.PoiRepository
import org.springframework.stereotype.Service
import java.util.UUID

/** 조회 결과 — POI 정본 + 반경 조회 시 중심 거리(m). 배치 조회는 distanceM=null. */
data class PoiWithDistance(val poi: Poi, val distanceM: Double?)

/**
 * 리버스 POI 정본 read(C7 · BE-5) — AI(M7)가 후보풀을 빌드하려고 백엔드 정본을 읽는 경계용 조회.
 * **ACTIVE만**(INV-U1-01), closed-set(INV-1). 카테고리 경계코드 매핑은 web 경계, dataQuality 파생은 도메인.
 * 콜드스타트 합성 정렬키(반경 조회): savedCount↓ → dataQuality(FULL>PARTIAL>MINIMAL)↓ → 거점거리↑ → poiId↑.
 * (structured 영업시간·폐업체크는 스키마상 후속 — openingHours 는 원문 문자열.)
 */
@Service
class PoiReadService(
    private val repo: PoiRepository,
) {
    /** 주어진 id 중 ACTIVE만 정본 반환(미확인·폐업 제외). 배치 크기 상한(오남용·부하 차단). */
    fun batchGet(poiIds: List<UUID>): List<PoiWithDistance> {
        if (poiIds.size > MAX_BATCH_SIZE) {
            throw ValidationFailed(listOf(FieldError("poiIds", "한 번에 최대 ${MAX_BATCH_SIZE}개까지 조회할 수 있습니다.")))
        }
        return repo.findActiveByIds(poiIds).map { PoiWithDistance(it, null) }
    }

    /** 반경(km) 내 ACTIVE 정본. bounding-box 프리필터(DB) → 하버사인 정밀 컷 → 합성 정렬. */
    fun findByRadius(centerLat: Double, centerLng: Double, radiusKm: Double): List<PoiWithDistance> {
        validate(centerLat, centerLng, radiusKm)
        val radiusM = radiusKm * 1000
        val box = BoundingBox.around(centerLat, centerLng, radiusM)
        return repo.findActiveInBounds(box.latMin, box.latMax, box.lngMin, box.lngMax)
            .mapNotNull { poi ->
                val d = Haversine.meters(centerLat, centerLng, poi.lat, poi.lng)
                if (d <= radiusM) PoiWithDistance(poi, d) else null // 반경 밖 배제(INV-1)
            }
            .sortedWith(
                compareByDescending<PoiWithDistance> { it.poi.savedCount }
                    .thenBy { it.poi.dataQuality() }                  // FULL > PARTIAL > MINIMAL(선언 순서)
                    .thenBy { it.distanceM }                          // 거점거리 ↑
                    .thenBy { it.poi.poiId },                         // 결정론 tie-break
            )
    }

    /** 좌표 범위·반경 상한 검증(잘못된 입력 → 400, DOS 차단). */
    private fun validate(centerLat: Double, centerLng: Double, radiusKm: Double) {
        val errors = buildList {
            if (centerLat !in -90.0..90.0) add(FieldError("centerLat", "위도는 -90~90 이어야 합니다."))
            if (centerLng !in -180.0..180.0) add(FieldError("centerLng", "경도는 -180~180 이어야 합니다."))
            // 양수형 검사(NaN 도 걸러짐 — NaN 비교는 모두 false 라 부정형이면 우회됨).
            if (!(radiusKm > 0.0 && radiusKm <= MAX_RADIUS_KM)) add(FieldError("radiusKm", "반경은 0 초과 ${MAX_RADIUS_KM}km 이하여야 합니다."))
        }
        if (errors.isNotEmpty()) throw ValidationFailed(errors)
    }

    companion object {
        private const val MAX_RADIUS_KM = 50.0   // 후보풀 탐색 반경 상한(전 DB 스캔 차단)
        private const val MAX_BATCH_SIZE = 200   // 배치 조회 상한
    }
}
