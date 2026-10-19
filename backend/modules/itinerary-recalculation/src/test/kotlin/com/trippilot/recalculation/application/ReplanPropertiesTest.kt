package com.trippilot.recalculation.application

import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import org.springframework.boot.context.properties.bind.BindException
import org.springframework.boot.context.properties.bind.Binder
import org.springframework.core.env.MapPropertySource
import org.springframework.core.env.StandardEnvironment

/**
 * 재계획 설정(`trippilot.replan.*`)이 **배포 스위치 값 그대로** 붙는가(situation-awareness §7).
 *
 * 값이 안 붙어도 앱은 기본값(today·off)으로 정상 기동한다 — 전날 점검은 켰는데 전날 창은 닫힌 채(알림 탭이 409 막다른 길),
 * 또는 선계산을 켰다고 믿는데 꺼진 채 도는 침묵을 여기서 막는다. 철자는 스윕과 같은 키(`pre-trip`)·배포 검증의 `on`·`off` 다.
 */
class ReplanPropertiesTest : StringSpec({

    fun bind(vararg values: Pair<String, String>): ReplanProperties {
        val environment = StandardEnvironment()
        environment.propertySources.addFirst(MapPropertySource("test", values.associate { (k, v) -> "trippilot.replan.$k" to v }))
        return Binder.get(environment).bind("trippilot.replan", ReplanProperties::class.java).orElseGet { ReplanProperties() }
    }

    "배포 스위치의 철자가 그대로 붙는다 — pre-trip · on" {
        val p = bind("horizon" to "pre-trip", "prepared.mode" to "on")
        p.horizon shouldBe ReplanHorizon.PRE_TRIP
        p.prepared.mode shouldBe PreparedMode.ON
        bind("horizon" to "tomorrow").horizon shouldBe ReplanHorizon.TOMORROW
    }

    "미설정이면 오늘 · 선계산 꺼짐" {
        val p = bind()
        p.horizon shouldBe ReplanHorizon.TODAY
        p.prepared.mode shouldBe PreparedMode.OFF
    }

    "대소문자·구분자와 true/false 는 관대하게 붙는다 — 스윕과 같은 바인더라 두 쪽 해석이 같다" {
        bind("horizon" to "pre_trip").horizon shouldBe ReplanHorizon.PRE_TRIP
        bind("prepared.mode" to "true").prepared.mode shouldBe PreparedMode.ON
    }

    "모르는 값은 기동을 막는다 — 조용히 오늘·꺼짐으로 떨어지지 않는다" {
        shouldThrow<BindException> { bind("horizon" to "d-1") }
        shouldThrow<BindException> { bind("prepared.mode" to "yes") }
    }
})
