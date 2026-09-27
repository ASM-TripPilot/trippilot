package com.trippilot.affiliatelink.adapter.`in`.web

import com.trippilot.affiliatelink.application.OutboundService
import com.trippilot.affiliatelink.domain.OutboundQuery
import com.trippilot.core.error.AuthenticationRequired
import org.springframework.format.annotation.DateTimeFormat
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController
import java.net.URI
import java.security.Principal
import java.time.LocalDate
import java.util.UUID

/**
 * 아웃바운드 — `GET /api/v1/stays/{stayId}/outbound` (칸 1).
 *
 * 클릭을 적고 302 로 튕긴다. 브라우저가 따라가므로 사용자 체감은 직행과 같고,
 * 목적지 교체(웹검색 → OTA 딥링크)는 앱 배포 없이 서버 변경만으로 된다.
 * 응답에 Location 외 아무것도 싣지 않는다 — 클릭·전환 지표는 내부 전용(BR-U1-32).
 *
 * **인증은 선택이다**(SecurityConfig permitAll + bootstrap 선례). 브라우저·커스텀탭이 여는
 * 경로라 Authorization 을 실을 수 없다 — 익명이면 [Principal] 이 null 로 온다(익명 인증은
 * getUserPrincipal 에서 걸러진다). 토큰이 있으면 계정이 클릭에 남는다.
 *
 * 기저 경로가 accommodation-search 의 컨트롤러들과 같지만 세그먼트 수가 달라
 * (`/{stayId}/outbound` 2단) 리터럴 경로들(`/search`·`/geocode`)과 충돌하지 않는다.
 */
@RestController
@RequestMapping("/api/v1/stays")
class OutboundController(
    private val service: OutboundService,
) {
    @GetMapping("/{stayId}/outbound")
    fun outbound(
        principal: Principal?,
        @PathVariable stayId: String,
        @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) checkin: LocalDate?,
        @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) checkout: LocalDate?,
        @RequestParam(required = false) adults: Int?,
    ): ResponseEntity<Void> {
        val link = service.outbound(
            principal?.accountId(),
            stayId,
            OutboundQuery(checkIn = checkin, checkOut = checkout, adults = adults),
        )
        return ResponseEntity.status(HttpStatus.FOUND).location(URI.create(link.url)).build()
    }
}

/** 토큰 sub → 계정 id. UUID 가 아니면 인증 실패로 다룬다(형식 오류를 500 으로 흘리지 않는다). */
private fun Principal.accountId(): UUID =
    runCatching { UUID.fromString(name) }.getOrElse { throw AuthenticationRequired() }
