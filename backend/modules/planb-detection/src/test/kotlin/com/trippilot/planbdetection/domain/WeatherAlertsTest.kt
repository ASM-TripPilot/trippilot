package com.trippilot.planbdetection.domain

import com.trippilot.planbdetection.domain.WeatherAlerts.Match.HIT
import com.trippilot.planbdetection.domain.WeatherAlerts.Match.MISS
import com.trippilot.planbdetection.domain.WeatherAlerts.Match.UNSURE
import com.trippilot.planbdetection.domain.WeatherAlerts.Place
import com.trippilot.planbdetection.domain.WeatherAlerts.Province
import com.trippilot.trip.api.TripDestinationRef
import com.trippilot.weathercontext.api.WarningArea
import io.kotest.assertions.withClue
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import java.time.LocalDate

/**
 * 특보 목적지 매칭 · 종류 → 변형 · 그 날의 목적지(BR-SA-16 — 순수). 기대값은 리터럴 표다.
 *
 * 매칭 규칙: 하위 구역 이름이 시군 어간으로 시작하면 그 구역 / 광역 목적지는 그 광역 줄 전체 / 바다·해상 구역은 무시 /
 * 광역 별칭(강원도↔강원특별자치도 · 전라북도↔전북특별자치도) / `(…제외)` 는 나열한 곳을 뺀 광역 전체 / 섬 구역은 닫힌 표 /
 * 표에 없는 최상위 이름과 도의 시군 × 산지 권역은 모름(UNSURE — '특보 없음'으로 확인하지 않는다).
 */
