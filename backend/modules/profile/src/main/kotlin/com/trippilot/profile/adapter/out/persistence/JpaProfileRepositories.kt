package com.trippilot.profile.adapter.out.persistence

import com.trippilot.profile.domain.PreferenceSet
import com.trippilot.profile.domain.PreferenceSetRepository
import com.trippilot.profile.domain.Profile
import com.trippilot.profile.domain.ProfileRepository
import org.springframework.stereotype.Repository
import java.util.UUID

/** ProfileRepository 포트의 JPA 구현. */
@Repository
class JpaProfileRepository(
    private val jpa: ProfileJpaRepository,
) : ProfileRepository {
    override fun find(accountId: UUID): Profile? = jpa.findById(accountId).orElse(null)?.toDomain()

    override fun existsByNickname(nickname: String): Boolean = jpa.existsByNicknameIgnoreCase(nickname)

    override fun save(profile: Profile): Profile {
        // saveAndFlush — 닉네임 유니크 위반(경합)을 커밋 전에 표면화해 서비스가 409 로 변환할 수 있게 한다.
        jpa.saveAndFlush(profile.toEntity())
        return profile
    }
}

/** PreferenceSetRepository 포트의 JPA 구현(계정당 1행 upsert). */
@Repository
class JpaPreferenceSetRepository(
    private val jpa: PreferenceSetJpaRepository,
) : PreferenceSetRepository {
    override fun find(accountId: UUID): PreferenceSet? = jpa.findById(accountId).orElse(null)?.toDomain()

    override fun save(preferenceSet: PreferenceSet): PreferenceSet {
        jpa.save(preferenceSet.toEntity())
        return preferenceSet
    }
}
