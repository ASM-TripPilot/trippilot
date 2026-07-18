package com.trippilot.auth.adapter.out.external

import com.trippilot.auth.domain.Provider
import com.trippilot.auth.domain.SocialProfile
import com.trippilot.auth.domain.port.SocialAuthPort
import com.trippilot.core.error.AuthenticationRequired
import com.trippilot.core.error.DomainException
import com.trippilot.core.error.ErrorCode
import org.springframework.stereotype.Component

/**
 * SocialAuthPort 구현 — provider 로 제공자별 [OAuthProviderClient] 에 디스패치.
 * 미지원 제공자·교환 실패는 SOCIAL_AUTH_FAILED(401)로 일반화(원인 비노출).
 */
@Component
class SocialAuthAdapter(
    clients: List<OAuthProviderClient>,
) : SocialAuthPort {

    private val byProvider: Map<Provider, OAuthProviderClient> = clients.associateBy { it.provider }

    override fun exchange(
        provider: Provider,
        authorizationCode: String,
        codeVerifier: String,
        redirectUri: String,
    ): SocialProfile {
        val client = byProvider[provider]
            ?: throw AuthenticationRequired("지원하지 않는 소셜 제공자", ErrorCode.SOCIAL_AUTH_FAILED)
        return try {
            client.fetchProfile(authorizationCode, codeVerifier, redirectUri)
        } catch (e: DomainException) {
            throw e
        } catch (e: Exception) {
            throw AuthenticationRequired("소셜 인증에 실패했습니다.", ErrorCode.SOCIAL_AUTH_FAILED)
        }
    }
}
