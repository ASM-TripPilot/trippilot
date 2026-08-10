package com.trippilot.planb.domain

import java.time.Instant
import java.time.LocalDate
import java.util.UUID

/**
 * 감지된 변화(US-PLANB-02 · C9) — "일정을 다시 볼 만한 일이 생겼다"는 **비차단 배너**의 근거.
 *
 * 트리거는 일정을 **자동으로 바꾸지 않는다**. 바꾸는 것은 사용자가 재계획을 시작했을 때뿐이다.
 * 그래서 이 타입이 가진 책임은 "무엇을 감지했나"보다 **"이미 말했나"**에 가깝다 —
 * 같은 사실을 반복해서 알리면 사용자는 배너를 무시하게 되고, 정작 중요한 신호도 함께 묻힌다.
 */
data class TriggerEvent(
    val triggerEventId: UUID,
    val tripId: UUID,
    val type: TriggerType,
    /** 어느 방문지에 대한 신호인가. null = 일정 전체(예: 광역 특보). */
    val targetSlotId: UUID?,
    /** 감지값 요약(표시용). 판정에 쓰지 않는다 — 판정은 감지기가 이미 끝냈다. */
    val value: String,
    val status: TriggerStatus,
    val detectedAt: Instant,
    val updatedAt: Instant,
) {
    companion object {
        fun raise(tripId: UUID, type: TriggerType, targetSlotId: UUID?, value: String, at: Instant) =
            TriggerEvent(UUID.randomUUID(), tripId, type, targetSlotId, value, TriggerStatus.ACTIVE, at, at)
    }

    /** 사용자가 "그대로 둘게요". 이후 같은 사유·같은 방문지로는 다시 알리지 않는다. */
    fun dismissed(at: Instant) = copy(status = TriggerStatus.DISMISSED, updatedAt = at)

    /** 상황이 해소됐다(비가 그침·영업 재개). 사용자가 닫은 것과 구분해야 재발 시 다시 알릴 수 있다. */
    fun resolved(at: Instant) = copy(status = TriggerStatus.NORMAL, updatedAt = at)
}

/** 감지 카테고리 4종(정본 밴드 i). */
enum class TriggerType { WEATHER, HOURS, DELAY, STAY_OVER }

enum class TriggerStatus { ACTIVE, NORMAL, DISMISSED }

/**
 * 알림 민감도. 사용자가 "덜 알려줘"라고 말할 수 있어야 배너를 신뢰한다.
 * [dailyCap] 은 **하루에 새로 띄울 수 있는 배너 수** — 임계값 자체가 아니라 총량을 제한한다.
 */
enum class Sensitivity(val dailyCap: Int) {
    LOW(2), NORMAL(5), HIGH(10)
}

/**
 * 억제 판정 — 감지된 사실을 **알릴지 말지**. 감지(무엇이 일어났나)와 분리한 이유는,
 * 억제 규칙이 외부 신호와 무관하게 결정되며 그 자체로 검증돼야 하기 때문이다.
 */
object TriggerSuppression {

    /** 억제 사유. 왜 안 알렸는지 로그·테스트에서 이름으로 말할 수 있어야 한다. */
    enum class Verdict { RAISE, ALREADY_ACTIVE, USER_DISMISSED, DAILY_CAP }

    /**
     * @param existing 같은 여행의 **같은 사유·같은 방문지** 이력(상태 무관)
     * @param raisedToday 오늘 이 여행에서 새로 띄운 배너 수
     */
    fun judge(existing: List<TriggerEvent>, raisedToday: Int, sensitivity: Sensitivity): Verdict = when {
        // 이미 알리는 중이면 다시 알리지 않는다 — 배너가 둘로 늘 뿐 새 정보가 없다.
        existing.any { it.status == TriggerStatus.ACTIVE } -> Verdict.ALREADY_ACTIVE

        // 사용자가 닫았으면 같은 사유·같은 방문지로는 더 말하지 않는다("그대로 둘게요").
        // 해소(NORMAL)와 구분한다 — 해소는 상황이 바뀐 것이라 재발 시 다시 알릴 수 있다.
        existing.any { it.status == TriggerStatus.DISMISSED } -> Verdict.USER_DISMISSED

        raisedToday >= sensitivity.dailyCap -> Verdict.DAILY_CAP

        else -> Verdict.RAISE
    }
}

interface TriggerEventRepository {
    fun save(event: TriggerEvent): TriggerEvent

    fun findById(triggerEventId: UUID): TriggerEvent?

    fun findByTrip(tripId: UUID): List<TriggerEvent>

    /** 같은 사유·같은 방문지 이력(상태 무관) — 억제 판정 입력. */
    fun findHistory(tripId: UUID, type: TriggerType, targetSlotId: UUID?): List<TriggerEvent>

    /** 해당 날짜(여행지 기준)에 **새로 띄운** 배너 수 — 전역 빈도 상한 판정 입력. */
    fun countRaisedOn(tripId: UUID, date: LocalDate): Int
}

interface TriggerSettingRepository {
    /** 없으면 [Sensitivity.NORMAL] — 설정이 없다고 알림이 멈추면 안 된다. */
    fun sensitivityOf(tripId: UUID): Sensitivity
}
