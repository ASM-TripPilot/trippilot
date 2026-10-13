package com.trippilot.itinerarygeneration.api

import java.time.LocalDate
import java.time.LocalTime
import java.util.UUID

/**
 * 일정 편집 퍼사드(C8) — 다른 모듈이 일정을 **고칠** 때 쓰는 공개 계약(R1, `..api..`).
 *
 * 왜 여기 있나: 일정 쓰기와 재검증(AI validate/repair)·리비전·동결 승계는 **C8 소유**다. 도우미(U8)가
 * 제안을 [적용]할 때 그 규칙들을 다시 조립하면 같은 편집이 경로에 따라 다르게 저장된다 —
 * REST 편집(`PUT …/itinerary`)과 **같은 서비스**를 타게 한다(U8 FD G-U8-1 · DEC-U8-2).
 *
 * REST 경로와 다른 것은 **누가 바꿨는가**([source]) 하나다. 그 값은 변경 이력(`change_log_entry.source_type`)과
 * 리비전 요약에 남는다 — 도우미가 고친 것이 "직접 수정"으로 기록되면 사용자가 무엇이 바뀌었는지 되짚지 못한다.
 */
interface ItineraryEditFacade {

    /**
     * 일정을 [days] 로 **전체 교체**한다(슬롯 순서 = 배열 순서). 편집은 비차단이다 — 위반이 있어도 저장하고
     * 결과에 표시한다(ADR-0011). 호출측이 위반 있는 안을 막고 싶으면 **부르기 전에** 막는다.
     *
     * 없거나 타 계정 여행이면 `ResourceNotFound`, 여행 전 확정 일정·생성 중 미도착 일자면 `ConflictDetected` —
     * REST 편집과 같은 판정이다.
     *
     * @param reason 왜 바꿨는지 한 줄, **500자 이하**(넘으면 `ValidationFailed` — 변경 이력 칸의 상한이다).
     *   null·공백이면 [source] 에 맞는 기본 문구가 남는다(이력은 비워 두지 않는다, BR-U4-31).
     * @param onlyIf **저장 직전의 일정**(저장 트랜잭션 안에서 다시 읽은 것)을 보고 저장할지 정한다. false 면 아무것도 쓰지 않고
     *   `ConflictDetected(STALE)` 이다. 옛 일정을 보고 만든 전체 교체가 그 사이의 편집을 덮어쓰지 않게 하는 문이다(U8 INV-U8-04) —
     *   호출측이 미리 확인하고 부르는 것으로는 모자라다: 이 저장은 재검증으로 상대를 부르느라 몇 초가 갈 수 있다.
     */
    fun edit(
        accountId: UUID, tripId: UUID, days: List<EditDayCommand>, reason: String?, source: ItineraryEditSource,
        onlyIf: ((current: List<EditDayCommand>) -> Boolean)? = null,
    ): ItineraryEditResult
}

/**
 * 편집의 출처. 변경 이력의 `source_type` 어휘 중 **이 오퍼레이션으로 들어올 수 있는 것만** 연다 —
 * 재계획 반영(`PLAN_B`)은 [ReplanFacade.apply] 가 자기 경로로 남긴다.
 */
enum class ItineraryEditSource { MANUAL, ASSISTANT }

/** 하루치 편집안(api-safe). */
data class EditDayCommand(val date: LocalDate, val slots: List<EditSlotCommand>)

/**
 * 슬롯 한 칸(api-safe). 전체 교체라 **현행 값을 그대로 실어야** 소실되지 않는다 — [endsNextDay](자정 넘김, HC4)·
 * [isFixed] 를 빠뜨리면 그 슬롯의 고정·자정 넘김이 풀린다. 소요시간 필드는 없다(INV-3).
 */
data class EditSlotCommand(
    val poiId: UUID,
    val startAt: LocalTime,
    val endAt: LocalTime,
    val isFixed: Boolean,
    val endsNextDay: Boolean,
)

/**
 * 저장 결과. 도우미는 제안 때 위반이 없던 안만 적용하지만, **저장 시점의 재검증이 다르게 판정할 수 있다** —
 * 그때 숨기지 않고 알리려면 이 값이 필요하다(U8 FD §2.1 5단계).
 *
 * @property hasViolation 저장된 일정에 위반 표시가 있는가.
 * @property judged 이번 저장에서 재검증이 **실제로 판정됐는가**. AI 가 닿지 않으면 편집은 막지 않고 판정을 보류한다 —
 *   그때 [hasViolation] 은 직전 표시를 이은 값이라, 새로 들어온 장소는 아무도 검증하지 않았는데 `false` 다.
 *   **`judged=false` 인 `hasViolation=false` 를 "문제없음"으로 읽지 말 것.**
 */
data class ItineraryEditResult(val itineraryId: UUID, val hasViolation: Boolean, val judged: Boolean)
