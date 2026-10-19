package com.trippilot.planbdetection.domain

import com.trippilot.trip.api.TripDestinationRef
import com.trippilot.weathercontext.api.AirRegion
import com.trippilot.weathercontext.api.WarningArea
import java.time.LocalDate
import java.time.temporal.ChronoUnit

/**
 * 기상특보·대기질 판정의 순수 재료(BR-SA-16) — 특보 목적지 매칭 · 종류 → 변형 · 그 날의 목적지 · 대기질 등급 순위. 조회·저장을 하지 않는다.
 *
 * **특보 목적지 매칭** — 특보현황 `t6` 의 구역(`경상북도(영덕, 포항)` · `울산` · `인천(강화군, 옹진군 제외)` · `울릉도.독도`)을 여행 목적지와
 * 맞춰 **걸림 · 안 걸림 · 모름** 셋으로 답한다([Match]). 모름은 '특보 없음'으로 확인하지 않는다는 뜻이다(INV-SA-2).
 * 1. 바다·해상 구역은 무시한다(바다 특보는 육지 일정과 무관하다).
 * 2. 최상위 이름이 광역도 섬 구역도 바다도 아니면 모름이다 — 행정 통합·구역 개편·형식 변화로 생긴 이름을 '안 걸림'으로 접으면 거짓
 *    해제가 된다(anti-patterns — 모르는 어휘는 크게 실패시킨다). 감지기가 그 이름을 WARN 으로 드러낸다.
 * 3. 섬 구역은 닫힌 표([ISLANDS])로 그 섬이 속한 시군과 그 광역 목적지에만 걸린다 — 이름 앞붙음으로 맞추지 않는다(`서해5도` 는 서해구가
 *    아니라 옹진이다). 하위 구역에 섬 구역이 나와도 같은 표로 본다.
 * 4. 광역이 다르면 걸리지 않는다 — 광역 별칭(강원도 ↔ 강원특별자치도 · 전라북도 ↔ 전북특별자치도)은 같은 광역이다.
 * 5. 광역 목적지(서울·부산·제주 등)는 그 광역 줄 전체가 걸린다. 하위 구역 없는 광역 줄은 그 광역 전체다.
 * 6. 시군 목적지는 하위 구역 이름이 **시군 어간으로 시작**하면 걸린다(`강릉` → `강릉시평지`, `경주` → `경주동부`). 정본은 '들어가면'이지만
 *    시작으로 좁힌다 — `남양주` 에 `양주` 가 들어 있어 양주 여행이 남양주 특보에 걸린다.
 * 7. 특별·광역시와 제주의 시·구(해운대구·서귀포시 …)는 광역 목적지처럼 그 광역 줄 전체로 맞춘다 — 그 광역의 구역 이름(`부산동부` ·
 *    `제주도남부`)에 시·구 이름이 없어 6 으로는 영영 걸리지 않는다(광역 목적지 규칙의 근거와 같다). 과잉 경보는 관찰 전용 출발이 잰다(BR-SA-04).
 *    광역시의 **군**(강화·옹진·기장 …)은 6 으로 맞춘다 — 구역 이름에 군 이름이 나온다(`인천(강화)`). 다만 그 줄에 광역 이름으로 시작하는
 *    권역(`부산동부`)이 있으면 그 군이 들었을 수 있어 줄 전체로 맞춘다(7 의 근거와 같다).
 * 8. 도의 시군은 6 으로 안 걸려도 그 줄에 광역 이름으로 시작하는 권역(`강원중부산지` · `경북북동산지`)이 있으면 모름이다 — 그 권역이 시군을
 *    덮는지 이름으로 가릴 수 없다(평창의 평지만 풀리고 대관령 경보가 남은 회차). 권역 → 시군 표로 걸지는 정본 결정이다.
 * 9. `(…제외)` 는 나열한 구역을 뺀 그 광역 전체다 — 시군 어간으로 나열됐을 때만 그 시군이 빠진다(섬 하나를 뺀다고 시군 전체가 빠지지 않는다).
 */
object WeatherAlerts {

