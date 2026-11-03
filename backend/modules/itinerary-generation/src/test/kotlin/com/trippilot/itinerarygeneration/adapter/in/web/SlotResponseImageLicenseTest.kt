package com.trippilot.itinerarygeneration.adapter.`in`.web

import com.trippilot.itinerarygeneration.application.SlotSurfaceAssembler
import com.trippilot.itinerarygeneration.domain.GenerationMode
import com.trippilot.itinerarygeneration.domain.Itinerary
import com.trippilot.itinerarygeneration.domain.ItineraryDay
import com.trippilot.itinerarygeneration.domain.ItineraryStatus
import com.trippilot.itinerarygeneration.domain.SlotAlternative
import com.trippilot.itinerarygeneration.domain.SolveMode
import com.trippilot.itinerarygeneration.domain.VisitSlot
import com.trippilot.placedata.api.FrozenPoiView
import com.trippilot.placedata.api.PoiSurfaceFacade
import com.trippilot.placedata.api.PoiSurfaceView
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.util.UUID

/**
 * 일정 슬롯·차선책 카드가 사진의 공공누리 유형을 **사진과 같은 자리에서** 싣는가(V2.88).
 * 정본 → 표면 합성(SlotSurfaceAssembler) → 응답 DTO 사슬 중 한 칸만 빠뜨려도 예외 없이 null 이 나가고,
 * 앱은 3유형(변경금지) 사진을 계속 잘라 그린다.
 */
class SlotResponseImageLicenseTest : StringSpec({

    val slotPoi = UUID.randomUUID()
    val altPoi = UUID.randomUUID()
    val unknownPoi = UUID.randomUUID()

    fun surface(id: UUID, license: String?) = PoiSurfaceView(
        id, "경복궁", 37.58, 126.97, "명소", "SIGHT", null, "https://tong.visitkorea.or.kr/a.jpg", emptyList(), imageLicense = license,
    )

    val surfaces = object : PoiSurfaceFacade {
        val live = mapOf(slotPoi to surface(slotPoi, "TYPE3"), altPoi to surface(altPoi, "TYPE1"), unknownPoi to surface(unknownPoi, null))
        override fun findSurfaces(poiIds: Collection<UUID>) = live.filterKeys { it in poiIds }
        override fun findFrozenSurfaces(poiSnapshotIds: Collection<UUID>) = emptyMap<UUID, FrozenPoiView>()
    }

    "슬롯과 차선책 카드에 사진 유형이 실리고, 모르면 null 로 나간다" {
        val slot = VisitSlot.of(
            slotPoi, null, 0, LocalTime.parse("10:00"), LocalTime.parse("11:00"),
            alternatives = listOf(SlotAlternative(altPoi, "가까운 궁", "약 1km"), SlotAlternative(unknownPoi, "다른 곳", null)),
        )
        val itinerary = Itinerary.create(
            UUID.randomUUID(), SolveMode.FULL_AI, GenerationMode.FULLY_AI, false,
            listOf(ItineraryDay.of(LocalDate.parse("2026-11-10"), 0, listOf(slot))), Instant.parse("2026-11-02T00:00:00Z"),
        )
        val bySurface = SlotSurfaceAssembler(surfaces).assemble(itinerary)

        val r = SlotResponse.of(slot, bySurface[slotPoi], ItineraryStatus.PLANNED, bySurface)

        r.imageLicense shouldBe "TYPE3"
        r.alternatives.map { it.imageLicense } shouldBe listOf("TYPE1", null)
    }
})
