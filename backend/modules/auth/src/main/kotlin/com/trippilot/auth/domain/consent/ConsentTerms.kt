package com.trippilot.auth.domain.consent

import java.time.Instant

/**
 * 약관/동의 문서 유형(V1.2 terms_version.terms_type). 위치·GPS·개인화·마케팅 포함.
 * 온보딩 완료 필수는 이용약관·개인정보 2종뿐(INV-C3, 와이어프레임 c06) — 위치·마케팅은 게이트가 아니다.
 */
enum class TermsType {
    TERMS_OF_SERVICE,
    PRIVACY_POLICY,
    LOCATION_TERMS,
    MARKETING,
    GPS_RECORDING,
    PERSONALIZATION,
    ;

    companion object {
        /** 온보딩 완료를 막는 필수 약관(INV-C3). 나머지는 기능 게이트에서 개별 수집. */
        val ONBOARDING_REQUIRED: Set<TermsType> = setOf(TERMS_OF_SERVICE, PRIVACY_POLICY)
    }
}

/**
 * 약관 버전(V1.2 terms_version). `(termsType, version)` 이 유일(INV-T1),
 * 현행은 effective_at 최신(INV-T2). reconsentRequired=true 면 클라 재동의 게이트가 뜬다.
 */
data class TermsVersion(
    val termsType: TermsType,
    val version: String,
    val body: String,
    val effectiveAt: Instant,
    val reconsentRequired: Boolean,
)