    /** 특보 종류 → 변형(BR-SA-16 · CD6) — 특보로 생긴 신호는 모두 위험이다. */
    val WARNING_VARIANTS: Map<String, TriggerVariant> = mapOf(
        "호우" to TriggerVariant.RAIN, "대설" to TriggerVariant.SNOW, "강풍" to TriggerVariant.WIND, "태풍" to TriggerVariant.WIND,
        "한파" to TriggerVariant.COLD, "폭염" to TriggerVariant.HEAT, "황사" to TriggerVariant.DUST,
    )

    /** 무시하는 특보 — 바다(풍랑·폭풍해일)와 건조는 일정을 막지 않는다(BR-SA-16). 그 밖의 모르는 종류는 무시하지 않는다(감지기가 모름으로 둔다). */
    val IGNORED_WARNINGS: Set<String> = setOf("풍랑", "폭풍해일", "건조")

    /** 대표 우선순위 — 단기예보와 같은 축(SNOW > RAIN > WIND > COLD > HEAT, `WeatherHazards.PRECEDENCE`) 뒤에 DUST. */
    val PRECEDENCE: List<TriggerVariant> = listOf(
        TriggerVariant.SNOW, TriggerVariant.RAIN, TriggerVariant.WIND, TriggerVariant.COLD, TriggerVariant.HEAT, TriggerVariant.DUST,
    )

    /**
     * 섬 구역(광역 줄 밖에 따로 나온다) → 그 섬이 속한 시군 코드. 닫힌 표다 — 여기 없는 최상위 이름은 모름이다(규칙 2).
     * 울릉도.독도 = 울릉군 · 서해5도 = 옹진군 · 흑산도.홍도 = 신안군 · 거문도.초도 = 여수시 · 추자도 = 제주시.
     */
    val ISLANDS: Map<String, String> = mapOf(
        "울릉도.독도" to "47940", "서해5도" to "28720", "흑산도.홍도" to "12870", "거문도.초도" to "12130", "추자도" to "50110",
    )

    /** 특보 구역 한 칸 × 목적지 — 걸림 · 안 걸림 · 모름(가릴 수 없다 — '특보 없음'으로 확인하지 않는다, INV-SA-2). */
    enum class Match { HIT, MISS, UNSURE }

    /**
     * 특보 매칭용 목적지.
     * @property code 행정구역 코드(시도 2자리 · 시군구 5자리).
     * @property stem 시군 어간(2글자 이상) — 광역 목적지거나 어간이 한 글자(`중구`)면 null.
     * @property wide 그 광역 줄 전체로 맞춘다 — 광역 목적지와 특별·광역시·제주의 시·구(규칙 5·7 — 광역시의 군은 아니다).
     * @property label 문구의 지역 이름 — 도의 시군이면 어간(`포항`), 특별·광역시·제주면 광역(`부산`).
     */
    data class Place(val code: String, val provinces: Set<Province>, val stem: String?, val wide: Boolean, val label: String)

    /** 특보현황의 광역 — [names] 가 `t6` 에 쓰이는 이름(별칭 포함), [wide] 는 특별·광역시·특별자치시·제주(규칙 7). */
    enum class Province(val label: String, private val names: Set<String>, val wide: Boolean) {
        SEOUL("서울", setOf("서울", "서울특별시"), true),
        BUSAN("부산", setOf("부산", "부산광역시"), true),
        DAEGU("대구", setOf("대구", "대구광역시"), true),
        INCHEON("인천", setOf("인천", "인천광역시"), true),
        GWANGJU("광주", setOf("광주", "광주광역시"), true),
        DAEJEON("대전", setOf("대전", "대전광역시"), true),
        ULSAN("울산", setOf("울산", "울산광역시"), true),
        SEJONG("세종", setOf("세종", "세종특별자치시"), true),
        JEJU("제주", setOf("제주도", "제주", "제주특별자치도"), true),
        GYEONGGI("경기", setOf("경기도", "경기"), false),
        GANGWON("강원", setOf("강원도", "강원", "강원특별자치도", "강원자치도"), false),
        CHUNGBUK("충북", setOf("충청북도", "충북"), false),
        CHUNGNAM("충남", setOf("충청남도", "충남"), false),
        JEONBUK("전북", setOf("전라북도", "전북", "전북특별자치도", "전북자치도"), false),
        JEONNAM("전남", setOf("전라남도", "전남"), false),
        GYEONGBUK("경북", setOf("경상북도", "경북"), false),
        GYEONGNAM("경남", setOf("경상남도", "경남"), false),
        ;

