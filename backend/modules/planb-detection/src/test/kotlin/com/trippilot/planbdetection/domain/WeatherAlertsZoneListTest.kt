package com.trippilot.planbdetection.domain

import com.trippilot.planbdetection.domain.WeatherAlerts.Match
import com.trippilot.planbdetection.domain.WeatherAlerts.Place
import com.trippilot.planbdetection.domain.WeatherAlerts.Province
import com.trippilot.planbdetection.domain.WeatherAlerts.ZoneKind
import com.trippilot.weathercontext.api.WarningArea
import io.kotest.assertions.withClue
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldBeEmpty
import io.kotest.matchers.shouldBe
import io.kotest.matchers.shouldNotBe

/**
 * 특보구역 공식 목록 대조(BR-SA-16 · G-SA-16 결정 2026-10-20 — 특보 켜기 전 개편 목록 전체 대조). 매칭 표(광역 이름 · 섬 구역 · 관서 묶음
 * 구역 · 시군 어간)가 공식 육상 구역 이름을 아는지 본다 — 모르는 이름은 모름(경보도 '특보 없음' 확인도 아님)과 WARN 이 된다.
 *
 * 출처: 공공데이터포털 `기상청_기상특보구역정보_20260601`(데이터셋 15043573 · 기상청 국가기후데이터센터 · 등록 2026-06-18 · 수정
 * 2026-06-23 · 기준일 2026-06-01). 이용허락: 공공저작물 자유이용(공공누리 제0유형). 원본 CSV(CP949 · 육상 300 · 바다 113)를 UTF-8 로 바꿔
 * 육상(코드 `L`)만 남겼다 — `public-data/kma_warning_zones_20260601.csv`. 코드가 `0000` 으로 끝나는 줄이 관서 묶음 머리이고 앞 네 자리가
 * 같은 줄이 그 묶음의 하위 구역이다. 묶음은 발표 관서 기준이라 행정 광역과 다를 수 있다(경기 묶음의 인천 강화·옹진 — 관서 묶음 구역 표).
 *
 * 개편으로 목록이 바뀌면 새 파일로 다시 돌린다.
 */
