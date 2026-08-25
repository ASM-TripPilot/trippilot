package com.trippilot.app.export

import com.trippilot.core.error.AuthenticationRequired
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController
import java.security.Principal
import java.util.UUID

/**
 * 내 데이터 내려받기(`l05`). **내보내기만**이다 — 계정 삭제는 U0 유예 삭제가 이미 있다.
 *
 * 이 표면의 유일한 안전 요건은 **다른 계정 데이터가 한 건도 섞이지 않는 것**이다.
 * 각 몫이 `accountId` 로만 읽고, 여기서는 토큰의 주체를 그대로 넘긴다.
 */
@RestController
@RequestMapping("/api/v1/me/export")
class AccountExportController(private val service: AccountExportService) {

    @GetMapping
    fun export(
        principal: Principal,
        @RequestParam(required = false, defaultValue = "${AccountExportService.DEFAULT_SECTION_LIMIT}") sectionLimit: Int,
    ): AccountExport = service.export(principal.accountId(), sectionLimit)
}

/** 토큰 sub → 계정 id. UUID 가 아니면 인증 실패로 다룬다(형식 오류를 500 으로 흘리지 않는다). */
private fun Principal.accountId(): UUID =
    runCatching { UUID.fromString(name) }.getOrElse { throw AuthenticationRequired() }
