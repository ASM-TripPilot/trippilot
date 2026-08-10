package com.trippilot.recalculation.adapter.`in`.web

import com.trippilot.core.error.AuthenticationRequired
import com.trippilot.core.error.FieldError
import com.trippilot.core.error.ValidationFailed
import com.trippilot.recalculation.application.ReplanSessionService
import com.trippilot.recalculation.application.StartReplan
import com.trippilot.recalculation.domain.OriginKind
import com.trippilot.recalculation.domain.ReplanOrigin
import com.trippilot.recalculation.domain.ReplanScope
import com.trippilot.recalculation.domain.ReplanSession
import com.trippilot.recalculation.domain.ReplanStatus
import jakarta.validation.Valid
import jakarta.validation.constraints.NotNull
import jakarta.validation.constraints.Size
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
 * 재계획 세션 진입·조회·취소(`i10`·`i18`).
 *
 * 세션 id 가 전역 유일해도 **여행 아래로 중첩**한다 — 소유 검증이 한 곳에서 끝나고, id 만 알면
 * 남의 여행을 건드리는 구멍이 안 생긴다. 정본 API 서피스 표기도 이에 맞춰 정정했다.
 */
@RestController
@RequestMapping("/api/v1/trips/{tripId}/replan-sessions")
class ReplanController(private val service: ReplanSessionService) {

    /** 진입. 이미 열린 세션이 있으면 **그것을 취소하고** 새로 연다(INV-U4-06) — 막지 않는다. */
    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    fun start(
        principal: Principal,
        @PathVariable tripId: UUID,
        @Valid @RequestBody request: StartReplanRequest,
    ): ReplanSessionResponse =
        ReplanSessionResponse.from(service.start(principal.accountId(), tripId, request.toCommand()))

    @GetMapping("/{sessionId}")
    fun get(
        principal: Principal,
        @PathVariable tripId: UUID,
        @PathVariable sessionId: UUID,
    ): ReplanSessionResponse =
        ReplanSessionResponse.from(service.get(principal.accountId(), tripId, sessionId))

    /** `i18` [취소] — 세션만 닫는다. 원 일정은 그대로다(INV-U4-05). */
    @PostMapping("/{sessionId}/cancel")
    fun cancel(
        principal: Principal,
        @PathVariable tripId: UUID,
        @PathVariable sessionId: UUID,
    ): ReplanSessionResponse =
        ReplanSessionResponse.from(service.cancel(principal.accountId(), tripId, sessionId))
}

/**
 * 진입 요청(`i10`). '왜'·'어떻게'는 **다중 선택**이며 서버가 어휘를 강제하지 않는다 —
 * 화면이 고른 값을 그대로 싣고, 해석은 재계획 경계(AI)가 한다.
 */
data class StartReplanRequest(
    @field:NotNull(message = "재계획 범위는 필수입니다.") val scope: ReplanScope?,
    /** 생략하면 서버가 사다리로 정한다(BR-U4-19) — 위치를 못 잡았다고 재계획을 막지 않는다. */
    val originKind: OriginKind? = null,
    val originLat: Double? = null,
    val originLng: Double? = null,
    @field:Size(max = 10, message = "사유는 10개까지 선택할 수 있습니다.") val reasons: List<String> = emptyList(),
    @field:Size(max = 10, message = "요청은 10개까지 선택할 수 있습니다.") val directives: List<String> = emptyList(),
    @field:Size(max = 500, message = "자유 입력은 500자까지 가능합니다.") val freeText: String? = null,
    val excludedPoiIds: List<UUID> = emptyList(),
    val triggerId: UUID? = null,
) {
    fun toCommand(): StartReplan {
        // 좌표 요건은 도메인이 강제하지만, 그대로 두면 IllegalArgumentException 이 500 으로 나간다.
        // 사용자가 고칠 수 있는 입력이므로 400 으로 돌린다.
        if (originKind in COORD_REQUIRED && (originLat == null || originLng == null)) {
            throw ValidationFailed(
                listOf(FieldError("originLat", "$originKind 기준점에는 좌표(originLat·originLng)가 필요합니다.")),
            )
        }
        return StartReplan(
            scope = scope!!,
            origin = originKind?.let { ReplanOrigin(it, originLat, originLng) },
            reasons = reasons,
            directives = directives,
            freeText = freeText,
            excludedPoiIds = excludedPoiIds,
            triggerId = triggerId,
        )
    }

    private companion object {
        private val COORD_REQUIRED = setOf(OriginKind.GPS, OriginKind.MANUAL)
    }
}

data class ReplanSessionResponse(
    val sessionId: UUID,
    val tripId: UUID,
    val itineraryId: UUID,
    val triggerId: UUID?,
    val scope: ReplanScope,
    val fromInstant: Instant,
    val originKind: OriginKind,
    val originLat: Double?,
    val originLng: Double?,
    /** GPS 가 아니면 추정 출발지다 — 화면이 그 사실을 밝혀야 한다(US-PLANB-10). */
    val originEstimated: Boolean,
    val reasons: List<String>,
    val directives: List<String>,
    val freeText: String?,
    val excludedPoiIds: List<UUID>,
    val status: ReplanStatus,
    val createdAt: Instant,
    val closedAt: Instant?,
) {
    companion object {
        fun from(s: ReplanSession) = ReplanSessionResponse(
            s.sessionId, s.tripId, s.itineraryId, s.triggerId, s.scope, s.fromInstant,
            s.origin.kind, s.origin.lat, s.origin.lng, s.origin.isEstimated,
            s.reasons, s.directives, s.freeText, s.excludedPoiIds,
            s.status, s.createdAt, s.closedAt,
        )
    }
}

/** 토큰 sub → 계정 id. UUID 가 아니면 인증 실패로 다룬다(형식 오류를 500 으로 흘리지 않는다). */
private fun Principal.accountId(): UUID =
    runCatching { UUID.fromString(name) }.getOrElse { throw AuthenticationRequired() }
