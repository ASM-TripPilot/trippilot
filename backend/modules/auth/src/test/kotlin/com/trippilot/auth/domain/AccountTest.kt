package com.trippilot.auth.domain

import com.trippilot.core.error.AgeRequirementNotMet
import com.trippilot.core.error.ConflictDetected
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import io.kotest.property.Arb
import io.kotest.property.arbitrary.int
import io.kotest.property.arbitrary.localDate
import io.kotest.property.arbitrary.orNull
import io.kotest.property.arbitrary.string
import io.kotest.property.checkAll
import java.time.Instant
import java.time.Period
import java.time.ZoneOffset

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

    // --- 연령확인 게이트 (TRIP-152) ---
    val today = now.atZone(ZoneOffset.UTC).toLocalDate()

    "BIRTH_DATE 만 14세 이상은 ACTIVE 로 가입된다" {
        val exactly14 = today.minusYears(14)
        Account.registerViaSocial(null, AgeMethod.BIRTH_DATE, exactly14, now).status shouldBe AccountStatus.ACTIVE
    }

    "BIRTH_DATE 만 14세 미만은 AgeRequirementNotMet" {
        val almost14 = today.minusYears(14).plusDays(1) // 하루 모자람
        shouldThrow<AgeRequirementNotMet> {
            Account.registerViaSocial(null, AgeMethod.BIRTH_DATE, almost14, now)
        }
    }

    "PBT — BIRTH_DATE 가입 성공은 만 나이 ≥ 14 와 정확히 일치한다" {
        checkAll(Arb.int(0..40 * 365)) { daysOld ->
            val birthDate = today.minusDays(daysOld.toLong())
            val age = Period.between(birthDate, today).years
            val accepted = runCatching {
                Account.registerViaSocial(null, AgeMethod.BIRTH_DATE, birthDate, now)
            }.isSuccess
            accepted shouldBe (age >= Account.MIN_AGE_YEARS)
        }
    }

    // --- 상태머신 (TRIP-152) ---
    fun active() = Account.registerViaSocial(null, AgeMethod.SELF_DECLARED, null, now)

    "requestDeletion: ACTIVE→DELETION_PENDING, 그 외 상태는 ConflictDetected" {
        active().requestDeletion().status shouldBe AccountStatus.DELETION_PENDING
        shouldThrow<ConflictDetected> { active().requestDeletion().requestDeletion() }
    }

    "cancelDeletion: DELETION_PENDING→ACTIVE, ACTIVE 에서는 ConflictDetected" {
        active().requestDeletion().cancelDeletion().status shouldBe AccountStatus.ACTIVE
        shouldThrow<ConflictDetected> { active().cancelDeletion() }
    }

    "completeDeletion: DELETION_PENDING→DELETED + deletedAt, ACTIVE 에서는 ConflictDetected" {
        val deleted = active().requestDeletion().completeDeletion(now)
        deleted.status shouldBe AccountStatus.DELETED
        deleted.deletedAt shouldBe now
        shouldThrow<ConflictDetected> { active().completeDeletion(now) }
    }

    "applySanction 은 제재를 설정하고, 파기된 계정에는 ConflictDetected" {
        active().applySanction(SanctionStatus.FULLY_SUSPENDED).sanctionStatus shouldBe SanctionStatus.FULLY_SUSPENDED
        val deleted = active().requestDeletion().completeDeletion(now)
        shouldThrow<ConflictDetected> { deleted.applySanction(SanctionStatus.WARNED) }
    }

    "canAuthenticate: ACTIVE 는 true, DELETED·FULLY_SUSPENDED 는 false" {
        active().canAuthenticate() shouldBe true
        active().applySanction(SanctionStatus.FULLY_SUSPENDED).canAuthenticate() shouldBe false
        active().requestDeletion().completeDeletion(now).canAuthenticate() shouldBe false
    }
})
