package com.trippilot.archive.adapter.`in`.web

import com.trippilot.archive.application.ActualRouteService
import com.trippilot.archive.application.RouteDayUpload
import com.trippilot.archive.domain.ActualRouteDay
import com.trippilot.core.error.AuthenticationRequired
import com.trippilot.core.error.FieldError
import com.trippilot.core.error.ValidationFailed
import jakarta.validation.Valid
import jakarta.validation.constraints.NotNull
import jakarta.validation.constraints.PositiveOrZero
import org.springframework.format.annotation.DateTimeFormat
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PutMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import java.security.Principal
import java.time.Instant
import java.time.LocalDate
import java.util.UUID

/** 실제 경로(U10 FD §12.3). 원시 좌표는 받지 않는다 — 기기가 다운샘플한 인코딩 폴리라인뿐이다. */
@RestController
@RequestMapping("/api/v1/trips/{tripId}/routes")
class ActualRouteController(private val service: ActualRouteService) {

    @PutMapping("/{date}")
    fun store(
        principal: Principal,
        @PathVariable tripId: UUID,
        @PathVariable @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) date: LocalDate,
        @Valid @RequestBody request: RouteDayUploadRequest,
    ): RouteDayResponse = RouteDayResponse.from(
        service.store(
            principal.accountId(), tripId, date,
            RouteDayUpload(request.segments!!.map { it ?: throw nullSegment() }, request.distanceM!!, request.rawPointCount!!, request.storedPointCount, request.recordedFrom, request.recordedTo),
        ),
    )

    @GetMapping
    fun list(principal: Principal, @PathVariable tripId: UUID): RouteDayList =
        RouteDayList(service.list(principal.accountId(), tripId).map(RouteDayResponse::from))

    private fun nullSegment() = ValidationFailed(listOf(FieldError("segments", "세그먼트에 빈 값이 있습니다.")))

    private fun Principal.accountId(): UUID =
        runCatching { UUID.fromString(name) }.getOrElse { throw AuthenticationRequired() }
}

data class RouteDayUploadRequest(
    /** 원소 null 은 바인딩이 막지 않는다 — 서비스에 넘기기 전에 400 으로 거른다(안 거르면 길이를 셀 때 NPE 로 500). */
    @field:NotNull(message = "세그먼트는 필수입니다.") val segments: List<String?>?,
    @field:NotNull @field:PositiveOrZero val distanceM: Int?,
    @field:NotNull @field:PositiveOrZero val rawPointCount: Int?,
    @field:PositiveOrZero val storedPointCount: Int? = null,
    val recordedFrom: Instant? = null,
    val recordedTo: Instant? = null,
)

/**
 * **소요시간·속도·기록 구간을 싣지 않는다**(INV-3 · INV-U10-7 · PBT-U10-7) — 기록 구간은 서버가 거리 상한을 재는 데만 쓴다.
 */
data class RouteDayResponse(
    val date: LocalDate,
    val segments: List<String>,
    val distanceM: Int,
    val distanceClamped: Boolean,
    val updatedAt: Instant,
) {
    companion object {
        fun from(d: ActualRouteDay) = RouteDayResponse(d.localDate, d.segments, d.distanceM, d.distanceClamped, d.updatedAt)
    }
}

data class RouteDayList(val routes: List<RouteDayResponse>)
