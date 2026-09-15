package com.trippilot.weathercontext.adapter.out.external

import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.ln
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.tan

/**
 * 위경도 → 기상청 단기예보 격자(nx, ny).
 *
 * 기상청 「단기예보 조회서비스」 활용가이드의 C 코드(`TO_GRID`)를 **산식·반올림까지 그대로** 옮긴
 * Lambert Conformal Conic 변환이다. 파라미터를 바꾸면 격자가 통째로 어긋나고, 증상은
 * **"엉뚱한 동네 날씨로 Plan-B 가 뜬다"** 라 원인이 안 보인다 — 그래서 상수를 여기 모아 두고
 * 가이드 예시값으로 못 박는다([KmaGridTest]).
 *
 * AI 쪽에 같은 변환이 파이썬으로 있다(`ai/src/trippilot/poi_curation/adapters/kma_weather.py`).
 * 두 벌인 것은 의도다 — Plan-B 감지는 백엔드 배경 작업이라, 그 판정을 외부 서비스 가용성에 묶으면
 * "조회 실패는 무발화"(BR-U4-05)와 맞물려 **비 오는 날 아무 일도 안 일어난다**.
 */
internal object KmaGrid {

    /** @return `nx` to `ny`. 가이드 C 코드와 같은 반올림(+1.5 후 내림). */
    fun of(lat: Double, lng: Double): Pair<Int, Int> {
        val reGrid = RE / GRID
        val slat1 = SLAT1 * DEGRAD
        val slat2 = SLAT2 * DEGRAD
        val olon = OLON * DEGRAD
        val olat = OLAT * DEGRAD

        var sn = tan(Math.PI * 0.25 + slat2 * 0.5) / tan(Math.PI * 0.25 + slat1 * 0.5)
        sn = ln(cos(slat1) / cos(slat2)) / ln(sn)
        var sf = tan(Math.PI * 0.25 + slat1 * 0.5)
        sf = sf.pow(sn) * cos(slat1) / sn
        var ro = tan(Math.PI * 0.25 + olat * 0.5)
        ro = reGrid * sf / ro.pow(sn)

        var ra = tan(Math.PI * 0.25 + lat * DEGRAD * 0.5)
        ra = reGrid * sf / ra.pow(sn)
        var theta = lng * DEGRAD - olon
        if (theta > Math.PI) theta -= 2.0 * Math.PI
        if (theta < -Math.PI) theta += 2.0 * Math.PI
        theta *= sn

        val nx = floor(ra * sin(theta) + XO + 0.5).toInt()
        val ny = floor(ro - ra * cos(theta) + YO + 0.5).toInt()
        return nx to ny
    }

    private const val RE = 6371.00877 // 지구 반경(km)
    private const val GRID = 5.0 // 격자 간격(km)
    private const val SLAT1 = 30.0 // 표준위도 1
    private const val SLAT2 = 60.0 // 표준위도 2
    private const val OLON = 126.0 // 기준점 경도
    private const val OLAT = 38.0 // 기준점 위도
    private const val XO = 43.0 // 기준점 X 격자
    private const val YO = 136.0 // 기준점 Y 격자
    private val DEGRAD = Math.PI / 180.0
}
