package com.trippilot.auth.adapter.`in`.web

import com.trippilot.auth.domain.AccountId
import com.trippilot.core.error.AuthenticationRequired
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import java.security.Principal
import java.util.UUID

/** 인증 주체(JWT sub) → AccountId 변환 — UUID 가 아니면 401(500 회피). */
class WebPrincipalTest : StringSpec({

    "sub 가 UUID 면 AccountId 로 변환한다" {
        val id = UUID.randomUUID()
        Principal { id.toString() }.accountId() shouldBe AccountId(id)
    }

    "sub 가 UUID 가 아니면 AuthenticationRequired" {
        shouldThrow<AuthenticationRequired> { Principal { "not-a-uuid" }.accountId() }
    }
})
