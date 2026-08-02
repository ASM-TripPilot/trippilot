package com.trippilot.savedaccommodation.adapter.`in`.web

import com.trippilot.core.error.AuthenticationRequired
import java.security.Principal
import java.util.UUID

/** 인증 주체 → accountId(UUID). sub 가 UUID 가 아니면 401. (spring-security 컴파일 의존 없이 JDK Principal) */
fun Principal.accountId(): UUID =
    runCatching { UUID.fromString(name) }.getOrElse { throw AuthenticationRequired() }
