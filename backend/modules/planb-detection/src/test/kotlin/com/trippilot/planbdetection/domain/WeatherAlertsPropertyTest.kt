package com.trippilot.planbdetection.domain

import com.trippilot.planbdetection.domain.WeatherAlerts.Match
import com.trippilot.planbdetection.domain.WeatherAlerts.Place
import com.trippilot.planbdetection.domain.WeatherAlerts.Province
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
import io.kotest.property.arbitrary.map
import io.kotest.property.checkAll

/**
 * 도의 시군 · 광역시의 군 목적지 × 그 광역 줄의 특보 매칭 PBT(블로킹 게이트 — 특보 몫의 INV-SA-2 · G-SA-16 결정 2026-10-20).
 *
 * - **제 이름이 있으면 규칙 그대로** — 하위 구역 하나라도 제 어간으로 시작하면 걸림.
 * - **`(…제외)` 줄은 시군 전체 이름일 때만 안 걸림**(G-SA-19) — 제 시군 전체 이름(어간 · 어간+시/군)을 뺐으면 안 걸림, 제 하위 권역(어간 +
 *   다른 꼬리)만 뺐으면 모름(목적지가 뺀 쪽에 있는지 모른다 — 시군째 빼면 나머지 권역의 특보를 '특보 없음'으로 확인한다), 둘 다 없으면 걸림.
 * - **표에 없는 이름이 끼면 절대 '안 걸림'이 아니다** — 제 이름이 없고 낯선 이름(구역 개편)이 하나라도 있으면 모름(제외 줄이면 걸림 ·
 *   광역시의 군은 권역이 끼면 걸림 — 제 구역이 있는 군은 모름). '안 걸림'은 '특보 없음' 확인의 재료라 모름을 거기 접으면 거짓 해제다.
 * - **아는 이름뿐이면 가른다** — 다른 시군·섬 구역·관서 묶음 구역·바다뿐이면 안 걸림, 광역 권역이 끼면 도의 시군은 모름·광역시의 군은
 *   걸림(규칙 7 — 줄 전체). 제 구역이 있는 광역시의 군(강화·옹진·군위·달성)은 목록의 권역(인천영종 · 대구중부 …)이 덮지 않아 그것만으로는
 *   안 걸림이다 — 표 밖 권역은 줄 전체 그대로다.
 *
 * 오라클은 생성기가 붙인 갈래 표지로 적는다 — 구현의 갈래 함수(`zoneKind`)를 다시 부르지 않는다.
 */
class WeatherAlertsPropertyTest : StringSpec({

    "도의 시군·광역시의 군 — 제 이름이 있으면 걸림(제외 줄이면 시군 전체 이름일 때만 안 걸림), 없고 표에 없는 이름이 끼면 절대 안 걸림이 아니다" {
        checkAll(cases) { c ->
            val got = WeatherAlerts.match(c.area, c.place)
            val land = c.zones.filter { it.kind != Kind.SEA }
            val named = land.any { it.name.startsWith(c.place.stem!!) }
            val metroGun = c.place.provinces.single().wide
            val ownZone = metroGun && c.place.stem in OWN_ZONE_GUN // 공식 목록에 제 구역이 있는 광역시의 군 — 목록의 권역이 덮지 않는다
            val expected = when {
                c.area.excluding -> excludedExpected(land, c.place)
                land.isEmpty() -> Match.MISS
                named -> Match.HIT
                // 광역시의 군 — 권역 줄이면 줄 전체(표 밖 권역 · 제 구역이 없는 군의 목록 권역)
                metroGun && land.any { it.kind == Kind.REGIONAL || (it.kind == Kind.LISTED && !ownZone) } -> Match.HIT
                land.any { it.kind == Kind.REGIONAL || it.kind == Kind.STRANGE } -> Match.UNSURE
                else -> Match.MISS
            }
            withClue("${c.area} × ${c.place}") {
                got shouldBe expected
                if (!named && land.any { it.kind == Kind.STRANGE }) got shouldNotBe Match.MISS
            }
        }
    }

    /**
     * 제외 줄은 위 생성기에서 다섯에 하나라 제 하위 권역만 뺀 줄(전제)이 200회 중 평균 8회뿐이고 0회인 시드도 있다(실측 — 시드 2,000개의
     * 5~95 백분위 4~13회) — 같은 생성기를 제외 줄로만 돌린다(평균 43회 · 5~95 백분위 33~53회 · 최소 21회).
     */
    "제외 줄 — 제 시군 전체 이름이나 하위 권역 전부를 빼면 안 걸림, 하위 권역 일부만 빼면 절대 안 걸림이 아니다(모름), 둘 다 없으면 걸림(G-SA-19·24)" {
        checkAll(cases.map { it.copy(area = it.area.copy(excluding = true)) }) { c ->
            val got = WeatherAlerts.match(c.area, c.place)
            val land = c.zones.filter { it.kind != Kind.SEA }
            withClue("${c.area} × ${c.place}") {
                got shouldBe excludedExpected(land, c.place)
                if (land.none { it.kind == Kind.OWN } && land.any { it.kind == Kind.PART } && !allParts(land, c.place)) got shouldNotBe Match.MISS
            }
        }
    }

    "생성기의 낯선 이름은 어느 광역에서도 표에 없는 이름이다 — 위 오라클의 전제" {
        WeatherAlerts.CITY_STEMS.keys.forEach { province ->
            STRANGE.forEach { name -> withClue("$province $name") { WeatherAlerts.zoneKind(province, name) shouldBe WeatherAlerts.ZoneKind.UNKNOWN } }
        }
    }
})

