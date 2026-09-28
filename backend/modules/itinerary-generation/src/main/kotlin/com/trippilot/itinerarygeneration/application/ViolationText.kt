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

    /**
     * 위반 → **사용자 정성 문구**(TRIP-1030 · 사용자 결정 2026-09-27: INV-3 을 "소요시간 **숫자** 비표시"로
     * 좁히고 정성 문구는 허용). 상대의 detail 은 "이동 54분 필요, 간격 -60분" · "영업시간 밖: 543~618" ·
     * "0요일 휴무" 같은 숫자 소요시간·원시 분값·숫자 요일이라 그대로 내보내면 계약 위반이자 외계어였다
     * (QA #079 #064). **type 만 믿고 문구를 우리가 소유한다** — 상대 detail 문자열 형식에 화면이 결합되지
     * 않게. detail 은 진단용 로그로만 남긴다.
     */
    fun reasonOf(hits: List<Violation>): String? {
        if (hits.isEmpty()) return null
        hits.mapNotNull { it.detail }.takeIf { it.isNotEmpty() }
            ?.let { log.debug("위반 상세(내부 진단용): {}", it) }
        return BoundedText.clamp(
            hits.map { phraseOf(it.type) }.distinct().joinToString(" · "),
            BoundedText.VIOLATION_REASON_MAX,
        )
    }

    /**
     * 닫힌 번역 — AI 어휘(HC1~HC4)와 상징 이름(테스트·수리 경로) 둘 다 받는다. **모르는 type 도
     * 한국어 일반 문구다** — 영문 코드가 화면에 새는 것이 침묵보다 나쁘고, 위반 자체를 숨기면
     * 거짓 음성이다(INV-4).
     */
    private fun phraseOf(type: String): String = when (type.uppercase()) {
        "HC1", "OPENING_HOURS" -> "영업시간과 맞지 않아요"
        "HC2", "TRAVEL_TIME" -> "앞 장소에서 이동할 시간이 빠듯해요"
        "HC3", "MUST_VISIT", "HC3_UNPLACED" -> "꼭 갈 곳이 일정에 들어가지 못했어요"
        "HC4", "DAY_WINDOW" -> "그 날의 일정 시간대를 벗어났어요"
        else -> "일정 조건과 맞지 않아요"
    }

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
