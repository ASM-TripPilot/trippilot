package com.trippilot.archive.adapter.`in`.web

import com.trippilot.archive.application.TripRecordList
import com.trippilot.archive.application.TripRecordListService
import com.trippilot.core.error.AuthenticationRequired
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController
import java.security.Principal
import java.util.UUID

/** 지난 여행 기록 목록(`j07`). 계정 하위 리소스 — 타 계정 여행은 나오지 않는다. */
@RestController
@RequestMapping("/api/v1/me/records")
class TripRecordListController(private val service: TripRecordListService) {

    @GetMapping
    fun list(
        principal: Principal,
        @RequestParam(required = false, defaultValue = "${TripRecordListService.DEFAULT_LIMIT}") limit: Int,
    ): TripRecordList = service.list(principal.accountId(), limit)
}

/** 토큰 sub → 계정 id. UUID 가 아니면 인증 실패로 다룬다(형식 오류를 500 으로 흘리지 않는다). */
private fun Principal.accountId(): UUID =
    runCatching { UUID.fromString(name) }.getOrElse { throw AuthenticationRequired() }
