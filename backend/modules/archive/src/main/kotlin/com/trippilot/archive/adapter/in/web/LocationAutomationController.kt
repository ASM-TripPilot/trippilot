package com.trippilot.archive.adapter.`in`.web

import com.trippilot.archive.application.IntervalReport
import com.trippilot.archive.application.LocationAutomationService
import com.trippilot.archive.domain.IntervalEndReason
import com.trippilot.archive.domain.IntervalKind
import com.trippilot.auth.api.LocationIntervalPhase
import com.trippilot.core.error.AuthenticationRequired
import jakarta.validation.Valid
import jakarta.validation.constraints.NotNull
import jakarta.validation.constraints.PositiveOrZero
import org.springframework.http.HttpStatus
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.ResponseStatus
import org.springframework.web.bind.annotation.RestController
import java.security.Principal
import java.time.Instant
import java.util.UUID

/** 자동화 구간 보고(U10 FD §12.4). 기기가 지오펜스 무장·경로 기록의 시작과 끝을 알린다. 좌표는 받지 않는다. */
@RestController
@RequestMapping("/api/v1/trips/{tripId}/location-automation/intervals")
class LocationAutomationController(private val service: LocationAutomationService) {

    @PostMapping
    @ResponseStatus(HttpStatus.NO_CONTENT)
    fun report(principal: Principal, @PathVariable tripId: UUID, @Valid @RequestBody request: IntervalReportRequest) {
        val accountId = runCatching { UUID.fromString(principal.name) }.getOrElse { throw AuthenticationRequired() }
        service.report(
            accountId, tripId,
            IntervalReport(request.intervalId!!, request.kind!!, request.phase!!, request.at!!, request.endReason, request.pointCount, request.regionCount),
        )
    }
}

data class IntervalReportRequest(
    @field:NotNull(message = "구간 id 는 필수입니다.") val intervalId: UUID?,
    @field:NotNull(message = "구간 종류는 필수입니다.") val kind: IntervalKind?,
    @field:NotNull(message = "단계는 필수입니다.") val phase: LocationIntervalPhase?,
    @field:NotNull(message = "시각은 필수입니다.") val at: Instant?,
    val endReason: IntervalEndReason? = null,
    @field:PositiveOrZero val pointCount: Int? = null,
    @field:PositiveOrZero val regionCount: Int? = null,
)
