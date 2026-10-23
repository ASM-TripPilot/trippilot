package com.trippilot.weathercontext.domain

import java.time.Instant
import java.time.LocalDateTime

/**
 * 한 격자의 한 발표분 — 시간별 예보 캐시(weather_grid_forecast · domain-entities §8.1). 격자당 1행(덮어쓰기)이다.
 *
 * [hourly] 키는 KST 정시(오늘·내일 — 자정을 넘긴 내일 슬롯 몫으로 모레까지)다. 날짜별 최저·최고(TMN·TMX)는 받지 않는다 — 기온 판정이
 * 시간별 TMP 만 본다(G-SA-15 결정 2026-10-20 — `weather_grid_forecast.daily` 칸은 V2.86 에서 지웠다).
 * 값은 **원천 코드 그대로**(PTY 0~4 · SKY 1·3·4)이고 어댑터가 읽을 때 걸렀다 — 숫자가 아니거나 모르는 코드면 그 칸은 null 이다
 * (지어내지 않는다). 뜻으로 옮기는 것은 공개 계약 쪽이다.
 *
 * 만료는 **다음 발표가 실제로 제공되는 시각**(발표 + 3시간 + 10분)이다 — 그 10분 동안 손에 넣을 수 있는 가장 새 근거라서다.
 */
data class GridForecast(
    val gridKey: String,
    val baseAt: Instant,
    val hourly: Map<LocalDateTime, GridHour>,
    val fetchedAt: Instant,
    /** 이 시각부터는 **발화에 쓸 수 없다**(INV-U4-09) — 낡은 근거로 개입하면 그게 허위 알림이다. */
    val expiresAt: Instant,
) {
    init {
        require(expiresAt > baseAt) { "만료는 발표시각 이후여야 합니다." }
    }

    fun isFreshAt(at: Instant): Boolean = at < expiresAt
}

/** 한 정시 — POP(%) · PTY(코드 0~4) · SKY(코드 1·3·4) · TMP(℃) · WSD(m/s). */
data class GridHour(val pop: Int?, val pty: Int?, val sky: Int?, val tmp: Double?, val wsd: Double?)

/**
 * 격자 예보 포트 — 기상청 단기예보 어댑터가 구현한다. 좌표 → 격자 변환은 어댑터 소유다(벤더마다 다르다 — [WeatherPort] 계약 승계).
 *
 * 실패를 말하는 법이 셋이다 — 호출측이 셋을 다르게 다룬다(RES-SA-01~03).
 * - [GridForecastMissing] 그 격자의 자료를 이번에 얻지 못했다(03 재요청 소진·하루 상한) — 그 격자만 모름.
 * - [WeatherGatewayRefused] 게이트웨이가 키·한도·IP 로 거절했다 — 그 출처 전체가 모름.
 * - [WeatherLookupFailed] 시한 초과·5xx·형식 깨짐.
 */
interface GridForecastPort {
    /** 기상청 격자 키 `"nx,ny"`. */
    fun gridKeyOf(lat: Double, lng: Double): String

    /** 그 격자의 최신 발표분 — HTTP 1건(03 이면 즉시 ≤2회 더). [at] 의 KST 날짜로 오늘·내일(시간별은 모레까지)을 고른다. */
    fun fetchGrid(gridKey: String, at: Instant): GridForecast
}

interface GridForecastRepository {
    /** 그 격자의 행(신선도 무관). 없으면 null. */
    fun find(gridKey: String): GridForecast?

    /** 격자당 1행 — 있으면 덮는다. */
    fun save(forecast: GridForecast): GridForecast
}

/** 그 격자의 자료를 이번에 얻지 못했다 — 실패가 아니라 **모름**이다. 행을 만들지 않는다(INV-U4-09). */
class GridForecastMissing(val gridKey: String, reason: String) : RuntimeException("격자 예보 없음 grid=$gridKey — $reason")

/** 공공데이터포털 게이트웨이 거절 — [reasonCode] 는 returnReasonCode(20·22·30·31·32) 또는 `HTTP_401`·`HTTP_403`. 원인 코드만 싣는다. */
class WeatherGatewayRefused(val reasonCode: String) : RuntimeException("공공데이터포털 게이트웨이 거절 code=$reasonCode")