        /** 광역 이름으로 시작하는 하위 권역인가(`강원중부산지` · `경북북동산지` · `부산동부`) — 시군 이름이 아니라 어느 시군을 덮는지 모른다. */
        fun isRegional(zone: String): Boolean = names.any { zone.trim().startsWith(it) }

        companion object {
            /** `t6` 의 광역 이름 → 광역. 광역이 아니면(섬 구역·바다·모르는 이름) null. */
            fun ofKmaName(name: String): Province? = entries.firstOrNull { name.trim() in it.names }

            /** 목적지 행정구역 코드(앞 2자리 시도) → 광역. 통합특별시(12)는 광주 자치구와 그 밖(전남)이 따로 예보·특보된다. */
            fun ofRegionCode(code: String): Set<Province>? = when (code.take(2)) {
                "11" -> setOf(SEOUL)
                "26" -> setOf(BUSAN)
                "27" -> setOf(DAEGU)
                "28" -> setOf(INCHEON)
                "30" -> setOf(DAEJEON)
                "31" -> setOf(ULSAN)
                "36" -> setOf(SEJONG)
                "50" -> setOf(JEJU)
                "41" -> setOf(GYEONGGI)
                "51" -> setOf(GANGWON)
                "43" -> setOf(CHUNGBUK)
                "44" -> setOf(CHUNGNAM)
                "52" -> setOf(JEONBUK)
                "47" -> setOf(GYEONGBUK)
                "48" -> setOf(GYEONGNAM)
                // 광주 자치구 판정은 예보 권역과 같은 표를 쓴다(한 곳) — 시도 단위 12 는 둘 다다.
                "12" -> when {
                    code.length == 2 -> setOf(GWANGJU, JEONNAM)
                    AirRegion.of(code) == AirRegion.GWANGJU -> setOf(GWANGJU)
                    else -> setOf(JEONNAM)
                }
                else -> null
            }
        }
    }

    /**
     * 목적지(행정구역 코드 · 표시 이름) → 매칭용 목적지. 코드가 시도 2자리면 광역 목적지, 시군구 5자리면 시군 목적지다.
     * 모르는 코드면 null 이다(지어내지 않는다). 이름은 어간·문구에만 쓴다 — 광역과 군 여부는 코드가 정한다(동명 시군 `고성` 이 갈리고,
     * 표시 이름이 `강화` 처럼 접미 없이 와도 군이다).
     */
    fun placeOf(regionCode: String, name: String): Place? {
        val code = regionCode.trim()
        if (code.length != 2 && code.length != 5) return null
        val provinces = Province.ofRegionCode(code) ?: return null
        if (code.length == 2) return Place(code, provinces, stem = null, wide = true, label = provinces.singleOrNull()?.label ?: name.trim())
        val stem = stemOf(name)
        val province = provinces.single()
        return Place(code, provinces, stem, province.wide && !isGun(code), if (province.wide) province.label else stem ?: province.label)
    }

    /** 이 특보 구역이 이 목적지에 걸리는가(위 규칙 1~9). */
    fun match(area: WarningArea, place: Place): Match {
        val name = area.name.trim()
        if (isSea(name)) return Match.MISS
        ISLANDS[name]?.let { return if (islandCovers(it, place)) Match.HIT else Match.MISS }
        val province = Province.ofKmaName(name) ?: return Match.UNSURE
        if (province !in place.provinces) return Match.MISS
        if (area.zones.isEmpty()) return Match.HIT
        val land = area.zones.map { it.trim() }.filterNot(::isSea)
        val named = place.stem != null && land.any { it.startsWith(place.stem) }
        if (area.excluding) return if (named) Match.MISS else Match.HIT
        if (land.isEmpty()) return Match.MISS
        if (named || place.wide || land.any { zone -> ISLANDS[zone]?.let { islandCovers(it, place) } == true }) return Match.HIT
        if (land.none(province::isRegional)) return Match.MISS
        return if (province.wide) Match.HIT else Match.UNSURE
    }

    /** 아는 최상위 구역 이름인가 — 광역 · 섬 구역 · 바다. 아니면 [match] 가 모름이고 감지기가 이름을 드러낸다(규칙 2). */
    fun isKnownArea(area: WarningArea): Boolean {
        val name = area.name.trim()
        return isSea(name) || name in ISLANDS || Province.ofKmaName(name) != null
    }

