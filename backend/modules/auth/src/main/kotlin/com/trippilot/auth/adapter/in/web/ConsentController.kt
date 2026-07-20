package com.trippilot.auth.adapter.`in`.web

import com.trippilot.auth.application.ConsentService
import jakarta.validation.Valid
import org.springframework.http.HttpStatus
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PatchMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.PutMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.ResponseStatus
import org.springframework.web.bind.annotation.RestController
import java.security.Principal

/**
 * 로그인 사용자 동의 관리(Bearer 필요). 모든 변경은 증적 추가(append-only, INV-C1)로만.
 * 인증 주체는 [Principal](=JWT sub=accountId)로 받는다 — [accountId] 헬퍼로 변환.
 */
@RestController
@RequestMapping("/api/v1/me")
class ConsentController(
    private val consent: ConsentService,
) {
    /** 항목별 현재 동의 상태(폴드, INV-C2). */
    @GetMapping("/consents")
    fun status(principal: Principal): List<ConsentStatusResponse> =
        consent.status(principal.accountId()).map(ConsentStatusResponse::from)

    /** 온보딩 일괄 동의(필수 2종 GRANT 필요, INV-C3). */
    @PostMapping("/consents")
    @ResponseStatus(HttpStatus.OK)
    fun submit(principal: Principal, @Valid @RequestBody request: ConsentSubmissionRequest) {
        consent.submitOnboarding(principal.accountId(), request.toSubmissions())
    }

    /** 개별 GRANT/REVOKE(설정·재동의) — 채널은 서버 추론. */
    @PatchMapping("/consents/{termsType}")
    @ResponseStatus(HttpStatus.OK)
    fun change(
        principal: Principal,
        @PathVariable termsType: String,
        @Valid @RequestBody request: ConsentChangeRequest,
    ) {
        consent.changeConsent(principal.accountId(), parseTermsType(termsType), request.action!!, request.termsVersion!!)
    }

    /** 마케팅 수신 토글(INV-M1 원자성). */
    @PutMapping("/marketing-consent")
    @ResponseStatus(HttpStatus.OK)
    fun marketing(principal: Principal, @Valid @RequestBody request: MarketingConsentRequest) {
        consent.toggleMarketing(principal.accountId(), request.optIn!!)
    }
}
