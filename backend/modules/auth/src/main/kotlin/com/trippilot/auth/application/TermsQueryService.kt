package com.trippilot.auth.application

import com.trippilot.auth.domain.consent.TermsType
import com.trippilot.auth.domain.consent.TermsVersion
import com.trippilot.auth.domain.port.TermsVersionRepository
import com.trippilot.core.error.ResourceNotFound
import org.springframework.stereotype.Service
import java.time.Clock

/** 현행 약관 열람(온보딩 표시용, 공개). 현행 = effective_at ≤ now 중 최신(INV-T2). */
@Service
class TermsQueryService(
    private val terms: TermsVersionRepository,
    private val clock: Clock,
) {
    fun currentTerms(): List<TermsVersion> = terms.findAllCurrent(clock.instant())

    fun currentTerm(termsType: TermsType): TermsVersion =
        terms.findCurrent(termsType, clock.instant())
            ?: throw ResourceNotFound("현행 약관을 찾을 수 없습니다: $termsType")
}
