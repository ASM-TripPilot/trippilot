package com.trippilot.trip.adapter.`in`.web

import com.trippilot.trip.application.TripService
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
) {
    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    fun create(principal: Principal, @Valid @RequestBody request: CreateTripRequest): TripResponse =
        TripResponse.from(service.create(principal.accountId(), request.toCommand()), today())

    @GetMapping
    fun list(principal: Principal): List<TripResponse> =
        service.list(principal.accountId()).let { trips -> val d = today(); trips.map { TripResponse.from(it, d) } }

    @GetMapping("/{tripId}")
    fun get(principal: Principal, @PathVariable tripId: UUID): TripResponse =
        TripResponse.from(service.get(principal.accountId(), tripId), today())

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
