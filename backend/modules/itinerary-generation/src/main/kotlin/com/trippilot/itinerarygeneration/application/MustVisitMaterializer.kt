package com.trippilot.itinerarygeneration.application

import com.trippilot.itinerarygeneration.domain.FixedBlock
import com.trippilot.itinerarygeneration.domain.UnplacedMustVisit
import com.trippilot.itinerarygeneration.domain.UnplacedReason
import java.time.LocalDate
import java.time.LocalTime
import java.time.temporal.ChronoUnit

/**
 * 날짜·시각 미지정(ANYTIME) 필수 방문지의 **물질화**(계약 M1) — **날짜만** 정한다.
 *
 * 왜 날짜는 우리 몫인가: AI 쪽 솔버 3종 모두 고정 블록을 날짜로 필터링하므로(`window.start.date() == day`)
 * 날짜 없는 블록은 담을 자리가 없고, 우리가 넣은 날짜가 곧 최종이다. 하루에 몰면 일과 창(HC4)을 넘겨
 * 그 날 생성이 실패한다 — 그래서 **일자에 고르게 펴는 것**이 이 클래스의 일이다.
 *
 * 왜 시각은 더 이상 우리 몫이 아닌가(TRIP-1249): AI 계약이 `fixed_blocks[].start = null` 을
 * "그 날 반드시 가되 시각은 조립이 고른다"로 받는다. 종전엔 09:00 부터 이른 빈 구간에 못 박았는데,
 * 조립은 고정 시각을 영업시간으로 검증하므로 그 시각에 닫힌 식당 하나가 409 가 되어 그 날이 통째로
 * 최소 폴백이 됐다(2026-10-05 로컬 재현). 영업시간·식사 시간대는 조립이 알고 우리는 모른다.
 *
 * 넣을 날이 없으면 **보내지 않고 [UnplacedMustVisit] 로 보고한다** — AI 가 거부할 모양을 보내
 * 요청 전체를 죽이느니, 못 넣었다는 사실을 사용자에게 알리는 편이 낫다(계약 M2 채널 재사용).
 *
 * ⚠ 배포 순서: `start` 를 필수로 아는 구형 AI 는 null 을 422 로 거부해 그 호출이 통째로 최소 폴백이 된다 —
 * **AI 를 먼저 배포**한다.
 */
internal object MustVisitMaterializer {

    /**
     * 물질화된 블록은 `start == null` 그 자체로 구별된다 — 화면 "변경 불가"(isFixed)는 사용자 고정에만 붙어야
     * 하는데(TRIP-1001), 시각이 있는 블록은 사용자가 고정한 것뿐이므로 따로 집합을 나를 필요가 없다.
     */
    data class Result(val fixedBlocks: List<FixedBlock>, val unplaced: List<UnplacedMustVisit>)

    /**
     * @param dated 이미 날짜·시각이 정해진 블록(사용자가 고정한 것) — **건드리지 않는다**.
     * @param anytime 날짜·시각이 없는 블록(POI id 와 체류 시간만).
     * @param dates 이 호출이 맡은 일자.
     * @param window 그 날의 일과 창(시작, 끝) — 그 길이가 하루 체류 합의 상한이다. **날짜마다 다를 수 있다**
     *   (여행이 첫날 도착·마지막날 출발 시각을 정할 수 있다, V2.62). 하나로 접으면 한 날의 제약이
     *   다른 날까지 좁혀 빈 날에도 "넣을 자리가 없습니다"가 나간다.
     */
    fun materialize(
        dated: List<FixedBlock>,
        anytime: List<FixedBlock>,
        dates: List<LocalDate>,
        window: (LocalDate) -> Pair<LocalTime, LocalTime>,
    ): Result {
        if (anytime.isEmpty()) return Result(dated, emptyList())
        if (dates.isEmpty()) {
            // 맡은 일자가 없으면 넣을 곳이 없다 — 조용히 버리지 않고 보고한다.
            return Result(dated, anytime.map { UnplacedMustVisit(it.poiId, UnplacedReason.NO_FEASIBLE_SLOT) })
        }

        // 날짜별 상한 = 그 날 창의 길이(분). 창이 날마다 다를 수 있어 날짜마다 센다.
        val capacityMin: Map<LocalDate, Long> = dates.associateWith { d ->
            val (start, end) = window(d)
            ChronoUnit.MINUTES.between(start, end)
        }
        // 날짜별 적재(그 날 블록들의 체류 시간). 사용자가 고정한 블록이 먼저 자리를 차지한다.
        val load: Map<LocalDate, MutableList<Int>> = dates.associateWith { mutableListOf<Int>() }
        dated.forEach { b -> b.date?.let { load[it]?.add(dwellOf(b)) } }

        val placed = mutableListOf<FixedBlock>()
        val unplaced = mutableListOf<UnplacedMustVisit>()
        // 입력 순서대로 처리한다 — 같은 입력이면 같은 결과여야 "왜 이 날짜인가"를 되짚을 수 있다.
        anytime.forEach { block ->
            val dwell = dwellOf(block)
            val day = pickDay(dates, load, dwell, capacityMin)
            if (day == null) {
                unplaced += UnplacedMustVisit(block.poiId, UnplacedReason.NO_FEASIBLE_SLOT)
                return@forEach
            }
            load.getValue(day).add(dwell)
            placed += FixedBlock(block.poiId, day, start = null, dwellMin = block.dwellMin)
        }
        return Result(dated + placed, unplaced)
    }

    /**
     * 어느 날에 넣을까 — **가장 한산한 날**(블록 수가 적은 날). 같으면 이른 날짜.
     * 체류 합이 **그 날** 일과 창을 넘길 날은 뺀다 — 시각은 조립이 고르지만 하루에 안 들어가는 양은 조립도 못 푼다(HC4).
     *
     * 개수로 고르는 이유: 하루에 몰리는 것을 막는 게 목적이고, 남은 시간 길이로 고르면
     * 긴 공백이 있는 하루에 계속 쌓여 같은 문제가 난다.
     */
    private fun pickDay(
        dates: List<LocalDate>,
        load: Map<LocalDate, List<Int>>,
        dwell: Int,
        capacityMin: Map<LocalDate, Long>,
    ): LocalDate? = dates
        .filter { load.getValue(it).sum() + dwell <= capacityMin.getValue(it) }
        .minWithOrNull(compareBy({ load.getValue(it).size }, { it }))

    /** 체류 시간 기본값 — AI 쪽 기본과 같은 60분. 없으면 서로 다른 길이로 계산해 적재 판정이 어긋난다. */
    private fun dwellOf(block: FixedBlock): Int = block.dwellMin ?: DEFAULT_DWELL_MIN

    private const val DEFAULT_DWELL_MIN = 60
}
