package com.trippilot.itinerarygeneration.adapter.`in`.web

import com.trippilot.core.error.AuthenticationRequired
import java.security.Principal
import java.util.UUID

/** 인증 주체 → accountId(UUID). sub 가 UUID 가 아니면 401. */
fun Principal.accountId(): UUID =
    runCatching { UUID.fromString(name) }.getOrElse { throw AuthenticationRequired() }
