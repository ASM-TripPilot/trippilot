package com.trippilot.weathercontext.domain

import com.trippilot.weathercontext.api.ActiveWarning
import com.trippilot.weathercontext.api.AirGrade
import com.trippilot.weathercontext.api.AirRegion
import java.time.Instant
import java.time.LocalDate

/**
 * 기상특보 현황 포트 — 특보현황(`getPwnStatus`) 1건 = HTTP 1건. 실 기상청 모드(`WEATHER_MODE=kma`)에만 빈이 있다.
 *
 * 실패는 예외다 — [WeatherGatewayRefused](게이트웨이 거절: HTTP 401·403 · returnReasonCode 20·22·30·31·32) ·
 * [WeatherLookupFailed](시한·5xx·형식 깨짐). 둘 다 그 출처의 모름이고, 원인 코드만 싣는다(키·주소 없음).
 */
interface WarningStatusPort {
    /** 지금 발효 중인 특보(전국). 특보가 없으면 빈 목록. */
    fun fetchWarnings(): List<ActiveWarning>
}

/** 대기질 예보 포트 — 그 날 발표된 예보통보(`getMinuDustFrcstDspth`)의 PM10·PM25(HTTP 2건). 실패는 [WarningStatusPort] 와 같다. */
interface AirForecastPort {
    /** [searchDate](KST 오늘)에 발표된 예보통보 — 예보 날짜마다 권역 등급. */
    fun fetchAirForecast(searchDate: LocalDate): AirForecast
}

/**
 * 예보통보 한 벌 — 예보 날짜 → 권역 → 등급(오염물질마다 가장 최근 발표분). [issuedAt] = 쓴 발표분 가운데 가장 최근 발표 시각 —
 * 캐시가 다음 발표까지 이 값을 쓴다(발표 단위 캐시).
 */
data class AirForecast(val issuedAt: Instant, val byDate: Map<LocalDate, Map<AirRegion, AirGrade>>)
