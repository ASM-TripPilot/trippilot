package com.trippilot.core.error

/**
 * 도메인 에러 코드 — HTTP status 와 분리된 클라이언트 분기용 식별자(U1-내부아키텍처 §4.2).
 * 문자열 값이 에러 봉투의 `error.code` 로 노출된다.
 */
enum class ErrorCode {
    VALIDATION_ERROR,
    AUTHENTICATION_REQUIRED,
    PERMISSION_DENIED,
    RESOURCE_NOT_FOUND,
    CONFLICT,
    UPSTREAM_UNAVAILABLE,
    RATE_LIMITED,
    INTERNAL,

    // 도메인별 코드(전역 카탈로그) — 상태는 대응 DomainException 타입이 결정
    SOCIAL_AUTH_FAILED,
    /** 그 제공자를 **아직** 지원하지 않는다(501). 자격 증명 실패와 구분해야 화면이 "준비 중"을 말할 수 있다. */
    PROVIDER_NOT_SUPPORTED,
    SOCIAL_EMAIL_CONFLICT,
    REFRESH_TOKEN_INVALID,   // 리프레시 토큰 미존재·만료·폐기(401)
    REFRESH_REUSE_DETECTED,  // 소진된 리프레시 토큰 재제시 → 체인 폐기(401, INV-R2)
    AGE_REQUIREMENT_NOT_MET, // 만 14세 미만 가입 차단(422 — BR-U0-05 "미충족 422, 계정 미생성")
    NICKNAME_TAKEN,          // 닉네임 대소문자 무시 중복(409, INV-P1)
    GENERATION_IN_PROGRESS,  // 다른 여행의 일정을 생성 중(409, TRIP-403)
    MODERATION_UNAVAILABLE,  // 활성 금칙어 사전 미로드 — 검증 차단(503, fail-closed INV-B2)
    VISIT_ALREADY_RECORDED,  // 재생한 방문 기록이 **이미 서버에 같은 상태로 있다**(409, BR-U5-20)
    VISIT_CONFLICT,          // 재생한 방문 기록이 서버와 **다른 상태**다 — 사용자 해소 필요(409, BR-U5-21)
}