class WeatherAlertsZoneListTest : StringSpec({

    val rows = officialZones()
    val heads = rows.filter { it.head }
    val groups = rows.filterNot { it.head }.groupBy { zone -> heads.single { it.group == zone.group } }

    "목록을 읽었다 — 육상 300 · 관서 묶음 머리 18" {
        rows.size shouldBe 300
        heads.map { it.name } shouldBe listOf(
            "경기도", "강원도", "충청남도", "충청북도", "전라남도", "전북자치도", "경상북도", "경상남도", "제주도",
            "서울", "인천", "대전", "광주", "대구", "부산", "울산", "세종", "울릉도.독도",
        )
    }

    "관서 묶음 머리 이름은 전부 아는 최상위 이름이다 — 아니면 규칙 2 로 모든 목적지가 모름" {
        heads.forEach { withClue(it.name) { WeatherAlerts.isKnownArea(WarningArea(it.name)) shouldBe true } }
    }

    "육상 하위 구역은 전부 아는 이름이다 — 묶음 광역 기준 갈래가 모름이 아니다(예외는 아래 목록뿐)" {
        val unknown = groups.flatMap { (head, zones) ->
            val province = Province.ofKmaName(head.name)
            zones.map { it.name }.filter { province == null || WeatherAlerts.zoneKind(province, it) == ZoneKind.UNKNOWN }
        }
        unknown shouldBe NOT_READ_BY_NAME
    }

    "도 묶음에 든 다른 광역 구역(섬 구역 · 관서 묶음 구역 표의 코드가 다른 광역)은 묶음 표와 같다 — 규칙 4 의 모름이 이 표로 가린다" {
        val fromList = groups.mapNotNull { (head, zones) ->
            val province = Province.ofKmaName(head.name) ?: return@mapNotNull null
            val others = zones.map { it.name }.filter { name ->
                val code = WeatherAlerts.ISLANDS[name] ?: WeatherAlerts.CROSS_ZONES[name]
                code != null && province !in Province.ofRegionCode(code).orEmpty()
            }
            others.takeIf { it.isNotEmpty() }?.let { province to it.toSet() }
        }.toMap()

        WeatherAlerts.CROSS_GROUPS shouldBe fromList
    }

    "묶음 하나를 한 줄로 읽어도 모르는 이름 WARN 이 나지 않는다" {
        groups.forEach { (head, zones) ->
            withClue(head.name) { WeatherAlerts.unknownNames(WarningArea(head.name, zones.map { it.name })).shouldBeEmpty() }
        }
    }

    /**
     * 개편 목록은 시군을 권역으로 나눴다 — 코드 끝 두 자리가 `00` 이 아닌 줄이 앞 여섯 자리가 같은 `00` 줄(시군)의 하위 권역이다
     * (`경주` L1073100 → `경주동부` L1073120). 그 권역 하나만 뺀 제외 줄을 그 시군째 빼면 나머지 권역의 특보를 '특보 없음'으로 확인한다
     * (G-SA-19 · INV-SA-2). 시군 이름을 뺀 줄은 대조군이다 — 그 시군은 안 걸림이다. 이름으로 맞추는 시군(시군 어간 표)만 본다 — 인천·광주·
     * 세종의 권역은 시군이 아니라 광역을 나눈 것이고, 제주의 시는 표에 없다(G-SA-20).
     */
    "시군의 하위 권역 하나만 뺀 제외 줄은 그 시군 목적지에 안 걸림이 아니다 — 시군 이름을 뺀 줄은 안 걸림" {
        val parts = rows.filterNot { it.head || it.code.endsWith("00") }.mapNotNull { zone ->
            val head = heads.single { it.group == zone.group }
            val province = Province.ofKmaName(head.name) ?: return@mapNotNull null
            val city = rows.single { it.code == zone.code.take(6) + "00" }.name
            if (city !in WeatherAlerts.CITY_STEMS[province].orEmpty()) return@mapNotNull null
            Triple(head.name, Place("00000", setOf(province), city, wide = false, label = city), zone.name)
        }

        parts.size shouldBe 88 // 경기 10 · 강원 22 · 충남 4 · 충북 2 · 전남 16 · 전북 5 · 경북 15 · 경남 12 · 대구 2
        parts.forEach { (head, place, zone) ->
            withClue("$head($zone 제외) × ${place.stem}") {
                WeatherAlerts.match(WarningArea(head, listOf(zone), excluding = true), place) shouldNotBe Match.MISS
            }
            withClue("$head(${place.stem} 제외) × ${place.stem}") {
                WeatherAlerts.match(WarningArea(head, listOf(place.stem!!), excluding = true), place) shouldBe Match.MISS
            }
        }
    }
})

/**
 * 표가 모르는 공식 하위 구역 — 제주의 시 구역뿐이다. 제주의 시는 광역 줄 전체로 맞춰(규칙 7) 하위 구역 갈래를 보지 않으므로 시군 어간 표에
 * 없다(WARN 도 내지 않는다 — 위). 제주의 시를 어간으로 맞추기로 하면(정본 결정) 표에 넣고 이 목록을 비운다.
 */
private val NOT_READ_BY_NAME = listOf("서귀포시(산지 제외)", "서귀포시서부", "서귀포시남부", "서귀포시동부", "서귀포시중산간")

/** 공식 목록의 육상 구역 한 줄 — [group] 은 코드 앞 네 자리(관서 묶음), [head] 는 묶음 머리(코드 끝 `0000`). */
private data class OfficialZone(val code: String, val name: String) {
    val group: String = code.take(4)
    val head: Boolean = code.endsWith("0000")
}

private fun officialZones(): List<OfficialZone> =
    object {}.javaClass.getResource("/public-data/kma_warning_zones_20260601.csv")!!.readText().lines().drop(1).filter { it.isNotBlank() }
        .map { line -> line.split(',').let { (_, code, name) -> OfficialZone(code, name) } }
        .filter { it.code.startsWith("L") }
