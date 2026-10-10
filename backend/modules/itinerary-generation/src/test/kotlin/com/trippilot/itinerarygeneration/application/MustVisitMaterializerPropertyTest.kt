package com.trippilot.itinerarygeneration.application

import com.trippilot.itinerarygeneration.domain.FixedBlock
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import io.kotest.property.Arb
import io.kotest.property.arbitrary.int
import io.kotest.property.arbitrary.list
import io.kotest.property.arbitrary.map
import io.kotest.property.arbitrary.orNull
import io.kotest.property.checkAll
import java.time.LocalDate
import java.time.LocalTime
import java.util.UUID

/**
 * 물질화 불변식(TRIP-1001 AC → TRIP-1249 개정): **어떤 must_visit 조합이 와도** 물질화된 블록은 맡은 일자 안의
 * 날짜를 갖고 시각은 비어 있으며(`start == null` — 시각은 조립 몫), **한 날의 체류 합은 일과 창을 넘지 않는다.**
 * 창 밖 블록 하나가 HC4 를 깨 그 날 전체를 "해 없음"으로 만드는 것이 QA #045 였다 — 시각을 안 정해도 하루에
 * 안 들어가는 양을 보내면 같은 모양이 된다. 창을 넘겨야 하는 조합은 배치 대신 미배치 보고(M2)로 나가야 한다.
 */
class MustVisitMaterializerPropertyTest : StringSpec({

    val d1 = LocalDate.parse("2026-08-01")
    val dayStart = LocalTime.of(9, 0)
    val dayEnd = LocalTime.of(21, 0)
    val windowMin = 12 * 60

    val anytimeArb = Arb.int(15..600).orNull(0.3).map { dwell -> FixedBlock(UUID.randomUUID(), null, null, dwell) }

    "물질화된 모든 블록은 맡은 날짜·빈 시각이고, 하루 체류 합은 창 안이며, 넘치는 것은 전부 미배치로 보고된다" {
        checkAll(Arb.list(anytimeArb, 0..12), Arb.int(1..3)) { anytime, dayCount ->
            val dates = (0 until dayCount).map { d1.plusDays(it.toLong()) }
            val result = MustVisitMaterializer.materialize(
                dated = emptyList(), anytime = anytime, dates = dates, window = { dayStart to dayEnd },
            )
            result.fixedBlocks.forEach { b ->
                (b.date in dates) shouldBe true
                b.start shouldBe null // 시각은 조립이 고른다(TRIP-1249)
            }
            result.fixedBlocks.groupBy { it.date }.values.forEach { sameDay ->
                (sameDay.sumOf { it.dwellMin ?: 60 } <= windowMin) shouldBe true
            }
            // 들어온 것은 배치 아니면 보고, 둘 중 하나다 — 조용히 사라지는 블록이 없다(INV-4).
            result.fixedBlocks.size + result.unplaced.size shouldBe anytime.size
        }
    }
})
