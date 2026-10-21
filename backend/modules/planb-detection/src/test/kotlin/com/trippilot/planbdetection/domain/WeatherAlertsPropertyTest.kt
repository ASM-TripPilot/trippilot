package com.trippilot.planbdetection.domain

import com.trippilot.planbdetection.domain.WeatherAlerts.Match
import com.trippilot.planbdetection.domain.WeatherAlerts.Place
import com.trippilot.weathercontext.api.WarningArea
import io.kotest.assertions.withClue
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import io.kotest.matchers.shouldNotBe
import io.kotest.property.Arb
import io.kotest.property.arbitrary.arbitrary
import io.kotest.property.arbitrary.element
import io.kotest.property.arbitrary.int
import io.kotest.property.arbitrary.list
import io.kotest.property.checkAll

/**
 * 도의 시군 목적지 × 그 도 줄의 특보 매칭 PBT(블로킹 게이트 — 특보 몫의 INV-SA-2 · G-SA-16 결정 2026-10-20).
 *
 * - **제 이름이 있으면 규칙 그대로** — 하위 구역 하나라도 제 어간으로 시작하면 걸림, `(…제외)` 줄이면 안 걸림.
 * - **표에 없는 이름이 끼면 절대 '안 걸림'이 아니다** — 제 이름이 없고 낯선 이름(구역 개편)이 하나라도 있으면 모름(제외 줄이면 걸림).
 *   '안 걸림'은 '특보 없음' 확인의 재료라 모름을 거기 접으면 거짓 해제다.
 * - **아는 이름뿐이면 가른다** — 다른 시군·섬 구역·관서 묶음 구역·바다뿐이면 안 걸림, 광역 권역이 끼면 모름.
 *
 * 오라클은 생성기가 붙인 갈래 표지로 적는다 — 구현의 갈래 함수(`zoneKind`)를 다시 부르지 않는다.
 */
class WeatherAlertsPropertyTest : StringSpec({

    "도의 시군 — 제 이름이 있으면 걸림(제외 줄이면 안 걸림), 없고 표에 없는 이름이 끼면 절대 안 걸림이 아니다" {
        checkAll(cases) { c ->
            val got = WeatherAlerts.match(c.area, c.place)
            val land = c.zones.filter { it.kind != Kind.SEA }
            val named = land.any { it.name.startsWith(c.place.stem!!) }
            val expected = when {
                c.area.excluding -> if (named) Match.MISS else Match.HIT
                land.isEmpty() -> Match.MISS
                named -> Match.HIT
                land.any { it.kind == Kind.REGIONAL || it.kind == Kind.STRANGE } -> Match.UNSURE
                else -> Match.MISS
            }
            withClue("${c.area} × ${c.place}") {
                got shouldBe expected
                if (!named && land.any { it.kind == Kind.STRANGE }) got shouldNotBe Match.MISS
            }
        }
    }

    "생성기의 낯선 이름은 어느 도에서도 표에 없는 이름이다 — 위 오라클의 전제" {
        WeatherAlerts.CITY_STEMS.keys.forEach { province ->
            STRANGE.forEach { name -> withClue("$province $name") { WeatherAlerts.zoneKind(province, name) shouldBe WeatherAlerts.ZoneKind.UNKNOWN } }
        }
    }
})

/** 생성기가 붙인 하위 구역의 갈래 — 제 시군 · 다른 시군 · 광역 권역 · 섬 구역 · 관서 묶음 구역 · 바다 · 낯선 이름. */
private enum class Kind { OWN, OTHER, REGIONAL, ISLAND, CROSS, SEA, STRANGE }

private data class Zone(val name: String, val kind: Kind)

private data class Case(val place: Place, val zones: List<Zone>, val area: WarningArea)

/** 구역 개편으로 생길 법한 낯선 이름 — 어느 도의 시군 어간으로도 광역 이름으로도 시작하지 않는다(위 전제 검사가 지킨다). */
private val STRANGE = listOf("북동산지", "중부산간", "남부내륙", "서부평야", "동부해안", "내륙북부")

/**
 * 도 하나 · 그 도의 시군 목적지 하나 · 그 도 줄(하위 구역 1~4 · 다섯에 하나는 제외 줄). 목적지 코드는 실재하지 않는 값이라 섬·관서
 * 묶음 구역은 늘 '덮지 않는 구역'이다(덮는 경우는 리터럴 표가 본다).
 */
private val cases: Arb<Case> = arbitrary {
    val province = Arb.element(WeatherAlerts.CITY_STEMS.keys.toList()).bind()
    val stems = WeatherAlerts.CITY_STEMS.getValue(province).toList()
    val own = Arb.element(stems).bind()
    val others = stems.filterNot { it.startsWith(own) }
    val cross = WeatherAlerts.CROSS_ZONES.keys.toList()
    val suffix = Arb.element("", "평지", "산지", "동부", "남부", "시평지")
    val zone = arbitrary {
        when (Arb.element(Kind.entries).bind()) {
            Kind.OWN -> Zone(own + suffix.bind(), Kind.OWN)
            Kind.OTHER -> Zone(Arb.element(others).bind() + suffix.bind(), Kind.OTHER)
            Kind.REGIONAL -> Zone(province.label + Arb.element("북부산지", "중부산지", "남부내륙").bind(), Kind.REGIONAL)
            Kind.ISLAND -> Zone(Arb.element(WeatherAlerts.ISLANDS.keys.toList()).bind(), Kind.ISLAND)
            Kind.CROSS -> Zone(Arb.element(cross).bind(), Kind.CROSS)
            Kind.SEA -> Zone(Arb.element("동해중부앞바다", "남해서부해상").bind(), Kind.SEA)
            Kind.STRANGE -> Zone(Arb.element(STRANGE).bind(), Kind.STRANGE)
        }
    }
    val zones = Arb.list(zone, 1..4).bind()
    val place = Place("00000", setOf(province), own, wide = false, label = own)
    Case(place, zones, WarningArea(province.label, zones.map { it.name }, excluding = Arb.int(0..4).bind() == 0))
}
