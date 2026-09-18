package com.trippilot.profile.application

import com.trippilot.profile.domain.PreferenceSet
import com.trippilot.profile.domain.PreferenceSetRepository
import com.trippilot.profile.domain.PreferenceView
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.Clock
import java.util.UUID

/**
 * 취향 7축 조회·부분 저장. 조회는 항상 완전 응답(중립 기본값 파생, INV-PR2/PR5).
 * 저장은 부분 허용(Keep=유지, SetTo(null)=해제) + 허용값·예산쌍 검증(INV-PR3, 도메인).
 */
@Service
class PreferenceService(
    private val repository: PreferenceSetRepository,
    private val clock: Clock,
) {
    /** 7축 완전 조회 — 미설정 계정도 중립 기본값으로 완전 응답. */
    @Transactional(readOnly = true)
    fun get(accountId: UUID): PreferenceView =
        (repository.find(accountId) ?: PreferenceSet.empty(accountId, clock.instant())).view()

    /** 부분 수정 후 갱신된 완전 응답 반환. 검증 실패는 도메인이 ValidationFailed(400). */
    @Transactional
    fun update(accountId: UUID, patch: PreferencePatch): PreferenceView {
        val now = clock.instant()
        val current = repository.find(accountId) ?: PreferenceSet.empty(accountId, now)
        val updated = PreferenceSet.of(
            accountId = accountId,
            styles = patch.styles.resolve(current.styles),
            budgetTier = patch.budgetTier.resolve(current.budgetTier),
            budgetRawAmount = patch.budgetRawAmount.resolve(current.budgetRawAmount),
            companionTypes = patch.companionTypes.resolve(current.companionTypes),
            petFlag = patch.petFlag.resolve(current.petFlag) ?: false,
            activities = patch.activities.resolve(current.activities),
            transportModes = patch.transportModes.resolve(current.transportModes),
            foodTastes = patch.foodTastes.resolve(current.foodTastes),
            pace = patch.pace.resolve(current.pace),
            now = now,
        )
        return repository.save(updated).view()
    }
}
