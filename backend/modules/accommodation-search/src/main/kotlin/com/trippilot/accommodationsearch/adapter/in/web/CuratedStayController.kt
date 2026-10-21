package com.trippilot.accommodationsearch.adapter.`in`.web

import com.trippilot.accommodationsearch.domain.CuratedStay
import com.trippilot.accommodationsearch.domain.CuratedStayPort
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController

/**
 * 도시별 큐레이션 숙소 — `GET /api/v1/stays/curated?city=서울`.
 *
 * 각 항목의 `stayId`(`"TRIPCOM:{hotelId}"`)를 그대로 `GET /stays/{stayId}/outbound` 에 넘기면
 * 트립닷컴 호텔 상세로 간다. 상세(`GET /stays/{stayId}`)는 이 출처를 모른다(404) — 목록이 곧 카드다.
 *
 * ⚠ 제휴 계약 3.2.2·3.2.4 는 이미지·목록 표시에 트립닷컴 **사전 서면 승인**을 요구한다(근거는 curated_stay
 * 마이그레이션 주석). 회신을 기다리지 않고 화면에 띄우기로 했다(2026-10-21 제품 결정) — 막으라는 통보가 오면
 * 반복 시드를 비워 목록을 내린다.
 *
 * 리터럴 `/curated` 는 `/{stayId}` 템플릿보다 구체적이라 Spring 이 먼저 고른다(API 테스트가 못 박는다).
 */
@RestController
@RequestMapping("/api/v1/stays")
class CuratedStayController(
    private val curated: CuratedStayPort,
) {
    @GetMapping("/curated")
    fun curated(@RequestParam city: String): CuratedStayListResponse =
        CuratedStayListResponse(city, curated.byCity(city).map { CuratedStayResponse.from(it) })
}

data class CuratedStayListResponse(val city: String, val items: List<CuratedStayResponse>)

/** 평점·가격 필드가 없는 것은 의도다(BR-U1-18 · INV-U1-05) — 화면은 OTA 페이지에서 보게 한다. */
data class CuratedStayResponse(
    val rank: Int,
    val stayId: String,
    val name: String,
    val address: String?,
    val imageUrl: String,
) {
    companion object {
        fun from(c: CuratedStay) = CuratedStayResponse(
            rank = c.rank,
            stayId = "${c.key().externalSource}:${c.key().externalId}",
            name = c.name,
            address = c.address,
            imageUrl = c.imageUrl,
        )
    }
}
