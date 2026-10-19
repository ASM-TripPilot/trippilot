package com.trippilot.planbdetection.api

import java.time.LocalDate
import java.util.UUID

/**
 * 트리거 조회 퍼사드(C9) — 타 모듈이 의존하는 공개 계약(R1, `..api..`).
 *
 * 재계획(C10)이 트리거 진입을 **그 트리거의 날짜로 강제**하려고 연다(설계서 D4 규칙 5 — 구 앱이 내일 트리거로
 * 오늘을 다시 짜는 길을 서버가 막는다). api-safe 타입만 노출한다 — 내부 enum 은 문자열(`ItineraryRef.status` 관례).
 */
interface TriggerLookupFacade {
    /** 그 여행의 트리거. 없거나 다른 여행 소속이면 null. 소유 확인은 호출측이 이미 했다. */
    fun find(tripId: UUID, triggerId: UUID): TriggerRef?
}

/**
 * @property kind WEATHER·CLOSURE·DELAY·MANUAL
 * @property state ACTIVE·SUPPRESSED·CONSUMED·EXPIRED — 저장된 그대로
 * @property scope FULL_DAY·PARTIAL_SLOTS·NONE
 * @property currentTriggerId 같은 대상(kind·날짜·슬롯)의 지금 ACTIVE — 자기 자신일 수 있다. 해제 뒤 다시 서면 새 id 다
 */
data class TriggerRef(
    val kind: String,
    val state: String,
    val affectedDate: LocalDate,
    val scope: String?,
    val currentTriggerId: UUID?,
)
