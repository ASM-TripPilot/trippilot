package com.trippilot.profile.adapter.`in`.web

import com.trippilot.profile.application.BootstrapResult
import com.trippilot.profile.application.BootstrapService
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RequestHeader
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import java.security.Principal

/**
 * 앱 기동 분기(공개 — 인증 선택). 강제업데이트·재동의·세션 3블록을 제공하고 우선순위는 클라이언트가 판단.
 * 인증 없으면 GUEST(재동의·온보딩 없음). 앱 버전은 X-App-Version 헤더로 받는다.
 */
@RestController
@RequestMapping("/api/v1/bootstrap")
class BootstrapController(
    private val bootstrap: BootstrapService,
) {
    @GetMapping
    fun get(
        principal: Principal?,
        @RequestHeader(name = "X-App-Version", required = false) appVersion: String?,
    ): BootstrapResponse = BootstrapResponse.from(bootstrap.bootstrap(principal.accountIdOrNull(), appVersion))
}

/** GET /bootstrap 응답. */
data class BootstrapResponse(
    val appUpdate: AppUpdate,
    val reconsent: Reconsent,
    val session: Session,
) {
    data class AppUpdate(val status: String, val minSupportedVersion: String)
    data class Reconsent(val required: Boolean, val termsTypes: List<String>)
    data class Session(val state: String, val onboardingCompleted: Boolean)

    companion object {
        fun from(r: BootstrapResult) = BootstrapResponse(
            appUpdate = AppUpdate(r.appUpdateStatus.name, r.minSupportedVersion),
            reconsent = Reconsent(r.reconsentTermsTypes.isNotEmpty(), r.reconsentTermsTypes),
            session = Session(if (r.authenticated) "AUTHENTICATED" else "GUEST", r.onboardingCompleted),
        )
    }
}
