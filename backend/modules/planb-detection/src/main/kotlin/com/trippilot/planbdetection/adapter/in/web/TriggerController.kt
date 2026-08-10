package com.trippilot.planbdetection.adapter.`in`.web

import com.trippilot.core.error.AuthenticationRequired
import com.trippilot.planbdetection.application.TriggerService
import com.trippilot.planbdetection.domain.PlanBTrigger
import com.trippilot.planbdetection.domain.TriggerKind
import com.trippilot.planbdetection.domain.TriggerScope
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import java.security.Principal
import java.time.Instant
import java.time.LocalDate
import java.util.UUID

/**
 * 감지된 변화 목록·끄기(i08·i09).
 *
 * **발화 중인 것만 나간다**(INV-U4-01) — 억제·무영향으로 남긴 판정은 관측용이며 사용자에게 어떤 형태로도
 * 노출되지 않는다.
 *
 * 신호 수집(클라 → 서버 판정, BR-U4-03·04)의 엔드포인트는 **아직 열지 않았다**: 정본 API 서피스에 없고
 * 신호 payload 형태는 프론트 지오펜스 구현과 함께 정해야 한다. 판정 자체는
 * [TriggerService.evaluate] 로 완성돼 있어, 계약이 정해지면 얇은 컨트롤러만 붙이면 된다.
 */
@RestController
@RequestMapping("/api/v1/trips/{tripId}/triggers")
class TriggerController(private val service: TriggerService) {

    @GetMapping
    fun list(principal: Principal, @PathVariable tripId: UUID): TriggerListResponse =
        TriggerListResponse(service.listActive(principal.accountId(), tripId).map { TriggerResponse.from(it) })

    /** `[끄기]` — 억제 레코드를 만든다(BR-U4-15). 배너만 감추는 동작이 아니다. */
    @PostMapping("/{triggerId}/dismiss")
    fun dismiss(
        principal: Principal,
        @PathVariable tripId: UUID,
        @PathVariable triggerId: UUID,
    ): TriggerResponse = TriggerResponse.from(service.dismiss(principal.accountId(), tripId, triggerId))
}

data class TriggerListResponse(val triggers: List<TriggerResponse>)

data class TriggerResponse(
    val triggerId: UUID,
    val kind: TriggerKind,
    val affectedDate: LocalDate,
    /** 영향 슬롯의 경계 키("{date}#{poiId}"). null = 날짜 전체 영향. */
    val slotKey: String?,
    /** 사용자 노출 문구의 근거(`비 예보 70%`). */
    val reason: String,
    /** 발화 시 재계획 범위 — [대안 보기] 가 이 값으로 세션을 연다. */
    val scope: TriggerScope?,
    val detectedAt: Instant,
) {
    companion object {
        fun from(t: PlanBTrigger) =
            TriggerResponse(t.triggerId, t.kind, t.affectedDate, t.slotKey, t.reason, t.scope, t.detectedAt)
    }
}

/** 토큰 sub → 계정 id. UUID 가 아니면 인증 실패로 다룬다(형식 오류를 500 으로 흘리지 않는다). */
private fun Principal.accountId(): UUID =
    runCatching { UUID.fromString(name) }.getOrElse { throw AuthenticationRequired() }
