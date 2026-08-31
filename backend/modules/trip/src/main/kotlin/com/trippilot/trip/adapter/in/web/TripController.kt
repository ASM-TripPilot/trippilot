package com.trippilot.trip.adapter.`in`.web

import com.trippilot.trip.application.TripCountsService
import com.trippilot.trip.application.TripService
import com.trippilot.trip.domain.TripCounts
import jakarta.validation.Valid
import org.springframework.http.HttpStatus
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PatchMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.ResponseStatus
import org.springframework.web.bind.annotation.RestController
import java.security.Principal
import java.time.Clock
import java.time.LocalDate
import java.time.ZoneId
import java.util.UUID

/** 여행 — 소유 계정 스코프(타 계정·삭제됨 404). */
@RestController
@RequestMapping("/api/v1/trips")
class TripController(
    private val clock: Clock,
    private val service: TripService,
    private val countsService: TripCountsService,
) {
    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    fun create(principal: Principal, @Valid @RequestBody request: CreateTripRequest): TripResponse =
        TripResponse.from(service.create(principal.accountId(), request.toCommand()), today())

    @GetMapping
    fun list(principal: Principal): List<TripResponse> {
        val accountId = principal.accountId()
        val trips = service.list(accountId)
        // 여행마다 따로 묻지 않는다 — 화면이 걷어내려던 N+1 이 서버 안으로 옮겨 올 뿐이다(BR-U6-22).
        val counts = countsService.of(accountId, trips)
        val d = today()
        return trips.map { TripResponse.from(it, d, counts[it.tripId] ?: TripCounts.NONE) }
    }

    @GetMapping("/{tripId}")
    fun get(principal: Principal, @PathVariable tripId: UUID): TripResponse {
        val accountId = principal.accountId()
        val trip = service.get(accountId, tripId)
        return TripResponse.from(trip, today(), countsService.of(accountId, listOf(trip))[tripId] ?: TripCounts.NONE)
    }

    @PatchMapping("/{tripId}")
    fun edit(principal: Principal, @PathVariable tripId: UUID, @Valid @RequestBody request: EditTripRequest): TripResponse =
        TripResponse.from(service.edit(principal.accountId(), tripId, request.toCommand()), today())

    @DeleteMapping("/{tripId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    fun delete(principal: Principal, @PathVariable tripId: UUID) =
        service.delete(principal.accountId(), tripId)
    /** 여행 "오늘"은 사용자가 있는 곳의 날짜다(서버 UTC 아님) — 재계획·감지·재생성 가드와 같은 기준. */
    private fun today(): LocalDate = LocalDate.ofInstant(clock.instant(), TRAVEL_ZONE)

    private companion object {
        private val TRAVEL_ZONE: ZoneId = ZoneId.of("Asia/Seoul")
    }
}
