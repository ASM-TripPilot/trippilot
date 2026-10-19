package com.trippilot.weathercontext.api

import java.time.Instant
import java.time.LocalDate

/**
 * 기상특보·대기질 읽기(C11 · situation-awareness domain-entities §8.2) — 감지(C9)의 특보·대기질 감지기가 소비한다.
 *
 * [HourlyForecastFacade]·[ContextFacade] 와 따로 둔다 — 원천(특보현황 · 에어코리아)과 실패 모양이 다르고, 그쪽 대역들을 흔들지 않는다.
 * 읽기만 한다 — 원문은 파드 메모리에만 두고 DB 에 남기지 않는다(특보 20분 · 대기질 발표 단위).
 *
 * 실패는 값으로 말한다([AlertRead.Unknown]) — 게이트웨이 거절(HTTP 401·403 · returnReasonCode 20·22·30·31·32)·시한·형식 깨짐 모두
 * 그 출처의 **모름**이다. "특보 없음"·"좋음"으로 접지 않는다(INV-SA-2).
 */
interface WeatherAlertFacade {
    /**
     * 실 조회가 붙어 있는가 — 가짜 날씨(`WEATHER_MODE=fake`)면 false 다(포트 빈이 없다). 외부를 부르지 않고 빈 유무로만 답한다
     * (감시 상태·회수 필터를 그릴 때마다 묻는다).
     */
    fun isLive(): Boolean

    /** 지금 발효 중인 기상특보(전국 — 특보현황 `t6`). 특보가 없으면 `Ok(빈 목록)` 이다. */
    fun warnings(at: Instant): AlertRead<List<ActiveWarning>>

    /** 그 날의 대기질 예보 권역 등급(PM10·PM25). 그 날 예보가 응답에 없으면 모름이다. */
    fun airGrades(date: LocalDate, at: Instant): AlertRead<Map<AirRegion, AirGrade>>
}

/** 읽은 값 또는 모름. */
sealed interface AlertRead<out T> {
    data class Ok<out T>(val value: T) : AlertRead<T>

    /** 모름 — [cause] 는 요약·로그용 원인 이름(`gateway:30` · `unavailable` · `no-forecast`)이다. 키·주소를 싣지 않는다. */
    data class Unknown(val cause: String) : AlertRead<Nothing>

    companion object {
        /**
         * 원천은 읽었는데 그 날 예보가 응답에 없다 — **그 날짜만**의 모름이다. 그 밖의 원인(게이트웨이 거절·장애)은 그 출처 전체의 모름이라
         * 감지기가 회차 동안 날짜와 무관하게 다시 묻지 않는다(COST-SA-05).
         */
        const val NO_FORECAST = "no-forecast"
    }
}

/**
 * 발효 중 특보 하나 — 특보현황 `t6` 의 한 줄(`o 강풍주의보 : 경상북도(영덕, 포항), 울산`). 이름은 원문 그대로다(형식은 실응답 표본으로 고정).
 *
 * @property type 종류(`강풍` · `호우` · `풍랑` …).
 * @property level 등급(`주의보` · `경보`).
 */
data class ActiveWarning(val type: String, val level: String, val areas: List<WarningArea>) {
    /** 특보 이름 — `강풍주의보`. */
    val title: String get() = type + level
}

/**
 * 특보 구역 한 칸. `경상북도(영덕, 포항)` = 광역 [name] + 하위 구역 [zones], `울산` = 하위 구역 없음(그 광역 전체),
 * `인천(강화군, 옹진군 제외)` = [excluding] 참(나열한 구역을 뺀 그 광역 전체). `울릉도.독도` 처럼 광역이 아닌 구역도 [name] 에 온다.
 */
data class WarningArea(val name: String, val zones: List<String> = emptyList(), val excluding: Boolean = false)

/**
 * 에어코리아 대기질 예보 권역(응답 `informGrade` 의 19 권역) — [label] 이 응답의 권역 이름 그대로다.
 * 경기는 북부·남부, 강원은 영서·영동으로 나뉘고, 광주·전남은 행정구역 통합(12)과 무관하게 따로 예보된다(2026-10-19 실응답).
 */
