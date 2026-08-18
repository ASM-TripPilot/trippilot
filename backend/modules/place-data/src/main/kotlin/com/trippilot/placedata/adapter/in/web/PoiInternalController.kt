package com.trippilot.placedata.adapter.`in`.web

import com.fasterxml.jackson.databind.PropertyNamingStrategies
import com.fasterxml.jackson.databind.annotation.JsonNaming
import com.trippilot.core.error.FieldError
import com.trippilot.core.error.ValidationFailed
import com.trippilot.placedata.application.PoiProposalIngestService
import com.trippilot.placedata.application.PoiReadService
import com.trippilot.placedata.application.PoiWithDistance
import com.trippilot.placedata.application.isDataFull
import com.trippilot.placedata.domain.Poi
import com.trippilot.placedata.domain.PoiCategory
import com.trippilot.placedata.domain.PoiSource
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
    private val ingestService: PoiProposalIngestService,
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

    /**
     * 수집 등록 제안 수신 — AI 산출 `collected_pois.json` 을 **그대로** 태운다.
     *
     * 상대가 자기 게이트를 통과시킨 것이라도 **우리 게이트를 다시 태운다**(INV-1 소유는 C7).
     * 같은 문서를 몇 번 넣어도 행이 늘지 않는다 — `(source, content_id)` 로 갱신한다.
     *
     * 응답의 `dropped` 는 **사유별 집계**다. 총계만 주면 수집 쪽이 무엇을 고쳐야 할지 알 수 없다(INV-4).
     */
    @PostMapping("/proposals")
    fun ingestProposals(@RequestBody document: PoiProposalDocument): PoiIngestResponse =
        PoiIngestResponse.from(
            ingestService.ingest(
                // 문서가 밝힌 출처를 그대로 쓰되, 모르는 값이면 400 으로 막는다 — 임의로 TOURAPI 라 가정하면
                // 다른 벤더 수집분이 통째로 잘못된 출처로 저장되고, 멱등 키가 벤더를 넘어 충돌한다.
                source = parseSource(document.source),
                proposals = document.proposals.map { it.toCommand() },
            ),
        )

    private fun parseSource(raw: String?): PoiSource =
        PoiSource.entries.firstOrNull { it.name == raw }
            ?: throw ValidationFailed(listOf(FieldError("source", "알 수 없는 출처입니다: $raw")))
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
                category = p.category.boundaryCode,
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

    }
}
