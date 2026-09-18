package com.trippilot.recalculation.domain

import java.time.Duration
import java.time.LocalTime

/**
 * 전후 비교(BR-U4-29) — 확정 화면이 "무엇이 어떻게 달라지는가"를 보여주기 위한 계산.
 *
 * 순수 함수로 둔 이유: 이 계산은 **확정 전 판단 재료**라 저장·외부 호출과 무관해야 하고,
 * 잘못되면 사용자가 잘못된 근거로 확정한다. 그래서 입력만으로 결과가 정해져야 검증할 수 있다.
 *
 * **INV-3**: 소요시간은 계산하지도 표시하지도 않는다. 거리(m)와 시각만 다룬다.
 */
object ReplanDiff {

    /**
     * 비교 대상 슬롯. 재계획으로 슬롯 행이 갈리므로 **경계 키**로 짝을 맞춘다(BR-U2-04).
     *
     * @param endsNextDay 자정을 넘기는 슬롯(HC4). true 면 [endAt] 이 [startAt] 보다 **이르다** —
     *   이 값을 빼고 시각만 비교하면 새벽 종료가 하루 중 가장 이른 시각으로 취급돼 복귀 시각이 뒤집힌다.
     * @param distanceM 직전 지점에서 이 슬롯까지의 거리. **모르면 null** — 0 으로 채우지 않는다.
     *   0 은 "붙어 있다"는 사실이고 null 은 "모른다"라, 섞으면 영향 지표가 거짓이 된다.
     */
    data class SlotView(
        val slotKey: String,
        val startAt: LocalTime,
        val endAt: LocalTime,
        val isFixed: Boolean,
        val endsNextDay: Boolean = false,
        val distanceM: Int? = null,
    )

    enum class Change {
        /** 새로 들어왔다. */
        ADDED,

        /** 빠졌다 — 제외·이월은 확정 전에 명시해야 한다(BR-U4-25). */
        REMOVED,

        /** 그대로 있으나 시각이 달라졌다. */
        MOVED,

        /** 고정이라 손대지 않았다(BR-U4-18) — 사용자가 "안 바뀐 것"을 확인할 수 있어야 한다. */
        FIXED,

        /** 바뀐 게 없다. */
        UNCHANGED,
    }

    data class Entry(
        val slotKey: String,
        val change: Change,
        val beforeStart: LocalTime?,
        val afterStart: LocalTime?,
    )

    /**
     * 영향 지표 3종(BR-U4-29).
     *
     * @param totalDistanceDeltaM 총 이동 거리 변화. 어느 한쪽이라도 거리를 모르면 **null** 이다 —
     *   모르는 값을 0 으로 보고 합치면 "거리가 줄었다"는 거짓 요약이 나온다.
     * @param returnTimeDelta 숙소 복귀(마지막 일정 종료) 시각 변화. 슬롯이 하나도 없으면 null.
     */
    data class Impact(
        val visitCountDelta: Int,
        val returnTimeDelta: Duration?,
        val totalDistanceDeltaM: Int?,
    )

    data class Result(val entries: List<Entry>, val impact: Impact)

    fun of(before: List<SlotView>, after: List<SlotView>): Result {
        val beforeByKey = before.associateBy { it.slotKey }
        val afterByKey = after.associateBy { it.slotKey }

        val entries = buildList {
            // 표시 순서는 **바뀐 뒤 일정**을 따른다 — 사용자가 보게 될 순서가 그것이기 때문이다.
            after.forEach { a ->
                val b = beforeByKey[a.slotKey]
                val change = when {
                    b == null -> Change.ADDED
                    a.isFixed -> Change.FIXED // 고정은 시각이 같아야 정상이며, 달라도 고정으로 표시해 눈에 띄게 한다
                    // 자정 넘김 여부도 시각의 일부다 — 00:30 오늘과 00:30 익일은 다른 시점이다.
                    b.startAt != a.startAt || b.endAt != a.endAt || b.endsNextDay != a.endsNextDay -> Change.MOVED
                    else -> Change.UNCHANGED
                }
                add(Entry(a.slotKey, change, b?.startAt, a.startAt))
            }
            // 빠진 것은 뒤에 모아 보여준다 — 조용히 사라지면 안 된다(BR-U4-25).
            before.filterNot { it.slotKey in afterByKey }
                .forEach { add(Entry(it.slotKey, Change.REMOVED, it.startAt, null)) }
        }

        return Result(entries, impact(before, after))
    }

    private fun impact(before: List<SlotView>, after: List<SlotView>) = Impact(
        visitCountDelta = after.size - before.size,
        returnTimeDelta = returnDelta(before, after),
        totalDistanceDeltaM = distanceDelta(before, after),
    )

    /**
     * 마지막 일정 종료 시각의 변화. 한쪽이 비어 있으면 비교할 대상이 없다.
     *
     * **하루 시작부터의 경과로 재고 `LocalTime` 으로 재지 않는다.** 자정을 넘긴 슬롯은 `endAt` 이
     * 새벽 시각이라, 시각으로 최대를 고르면 22시에 끝나는 슬롯이 "마지막"으로 뽑힌다. 실측으로
     * 5시간 30분 당겨진 재계획이 8시간 늦어진 것으로 나왔다 — 부호까지 뒤집힌 값이 확정 화면에 나간다.
     */
    private fun returnDelta(before: List<SlotView>, after: List<SlotView>): Duration? {
        val b = before.maxOfOrNull { it.endOffset() } ?: return null
        val a = after.maxOfOrNull { it.endOffset() } ?: return null
        return a - b
    }

    /** 그 날 0시부터 종료까지의 경과. 자정을 넘겼으면 하루를 더한다(HC4). */
    private fun SlotView.endOffset(): Duration =
        Duration.ofSeconds(endAt.toSecondOfDay().toLong()) + if (endsNextDay) Duration.ofDays(1) else Duration.ZERO

    /**
     * 총 이동 거리의 변화. **어느 한쪽이라도 모르는 거리가 있으면 null** 이다.
     * 모르는 값을 0 으로 보고 합치면 "거리가 줄었다"는 거짓 요약이 나온다.
     */
    private fun distanceDelta(before: List<SlotView>, after: List<SlotView>): Int? {
        val b = before.sumOrNull() ?: return null
        val a = after.sumOrNull() ?: return null
        return a - b
    }

    private fun List<SlotView>.sumOrNull(): Int? =
        if (any { it.distanceM == null }) null else sumOf { it.distanceM!! }
}
