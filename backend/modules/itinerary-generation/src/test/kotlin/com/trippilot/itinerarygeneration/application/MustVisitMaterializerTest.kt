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
 * ANYTIME 물질화(계약 M1).
 *
 * 지키려는 것:
 * - **날짜·시각 없는 블록을 절대 내보내지 않는다** — 그 한 건이 AI 요청 전체를 422 로 죽인다.
 * - **하루에 몰지 않는다** — 솔버가 날짜를 다시 고르지 못하므로, 몰리면 일과 창(HC4)을 넘겨 생성이 실패한다.
 * - **사용자가 고정한 시각은 건드리지 않는다.**
 * - 넣을 자리가 없으면 **버리지 않고 보고한다**.
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

    "ANYTIME 은 날짜·시각이 채워져 나간다 — null 이 하나라도 나가면 요청 전체가 422 다" {
        val result = MustVisitMaterializer.materialize(emptyList(), listOf(anytime()), listOf(d1), open, close)

        result.fixedBlocks.single().date shouldBe d1
        result.fixedBlocks.single().start shouldBe open // 이른 쪽부터 채운다
        result.unplaced shouldBe emptyList()
    }

    "여러 건은 일자에 고르게 편다 — 하루에 몰면 일과 창을 넘겨 생성이 실패한다" {
        val result = MustVisitMaterializer.materialize(
            dated = emptyList(),
            anytime = listOf(anytime(), anytime(), anytime()),
            dates = listOf(d1, d2, d3),
            dayStart = open, dayEnd = close,
        )
        result.fixedBlocks.map { it.date } shouldContainExactly listOf(d1, d2, d3)
    }

    "이미 붐비는 날은 피한다 — 사용자가 고정한 블록이 자리를 먼저 차지한다" {
        val result = MustVisitMaterializer.materialize(
            dated = listOf(dated(d1, "10:00"), dated(d1, "14:00")), // d1 은 2건
            anytime = listOf(anytime()),
            dates = listOf(d1, d2),
            dayStart = open, dayEnd = close,
        )
        result.fixedBlocks.single { it.date == d2 }.date shouldBe d2 // 한산한 d2 로 간다
    }

    "고정 블록과 겹치지 않게 뒤로 민다" {
        val result = MustVisitMaterializer.materialize(
            dated = listOf(dated(d1, "09:00", dwell = 90)), // 09:00~10:30 점유
            anytime = listOf(anytime(dwell = 60)),
            dates = listOf(d1),
            dayStart = open, dayEnd = close,
        )
        result.fixedBlocks.single { it.date != null && it.dwellMin == 60 }.start shouldBe LocalTime.parse("10:30")
    }

    "사용자가 고정한 블록은 그대로 통과한다" {
        val fixed = dated(d1, "12:00", dwell = 90)
        val result = MustVisitMaterializer.materialize(listOf(fixed), emptyList(), listOf(d1), open, close)
        result.fixedBlocks shouldContainExactly listOf(fixed) // 손대지 않는다
    }

    "일과 창을 넘기면 넣지 않고 보고한다 — 버리면 사용자가 이유를 모른다" {
        val result = MustVisitMaterializer.materialize(
            dated = listOf(dated(d1, "09:00", dwell = 60 * 11)), // 09:00~20:00 점유
            anytime = listOf(anytime(dwell = 120)),              // 20:00+2h = 22:00 > 21:00
            dates = listOf(d1),
            dayStart = open, dayEnd = close,
        )
        result.fixedBlocks.none { it.date == null } shouldBe true
        result.unplaced.single().reasonCode shouldBe UnplacedReason.NO_FEASIBLE_SLOT
    }

    "맡은 일자가 없으면 전부 보고한다" {
        val result = MustVisitMaterializer.materialize(emptyList(), listOf(anytime(), anytime()), emptyList(), open, close)
        result.fixedBlocks shouldBe emptyList()
        result.unplaced.size shouldBe 2
    }

    "같은 입력이면 같은 결과 — '왜 이 날짜인가'를 되짚을 수 있어야 한다" {
        val poi = UUID.randomUUID()
        fun run() = MustVisitMaterializer.materialize(
            emptyList(), listOf(FixedBlock(poi, null, null, null), FixedBlock(poi, null, null, null)),
            listOf(d1, d2), open, close,
        ).fixedBlocks.map { it.date to it.start }

        run() shouldBe run()
    }

    // ── 속성 ───────────────────────────────────────────────────────────────
    "어떤 조합에서도 날짜·시각 없는 블록을 내보내지 않는다" {
        checkAll(Arb.list(Arb.int(30..180), 0..8), Arb.int(0..3)) { dwells, dayCount ->
            val dates = listOf(d1, d2, d3).take(dayCount)
            val result = MustVisitMaterializer.materialize(
                dated = emptyList(),
                anytime = dwells.map { anytime(it) },
                dates = dates,
                dayStart = open, dayEnd = close,
            )
            result.fixedBlocks.all { it.date != null && it.start != null } shouldBe true
            // 넣은 것 + 보고한 것 = 받은 것. 조용히 사라지는 건이 없다.
            (result.fixedBlocks.size + result.unplaced.size) shouldBe dwells.size
        }
    }

    "배치된 블록끼리 겹치지 않는다" {
        checkAll(Arb.list(Arb.int(30..120), 0..6)) { dwells ->
            val result = MustVisitMaterializer.materialize(
                emptyList(), dwells.map { anytime(it) }, listOf(d1, d2), open, close,
            )
            result.fixedBlocks.groupBy { it.date }.forEach { (_, sameDay) ->
                val sorted = sameDay.sortedBy { it.start }
                sorted.zipWithNext().forEach { (a, b) ->
                    val aEnd = a.start!!.plusMinutes((a.dwellMin ?: 60).toLong())
                    (aEnd <= b.start!!) shouldBe true
                }
            }
        }
    }

    "일과 창 밖으로 나가지 않는다" {
        checkAll(Arb.list(Arb.int(30..180), 0..6)) { dwells ->
            MustVisitMaterializer.materialize(emptyList(), dwells.map { anytime(it) }, listOf(d1), open, close)
                .fixedBlocks.forEach {
                    (it.start!! >= open) shouldBe true
                    (it.start!!.plusMinutes((it.dwellMin ?: 60).toLong()) <= close) shouldBe true
                }
        }
    }
})
