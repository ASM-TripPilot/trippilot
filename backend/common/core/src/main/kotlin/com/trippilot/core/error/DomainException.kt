package com.trippilot.core.error

/**
 * 공통 예외 계약 (ADR-0011) — 전 퍼사드는 실패를 타입화해 표면화한다(침묵 실패 금지).
 * 각 예외는 클라이언트 분기용 [ErrorCode] 를 지닌다. HTTP status 매핑은 웹 계층(app)이 소유.
 */
sealed class DomainException(
    val errorCode: ErrorCode,
    message: String,
    cause: Throwable? = null,
) : RuntimeException(message, cause)

/**
 * 인증되지 않은 호출(401). 원인은 클라이언트에 비노출(SECURITY-15).
 * 소셜 인증 실패 등 401 계열의 특화 코드는 [errorCode] 로 지정(예: SOCIAL_AUTH_FAILED).
 */
class AuthenticationRequired(
    message: String = "인증이 필요합니다.",
    errorCode: ErrorCode = ErrorCode.AUTHENTICATION_REQUIRED,
    cause: Throwable? = null,
) : DomainException(errorCode, message, cause)

/**
 * 그 제공자를 **아직** 지원하지 않는다 — 501.
 *
 * 자격 증명 실패(401)와 갈라야 하는 이유: 401 이면 앱이 "다시 시도"를 권하고 사용자는 같은 실패를
 * 반복한다. 사실은 **서버가 아직 그 기능을 안 하는 것**이라 재시도로 풀리지 않는다(INV-4 침묵 실패 금지).
 *
 * 400 도 아니다 — 클라이언트 요청에는 잘못이 없다.
 *
 * 노출하는 것은 **가용성뿐**이다. 왜 미지원인지(JWKS 미구현 등)는 싣지 않는다(SECURITY-15).
 */
class ProviderNotSupported(
    message: String,
) : DomainException(ErrorCode.PROVIDER_NOT_SUPPORTED, message)

/** 만 14세 미만 등 연령 요건 미충족으로 가입·이용 거부(403, INV-A). */
class AgeRequirementNotMet(
    message: String = "연령 요건을 충족하지 않습니다.",
) : DomainException(ErrorCode.AGE_REQUIREMENT_NOT_MET, message)

/** 소유권·참여 권한 위반(IDOR 방지, 서버 측 검증). */
class PermissionDenied(
    message: String = "권한이 없습니다.",
) : DomainException(ErrorCode.PERMISSION_DENIED, message)

/** 대상 리소스 없음. */
class ResourceNotFound(
    message: String = "리소스를 찾을 수 없습니다.",
) : DomainException(ErrorCode.RESOURCE_NOT_FOUND, message)

/** 입력 스키마·규칙 위반(필드별). */
class ValidationFailed(
    val fieldErrors: List<FieldError>,
    message: String = "입력값이 유효하지 않습니다.",
) : DomainException(ErrorCode.VALIDATION_ERROR, message)

/** 버전·거점 비중첩·닉네임 중복 등 충돌 — 현재 상태 동봉. 특화 코드는 [errorCode] 로(예: NICKNAME_TAKEN). */
class ConflictDetected(
    val current: Any? = null,
    message: String = "요청이 현재 상태와 충돌합니다.",
    errorCode: ErrorCode = ErrorCode.CONFLICT,
) : DomainException(errorCode, message)

/** 활성 금칙어 사전 미로드로 텍스트 검증 불가(503, fail-closed INV-B2). */
class ModerationUnavailable(
    message: String = "검증 서비스를 일시적으로 이용할 수 없습니다.",
) : DomainException(ErrorCode.MODERATION_UNAVAILABLE, message)

/** 외부 의존 실패 + 폴백 적용 여부(RESILIENCY-10). */
class UpstreamUnavailable(
    val source: String,
    val fallbackApplied: Boolean,
    message: String = "일시적으로 서비스를 이용할 수 없습니다.",
    cause: Throwable? = null,
) : DomainException(ErrorCode.UPSTREAM_UNAVAILABLE, message, cause)

/** 호출 상한 초과. */
class RateLimited(
    val retryAfterSeconds: Long,
    message: String = "요청이 너무 많습니다. 잠시 후 다시 시도하세요.",
) : DomainException(ErrorCode.RATE_LIMITED, message)
