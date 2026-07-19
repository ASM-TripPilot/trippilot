package com.trippilot.auth.domain.location

import com.trippilot.auth.domain.AccountId
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import io.kotest.property.Arb
import io.kotest.property.arbitrary.boolean
import io.kotest.property.arbitrary.enum
import io.kotest.property.checkAll
import java.time.Instant
import java.util.UUID

/**
 * G182 유효 능력 총함수(INV-L1/L2) — 서버전송=L1∧L2, GPS발자취=L1∧L2∧L3.
 * L1 은 GRANTED 만 활성(DENIED·NOT_DETERMINED=차단).
 */
class LocationConsentCapabilitiesTest : StringSpec({

    val accountId = AccountId(UUID.randomUUID())
    val now = Instant.parse("2026-07-19T00:00:00Z")

    fun consent(os: OsPermission, l2: Boolean, l3: Boolean) =
        LocationConsent.reconstitute(accountId, os, l2, l3, now)

    "PBT — 서버전송=L1∧L2, GPS발자취=L1∧L2∧L3 (모든 조합)" {
        checkAll(Arb.enum<OsPermission>(), Arb.boolean(), Arb.boolean()) { os, l2, l3 ->
            val caps = consent(os, l2, l3).capabilities()
            val l1 = os == OsPermission.GRANTED
            caps.serverLocationService shouldBe (l1 && l2)
            caps.gpsTrackRetention shouldBe (l1 && l2 && l3)
        }
    }

    "L1 GRANTED + L2 + L3 = 전 능력 활성" {
        val caps = consent(OsPermission.GRANTED, l2 = true, l3 = true).capabilities()
        caps.serverLocationService shouldBe true
        caps.gpsTrackRetention shouldBe true
    }

    "L1 DENIED 면 L2·L3 있어도 전 능력 차단(OS 우선)" {
        val caps = consent(OsPermission.DENIED, l2 = true, l3 = true).capabilities()
        caps.serverLocationService shouldBe false
        caps.gpsTrackRetention shouldBe false
    }

    "L2 없이 L3 만 = GPS발자취 불가(법정동의 선행 필요)" {
        consent(OsPermission.GRANTED, l2 = false, l3 = true).capabilities().gpsTrackRetention shouldBe false
    }
})
