package com.trippilot.notification.application

import com.trippilot.notification.domain.NotificationRepository
import io.micrometer.core.instrument.Gauge
import io.micrometer.core.instrument.MeterRegistry
import org.springframework.scheduling.annotation.Scheduled
import org.springframework.stereotype.Component
import java.util.concurrent.atomic.AtomicLong

/**
 * U6 관측 지표(OBS-U6-02·03·04) — **계측만** 얹는다. 수집 파이프라인은 이미 있다(Micrometer OTLP push).
 *
 * ## 왜 필요한가
 *
 * 정본이 "침묵 실패 금지(INV-4)는 **관측으로 만족**한다"고 적어 두고(REL-U6-03) 사용자에게 전달 실패를
 * 보여주지 않기로 했는데, **그 관측이 0건이었다**(2026-09-12 실측). 지금은 푸시가 안 가도 아무 데서도
 * 드러나지 않는다. 야간 조용시간·발송량 상한 조정도 "관측 후 결정"으로 미뤄져 있어, 잴 도구가 없으면
 * 그 결정을 영영 못 한다.
 *
 * ## 태그는 닫힌 집합만
 *
 * 실패 사유는 벤더 응답에서 오는 **자유 문자열**이다. 그대로 태그로 쓰면 시계열이 무한히 갈라져
 * 수집기를 망가뜨린다 — 아는 값만 남기고 나머지는 [OTHER] 로 접는다.
 */
