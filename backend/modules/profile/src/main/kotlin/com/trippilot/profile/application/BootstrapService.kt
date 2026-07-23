package com.trippilot.profile.application

import com.trippilot.auth.api.ConsentFacade
import com.trippilot.profile.domain.AppUpdateStatus
import com.trippilot.profile.domain.AppVersion
import com.trippilot.profile.domain.ProfileRepository
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.util.UUID

/** 부트스트랩 집계 결과 — appUpdate·reconsent·session. */
data class BootstrapResult(
    val appUpdateStatus: AppUpdateStatus,
    val minSupportedVersion: String,
    val reconsentTermsTypes: List<String>,
    val authenticated: Boolean,
    val onboardingCompleted: Boolean,
)

/**
 * 앱 기동 분기 집계(FD-U1-10). 우선순위(강제업데이트>재동의>세션)는 클라이언트가 판단하도록 3블록을 모두 제공.
 * reconsent 는 auth.api 퍼사드(R1), onboarding 은 profile 자체 데이터. 비인증(GUEST)은 재동의·온보딩 없음.
 */
@Service
class BootstrapService(
    private val consentFacade: ConsentFacade,
    private val profiles: ProfileRepository,
    private val properties: BootstrapProperties,
) {
    @Transactional(readOnly = true)
    fun bootstrap(accountId: UUID?, clientVersion: String?): BootstrapResult {
        val appUpdateStatus = AppVersion.status(clientVersion, properties.minSupportedVersion, properties.recommendedVersion)
        val reconsent = accountId?.let { consentFacade.requiredReconsentTermsTypes(it) } ?: emptyList()
        val onboardingCompleted = accountId?.let { profiles.find(it)?.onboardingCompleted } ?: false
        return BootstrapResult(
            appUpdateStatus = appUpdateStatus,
            minSupportedVersion = properties.minSupportedVersion,
            reconsentTermsTypes = reconsent,
            authenticated = accountId != null,
            onboardingCompleted = onboardingCompleted,
        )
    }
}
