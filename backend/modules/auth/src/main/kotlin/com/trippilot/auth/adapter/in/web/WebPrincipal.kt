package com.trippilot.auth.adapter.`in`.web

import com.trippilot.auth.domain.AccountId
import com.trippilot.auth.domain.consent.TermsType
import com.trippilot.core.error.AuthenticationRequired
import com.trippilot.core.error.ResourceNotFound
import java.security.Principal
import java.util.UUID

/**
 * 인증 주체 → AccountId. 리소스 서버가 JWT 를 검증한 뒤 SecurityContext 의 인증 이름(=sub=accountId)을
 * 스프링 MVC 가 [Principal] 로 주입한다 — spring-security 컴파일 의존 없이 표준 JDK 타입으로 받는다.
 * sub 가 UUID 가 아닌 토큰(오발급·타 용도)은 계정으로 매핑 불가 → 401(500 회피, 사유 비노출).
 */
fun Principal.accountId(): AccountId =
    runCatching { AccountId(UUID.fromString(name)) }.getOrElse { throw AuthenticationRequired() }

/** 경로 변수의 약관 유형 파싱 — 미지의 값은 404(잘못된 enum 으로 인한 500 회피). */
fun parseTermsType(raw: String): TermsType =
    runCatching { TermsType.valueOf(raw) }.getOrElse { throw ResourceNotFound("알 수 없는 약관 유형: $raw") }
