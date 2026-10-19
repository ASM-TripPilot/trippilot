package com.trippilot.planbdetection.domain

import java.time.Instant
import java.time.LocalDate

/**
 * 판정(LC-U4-1) — 새로 설 대상이 **알릴 자격이 있는지**를 정한다.
 *
 * 클라이언트는 신호만 모으고 **임계·억제는 서버가 안다**(BR-U4-03). 그래서 이 판정이 한곳에 모여 있어야
 * 클라이언트가 자체 판단으로 배너를 띄우는 일이 없다.
 *
 * 같은 대상이 이미 떠 있는지(제자리 갱신)·하루 상한(푸시만 묶는다)·알림 여부는 [TriggerLifecycle] 이 정한다.
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

        /** 사용자가 끈 범위다(BR-U4-15 · 규칙 10). */
        SUPPRESSED(TriggerState.SUPPRESSED),

        /** 남은 일정에 닿지 않는다 — 이미 지났거나 완료된 슬롯만 건드린다(BR-U4-06). */
        NOT_AFFECTING(TriggerState.EXPIRED),
    }

    /**
     * 새로 설 대상의 판정(규칙 9 '판정 통과') — 남은 일정에 닿는가, 사용자가 껐는가.
     * 무영향을 억제보다 먼저 본다 — 닿지도 않는 신호를 '껐다'고 기록하면 사실과 다르다.
     *
     * @param slotKey 신호가 가리키는 슬롯. null 이면 날짜 전체 영향이라 [remainingSlotKeys] 로 거르지 않는다.
     * @param remainingSlotKeys 그 날 아직 끝나지 않은 슬롯. 비어 있으면 남은 일정이 없다는 뜻이다.
     */
    fun verdict(
        kind: TriggerKind,
        slotKey: String?,
        affectedDate: LocalDate,
        severity: TriggerSeverity,
        remainingSlotKeys: Set<String>,
        suppressions: List<Suppression>,
        at: Instant,
    ): Verdict = when {
        slotKey != null && slotKey !in remainingSlotKeys -> Verdict.NOT_AFFECTING
        slotKey == null && remainingSlotKeys.isEmpty() -> Verdict.NOT_AFFECTING
        suppressions.any { it.isEffectiveAt(at) && it.covers(kind, slotKey, affectedDate, severity) } -> Verdict.SUPPRESSED
        else -> Verdict.RAISE
    }
}
