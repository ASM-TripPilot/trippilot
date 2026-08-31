package com.trippilot.app.web.error

import com.trippilot.app.web.CorrelationIdFilter
import com.trippilot.core.error.AgeRequirementNotMet
import com.trippilot.core.error.AuthenticationRequired
import com.trippilot.archive.api.VisitConflictState
import com.trippilot.core.error.ConflictDetected
import java.util.UUID
import com.trippilot.core.error.DomainException
import com.trippilot.core.error.ErrorCode
import com.trippilot.core.error.ModerationUnavailable
import com.trippilot.core.error.PermissionDenied
import com.trippilot.core.error.ProviderNotSupported
import com.trippilot.core.error.RateLimited
import com.trippilot.core.error.ResourceNotFound
import com.trippilot.core.error.UpstreamUnavailable
import com.trippilot.core.error.ValidationFailed
import org.slf4j.LoggerFactory
import org.slf4j.MDC
import org.springframework.http.HttpHeaders
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.http.converter.HttpMessageNotReadableException
import org.springframework.web.bind.MethodArgumentNotValidException
import org.springframework.web.bind.annotation.ExceptionHandler
import org.springframework.web.bind.annotation.RestControllerAdvice
import org.springframework.web.servlet.resource.NoResourceFoundException

/**
 * 전역 예외 → 에러 봉투 변환(U1-내부아키텍처 §4.2 — 매핑 1곳 집중).
 * ADR-0011 침묵 실패 금지: 미처리 예외도 반드시 봉투로 반환 + 로깅. 원인은 클라이언트에 비노출(SECURITY-15).
 */
@RestControllerAdvice
class GlobalExceptionHandler {

    private val log = LoggerFactory.getLogger(javaClass)

    /** 타입화된 도메인 예외(ADR-0011 공통 계약). */
    @ExceptionHandler(DomainException::class)
    fun handleDomain(ex: DomainException): ResponseEntity<ErrorResponse> {
        val status = when (ex) {
            is AuthenticationRequired -> HttpStatus.UNAUTHORIZED
            // 422 다(BR-U0-05 "미충족 422, 계정 미생성"). 403 이 아닌 이유: 입력은 형식·인증 모두 정상이고
            // **업무 규칙**에 걸린 것이다. 403 은 "권한이 없다"라 클라이언트가 재로그인·권한요청으로 오독한다.
            is AgeRequirementNotMet -> HttpStatus.UNPROCESSABLE_ENTITY
            is PermissionDenied -> HttpStatus.FORBIDDEN
            is ResourceNotFound -> HttpStatus.NOT_FOUND
            is ValidationFailed -> HttpStatus.BAD_REQUEST
            is ConflictDetected -> HttpStatus.CONFLICT
            is UpstreamUnavailable -> HttpStatus.SERVICE_UNAVAILABLE
            is ModerationUnavailable -> HttpStatus.SERVICE_UNAVAILABLE
            is RateLimited -> HttpStatus.TOO_MANY_REQUESTS
            // 501 — 요청은 유효하고 서버가 아직 그 기능을 안 한다. 401 이면 앱이 재시도를 권해 사용자가 헛돈다.
            is ProviderNotSupported -> HttpStatus.NOT_IMPLEMENTED
        }
        if (status.is5xxServerError) {
            log.error("도메인 예외(5xx): {}", ex.errorCode, ex)
        } else {
            log.warn("도메인 예외: {} - {}", ex.errorCode, ex.message)
        }

        val fields = (ex as? ValidationFailed)?.fieldErrors?.map { ErrorResponse.Field(it.field, it.reason) }
        val body = ErrorResponse(
            ErrorResponse.Body(
                ex.errorCode.name, ex.message ?: "", traceId(), fields,
                existingProvider(ex), activeTripId(ex),
                visitConflict(ex)?.visitCheckId?.toString(), visitConflict(ex)?.updatedAt?.toString(),
            ),
        )

        val builder = ResponseEntity.status(status)
        if (ex is RateLimited) builder.header(HttpHeaders.RETRY_AFTER, ex.retryAfterSeconds.toString())
        return builder.body(body)
    }

    /** @Valid 실패 → 400 VALIDATION_ERROR (필드별). */
    @ExceptionHandler(MethodArgumentNotValidException::class)
    fun handleValidation(ex: MethodArgumentNotValidException): ResponseEntity<ErrorResponse> {
        val fields = ex.bindingResult.fieldErrors.map {
            ErrorResponse.Field(it.field, it.defaultMessage ?: "유효하지 않은 값")
        }
        log.warn("검증 실패: {} 필드", fields.size)
        val body = ErrorResponse(
            ErrorResponse.Body(ErrorCode.VALIDATION_ERROR.name, "입력값이 유효하지 않습니다.", traceId(), fields),
        )
        return ResponseEntity.badRequest().body(body)
    }

