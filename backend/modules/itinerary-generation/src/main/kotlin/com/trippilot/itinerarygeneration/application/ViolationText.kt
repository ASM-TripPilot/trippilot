package com.trippilot.itinerarygeneration.application

import com.trippilot.itinerarygeneration.domain.ItineraryDay
import com.trippilot.itinerarygeneration.domain.Violation
import org.slf4j.LoggerFactory

/**
 * 위반 → 슬롯 표시 문구. 편집·되돌리기가 같은 규칙을 쓰도록 한 곳에 둔다.
 *
 * **슬롯에 못 붙는 위반을 조용히 버리지 않는다.** AI 는 위치를 계산하지 못하면 인덱스를 비워 보내는데
 * (예: 필수 방문지가 아예 배치되지 않은 HC3 위반 — 붙일 슬롯이 없어서 위반이다), 그걸 버리면
 * "문제 없음"이라는 거짓 음성이 사용자 확정까지 흘러간다(INV-4).
 */
object ViolationText {

    fun reasonOf(hits: List<Violation>): String? =
        BoundedText.clamp(
            hits.mapNotNull { it.detail }.distinct().joinToString(" · ").ifBlank { null },
            BoundedText.VIOLATION_REASON_MAX,
        )

    /**
     * 어느 슬롯에도 붙지 못한 위반을 드러낸다. 슬롯 단위 표시가 불가능한 종류라 화면에 못 싣는 대신,
     * 최소한 운영에서는 보이게 한다. (사용자 표면 노출은 별도 계약이 필요하다.)
     *
     * **위반 수를 세지 슬롯 수를 세지 않는다** — 한 슬롯에 위반이 여러 건 붙으면 슬롯 수로는 모자라 보여
     * 없는 문제를 경고하게 된다.
     */
    fun warnUnattached(violations: List<Violation>, days: List<ItineraryDay>, tripId: java.util.UUID) {
        val unlocatable = countUnlocatable(violations)
        val dropped = countOutOfRange(violations, days)
        if (unlocatable > 0) {
            log.warn(
                "슬롯에 붙지 못한 위반 {}건 — 위치를 알 수 없어 화면에 표시되지 않습니다. tripId={}, 종류={}",
                unlocatable, tripId, violations.filter { it.dayIndex == null }.map { it.type }.distinct(),
            )
        }
        if (dropped > 0) {
            // 인덱스는 있는데 그 자리에 슬롯이 없다 = 검증 시점과 저장 대상이 어긋났다.
            log.warn("범위를 벗어난 위반 {}건 — 검증 대상과 저장 대상이 어긋났습니다. tripId={}", dropped, tripId)
        }
    }

    /** 위치를 아예 모르는 위반 — 붙일 슬롯이 없어서 위반인 종류(예: 필수 방문지 미배치). */
    fun countUnlocatable(violations: List<Violation>): Int =
        violations.count { it.dayIndex == null || it.slotIndex == null }

    /** 인덱스는 있는데 그 자리에 슬롯이 없는 위반 — 검증 대상과 저장 대상이 어긋났다는 신호. */
    fun countOutOfRange(violations: List<Violation>, days: List<ItineraryDay>): Int =
        violations.count { v ->
            val d = v.dayIndex ?: return@count false
            val s = v.slotIndex ?: return@count false
            days.getOrNull(d)?.slots?.getOrNull(s) == null
        }

    private val log = LoggerFactory.getLogger(ViolationText::class.java)
}
