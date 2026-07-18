package com.trippilot.auth.domain

import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import io.kotest.property.Arb
import io.kotest.property.arbitrary.localDate
import io.kotest.property.arbitrary.orNull
import io.kotest.property.arbitrary.string
import io.kotest.property.checkAll
import java.time.Instant

class AccountTest : StringSpec({

    val now = Instant.parse("2026-01-01T00:00:00Z")

    "소셜 신규 가입은 즉시 ACTIVE 이고 verifiedAt=createdAt, ageConfirmedAt=now" {
        val account = Account.registerViaSocial(
            email = "user@example.com",
            ageMethod = AgeMethod.SELF_DECLARED,
            birthDate = null,
            now = now,
        )

        account.status shouldBe AccountStatus.ACTIVE
        account.verifiedAt shouldBe account.createdAt
        account.createdAt shouldBe now
        account.ageConfirmedAt shouldBe now
    }

    "BIRTH_DATE 연령확인은 birthDate 없으면 거부한다 (INV-A2)" {
        shouldThrow<IllegalArgumentException> {
            Account.registerViaSocial(
                email = null,
                ageMethod = AgeMethod.BIRTH_DATE,
                birthDate = null,
                now = now,
            )
        }
    }

    "PBT — 어떤 이메일/생년월일이든 SELF_DECLARED 가입은 항상 즉시 ACTIVE" {
        checkAll(Arb.string().orNull(), Arb.localDate().orNull()) { email, birthDate ->
            Account.registerViaSocial(email, AgeMethod.SELF_DECLARED, birthDate, now)
                .status shouldBe AccountStatus.ACTIVE
        }
    }
})
