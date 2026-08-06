package com.trippilot.placedata.adapter.`in`.web

import com.fasterxml.jackson.databind.PropertyNamingStrategies
import com.fasterxml.jackson.databind.annotation.JsonNaming
import com.trippilot.placedata.application.PoiReadService
import com.trippilot.placedata.application.PoiWithDistance
import com.trippilot.placedata.application.isDataFull
import com.trippilot.placedata.domain.Poi
import com.trippilot.placedata.domain.PoiCategory
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController
import java.util.UUID

/**
 * 리버스 POI 정본 read 포트(BE-5) — AI 서비스(M7)가 후보풀 빌드용으로 백엔드 정본을 읽는 경계.
 * 인증 필요(공개 아님, SecurityConfig anyRequest().authenticated()) — 전용 서비스-auth 는 후속.
 * 응답은 snake_case(AI 경계 규약). ACTIVE만·closed-set(INV-1). structured 영업시간·폐업체크는 후속.
 */
@RestController
@RequestMapping("/internal/pois")
class PoiInternalController(
    private val readService: PoiReadService,
) {
    /** 반경(km) 내 ACTIVE 정본 — 합성 정렬키 적용. */
    @GetMapping
    fun byRadius(
        @RequestParam centerLat: Double,
        @RequestParam centerLng: Double,
        @RequestParam radiusKm: Double,
    ): List<PoiReadResponse> = readService.findByRadius(centerLat, centerLng, radiusKm).map { PoiReadResponse.from(it) }

    /** id 배치 → ACTIVE 정본(미확인·폐업 제외). */
    @PostMapping("/batch-get")
    fun batchGet(@RequestBody request: BatchGetRequest): List<PoiReadResponse> =
        readService.batchGet(request.poiIds).map { PoiReadResponse.from(it) }
}

/** 배치 조회 요청 — poi_ids. */
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy::class)
data class BatchGetRequest(val poiIds: List<UUID>)

/**
 * POI 정본 응답(snake_case). category=경계 코드, data_quality=완전성 파생(FULL/PARTIAL). 소요시간 없음(INV-3).
 */
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy::class)
data class PoiReadResponse(
    val poiId: UUID,
    val nameKo: String,
    val category: String,        // 경계 코드(SIGHT/FOOD/…)
    val lat: Double,
    val lng: Double,
    val region: String?,
    val openingHours: String?,   // 원문(structured 는 후속)
    val dataStatus: String,      // ACTIVE(현재 read 는 ACTIVE만)
    val source: String,          // KAKAO_LOCAL/TOURAPI/MANUAL
    val savedCount: Long,
    val dataQuality: String,     // FULL/PARTIAL
    val distanceM: Double?,      // 반경 조회 시 중심 거리(INV-3: 거리 OK)
) {
    companion object {
        fun from(pd: PoiWithDistance): PoiReadResponse {
            val p = pd.poi
            return PoiReadResponse(
                poiId = p.poiId,
                nameKo = p.nameKo,
                category = p.category.boundaryCode(),
                lat = p.lat,
                lng = p.lng,
                region = p.region,
                openingHours = p.openingHours,
                dataStatus = p.dataStatus.name,
                source = p.source.name,
                savedCount = p.savedCount,
                dataQuality = if (p.isDataFull()) "FULL" else "PARTIAL",
                distanceM = pd.distanceM,
            )
        }

        /** 한글 카테고리 → AI 경계 코드(계약 BE-5 매핑표). 1:1, 전 값 커버. */
        private fun PoiCategory.boundaryCode(): String = when (this) {
            PoiCategory.명소 -> "SIGHT"
            PoiCategory.맛집 -> "FOOD"
            PoiCategory.카페 -> "CAFE"
            PoiCategory.야경 -> "NIGHT_VIEW"
            PoiCategory.자연 -> "NATURE"
            PoiCategory.쇼핑 -> "SHOPPING"
            PoiCategory.문화 -> "CULTURE"
            PoiCategory.액티비티 -> "ACTIVITY"
        }
    }
}
