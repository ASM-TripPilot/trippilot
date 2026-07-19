package com.trippilot.auth.adapter.`in`.web

import com.trippilot.auth.application.TermsQueryService
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController

/** 현행 약관 열람(공개 — 온보딩 표시용). INV-T2. */
@RestController
@RequestMapping("/api/v1/terms")
class TermsController(
    private val termsQuery: TermsQueryService,
) {
    @GetMapping
    fun list(): List<TermsResponse> = termsQuery.currentTerms().map(TermsResponse::from)

    @GetMapping("/{termsType}")
    fun get(@PathVariable termsType: String): TermsResponse =
        TermsResponse.from(termsQuery.currentTerm(parseTermsType(termsType)))
}