    /**
     * 그 날 머무는 목적지 — 박수로 펼친다(FE `dayRegion.ts` · itinerary-generation `RegionAnchors.destinationOn` 과 같은 규칙: 박수 합을
     * 넘는 날·체크아웃일은 마지막 목적지). 옮기는 날(전날과 목적지가 다름)은 전날 목적지도 넣는다 — 아침 일정이 아직 전 목적지에 있다.
     * 0박 목적지는 그 규칙으로는 어느 날에도 오지 않으므로(마지막이 아니면) 지나가는 날 — 앞 목적지 박수 합 + 1일째 — 에 넣는다(당일치기
     * 포항·경주의 포항, 서울 1박 → 대전 0박 → 부산의 둘째 날 대전). 넓히기만 한다 — 그 날을 소유하는 목적지(위 규칙)는 그대로다.
     * 다목적지 여행에서 다른 날의 목적지 특보로 오늘 일정을 경보하지 않게 한다. 목적지가 없으면 빈 목록.
     */
    fun destinationsOn(refs: List<TripDestinationRef>, startDate: LocalDate, date: LocalDate): List<TripDestinationRef> {
        val today = destinationOn(refs, startDate, date) ?: return emptyList()
        val before = if (date > startDate) destinationOn(refs, startDate, date.minusDays(1)) else null
        val day = ChronoUnit.DAYS.between(startDate, date) + 1
        var nightsBefore = 0L
        val passing = refs.filter { ref -> (ref.nights == 0 && nightsBefore + 1 == day).also { nightsBefore += ref.nights } }
        return (listOfNotNull(today, before) + passing).distinct()
    }

    /** 에어코리아 등급 순위 — 문자열 그대로 읽는다(좋음 0 · 보통 1 · 나쁨 2 · 매우나쁨 3). 모르는 등급은 null(모름). */
    fun airRank(grade: String?): Int? = AIR_GRADES.indexOf(grade).takeIf { it >= 0 }

    /** 영향 슬롯을 말하는 주어 — 단기예보 감지기 문구와 같은 꼴(`우도 등 야외 일정 2곳이`). 빈 이름은 이름이 아니다. */
    fun affectedPhrase(firstName: String?, count: Int): String {
        val name = firstName?.takeIf { it.isNotBlank() }
        return when {
            count == 1 && name != null -> "$name 일정이"
            count == 1 -> "야외 일정 한 곳이"
            name != null -> "$name 등 야외 일정 ${count}곳이"
            else -> "야외 일정 ${count}곳이"
        }
    }

    private val AIR_GRADES = listOf("좋음", "보통", "나쁨", "매우나쁨")

    private fun isSea(name: String): Boolean = "바다" in name || "해상" in name

    /** 섬 구역이 이 목적지에 걸리는가 — 그 섬의 시군이거나 그 광역 목적지(규칙 3·5). */
    private fun islandCovers(code: String, place: Place): Boolean = place.code == code || place.code == code.take(2)

    /** 시군구 코드의 셋째 자리가 7 이상이면 군이다(행정표준코드 — 26710 기장군 · 28710 강화군 · 31710 울주군). */
    private fun isGun(code: String): Boolean = code[2] >= '7'

    /** 시군 어간 — 첫 낱말의 끝 `시`·`군`·`구` 를 뗀다(`포항시` → `포항`, `수원시 장안구` → `수원`). 두 글자가 안 되면 null(`중구`). */
    private fun stemOf(name: String): String? {
        val word = name.trim().split(Regex("\\s+")).first()
        val stem = if (word.length > 1 && word.last() in SUFFIXES) word.dropLast(1) else word
        return stem.takeIf { it.length >= 2 }
    }

    private val SUFFIXES = setOf('시', '군', '구')

    private fun destinationOn(refs: List<TripDestinationRef>, startDate: LocalDate, date: LocalDate): TripDestinationRef? {
        var remaining = ChronoUnit.DAYS.between(startDate, date) + 1
        for (ref in refs) {
            if (remaining <= ref.nights) return ref
            remaining -= ref.nights
        }
        return refs.lastOrNull()
    }
}
