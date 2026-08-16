package com.trippilot.itinerarygeneration.api

import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.util.UUID

/**
 * 재계획 산출·반영 퍼사드(C8) — U4 재계획 모듈이 쓰는 공개 계약(R1, `..api..`).
 *
 * 왜 여기 있나: AI 경계(`ScheduleAgentPort`)와 일정 쓰기는 **C8 소유**다. C10(재계획)은 세션과 사용자
 * 입력을 소유하고, "이 일정을 이 잠금으로 다시 짜 달라"고 요청만 한다. 재계획 모듈이 AI 포트를 직접 잡으면
 * 경계 소유가 둘로 갈려 계약 변경 때 두 곳을 고쳐야 한다(R1 위반이기도 하다).
 *
 * **[propose] 는 아무것도 쓰지 않는다**(INV-U4-05). 일정에 손대는 유일한 지점은 [apply] 다.
 */
interface ReplanFacade {

    /**
     * 재계획안을 만든다. **해가 없으면 null** — 예외가 아니다(사용자에게 "대안 없음" 3옵션을 보여야 한다).
     * AI 호출 실패는 [com.trippilot.itinerarygeneration.domain.ScheduleAgentCallFailed] 로 올라온다(INV-4).
     */
    fun propose(command: ReplanCommand): ReplanProposal?

    /**
     * 초안을 일정에 반영한다 — 되돌릴 지점을 먼저 남기고(BR-U3-19) 대상 일자만 교체한다.
     * 확정된 일정은 반영하지 않는다(그쪽은 잠겨 있다).
     *
     * 반영과 **같은 트랜잭션에서** 변경 이력 1행을 남긴다(BR-U4-30). 전후 스냅숏은 일정을 소유한 이쪽이
     * 만들고, [reason] 은 세션의 사유·지시어를 아는 C10 이 조립해 넘긴다 — 각자 가진 것만 낸다.
     *
     * @param reason 왜 바꿨는지 한 줄(BR-U4-31). **비워서 넘기지 않는다** — 이력의 존재 이유가 이 칸이다.
     */
    fun apply(accountId: UUID, tripId: UUID, proposal: ReplanProposal, reason: String)
}

/**
 * 재계획 요청(api-safe). 도메인 타입을 계약에 싣지 않는다.
 *
 * @property completedSlotKeys **이미 다녀온** 슬롯(BR-U2-04 `"{date}#{poiId}"`). 방문 실적은 C10 만 알기에 받아 온다.
 *   나머지 잠금(시각 고정 슬롯 · 지금 이전 슬롯)은 **C8 이 스스로 계산한다** — 슬롯 시각·고정 여부가 여기 있고,
 *   그 값을 계약에 실어 내보내면 잠금 규칙이 두 모듈에 흩어진다.
 * @property fullDay 오늘 전체를 다시 짜는가(false = 지금 이후만). ai `ReplanScope` 두 값에 대응한다.
 */
@Suppress("LongParameterList")
data class ReplanCommand(
    val accountId: UUID,
    val tripId: UUID,
    val targetDate: LocalDate,
    val fromInstant: Instant,
    val fullDay: Boolean,
    val completedSlotKeys: List<String>,
    val originLat: Double?,
    val originLng: Double?,
    val reasons: List<String>,
    val directives: List<String>,
    val freeText: String?,
    val excludedPoiIds: List<UUID>,
)

/**
 * 재계획안 — **확정 전 초안**이다. 세션 jsonb 에 그대로 실려 이력이 되므로
 * [toMap]·[fromMap] 왕복이 항등이어야 한다(왕복에서 값이 새면 확정 시 그 값이 사라진다).
 */
data class ReplanProposal(
    val itineraryId: UUID,
    val date: LocalDate,
    val slots: List<ReplanSlot>,
) {
    /** 대안이 하나도 없으면 "해 없음"이다 — 빈 초안을 보여 주면 사용자가 빈 하루를 확정하게 된다. */
    val isEmpty: Boolean get() = slots.isEmpty()

    fun toMap(): Map<String, Any> = mapOf(
        "itineraryId" to itineraryId.toString(),
        "date" to date.toString(),
        "slots" to slots.map { it.toMap() },
    )

    companion object {
        @Suppress("UNCHECKED_CAST")
        fun fromMap(raw: Map<String, Any>): ReplanProposal = ReplanProposal(
            itineraryId = UUID.fromString(raw.getValue("itineraryId") as String),
            date = LocalDate.parse(raw.getValue("date") as String),
            slots = (raw["slots"] as? List<Map<String, Any>>).orEmpty().map { ReplanSlot.fromMap(it) },
        )
    }
}

data class ReplanSlot(
    val poiId: UUID,
    val startAt: LocalTime,
    val endAt: LocalTime,
    val isFixed: Boolean,
    val endsNextDay: Boolean,
    val distanceRange: String?,
    val placementReason: String?,
) {
    fun toMap(): Map<String, Any> = buildMap {
        put("poiId", poiId.toString())
        put("startAt", startAt.toString())
        put("endAt", endAt.toString())
        put("isFixed", isFixed)
        put("endsNextDay", endsNextDay)
        distanceRange?.let { put("distanceRange", it) }
        placementReason?.let { put("placementReason", it) }
    }

    companion object {
        fun fromMap(raw: Map<String, Any>) = ReplanSlot(
            poiId = UUID.fromString(raw.getValue("poiId") as String),
            startAt = LocalTime.parse(raw.getValue("startAt") as String),
            endAt = LocalTime.parse(raw.getValue("endAt") as String),
            isFixed = raw["isFixed"] as? Boolean ?: false,
            endsNextDay = raw["endsNextDay"] as? Boolean ?: false,
            distanceRange = raw["distanceRange"] as? String,
            placementReason = raw["placementReason"] as? String,
        )
    }
}
