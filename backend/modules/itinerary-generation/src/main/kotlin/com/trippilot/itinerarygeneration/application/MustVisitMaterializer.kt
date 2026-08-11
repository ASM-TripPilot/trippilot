package com.trippilot.itinerarygeneration.application

import com.trippilot.itinerarygeneration.domain.FixedBlock
import com.trippilot.itinerarygeneration.domain.UnplacedMustVisit
import com.trippilot.itinerarygeneration.domain.UnplacedReason
import java.time.LocalDate
import java.time.LocalTime
import java.util.UUID

/**
 * 날짜·시각 미지정(ANYTIME) 필수 방문지의 **물질화**(계약 M1).
 *
 * 왜 백엔드가 하나: AI 의 고정 블록은 시간창이 **필수**라 "아무 때나"를 담을 자리가 없다.
 * 그래서 계약이 "AI 는 날짜·시각이 확정된 고정 블록만 받는다"로 확정됐고, 정하는 일이 우리 몫이 됐다.
 *
 * 왜 이렇게 정하나 — **솔버가 날짜를 다시 고르지 못한다.** AI 쪽 솔버 3종 모두 고정 블록을
 * `window.start.date() == day` 로 필터링하므로, 우리가 넣은 날짜가 곧 최종이다.
 * 하루에 몰면 일과 창(HC4)을 넘겨 체인 전 단계가 무효가 되고 **생성 자체가 실패**한다.
 * 그래서 **일자에 고르게 펴는 것**이 이 클래스의 핵심이다.
 *
 * 넣을 자리가 없으면 **보내지 않고 [UnplacedMustVisit] 로 보고한다** — AI 가 거부할 모양을 보내
 * 요청 전체를 죽이느니, 못 넣었다는 사실을 사용자에게 알리는 편이 낫다(계약 M2 채널 재사용).
 *
 * ⚠ 배분 정책은 **1라운드 통합테스트 관측치 이전에 정한 것**이다(계약 M1 은 관측 후 설계를 예고했다).
 * 관측 뒤 바뀔 수 있으며, 바뀌는 지점은 [pickDay]·[pickStart] 두 곳으로 좁혀 두었다.
 */
internal object MustVisitMaterializer {

    data class Result(val fixedBlocks: List<FixedBlock>, val unplaced: List<UnplacedMustVisit>)

    /**
     * @param dated 이미 날짜·시각이 정해진 블록(사용자가 고정한 것) — **건드리지 않는다**.
     * @param anytime 날짜·시각이 없는 블록(POI id 와 체류 시간만).
     * @param dates 이 호출이 맡은 일자.
     * @param dayStart·dayEnd 일과 창(기본 09:00~21:00) — 이 밖에는 넣지 않는다.
     */
    fun materialize(
        dated: List<FixedBlock>,
        anytime: List<FixedBlock>,
        dates: List<LocalDate>,
        dayStart: LocalTime,
        dayEnd: LocalTime,
    ): Result {
        if (anytime.isEmpty()) return Result(dated, emptyList())
        if (dates.isEmpty()) {
            // 맡은 일자가 없으면 넣을 곳이 없다 — 조용히 버리지 않고 보고한다.
            return Result(dated, anytime.map { UnplacedMustVisit(it.poiId, UnplacedReason.NO_FEASIBLE_SLOT) })
        }

        // 날짜별 점유 구간. 사용자가 고정한 블록이 먼저 자리를 차지한다.
        val occupied: MutableMap<LocalDate, MutableList<Slot>> = dates.associateWith { mutableListOf<Slot>() }.toMutableMap()
        dated.forEach { b ->
            val d = b.date ?: return@forEach
            val s = b.start ?: return@forEach
            occupied[d]?.add(Slot(s, s.plusMinutes(dwellOf(b).toLong())))
        }

        val placed = mutableListOf<FixedBlock>()
        val unplaced = mutableListOf<UnplacedMustVisit>()
        // 입력 순서대로 처리한다 — 같은 입력이면 같은 결과여야 "왜 이 날짜인가"를 되짚을 수 있다.
        anytime.forEach { block ->
            val dwell = dwellOf(block)
            val day = pickDay(dates, occupied, dwell, dayStart, dayEnd)
            if (day == null) {
                unplaced += UnplacedMustVisit(block.poiId, UnplacedReason.NO_FEASIBLE_SLOT)
                return@forEach
            }
            val start = pickStart(occupied.getValue(day), dwell, dayStart, dayEnd)!!
            occupied.getValue(day).add(Slot(start, start.plusMinutes(dwell.toLong())))
            placed += FixedBlock(block.poiId, day, start, block.dwellMin)
        }
        return Result(dated + placed, unplaced)
    }

    /**
     * 어느 날에 넣을까 — **가장 한산한 날**(점유 블록이 적은 날). 같으면 이른 날짜.
     *
     * 개수로 고르는 이유: 하루에 몰리는 것을 막는 게 목적이고, 남은 시간 길이로 고르면
     * 긴 공백이 있는 하루에 계속 쌓여 같은 문제가 난다.
     */
    private fun pickDay(
        dates: List<LocalDate>,
        occupied: Map<LocalDate, List<Slot>>,
        dwell: Int,
        dayStart: LocalTime,
        dayEnd: LocalTime,
    ): LocalDate? = dates
        .filter { pickStart(occupied.getValue(it), dwell, dayStart, dayEnd) != null }
        .minWithOrNull(compareBy({ occupied.getValue(it).size }, { it }))

    /**
     * 그 날 어느 시각에 넣을까 — **가장 이른 빈 구간**. 없으면 null.
     *
     * 이른 쪽부터 채우는 이유: 일과 창 끝에 몰면 마지막 방문이 창을 넘길 위험이 커지고,
     * 사용자가 보기에도 앞에서부터 차는 편이 자연스럽다.
     */
    private fun pickStart(taken: List<Slot>, dwell: Int, dayStart: LocalTime, dayEnd: LocalTime): LocalTime? {
        var candidate = dayStart
        // 시작 시각 순으로 훑으며 겹치면 그 블록 뒤로 민다.
        taken.sortedBy { it.start }.forEach { slot ->
            val end = candidate.plusMinutes(dwell.toLong())
            if (candidate < slot.end && slot.start < end) candidate = slot.end
        }
        return candidate.takeIf { !it.plusMinutes(dwell.toLong()).isAfter(dayEnd) }
    }

    /** 체류 시간 기본값 — AI 쪽 기본과 같은 60분. 없으면 서로 다른 길이로 계산해 겹침 판정이 어긋난다. */
    private fun dwellOf(block: FixedBlock): Int = block.dwellMin ?: DEFAULT_DWELL_MIN

    private data class Slot(val start: LocalTime, val end: LocalTime)

    private const val DEFAULT_DWELL_MIN = 60
}
