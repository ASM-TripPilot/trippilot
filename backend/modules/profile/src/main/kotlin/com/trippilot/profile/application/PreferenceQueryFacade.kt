package com.trippilot.profile.application

import com.trippilot.profile.api.PreferenceFacade
import com.trippilot.profile.api.PreferenceSnapshot
import com.trippilot.profile.domain.PreferenceSetRepository
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.util.UUID

/**
 * [PreferenceFacade] 구현 — PreferenceSetRepository 를 감싸 저장된 선택값을 api-safe 스냅숏으로 노출.
 * 미설정 축은 저장값 그대로(NULL→빈 목록/null) 전달 — 조회 응답의 중립 기본값 파생([PreferenceService.get]/view)과
 * 달리 '선택 없음'을 그대로 넘긴다(AI 소프트 가중치 입력, INV-PR2).
 */
@Service
class PreferenceQueryFacade(
    private val repository: PreferenceSetRepository,
) : PreferenceFacade {
    @Transactional(readOnly = true)
    override fun findPreferences(accountId: UUID): PreferenceSnapshot {
        val p = repository.find(accountId)
        return PreferenceSnapshot(
            styles = p?.styles ?: emptyList(),
            activities = p?.activities ?: emptyList(),
            foodTastes = p?.foodTastes ?: emptyList(),
            transportModes = p?.transportModes ?: emptyList(),
            pace = p?.pace,
            companionTypes = p?.companionTypes ?: emptyList(),
            petFriendly = p?.petFlag ?: false,
            budgetTier = p?.budgetTier,
        )
    }
}
