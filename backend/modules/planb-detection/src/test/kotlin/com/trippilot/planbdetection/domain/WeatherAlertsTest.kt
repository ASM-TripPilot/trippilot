package com.trippilot.planbdetection.domain

import com.trippilot.planbdetection.domain.WeatherAlerts.Place
import com.trippilot.planbdetection.domain.WeatherAlerts.Province
import com.trippilot.trip.api.TripDestinationRef
import com.trippilot.weathercontext.api.WarningArea
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import java.time.LocalDate

/**
 * 특보 목적지 매칭 · 종류 → 변형 · 그 날의 목적지(BR-SA-16 — 순수). 기대값은 리터럴 표다.
 *
 * 매칭 규칙: 하위 구역 이름이 시군 어간으로 시작하면 그 구역 / 광역 목적지는 그 광역 줄 전체 / 바다·해상 구역은 무시 /
 * 광역 별칭(강원도↔강원특별자치도 · 전라북도↔전북특별자치도) / `(…제외)` 는 나열한 곳을 뺀 광역 전체.
 */
class WeatherAlertsTest : StringSpec({

    "목적지 코드 → 매칭용 목적지 — 광역 목적지는 어간이 없고, 특별·광역시·제주의 시군구는 광역 줄 전체로 맞춘다" {
        WeatherAlerts.placeOf("11", "서울특별시") shouldBe Place(setOf(Province.SEOUL), stem = null, wide = true, label = "서울")
        WeatherAlerts.placeOf("50", "제주") shouldBe Place(setOf(Province.JEJU), stem = null, wide = true, label = "제주")
        WeatherAlerts.placeOf("47110", "포항시") shouldBe Place(setOf(Province.GYEONGBUK), stem = "포항", wide = false, label = "포항")
        WeatherAlerts.placeOf("51150", "강릉") shouldBe Place(setOf(Province.GANGWON), stem = "강릉", wide = false, label = "강릉")
        WeatherAlerts.placeOf("26350", "해운대구") shouldBe Place(setOf(Province.BUSAN), stem = "해운대", wide = true, label = "부산")
        WeatherAlerts.placeOf("26110", "중구") shouldBe Place(setOf(Province.BUSAN), stem = null, wide = true, label = "부산")
        WeatherAlerts.placeOf("50130", "서귀포시") shouldBe Place(setOf(Province.JEJU), stem = "서귀포", wide = true, label = "제주")
        WeatherAlerts.placeOf("41111", "수원시 장안구") shouldBe Place(setOf(Province.GYEONGGI), stem = "수원", wide = false, label = "수원")
        WeatherAlerts.placeOf("12210", "동구") shouldBe Place(setOf(Province.GWANGJU), stem = null, wide = true, label = "광주")
        WeatherAlerts.placeOf("12110", "목포시") shouldBe Place(setOf(Province.JEONNAM), stem = "목포", wide = false, label = "목포")
    }

    "모르는 코드는 매칭할 수 없다 — null" {
        WeatherAlerts.placeOf("99", "어딘가") shouldBe null
        WeatherAlerts.placeOf("4711", "포항") shouldBe null
        WeatherAlerts.placeOf("", "제주") shouldBe null
    }

    "특보 구역 매칭표(BR-SA-16)" {
        val pohang = WeatherAlerts.placeOf("47110", "포항시")!!
        val gyeongju = WeatherAlerts.placeOf("47130", "경주시")!!
        val yangju = WeatherAlerts.placeOf("41630", "양주시")!!
        val seoul = WeatherAlerts.placeOf("11", "서울특별시")!!
        val haeundae = WeatherAlerts.placeOf("26350", "해운대구")!!
        val incheon = WeatherAlerts.placeOf("28", "인천광역시")!!
        val ganghwa = WeatherAlerts.placeOf("28710", "강화군")!!
        val yeonsu = WeatherAlerts.placeOf("28185", "연수구")!!
        val ulleung = WeatherAlerts.placeOf("47940", "울릉군")!!
        val jeju = WeatherAlerts.placeOf("50", "제주")!!
        val gangneung = WeatherAlerts.placeOf("51150", "강릉시")!!
        val jeonju = WeatherAlerts.placeOf("52110", "전주시")!!
        val goseongGangwon = WeatherAlerts.placeOf("51820", "고성군")!!
        val gwangjuDong = WeatherAlerts.placeOf("12210", "동구")!!
        val mokpo = WeatherAlerts.placeOf("12110", "목포시")!!

        val gyeongbuk = WarningArea("경상북도", listOf("영덕", "포항", "울진평지", "울진산지", "경주동부"))
        listOf(
            Triple(gyeongbuk, pohang, true), // 하위 구역 이름에 시군 어간
            Triple(gyeongbuk, gyeongju, true), // '경주동부' 도 경주로 시작한다
            Triple(WarningArea("경기도", listOf("남양주", "가평")), yangju, false), // 어간이 가운데에 든 것은 아니다 — 남양주 ⊅ 양주
            Triple(WarningArea("경기도", listOf("양주", "포천")), yangju, true),
            Triple(WarningArea("경상북도", listOf("영덕")), pohang, false),
            Triple(WarningArea("서울"), seoul, true), // 광역 목적지 — 그 광역 줄 전체
            Triple(WarningArea("서울", listOf("서울동남권")), seoul, true),
            Triple(WarningArea("부산", listOf("부산동부")), haeundae, true), // 광역시 시군구 — 구역명에 시군명이 없다
            Triple(WarningArea("부산"), pohang, false),
            Triple(WarningArea("인천", listOf("강화군", "옹진군"), excluding = true), incheon, true), // 제외 — 나머지 인천 전체
            Triple(WarningArea("인천", listOf("강화군", "옹진군"), excluding = true), ganghwa, false),
            Triple(WarningArea("인천", listOf("강화군", "옹진군"), excluding = true), yeonsu, true),
            Triple(WarningArea("인천", listOf("강화")), ganghwa, true),
            Triple(WarningArea("울릉도.독도"), ulleung, true), // 광역 밖 구역(섬)
            Triple(WarningArea("울릉도.독도"), pohang, false),
            Triple(WarningArea("제주도", listOf("제주도산지")), jeju, true),
            Triple(WarningArea("동해중부안쪽먼바다"), gangneung, false), // 바다
            Triple(WarningArea("제주도남쪽먼바다"), jeju, false),
            Triple(WarningArea("남해서부해상"), mokpo, false), // 해상
            Triple(WarningArea("제주도", listOf("제주도앞바다")), jeju, false), // 바다 구역뿐
            Triple(WarningArea("강원도", listOf("강릉시평지", "강원북부산지")), gangneung, true), // 별칭 강원도
            Triple(WarningArea("강원특별자치도", listOf("강릉시평지")), gangneung, true),
            Triple(WarningArea("전라북도", listOf("전주")), jeonju, true), // 별칭 전라북도
            Triple(WarningArea("전북자치도", listOf("전주")), jeonju, true),
            Triple(WarningArea("경상남도", listOf("고성")), goseongGangwon, false), // 동명 시군 — 광역이 다르다
            Triple(WarningArea("강원도", listOf("고성군평지")), goseongGangwon, true),
            Triple(WarningArea("광주"), gwangjuDong, true),
            Triple(WarningArea("전라남도", listOf("여수")), gwangjuDong, false),
            Triple(WarningArea("전라남도", listOf("목포", "여수")), mokpo, true),
            Triple(WarningArea("광주"), mokpo, false),
            Triple(WarningArea("경상북도"), pohang, true), // 하위 구역 없는 도 — 그 광역 전체
        ).forEach { (area, place, expected) ->
            withClue(area, place) { WeatherAlerts.covers(area, place) shouldBe expected }
        }
    }

    "종류 → 변형 — 호우 RAIN · 대설 SNOW · 강풍·태풍 WIND · 한파 COLD · 폭염 HEAT · 황사 DUST, 풍랑·폭풍해일·건조는 무시" {
        WeatherAlerts.WARNING_VARIANTS shouldBe mapOf(
            "호우" to TriggerVariant.RAIN, "대설" to TriggerVariant.SNOW, "강풍" to TriggerVariant.WIND, "태풍" to TriggerVariant.WIND,
            "한파" to TriggerVariant.COLD, "폭염" to TriggerVariant.HEAT, "황사" to TriggerVariant.DUST,
        )
        WeatherAlerts.IGNORED_WARNINGS shouldBe setOf("풍랑", "폭풍해일", "건조")
    }

    "그 날의 목적지 — 박수로 펼치고, 옮기는 날은 전날 목적지도 본다(아침 일정이 아직 전 목적지에 있다)" {
        val seoul = TripDestinationRef("서울특별시", "11", 2)
        val busan = TripDestinationRef("부산광역시", "26", 2)
        val start = LocalDate.parse("2026-10-19")
        val refs = listOf(seoul, busan)

        WeatherAlerts.destinationsOn(refs, start, start) shouldBe listOf(seoul)
        WeatherAlerts.destinationsOn(refs, start, start.plusDays(1)) shouldBe listOf(seoul)
        WeatherAlerts.destinationsOn(refs, start, start.plusDays(2)) shouldBe listOf(busan, seoul) // 옮기는 날
        WeatherAlerts.destinationsOn(refs, start, start.plusDays(3)) shouldBe listOf(busan)
        WeatherAlerts.destinationsOn(refs, start, start.plusDays(4)) shouldBe listOf(busan) // 체크아웃일 — 마지막 목적지
    }

    "당일치기(0박)·목적지 없음" {
        val jeju = TripDestinationRef("제주", "50", 0)
        val day = LocalDate.parse("2026-10-19")

        WeatherAlerts.destinationsOn(listOf(jeju), day, day) shouldBe listOf(jeju)
        WeatherAlerts.destinationsOn(emptyList(), day, day) shouldBe emptyList()
    }

    "에어코리아 등급 순위 — 문자열 그대로 읽고 모르는 등급은 null" {
        WeatherAlerts.airRank("좋음") shouldBe 0
        WeatherAlerts.airRank("보통") shouldBe 1
        WeatherAlerts.airRank("나쁨") shouldBe 2
        WeatherAlerts.airRank("매우나쁨") shouldBe 3
        WeatherAlerts.airRank("예보없음") shouldBe null
        WeatherAlerts.airRank(null) shouldBe null
    }

    "영향 슬롯 주어 — 이름이 있으면 '{이름} 일정이'·'{이름} 등 야외 일정 N곳이', 없으면 '야외 일정 한 곳이'·'야외 일정 N곳이'" {
        WeatherAlerts.affectedPhrase("호미곶", 1) shouldBe "호미곶 일정이"
        WeatherAlerts.affectedPhrase("호미곶", 2) shouldBe "호미곶 등 야외 일정 2곳이"
        WeatherAlerts.affectedPhrase(null, 1) shouldBe "야외 일정 한 곳이"
        WeatherAlerts.affectedPhrase(" ", 3) shouldBe "야외 일정 3곳이"
    }
})

private fun withClue(area: WarningArea, place: Place, block: () -> Unit) = io.kotest.assertions.withClue("$area × $place") { block() }
