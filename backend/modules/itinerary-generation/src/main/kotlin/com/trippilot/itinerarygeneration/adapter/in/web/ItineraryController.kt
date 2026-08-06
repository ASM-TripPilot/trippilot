package com.trippilot.itinerarygeneration.adapter.`in`.web

import com.trippilot.itinerarygeneration.application.GenerateItineraryService
import com.trippilot.itinerarygeneration.application.ItineraryQueryService
import com.trippilot.itinerarygeneration.domain.GenerationMode
import com.trippilot.itinerarygeneration.domain.Itinerary
import org.springframework.http.HttpStatus
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

/** 일정 생성 — 여행 하위 리소스. 소유 스코프(타 계정 404). POST = 생성 · GET = 조회. */
@RestController
@RequestMapping("/api/v1/trips/{tripId}/itinerary")
class ItineraryController(
    private val service: GenerateItineraryService,
    private val queryService: ItineraryQueryService,
) {
    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    fun generate(
        principal: Principal,
        @PathVariable tripId: UUID,
        @RequestBody(required = false) request: GenerateItineraryRequest?,
    ): ItineraryResponse {
        val mode = request?.generationMode ?: GenerationMode.FULLY_AI
        return ItineraryResponse.from(service.generate(principal.accountId(), tripId, mode))
    }

    @GetMapping
    fun get(principal: Principal, @PathVariable tripId: UUID): ItineraryResponse =
        ItineraryResponse.from(queryService.get(principal.accountId(), tripId))
}

/** 생성 요청 — 방식(미지정 시 FULLY_AI). */
data class GenerateItineraryRequest(val generationMode: GenerationMode?)

data class ItineraryResponse(
    val itineraryId: UUID,
    val tripId: UUID,
    val status: String,
    val solveMode: String,
    val isFallback: Boolean,
    val days: List<DayResponse>,
) {
    companion object {
        fun from(i: Itinerary) = ItineraryResponse(
            itineraryId = i.itineraryId,
            tripId = i.tripId,
            status = i.status.name,
            solveMode = i.solveMode.name,
            isFallback = i.isFallback,
            days = i.days.map { d ->
                DayResponse(d.date, d.slots.map { s -> SlotResponse(s.sourcePoiId, s.startAt, s.endAt, s.isFixed) })
            },
        )
    }
}

data class DayResponse(val date: LocalDate, val slots: List<SlotResponse>)

/** 방문 슬롯 표시 — 시각·순서만(INV-2). 소요시간 필드 없음(INV-3, 거리는 후속 표시). */
data class SlotResponse(val poiId: UUID, val startAt: LocalTime, val endAt: LocalTime, val isFixed: Boolean)
