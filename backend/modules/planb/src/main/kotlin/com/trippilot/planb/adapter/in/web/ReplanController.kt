package com.trippilot.planb.adapter.`in`.web

import com.trippilot.core.error.AuthenticationRequired
import com.trippilot.planb.application.ReplanSessionService
import com.trippilot.planb.domain.ReplanMode
import com.trippilot.planb.domain.ReplanReason
import com.trippilot.planb.domain.ReplanSession
import com.trippilot.planb.domain.ReplanStatus
import jakarta.validation.constraints.NotNull
import org.springframework.http.HttpStatus
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.ResponseStatus
import org.springframework.web.bind.annotation.RestController
import java.security.Principal
import java.time.Instant
import java.util.UUID

/**
 * 재계획 진입·조회·취소(US-PLANB-01·12). 여행 하위 리소스이며 소유 스코프(타 계정 404).
 *
 * 세션 id 로 조회·취소하지만 **경로는 여행 아래**에 둔다 — 그래야 소유 검증이 한 곳에서 끝나고,
 * 세션 id 만 알면 남의 여행을 들여다볼 수 있는 구멍이 생기지 않는다.
 */
@RestController
@RequestMapping("/api/v1/trips/{tripId}/replan-sessions")
class ReplanController(private val service: ReplanSessionService) {

    /** 재계획 시작. 진행 중 세션이 있으면 409 + 그 세션 id(클라이언트가 이어가거나 취소 후 다시 연다). */
    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    fun start(
        principal: Principal,
        @PathVariable tripId: UUID,
        @RequestBody request: StartReplanRequest,
    ): ReplanSessionResponse =
        ReplanSessionResponse.from(
            service.start(principal.accountId(), tripId, request.reason, request.mode),
        )

    @GetMapping("/{replanSessionId}")
    fun get(
        principal: Principal,
        @PathVariable tripId: UUID,
        @PathVariable replanSessionId: UUID,
    ): ReplanSessionResponse =
        ReplanSessionResponse.from(service.get(principal.accountId(), tripId, replanSessionId))

    @PostMapping("/{replanSessionId}/cancel")
    fun cancel(
        principal: Principal,
        @PathVariable tripId: UUID,
        @PathVariable replanSessionId: UUID,
    ): ReplanSessionResponse =
        ReplanSessionResponse.from(service.cancel(principal.accountId(), tripId, replanSessionId))
}

/**
 * 재계획 시작 요청. 사유·방식 모두 필수 — 기본값을 두면 사용자가 고르지 않은 값이 대안 성격을 좌우한다.
 * "특별한 이유 없음"은 [ReplanReason.NONE] 으로 **명시**한다.
 */
data class StartReplanRequest(
    @field:NotNull(message = "재계획 사유는 필수입니다.") val reason: ReplanReason,
    @field:NotNull(message = "재계획 방식은 필수입니다.") val mode: ReplanMode,
)

data class ReplanSessionResponse(
    val replanSessionId: UUID,
    val tripId: UUID,
    val reason: ReplanReason,
    val mode: ReplanMode,
    val status: ReplanStatus,
    /** 대안이 0건인 이유. 닫힌 집합이며, 산출 전(LOADING)에는 항상 null 이다. */
    val emptyReason: String?,
    val createdAt: Instant,
    val updatedAt: Instant,
) {
    companion object {
        fun from(s: ReplanSession) = ReplanSessionResponse(
            s.replanSessionId, s.tripId, s.reason, s.mode, s.status,
            s.emptyReason?.name, s.createdAt, s.updatedAt,
        )
    }
}

/** 토큰 sub → 계정 id. UUID 가 아니면 인증 실패로 다룬다(형식 오류를 500 으로 흘리지 않는다). */
private fun Principal.accountId(): UUID =
    runCatching { UUID.fromString(name) }.getOrElse { throw AuthenticationRequired() }
