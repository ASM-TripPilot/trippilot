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
 * 물질화 불변식(TRIP-1001 AC): **어떤 must_visit 조합이 와도** 물질화된 블록 [start, start+dwell] 은
 * 일과 창 안이다. 창 밖 블록 하나가 HC4 를 깨 그 날 전체를 "해 없음"으로 만드는 것이 QA #045 였다 —
 * 물질화가 그 모양을 만들지 않음을 임의 입력으로 잠근다. 창을 넘겨야 하는 조합은 배치 대신
 * 미배치 보고(M2)로 나가야 한다.
 */
class MustVisitMaterializerPropertyTest : StringSpec({

    val d1 = LocalDate.parse("2026-08-01")
    val dayStart = LocalTime.of(9, 0)
    val dayEnd = LocalTime.of(21, 0)

    val anytimeArb = Arb.int(15..600).orNull(0.3).map { dwell -> FixedBlock(UUID.randomUUID(), null, null, dwell) }

    "물질화된 모든 블록은 일과 창 안이고, 넘치는 것은 전부 미배치로 보고된다" {
        checkAll(Arb.list(anytimeArb, 0..12), Arb.int(1..3)) { anytime, dayCount ->
            val dates = (0 until dayCount).map { d1.plusDays(it.toLong()) }
            val result = MustVisitMaterializer.materialize(
                dated = emptyList(), anytime = anytime, dates = dates, dayStart = dayStart, dayEnd = dayEnd,
            )
            result.fixedBlocks.forEach { b ->
                val end = b.start!!.plusMinutes((b.dwellMin ?: 60).toLong())
                (b.start!! >= dayStart) shouldBe true
                (end <= dayEnd && end > b.start) shouldBe true // 창 안 + 자정 감김 없음
                (b.poiId in result.materializedPoiIds) shouldBe true // 시각은 우리가 골랐다 — 표시 판정의 재료(TRIP-1001)
            }
            // 들어온 것은 배치 아니면 보고, 둘 중 하나다 — 조용히 사라지는 블록이 없다(INV-4).
            result.fixedBlocks.size + result.unplaced.size shouldBe anytime.size
        }
    }
})
