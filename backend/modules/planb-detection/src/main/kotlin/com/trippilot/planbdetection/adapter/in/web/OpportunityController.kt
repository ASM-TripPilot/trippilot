package com.trippilot.planbdetection.adapter.`in`.web

import com.trippilot.core.error.AuthenticationRequired
import com.trippilot.planbdetection.application.OpportunityService
import com.trippilot.planbdetection.domain.Opportunity
import com.trippilot.planbdetection.domain.OpportunityEventType
import com.trippilot.planbdetection.domain.OpportunityKind
import org.springframework.format.annotation.DateTimeFormat
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController
import java.security.Principal
import java.time.LocalDate
import java.util.UUID

/**
 * 기회 카드 조회(i01 허브 · situation-awareness BR-SA-22 · frontend-components §4·§9).
 *
 * 앱은 **보고 있는 날짜만** 보낸다 — 자격(여행 중·남은 날·범위)과 재료(남은 슬롯·계획 장소)는 서버가 정한다.
 * 꺼짐·범위 밖·없음·AI 실패는 200 빈 목록이고 404 는 소유 아님뿐이다. 트리거·알림이 아니라 상태를 쓰지 않는다.
 */
@RestController
@RequestMapping("/api/v1/trips/{tripId}/opportunities")
class OpportunityController(private val service: OpportunityService) {

    @GetMapping
    fun list(
        principal: Principal,
        @PathVariable tripId: UUID,
        @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) date: LocalDate,
    ): OpportunityListResponse =
        OpportunityListResponse(service.list(principal.accountId(), tripId, date).map { OpportunityResponse.from(it) })
}

data class OpportunityListResponse(val items: List<OpportunityResponse>)

/** 기회 한 건 — 시각 필드가 없다(INV-2). 문장은 앱의 고정 템플릿이 만든다(서버는 재료만). */
data class OpportunityResponse(
    val key: String,
    val kind: OpportunityKind,
    val eventName: String?,
    val eventType: OpportunityEventType?,
    val start: LocalDate?,
    val end: LocalDate?,
    val poiId: UUID,
    val poiName: String,
    val nearSlotKey: String,
    val distanceLabel: String,
) {
    companion object {
        fun from(o: Opportunity) = OpportunityResponse(
            o.key, o.kind, o.eventName, o.eventType, o.start, o.end, o.poiId, o.poiName, o.nearSlotKey, o.distanceLabel,
        )
    }
}

/** 토큰 sub → 계정 id. UUID 가 아니면 인증 실패로 다룬다(형식 오류를 500 으로 흘리지 않는다). */
private fun Principal.accountId(): UUID =
    runCatching { UUID.fromString(name) }.getOrElse { throw AuthenticationRequired() }
