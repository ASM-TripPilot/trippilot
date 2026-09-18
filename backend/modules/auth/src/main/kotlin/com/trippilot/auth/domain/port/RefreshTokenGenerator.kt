package com.trippilot.auth.domain.port

/** 생성된 리프레시 토큰 — 원문(클라이언트 반환용)과 해시(저장용). 원문은 서버에 저장 금지. */
data class GeneratedRefreshToken(
    val rawToken: String,
    val tokenHash: String,
)

/**
 * 불투명 리프레시 토큰 생성·해시. 원문은 반환 즉시 폐기하고 서버는 해시만 보관한다(유출 대비).
 * 구현(난수원·해시 알고리즘)은 adapter 소유.
 */
interface RefreshTokenGenerator {
    fun generate(): GeneratedRefreshToken

    /** 제시된 원문 토큰을 저장 해시로 변환(조회 키). */
    fun hash(rawToken: String): String
}
