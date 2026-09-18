package com.trippilot.app.observability

/**
 * OTLP 로그 경로용 마스킹 규칙 (NFR-U1-SEC-22).
 *
 * stdout JSON 경로는 `logback-spring.xml` 의 MaskingJsonGeneratorDecorator 가 이미 담당한다.
 * 그 데코레이터는 **JSON 인코더에만** 걸리므로, 인코더를 쓰지 않는 OTLP appender 는 그대로 두면
 * 마스킹을 우회한다. 이 클래스가 그 구멍을 막는다.
 *
 * ⚠️ 아래 목록은 `logback-spring.xml` 의 path/value 목록과 **동기 유지**해야 한다.
 * 한쪽만 고치면 경로에 따라 마스킹 결과가 갈린다 — MaskingParityTest 가 이를 감시한다.
 */
object LogMasker {

    /** logback-spring.xml 의 defaultMask 와 같은 값이어야 한다. */
    const val MASK: String = "****"

    /** logback-spring.xml 의 `<path>` 목록과 동일. */
    private val SENSITIVE_KEYS = listOf(
        "password", "passwordHash",
        "token", "tokenHash", "accessToken", "refreshToken", "idToken", "id_token",
        "authorization", "Authorization",
        "authorizationCode", "oauthCode", "socialCode",
        "verificationToken", "resetToken",
        "email", "providerEmail",
        "birthDate", "birth_date",
    ).joinToString("|")

    private val RULES: List<Pair<Regex, String>> = listOf(
        // logback-spring.xml `<value>` ① Bearer 토큰
        Regex("""Bearer\s+[A-Za-z0-9\-._~+/]+=*""") to "Bearer $MASK",

        // JWT 3분절 원문 — Bearer 접두사 없이 노출되는 경우
        Regex("""\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]*""") to MASK,

        // 평문 로그의 키=값 (JSON 경로의 `<path>` 에 대응)
        Regex("""(?i)\b($SENSITIVE_KEYS)\b(\s*[:=]\s*)"?[^"',;\s}\])]+"?""") to "$1$2$MASK",

        // logback-spring.xml `<value>` ② 이메일 주소
        Regex("""[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}""") to MASK,
    )

    /** 문자열 하나를 마스킹한다. null·빈 문자열은 그대로 통과한다. */
    fun mask(raw: String?): String? {
        if (raw.isNullOrEmpty()) return raw
        return RULES.fold(raw) { acc, (pattern, replacement) -> pattern.replace(acc, replacement) }
    }

    /** MDC 맵의 **값**만 마스킹한다. 키는 검색 축이므로 보존한다. */
    fun maskValues(properties: Map<String, String>?): Map<String, String>? {
        if (properties.isNullOrEmpty()) return properties
        return properties.mapValues { (_, value) -> mask(value) ?: value }
    }
}
