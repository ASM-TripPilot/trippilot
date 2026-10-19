package com.trippilot.planbdetection.domain

import com.trippilot.trip.api.TripDestinationRef
import com.trippilot.weathercontext.api.AirRegion
import com.trippilot.weathercontext.api.WarningArea
import java.time.LocalDate
import java.time.temporal.ChronoUnit

/**
 * 기상특보·대기질 판정의 순수 재료(BR-SA-16) — 특보 목적지 매칭 · 종류 → 변형 · 그 날의 목적지 · 대기질 등급 순위. 조회·저장을 하지 않는다.
 *
 * **특보 목적지 매칭** — 특보현황 `t6` 의 구역(`경상북도(영덕, 포항)` · `울산` · `인천(강화군, 옹진군 제외)` · `울릉도.독도`)을 여행 목적지와 맞춘다.
 * 1. 바다·해상 구역은 무시한다(바다 특보는 육지 일정과 무관하다).
 * 2. 광역이 다르면 걸리지 않는다 — 광역 별칭 둘(강원도 ↔ 강원특별자치도 · 전라북도 ↔ 전북특별자치도)은 같은 광역이다.
 * 3. 광역 목적지(서울·부산·제주 등)는 그 광역 줄 전체가 걸린다. 하위 구역 없는 광역 줄은 그 광역 전체다.
 * 4. 시군 목적지는 하위 구역 이름이 **시군 어간으로 시작**하면 걸린다(`강릉` → `강릉시평지`, `경주` → `경주동부`). 정본은 '들어가면'이지만
 *    시작으로 좁힌다 — `남양주` 에 `양주` 가 들어 있어 양주 여행이 남양주 특보에 걸린다.
 * 5. 특별·광역시와 제주의 시군구(해운대구·서귀포시 …)는 광역 목적지처럼 그 광역 줄 전체로 맞춘다 — 그 광역의 구역 이름(`부산동부` ·
 *    `제주도남부`)에 시군명이 없어 4 로는 영영 걸리지 않는다(광역 목적지 규칙의 근거와 같다). 과잉 경보는 관찰 전용 출발이 잰다(BR-SA-04).
 * 6. `(…제외)` 는 나열한 구역을 뺀 그 광역 전체다.
 * 7. 광역이 아닌 구역(`울릉도.독도`)은 이름이 시군 어간으로 시작할 때만 걸린다.
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
     * 특보 매칭용 목적지.
     * @property stem 시군 어간(2글자 이상) — 광역 목적지거나 어간이 한 글자(`중구`)면 null.
     * @property wide 그 광역 줄 전체로 맞춘다 — 광역 목적지와 특별·광역시·제주의 시군구(규칙 3·5).
     * @property label 문구의 지역 이름 — 어간으로 맞추는 시군이면 어간(`포항`), 광역 줄로 맞추면 광역(`부산`).
     */
    data class Place(val provinces: Set<Province>, val stem: String?, val wide: Boolean, val label: String)

    /** 특보현황의 광역 — [names] 가 `t6` 에 쓰이는 이름(별칭 포함), [wide] 는 특별·광역시·특별자치시·제주(규칙 5). */
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

        companion object {
            /** `t6` 의 광역 이름 → 광역. 광역이 아니면(섬 구역·바다) null. */
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
     * 모르는 코드면 null 이다(지어내지 않는다). 이름은 어간·문구에만 쓴다 — 광역은 코드가 정한다(동명 시군 `고성` 이 갈린다).
     */
    fun placeOf(regionCode: String, name: String): Place? {
        val code = regionCode.trim()
        if (code.length != 2 && code.length != 5) return null
        val provinces = Province.ofRegionCode(code) ?: return null
        if (code.length == 2) return Place(provinces, stem = null, wide = true, label = provinces.singleOrNull()?.label ?: name.trim())
        val stem = stemOf(name)
        val province = provinces.single()
        return Place(provinces, stem, province.wide, if (province.wide) province.label else stem ?: province.label)
    }

    /** 이 특보 구역이 이 목적지에 걸리는가(위 규칙 1~7). */
    fun covers(area: WarningArea, place: Place): Boolean {
        if (isSea(area.name)) return false
        val province = Province.ofKmaName(area.name) ?: return place.stem != null && area.name.trim().startsWith(place.stem)
        if (province !in place.provinces) return false
        if (area.zones.isEmpty()) return true
        val named = place.stem != null && area.zones.filterNot(::isSea).any { it.startsWith(place.stem) }
        if (area.excluding) return !named
        if (area.zones.all(::isSea)) return false
        return named || place.wide
    }

    /**
     * 그 날 머무는 목적지 — 박수로 펼친다(FE `dayRegion.ts` · itinerary-generation `RegionAnchors.destinationOn` 과 같은 규칙: 박수 합을
     * 넘는 날·체크아웃일은 마지막 목적지). 옮기는 날(전날과 목적지가 다름)은 전날 목적지도 넣는다 — 아침 일정이 아직 전 목적지에 있다.
     * 다목적지 여행에서 다른 날의 목적지 특보로 오늘 일정을 경보하지 않게 한다. 목적지가 없으면 빈 목록.
     */
    fun destinationsOn(refs: List<TripDestinationRef>, startDate: LocalDate, date: LocalDate): List<TripDestinationRef> {
        val today = destinationOn(refs, startDate, date) ?: return emptyList()
        val before = if (date > startDate) destinationOn(refs, startDate, date.minusDays(1)) else null
        return listOfNotNull(today, before).distinct()
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
