package com.trippilot.planbdetection.domain

import java.time.Instant
import java.time.LocalDate
import java.util.UUID

/**
 * 감지 기록(C9 · 정본 §2.1). **발화하지 않은 판정도 남긴다** —
 * "왜 알림이 안 왔나"를 답하려면 억제됐는지·영향이 없다고 봤는지가 서로 다른 사실로 남아야 한다.
 *
 * **INV-U4-01**: `shouldReplan=false` 인 판정은 사용자에게 어떤 형태로도 노출되지 않는다.
 * **BR-U4-09**: 트리거는 제안까지만 한다 — 어떤 트리거도 일정을 자동으로 바꾸지 않는다.
 */
data class PlanBTrigger(
    val triggerId: UUID,
    val tripId: UUID,
    val itineraryId: UUID,
    val kind: TriggerKind,
    val affectedDate: LocalDate,
    /** 영향받는 슬롯의 경계 키. 날짜 전체 영향이면 null. */
    val slotKey: String?,
    /** 직렬화 가능 원시값만(ai 규약). 예: `{"pop":70}` · `{"delayMin":18}` */
    val payload: Map<String, Any>,
    val shouldReplan: Boolean,
    val scope: TriggerScope?,
    val reason: String,
    val state: TriggerState,
    val detectedAt: Instant,
) {
    companion object {
        /** 발화한다 — 사용자에게 배너로 보인다. */
        fun active(
            tripId: UUID, itineraryId: UUID, kind: TriggerKind, affectedDate: LocalDate, slotKey: String?,
            payload: Map<String, Any>, scope: TriggerScope, reason: String, at: Instant,
        ): PlanBTrigger {
            // 발화했는데 범위가 NONE 이면 모순이다 — 배너는 뜨는데 [대안 보기] 가 열 세션의 범위를 못 정한다.
            // 재계획 세션의 범위는 PARTIAL_SLOTS·FULL_DAY 뿐이라 NONE 을 옮길 자리가 없다.
            require(scope != TriggerScope.NONE) { "발화하는 트리거의 범위는 NONE 일 수 없습니다." }
            return PlanBTrigger(
                UUID.randomUUID(), tripId, itineraryId, kind, affectedDate, slotKey, payload,
                shouldReplan = true, scope = scope, reason = reason, state = TriggerState.ACTIVE, detectedAt = at,
            )
        }

        /**
         * 판정은 했으나 발화하지 않는다. 억제(INV-U4-02) 또는 영향 없음(BR-U4-06)이 그 이유다.
         * [shouldReplan] 을 false 로 두는 것이 핵심 — ACTIVE 로 남으면 화면에 노출된다(DB CHECK 도 막는다).
         */
        fun silent(
            tripId: UUID, itineraryId: UUID, kind: TriggerKind, affectedDate: LocalDate, slotKey: String?,
            payload: Map<String, Any>, reason: String, state: TriggerState, at: Instant,
        ): PlanBTrigger {
            require(state != TriggerState.ACTIVE) { "발화하지 않는 판정은 ACTIVE 일 수 없습니다." }
            return PlanBTrigger(
                UUID.randomUUID(), tripId, itineraryId, kind, affectedDate, slotKey, payload,
                shouldReplan = false, scope = TriggerScope.NONE, reason = reason, state = state, detectedAt = at,
            )
        }
    }

    /** 재계획 확정에 쓰였다 — 같은 신호로 다시 알리지 않는다. */
    fun consumed() = copy(state = TriggerState.CONSUMED)

    /** 대상 슬롯이 지났다 — 더는 유효하지 않다(BR-U4-06). */
    fun expired() = copy(state = TriggerState.EXPIRED)
}

/**
 * BR-U4-01 — **4종뿐이다.** ai `TriggerKind` 가 정본이며 백엔드가 종류를 늘리지 않는다(DEC-U4-4).
 * '체류 초과'는 [DELAY] 의 payload 변형이고, '교통'은 존재하지 않는다.
 */
enum class TriggerKind { WEATHER, CLOSURE, DELAY, MANUAL }

/** ai `ReplanScope` 그대로. 발화하지 않는 판정은 [NONE]. */
enum class TriggerScope { FULL_DAY, PARTIAL_SLOTS, NONE }

enum class TriggerState { ACTIVE, SUPPRESSED, CONSUMED, EXPIRED }

/** 억제 레코드(정본 §2.2). `[끄기]` 는 화면에서 배너를 감추는 게 아니라 이 행을 만든다(BR-U4-15). */
data class Suppression(
    val suppressionId: UUID,
    val tripId: UUID,
    val kind: TriggerKind,
    val slotKey: String?,
    val scopeType: SuppressionScope,
    val suppressedAt: Instant,
    /** 없으면 여행 종료까지. */
    val expiresAt: Instant?,
) {
    init {
        require(scopeType != SuppressionScope.SLOT || slotKey != null) {
            "슬롯 범위 억제에는 대상 슬롯이 필요합니다."
        }
    }

    /** 이 억제가 지금 유효한가. 만료된 억제는 없는 것과 같다(BR-U4-07 "억제가 만료되면 재발화"). */
    fun isEffectiveAt(at: Instant): Boolean = expiresAt == null || at < expiresAt

    /** 이 조합을 덮는가. DAY·TRIP 범위는 슬롯을 가리지 않는다. */
    fun covers(kind: TriggerKind, slotKey: String?): Boolean =
        this.kind == kind && (scopeType != SuppressionScope.SLOT || this.slotKey == slotKey)

    companion object {
        fun of(tripId: UUID, kind: TriggerKind, slotKey: String?, scopeType: SuppressionScope, at: Instant, expiresAt: Instant? = null) =
            Suppression(UUID.randomUUID(), tripId, kind, slotKey, scopeType, at, expiresAt)
    }
}

enum class SuppressionScope { SLOT, DAY, TRIP }

/** 알림 민감도. [dailyCap] 은 **하루에 새로 발화할 수 있는 수** — 임계값이 아니라 총량이다(BR-U4-08). */
enum class Sensitivity(val dailyCap: Int) {
    LOW(2), NORMAL(5), HIGH(10)
}

interface PlanBTriggerRepository {
    fun save(trigger: PlanBTrigger): PlanBTrigger

    fun findById(triggerId: UUID): PlanBTrigger?

    /** 발화 중인 것만 — INV-U4-01 때문에 화면에는 이것만 나간다. */
    fun findActiveByTrip(tripId: UUID): List<PlanBTrigger>

    /** 그 날(여행지 기준) 새로 **발화한** 수 — 전역 빈도 상한 판정 입력(BR-U4-08). */
    fun countActivatedOn(tripId: UUID, date: LocalDate): Int
}

interface SuppressionRepository {
    fun save(suppression: Suppression): Suppression

    fun findByTrip(tripId: UUID): List<Suppression>
}

interface SensitivityRepository {
    /** 없으면 [Sensitivity.NORMAL] — 설정이 없다고 알림이 멈추면 안 된다. */
    fun of(accountId: UUID): Sensitivity
}
