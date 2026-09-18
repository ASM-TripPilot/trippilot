package com.trippilot.trip.adapter.`in`.web

import com.trippilot.trip.application.AddMustVisitCommand
import com.trippilot.trip.application.MustVisitService
import com.trippilot.trip.domain.MustVisit
import com.trippilot.trip.domain.MustVisitType
import jakarta.validation.Valid
import jakarta.validation.constraints.NotNull
import org.springframework.http.HttpStatus
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.ResponseStatus
import org.springframework.web.bind.annotation.RestController
import java.security.Principal
import java.time.LocalDate
import java.time.LocalTime
import java.util.UUID

/** 필수 방문지 — 여행 하위 리소스. 여행 소유 스코프(타 계정 404). POI는 동결 스냅숏으로 참조. */
@RestController
@RequestMapping("/api/v1/trips/{tripId}")
class MustVisitController(
    private val service: MustVisitService,
) {
    @PostMapping("/must-visits")
    @ResponseStatus(HttpStatus.CREATED)
    fun add(
        principal: Principal,
        @PathVariable tripId: UUID,
        @Valid @RequestBody request: AddMustVisitRequest,
    ): MustVisitResponse =
        MustVisitResponse.from(service.add(principal.accountId(), tripId, request.toCommand()))

    @GetMapping("/must-visits")
    fun list(principal: Principal, @PathVariable tripId: UUID): List<MustVisitResponse> =
        service.list(principal.accountId(), tripId).map { MustVisitResponse.from(it) }

    @DeleteMapping("/must-visits/{mustVisitId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    fun remove(principal: Principal, @PathVariable tripId: UUID, @PathVariable mustVisitId: UUID) =
        service.remove(principal.accountId(), tripId, mustVisitId)
}

/** 필수 방문지 추가 요청. FIXED면 fixedDate·fixedStart 필수(도메인 검증). */
data class AddMustVisitRequest(
    @field:NotNull val poiId: UUID?,
    @field:NotNull val type: MustVisitType?,
    val fixedDate: LocalDate? = null,
    val fixedStart: LocalTime? = null,
    val dwellMin: Int? = null,
) {
    fun toCommand() = AddMustVisitCommand(poiId!!, type!!, fixedDate, fixedStart, dwellMin)
}

data class MustVisitResponse(
    val mustVisitId: UUID,
    val poiSnapshotId: UUID,
    val sourcePoiId: UUID,
    val type: MustVisitType,
    val fixedDate: LocalDate?,
    val fixedStart: LocalTime?,
    val dwellMin: Int?,
) {
    companion object {
        fun from(m: MustVisit) = MustVisitResponse(
            m.mustVisitId, m.poiSnapshotId, m.sourcePoiId, m.type, m.fixedDate, m.fixedStart, m.dwellMin,
        )
    }
}
