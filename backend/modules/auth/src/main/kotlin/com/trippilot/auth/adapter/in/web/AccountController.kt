package com.trippilot.auth.adapter.`in`.web

import com.trippilot.auth.application.AccountDeletionService
import com.trippilot.auth.application.AccountSummary
import com.trippilot.auth.application.AccountSummaryService
import com.trippilot.auth.application.DeletionRequestResult
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import java.security.Principal
import java.time.Instant
import java.util.UUID

/**
 * 계정 요약 + 삭제 라이프사이클(Bearer). GET /me, POST/DELETE /me/deletion.
 * 삭제 요청은 즉시 세션 폐기·GPS 파기 + 30일 유예 예약, 철회는 유예 내 복원(GPS 미복원).
 */
@RestController
@RequestMapping("/api/v1/me")
class AccountController(
    private val summaryService: AccountSummaryService,
    private val deletionService: AccountDeletionService,
) {
    /** 계정 요약(상태·이메일·소셜 제공자). */
    @GetMapping
    fun me(principal: Principal): AccountSummaryResponse =
        AccountSummaryResponse.from(summaryService.summary(principal.accountId()))

    /** 삭제 요청 → DELETION_PENDING + 유예 예약. 응답: 파기 예정 시각 + 연쇄 범위 고지. */
    @PostMapping("/deletion")
    fun requestDeletion(principal: Principal): DeletionResponse =
        DeletionResponse.from(deletionService.requestDeletion(principal.accountId()))

    /** 유예 내 철회 → ACTIVE 복원. 활성 예약이 없으면 404. */
    @DeleteMapping("/deletion")
    fun cancelDeletion(principal: Principal) {
        deletionService.cancelDeletion(principal.accountId())
    }
}

/** GET /me 응답. */
data class AccountSummaryResponse(
    val accountId: UUID,
    val status: String,
    val email: String?,
    val socialProviders: List<String>,
) {
    companion object {
        fun from(s: AccountSummary) =
            AccountSummaryResponse(s.accountId, s.status.name, s.email, s.socialProviders.map { it.name })
    }
}

/** POST /me/deletion 응답. */
data class DeletionResponse(
    val purgeAt: Instant,
    val cascadeSummary: CascadeSummaryDto,
) {
    data class CascadeSummaryDto(val purgeScheduled: List<String>, val legallyRetained: List<String>)

    companion object {
        fun from(r: DeletionRequestResult) = DeletionResponse(
            purgeAt = r.purgeAt,
            cascadeSummary = CascadeSummaryDto(r.cascadeSummary.purgeScheduled, r.cascadeSummary.legallyRetained),
        )
    }
}
