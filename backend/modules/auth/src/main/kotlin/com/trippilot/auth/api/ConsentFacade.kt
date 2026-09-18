package com.trippilot.auth.api

import java.util.UUID

/**
 * 동의 상태 조회 퍼사드(C1 auth) — 타 모듈(profile 부트스트랩·온보딩)이 의존하는 공개 계약(R1, `..api..`).
 * api-safe 타입만 노출(UUID·String·Boolean) — auth 내부 도메인 타입(TermsType 등)은 넘기지 않는다.
 */
interface ConsentFacade {
    /** 재동의가 필요한 약관 유형명 목록(비면 재동의 불필요). 부트스트랩 reconsent 게이트용. */
    fun requiredReconsentTermsTypes(accountId: UUID): List<String>

    /** 온보딩 필수 약관(이용약관·개인정보)에 현재 모두 동의했는지(INV-C3·P2). */
    fun hasCompletedOnboardingConsents(accountId: UUID): Boolean
}