class WeatherAlertsTest : StringSpec({

    "목적지 코드 → 매칭용 목적지 — 광역 목적지는 어간이 없고, 특별·광역시·제주의 시·구는 광역 줄 전체로, 광역시의 군은 어간으로 맞춘다" {
        WeatherAlerts.placeOf("11", "서울특별시") shouldBe Place("11", setOf(Province.SEOUL), stem = null, wide = true, label = "서울")
        WeatherAlerts.placeOf("50", "제주") shouldBe Place("50", setOf(Province.JEJU), stem = null, wide = true, label = "제주")
        WeatherAlerts.placeOf("47110", "포항시") shouldBe Place("47110", setOf(Province.GYEONGBUK), stem = "포항", wide = false, label = "포항")
        WeatherAlerts.placeOf("51150", "강릉") shouldBe Place("51150", setOf(Province.GANGWON), stem = "강릉", wide = false, label = "강릉")
        WeatherAlerts.placeOf("26350", "해운대구") shouldBe Place("26350", setOf(Province.BUSAN), stem = "해운대", wide = true, label = "부산")
        WeatherAlerts.placeOf("26110", "중구") shouldBe Place("26110", setOf(Province.BUSAN), stem = null, wide = true, label = "부산")
        WeatherAlerts.placeOf("50130", "서귀포시") shouldBe Place("50130", setOf(Province.JEJU), stem = "서귀포", wide = true, label = "제주")
        WeatherAlerts.placeOf("41111", "수원시 장안구") shouldBe Place("41111", setOf(Province.GYEONGGI), stem = "수원", wide = false, label = "수원")
        WeatherAlerts.placeOf("12210", "동구") shouldBe Place("12210", setOf(Province.GWANGJU), stem = null, wide = true, label = "광주")
        WeatherAlerts.placeOf("12110", "목포시") shouldBe Place("12110", setOf(Province.JEONNAM), stem = "목포", wide = false, label = "목포")
        // 광역시의 군 — 군 여부는 코드가 정한다(표시 이름이 접미 없이 와도 군이다)
        WeatherAlerts.placeOf("28710", "강화군") shouldBe Place("28710", setOf(Province.INCHEON), stem = "강화", wide = false, label = "인천")
        WeatherAlerts.placeOf("28710", "강화") shouldBe Place("28710", setOf(Province.INCHEON), stem = "강화", wide = false, label = "인천")
        WeatherAlerts.placeOf("26710", "기장군") shouldBe Place("26710", setOf(Province.BUSAN), stem = "기장", wide = false, label = "부산")
        WeatherAlerts.placeOf("28275", "서해구") shouldBe Place("28275", setOf(Province.INCHEON), stem = "서해", wide = true, label = "인천")
    }

    "시도 코드 → 특보 광역 — 17 시도 전부 · 통합특별시(12) 시도 단위는 광주·전남 둘 다 · t6 의 광역 이름(별칭 포함)" {
        mapOf(
            "11" to Province.SEOUL, "26" to Province.BUSAN, "27" to Province.DAEGU, "28" to Province.INCHEON, "30" to Province.DAEJEON,
            "31" to Province.ULSAN, "36" to Province.SEJONG, "50" to Province.JEJU, "41" to Province.GYEONGGI, "51" to Province.GANGWON,
            "43" to Province.CHUNGBUK, "44" to Province.CHUNGNAM, "52" to Province.JEONBUK, "47" to Province.GYEONGBUK, "48" to Province.GYEONGNAM,
        ).forEach { (code, province) -> Province.ofRegionCode(code) shouldBe setOf(province) }
        Province.ofRegionCode("12") shouldBe setOf(Province.GWANGJU, Province.JEONNAM)
        Province.ofRegionCode("99") shouldBe null

        mapOf(
            "서울" to Province.SEOUL, "부산" to Province.BUSAN, "대구" to Province.DAEGU, "인천" to Province.INCHEON, "광주" to Province.GWANGJU,
            "대전" to Province.DAEJEON, "울산" to Province.ULSAN, "세종" to Province.SEJONG, "제주도" to Province.JEJU, "경기도" to Province.GYEONGGI,
            "강원도" to Province.GANGWON, "강원특별자치도" to Province.GANGWON, "충청북도" to Province.CHUNGBUK, "충청남도" to Province.CHUNGNAM,
            "전라북도" to Province.JEONBUK, "전북특별자치도" to Province.JEONBUK, "전라남도" to Province.JEONNAM, "경상북도" to Province.GYEONGBUK,
            "경상남도" to Province.GYEONGNAM,
        ).forEach { (name, province) -> Province.ofKmaName(name) shouldBe province }
        Province.ofKmaName("울릉도.독도") shouldBe null
        Province.ofKmaName("동해중부안쪽먼바다") shouldBe null
        Province.ofKmaName("전남광주통합특별시") shouldBe null
    }

    "섬 구역 표(닫힌 표) — 구역 → 그 섬이 속한 시군 코드" {
        WeatherAlerts.ISLANDS shouldBe mapOf(
            "울릉도.독도" to "47940", "서해5도" to "28720", "흑산도.홍도" to "12870", "거문도.초도" to "12130", "추자도" to "50110",
        )
    }

    "아는 최상위 구역 이름 — 광역 · 섬 구역 · 바다. 그 밖(통합 이름 · 전각 괄호 · 끝 마침표)은 모르는 이름이다" {
        listOf("경상북도", "강원특별자치도", "울산", "울릉도.독도", "서해5도", "동해중부안쪽먼바다", "남해서부해상").forEach {
            withClue(it) { WeatherAlerts.isKnownArea(WarningArea(it)) shouldBe true }
        }
        listOf("전남광주통합특별시", "경상북도（포항）", "울산.", "경북특별자치도").forEach {
            withClue(it) { WeatherAlerts.isKnownArea(WarningArea(it)) shouldBe false }
        }
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
        val donghae = WeatherAlerts.placeOf("51170", "동해시")!!
        val namhae = WeatherAlerts.placeOf("48840", "남해군")!!
        val seohae = WeatherAlerts.placeOf("28275", "서해구")!!
        val ongjin = WeatherAlerts.placeOf("28720", "옹진군")!!
        val jejuCity = WeatherAlerts.placeOf("50110", "제주시")!!
        val seogwipo = WeatherAlerts.placeOf("50130", "서귀포시")!!
        val sinan = WeatherAlerts.placeOf("12870", "신안군")!!
        val yeosu = WeatherAlerts.placeOf("12130", "여수시")!!
        val pyeongchang = WeatherAlerts.placeOf("51760", "평창군")!!
        val gijang = WeatherAlerts.placeOf("26710", "기장군")!!
        val dalseong = WeatherAlerts.placeOf("27710", "달성군")!!
        val gunwi = WeatherAlerts.placeOf("27720", "군위군")!!

        val gyeongbuk = WarningArea("경상북도", listOf("영덕", "포항", "울진평지", "울진산지", "경주동부"))
        val mountains = WarningArea("강원도", listOf("강원중부산지", "강원남부산지"))
        listOf(
            Triple(gyeongbuk, pohang, HIT), // 하위 구역 이름에 시군 어간
            Triple(gyeongbuk, gyeongju, HIT), // '경주동부' 도 경주로 시작한다
            Triple(WarningArea("경기도", listOf("남양주", "가평")), yangju, MISS), // 어간이 가운데에 든 것은 아니다 — 남양주 ⊅ 양주
            Triple(WarningArea("경기도", listOf("양주", "포천")), yangju, HIT),
            Triple(WarningArea("경상북도", listOf("영덕")), pohang, MISS),
            Triple(WarningArea("서울"), seoul, HIT), // 광역 목적지 — 그 광역 줄 전체
            Triple(WarningArea("서울", listOf("서울동남권")), seoul, HIT),
            Triple(WarningArea("부산", listOf("부산동부")), haeundae, HIT), // 광역시의 구 — 구역명에 구 이름이 없다
            Triple(WarningArea("부산"), pohang, MISS),
            Triple(WarningArea("인천", listOf("강화군", "옹진군"), excluding = true), incheon, HIT), // 제외 — 나머지 인천 전체
            Triple(WarningArea("인천", listOf("강화군", "옹진군"), excluding = true), ganghwa, MISS),
            Triple(WarningArea("인천", listOf("강화군", "옹진군"), excluding = true), yeonsu, HIT),
            Triple(WarningArea("인천", listOf("강화")), ganghwa, HIT),
            Triple(WarningArea("울릉도.독도"), ulleung, HIT), // 광역 밖 구역(섬)
            Triple(WarningArea("울릉도.독도"), pohang, MISS),
            Triple(WarningArea("제주도", listOf("제주도산지")), jeju, HIT),
            Triple(WarningArea("동해중부안쪽먼바다"), gangneung, MISS), // 바다
            Triple(WarningArea("제주도남쪽먼바다"), jeju, MISS),
            Triple(WarningArea("남해서부해상"), mokpo, MISS), // 해상
            // 바다 구역 이름이 시군 어간으로 시작해도 바다다 — 동해 앞바다 풍랑이 동해시 육지 일정에 걸리면 안 된다
            Triple(WarningArea("동해중부안쪽먼바다"), donghae, MISS),
            Triple(WarningArea("남해동부앞바다"), namhae, MISS),
            Triple(WarningArea("강원도", listOf("동해시평지")), donghae, HIT),
            Triple(WarningArea("제주도", listOf("제주도앞바다")), jeju, MISS), // 바다 구역뿐
            Triple(WarningArea("강원도", listOf("강릉시평지", "강원북부산지")), gangneung, HIT), // 별칭 강원도
            Triple(WarningArea("강원특별자치도", listOf("강릉시평지")), gangneung, HIT),
            Triple(WarningArea("전라북도", listOf("전주")), jeonju, HIT), // 별칭 전라북도
            Triple(WarningArea("전북자치도", listOf("전주")), jeonju, HIT),
            Triple(WarningArea("경상남도", listOf("고성")), goseongGangwon, MISS), // 동명 시군 — 광역이 다르다
            Triple(WarningArea("강원도", listOf("고성군평지")), goseongGangwon, HIT),
            Triple(WarningArea("광주"), gwangjuDong, HIT),
            Triple(WarningArea("전라남도", listOf("여수")), gwangjuDong, MISS),
            Triple(WarningArea("전라남도", listOf("목포", "여수")), mokpo, HIT),
            Triple(WarningArea("광주"), mokpo, MISS),
            Triple(WarningArea("경상북도"), pohang, HIT), // 하위 구역 없는 도 — 그 광역 전체
            // 규칙 2 — 표에 없는 최상위 이름은 어디인지 모른다(통합 이름 · 전각 괄호 · 끝 마침표)
            Triple(WarningArea("전남광주통합특별시", listOf("목포")), mokpo, UNSURE),
            Triple(WarningArea("전남광주통합특별시", listOf("광주", "나주")), gwangjuDong, UNSURE),
            Triple(WarningArea("경상북도（포항）"), pohang, UNSURE),
            Triple(WarningArea("울산."), pohang, UNSURE),
            // 규칙 3 — 섬 구역은 표로 그 섬의 시군과 그 광역 목적지에만(앞붙음이 아니다 — 서해구 ≠ 서해5도)
            Triple(WarningArea("서해5도"), seohae, MISS),
            Triple(WarningArea("서해5도"), ongjin, HIT),
            Triple(WarningArea("서해5도"), incheon, HIT),
            Triple(WarningArea("추자도"), jeju, HIT),
            Triple(WarningArea("추자도"), jejuCity, HIT),
            Triple(WarningArea("추자도"), seogwipo, MISS),
            Triple(WarningArea("흑산도.홍도"), sinan, HIT),
            Triple(WarningArea("흑산도.홍도"), mokpo, MISS),
            Triple(WarningArea("거문도.초도"), yeosu, HIT),
            Triple(WarningArea("전라남도", listOf("신안(흑산면제외)", "진도")), sinan, HIT), // 이름 안 괄호는 이름의 일부 — 어간으로 맞는다
            Triple(WarningArea("전라남도", listOf("신안(흑산면제외)", "진도")), mokpo, MISS),
            Triple(WarningArea("인천", listOf("서해5도")), ongjin, HIT), // 줄 안의 섬 구역도 같은 표
            Triple(WarningArea("인천", listOf("서해5도")), ganghwa, MISS),
            Triple(WarningArea("인천", listOf("서해5도"), excluding = true), ongjin, HIT), // 섬 하나를 뺀다고 옹진 전체가 빠지지 않는다
            Triple(WarningArea("경상북도", listOf("울릉도.독도"), excluding = true), ulleung, MISS), // 어간으로 나열 — 울릉이 빠진다
            // 규칙 7 — 광역시의 군은 어간으로, 권역 줄(부산동부)이면 줄 전체
            Triple(WarningArea("인천", listOf("옹진")), ganghwa, MISS),
            Triple(WarningArea("인천", listOf("옹진")), yeonsu, HIT),
            Triple(WarningArea("부산", listOf("부산동부")), gijang, HIT),
            Triple(WarningArea("대구", listOf("군위")), dalseong, MISS),
            Triple(WarningArea("대구", listOf("군위")), gunwi, HIT),
            // 규칙 8 — 도의 시군은 광역 하위 권역(산지)만 남으면 모름(덮는지 가릴 수 없다)
            Triple(mountains, pyeongchang, UNSURE),
            Triple(mountains, gangneung, UNSURE),
            Triple(WarningArea("강원도", listOf("평창군평지", "강원중부산지")), pyeongchang, HIT),
            Triple(WarningArea("강원도", listOf("강릉시평지")), pyeongchang, MISS),
            Triple(WarningArea("경상북도", listOf("경북북동산지")), pohang, UNSURE),
            Triple(mountains, pohang, MISS), // 광역이 다르다
        ).forEach { (area, place, expected) ->
            withClue(area, place) { WeatherAlerts.match(area, place) shouldBe expected }
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

private fun withClue(area: WarningArea, place: Place, block: () -> Unit) = withClue("$area × $place") { block() }
