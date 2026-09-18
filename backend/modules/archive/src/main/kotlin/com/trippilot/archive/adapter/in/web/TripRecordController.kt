package com.trippilot.archive.adapter.`in`.web

import com.trippilot.archive.application.TripRecord
import com.trippilot.archive.application.TripRecordService
import com.trippilot.core.error.AuthenticationRequired
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController
import java.security.Principal
import java.util.UUID

/**
 * 계획｜실제｜변경 3종 비교(`j02`). 여행 하위 리소스. 소유 스코프(타 계정 404).
 *
 * 세 탭이 **리스트 필터인지 지도 레이어 토글인지는 아직 미결**이다(O-U5-3). 어느 쪽이든 필요한 자료는
 * 같아서 — 날짜별로 묶인 계획·실제·미방문 + 여행 단위 변경 이력 — 한 벌로 낸다. 결정이 나면 화면이
 * 이 자료를 어떻게 그리는지만 갈린다.
 */
@RestController
@RequestMapping("/api/v1/trips/{tripId}/records")
class TripRecordController(private val service: TripRecordService) {

    @GetMapping
    fun compare(
        principal: Principal,
        @PathVariable tripId: UUID,
        @RequestParam(required = false, defaultValue = "${TripRecordService.DEFAULT_CHANGE_LIMIT}") changeLimit: Int,
    ): TripRecord = service.compare(principal.accountId(), tripId, changeLimit)
}

/** 토큰 sub → 계정 id. UUID 가 아니면 인증 실패로 다룬다(형식 오류를 500 으로 흘리지 않는다). */
private fun Principal.accountId(): UUID =
    runCatching { UUID.fromString(name) }.getOrElse { throw AuthenticationRequired() }
