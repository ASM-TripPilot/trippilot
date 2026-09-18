package com.trippilot.planbdetection.domain

import java.time.Instant

/**
 * 판정(LC-U4-1) — 신호를 받아 **알릴지**를 정한다.
 *
 * 클라이언트는 신호만 모으고 **임계·억제는 서버가 안다**(BR-U4-03). 그래서 이 판정이 한곳에 모여 있어야
 * 클라이언트가 자체 판단으로 배너를 띄우는 일이 없다.
 *
 * 순수 함수로 둔 이유: 억제·상한 규칙은 외부 신호와 무관하게 결정되며 그 자체로 검증돼야 한다.
 * 외부 조회(날씨 등)는 이 앞 단계이고, 실패하면 **애초에 신호가 오지 않는다**(BR-U4-05 무발화).
 */
object TriggerEvaluator {

    /**
     * 판정 결과. 왜 안 알렸는지 이름으로 말할 수 있어야 관측에서 "왜 알림이 없었나"를 답한다.
     *
     * @property state 이 판정을 어떤 상태로 남길 것인가 — 발화하지 않아도 **행은 남긴다**(정본 §2.1).
     */
    enum class Verdict(val state: TriggerState) {
        /** 발화한다. */
        RAISE(TriggerState.ACTIVE),

        /** 사용자가 껐다(BR-U4-15) 또는 같은 조합이 이미 발화 중이다(BR-U4-07). */
        SUPPRESSED(TriggerState.SUPPRESSED),

        /** 하루 총량을 넘었다(BR-U4-08). 억제의 한 형태다. */
        DAILY_CAP(TriggerState.SUPPRESSED),

        /** 남은 일정에 닿지 않는다 — 이미 지났거나 완료된 슬롯만 건드린다(BR-U4-06). */
        NOT_AFFECTING(TriggerState.EXPIRED),
    }

    /**
     * @param slotKey 신호가 가리키는 슬롯. null 이면 날짜 전체 영향이라 [remainingSlotKeys] 로 거르지 않는다.
     * @param remainingSlotKeys `fromInstant` 이후의 미완료 슬롯. 비어 있으면 남은 일정이 없다는 뜻이다.
     * @param activeSlotKeysOfKind 같은 사유로 **이미 발화 중**인 슬롯 키들(null 포함 가능).
     */
    fun judge(
        kind: TriggerKind,
        slotKey: String?,
        remainingSlotKeys: Set<String>,
        suppressions: List<Suppression>,
        activeSlotKeysOfKind: Set<String?>,
        activatedToday: Int,
        sensitivity: Sensitivity,
        at: Instant,
    ): Verdict = when {
        // 남은 일정에 닿지 않으면 알릴 이유가 없다. 날짜 전체 신호(slotKey=null)는 남은 슬롯이 하나라도 있어야 유효하다.
        slotKey != null && slotKey !in remainingSlotKeys -> Verdict.NOT_AFFECTING
        slotKey == null && remainingSlotKeys.isEmpty() -> Verdict.NOT_AFFECTING

        // 같은 사유·같은 슬롯이 이미 떠 있으면 다시 알리지 않는다 — 배너만 둘로 늘 뿐 새 정보가 없다.
        slotKey in activeSlotKeysOfKind -> Verdict.SUPPRESSED

        // 사용자가 끈 조합이면 더 말하지 않는다. 만료된 억제는 없는 것과 같다.
        suppressions.any { it.isEffectiveAt(at) && it.covers(kind, slotKey) } -> Verdict.SUPPRESSED

        activatedToday >= sensitivity.dailyCap -> Verdict.DAILY_CAP

        else -> Verdict.RAISE
    }
}
