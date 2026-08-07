package com.trippilot.itinerarygeneration.adapter.`in`.web

import com.trippilot.itinerarygeneration.application.ConfirmItineraryService
import com.trippilot.itinerarygeneration.application.EditDay
import com.trippilot.itinerarygeneration.application.EditItinerary
import com.trippilot.itinerarygeneration.application.EditItineraryService
import com.trippilot.itinerarygeneration.application.EditSlot
import com.trippilot.itinerarygeneration.application.GenerateItineraryService
import com.trippilot.itinerarygeneration.application.ItineraryQueryService
import com.trippilot.itinerarygeneration.domain.GenerationMode
import com.trippilot.itinerarygeneration.domain.Itinerary
import org.springframework.http.HttpStatus
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.PutMapping
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
    private val confirmService: ConfirmItineraryService,
    private val editService: EditItineraryService,
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

    /** 확정 — PLANNED→CONFIRMED(이미 확정이면 409). 재생성은 확정을 되돌린다(확정 해제 API 부재). */
    @PostMapping("/confirm")
    fun confirm(principal: Principal, @PathVariable tripId: UUID): ItineraryResponse =
        ItineraryResponse.from(confirmService.confirm(principal.accountId(), tripId))

    /** 편집(전체 교체) + 재검증 — 비차단(위반은 hasViolation 표시, 저장 허용). 확정된 일정은 409. */
    @PutMapping
    fun edit(principal: Principal, @PathVariable tripId: UUID, @RequestBody request: EditItineraryRequest): ItineraryResponse =
        ItineraryResponse.from(editService.edit(principal.accountId(), tripId, request.toCommand()))
}

/** 편집 요청 — 수정된 전체 일자·슬롯 배열(슬롯 순서 = 배열 순서). */
data class EditItineraryRequest(val days: List<EditDayRequest>) {
    fun toCommand() = EditItinerary(
        days.map { d -> EditDay(d.date, d.slots.map { EditSlot(it.poiId, it.startAt, it.endAt, it.isFixed, it.endsNextDay) }) },
    )
}
data class EditDayRequest(val date: LocalDate, val slots: List<EditSlotRequest>)
/** [endsNextDay]: 자정 넘김(HC4). 전체 교체라 조회 응답의 현행 값을 그대로 실어야 플래그가 소실되지 않는다. */
data class EditSlotRequest(
    val poiId: UUID,
    val startAt: LocalTime,
    val endAt: LocalTime,
    val isFixed: Boolean,
    val endsNextDay: Boolean = false,
)

/** 생성 요청 — 방식(미지정 시 FULLY_AI). */
data class GenerateItineraryRequest(val generationMode: GenerationMode?)

data class ItineraryResponse(
    val itineraryId: UUID,
    val tripId: UUID,
    val status: String,
    val solveMode: String,
    val isFallback: Boolean,
    val generationState: String,
    val days: List<DayResponse>,
) {
    companion object {
        fun from(i: Itinerary) = ItineraryResponse(
            itineraryId = i.itineraryId,
            tripId = i.tripId,
            status = i.status.name,
            solveMode = i.solveMode.name,
            isFallback = i.isFallback,
            generationState = i.generationState.name,
            days = i.days.map { d ->
                DayResponse(d.date, d.slots.map { s -> SlotResponse(s.sourcePoiId, s.startAt, s.endAt, s.isFixed, s.endsNextDay, s.hasViolation) })
            },
        )
    }
}

data class DayResponse(val date: LocalDate, val slots: List<SlotResponse>)

/**
 * 방문 슬롯 표시 — 시각·순서만(INV-2, 소요시간 없음 INV-3).
 * [endsNextDay]: 자정 넘김(HC4, endAt=익일 시각·시작일 귀속). [hasViolation]: 편집 재검증(HC1-4) 위반 표시(비차단).
 */
data class SlotResponse(
    val poiId: UUID,
    val startAt: LocalTime,
    val endAt: LocalTime,
    val isFixed: Boolean,
    val endsNextDay: Boolean,
    val hasViolation: Boolean,
)
