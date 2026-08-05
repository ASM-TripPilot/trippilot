package com.trippilot.profile.application

import com.trippilot.profile.domain.PreferenceSet
import com.trippilot.profile.domain.PreferenceSetRepository
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import java.time.Instant
import java.util.UUID

private class FakePrefRepoForFacade : PreferenceSetRepository {
    val stored = mutableMapOf<UUID, PreferenceSet>()
    override fun find(accountId: UUID) = stored[accountId]
    override fun save(preferenceSet: PreferenceSet) = preferenceSet.also { stored[it.accountId] = it }
}

/**
 * PreferenceFacade 계약 — 저장된 선택값을 api-safe 스냅숏으로 그대로 노출.
 * 조회 응답(PreferenceService.view)의 중립 기본값 파생과 달리 '선택 없음'을 주입 없이 전달한다(INV-PR2).
 */
class PreferenceQueryFacadeTest : StringSpec({

    val account = UUID.randomUUID()
    val now = Instant.parse("2026-08-06T00:00:00Z")

    "미설정 계정은 빈 스냅숏(중립 기본값 미주입)" {
        val snap = PreferenceQueryFacade(FakePrefRepoForFacade()).findPreferences(account)
        snap.styles shouldBe emptyList()
        snap.activities shouldBe emptyList()
        snap.foodTastes shouldBe emptyList()
        snap.transportModes shouldBe emptyList() // view 와 달리 '대중교통' 주입 안 함
        snap.companionTypes shouldBe emptyList()
        snap.pace shouldBe null
        snap.budgetTier shouldBe null
        snap.petFriendly shouldBe false
    }

    "저장된 선택값을 그대로 매핑 + budgetTier 노출" {
        val repo = FakePrefRepoForFacade()
        repo.save(
            PreferenceSet.reconstitute(
                accountId = account,
                styles = listOf("미식", "자연"),
                budgetTier = "중간",
                budgetRawAmount = 500_000,
                companionTypes = listOf("친구"),
                petFlag = true,
                activities = listOf("야경"),
                transportModes = listOf("렌터카"),
                foodTastes = listOf("한식"),
                pace = "알차게",
                updatedAt = now,
            ),
        )
        val snap = PreferenceQueryFacade(repo).findPreferences(account)
        snap.styles shouldBe listOf("미식", "자연")
        snap.activities shouldBe listOf("야경")
        snap.foodTastes shouldBe listOf("한식")
        snap.transportModes shouldBe listOf("렌터카")
        snap.pace shouldBe "알차게"
        snap.companionTypes shouldBe listOf("친구")
        snap.petFriendly shouldBe true
        snap.budgetTier shouldBe "중간"
    }
})
