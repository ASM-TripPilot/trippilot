package com.trippilot.itinerarygeneration.application

import com.trippilot.itinerarygeneration.domain.FixedBlock
import com.trippilot.itinerarygeneration.domain.UnplacedReason
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldContainExactly
import io.kotest.matchers.shouldBe
import io.kotest.property.Arb
import io.kotest.property.arbitrary.int
import io.kotest.property.arbitrary.list
import io.kotest.property.checkAll
import java.time.LocalDate
import java.time.LocalTime
import java.util.UUID

/**
 * ANYTIME 물질화(계약 M1 · TRIP-1249 개정: **날짜만** 정하고 시각은 비운다).
 *
 * 지키려는 것:
 * - **날짜 없는 블록을 내보내지 않는다** — 솔버는 고정 블록을 날짜로 필터링하므로 담을 자리가 없다.
 * - **시각은 정하지 않는다(`start = null`)** — 09:00 에 못 박으면 그 시각에 닫힌 식당 하나가 조립을 409 로
 *   죽여 그 날이 통째로 최소 폴백이 됐다. 영업시간·식사 시간대는 조립이 안다.
 * - **하루에 몰지 않는다** — 솔버가 날짜를 다시 고르지 못하므로, 몰리면 일과 창(HC4)을 넘겨 생성이 실패한다.
 * - **사용자가 고정한 블록은 건드리지 않는다.**
 * - 넣을 날이 없으면 **버리지 않고 보고한다**.
 */
class MustVisitMaterializerTest : StringSpec({

    val d1 = LocalDate.parse("2026-08-10")
    val d2 = LocalDate.parse("2026-08-11")
    val d3 = LocalDate.parse("2026-08-12")
    val open = LocalTime.parse("09:00")
    val close = LocalTime.parse("21:00")

    fun anytime(dwell: Int? = null) = FixedBlock(UUID.randomUUID(), null, null, dwell)
    fun dated(date: LocalDate, start: String, dwell: Int? = null) =
        FixedBlock(UUID.randomUUID(), date, LocalTime.parse(start), dwell)

    "ANYTIME 은 날짜만 채우고 시각은 비워 나간다 — 시각은 영업시간을 아는 조립이 고른다(TRIP-1249)" {
        val block = anytime(dwell = 45)
        val result = MustVisitMaterializer.materialize(emptyList(), listOf(block), listOf(d1)) { open to close }

        result.fixedBlocks.single() shouldBe FixedBlock(block.poiId, d1, null, 45)
        result.unplaced shouldBe emptyList()
    }

    "여러 건은 일자에 고르게 편다 — 하루에 몰면 일과 창을 넘겨 생성이 실패한다" {
        val result = MustVisitMaterializer.materialize(
            dated = emptyList(),
            anytime = listOf(anytime(), anytime(), anytime()),
            dates = listOf(d1, d2, d3),
            window = { open to close },
        )
        result.fixedBlocks.map { it.date } shouldContainExactly listOf(d1, d2, d3)
    }

    "이미 붐비는 날은 피한다 — 사용자가 고정한 블록이 먼저 센다" {
        val result = MustVisitMaterializer.materialize(
            dated = listOf(dated(d1, "10:00"), dated(d1, "14:00")), // d1 은 2건
            anytime = listOf(anytime()),
            dates = listOf(d1, d2),
            window = { open to close },
        )
        result.fixedBlocks.single { it.start == null }.date shouldBe d2 // 한산한 d2 로 간다
    }

    "사용자가 고정한 블록은 그대로 통과한다" {
        val fixed = dated(d1, "12:00", dwell = 90)
        val result = MustVisitMaterializer.materialize(listOf(fixed), listOf(anytime()), listOf(d1)) { open to close }
        result.fixedBlocks.first() shouldBe fixed // 손대지 않는다
        result.fixedBlocks.last().start shouldBe null // 물질화된 쪽만 시각이 비어 있다
    }

    "그 날 체류 합이 일과 창을 넘기면 넣지 않고 보고한다 — 시각은 조립이 고르지만 안 들어가는 양은 조립도 못 푼다" {
        val result = MustVisitMaterializer.materialize(
            dated = listOf(dated(d1, "09:00", dwell = 60 * 11)), // 11시간 점유
            anytime = listOf(anytime(dwell = 120)),              // 11h + 2h > 12h 창
            dates = listOf(d1),
            window = { open to close },
        )
        result.fixedBlocks.size shouldBe 1 // 고정 블록만 나간다
        result.unplaced.single().reasonCode shouldBe UnplacedReason.NO_FEASIBLE_SLOT
    }

    "상한은 그 날 창으로 센다 — 좁은 날(마지막날 10시 귀가)은 한산해도 안 들어가면 넓은 날로 간다(V2.62)" {
        val result = MustVisitMaterializer.materialize(
            dated = listOf(dated(d1, "10:00")), // d1 은 1건, d2 는 0건(개수로는 d2 가 한산)
            anytime = listOf(anytime(dwell = 90)),
            dates = listOf(d1, d2),
            window = { d -> if (d == d2) open to LocalTime.parse("10:00") else open to close }, // d2 창은 60분
        )
        // 창을 하나로 접으면 틀린다 — min(60분)이면 미배치, max(12시간)면 d2. 날마다 세야 d1 이다.
        result.fixedBlocks.single { it.start == null }.date shouldBe d1
        result.unplaced shouldBe emptyList()
    }

    "맡은 일자가 없으면 전부 보고한다" {
        val result = MustVisitMaterializer.materialize(emptyList(), listOf(anytime(), anytime()), emptyList()) { open to close }
        result.fixedBlocks shouldBe emptyList()
        result.unplaced.size shouldBe 2
    }

    "같은 입력이면 같은 결과 — '왜 이 날짜인가'를 되짚을 수 있어야 한다" {
        val poi = UUID.randomUUID()
        fun run() = MustVisitMaterializer.materialize(
            emptyList(), listOf(FixedBlock(poi, null, null, null), FixedBlock(poi, null, null, null)),
            listOf(d1, d2),
        ) { open to close }.fixedBlocks.map { it.date }

        run() shouldBe run()
    }

    // ── 속성 ───────────────────────────────────────────────────────────────
    "어떤 조합에서도 날짜 없는 블록을 내보내지 않고, 시각은 비운다" {
        checkAll(Arb.list(Arb.int(30..180), 0..8), Arb.int(0..3)) { dwells, dayCount ->
            val dates = listOf(d1, d2, d3).take(dayCount)
            val result = MustVisitMaterializer.materialize(
                dated = emptyList(),
                anytime = dwells.map { anytime(it) },
                dates = dates,
                window = { open to close },
            )
            result.fixedBlocks.all { it.date in dates && it.start == null } shouldBe true
            // 넣은 것 + 보고한 것 = 받은 것. 조용히 사라지는 건이 없다.
            (result.fixedBlocks.size + result.unplaced.size) shouldBe dwells.size
        }
    }
})
