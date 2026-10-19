package com.trippilot.planbdetection.adapter.out.external

import com.trippilot.planbdetection.domain.Opportunity
import com.trippilot.planbdetection.domain.OpportunityKind
import com.trippilot.planbdetection.domain.OpportunityPort
import com.trippilot.planbdetection.domain.OpportunityQuery
import com.trippilot.planbdetection.domain.OpportunityReply
import org.springframework.http.MediaType
import org.springframework.web.client.RestClient
import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.util.UUID

/**
 * 기회 경계 실 어댑터 — `POST /ai/v1/planb/opportunities`(situation-awareness BR-SA-22 · LLM 0회).
 *
 * 실패를 삼키지 않는다 — HTTP 오류·시간 초과·읽지 못하는 본문·모르는 종류·UUID 아닌 장소는 전부 예외로 올라가고,
 * 빈 목록으로 접는 것은 서비스다(RES-SA-09). 여기서 빈 답으로 바꾸면 "상대가 없다고 했다"와 "상대에 닿지 못했다"가
 * 로그에서 갈리지 않는다. 상대의 재료 실패(행사 미배선·장소 조회 실패·시한)는 200 + `notes` 라 그대로 넘긴다.
 */
class HttpOpportunityAdapter(
    private val client: RestClient,
    private val properties: OpportunityProperties,
    private val clock: Clock,
) : OpportunityPort {

    override fun find(query: OpportunityQuery): OpportunityReply {
        val body = AiOpportunitiesRequest(
            date = query.date,
            slots = query.slots.map { AiOpportunitySlot(it.slotKey, it.poiId.toString(), AiOpportunityCoord(it.lat, it.lng)) },
            plannedPoiIds = query.plannedPoiIds.map { it.toString() },
            requestMeta = AiOpportunityRequestMeta(UUID.randomUUID().toString(), clock.instant(), properties.deadlineMs),
        )
        val res = client.post().uri(PATH)
            .contentType(MediaType.APPLICATION_JSON)
            .body(body)
            .retrieve()
            .body(AiOpportunitiesResponse::class.java)
            ?: throw IllegalStateException("기회 경계가 빈 본문을 돌려줬다")
        return OpportunityReply(res.opportunities.map { it.toDomain() }, res.notes)
    }

    companion object {
        const val PATH = "/ai/v1/planb/opportunities"

        /**
         * 이 모듈이 부르는 상대 경로 전부 — **계약 게이트의 입력이다**(`OpportunityBoundaryOpenApiTest`).
         * 손으로 관리하는 목록을 테스트가 따로 들고 있으면 둘이 갈라진다(`HttpScheduleAgentAdapter.CALLED_PATHS` 선례).
         */
        val OPPORTUNITY_PATHS = listOf(PATH)
    }
}

// ── 와이어(snake_case 매퍼가 이름을 바꾼다) — 필드 이름이 곧 계약이다 ────────────────────────

internal data class AiOpportunitiesRequest(
    val date: LocalDate,
    val slots: List<AiOpportunitySlot>,
    val plannedPoiIds: List<String>,
    val requestMeta: AiOpportunityRequestMeta,
)

/** 남은 슬롯 하나 — 좌표는 **객체**다(계약 `CoordSchema`). 평평하게 보내면 422 다. */
internal data class AiOpportunitySlot(val slotKey: String, val poiId: String, val coord: AiOpportunityCoord)

internal data class AiOpportunityCoord(val lat: Double, val lng: Double)

internal data class AiOpportunityRequestMeta(val requestId: String, val requestedAt: Instant, val deadlineMs: Long)

/** 두 목록은 계약에서 선택이다(상대 기본값 `[]`) — 없으면 빈 것으로 읽는다. 항목 안의 필수 필드는 기본값이 없다. */
internal data class AiOpportunitiesResponse(
    val opportunities: List<AiOpportunity> = emptyList(),
    val notes: List<String> = emptyList(),
)

/** 기회 한 건. 시각 필드가 없다(INV-2 — 행사 원천이 일 단위). 거리는 표시 문자열뿐이다(INV-3). */
internal data class AiOpportunity(
    val key: String,
    val kind: String,
    val eventName: String? = null,
    val start: LocalDate? = null,
    val end: LocalDate? = null,
    val poiId: String,
    val poiName: String,
    val nearSlotKey: String,
    val distanceLabel: String,
) {
    /** 모르는 종류·UUID 아닌 장소는 예외 — 기본값으로 흡수하면 계약 드리프트가 정상 동작으로 위장된다. */
    fun toDomain() = Opportunity(
        key = key,
        kind = OpportunityKind.valueOf(kind),
        eventName = eventName,
        start = start,
        end = end,
        poiId = UUID.fromString(poiId),
        poiName = poiName,
        nearSlotKey = nearSlotKey,
        distanceLabel = distanceLabel,
    )
}
