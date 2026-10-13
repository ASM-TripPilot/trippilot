package com.trippilot.itinerarygeneration.api

import java.time.LocalDate
import java.time.LocalTime
import java.util.UUID

/**
 * 편집 **제안** 퍼사드(C8) — 다른 모듈이 "이렇게 바꾸면 어떻게 되는가"를 물을 때 쓰는 공개 계약(R1, `..api..`).
 *
 * 왜 여기 있나: 발화·명령을 검증된 일정으로 바꾸는 일은 AI 경계(`ScheduleAgentPort`)가 하고, 그 포트는 이 모듈의
 * `domain` 이라 밖에서 못 본다(U8 FD G-U8-2). 상대에 보낼 일정 본문·앵커·취향을 조립하는 규칙도 C8 것이다.
 *
 * **아무것도 저장하지 않는다.** 결과를 반영하는 길은 [ItineraryEditFacade.edit] 하나뿐이고(BR-U8-33),
 * 거기서 다시 재검증된다 — 이 결과와 저장 결과가 갈리면 저장된 값이 이긴다(BR-U8-34).
 */
interface ItineraryEditProposalFacade {

    /**
     * [targetDate] 하루를 [request] 대로 고친 안을 돌려준다. 상대는 그 날의 슬롯만 움직인다.
     *
     * 없거나 타 계정 여행·일정이 없으면 `ResourceNotFound`, [targetDate] 가 일정에 없는 날이거나
     * 교체 대상이 그 날 슬롯이 아니면 `ValidationFailed`.
     *
     * @param deadlineMs 이 호출이 쓸 수 있는 시간(양수). **넘기면 [EditProposal.Unavailable]** 로 돌아온다 —
     *   호출측의 턴 예산(PERF-U8-02)이 여기서 지켜진다. 상대에도 같은 값을 계산 예산으로 알린다.
     */
    fun propose(accountId: UUID, tripId: UUID, targetDate: LocalDate, request: EditProposalRequest, deadlineMs: Long): EditProposal
}

sealed interface EditProposalRequest {
    /** 자연어 — 상대가 LLM 으로 편집 명령으로 옮긴다. 1~500자(상대 계약 상한). */
    data class Utterance(val text: String) : EditProposalRequest

    /** [slotKey](`"{date}#{poiId}"`) 슬롯의 장소를 [newPoiId] 로 바꾼다 — LLM 을 쓰지 않는다. */
    data class ReplaceSlot(val slotKey: String, val newPoiId: UUID) : EditProposalRequest
}

sealed interface EditProposal {
    /**
     * 검증을 통과한 안. [days] 는 **일정 전체**다(안 바뀐 날 포함) — [ItineraryEditFacade.edit] 가 전체 교체라
     * 그대로 넘길 수 있게. 시각·순서·거리는 상대 조립이 검증한 값이다(INV-2).
     *
     * @property applyHint 상대의 판단(`AUTO_APPLY`|`CONFIRM_REQUIRED`) — **표시 힌트일 뿐**이다(DEC-U8-2).
     */
    data class Proposed(val days: List<ProposedDay>, val applyHint: String?) : EditProposal

    /**
     * 해가 없다 — 하드 제약 위반([violations])이거나 편집 규칙에 걸렸다(고정 슬롯·후보 풀 밖 등, 이때 목록은 빈다).
     * 사유 원문은 싣지 않는다 — 상대의 진단 문장이라 화면에 낼 문구가 아니다(로그에 남는다).
     */
    data class Rejected(val violations: List<ProposalViolation>) : EditProposal

    /** 발화를 편집으로 옮기지 못했다. */
    data object NotUnderstood : EditProposal

    /** 상대에 닿지 못했거나 시한을 넘겼다. 일정은 그대로다. */
    data object Unavailable : EditProposal
}

data class ProposedDay(val date: LocalDate, val slots: List<ProposedSlot>)

/**
 * @property distanceRange **직전 지점 → 이 슬롯** 구간의 거리 표시 문자열. 상대가 안 주면 null — 지어내지 않는다.
 *   **지금 상대의 편집 응답은 거리를 싣지 않는다**(실 왕복 2026-10-13 · TRIP-1381) — 그래서 실 모드에서는 늘 null 이고,
 *   거리는 저장할 때 편집 경로의 수리(repair)가 채운다. 소요시간은 없다(INV-3).
 */
data class ProposedSlot(
    val poiId: UUID,
    val startAt: LocalTime,
    val endAt: LocalTime,
    val isFixed: Boolean,
    val endsNextDay: Boolean,
    val distanceRange: String?,
)

/**
 * @property poiId 위반이 걸린 장소. 붙일 슬롯이 없는 위반(예: 꼭 갈 곳을 못 넣음)은 null.
 * @property message 사용자 문구 — 일정 화면의 위반 사유와 같은 번역이다.
 */
data class ProposalViolation(val poiId: UUID?, val message: String)
