package com.trippilot.profile.application

import com.trippilot.core.error.ResourceNotFound
import com.trippilot.profile.domain.Profile
import com.trippilot.profile.domain.ProfileRepository
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.util.UUID

/**
 * 프로필 조회. 프로필 행은 닉네임 설정(TRIP-157) 시 생성되므로, 미설정 계정은 404.
 */
@Service
class ProfileQueryService(
    private val repository: ProfileRepository,
) {
    @Transactional(readOnly = true)
    fun get(accountId: UUID): Profile =
        repository.find(accountId) ?: throw ResourceNotFound("프로필이 없습니다.")
}
