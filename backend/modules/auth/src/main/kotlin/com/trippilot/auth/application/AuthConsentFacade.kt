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
        val granted = consentService.status(AccountId(accountId)).filter { it.granted }.map { it.termsType }.toSet()
        return TermsType.ONBOARDING_REQUIRED.all { it in granted }
    }
}
