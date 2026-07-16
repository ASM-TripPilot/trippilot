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
}
