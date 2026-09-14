package com.trippilot.notification.application

import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import io.kotest.property.Arb
import io.kotest.property.arbitrary.string
import io.kotest.property.checkAll
import io.micrometer.core.instrument.simple.SimpleMeterRegistry

/**
 * U6 관측 지표(OBS-U6-02·03·04).
 *
 * 여기서만 드러나는 것 — **지표는 틀려도 아무것도 빨개지지 않는다.** 태그가 폭발하거나 값이 안 올라가도
 * 기능은 멀쩡히 돌고, 정작 필요할 때(장애·정책 조정) 근거가 없다는 사실만 뒤늦게 드러난다.
 */
class NotificationMetricsTest : StringSpec({

    fun fixture(): Pair<NotificationMetrics, SimpleMeterRegistry> {
        val registry = SimpleMeterRegistry()
        return NotificationMetrics(registry, FakeNotifications()) to registry
    }

    "발송 결과가 outcome 별로 쌓인다" {
        val (metrics, registry) = fixture()

        metrics.pushDispatched(PushOutcome.SENT)
        metrics.pushDispatched(PushOutcome.SENT)
        metrics.pushDispatched(PushOutcome.MUTED)

        // delivery 태그가 붙는다(TRIP-834) — 기본은 실발송이고, 미발송 모드는 따로 센다.
        val real = NotificationMetrics.DELIVERY_REAL
        registry.counter(NotificationMetrics.PUSH_DISPATCH, "outcome", "SENT", "reason", "none", "delivery", real)
            .count() shouldBe 2.0
        registry.counter(NotificationMetrics.PUSH_DISPATCH, "outcome", "MUTED", "reason", "none", "delivery", real)
            .count() shouldBe 1.0
    }

    "억제는 발송 실패와 다른 지표로 쌓인다 — 일부러 안 보낸 것이라 정책 조정의 근거다" {
        val (metrics, registry) = fixture()

        metrics.suppressed(SuppressReason.DUPLICATE)
        metrics.suppressed(SuppressReason.IN_APP_OFF)
        metrics.suppressed(SuppressReason.DUPLICATE)

        registry.counter(NotificationMetrics.SUPPRESSED, "reason", "DUPLICATE").count() shouldBe 2.0
        registry.counter(NotificationMetrics.SUPPRESSED, "reason", "IN_APP_OFF").count() shouldBe 1.0
    }

    "미읽음 게이지는 갱신 전 0, 갱신 후 실제 건수다" {
        val repo = FakeNotifications()
        val registry = SimpleMeterRegistry()
        val metrics = NotificationMetrics(registry, repo)
        repeat(3) {
            repo.stored += com.trippilot.notification.domain.Notification.raise(
                accountId = java.util.UUID.randomUUID(),
                kind = com.trippilot.notification.domain.NotificationKind.SYSTEM,
                title = "제목", body = "본문",
                occurredAt = java.time.Instant.parse("2026-09-14T00:00:00Z"),
            )
        }

        val before = registry.find(NotificationMetrics.UNREAD_BACKLOG).gauge()!!.value()
        metrics.refreshUnread()
        val after = registry.find(NotificationMetrics.UNREAD_BACKLOG).gauge()!!.value()

        before shouldBe 0.0
        after shouldBe 3.0
    }

    /**
     * **불변식**: 실패 사유는 벤더 응답에서 오는 자유 문자열이다. 그대로 태그가 되면 시계열이 무한히
     * 갈라져 수집기를 망가뜨린다 — 어떤 문자열이 와도 태그 값은 닫힌 집합 안이어야 한다.
     */
    "어떤 실패 사유 문자열이 와도 태그는 닫힌 집합 안이다" {
        val allowed = setOf("none", "OTHER", "PUSH_ERROR", "DEVICE_NOT_REGISTERED", "FAILED", "SENT", "UNKNOWN")

        checkAll(Arb.string()) { raw ->
            val (metrics, registry) = fixture()
            metrics.pushDispatched(PushOutcome.FAILED, raw)

            val tags = registry.find(NotificationMetrics.PUSH_DISPATCH).counters()
                .flatMap { it.id.tags }
                .filter { it.key == "reason" }
                .map { it.value }
            tags.forEach { allowed.contains(it) shouldBe true }
        }
    }
})
