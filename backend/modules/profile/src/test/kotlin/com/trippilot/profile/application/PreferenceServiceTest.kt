package com.trippilot.profile.application

import com.trippilot.core.error.ValidationFailed
import com.trippilot.profile.domain.PreferenceSet
import com.trippilot.profile.domain.PreferenceSetRepository
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import java.util.UUID

private class FakePreferenceRepo : PreferenceSetRepository {
    val stored = mutableMapOf<UUID, PreferenceSet>()
    override fun find(accountId: UUID) = stored[accountId]
    override fun save(preferenceSet: PreferenceSet) = preferenceSet.also { stored[it.accountId] = it }
}

class PreferenceServiceTest : StringSpec({

    val clock = Clock.fixed(Instant.parse("2026-07-19T00:00:00Z"), ZoneOffset.UTC)
    val account = UUID.randomUUID()

    fun service() = PreferenceService(FakePreferenceRepo(), clock)

    "미설정 조회는 중립 기본값 완전 응답" {
        val v = service().get(account)
        v.transportModes.value shouldBe listOf("대중교통")
        v.transportModes.isNeutralDefault shouldBe true
        v.styles.isNeutralDefault shouldBe true
    }

    "SetTo 로 설정 후 반영" {
        val svc = service()
        val v = svc.update(account, PreferencePatch(styles = Patch.SetTo(listOf("휴양", "관광"))))
        v.styles.value shouldBe listOf("휴양", "관광")
        v.styles.isNeutralDefault shouldBe false
    }

    "Keep 은 기존값 유지, SetTo(null) 은 미설정으로 초기화" {
        val svc = service()
        svc.update(account, PreferencePatch(styles = Patch.SetTo(listOf("휴양")), pace = Patch.SetTo("알차게")))

        // pace 만 변경, styles 는 Keep → 유지
        val v1 = svc.update(account, PreferencePatch(pace = Patch.SetTo("느긋하게")))
        v1.styles.value shouldBe listOf("휴양")
        v1.pace.value shouldBe "느긋하게"

        // styles 를 SetTo(null) → 미설정(중립)
        val v2 = svc.update(account, PreferencePatch(styles = Patch.SetTo(null)))
        v2.styles.isNeutralDefault shouldBe true
        v2.pace.value shouldBe "느긋하게" // pace 는 Keep 이라 유지
    }

    "예산 금액만(등급 없음) 저장은 ValidationFailed(INV-PR3)" {
        shouldThrow<ValidationFailed> {
            service().update(account, PreferencePatch(budgetRawAmount = Patch.SetTo(100_000)))
        }
    }

    "petFlag 토글" {
        val svc = service()
        svc.update(account, PreferencePatch(petFlag = Patch.SetTo(true))).companion.petFlag shouldBe true
        svc.update(account, PreferencePatch(petFlag = Patch.SetTo(false))).companion.petFlag shouldBe false
    }
})
