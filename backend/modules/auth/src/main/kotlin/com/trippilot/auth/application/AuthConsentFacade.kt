package com.trippilot.auth.application

import com.trippilot.auth.api.ConsentFacade
import com.trippilot.auth.api.PersonalizationConsentFacade
import com.trippilot.auth.domain.AccountId
import com.trippilot.auth.domain.consent.TermsType
import org.springframework.stereotype.Service
import java.util.UUID

/**
 * [ConsentFacade]·[PersonalizationConsentFacade] 구현 — ConsentService 를 감싸 api-safe 타입으로 노출.
 * 내부 도메인(TermsType)은 name 문자열로 변환해 경계 밖으로 도메인 타입 유출을 막는다.
 *
 * 두 인터페이스를 한 빈이 구현하는 이유는 **묻는 곳이 다르기 때문**이다 — 온보딩과 개인화는
 * 서로의 계약을 물 이유가 없다. 같은 서비스를 감싸므로 구현은 한 곳이면 된다.
 */
@Service
class AuthConsentFacade(
    private val consentService: ConsentService,
) : ConsentFacade, PersonalizationConsentFacade {
    override fun requiredReconsentTermsTypes(accountId: UUID): List<String> =
        consentService.requiredReconsents(AccountId(accountId)).map { it.name }

    override fun hasCompletedOnboardingConsents(accountId: UUID): Boolean {
        val id = AccountId(accountId)
        val granted = consentService.status(id).filter { it.granted }.map { it.termsType }.toSet()
        // 재동의 대기(현행 버전 미동의)는 제외 — 부트스트랩 reconsent 게이트와 정합(구버전 GRANT 로 통과 방지).
        val pendingReconsent = consentService.requiredReconsents(id).toSet()
        return TermsType.ONBOARDING_REQUIRED.all { it in granted && it !in pendingReconsent }
    }

    override fun isPersonalizationGranted(accountId: UUID): Boolean =
        consentService.isGranted(AccountId(accountId), TermsType.PERSONALIZATION)
}
