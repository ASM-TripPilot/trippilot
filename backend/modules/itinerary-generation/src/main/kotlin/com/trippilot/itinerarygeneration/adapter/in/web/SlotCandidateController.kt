package com.trippilot.itinerarygeneration.adapter.`in`.web

import com.trippilot.itinerarygeneration.application.RequestSlotCandidates
import com.trippilot.itinerarygeneration.application.SlotCandidateService
import com.trippilot.itinerarygeneration.domain.SlotCandidatesOutput
import jakarta.validation.Valid
import jakarta.validation.constraints.Positive
import jakarta.validation.constraints.Size
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import java.security.Principal
import java.util.UUID

/**
 * 슬롯 교체 후보(DEC-U3-5 · h11 "다른 후보 N" · h12·h18 슬롯 교체).
 * 완전 AI·같이 고르기가 **같은 오퍼레이션**을 쓴다(BR-U3-23).
 *
 * 조회지만 POST 인 이유: 입력이 복합(이웃 슬롯·컨셉·반경)이고 서버가 제외 목록을 유도한다.
 */
@RestController
@RequestMapping("/api/v1/trips/{tripId}/itinerary/slot-candidates")
class SlotCandidateController(private val service: SlotCandidateService) {

    @PostMapping
    fun propose(
        principal: Principal,
        @PathVariable tripId: UUID,
        @Valid @RequestBody request: SlotCandidatesRequest,
    ): SlotCandidatesResponse =
        SlotCandidatesResponse.from(service.propose(principal.accountId(), tripId, request.toCommand()))
}

/**
 * [slotKey] 교체할 슬롯 `"{date}#{poiId}"`. [radiusM] 미지정이면 AI 기본 반경 —
 * h15 "반경 넓힘"이 이 값을 올려 재요청한다. [concept] h13 테마.
 *
 * 제외할 장소는 **받지 않는다** — 서버가 현재 일정에서 유도한다(클라 목록을 믿으면 누락분이 재추천된다).
 */
data class SlotCandidatesRequest(
    @field:Size(max = 100, message = "슬롯 키가 너무 깁니다.")
    val slotKey: String,
    @field:Positive(message = "반경은 0보다 커야 합니다.")
    val radiusM: Int? = null,
    @field:Size(max = 40, message = "컨셉은 40자 이하입니다.")
    val concept: String? = null,
) {
    fun toCommand() = RequestSlotCandidates(slotKey, radiusM, concept)
}

/**
 * [candidates] 빈 목록 = 후보 0건 → 클라이언트가 반경 확대·컨셉 변경을 제안한다(BR-U3-25).
 * [radiusMUsed] 는 **실제 사용 반경** — AI 가 자동 확대했을 수 있어 사용자에게 그대로 표시한다.
 */
data class SlotCandidatesResponse(
    val candidates: List<SlotCandidateResponse>,
    val radiusMUsed: Int,
) {
    companion object {
        fun from(o: SlotCandidatesOutput) = SlotCandidatesResponse(
            o.candidates.map { SlotCandidateResponse(it.poiId, it.distanceRange, it.rationale) },
            o.radiusMUsed,
        )
    }
}

/** 거리만(INV-3). [rationale] 은 시각·소요시간을 언급하지 않는다(BR-U2-09). */
data class SlotCandidateResponse(val poiId: UUID, val distanceRange: String, val rationale: String)
