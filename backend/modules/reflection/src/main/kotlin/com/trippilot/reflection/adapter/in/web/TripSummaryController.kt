package com.trippilot.reflection.adapter.`in`.web

import com.trippilot.core.error.AuthenticationRequired
import com.trippilot.reflection.application.TripSummaryService
import com.trippilot.reflection.domain.DayHighlight
import com.trippilot.reflection.domain.TripSummary
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import java.security.Principal
import java.time.Instant
import java.time.LocalDate
import java.util.UUID

/**
 * 여행 요약(`j04`). 여행 하위 리소스. 소유 스코프(타 계정 404).
 *
 * **아직 없을 수 있다** — 요약은 여행이 끝나야 생긴다(BR-U5-39). 그때는 `ready=false` 로 알린다.
 * 404 로 두지 않는 이유는 `BR-U5-48` 이다: 화면이 **공유 진입점을 비활성화**해야 하는데,
 * 404 는 "없다"와 "타 계정"을 구분하지 못해 그 판단의 근거가 되지 못한다.
 */
@RestController
@RequestMapping("/api/v1/trips/{tripId}/summary")
class TripSummaryController(private val service: TripSummaryService) {

    @GetMapping
    fun get(principal: Principal, @PathVariable tripId: UUID): TripSummaryResponse {
        val summary = service.find(principal.accountId(), tripId)
        return TripSummaryResponse(ready = summary != null, summary = summary?.let { TripSummaryBody.from(it) })
    }
}

/** 토큰 sub → 계정 id. UUID 가 아니면 인증 실패로 다룬다(형식 오류를 500 으로 흘리지 않는다). */
private fun Principal.accountId(): UUID =
    runCatching { UUID.fromString(name) }.getOrElse { throw AuthenticationRequired() }

/**
 * @property ready 요약이 만들어졌는가. false 면 여행이 아직 안 끝났거나 요약 생성이 밀린 것이다 —
 *   화면은 **공유 진입점을 비활성화**한다(BR-U5-48).
 */
data class TripSummaryResponse(val ready: Boolean, val summary: TripSummaryBody?)

data class TripSummaryBody(
    val narrative: String,
    val highlights: List<DayHighlightResponse>,
    val stats: TripSummaryStatsResponse,
    val source: String,
    val generatedAt: Instant,
) {
    companion object {
        fun from(s: TripSummary) = TripSummaryBody(
            s.narrative,
            s.highlights.map { it.toResponse() },
            TripSummaryStatsResponse(
                s.stats.totalVisits, s.stats.totalDistanceKm, s.stats.distanceSource.name,
                s.stats.totalPhotos, s.stats.hasLocationData,
            ),
            s.source.name,
            s.generatedAt,
        )

        private fun DayHighlight.toResponse() = DayHighlightResponse(date, dayOrder, visitCount, places)
    }
}

data class DayHighlightResponse(
    val date: LocalDate,
    val dayOrder: Int,
    val visitCount: Int,
    val places: List<String>,
)

/**
 * 여행 전체 수치. **소요시간 필드가 없다**(INV-3 · PBT-U5-5) — 거리만.
 *
 * @property hasLocationData false 면 좌표를 하나도 못 찾았다는 뜻이다 — 화면은 **지도 대신 방문 목록**을
 *   그린다(BR-U5-39). 빈 지도를 띄우면 사용자는 기록이 없는 줄 안다.
 */
data class TripSummaryStatsResponse(
    val totalVisits: Int,
    val totalDistanceKm: Double,
    val distanceSource: String,
    val totalPhotos: Int,
    val hasLocationData: Boolean,
)
