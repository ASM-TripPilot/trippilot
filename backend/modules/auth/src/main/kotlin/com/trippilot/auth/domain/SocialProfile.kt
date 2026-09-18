package com.trippilot.auth.domain

/**
 * 소셜 code 교환 결과 — 제공자가 보증하는 신원(값 객체).
 * `email` 은 제공자 미제공 시 null(Apple 비공개 릴레이 등).
 */
data class SocialProfile(
    val provider: Provider,
    val providerSub: String,
    val email: String?,
)
