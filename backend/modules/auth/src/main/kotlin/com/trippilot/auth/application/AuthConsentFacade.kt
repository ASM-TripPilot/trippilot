package com.trippilot.auth.application

import com.trippilot.auth.api.ConsentFacade
import com.trippilot.auth.domain.AccountId
import com.trippilot.auth.domain.consent.TermsType
import org.springframework.stereotype.Service
import java.util.UUID

/**
 * [ConsentFacade] 구현 — ConsentService 를 감싸 api-safe 타입으로 노출.
 * 내부 도메인(TermsType)은 name 문자열로 변환해 경계 밖으로 도메인 타입 유출을 막는다.
 */
@Service
class AuthConsentFacade(
    private val consentService: ConsentService,
) : ConsentFacade {
    override fun requiredReconsentTermsTypes(accountId: UUID): List<String> =
        consentService.requiredReconsents(AccountId(accountId)).map { it.name }

    override fun hasCompletedOnboardingConsents(accountId: UUID): Boolean {
        val id = AccountId(accountId)
        val granted = consentService.status(id).filter { it.granted }.map { it.termsType }.toSet()
        // 재동의 대기(현행 버전 미동의)는 제외 — 부트스트랩 reconsent 게이트와 정합(구버전 GRANT 로 통과 방지).
        val pendingReconsent = consentService.requiredReconsents(id).toSet()
        return TermsType.ONBOARDING_REQUIRED.all { it in granted && it !in pendingReconsent }
    }
}
