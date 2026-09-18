package com.trippilot.weathercontext.domain

import java.time.Instant

/**
 * 날씨 스냅숏(C11 · 정본 §4.1) — 한 격자의 한 발표분.
 *
 * 캐시 키가 `(격자, 발표시각)` 이라 **TTL 을 임의로 정하지 않는다**(P-PERF-U4-1).
 * 다음 발표가 곧 새 키이므로 무효화 로직이 필요 없다.
 */
data class WeatherSnapshot(
    val gridKey: String,
    val baseAt: Instant,
    val precipProbability: Int,
    val warning: String?,
    val fetchedAt: Instant,
    /** 다음 발표 시각. 이 시각을 넘기면 **발화에는 쓸 수 없다**(INV-U4-09). */
    val expiresAt: Instant,
) {
    init {
        require(precipProbability in 0..100) { "강수확률은 0~100 이어야 합니다." }
        require(expiresAt > baseAt) { "만료는 발표시각 이후여야 합니다." }
    }

    fun isFreshAt(at: Instant): Boolean = at < expiresAt
}

/**
 * 표시용 조회 결과(P-RES-U4-2 — **역방향 stale-if-error**).
 *
 * U0·U1 의 `stale-if-error` 는 "실패 시 마지막 값을 보여준다"지만 **날씨는 반대로 간다**:
 * 표시는 사용자가 스스로 판단할 재료라 만료분도 허용하되 [stale] 로 "확인 불가"임을 밝히고,
 * **발화는 앱이 대신 판단해 개입**하는 것이라 만료분을 쓰지 않는다. 낡은 근거로 개입하면 그게 허위 알림이다.
 */
data class WeatherView(val snapshot: WeatherSnapshot, val stale: Boolean)

/**
 * 외부 기상 조회 포트. 벤더(공공데이터포털 기상청 단기예보) 어댑터가 구현한다 —
 * "하나의 외부 API = 하나의 소유 모듈 = 하나의 어댑터 포트".
 *
 * **실패는 예외로 던진다.** null 을 돌려주면 "조회했더니 비 안 옴"과 구분되지 않아,
 * 호출자가 무발화(INV-U4-09)와 정상 결과를 섞어 판단하게 된다.
 */
interface WeatherPort {
    /**
     * @param gridKey 격자 키. 좌표→격자 변환은 어댑터가 소유한다(벤더마다 다르다).
     * @throws WeatherLookupFailed 조회 실패(네트워크·5xx·스키마 불일치·시한 초과)
     */
    fun fetch(gridKey: String, at: Instant): WeatherSnapshot
}

/**
 * 기상 조회 실패. 재시도·서킷은 두지 않는다(P-RES-U4-1) — 짧은 시한으로 끊고 **무발화**로 간다.
 * 실패는 관측에만 남기고 화면은 수동 경로를 유지한다(BR-U4-05).
 */
class WeatherLookupFailed(message: String, cause: Throwable? = null) : RuntimeException(message, cause)

interface WeatherSnapshotRepository {
    fun save(snapshot: WeatherSnapshot): WeatherSnapshot

    /** 해당 격자의 가장 최근 발표분. 없으면 null. */
    fun findLatest(gridKey: String): WeatherSnapshot?
}
