package com.trippilot.app.web.error

/**
 * 실패 응답 봉투(U1-내부아키텍처 §4.1) — 성공(2xx)은 래퍼 없이 리소스 본문 그대로.
 * ```json
 * { "error": { "code": "NICKNAME_TAKEN", "message": "...", "traceId": "...", "fields": [ ... ] } }
 * ```
 */
data class ErrorResponse(
    val error: Body,
) {
    data class Body(
        val code: String,
        val message: String,
        val traceId: String?,
        /** VALIDATION_ERROR 에만 존재. */
        val fields: List<Field>? = null,
    )

    data class Field(
        val field: String,
        val reason: String,
    )
}