enum class AirRegion(val label: String) {
    SEOUL("서울"), INCHEON("인천"), GYEONGGI_NORTH("경기북부"), GYEONGGI_SOUTH("경기남부"),
    YEONGSEO("영서"), YEONGDONG("영동"), DAEJEON("대전"), SEJONG("세종"), CHUNGBUK("충북"), CHUNGNAM("충남"),
    GWANGJU("광주"), JEONBUK("전북"), JEONNAM("전남"), BUSAN("부산"), DAEGU("대구"), ULSAN("울산"),
    GYEONGBUK("경북"), GYEONGNAM("경남"), JEJU("제주"),
    ;

    companion object {
        /** 응답의 권역 이름 → 권역. 모르는 이름이면 null(지어내지 않는다). */
        fun ofLabel(label: String): AirRegion? = entries.firstOrNull { it.label == label }

        /**
         * 목적지 행정구역 코드(시도 2자리 · 시군구 5자리) → 예보 권역. 모르면 null — 코드가 없는 목적지도 권역을 모른다(§8.2).
         *
         * 시도 앞 2자리로 정하되 셋만 시군구로 가른다: 경기(북부 10 시군 — 고양·의정부·동두천·구리·남양주·파주·양주·포천·연천·가평),
         * 강원(영동 7 시군 — 강릉·동해·태백·속초·삼척·고성·양양), 통합특별시 12(광주 5 자치구 / 그 밖 전남). 시도 단위 코드가 둘로
         * 갈리는 곳(41·51·12)이면 한 권역을 고를 수 없어 null 이다. 북부·영동 목록은 국립환경과학원 예보 권역표 기준의 **추정**이다 —
         * 실응답은 권역 이름만 주므로 시군 소속은 원문 권역표로 확인한다.
         */
        fun of(regionCode: String): AirRegion? {
            val code = regionCode.trim()
            if (code.length != 2 && code.length != 5) return null
            return when (code.take(2)) {
                "11" -> SEOUL
                "26" -> BUSAN
                "27" -> DAEGU
                "28" -> INCHEON
                "30" -> DAEJEON
                "31" -> ULSAN
                "36" -> SEJONG
                "43" -> CHUNGBUK
                "44" -> CHUNGNAM
                "47" -> GYEONGBUK
                "48" -> GYEONGNAM
                "50" -> JEJU
                "52" -> JEONBUK
                "41" -> split(code, GYEONGGI_NORTH_CODES, GYEONGGI_NORTH, GYEONGGI_SOUTH)
                "51" -> split(code, YEONGDONG_CODES, YEONGDONG, YEONGSEO)
                "12" -> split(code, GWANGJU_CODES, GWANGJU, JEONNAM)
                else -> null
            }
        }

        private fun split(code: String, first: Set<String>, inFirst: AirRegion, otherwise: AirRegion): AirRegion? = when {
            code.length == 2 -> null
            code.take(4) in first -> inFirst
            else -> otherwise
        }

        /** 시군구 코드 앞 4자리 — 일반시의 행정구(41281 고양시 덕양구 등)도 그 시를 따른다. */
        private val GYEONGGI_NORTH_CODES = setOf("4115", "4125", "4128", "4131", "4136", "4148", "4163", "4165", "4180", "4182")
        private val YEONGDONG_CODES = setOf("5115", "5117", "5119", "5121", "5123", "5182", "5183")
        private val GWANGJU_CODES = setOf("1221", "1224", "1227", "1230", "1233")
    }
}

/**
 * 한 권역·한 날의 예보 등급 — 에어코리아 문자열 **그대로**(`좋음` · `보통` · `나쁨` · `매우나쁨` — 공공누리 3유형 · 변경 금지).
 * 응답에 그 오염물질 줄이 없으면 null 이다.
 */
data class AirGrade(val pm10: String?, val pm25: String?)
