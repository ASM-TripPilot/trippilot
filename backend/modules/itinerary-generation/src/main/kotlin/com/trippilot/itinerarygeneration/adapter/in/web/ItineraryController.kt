package com.trippilot.itinerarygeneration.adapter.`in`.web

import com.trippilot.itinerarygeneration.application.ConfirmItineraryService
import com.trippilot.itinerarygeneration.application.EditDay
import com.trippilot.itinerarygeneration.application.EditItinerary
import com.trippilot.itinerarygeneration.application.EditItineraryService
import com.trippilot.itinerarygeneration.application.EditSlot
import com.trippilot.itinerarygeneration.application.GenerateItineraryService
import com.trippilot.itinerarygeneration.application.ItineraryQueryService
import com.trippilot.itinerarygeneration.application.SlotSurface
import com.trippilot.itinerarygeneration.application.SlotSurfaceAssembler
import com.trippilot.itinerarygeneration.domain.GenerationMode
import com.trippilot.itinerarygeneration.domain.Itinerary
import com.trippilot.itinerarygeneration.domain.VisitSlot
import jakarta.validation.Valid
import jakarta.validation.constraints.Size
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
    private val surfaces: SlotSurfaceAssembler,
) {
    /** 네 응답 모두 같은 표면을 실어야 한다 — 조회로만 채워지면 생성·확정·편집 직후 화면이 빈다. */
    private fun respond(itinerary: Itinerary) = ItineraryResponse.from(itinerary, surfaces.assemble(itinerary))
    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    fun generate(
        principal: Principal,
        @PathVariable tripId: UUID,
        @RequestBody(required = false) request: GenerateItineraryRequest?,
    ): ItineraryResponse {
        val mode = request?.generationMode ?: GenerationMode.FULLY_AI
        return respond(service.generate(principal.accountId(), tripId, mode))
    }

    @GetMapping
    fun get(principal: Principal, @PathVariable tripId: UUID): ItineraryResponse =
        respond(queryService.get(principal.accountId(), tripId))

    /** 확정 — PLANNED→CONFIRMED(이미 확정이면 409). 재생성은 확정을 되돌린다(확정 해제 API 부재). */
    @PostMapping("/confirm")
    fun confirm(principal: Principal, @PathVariable tripId: UUID): ItineraryResponse =
        respond(confirmService.confirm(principal.accountId(), tripId))

    /** 편집(전체 교체) + 재검증 — 비차단(위반은 hasViolation 표시, 저장 허용). 확정된 일정은 409. */
    @PutMapping
    fun edit(principal: Principal, @PathVariable tripId: UUID, @Valid @RequestBody request: EditItineraryRequest): ItineraryResponse =
        respond(editService.edit(principal.accountId(), tripId, request.toCommand()))
}

/** 편집 요청 — 수정된 전체 일자·슬롯 배열(슬롯 순서 = 배열 순서). [reason] 은 선택(변경 이력에 남는다). */
data class EditItineraryRequest(
    val days: List<EditDayRequest>,
    // 저장 컬럼 상한과 같은 값 — 여기서 막지 않으면 DB 가 22001 로 던져 편집까지 롤백되고 500 이 나간다.
    @field:Size(max = 500, message = "사유는 500자 이하입니다.")
    val reason: String? = null,
) {
    fun toCommand() = EditItinerary(
        days.map { d -> EditDay(d.date, d.slots.map { EditSlot(it.poiId, it.startAt, it.endAt, it.isFixed, it.endsNextDay) }) },
        reason,
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
        fun from(i: Itinerary, surfaces: Map<UUID, SlotSurface>) = ItineraryResponse(
            itineraryId = i.itineraryId,
            tripId = i.tripId,
            status = i.status.name,
            solveMode = i.solveMode.name,
            isFallback = i.isFallback,
            generationState = i.generationState.name,
            days = i.days.map { d ->
                DayResponse(d.date, d.slots.map { s -> SlotResponse.of(s, surfaces[s.sourcePoiId]) })
            },
        )
    }
}

data class DayResponse(val date: LocalDate, val slots: List<SlotResponse>)

/**
 * 방문 슬롯 표시 — 시각·순서만(INV-2, 소요시간 없음 INV-3).
 * [endsNextDay]: 자정 넘김(HC4, endAt=익일 시각·시작일 귀속). [hasViolation]: 편집 재검증(HC1-4) 위반 표시(비차단).
 *
 * [distanceRange]: 직전 지점에서의 이동 **거리 표시 문자열**(BR-U2-08) — 소요시간은 어떤 이유로도 없다(INV-3).
 * POI 표면(이름·좌표·사진·영업시간)은 추가 왕복 없이 여기 실린다(BR-U3-09). 정본에도 동결본에도 없는
 * 장소는 표면 필드가 전부 null 이다 — 그 경우에도 슬롯 자체는 사라지지 않는다.
 * [openingHoursKnown] false = 영업시간 미확인 → 확정 배치가 아니라 사용자 확인 후보로 분리(US-SCHED-03 예외).
 */
data class SlotResponse(
    val poiId: UUID,
    val startAt: LocalTime,
    val endAt: LocalTime,
    val isFixed: Boolean,
    val endsNextDay: Boolean,
    val hasViolation: Boolean,
    val distanceRange: String?,
    val nameKo: String?,
    val lat: Double?,
    val lng: Double?,
    val category: String?,
    val openingHours: String?,
    val openingHoursKnown: Boolean,
    val imageUrl: String?,
    val tags: List<String>,
) {
    companion object {
        fun of(s: VisitSlot, surface: SlotSurface?) = SlotResponse(
            poiId = s.sourcePoiId,
            startAt = s.startAt,
            endAt = s.endAt,
            isFixed = s.isFixed,
            endsNextDay = s.endsNextDay,
            hasViolation = s.hasViolation,
            distanceRange = s.distanceRange,
            nameKo = surface?.nameKo,
            lat = surface?.lat,
            lng = surface?.lng,
            category = surface?.category,
            openingHours = surface?.openingHours,
            openingHoursKnown = surface?.openingHoursKnown ?: false,
            imageUrl = surface?.imageUrl,
            tags = surface?.tags.orEmpty(),
        )
    }
}
