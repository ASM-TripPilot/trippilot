package com.trippilot.itinerarygeneration.adapter.`in`.web

import com.trippilot.itinerarygeneration.application.GenerationSessionService
import com.trippilot.itinerarygeneration.domain.GenerationMode
import com.trippilot.itinerarygeneration.domain.GenerationSession
import com.trippilot.itinerarygeneration.domain.GenerationStatus
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import java.security.Principal
import java.time.Instant
import java.util.UUID

/**
 * 생성 진행 상태 폴링·취소(h09·h10 · BR-U3-04·05).
 *
 * 세션 id 가 전역 유일해도 **여행 아래로 중첩**한다 — 소유 검증이 한 곳에서 끝난다.
 *
 * `[백그라운드로]` 에 대응하는 오퍼레이션은 **없다**. 세션을 살린 채 화면만 이탈하는 것이라
 * 서버가 할 일이 없다(BR-U3-05) — 없는 것이 맞고, 만들면 클라이언트가 불필요한 호출을 한다.
 */
@RestController
@RequestMapping("/api/v1/trips/{tripId}/generation-sessions")
class GenerationSessionController(private val service: GenerationSessionService) {

    @GetMapping("/{sessionId}")
    fun get(
        principal: Principal,
        @PathVariable tripId: UUID,
        @PathVariable sessionId: UUID,
    ): GenerationSessionResponse =
        GenerationSessionResponse.from(service.get(principal.accountId(), tripId, sessionId))

    /** `h09` [취소] — 세션을 닫고 부분 결과를 버린다. */
    @PostMapping("/{sessionId}/cancel")
    fun cancel(
        principal: Principal,
        @PathVariable tripId: UUID,
        @PathVariable sessionId: UUID,
    ): GenerationSessionResponse =
        GenerationSessionResponse.from(service.cancel(principal.accountId(), tripId, sessionId))
}

/**
 * 진행 상태.
 *
 * **진행률(퍼센트)은 없다** — 계약에 그 값이 없고 지어내면 사용자가 남은 시간을 오판한다.
 * 화면은 [startedAt]·[day1ReadyAt] 으로 단계를 판단한다.
 */
data class GenerationSessionResponse(
    val sessionId: UUID,
    /** day1 확정 전에는 null. */
    val itineraryId: UUID?,
    val status: GenerationStatus,
    val mode: GenerationMode,
    /** 폴백 배너의 근거(BR-U3-11 · INV-4) — 첫 노출 시점부터 사실을 말하게 한다. */
    val isFallback: Boolean,
    val candidatesLevel: String?,
    val startedAt: Instant,
    val day1ReadyAt: Instant?,
    val finishedAt: Instant?,
) {
    companion object {
        fun from(s: GenerationSession) = GenerationSessionResponse(
            s.sessionId, s.itineraryId, s.status, s.mode,
            s.isFallback, s.candidatesLevel, s.startedAt, s.day1ReadyAt, s.finishedAt,
        )
    }
}
