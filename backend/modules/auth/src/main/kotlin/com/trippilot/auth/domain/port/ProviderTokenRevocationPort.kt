package com.trippilot.auth.domain.port

import com.trippilot.auth.domain.Provider

/**
 * 제공자 토큰 revoke 포트(TRIP-933) — 계정 파기 때 제공자 쪽에 남은 우리 앱의 접근 권한을 거둔다.
 *
 * App Store 5.1.1(v): 애플 로그인을 제공하는 앱은 계정 삭제 시 Sign in with Apple REST API 로 사용자
 * 토큰을 revoke 해야 한다. revoke 에는 refresh_token 이 필요하고, 그것은 로그인 때 받은 authorizationCode 를
 * 교환해야만 나온다. 그래서 이 포트는 **교환(로그인 시점)** 과 **revoke(파기 시점)** 두 동작을 갖는다.
 *
 * 구현: 현재 Apple 만(`AppleOAuthClient`). 다른 제공자는 교환이 null 이고 revoke 대상이 생기지 않는다.
 */
interface ProviderTokenRevocationPort {
    /**
     * 로그인 때 받은 authorizationCode → revoke 에 쓸 토큰(refresh_token).
     *
     * **던지지 않는다 — 실패는 null 이다.** 이 교환은 로그인의 부수 작업이라, 실패가 로그인을 막으면
     * Apple 토큰 엔드포인트 장애가 곧 애플 로그인 장애가 된다(신원은 이미 id_token 으로 확정됐다).
     * 미설정·미지원 제공자·교환 실패·[expectedSub] 불일치가 모두 null 이다.
     */
    fun exchangeRevocationToken(provider: Provider, authorizationCode: String, expectedSub: String): String?

    /** 토큰 revoke. 실패는 예외다 — 호출자(파기 스위프)가 잡아 재시도로 남긴다. */
    fun revoke(provider: Provider, token: String)
}