    /** 본문 파싱 실패(잘못된 JSON·enum·타입 등) → 400. 침묵 500 대신 클라이언트 오류로 표면화. */
    @ExceptionHandler(HttpMessageNotReadableException::class)
    fun handleUnreadable(ex: HttpMessageNotReadableException): ResponseEntity<ErrorResponse> {
        log.warn("요청 본문 파싱 실패: {}", ex.mostSpecificCause.message)
        val body = ErrorResponse(
            ErrorResponse.Body(ErrorCode.VALIDATION_ERROR.name, "요청 본문을 해석할 수 없습니다.", traceId(), null),
        )
        return ResponseEntity.badRequest().body(body)
    }

    /**
     * 매핑 없는 경로 → **404**.
     *
     * 이 핸들러가 없으면 아래 `Exception` 핸들러가 삼켜 **500** 이 나간다(ADR-0011 봉투는 맞지만
     * 분류가 틀렸다). 이 advice 는 `ResponseEntityExceptionHandler` 를 상속하지 않아 스프링 기본
     * 처리도 받지 못하고, `ExceptionHandlerExceptionResolver` 가 기본 리졸버보다 먼저 돌아 이쪽이 이긴다.
     *
     * 왜 중요한가: 클라이언트가 오타·미배포 경로를 "서버 장애"로 오인한다. 재시도·폴백 판단이
     * 5xx 기준으로 갈리므로 **잘못된 갈래를 탄다.**
     *
     * 로그는 warn 이다 — 정상적인 클라이언트 오류를 error 로 남기면 장애 알림이 오염된다.
     */
    @ExceptionHandler(NoResourceFoundException::class)
    fun handleNoResource(ex: NoResourceFoundException): ResponseEntity<ErrorResponse> {
        log.warn("매핑 없는 경로: {}", ex.resourcePath)
        val body = ErrorResponse(
            ErrorResponse.Body(ErrorCode.RESOURCE_NOT_FOUND.name, "요청한 경로를 찾을 수 없습니다.", traceId(), null),
        )
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(body)
    }

    /** 미처리 예외 — 침묵 금지: 로깅 + 일반화 봉투(내부 정보 비노출). */
    @ExceptionHandler(Exception::class)
    fun handleUnexpected(ex: Exception): ResponseEntity<ErrorResponse> {
        log.error("미처리 예외", ex)
        val body = ErrorResponse(
            ErrorResponse.Body(ErrorCode.INTERNAL.name, "내부 오류가 발생했습니다.", traceId(), null),
        )
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(body)
    }

    /**
     * 소셜 이메일 충돌(409)에 한해 기존 제공자를 계약 필드로 꺼낸다(TRIP-211 · BR-U0-04 · INV-A3).
     *
     * [ConflictDetected.current] 는 `Any?` 라 호출자마다 타입이 다르다(계정 상태 enum·provider 목록 등).
     * 그래서 일반 필드로 노출하지 않고 **이 errorCode 에서만** 꺼낸다 — free-form object 가 되면
     * openapi 계약이 계약 노릇을 못 한다. 세 번째 도메인이 같은 구조를 요구하면 그때 일반화한다.
     *
     * 한 계정에 social_identity 가 둘 이상일 수 있으나(구글 가입 후 카카오 연결) 프론트 문구가 단수
     * 전제라 **대표 1개**(가장 먼저 연결된 것)만 준다. 복수 나열은 message 가 이미 담는다.
     */
    private fun existingProvider(ex: DomainException): String? {
        if (ex !is ConflictDetected || ex.errorCode != ErrorCode.SOCIAL_EMAIL_CONFLICT) return null
        return (ex.current as? List<*>)?.firstOrNull()?.toString()?.lowercase()
    }

    /**
     * 생성 동시 실행 충돌(409)에 한해 진행 중인 여행을 계약 필드로 꺼낸다(TRIP-403).
     *
     * [existingProvider] 와 같은 방식이다 — `current` 를 일반 필드로 노출하면 free-form object 가 되어
     * openapi 가 계약 노릇을 못 한다. 이것이 두 번째 사례라 아직 좁게 둔다.
     */
    private fun activeTripId(ex: DomainException): String? {
        if (ex !is ConflictDetected || ex.errorCode != ErrorCode.GENERATION_IN_PROGRESS) return null
        return (ex.current as? UUID)?.toString()
    }

    /**
     * 방문 기록 충돌(409) 두 코드에 한해 서버 쪽 상태를 계약 필드로 꺼낸다(TRIP-546).
     *
     * [existingProvider]·[activeTripId] 와 같은 방식이다. 세 번째 사례라 일반화를 고민했으나,
     * 일반화의 실체가 free-form object 여서 그만뒀다 — 자세한 근거는 [ErrorResponse.Body.visitCheckId].
     */
    private fun visitConflict(ex: DomainException): VisitConflictState? {
        if (ex !is ConflictDetected) return null
        if (ex.errorCode != ErrorCode.VISIT_ALREADY_RECORDED && ex.errorCode != ErrorCode.VISIT_CONFLICT) return null
        return ex.current as? VisitConflictState
    }

    private fun traceId(): String? = MDC.get(CorrelationIdFilter.MDC_KEY)
}
