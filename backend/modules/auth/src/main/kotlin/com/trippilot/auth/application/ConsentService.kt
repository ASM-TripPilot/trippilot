package com.trippilot.auth.application

import com.trippilot.auth.domain.AccountId
import com.trippilot.auth.domain.consent.ConsentAction
import com.trippilot.auth.domain.consent.ConsentChannel
import com.trippilot.auth.domain.consent.ConsentFold
import com.trippilot.auth.domain.consent.ConsentRecord
import com.trippilot.auth.domain.consent.ConsentStatus
import com.trippilot.auth.domain.consent.MarketingConsent
import com.trippilot.auth.domain.consent.TermsType
import com.trippilot.auth.domain.consent.TermsVersion
import com.trippilot.auth.domain.port.ConsentRecordRepository
import com.trippilot.auth.domain.port.MarketingConsentRepository
import com.trippilot.auth.domain.port.TermsVersionRepository
import com.trippilot.core.error.FieldError
import com.trippilot.core.error.ResourceNotFound
import com.trippilot.core.error.ValidationFailed
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.Clock
import java.time.Instant

/** 온보딩 일괄 동의 제출 단위. */
data class ConsentSubmission(
    val termsType: TermsType,
    val termsVersion: String,
    val action: ConsentAction,
)

/**
 * 동의 증적 관리 — 폴드 조회 · 온보딩 일괄 · 개별 변경(설정·재동의) · 마케팅 토글.
 * 모든 변경은 [ConsentRecord] **추가**(append-only, INV-C1)로만 이뤄진다.
 */
@Service
class ConsentService(
    private val terms: TermsVersionRepository,
    private val records: ConsentRecordRepository,
    private val marketing: MarketingConsentRepository,
    private val clock: Clock,
) {
    /** 항목별 현재 동의 상태(증적 폴드, INV-C2). */
    @Transactional(readOnly = true)
    fun status(accountId: AccountId): List<ConsentStatus> =
        ConsentFold.statuses(records.findByAccount(accountId))

    /**
     * 온보딩 일괄 동의 — 필수 2종(이용약관·개인정보) GRANT 누락 시 거부(INV-C3).
     * 각 제출 항목은 현행 약관 버전이어야 한다.
     */
    @Transactional
    fun submitOnboarding(accountId: AccountId, submissions: List<ConsentSubmission>) {
        val now = clock.instant()
        val granted = submissions.filter { it.action == ConsentAction.GRANT }.map { it.termsType }.toSet()
        val missing = TermsType.ONBOARDING_REQUIRED - granted
        if (missing.isNotEmpty()) {
            throw ValidationFailed(listOf(FieldError("consents", "필수 약관 동의 누락: ${missing.joinToString()}")))
        }
        submissions.forEach { s ->
            requireCurrentVersion(s.termsType, s.termsVersion, now)
            records.append(ConsentRecord.of(accountId, s.termsType, s.termsVersion, s.action, ConsentChannel.ONBOARDING, now))
        }
    }

    /**
     * 개별 동의 변경(설정·재동의). 현행 약관 버전만 허용.
     * 채널은 서버가 추론: reconsent_required 인 현행 버전에 새로 GRANT 하면 RECONSENT, 그 외 SETTINGS.
     */
    @Transactional
    fun changeConsent(accountId: AccountId, termsType: TermsType, action: ConsentAction, termsVersion: String) {
        val now = clock.instant()
        val current = requireCurrentVersion(termsType, termsVersion, now)
        val channel = inferChannel(accountId, current, action)
        records.append(ConsentRecord.of(accountId, termsType, termsVersion, action, channel, now))
    }

    /** 마케팅 수신 토글 — opt_in 갱신과 증적 추가를 동일 트랜잭션으로(INV-M1). */
    @Transactional
    fun toggleMarketing(accountId: AccountId, optIn: Boolean) {
        val now = clock.instant()
        val current = terms.findCurrent(TermsType.MARKETING, now)
            ?: throw ResourceNotFound("현행 마케팅 약관을 찾을 수 없습니다.")
        val existing = marketing.find(accountId)
        marketing.save(existing?.changeTo(optIn, now) ?: MarketingConsent.of(accountId, optIn, now))
        val action = if (optIn) ConsentAction.GRANT else ConsentAction.REVOKE
        records.append(ConsentRecord.of(accountId, TermsType.MARKETING, current.version, action, ConsentChannel.SETTINGS, now))
    }

    /**
     * 재동의 필요 약관 — reconsent_required 인 현행 약관 중, 계정의 최신 동의가 그 버전 GRANT 가 아닌 것.
     * 부트스트랩(TRIP-159)이 재사용한다.
     */
    @Transactional(readOnly = true)
    fun requiredReconsents(accountId: AccountId): List<TermsType> {
        val now = clock.instant()
        val latest = ConsentFold.latestPerType(records.findByAccount(accountId))
        return terms.findAllCurrent(now)
            .filter { it.reconsentRequired }
            .filter { term ->
                val consent = latest[term.termsType]
                consent == null || !consent.isGrant || consent.termsVersion != term.version
            }
            .map { it.termsType }
    }

    private fun inferChannel(accountId: AccountId, term: TermsVersion, action: ConsentAction): ConsentChannel {
        if (action == ConsentAction.GRANT && term.reconsentRequired) {
            val consent = ConsentFold.latestPerType(records.findByAccount(accountId))[term.termsType]
            // 재동의 필요 상태(미동의·철회됨·구버전)에서의 GRANT = 재동의 — requiredReconsents 판정과 동일 조건.
            if (consent == null || !consent.isGrant || consent.termsVersion != term.version) {
                return ConsentChannel.RECONSENT
            }
        }
        return ConsentChannel.SETTINGS
    }

    /** 제출 버전이 현행과 일치하는지 검증 — 현행 없음=404, 구버전 제출=400(클라 재조회 유도). */
    private fun requireCurrentVersion(termsType: TermsType, version: String, now: Instant): TermsVersion {
        val current = terms.findCurrent(termsType, now)
            ?: throw ResourceNotFound("현행 약관을 찾을 수 없습니다: $termsType")
        if (current.version != version) {
            throw ValidationFailed(
                listOf(FieldError("termsVersion", "현행 약관 버전이 아닙니다: $version (현행 ${current.version})")),
            )
        }
        return current
    }
}