@Component
class NotificationMetrics(
    private val registry: MeterRegistry,
    private val notifications: NotificationRepository,
) {
    /**
     * 미읽음 누적(OBS-U6-04) — catch-up 건강도다. 계속 쌓이면 **전달이 아니라 소비가 깨진 것**이다.
     *
     * 게이지가 직접 DB 를 세지 않고 [AtomicLong] 을 읽는 이유: 수집 주기(15초)마다 전체 COUNT 가
     * 돌면 표가 커질수록 비싸진다. 아래 [refreshUnread] 가 1분마다 한 번만 재고, 게이지는 그 값을 본다.
     */
    private val unread = AtomicLong(0)

    init {
        Gauge.builder(UNREAD_BACKLOG) { unread.get().toDouble() }
            .description("읽지 않은 알림 누적 건수(OBS-U6-04)")
            .register(registry)
    }

    /**
     * 푸시 발송 결과(OBS-U6-02). [reason] 은 실패일 때만 의미가 있고, 닫힌 집합으로 접혀서 온다.
     */
    fun pushDispatched(outcome: PushOutcome, reason: String? = null, deliversExternally: Boolean = true) {
        registry.counter(
            PUSH_DISPATCH,
            "outcome", outcome.name,
            "reason", normalizeReason(reason),
            // **"보냈다"와 "보낸 척했다"를 가른다.** 기본 발송기는 아무 데도 안 보내면서 성공을
            // 보고하므로(그 판단은 옳다 — 실패로 보고하면 진짜 실패가 묻힌다), 이 태그가 없으면
            // 푸시가 꺼진 환경의 지표가 "성공률 100%" 를 그리고 운영이 그대로 읽는다.
            "delivery", if (deliversExternally) DELIVERY_REAL else DELIVERY_NONE,
        ).increment()
    }

    /**
     * 푸시가 **생략된** 수(OBS-U6-03). 발송 실패와 다른 축이다 — 이쪽은 우리가 일부러 안 보낸 것이고,
     * 그 빈도가 곧 조용시간·상한 정책을 조정할 근거가 된다.
     *
     * 가르는 기준은 **누구의 뜻인가**다. `MUTED` 는 사용자가 직접 끈 것이라 정책을 바꿀 일이 아니고,
     * 여기 모이는 것들(중복·인앱 꺼짐·상한)은 **우리 판단**이라 빈도를 보고 조정할 대상이다.
     * 그래서 종류 토글로 막힌 푸시는 여기 없고 [PUSH_DISPATCH] 의 `outcome=MUTED` 로만 센다.
     *
     * ## ⚠ 억제 총량은 두 지표를 그냥 더하면 안 된다
     *
     * 두 지표는 **다른 질문에 답한다** — [PUSH_DISPATCH] 는 "발송 시도의 결말 분포",
     * 이쪽은 "우리 정책이 몇 번 물렸나". `RATE_LIMITED` 는 양쪽 모두에 해당해 **두 곳에 다 올라간다**
     * (정책 판정이면서 동시에 하나의 결말이다). 그냥 더하면 그 사유만 두 번 세어진다.
     *
     * ```
     * 억제 총량 = SUPPRESSED(전부) + PUSH_DISPATCH{outcome=MUTED}
     * ```
     *
     * `DUPLICATE`·`IN_APP_OFF` 는 발송 경로에 닿기 전에 걸러져 [PUSH_DISPATCH] 에 아예 안 나타나므로
     * 중복이 없다. 새 사유를 넣을 때는 **발송까지 가는 사유인지**를 먼저 보고, 간다면 이 식을 고친다.
     */
    fun suppressed(reason: SuppressReason) {
        registry.counter(SUPPRESSED, "reason", reason.name).increment()
    }

    /**
     * 1분마다 미읽음을 다시 센다. 다중 인스턴스가 각자 재도 같은 값이라 락이 필요 없다.
     *
     * **기동 직후 최대 1분은 0 이 보고된다** — 실제로 0 인 것과 구분되지 않는다. 경보를 걸 때는
     * 기동 시각을 함께 보거나 지속 시간 조건을 둔다(순간값으로 판단하지 않는다).
     */
    @Scheduled(fixedDelayString = "\${trippilot.notification.unread-gauge-delay-ms:60000}")
    fun refreshUnread() {
        unread.set(notifications.countUnread())
    }

    /** 아는 사유만 남긴다 — 벤더 자유 문자열을 그대로 태그에 실으면 시계열이 무한히 갈라진다. */
    private fun normalizeReason(reason: String?): String = when {
        reason == null -> NONE
        reason.startsWith(PUSH_ERROR_PREFIX) -> PUSH_ERROR_PREFIX
        reason in KNOWN_REASONS -> reason
        else -> OTHER
    }

    companion object {
        const val PUSH_DISPATCH = "trippilot.push.dispatch"
        const val SUPPRESSED = "trippilot.notification.suppressed"
        const val UNREAD_BACKLOG = "trippilot.notification.unread"

        /** 실제로 기기까지 나간 발송. */
        const val DELIVERY_REAL = "real"

        /** 발송기가 미발송 모드라 아무 데도 안 간 것 — 성공으로 기록되지만 전달은 아니다. */
        const val DELIVERY_NONE = "none"

        private const val NONE = "none"
        private const val OTHER = "OTHER"
        private const val PUSH_ERROR_PREFIX = "PUSH_ERROR"

        /** 벤더·도메인이 아는 값. 여기 없는 것은 [OTHER] 로 접는다. */
        private val KNOWN_REASONS = setOf("DEVICE_NOT_REGISTERED", "FAILED", "SENT", "UNKNOWN")
    }
}

/** 푸시를 **일부러 보내지 않은** 이유(OBS-U6-03). 닫힌 집합이라 그대로 태그가 된다. */
enum class SuppressReason {
    /** 같은 사건이 이미 적재돼 있다 — 재배달이라 푸시를 또 쏘면 두 번 울린다. */
    DUPLICATE,

    /** 사용자가 이 종류의 인앱 수신을 껐다 — 적재 자체를 하지 않는다. */
    IN_APP_OFF,

    /**
     * 계정 발송량 소프트 상한을 넘겼다(COST-U6-01). 이 수치가 곧 **상한 값을 조정할 근거**다
     * (COST-U6-03) — 한 번도 안 물리면 상한이 헐겁고, 계속 물리면 사용자가 알림을 늦게 받고 있다.
     */
    RATE_LIMITED,
}
