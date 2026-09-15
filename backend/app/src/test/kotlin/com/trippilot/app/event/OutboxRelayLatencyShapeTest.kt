package com.trippilot.app.event

import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import io.micrometer.core.instrument.Clock
import io.micrometer.registry.otlp.OtlpConfig
import io.micrometer.registry.otlp.OtlpMeterRegistry
import org.springframework.jdbc.core.JdbcTemplate
import java.time.Duration

/**
 * 릴레이 지연 지표가 **분위수를 낼 수 있는 모양인가**(OBS-U6-01).
 *
 * ## 왜 따로 있나 — 값이 아니라 **모양**을 잰다
 *
 * `OutboxRelayIT` 는 "배달하면 타이머가 오른다"를 본다. 그 단언은 `registry.timer(name)` 으로 만든
 * 타이머로도 통과한다 — 그런데 그렇게 만들면 **count·sum·max 만 나가고 p95 가 없다.** 이 지표의
 * 존재 이유가 PERF-U6-01 목표 대조인데 그 대조를 못 하는 상태이고, 값만 보는 테스트는 그 차이를
 * 원리적으로 못 본다. 지표가 없는 것보다 나쁘다 — 있다고 믿게 된다.
 *
 * ## 왜 실 레지스트리를 쓰나
 *
 * 앱 테스트 컨텍스트는 `SimpleMeterRegistry` 인데 **그쪽은 aggregable 히스토그램을 지원하지 않아**
 * (`supportsAggregablePercentiles=false`) 설정을 어떻게 하든 버킷이 0 이다(실측). 거기서 재면
 * 언제나 실패하거나, 반대로 단언을 느슨하게 바꾸면 아무것도 안 지킨다. 운영이 실제로 쓰는
 * OTLP 레지스트리로 재는 것이 유일하게 의미 있는 판정이다.
 *
 * **내보내기는 꺼 둔다**(`enabled=false`). 기본 설정으로 만들면 푸시 스케줄러가 뜨고, 닫을 때
 * 마지막 한 번을 보내려다 `localhost:4318` 연결 거부 스택트레이스를 테스트 출력에 남긴다(실측) —
 * 통과는 하지만 읽는 사람에게는 고장으로 보인다. 히스토그램 지원 여부는 내보내기와 무관하다.
 */
class OutboxRelayLatencyShapeTest : StringSpec({

    "릴레이 지연 타이머는 히스토그램 버킷을 낸다 — p95 를 낼 수 있는 모양이다" {
        val offline = object : OtlpConfig {
            override fun get(key: String): String? = null
            override fun enabled(): Boolean = false
        }
        val registry = OtlpMeterRegistry(offline, Clock.SYSTEM)
        try {
            // 타이머는 생성자에서 등록된다 — 릴레이를 돌릴 필요가 없다.
            // JdbcTemplate 은 생성자가 건드리지 않으므로 빈 것으로 충분하다.
            OutboxRelay(JdbcTemplate(), registry, emptyList())

            val timer = registry.find("trippilot.outbox.relay.latency").timer()!!
            timer.record(Duration.ofSeconds(5))

            timer.takeSnapshot().histogramCounts().isNotEmpty() shouldBe true
        } finally {
            registry.close()
        }
    }
})
