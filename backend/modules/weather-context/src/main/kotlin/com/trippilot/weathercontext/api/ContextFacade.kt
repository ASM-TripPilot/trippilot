package com.trippilot.weathercontext.api

import java.time.Instant

/**
 * 날씨·맥락 공개 계약(C11 · R1 `..api..`). 감지(C9)가 소비한다.
 *
 * **읽는 목적에 따라 메서드가 갈린다** — 같은 데이터라도 발화(개입)와 표시(재료)는 만료분 취급이 반대다
 * (P-RES-U4-2). 한 메서드로 합치면 호출자가 그 차이를 잊고 낡은 값으로 알림을 만든다.
 */
interface ContextFacade {
    /**
     * **발화 판정용.** 신선한 값이 없으면 `null` — 만료분이나 조회 실패로는 트리거를 만들지 않는다(INV-U4-09).
     * 호출자는 null 을 "비가 안 온다"가 아니라 **"모른다"** 로 다뤄야 한다.
     */
    fun precipProbabilityForTrigger(gridKey: String, at: Instant): Int?

    /**
     * **표시용.** 만료분도 돌려주되 [WeatherReading.stale] 로 "확인 불가"임을 밝힌다.
     * 아무 값도 없으면(한 번도 못 받아옴) null.
     */
    fun readingForDisplay(gridKey: String, at: Instant): WeatherReading?
}

/** 표시용 읽기값(api-safe). [stale] 이면 화면은 "확인 불가"로 표기한다. */
data class WeatherReading(
    val precipProbability: Int,
    val warning: String?,
    val baseAt: Instant,
    val stale: Boolean,
)
