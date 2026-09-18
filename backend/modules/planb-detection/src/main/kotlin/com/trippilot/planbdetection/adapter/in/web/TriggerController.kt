package com.trippilot.planbdetection.adapter.`in`.web

import com.trippilot.core.error.AuthenticationRequired
import com.trippilot.planbdetection.application.TriggerService
import com.trippilot.planbdetection.application.WeatherTriggerService
import com.trippilot.planbdetection.domain.PlanBTrigger
import com.trippilot.planbdetection.domain.TriggerKind
import com.trippilot.planbdetection.domain.TriggerScope
import org.springframework.http.ResponseEntity
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
class TriggerController(
    private val service: TriggerService,
    private val weatherTriggers: WeatherTriggerService,
) {

    @GetMapping
    fun list(principal: Principal, @PathVariable tripId: UUID): TriggerListResponse =
        TriggerListResponse(service.listActive(principal.accountId(), tripId).map { TriggerResponse.from(it) })

    /**
     * 날씨 확인 — 서버가 강수확률을 직접 읽어 임계(G-U4-2)를 넘으면 트리거를 만든다.
     *
     * **본문이 없다.** 다른 신호원과 달리 날씨는 신호원이 서버 쪽(기상청)이라 클라이언트가 보낼 것이 없고,
     * 임계도 서버가 소유한다(BR-U4-03). 위 주석의 "클라 신호 수집 계약 미확정"과 무관한 이유가 이것이다.
     *
     * 조회 실패·임계 미만·억제는 **모두 204** 다 — 셋 다 화면이 할 일이 같다(배너 없음).
     * 셋을 구분해 보여 주는 것은 `i09`(감시 항목별 정상/확인 불가)의 몫이고 그 조회 경로는 아직 없다.
     *
     * `GET` 이 아니라 `POST` 인 이유: 판정 결과를 행으로 남기므로 조회가 아니다.
     */
    @PostMapping("/weather-check")
    fun weatherCheck(principal: Principal, @PathVariable tripId: UUID): ResponseEntity<TriggerResponse> =
        weatherTriggers.checkToday(principal.accountId(), tripId)
            ?.let { ResponseEntity.ok(TriggerResponse.from(it)) }
            ?: ResponseEntity.noContent().build()

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
