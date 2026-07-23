package com.trippilot.core.error

/** 필드별 검증 실패 상세 — 에러 봉투 `error.fields[]` 항목(VALIDATION_ERROR 전용). */
data class FieldError(
    val field: String,
    val reason: String,
)
