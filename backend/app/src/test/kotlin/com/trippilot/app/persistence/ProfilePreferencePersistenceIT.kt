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
    fun `빈 배열은 NULL 과 구별되어 왕복된다(INV-PR2, 설정함 vs 미설정)`() {
        val id = newAccountId()
        // styles=빈 목록(설정함), activities=NULL(미설정)
        preferences.save(PreferenceSet.of(id, emptyList(), null, null, null, false, null, null, null, null, now))

        val found = preferences.find(id)
        found.shouldNotBeNull()
        found.styles shouldBe emptyList()   // '{}' → null 로 퇴화하지 않아야(INV-PR2)
        found.activities.shouldBeNull()
    }

    @Test
    fun `앱 허용값 전체가 DB CHECK 를 통과한다(vocab 드리프트 방지)`() {
        val id = newAccountId()
        // 각 축의 모든 허용값을 한 번에 저장 — 앱 vocab ⊆ DB CHECK 임을 실증
        preferences.save(
            PreferenceSet.of(
                accountId = id,
                styles = PreferenceSet.STYLES.toList(),
                budgetTier = "럭셔리", budgetRawAmount = 9_999_999,
                companionTypes = PreferenceSet.COMPANION_TYPES.toList(),
                petFlag = true,
                activities = PreferenceSet.ACTIVITIES.toList(),
                transportModes = PreferenceSet.TRANSPORT_MODES.toList(),
                foodTastes = PreferenceSet.FOOD_TASTES.toList(),
                pace = "균형있게",
                now = now,
            ),
        )
        preferences.find(id).shouldNotBeNull().styles shouldBe PreferenceSet.STYLES.toList()
    }

    @Test
    fun `취향 upsert — 같은 계정 재저장`() {
        val id = newAccountId()
        preferences.save(PreferenceSet.of(id, listOf("휴양"), null, null, null, false, null, null, null, null, now))
        preferences.save(PreferenceSet.of(id, listOf("관광", "쇼핑"), null, null, null, false, null, null, null, null, now.plusSeconds(1)))

        preferences.find(id).shouldNotBeNull().styles shouldBe listOf("관광", "쇼핑")
    }
}
