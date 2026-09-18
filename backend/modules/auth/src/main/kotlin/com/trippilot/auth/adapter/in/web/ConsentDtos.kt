package com.trippilot.auth.adapter.`in`.web

import com.trippilot.auth.application.ConsentSubmission
import com.trippilot.auth.domain.consent.ConsentAction
import com.trippilot.auth.domain.consent.ConsentStatus
import com.trippilot.auth.domain.consent.TermsType
import com.trippilot.auth.domain.consent.TermsVersion
import jakarta.validation.Valid
import jakarta.validation.constraints.NotBlank
import jakarta.validation.constraints.NotEmpty
import jakarta.validation.constraints.NotNull
import java.time.Instant

/** GET /terms 응답 항목. */
data class TermsResponse(
    val termsType: TermsType,
    val version: String,
    val body: String,
    val effectiveAt: Instant,
    val reconsentRequired: Boolean,
) {
    companion object {
        fun from(t: TermsVersion) = TermsResponse(t.termsType, t.version, t.body, t.effectiveAt, t.reconsentRequired)
    }
}

/** GET /me/consents 응답 항목(폴드된 현재 상태). */
data class ConsentStatusResponse(
    val termsType: TermsType,
    val granted: Boolean,
    val termsVersion: String,
) {
    companion object {
        fun from(s: ConsentStatus) = ConsentStatusResponse(s.termsType, s.granted, s.termsVersion)
    }
}

/** POST /me/consents — 온보딩 일괄 제출. */
data class ConsentSubmissionRequest(
    @field:NotEmpty(message = "동의 항목이 필요합니다")
    @field:Valid
    val consents: List<Item>,
) {
    data class Item(
        @field:NotNull(message = "termsType 이 필요합니다") val termsType: TermsType?,
        @field:NotBlank(message = "termsVersion 이 필요합니다") val termsVersion: String?,
        @field:NotNull(message = "action 이 필요합니다") val action: ConsentAction?,
    )

    fun toSubmissions(): List<ConsentSubmission> =
        consents.map { ConsentSubmission(it.termsType!!, it.termsVersion!!, it.action!!) }
}

/** PATCH /me/consents/{termsType} — 개별 GRANT/REVOKE. */
data class ConsentChangeRequest(
    @field:NotNull(message = "action 이 필요합니다") val action: ConsentAction?,
    @field:NotBlank(message = "termsVersion 이 필요합니다") val termsVersion: String?,
)

/** PUT /me/marketing-consent — 수신 토글. */
data class MarketingConsentRequest(
    @field:NotNull(message = "optIn 이 필요합니다") val optIn: Boolean?,
)
