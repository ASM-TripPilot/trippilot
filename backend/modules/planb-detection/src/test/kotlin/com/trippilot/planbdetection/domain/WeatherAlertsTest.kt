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
import io.kotest.matchers.collections.shouldContain
import io.kotest.matchers.shouldBe
import java.io.File
import java.time.LocalDate

/**
 * 특보 목적지 매칭 · 종류 → 변형 · 그 날의 목적지(BR-SA-16 — 순수). 기대값은 리터럴 표다.
 *
 * 매칭 규칙: 하위 구역 이름이 시군 어간으로 시작하면 그 구역 / 광역 목적지는 그 광역 줄 전체 / 바다·해상 구역은 무시 /
 * 광역 별칭(강원도↔강원특별자치도 · 전라북도↔전북특별자치도) / `(…제외)` 는 나열한 곳을 뺀 광역 전체(시군 전체를 뺐을 때만 그 시군이
 * 빠진다) / 섬·관서 묶음 구역은 닫힌 표(줄의 광역보다 먼저) / 다른 광역 줄은 안 걸림(t6 는 행정 광역 줄 — 관서 묶음 꼴의 흔적이 보이면 종전대로) /
 * 표에 없는 최상위 이름과 도의 시군 × 산지 권역 · 도의 시군·광역시의 군 × 표에 없는 하위 구역 이름 · 제외 줄 × 그 하위 권역만 뺀 시군 · 제외 줄 ×
 * 시군 전체를 뺐어도 광역 줄 안의 그 시군 섬이 남는 시군 · 관서 묶음 꼴 줄 × 그 묶음의 다른 광역 목적지는 모름(UNSURE — 하위 권역을 전부
 * 뺀 제외 줄은 시군 전체라 안 걸림 —
 * '특보 없음'으로 확인하지 않는다). 공식 특보구역 목록 대조는 [WeatherAlertsZoneListTest] 가 본다.
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
        mapOf("26710" to "기장군", "27710" to "달성군", "27720" to "군위군", "28710" to "강화군", "28720" to "옹진군", "31710" to "울주군")
            .forEach { (code, name) -> withClue(code) { WeatherAlerts.placeOf(code, name)!!.wide shouldBe false } }
        // 서울에는 군이 없다 — 송파구·강동구는 코드 셋째 자리가 7 이어도 구다
        WeatherAlerts.placeOf("11710", "송파구") shouldBe Place("11710", setOf(Province.SEOUL), stem = "송파", wide = true, label = "서울")
        WeatherAlerts.placeOf("11740", "강동구") shouldBe Place("11740", setOf(Province.SEOUL), stem = "강동", wide = true, label = "서울")
    }

    /** 군 여부는 코드가 정한다(표시 이름은 접미 없이 올 수 있다) — 시드의 시군구 전부에서 그 판정이 이름 끝 '군'과 같아야 한다. */
    "특별·광역시·제주에서 줄 전체로 맞추지 않는 것은 군뿐이다 — 시드의 시군구 전부에서 코드 판정이 이름 끝 '군'과 같다" {
        val rows = seedSigungu()
        rows.map { it.first } shouldContain "11710" // 시드를 실제로 읽었다
        rows.forEach { (code, name) ->
            val place = WeatherAlerts.placeOf(code, name)!!
            withClue("$code $name") { place.wide shouldBe (place.provinces.single().wide && !name.endsWith("군")) }
        }
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

    "섬 구역 표(닫힌 표) — 구역 → 그 섬이 속한 시군 코드(백령도.대청도 · 연평도.우도는 서해5도를 나눈 구역)" {
        WeatherAlerts.ISLANDS shouldBe mapOf(
            "울릉도.독도" to "47940", "서해5도" to "28720", "흑산도.홍도" to "12870", "거문도.초도" to "12130", "추자도" to "50110",
            "백령도.대청도" to "28720", "연평도.우도" to "28720",
        )
    }

    "관서 묶음 구역 표(닫힌 표) — 묶음과 행정 광역이 다른 하위 구역 → 시군 코드(5자리) · 광역 코드(2자리)" {
        WeatherAlerts.CROSS_ZONES shouldBe mapOf(
            "강화" to "28710", "옹진" to "28720", "군위" to "27720", "대전" to "30",
            "부산동부" to "26", "부산중부" to "26", "부산서부" to "26", "울산동부" to "31", "울산서부" to "31",
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

    /**
     * 시군 어간 표는 행정구역 시드에서 줄 전체로 맞추지 않는 목적지(도의 시군 · 광역시의 군)의 어간을 [WeatherAlerts.placeOf] 와 같은 규칙으로
     * 뽑은 닫힌 표다. 시드가 바뀌었는데(시군 신설·개명·통합) 표를 그대로 두면 새 시군의 구역 이름이 '모르는 이름'이 되어 그 광역의 시군·군
     * 목적지가 모두 모름으로 떨어진다.
     */
    "시군 어간 표는 행정구역 시드와 같다(도의 시군 · 광역시의 군) — 시드가 바뀌면 표도 고친다" {
        val fromSeed = seedSigungu()
            .mapNotNull { (code, name) -> WeatherAlerts.placeOf(code, name) }
            .filterNot { it.wide }
            .groupBy({ it.provinces.single() }, { it.stem!! })
            .mapValues { (_, stems) -> stems.toSet() }

        WeatherAlerts.CITY_STEMS shouldBe fromSeed
        // 도마다 · 군이 있는 광역시마다 있다
        WeatherAlerts.CITY_STEMS.keys shouldBe
            Province.entries.filterNot { it.wide }.toSet() + setOf(Province.BUSAN, Province.DAEGU, Province.INCHEON, Province.ULSAN)
    }

    "하위 구역 갈래 — 바다 · 섬 구역 · 광역 권역 · 그 광역의 시군 어간 · 관서 묶음 구역 · 모름" {
        listOf(
            Triple(Province.GYEONGBUK, "울진산지", WeatherAlerts.ZoneKind.CITY),
            Triple(Province.GYEONGBUK, "경주동부", WeatherAlerts.ZoneKind.CITY),
            Triple(Province.GYEONGBUK, "경북북동산지", WeatherAlerts.ZoneKind.REGIONAL),
            Triple(Province.GYEONGBUK, "울릉도.독도", WeatherAlerts.ZoneKind.ISLAND),
            Triple(Province.GYEONGBUK, "동해남부앞바다", WeatherAlerts.ZoneKind.SEA),
            Triple(Province.GYEONGBUK, " 북동산지", WeatherAlerts.ZoneKind.UNKNOWN),
            Triple(Province.GANGWON, "강릉시평지", WeatherAlerts.ZoneKind.CITY),
            Triple(Province.GANGWON, "강원중부산지", WeatherAlerts.ZoneKind.REGIONAL),
            Triple(Province.GANGWON, "영동북부", WeatherAlerts.ZoneKind.UNKNOWN), // 충북 영동은 강원의 시군이 아니다
            Triple(Province.GYEONGNAM, "고성", WeatherAlerts.ZoneKind.CITY),
            Triple(Province.GYEONGGI, "남양주", WeatherAlerts.ZoneKind.CITY),
            Triple(Province.JEONNAM, "신안(흑산면제외)", WeatherAlerts.ZoneKind.CITY),
            Triple(Province.JEONNAM, "흑산도.홍도", WeatherAlerts.ZoneKind.ISLAND),
            Triple(Province.BUSAN, "부산동부", WeatherAlerts.ZoneKind.REGIONAL),
            // 관서 묶음 구역 — 묶음 줄(경기·충남·경북·경남)에서는 표 이름이다
            Triple(Province.GYEONGGI, "강화", WeatherAlerts.ZoneKind.CROSS),
            Triple(Province.GYEONGGI, "백령도.대청도", WeatherAlerts.ZoneKind.ISLAND),
            Triple(Province.CHUNGNAM, "대전", WeatherAlerts.ZoneKind.CROSS),
            Triple(Province.GYEONGBUK, "군위", WeatherAlerts.ZoneKind.CROSS),
            Triple(Province.GYEONGNAM, "울산서부", WeatherAlerts.ZoneKind.CROSS),
            Triple(Province.GYEONGGI, "강화군", WeatherAlerts.ZoneKind.CROSS), // 접미가 붙어도 그 구역
            Triple(Province.GYEONGBUK, "군위군", WeatherAlerts.ZoneKind.CROSS),
            // 광역시의 군 어간 · 그 밖의 이름(시·구만 있는 광역은 어간 표가 없다)
            Triple(Province.INCHEON, "강화", WeatherAlerts.ZoneKind.CITY),
            Triple(Province.DAEGU, "달성북부", WeatherAlerts.ZoneKind.CITY),
            Triple(Province.BUSAN, "동해안권", WeatherAlerts.ZoneKind.UNKNOWN),
            Triple(Province.JEJU, "서귀포시동부", WeatherAlerts.ZoneKind.UNKNOWN),
        ).forEach { (province, zone, kind) -> withClue("$province $zone") { WeatherAlerts.zoneKind(province, zone) shouldBe kind } }
    }

    "표로 가릴 수 없는 이름 — 모르는 최상위 이름 · 도·광역시 줄의 모르는 하위 구역(시·구만 있는 광역 줄의 하위 구역은 보지 않는다)" {
        WeatherAlerts.unknownNames(WarningArea("전남광주통합특별시", listOf("목포"))) shouldBe listOf("전남광주통합특별시")
        WeatherAlerts.unknownNames(WarningArea("경상북도", listOf("포항", " 북동산지", "경북북동산지", "울릉도.독도", "울진산지"))) shouldBe
            listOf("북동산지")
        WeatherAlerts.unknownNames(WarningArea("경상북도", listOf("북동산지"), excluding = true)) shouldBe listOf("북동산지")
        WeatherAlerts.unknownNames(WarningArea("부산", listOf("동해안권", "부산동부"))) shouldBe listOf("동해안권") // 군(기장)이 있는 광역시
        // 제 광역 줄 밖에 나온 표 이름 — 실응답에서는 늘 제 광역 줄에 나왔다(관서 묶음 꼴 = t6 형식 변화 · G-SA-18)
        WeatherAlerts.unknownNames(WarningArea("경기도", listOf("강화", "백령도.대청도", "김포"))) shouldBe listOf("강화", "백령도.대청도")
        WeatherAlerts.unknownNames(WarningArea("경기도", listOf("강화군", "옹진군"))) shouldBe listOf("강화군", "옹진군") // 접미가 붙어도
        WeatherAlerts.unknownNames(WarningArea("인천", listOf("강화", "옹진", "인천영종"))) shouldBe emptyList() // 제 광역 줄 — 실응답 꼴
        WeatherAlerts.unknownNames(WarningArea("전라남도", listOf("흑산도.홍도", "목포"))) shouldBe emptyList() // 제 광역의 섬
        WeatherAlerts.unknownNames(WarningArea("서울", listOf("도심권"))) shouldBe emptyList() // 줄 전체로만 맞춘다
        WeatherAlerts.unknownNames(WarningArea("제주도", listOf("서귀포시동부"))) shouldBe emptyList()
        WeatherAlerts.unknownNames(WarningArea("동해중부먼바다")) shouldBe emptyList()
        WeatherAlerts.unknownNames(WarningArea("울릉도.독도")) shouldBe emptyList()
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
        val gimpo = WeatherAlerts.placeOf("41570", "김포시")!!
        val daejeon = WeatherAlerts.placeOf("30", "대전광역시")!!
        val yuseong = WeatherAlerts.placeOf("30200", "유성구")!!
        val cheonan = WeatherAlerts.placeOf("44130", "천안시")!!
        val changwon = WeatherAlerts.placeOf("48120", "창원시")!!
        val ulju = WeatherAlerts.placeOf("31710", "울주군")!!
        val uljin = WeatherAlerts.placeOf("47930", "울진군")!!
        val gyeongbukWide = WeatherAlerts.placeOf("47", "경상북도")!!
        val boryeong = WeatherAlerts.placeOf("44180", "보령시")!!
        val geumsan = WeatherAlerts.placeOf("44710", "금산군")!!
        val taean = WeatherAlerts.placeOf("44825", "태안군")!!
        val yeoju = WeatherAlerts.placeOf("41670", "여주시")!!
        val gunsan = WeatherAlerts.placeOf("52130", "군산시")!!

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
            // 제외 줄의 섬 구역도 표로(규칙 9) — 시군의 일부인 섬(서해5도 = 옹진의 섬)을 빼면 본토가 남아 걸림, 시군 전체인 섬을 빼면 그 시군이 빠진다
            Triple(WarningArea("인천", listOf("서해5도"), excluding = true), ongjin, HIT),
            Triple(WarningArea("경상북도", listOf("울릉도.독도"), excluding = true), ulleung, MISS), // 울릉도.독도 = 울릉군 전체
            Triple(WarningArea("백령도.대청도"), ongjin, HIT), // 서해5도를 나눈 구역(2026-06-01 개편)
            Triple(WarningArea("백령도.대청도"), incheon, HIT),
            Triple(WarningArea("연평도.우도"), seohae, MISS),
            Triple(WarningArea("연평도.우도"), jeju, MISS), // 옹진의 우도 — 제주 우도가 아니다
            // 규칙 3 — 관서 묶음 구역은 줄의 광역보다 먼저 표의 코드로(경기 묶음의 강화는 인천 강화군), 그 도의 다른 목적지에는 아는 이름
            Triple(WarningArea("경기도", listOf("강화", "김포")), ganghwa, HIT),
            Triple(WarningArea("경기도", listOf("강화", "김포")), gimpo, HIT),
            Triple(WarningArea("경기도", listOf("강화")), gimpo, MISS),
            Triple(WarningArea("경기도", listOf("강화")), incheon, HIT), // 그 시군이 속한 광역 목적지
            Triple(WarningArea("경기도", listOf("강화")), ongjin, MISS),
            Triple(WarningArea("경기도", listOf("옹진", "백령도.대청도")), ongjin, HIT),
            Triple(WarningArea("경상북도", listOf("군위")), gunwi, HIT),
            Triple(WarningArea("경상북도", listOf("군위")), dalseong, MISS),
            Triple(WarningArea("경상북도", listOf("군위")), pohang, MISS),
            Triple(WarningArea("충청남도", listOf("대전")), daejeon, HIT), // 광역 코드 — 그 광역 전부
            Triple(WarningArea("충청남도", listOf("대전")), yuseong, HIT),
            Triple(WarningArea("충청남도", listOf("대전")), cheonan, MISS),
            Triple(WarningArea("경상남도", listOf("부산동부")), haeundae, HIT),
            Triple(WarningArea("경상남도", listOf("부산서부")), gijang, HIT), // 광역 코드 — 군도 든다(규칙 7 의 권역 줄과 같다)
            Triple(WarningArea("경상남도", listOf("울산서부")), ulju, HIT),
            Triple(WarningArea("경상남도", listOf("부산동부", "울산동부")), changwon, MISS),
            Triple(WarningArea("경기도", listOf("강화"), excluding = true), ganghwa, MISS), // 제외 줄 — 덮는 구역(강화)을 다 뺐다(규칙 4)
            // 규칙 3 — 관서 묶음 구역은 접미가 붙어도 그 구역이다
            Triple(WarningArea("경기도", listOf("강화군", "김포")), ganghwa, HIT),
            Triple(WarningArea("경기도", listOf("옹진군")), ongjin, HIT),
            Triple(WarningArea("경상북도", listOf("군위군")), gunwi, HIT),
            // 규칙 4 — t6 의 광역 줄은 행정 광역이다(G-SA-18 — 실응답 2026-10-16~22: 강화·옹진은 `인천(…)`, 군위는 `대구(군위)`, 대전·울산은
            // 제 줄). 관서 묶음 줄(경기·충남·경북·경남)도 그 묶음의 다른 광역 목적지에 안 걸린다 — 다만 그 꼴의 흔적(그 묶음의 다른 광역 구역 이름 ·
            // 낯선 이름)이 보이면 G-SA-18 전 규칙대로 모름이다
            Triple(WarningArea("경상남도"), haeundae, MISS), // 하위 구역 없는 줄
            Triple(WarningArea("경상남도"), ulju, MISS),
            Triple(WarningArea("충청남도"), yuseong, MISS),
            Triple(WarningArea("경상북도"), gunwi, MISS),
            Triple(WarningArea("경기도"), incheon, MISS), // 광역 목적지
            Triple(WarningArea("경상북도"), dalseong, MISS),
            Triple(WarningArea("경기도", listOf("가평")), yeonsu, MISS),
            Triple(WarningArea("경상남도"), pohang, MISS), // 묶음 밖 광역
            Triple(WarningArea("경상남도", listOf("거제"), excluding = true), ulju, MISS),
            Triple(WarningArea("경기도", listOf("가평"), excluding = true), ganghwa, MISS),
            Triple(WarningArea("경기도", listOf("강화군"), excluding = true), ganghwa, MISS),
            Triple(WarningArea("경기도", listOf("옹진"), excluding = true), ongjin, UNSURE), // 관서 묶음 꼴 — 옹진의 섬 구역(서해5도 …)이 남는다
            Triple(WarningArea("경상남도", listOf("부산동부", "부산중부", "부산서부"), excluding = true), haeundae, MISS),
            Triple(WarningArea("경기도", listOf("가평", "교동도")), ganghwa, UNSURE), // 낯선 이름이 낀 묶음 줄 — 관서 묶음 꼴일 수 있다(교동도는 강화군 교동면)
            Triple(WarningArea("경상남도", listOf("부산동부"), excluding = true), ulju, UNSURE), // 관서 묶음 꼴 제외 줄 — 울산 권역은 빼지 않았다
            Triple(WarningArea("경상남도", listOf("부산동부"), excluding = true), haeundae, UNSURE), // 부산중부·서부가 남는다
            Triple(WarningArea("경상북도", listOf("경북북동산지")), gunwi, MISS), // 권역이 낀 줄도 다른 광역(대구)이다
            Triple(WarningArea("경기도", listOf("가평", "양평")), ganghwa, MISS), // 아는 이름뿐 — 그 구역이 아니다
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
            // 규칙 8 — 도의 시군은 그 도의 시군 어간으로도 광역 이름으로도 시작하지 않는 이름(구역 개편)이 끼면 모름(G-SA-16 결정)
            Triple(WarningArea("경상북도", listOf("북동산지")), pohang, UNSURE),
            Triple(WarningArea("경상북도", listOf("울진산지")), pohang, MISS), // 다른 시군 이름으로 시작 — 그 시군이다
            Triple(WarningArea("경상북도", listOf("울진산지", "북동산지")), pohang, UNSURE), // 아는 이름과 섞여도 모름
            Triple(WarningArea("경상북도", listOf("포항", "북동산지")), pohang, HIT), // 제 이름이 있으면 걸림
            Triple(WarningArea("경상북도", listOf("북동산지"), excluding = true), pohang, HIT), // 제외 줄은 그대로 — 나열 밖은 걸린다
            Triple(WarningArea("경상북도", listOf("울릉도.독도", "영덕")), pohang, MISS), // 섬 구역·다른 시군뿐
            Triple(WarningArea("강원도", listOf("영동북부")), gangneung, UNSURE), // 충북 영동은 강원의 시군이 아니다 — 도마다 표가 따로다
            Triple(WarningArea("경상남도", listOf("고성")), namhae, MISS), // 경남 고성(동명) — 그 시군이다
            // 규칙 7 — 광역시의 구는 표에 없는 이름이 있어도 줄 전체, 광역시의 군은 군 어간·광역 이름·표·바다 어디에도 안 드는 이름이 끼면 모름
            Triple(WarningArea("부산", listOf("동해안권")), haeundae, HIT),
            Triple(WarningArea("부산", listOf("동해안권")), gijang, UNSURE),
            Triple(WarningArea("부산", listOf("동해안권"), excluding = true), gijang, HIT), // 제외 줄은 그대로
            Triple(WarningArea("대구", listOf("달성북부")), dalseong, HIT),
            Triple(WarningArea("대구", listOf("대구중부")), dalseong, MISS), // 제 구역(달성 · 달성북부 · 달성남부)이 있는 군 — 권역이 덮지 않는다
            Triple(WarningArea("대구", listOf("대구중부")), gunwi, MISS),
            Triple(WarningArea("인천", listOf("인천", "인천영종")), ganghwa, MISS), // `인천`(L1110100)도 그 광역의 권역이다
            Triple(WarningArea("인천", listOf("인천영종", "교동권")), ganghwa, UNSURE), // 낯선 이름은 그대로 모름
            Triple(WarningArea("인천", listOf("인천서부권")), ganghwa, HIT), // 표 밖 권역 — 범위를 모르니 규칙 7 그대로 줄 전체
            Triple(WarningArea("대구", listOf("인천영종")), dalseong, UNSURE), // 남의 광역 권역 이름은 거르지 않는다(낯선 이름)
            Triple(WarningArea("대구", listOf("군위", "남부권")), dalseong, UNSURE),
            Triple(WarningArea("인천", listOf("옹진", "서해5도")), ganghwa, MISS), // 다른 군·섬 구역뿐
            // 규칙 9 — 제외 줄은 시군 전체 이름(어간 · 어간+시/군)일 때만 그 시군을 뺀다. 개편 목록은 시군을 권역으로 나눴다 — 하위 권역만
            // 뺐으면 목적지가 뺀 쪽에 있는지 이름으로 가릴 수 없어 모름이다(G-SA-19 · INV-SA-2)
            Triple(WarningArea("경상북도", listOf("경주동부"), excluding = true), gyeongju, UNSURE), // 경주의 나머지 권역은 특보 중이다
            Triple(WarningArea("경상북도", listOf("경주"), excluding = true), gyeongju, MISS),
            Triple(WarningArea("경상북도", listOf("경주시"), excluding = true), gyeongju, MISS),
            Triple(WarningArea("경상북도", listOf("경주동부", "경주"), excluding = true), gyeongju, MISS), // 시군 이름이 있으면 시군째
            Triple(WarningArea("경상북도", listOf("경주동부"), excluding = true), pohang, HIT), // 다른 시군의 권역 — 나열 밖
            Triple(WarningArea("경상북도", listOf("울진평지"), excluding = true), uljin, UNSURE),
            // 권역을 다 적으면 공식 목록의 시군 권역 표로 그 시군 전부인지 가린다(G-SA-24 결정 2026-10-23 — 종전에는 이름으로 몰라 모름)
            Triple(WarningArea("경상북도", listOf("경주중북부", "경주동부", "경주남부", "경주서부"), excluding = true), gyeongju, MISS), // 4권역을 다 뺐다 — 시군 전체(G-SA-24)
            Triple(WarningArea("강원도", listOf("강릉시평지"), excluding = true), gangneung, UNSURE), // 어간+시 뒤에 꼬리 — 하위 권역
            Triple(WarningArea("전라남도", listOf("신안(흑산면제외)"), excluding = true), sinan, UNSURE), // 이름 안 괄호 — 시군의 일부
            Triple(WarningArea("대구", listOf("달성북부"), excluding = true), dalseong, UNSURE), // 광역시의 군도 같다
            Triple(WarningArea("대구", listOf("달성"), excluding = true), dalseong, MISS),
            Triple(WarningArea("인천", listOf("강화군"), excluding = true), ganghwa, MISS),
            Triple(WarningArea("제주도", listOf("제주도산지"), excluding = true), jejuCity, UNSURE), // 어간(제주)으로 시작 — 제주시의 일부일 수 있다
            Triple(WarningArea("인천", listOf("서해5도"), excluding = true), seohae, HIT), // 섬 구역은 앞붙음이 아니라 표로 — 서해구는 서해5도가 아니다
            // 시군의 일부인 섬을 빼면 본토가 남아 걸림 — 섬에만 내린 특보도 걸림(규칙 3)이라 섬을 뺀 나머지 전부가 모름이면 뒤집힌다
            Triple(WarningArea("제주도", listOf("추자도"), excluding = true), jejuCity, HIT),
            Triple(WarningArea("제주도", listOf("추자도"), excluding = true), jeju, HIT), // 광역 목적지 — 나머지 제주가 걸린다(규칙 5)
            Triple(WarningArea("전라남도", listOf("거문도.초도"), excluding = true), yeosu, HIT),
            // 거꾸로 시군 전체 이름을 빼도 광역 줄 안의 그 시군 섬(거문도.초도 = 여수)은 남는다 — 모름(실응답: 섬이 `전라남도(…)` 안에 나온다)
            Triple(WarningArea("전라남도", listOf("여수"), excluding = true), yeosu, UNSURE),
            Triple(WarningArea("전라남도", listOf("여수", "거문도.초도"), excluding = true), yeosu, MISS),
            Triple(WarningArea("전라남도", listOf("여수"), excluding = true), mokpo, HIT),
            Triple(WarningArea("전라남도", listOf("신안군"), excluding = true), sinan, UNSURE), // 흑산도.홍도(= 신안)가 남는다
            Triple(WarningArea("전라남도", listOf("신안군", "흑산도.홍도"), excluding = true), sinan, MISS),
            Triple(WarningArea("제주도", listOf("제주시"), excluding = true), jejuCity, UNSURE), // 추자도(= 제주시)가 남는다
            Triple(WarningArea("인천", listOf("옹진"), excluding = true), ongjin, MISS), // 서해5도는 제 줄로 나온다 — 인천 줄의 섬이 아니다
            Triple(WarningArea("전라남도", listOf("흑산도.홍도"), excluding = true), sinan, HIT),
            Triple(WarningArea("경상북도", listOf("울릉도.독도"), excluding = true), gyeongbukWide, HIT), // 시군 전체인 섬은 그 시군만 — 나머지 경북
            // 관서 묶음 꼴 제외 줄(제 광역 밖 이름을 뺀다) — 덮는 구역을 전체 이름으로 다 뺐을 때만 안 걸림(규칙 4) · 제 광역 줄이면 규칙 9 그대로다
            Triple(WarningArea("경기도", listOf("강화동부"), excluding = true), ganghwa, UNSURE),
            Triple(WarningArea("경상북도", listOf("군위남부"), excluding = true), gunwi, UNSURE),
            Triple(WarningArea("인천", listOf("강화동부"), excluding = true), ganghwa, UNSURE),
            Triple(WarningArea("대구", listOf("군위남부"), excluding = true), gunwi, UNSURE),
            // 실응답 줄(2026-10-16~22 특보 통보문 — weather-context `public-data/kma_t6_wrn_msg_20261016_20261022.txt`)
            Triple(WarningArea("인천", listOf("옹진"), excluding = true), ganghwa, HIT),
            Triple(WarningArea("인천", listOf("강화"), excluding = true), ganghwa, MISS),
            Triple(WarningArea("대구", listOf("군위")), gunwi, HIT),
            Triple(WarningArea("인천", listOf("옹진", "인천영종")), ganghwa, MISS), // 제 구역이 있는 군 — 영종 강풍경보로 강화를 경보하지 않는다
            Triple(WarningArea("인천", listOf("옹진", "인천영종")), ongjin, HIT),
            Triple(WarningArea("인천", listOf("옹진", "인천영종")), yeonsu, HIT), // 광역시의 구 — 줄 전체(규칙 7)
            Triple(WarningArea("인천", listOf("강화", "인천남부", "인천북부")), ongjin, MISS),
            Triple(WarningArea("인천", listOf("강화", "인천남부", "인천북부")), ganghwa, HIT),
            Triple(WarningArea("인천", listOf("강화", "인천북부")), ongjin, MISS),
            Triple(WarningArea("충청남도", listOf("금산"), excluding = true), geumsan, MISS),
            Triple(WarningArea("충청남도", listOf("금산"), excluding = true), cheonan, HIT),
            Triple(WarningArea("충청남도", listOf("금산"), excluding = true), daejeon, MISS), // 대전은 제 줄로 나온다(G-SA-18)
            Triple(WarningArea("충청남도", listOf("태안", "당진", "서산", "서천", "보령(도서제외)", "보령도서", "홍성서부")), boryeong, HIT),
            Triple(WarningArea("충청남도", listOf("태안", "당진", "서산", "서천", "보령(도서제외)", "보령도서", "홍성서부")), taean, HIT),
            Triple(WarningArea("충청남도", listOf("태안", "당진", "서산", "서천", "보령(도서제외)", "보령도서", "홍성서부")), cheonan, MISS),
            Triple(WarningArea("충청남도", listOf("태안", "당진", "서산", "서천", "보령(도서제외)", "보령도서", "홍성서부")), daejeon, MISS),
            Triple(WarningArea("전라남도", listOf("흑산도.홍도")), sinan, HIT), // 섬 구역이 광역 줄 안에도 나온다(규칙 3)
            Triple(WarningArea("전라남도", listOf("흑산도.홍도")), mokpo, MISS),
            Triple(WarningArea("전라남도", listOf("신안(흑산면제외)", "무안북부")), sinan, HIT),
            Triple(WarningArea("서해5도", listOf("백령도.대청도")), ongjin, HIT),
            Triple(WarningArea("서해5도", listOf("연평도.우도")), ganghwa, MISS),
            Triple(WarningArea("서울", listOf("서울동남권"), excluding = true), seoul, HIT),
            Triple(WarningArea("경기도", listOf("하남", "이천", "광주", "여주동남부", "여주서부", "양평동부", "양평서부"), excluding = true), gimpo, HIT),
            // 여주는 하위 권역 둘(여주동남부·여주서부)을 다 뺐다 — 시 전체를 뺀 것이라 안 걸림(G-SA-24 결정 2026-10-23)
            Triple(WarningArea("경기도", listOf("하남", "이천", "광주", "여주동남부", "여주서부", "양평동부", "양평서부"), excluding = true), yeoju, MISS),
            Triple(WarningArea("경기도", listOf("여주동남부"), excluding = true), yeoju, UNSURE), // 일부만 뺐다 — 종전대로 모름
            Triple(WarningArea("강원도", listOf("강릉평지", "강릉산지"), excluding = true), gangneung, MISS),
            Triple(WarningArea("강원도", listOf("강릉산지"), excluding = true), gangneung, UNSURE),
            Triple(WarningArea("전북자치도", listOf("군산(옥도면 제외)", "군산옥도면(어청도 제외)"), excluding = true), gunsan, UNSURE), // 군산어청도가 남는다
            Triple(WarningArea("전북자치도", listOf("군산(옥도면 제외)", "군산옥도면(어청도 제외)", "군산어청도"), excluding = true), gunsan, MISS),
            Triple(WarningArea("경기도", listOf("하남", "이천", "광주", "여주동남부", "여주서부", "양평동부", "양평서부"), excluding = true), ganghwa, MISS),
            Triple(WarningArea("제주도", listOf("서귀포시남부", "서귀포시중산간"), excluding = true), seogwipo, UNSURE),
            Triple(WarningArea("제주도", listOf("서귀포시남부", "서귀포시중산간"), excluding = true), jejuCity, HIT),
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

    /** 0박 목적지는 박수로 펼치면 어느 날에도 오지 않는다(마지막이 아니면) — 지나가는 날의 일정이 그곳에 있어도 그 특보를 못 본다. */
    "0박 목적지는 지나가는 날(앞 목적지 박수 합 + 1일째)에 든다 — 당일치기 둘 · 옮기는 날의 경유지" {
        val day = LocalDate.parse("2026-10-19")
        val pohang = TripDestinationRef("포항시", "47110", 0)
        val gyeongju = TripDestinationRef("경주시", "47130", 0)
        WeatherAlerts.destinationsOn(listOf(pohang, gyeongju), day, day) shouldBe listOf(gyeongju, pohang)

        val seoul = TripDestinationRef("서울특별시", "11", 1)
        val daejeon = TripDestinationRef("대전광역시", "30", 0)
        val busan = TripDestinationRef("부산광역시", "26", 1)
        val refs = listOf(seoul, daejeon, busan)
        WeatherAlerts.destinationsOn(refs, day, day) shouldBe listOf(seoul)
        WeatherAlerts.destinationsOn(refs, day, day.plusDays(1)) shouldBe listOf(busan, seoul, daejeon)
        WeatherAlerts.destinationsOn(refs, day, day.plusDays(2)) shouldBe listOf(busan)
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

/** 행정구역 시드의 시군구 행 — (코드, 이름). 공식 목록 대조([WeatherAlertsZoneListTest])도 섬 구역이 속한 시군의 이름을 여기서 읽는다. */
internal fun seedSigungu(): List<Pair<String, String>> {
    val seed = repoFile("backend/app/src/main/resources/db/migration/R__seed_region_catalog.sql").readText()
    return Regex("""\('(\d{5})', '([^']+)', '\d{2}', '[^']+', 'SIGUNGU', (?:true|false)\)""").findAll(seed)
        .map { it.groupValues[1] to it.groupValues[2] }.toList()
}

/** 모노레포 루트 기준 파일 — 모듈 위치가 바뀌어도 견디게 위로 올라가며 찾는다(ReplanMaterialTest 와 같은 방식). */
private fun repoFile(relative: String): File {
    var dir: File? = File(System.getProperty("user.dir")).absoluteFile
    while (dir != null) {
        File(dir, relative).takeIf { it.isFile }?.let { return it }
        dir = dir.parentFile
    }
    error("$relative 을 찾지 못했습니다. user.dir=${System.getProperty("user.dir")}")
}
