package com.trippilot.recalculation.application

import com.trippilot.recalculation.application.ReplanMaterial.Risk
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldContainExactly
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldContain
import java.io.File
import java.util.UUID

/**
 * 선계산 재료(BR-SA-18 ④ · CD10) — 사건의 그 날 위험 → 재계획 세션 입력. 매핑의 주인은 C10 이다.
 *
 * 막지 못하면 사용자에게 보이는 것: 흐림(주의)에 실내·이동 짧게가 얹혀 일정이 과하게 바뀌고, 휴무 장소가 초안에 남는다.
 * 키 철자가 어긋나면 AI 가 그 사유·지시를 **조용히 모른 척**한다(사유는 `none` 으로 눕고, 지시는 `unknown_directives`).
 */
class ReplanMaterialTest : StringSpec({

    val p1 = UUID.randomUUID()
    val p2 = UUID.randomUUID()

    fun weather(variant: String?, coverage: String? = null, vararg pois: UUID) = Risk("WEATHER", variant, pois.toList(), coverage)
    fun closure(variant: String?, vararg pois: UUID) = Risk("CLOSURE", variant, pois.toList(), null)

    "비·눈 — 사유 WEATHER 만, 지시 없음(AI 가 INDOOR·LESS_MOVE 를 암시한다)" {
        listOf("RAIN", "SNOW").forEach { v ->
            ReplanMaterial.of(listOf(weather(v, null, p1))) shouldBe ReplanMaterial.Material(listOf("WEATHER"), emptyList(), emptyList())
        }
    }

    "강풍·폭염·한파·미세먼지 — WEATHER + AVOID_OUTDOOR(같은 축의 암시 INDOOR 를 대신한다)" {
        listOf("WIND", "HEAT", "COLD", "DUST").forEach { v ->
            ReplanMaterial.of(listOf(weather(v))) shouldBe ReplanMaterial.Material(listOf("WEATHER"), listOf("AVOID_OUTDOOR"), emptyList())
        }
    }

    "날씨는 영향 범위가 일부(SOME)일 때만 영향 POI 를 뺀다 — 대부분(MOST)·모름이면 하루 방향 전환에 맡긴다" {
        ReplanMaterial.of(listOf(weather("RAIN", "SOME", p1)))!!.excludedPoiIds shouldContainExactly listOf(p1)
        ReplanMaterial.of(listOf(weather("RAIN", "MOST", p1)))!!.excludedPoiIds shouldBe emptyList()
        ReplanMaterial.of(listOf(weather("RAIN", null, p1)))!!.excludedPoiIds shouldBe emptyList()
    }

    "휴무 변형 전부 — TEMP_CLOSED + 그 POI 제외" {
        listOf("CLOSED_DAY", "OUT_OF_HOURS", "HOURS_MISMATCH", "HOLIDAY", "PERMANENTLY_CLOSED", null).forEach { v ->
            ReplanMaterial.of(listOf(closure(v, p1))) shouldBe ReplanMaterial.Material(listOf("TEMP_CLOSED"), emptyList(), listOf(p1))
        }
    }

    "흐림은 선계산하지 않는다 — 주의다" {
        ReplanMaterial.of(listOf(weather("CLOUD", "SOME", p1))) shouldBe null
    }

    "변형을 모르는 날씨(옛 날씨 확인 경로)는 비처럼 사유만 싣는다 — 지시를 지어내지 않는다" {
        ReplanMaterial.of(listOf(weather(null))) shouldBe ReplanMaterial.Material(listOf("WEATHER"), emptyList(), emptyList())
        ReplanMaterial.of(listOf(weather("FOG"))) shouldBe ReplanMaterial.Material(listOf("WEATHER"), emptyList(), emptyList())
    }

    "지연·수동은 재료가 아니다 — U10 소관이라 매핑이 없다" {
        ReplanMaterial.of(listOf(Risk("DELAY", null, listOf(p1), null), Risk("MANUAL", null, emptyList(), null))) shouldBe null
    }

    "같은 날 여러 위험은 합집합이다 — 중복 없이, 먼저 온 순서로" {
        val m = ReplanMaterial.of(
            listOf(weather("RAIN", "SOME", p1), closure("CLOSED_DAY", p2), weather("WIND", "SOME", p1), weather("CLOUD", "SOME", p2)),
        )!!
        m.reasons shouldContainExactly listOf("WEATHER", "TEMP_CLOSED")
        m.directives shouldContainExactly listOf("AVOID_OUTDOOR")
        m.excludedPoiIds shouldContainExactly listOf(p1, p2)
    }

    "각 목록은 10개까지다 — 세션 입력 상한과 같다" {
        val many = (1..15).map { UUID.randomUUID() }
        ReplanMaterial.of(listOf(Risk("CLOSURE", "CLOSED_DAY", many, null)))!!.excludedPoiIds shouldContainExactly many.take(10)
    }

    // 키는 문자열이라 컴파일러가 못 본다 — 한쪽이 이름을 바꾸면 재계획이 사유·지시 없이 돈다(초록인 채로).
    "재료 키 철자는 FE 사유 카탈로그·AI 지시 사전과 같다" {
        val catalog = repoFile("frontend/src/pages/live/planb-request/config/replanChoices.ts").readText()
        val dictionary = repoFile("ai/data/replan_directives.yaml").readText()

        catalog shouldContain "key: '${ReplanMaterial.REASON_WEATHER}'"
        catalog shouldContain "key: '${ReplanMaterial.REASON_CLOSED}'"
        // 감지 칩이 켜는 사유와 같은 값이다(TRIGGER_REASON_KEY) — 앱이 i04 에서 시드하는 사유와 선계산 사유가 같아야 한다.
        catalog shouldContain "WEATHER: '${ReplanMaterial.REASON_WEATHER}'"
        catalog shouldContain "CLOSURE: '${ReplanMaterial.REASON_CLOSED}'"
        // 지시는 AI 사전 키 그대로 나간다(번역하지 않는다) — 앱이 준비 세션 입력으로 시드할 때 칩으로도 보여야 한다.
        dictionary shouldContain "- key: ${ReplanMaterial.DIRECTIVE_AVOID_OUTDOOR}\n"
        catalog shouldContain "key: '${ReplanMaterial.DIRECTIVE_AVOID_OUTDOOR}'"
    }
})

/** 모노레포 루트 기준 파일 — 모듈 위치가 바뀌어도 견디게 위로 올라가며 찾는다(EmptyEnvBindingTest 와 같은 방식). */
private fun repoFile(relative: String): File {
    var dir: File? = File(System.getProperty("user.dir")).absoluteFile
    while (dir != null) {
        File(dir, relative).takeIf { it.isFile }?.let { return it }
        dir = dir.parentFile
    }
    error("$relative 을 찾지 못했습니다. user.dir=${System.getProperty("user.dir")}")
}
