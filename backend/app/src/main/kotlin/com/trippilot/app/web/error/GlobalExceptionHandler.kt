package com.trippilot.app.web.error

import com.trippilot.app.web.CorrelationIdFilter
import com.trippilot.core.error.AgeRequirementNotMet
import com.trippilot.core.error.AuthenticationRequired
import com.trippilot.core.error.ConflictDetected
import com.trippilot.core.error.DomainException
import com.trippilot.core.error.ErrorCode
import com.trippilot.core.error.PermissionDenied
import com.trippilot.core.error.RateLimited
import com.trippilot.core.error.ResourceNotFound
import com.trippilot.core.error.UpstreamUnavailable
import com.trippilot.core.error.ValidationFailed
import org.slf4j.LoggerFactory
import org.slf4j.MDC
import org.springframework.http.HttpHeaders
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.MethodArgumentNotValidException
import org.springframework.web.bind.annotation.ExceptionHandler
import org.springframework.web.bind.annotation.RestControllerAdvice

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
            is AgeRequirementNotMet -> HttpStatus.FORBIDDEN
            is PermissionDenied -> HttpStatus.FORBIDDEN
            is ResourceNotFound -> HttpStatus.NOT_FOUND
            is ValidationFailed -> HttpStatus.BAD_REQUEST
            is ConflictDetected -> HttpStatus.CONFLICT
            is UpstreamUnavailable -> HttpStatus.SERVICE_UNAVAILABLE
            is RateLimited -> HttpStatus.TOO_MANY_REQUESTS
        }
        if (status.is5xxServerError) {
            log.error("도메인 예외(5xx): {}", ex.errorCode, ex)
        } else {
            log.warn("도메인 예외: {} - {}", ex.errorCode, ex.message)
        }

        val fields = (ex as? ValidationFailed)?.fieldErrors?.map { ErrorResponse.Field(it.field, it.reason) }
        val body = ErrorResponse(ErrorResponse.Body(ex.errorCode.name, ex.message ?: "", traceId(), fields))

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

    /** 미처리 예외 — 침묵 금지: 로깅 + 일반화 봉투(내부 정보 비노출). */
    @ExceptionHandler(Exception::class)
    fun handleUnexpected(ex: Exception): ResponseEntity<ErrorResponse> {
        log.error("미처리 예외", ex)
        val body = ErrorResponse(
            ErrorResponse.Body(ErrorCode.INTERNAL.name, "내부 오류가 발생했습니다.", traceId(), null),
        )
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(body)
    }

    private fun traceId(): String? = MDC.get(CorrelationIdFilter.MDC_KEY)
}
