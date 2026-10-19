package com.trippilot.planbdetection.adapter.`in`.web

import com.trippilot.core.error.AuthenticationRequired
import com.trippilot.planbdetection.application.TriggerDetail
import com.trippilot.planbdetection.application.TriggerService
import com.trippilot.planbdetection.application.TriggerWatch
import com.trippilot.planbdetection.application.WeatherTriggerService
import com.trippilot.planbdetection.domain.DataSource
import com.trippilot.planbdetection.domain.PlanBTrigger
import com.trippilot.planbdetection.domain.TriggerKind
import com.trippilot.planbdetection.domain.TriggerScope
import com.trippilot.planbdetection.domain.TriggerSeverity
import com.trippilot.planbdetection.domain.TriggerState
import com.trippilot.planbdetection.domain.TriggerVariant
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
 * 감지된 변화 목록·상세·끄기(i08·i09).
 *
 * **발화 중이고 지금 유효한 것만 나간다**(INV-U4-01 · 규칙 14) — 억제·무영향으로 남긴 판정은 관측용이며 사용자에게 어떤 형태로도
 * 노출되지 않는다. 정렬은 서버가 정한다(CD14 — 화면은 받은 순서 그대로).
 *
 * 신호 수집(클라 → 서버 판정, BR-U4-03·04)의 엔드포인트는 **아직 열지 않았다**: 정본 API 서피스에 없고
 * 신호 payload 형태는 프론트 지오펜스 구현과 함께 정해야 한다. 서버 쪽 신호원은 감시 스윕이 `reconcile` 로 넣는다.
 */
@RestController
@RequestMapping("/api/v1/trips/{tripId}/triggers")
class TriggerController(
    private val service: TriggerService,
    private val weatherTriggers: WeatherTriggerService,
) {

    @GetMapping
    fun list(principal: Principal, @PathVariable tripId: UUID): TriggerListResponse {
        val accountId = principal.accountId()
        return TriggerListResponse(
            triggers = service.listActive(accountId, tripId).map { TriggerResponse.from(it) },
            watch = service.watch(accountId, tripId),
        )
    }

    /** 트리거 하나(규칙 15) — 늦게 탭한 알림도 지금 상태와 같은 대상의 현재 트리거를 안다. */
    @GetMapping("/{triggerId}")
    fun detail(principal: Principal, @PathVariable tripId: UUID, @PathVariable triggerId: UUID): TriggerDetailResponse =
        TriggerDetailResponse.from(service.detail(principal.accountId(), tripId, triggerId))

    /**
     * 날씨 확인 — 서버가 강수확률을 직접 읽어 임계(G-U4-2)를 넘으면 트리거를 만든다.
     *
     * **본문이 없다.** 다른 신호원과 달리 날씨는 신호원이 서버 쪽(기상청)이라 클라이언트가 보낼 것이 없고,
     * 임계도 서버가 소유한다(BR-U4-03). 위 주석의 "클라 신호 수집 계약 미확정"과 무관한 이유가 이것이다.
     *
     * 조회 실패·임계 미만·억제·이미 떠 있음은 **모두 204** 다 — 화면이 할 일이 같다(배너 없음).
     * 감시 항목별 정상/확인 불가는 목록 응답의 `watch` 가 말한다(i09).
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

data class TriggerListResponse(val triggers: List<TriggerResponse>, val watch: TriggerWatch)

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
    /** 위험(푸시 대상)·주의(앱 안에만). */
    val severity: TriggerSeverity,
    /** 변형(12종). 저장된 값을 모르면 null — 화면은 kind 라벨을 쓴다. */
    val variant: TriggerVariant?,
    /** 출처 표기(공공누리) — 표시 의무가 있는 원천만. 없으면 null. */
    val attribution: String?,
) {
    companion object {
        fun from(t: PlanBTrigger) = TriggerResponse(
            t.triggerId, t.kind, t.affectedDate, t.slotKey, t.reason, t.scope, t.detectedAt,
            t.severity, t.variant, attributionOf(t.dataSource),
        )
    }
}

/** 트리거 하나 — [TriggerResponse] 와 같은 필드 + 지금 상태 + 같은 대상의 현재 트리거. */
data class TriggerDetailResponse(
    val triggerId: UUID,
    val kind: TriggerKind,
    val affectedDate: LocalDate,
    val slotKey: String?,
    val reason: String,
    val scope: TriggerScope?,
    val detectedAt: Instant,
    val severity: TriggerSeverity,
    val variant: TriggerVariant?,
    val attribution: String?,
    /** 지금 상태 — 목록에서 숨는 ACTIVE 는 EXPIRED 로 말한다. */
    val state: TriggerState,
    /** 같은 대상의 지금 보이는 ACTIVE(자기 자신일 수 있다). */
    val currentTriggerId: UUID?,
) {
    companion object {
        fun from(d: TriggerDetail): TriggerDetailResponse {
            val t = TriggerResponse.from(d.trigger)
            return TriggerDetailResponse(
                t.triggerId, t.kind, t.affectedDate, t.slotKey, t.reason, t.scope, t.detectedAt,
                t.severity, t.variant, t.attribution, d.state, d.currentTriggerId,
            )
        }
    }
}

/** 화면 출처 표기(CD5 `attribution`) — 공공누리 1·3유형 표시 의무가 있는 원천만. 모르는 원천은 null(지어내지 않는다). */
private fun attributionOf(dataSource: String?): String? = when (dataSource) {
    DataSource.KMA_VILAGE -> "기상청 단기예보"
    DataSource.KMA_WARNING -> "기상청 기상특보"
    DataSource.AIRKOREA -> "에어코리아"
    else -> null
}

/** 토큰 sub → 계정 id. UUID 가 아니면 인증 실패로 다룬다(형식 오류를 500 으로 흘리지 않는다). */
private fun Principal.accountId(): UUID =
    runCatching { UUID.fromString(name) }.getOrElse { throw AuthenticationRequired() }
