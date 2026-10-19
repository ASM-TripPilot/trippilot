package com.trippilot.planbdetection.application

import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import org.springframework.boot.context.properties.bind.BindException
import org.springframework.boot.context.properties.bind.Binder
import org.springframework.core.env.MapPropertySource
import org.springframework.core.env.StandardEnvironment
import java.time.Duration
import java.util.UUID

/**
 * 스윕 설정(`trippilot.planb.situation-sweep.*`)이 **배포 스위치 값 그대로** 붙는가(설계서 §7).
 *
 * 값이 안 붙어도 앱은 기본값(off)으로 정상 기동한다 — 켰다고 믿는데 꺼진 채 도는 침묵을 여기서 막는다.
 * 스위치 값은 배포 검증(`runtime_secrets`)이 쓰는 철자(`dry-run`·`pre-trip`)이고, 모르는 값은 **기동 실패**다.
 */
class SituationSweepPropertiesTest : StringSpec({

    fun bind(vararg values: Pair<String, String>): SituationSweepProperties {
        val environment = StandardEnvironment()
        environment.propertySources.addFirst(
            MapPropertySource("test", values.associate { (k, v) -> "trippilot.planb.situation-sweep.$k" to v }),
        )
        return Binder.get(environment)
            .bind("trippilot.planb.situation-sweep", SituationSweepProperties::class.java)
            .orElseGet { SituationSweepProperties() }
    }

    "배포 스위치의 철자가 그대로 붙는다 — dry-run·pre-trip·쉼표 구분 계정 목록" {
        val a = UUID.randomUUID()
        val b = UUID.randomUUID()
        val p = bind(
            "mode" to "dry-run", "horizon" to "pre-trip", "account-ids" to "$a, $b",
            "sources" to "kma-forecast,place", "observe-only" to "", "parallelism" to "3", "budget" to "PT10M",
        )
        p.mode shouldBe SweepMode.DRY_RUN
        p.horizon shouldBe SweepHorizon.PRE_TRIP
        p.accountIds shouldBe setOf(a, b)
        p.sources shouldBe listOf("kma-forecast", "place")
        p.observeOnly shouldBe emptySet()
        p.parallelism shouldBe 3
        p.budget shouldBe Duration.ofMinutes(10)
        bind("mode" to "on", "horizon" to "tomorrow").let {
            it.mode shouldBe SweepMode.ON
            it.horizon shouldBe SweepHorizon.TOMORROW
        }
    }

    "미설정이면 꺼짐 · 오늘 · 전원 · 출처 4종 · 특보·대기질 관찰 전용 · 병렬 2 · 예산 20분" {
        val p = bind()
        p.mode shouldBe SweepMode.OFF
        p.horizon shouldBe SweepHorizon.TODAY
        p.accountIds shouldBe emptySet()
        p.sources shouldBe listOf("kma-forecast", "kma-warning", "airkorea", "place")
        p.observeOnly shouldBe setOf("kma-warning", "airkorea")
        p.parallelism shouldBe 2
        p.budget shouldBe Duration.ofMinutes(20)
        // 빈 계정 목록(`PLANB_SITUATION_SWEEP_ACCOUNT_IDS=`)은 전원이다.
        bind("account-ids" to "").accountIds shouldBe emptySet()
    }

    "모르는 모드·지평 값과 계정 id 오타는 기동을 막는다 — 조용히 꺼짐·전원으로 떨어지지 않는다" {
        shouldThrow<BindException> { bind("mode" to "dryrun-typo") }
        shouldThrow<BindException> { bind("horizon" to "d-1") }
        shouldThrow<BindException> { bind("account-ids" to "not-a-uuid") }
    }

    "출처·관찰 전용 목록의 모르는 이름은 기동을 막는다 — 관찰 전용 오타가 그 출처의 쓰기·푸시를 조용히 켜지 않게" {
        shouldThrow<BindException> { bind("observe-only" to "kma-warning,airkorae") } // airkorea 가 실측 전에 쓰기 대상이 된다
        shouldThrow<BindException> { bind("sources" to "kma-forcast,place") }
    }

    "계정 목록의 빈 항목(공백만·끝 쉼표)은 기동을 막는다 — '아무도 안 맞는 목록'으로 조용히 0 여행을 돌지 않게" {
        val a = UUID.randomUUID()
        shouldThrow<BindException> { bind("account-ids" to " ") }
        shouldThrow<BindException> { bind("account-ids" to "\t") }
        shouldThrow<BindException> { bind("account-ids" to "$a,") }
    }

    "병렬 1 미만·예산 0 이하는 기동하지 않는다 — 회차가 아무것도 못 보고 끝난다" {
        shouldThrow<BindException> { bind("parallelism" to "0") }
        shouldThrow<BindException> { bind("budget" to "PT0S") }
    }
})
