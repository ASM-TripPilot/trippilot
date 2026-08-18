package com.trippilot.placedata.adapter.`in`.web

import com.fasterxml.jackson.annotation.JsonIgnoreProperties
import com.fasterxml.jackson.annotation.JsonProperty
import com.trippilot.placedata.application.PoiIngestResult
import com.trippilot.placedata.application.PoiProposal
import com.trippilot.placedata.domain.PoiCategory

/**
 * AI 수집 산출물(`collected_pois.json`) 그대로의 모양. **필드 이름을 우리 편의로 바꾸지 않는다** —
 * 상대가 파일로 떨구는 문서를 그대로 태워야 사람이 손으로 옮기는 단계가 생기지 않는다.
 *
 * 도출 근거: `ai/src/trippilot/poi_curation/sourcing/pipeline.py` 의 `to_output_document` /
 * `to_multi_output_document`(schema_version 1). 상대가 스키마를 올리면 [schemaVersion] 로 드러난다.
 *
 * 통계(`stats`)·수집 범위(`area_code` 등)는 **받되 쓰지 않는다** — 우리 판정에 필요 없고,
 * 없다고 거절하면 문서 형태가 조금만 바뀌어도 수신이 막힌다.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
data class PoiProposalDocument(
    @param:JsonProperty("schema_version") val schemaVersion: Int? = null,
    val source: String? = null,
    val proposals: List<ProposalItem> = emptyList(),
)

@JsonIgnoreProperties(ignoreUnknown = true)
data class ProposalItem(
    val poi: ProposalPoi? = null,
    val tags: List<String> = emptyList(),
    val region: String? = null,
    @param:JsonProperty("opening_hours_raw") val openingHoursRaw: String? = null,
    val provenance: ProposalProvenance? = null,
)

/** `Poi.to_dict()` 왕복 스키마 중 **우리가 쓰는 것만**. 나머지(avg_cost·rating 등)는 무시한다. */
@JsonIgnoreProperties(ignoreUnknown = true)
data class ProposalPoi(
    val name: String? = null,
    /** AI 경계 코드(SIGHT/FOOD/…). 우리 8종에 없으면 탈락한다 — 임의 매핑하지 않는다. */
    val category: String? = null,
    val coord: ProposalCoord? = null,
)

@JsonIgnoreProperties(ignoreUnknown = true)
data class ProposalCoord(val lat: Double? = null, val lng: Double? = null)

/**
 * `content_id` 가 멱등 키다 — 이게 없으면 재수집이 같은 행을 찾지 못한다.
 *
 * **`image_url` 은 일부러 받지 않는다.** 문서에는 들어 있지만(실측 1,043/1,104), 벤더 이미지를
 * 우리 화면에 거는 것은 **라이선스·핫링크 정책**이 걸린 문제이고 리포가 그 판단을 실 벤더 어댑터
 * 티켓으로 이연해 뒀다(`R__seed_stub_pois.sql` 주석 · TRIP-219). 정책이 정해지면 여기에 칸을 연다 —
 * 그때까지는 받지 않는 편이 낫다. 받아 두면 어딘가에서 새어 나가 표시되기 시작한다.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
data class ProposalProvenance(
    @param:JsonProperty("content_id") val contentId: String? = null,
)

/** 수신 결과 — 탈락은 **사유별**로 나간다(총계만 주면 무엇을 고쳐야 할지 알 수 없다). */
data class PoiIngestResponse(
    val received: Int,
    val registered: Int,
    val updated: Int,
    val dropped: Map<String, Int>,
) {
    companion object {
        fun from(r: PoiIngestResult) = PoiIngestResponse(r.received, r.registered, r.updated, r.dropped)
    }
}

/** 문서 → 응용 계층 명령. 어휘 변환(경계 코드 → 정본 카테고리)은 여기서 끝난다. */
fun ProposalItem.toCommand() = PoiProposal(
    nameKo = poi?.name.orEmpty(),
    lat = poi?.coord?.lat,
    lng = poi?.coord?.lng,
    category = PoiCategory.fromBoundaryCode(poi?.category),
    // 상대는 지역을 별도 칸으로 준다(addr1 에서 추출, 실패 시 null). 좌표에서 역산하지 않는다.
    region = region,
    // 영업시간은 **원문**을 저장한다 — 파싱본만 받으면 원문이 소실된다(상대 주석의 명시 사항).
    openingHours = openingHoursRaw,
    sourceRef = provenance?.contentId,
    tags = tags,
)
