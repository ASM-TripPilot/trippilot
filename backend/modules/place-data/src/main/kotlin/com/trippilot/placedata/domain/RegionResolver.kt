package com.trippilot.placedata.domain

/**
 * 도로명·지번 주소 → 행정구역 표준코드(TRIP-359).
 *
 * **왜 주소를 보나.** 수집분은 지역을 시군구 이름으로만 준다(`"양천구"`). 그 이름은 유일하지 않다 —
 * `동구` 하나가 6개 시도에 걸쳐 118건이었다(수집본 실측). 이름만으로는 어느 동구인지 정할 수 없고,
 * 임의로 하나를 고르면 커버리지가 엉뚱한 지역에 쌓인다.
 *
 * 주소 첫 토큰은 시도명이라 그 모호함이 사라진다. 실 수집본 1,104건이 **전부** 시군구까지 해결됐다(실측).
 *
 * **좌표에서 역산하지 않는다.** 폴리곤이 없어 상자로 근사하면 경계 지역이 조용히 옆 시군구로 넘어간다.
 */
object RegionResolver {

    /**
     * @return 카탈로그에 있는 코드, 또는 **null**. 못 정하면 null 이다 —
     *   가까운 지역으로 밀어 넣으면 그 지역 커버리지가 부풀어 "POI 가 있다"고 말하게 된다.
     */
    fun resolve(address: String?, catalog: List<Region>): String? {
        val tokens = address?.trim()?.split(WHITESPACE)?.filter { it.isNotBlank() } ?: return null
        if (tokens.isEmpty()) return null

        val sido = catalog.firstOrNull { it.level == RegionLevel.SIDO && it.name == tokens[0] } ?: return null
        val under = catalog.filter { it.level == RegionLevel.SIGUNGU && it.sidoCode == sido.regionCode }

        // 두 토큰 먼저 본다 — `수원시 장안구` 는 `수원시` 로도 걸리므로 순서를 뒤집으면 늘 시(市)로 접힌다.
        val twoTokens = tokens.getOrNull(1)?.let { a -> tokens.getOrNull(2)?.let { b -> "$a $b" } }
        val matched = under.firstOrNull { it.name == twoTokens }
            ?: under.firstOrNull { it.name == tokens.getOrNull(1) }
            // 세종특별자치시처럼 시군구가 없는 단층제는 시도가 곧 목적지다.
            ?: return sido.regionCode

        // 행정구(수원시 장안구)는 목적지가 아니다. 커버리지는 **고를 수 있는 단위**에 쌓여야
        // 화면이 "여기는 준비됐다"를 말할 수 있으므로, 고를 수 없는 구는 상위 시(市)로 접는다.
        if (matched.selectable) return matched.regionCode
        val parentCity = tokens.getOrNull(1)?.let { city -> under.firstOrNull { it.name == city && it.selectable } }
        return parentCity?.regionCode ?: sido.regionCode
    }

    private val WHITESPACE = Regex("\\s+")
}
