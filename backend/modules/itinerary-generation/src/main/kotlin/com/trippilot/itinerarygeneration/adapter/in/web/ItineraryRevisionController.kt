package com.trippilot.itinerarygeneration.adapter.`in`.web

import com.trippilot.itinerarygeneration.application.ItineraryRevisionService
import com.trippilot.itinerarygeneration.application.SlotSurfaceAssembler
import com.trippilot.itinerarygeneration.domain.ItineraryRevisionSummary
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController
import java.security.Principal
import java.time.Instant
import java.util.UUID

/**
 * 일정 편집 이력·되돌리기(TRIP-310 · h36). 여행 하위 리소스, 소유 스코프(타 계정 404).
 * 목록은 최신순 — `seq` 가 클수록 최근이다.
 */
@RestController
@RequestMapping("/api/v1/trips/{tripId}/itinerary/revisions")
class ItineraryRevisionController(
    private val service: ItineraryRevisionService,
    private val surfaces: SlotSurfaceAssembler,
) {
    @GetMapping
    fun list(
        principal: Principal,
        @PathVariable tripId: UUID,
        @RequestParam(required = false, defaultValue = "${ItineraryRevisionService.DEFAULT_LIMIT}") limit: Int,
    ): RevisionListResponse =
        RevisionListResponse(service.list(principal.accountId(), tripId, limit).map { RevisionResponse.from(it) })

    /** 되돌리기 — 과거 리비전을 지우지 않고 새 리비전을 쌓는다(BR-U3-32). 확정·생성 중 일정은 409. */
    @PostMapping("/{revisionId}/restore")
    fun restore(
        principal: Principal,
        @PathVariable tripId: UUID,
        @PathVariable revisionId: UUID,
    ): ItineraryResponse {
        val restored = service.restore(principal.accountId(), tripId, revisionId)
        return ItineraryResponse.from(restored, surfaces.assemble(restored))
    }
}

data class RevisionListResponse(val revisions: List<RevisionResponse>)

/**
 * 되돌리기 지점 1건. [snapshot] 은 응답에 싣지 않는다 — 목록 화면은 문구·주체·시각만 쓰고,
 * 스냅숏 전체를 매 항목마다 실어 보내면 응답이 커진다(되돌리기는 서버가 수행한다).
 */
data class RevisionResponse(
    val revisionId: UUID,
    val seq: Int,
    val actor: String,
    val kind: String,
    val summary: String,
    val detail: String?,
    val createdAt: Instant,
) {
    companion object {
        fun from(r: ItineraryRevisionSummary) =
            RevisionResponse(r.revisionId, r.seq, r.actor.name, r.kind.name, r.summary, r.detail, r.createdAt)
    }
}
