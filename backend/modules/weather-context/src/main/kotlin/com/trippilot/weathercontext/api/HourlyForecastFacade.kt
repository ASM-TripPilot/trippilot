package com.trippilot.weathercontext.api

import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime

/**
 * 격자 시간별 예보(C11 · situation-awareness BR-SA-15 · domain-entities §8.1) — 감지(C9)의 단기예보 감지기가 소비한다.
 *
 * [ContextFacade] 와 **따로 둔다** — 그쪽은 도우미·감지 테스트가 익명 대역으로 물고 있어 메서드 하나가 그 전부를 흔든다.
 * 이름 경로(목적지 이름 → 그 날 강수확률 최댓값 하나)와 달리 **슬롯 좌표의 격자**를 시간별로 본다 — 다도시·동명이지역이
 * 섞이지 않고, '오후에만 비'를 오후 일정에만 건다.
 *
 * 정본의 두 메서드(`isLive` · `forecastForTrigger` — null = 모름)에 둘을 더했다 — [gridKeyOf](회차 안 실패 격자 기억의 키 ·
 * RES-SA-04)와 [HourlyForecastUnavailable](출처의 고장을 모름 null 과 가른다 — 게이트웨이 거절은 그 출처 전체, 시한·5xx·형식
 * 깨짐은 그 격자 · RES-SA-02·04). null 하나로는 감지기가 이 셋을 다르게 다룰 수 없다.
 */
interface HourlyForecastFacade {
    /**
     * 실 기상청 격자 예보가 붙어 있는가 — 가짜 날씨(`WEATHER_MODE=fake`)면 false 다(격자 포트 빈이 없다).
     * 외부를 부르지 않고 빈 유무로만 답한다(감시 상태를 그릴 때마다 묻는다).
     */
    fun isLive(): Boolean

    /** 그 좌표의 기상청 격자 키 `"nx,ny"`(예 제주 `"53,38"`). live 가 아니면 null. 회차 안 실패 격자 기억의 키다. */
    fun gridKeyOf(lat: Double, lng: Double): String?

    /**
     * **발화 판정용** — 그 좌표 격자의 신선한 최신 발표분(오늘·내일, 시간별은 모레까지). 신선한 캐시가 없으면 한 번 조회해 정상(00)만 저장한다.
     *
     * null = **모름**이다 — live 아님 · 자료 없음(03 재요청 소진) · 격자 경로 하루 호출 상한 초과 · 받은 값이 [at] 에 이미 낡음.
     * "비가 안 온다"가 아니다. 0·기본값으로 채우지 않는다(INV-U4-09).
     *
     * @throws HourlyForecastUnavailable 출처의 고장 — 게이트웨이 거절(그 출처 전체) 또는 시한 초과·5xx·형식 깨짐(그 격자).
     *   감지기가 둘을 갈라 회차 범위로 기억한다(RES-SA-02·04).
     */
    fun forecastForTrigger(lat: Double, lng: Double, at: Instant): PointForecast?
}

/**
 * 한 격자의 한 발표분(api-safe). [hourly] 키는 **KST 정시**(오늘·내일 — 자정을 넘긴 내일 슬롯 몫으로 모레까지)이고 응답에 없던
 * 시각은 키가 없다.
 * 칸이 null 이면 그 값을 모른다(숫자가 아니었거나 범위 밖) — 지어내지 않는다.
 */
data class PointForecast(
    val gridKey: String,
    /** 발표 시각 — 이 시각 이전의 예보는 없다(판정 시각은 이 뒤만 본다). */
    val baseAt: Instant,
    val hourly: Map<LocalDateTime, HourlyWeather>,
    /** 날짜별 최저·최고 기온(TMN·TMX) — 응답에 있을 때만. */
    val daily: Map<LocalDate, DailyWeather>,
)

/** 한 정시의 예보 — POP(강수확률 %) · PTY(강수형태) · SKY(하늘상태) · TMP(기온 ℃) · WSD(풍속 m/s). */
data class HourlyWeather(
    val pop: Int?,
    val precipitation: Precipitation?,
    val sky: Sky?,
    val tmp: Double?,
    val wsd: Double?,
)

data class DailyWeather(val tmn: Double?, val tmx: Double?)

/** 단기예보 강수형태(PTY 0~4). 초단기 전용 코드(5~7)는 여기 없다 — 받으면 모름(null)이다. */
enum class Precipitation { NONE, RAIN, RAIN_SNOW, SNOW, SHOWER }

/** 하늘상태(SKY 1·3·4). 2(구름조금)는 2019년에 폐지됐다 — 받으면 모름(null)이다. */
enum class Sky { CLEAR, MOSTLY_CLOUDY, OVERCAST }

/**
 * 예보를 얻지 못했다 — null(그 격자에 자료가 없다)과 달리 **출처의 고장**이라 호출측이 갈라 다룬다.
 *
 * - [gatewayCode] 가 있으면 공공데이터포털 게이트웨이 거절(HTTP 401·403 · returnReasonCode 20·22·30·31·32 — 접근 거부·한도·
 *   키 미등록·기한 만료·IP) — **그 출처 전체**가 막혔다. 다음 회차에 다시 묻는다(캐시하지 않는다).
 * - 없으면 시한 초과·5xx·형식 깨짐 — **그 격자**만의 고장이다.
 *
 * 메시지에 요청 주소를 싣지 않는다 — 서비스 키가 질의 문자열에 있다(SEC-SA-03). 원인 예외도 매달지 않는다.
 */
class HourlyForecastUnavailable(val gridKey: String, val gatewayCode: String?) : RuntimeException(
    if (gatewayCode != null) "기상청 게이트웨이 거절 code=$gatewayCode" else "기상청 격자 예보를 받지 못했습니다. grid=$gridKey",
)
