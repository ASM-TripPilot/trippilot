package com.trippilot.planb.adapter.`in`.web

import com.trippilot.core.error.AuthenticationRequired
import com.trippilot.planb.application.TriggerService
import com.trippilot.planb.domain.TriggerEvent
import com.trippilot.planb.domain.TriggerStatus
import com.trippilot.planb.domain.TriggerType
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import java.security.Principal
import java.time.Instant
import java.util.UUID

/**
 * 감지된 변화 목록·닫기(i08·i09).
 *
 * 정본(`전체-API-서피스.md`)은 닫기를 최상위 `/triggers/{id}/dismiss` 로 적었지만 **여행 아래로 중첩**했다 —
 * 그래야 소유 검증이 한 곳에서 끝나고, id 만 알면 남의 여행 알림을 닫는 구멍이 생기지 않는다.
 * 같은 이유로 재계획 세션도 중첩돼 있다(TRIP-273). 정본 표기는 이 PR 에서 함께 고쳤다.
 */
@RestController
@RequestMapping("/api/v1/trips/{tripId}/triggers")
class TriggerController(private val service: TriggerService) {

    @GetMapping
    fun list(principal: Principal, @PathVariable tripId: UUID): TriggerListResponse =
        TriggerListResponse(service.list(principal.accountId(), tripId).map { TriggerResponse.from(it) })

    /** "그대로 둘게요" — 이후 같은 사유·같은 방문지로는 다시 알리지 않는다. */
    @PostMapping("/{triggerEventId}/dismiss")
    fun dismiss(
        principal: Principal,
        @PathVariable tripId: UUID,
        @PathVariable triggerEventId: UUID,
    ): TriggerResponse =
        TriggerResponse.from(service.dismiss(principal.accountId(), tripId, triggerEventId))
}

data class TriggerListResponse(val triggers: List<TriggerResponse>)

data class TriggerResponse(
    val triggerEventId: UUID,
    val type: TriggerType,
    /** null = 일정 전체에 대한 신호(예: 광역 특보). */
    val targetSlotId: UUID?,
    val value: String,
    val status: TriggerStatus,
    val detectedAt: Instant,
) {
    companion object {
        fun from(e: TriggerEvent) =
            TriggerResponse(e.triggerEventId, e.type, e.targetSlotId, e.value, e.status, e.detectedAt)
    }
}

/** 토큰 sub → 계정 id. UUID 가 아니면 인증 실패로 다룬다(형식 오류를 500 으로 흘리지 않는다). */
private fun Principal.accountId(): UUID =
    runCatching { UUID.fromString(name) }.getOrElse { throw AuthenticationRequired() }
