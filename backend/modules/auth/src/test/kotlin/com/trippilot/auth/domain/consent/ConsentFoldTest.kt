package com.trippilot.auth.domain.consent

import com.trippilot.auth.domain.AccountId
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import io.kotest.property.Arb
import io.kotest.property.arbitrary.bind
import io.kotest.property.arbitrary.enum
import io.kotest.property.arbitrary.list
import io.kotest.property.arbitrary.long
import io.kotest.property.arbitrary.of
import io.kotest.property.checkAll
import java.time.Instant
import java.util.UUID

/** 증적 폴드(INV-C2) — 타입별 최신(occurredAt 최대) 레코드가 현재 상태다. */
class ConsentFoldTest : StringSpec({

    val accountId = AccountId(UUID.randomUUID())

    val arbRecord: Arb<ConsentRecord> = Arb.bind(
        Arb.enum<TermsType>(),
        Arb.enum<ConsentAction>(),
        Arb.of("1.0", "2.0", "3.1"),
        Arb.long(0L..1_000_000L),
    ) { type, action, version, epoch ->
        ConsentRecord.of(accountId, type, version, action, ConsentChannel.SETTINGS, Instant.ofEpochSecond(epoch))
    }

    "PBT — latestPerType 는 타입별 occurredAt 최대 레코드를 고른다" {
        checkAll(Arb.list(arbRecord, 1..30)) { records ->
            val fold = ConsentFold.latestPerType(records)
            records.groupBy { it.termsType }.forEach { (type, group) ->
                fold.getValue(type).occurredAt shouldBe group.maxOf { it.occurredAt }
            }
            fold.keys shouldBe records.map { it.termsType }.toSet()
        }
    }

    "빈 증적은 빈 상태" {
        ConsentFold.statuses(emptyList()) shouldBe emptyList()
    }

    "REVOKE 가 최신이면 granted=false" {
        val records = listOf(
            ConsentRecord.of(accountId, TermsType.MARKETING, "1.0", ConsentAction.GRANT, ConsentChannel.ONBOARDING, Instant.ofEpochSecond(10)),
            ConsentRecord.of(accountId, TermsType.MARKETING, "1.0", ConsentAction.REVOKE, ConsentChannel.SETTINGS, Instant.ofEpochSecond(20)),
        )
        ConsentFold.statuses(records) shouldBe listOf(ConsentStatus(TermsType.MARKETING, granted = false, termsVersion = "1.0"))
    }
})
