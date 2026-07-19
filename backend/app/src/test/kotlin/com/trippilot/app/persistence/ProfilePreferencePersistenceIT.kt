package com.trippilot.app.persistence

import com.trippilot.auth.domain.Account
import com.trippilot.auth.domain.AgeMethod
import com.trippilot.auth.domain.port.AccountRepository
import com.trippilot.profile.domain.PreferenceSet
import com.trippilot.profile.domain.PreferenceSetRepository
import com.trippilot.profile.domain.Profile
import com.trippilot.profile.domain.ProfileRepository
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.nulls.shouldNotBeNull
import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import java.time.Instant
import java.util.UUID

/**
 * TRIP-156 — profile/preference 영속 IT. 핵심: text[] 배열 축의 저장·조회 왕복(@JdbcTypeCode ARRAY) 검증.
 */
@SpringBootTest
class ProfilePreferencePersistenceIT : AbstractPostgresIntegrationTest() {

    @Autowired lateinit var accounts: AccountRepository
    @Autowired lateinit var profiles: ProfileRepository
    @Autowired lateinit var preferences: PreferenceSetRepository

    private val now = Instant.parse("2026-07-19T00:00:00Z")

    private fun newAccountId(): UUID =
        accounts.save(Account.registerViaSocial(null, AgeMethod.SELF_DECLARED, null, now)).id.value

    @Test
    fun `프로필 저장·조회 왕복`() {
        val id = newAccountId()
        val nickname = "여행자${UUID.randomUUID().toString().take(6)}"
        profiles.save(Profile.reconstitute(id, nickname, now, onboardingCompletedAt = null))

        profiles.find(id).shouldNotBeNull().let {
            it.nickname shouldBe nickname
            it.onboardingCompleted shouldBe false
        }
    }

    @Test
    fun `취향 text 배열 왕복 — 설정 축은 값 보존, 미설정 축은 NULL`() {
        val id = newAccountId()
        preferences.save(
            PreferenceSet.of(
                accountId = id,
                styles = listOf("휴양", "미식"),
                budgetTier = "고급", budgetRawAmount = 3_000_000,
                companionTypes = listOf("혼자", "커플"),
                petFlag = true,
                activities = null,                       // 미설정
                transportModes = listOf("도보", "대중교통"),
                foodTastes = null,                       // 미설정
                pace = "알차게",
                now = now,
            ),
        )

        val found = preferences.find(id)
        found.shouldNotBeNull()
        found.styles shouldBe listOf("휴양", "미식")              // text[] 왕복
        found.companionTypes shouldBe listOf("혼자", "커플")
        found.transportModes shouldBe listOf("도보", "대중교통")
        found.activities.shouldBeNull()                          // NULL=미설정 보존(INV-PR2)
        found.foodTastes.shouldBeNull()
        found.petFlag shouldBe true
        found.budgetRawAmount shouldBe 3_000_000
    }

    @Test
    fun `취향 upsert — 같은 계정 재저장`() {
        val id = newAccountId()
        preferences.save(PreferenceSet.of(id, listOf("휴양"), null, null, null, false, null, null, null, null, now))
        preferences.save(PreferenceSet.of(id, listOf("관광", "쇼핑"), null, null, null, false, null, null, null, null, now.plusSeconds(1)))

        preferences.find(id).shouldNotBeNull().styles shouldBe listOf("관광", "쇼핑")
    }
}