/**
 * 생성기가 붙인 하위 구역의 갈래 — 제 시군(전체 이름) · 제 시군의 하위 권역 · 다른 시군 · 광역 권역(지어낸 이름 — 표 밖) · 목록의 광역시 권역
 * (인천영종 · 대구중부 …) · 섬 구역 · 관서 묶음 구역 · 바다 · 낯선 이름.
 */
private enum class Kind { OWN, PART, OTHER, REGIONAL, LISTED, ISLAND, CROSS, SEA, STRANGE }

private data class Zone(val name: String, val kind: Kind)

private data class Case(val place: Place, val zones: List<Zone>, val area: WarningArea)

/** 구역 개편으로 생길 법한 낯선 이름 — 어느 광역의 시군 어간으로도 광역 이름으로도 시작하지 않는다(위 전제 검사가 지킨다). */
private val STRANGE = listOf("북동산지", "중부산간", "남부내륙", "서부평야", "동부해안", "내륙북부")

/** 제 구역이 있는 광역시의 군 — 오라클의 리터럴(구현 표를 다시 부르지 않는다 · 목록 대조는 `WeatherAlertsZoneListTest`). */
private val OWN_ZONE_GUN = setOf("강화", "옹진", "군위", "달성")

/** 공식 목록의 광역시 권역(인천 · 대구) — 제 구역이 있는 군을 덮지 않는다. 오라클의 리터럴이다. */
private val LISTED_REGIONS = mapOf(Province.INCHEON to listOf("인천", "인천영종", "인천남부", "인천북부"), Province.DAEGU to listOf("대구중부"))

/**
 * 규칙 9 의 정답 — 제 시군 전체 이름을 뺐으면 안 걸림, 제 하위 권역만 뺐으면 모름, 둘 다 없으면 나열 밖이라 걸림. 섬·관서 묶음 구역은
 * 생성기의 목적지를 덮지 않아(아래 생성기) 나열 밖이다 — 덮는 섬(시군 전체면 안 걸림 · 일부면 걸림)과 시군 전체를 뺐어도 광역 줄 안의 그
 * 시군 섬이 남는 경우(모름 — [WeatherAlerts.LINE_ISLANDS])는 리터럴 표와 공식 목록 대조가 본다.
 */
private fun excludedExpected(land: List<Zone>, place: Place): Match = when {
    land.any { it.kind == Kind.OWN } -> Match.MISS
    allParts(land, place) -> Match.MISS // 하위 권역을 전부 뺐다 — 시군 전체(G-SA-24)
    land.any { it.kind == Kind.PART } -> Match.UNSURE
    else -> Match.HIT
}

/** 나열이 그 시군의 공식 하위 권역을 전부 담는가 — 오라클은 공식 목록에서 읽는다(구현 표 `CITY_PARTS` 를 다시 부르지 않는다). */
private fun allParts(land: List<Zone>, place: Place): Boolean =
    OFFICIAL_PARTS[place.provinces.single()]?.get(place.stem)?.let { parts -> land.map { it.name }.containsAll(parts) } == true

private val OFFICIAL_PARTS = officialCityParts()

/**
 * 광역 하나(도 · 군이 있는 광역시) · 그 광역의 시군·군 목적지 하나 · 그 광역 줄(하위 구역 1~4 · 다섯에 하나는 제외 줄). 목적지 코드는
 * 실재하지 않는 값이라 섬·관서 묶음 구역은 늘 '덮지 않는 구역'이다(덮는 경우는 리터럴 표가 본다). 관서 묶음 구역 가운데 그 광역 이름으로
 * 시작하는 것(부산 줄의 `부산동부`)은 권역이라, 제 어간으로 시작하는 것(인천 줄 × 강화의 `강화`)은 제 시군이라 뺀다. 제 시군은 전체 이름
 * (어간 · 어간+시/군)과 하위 권역(어간 + 다른 꼬리)으로 나눠 붙인다. 군이 하나뿐인 광역시(부산·울산)는 다른 시군이 없다.
 */
private val cases: Arb<Case> = arbitrary {
    val province = Arb.element(WeatherAlerts.CITY_STEMS.keys.toList()).bind()
    val stems = WeatherAlerts.CITY_STEMS.getValue(province).toList()
    val own = Arb.element(stems).bind()
    val others = stems.filterNot { it.startsWith(own) }
    val cross = WeatherAlerts.CROSS_ZONES.keys.filterNot { it.startsWith(province.label) || it.startsWith(own) }
    val suffix = Arb.element("", "평지", "산지", "동부", "남부", "시평지")
    val kinds = Kind.entries.filter { (it != Kind.OTHER || others.isNotEmpty()) && (it != Kind.LISTED || province in LISTED_REGIONS) }
    val zone = arbitrary {
        when (Arb.element(kinds).bind()) {
            Kind.OWN -> Zone(own + Arb.element("", "시", "군").bind(), Kind.OWN)
            Kind.PART -> Zone(own + Arb.element("평지", "산지", "동부", "남부", "시평지", "도서", "(도서제외)").bind(), Kind.PART)
            Kind.OTHER -> Zone(Arb.element(others).bind() + suffix.bind(), Kind.OTHER)
            Kind.REGIONAL -> Zone(province.label + Arb.element("북부산지", "중부산지", "남부내륙").bind(), Kind.REGIONAL)
            Kind.LISTED -> Zone(Arb.element(LISTED_REGIONS.getValue(province)).bind(), Kind.LISTED)
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
