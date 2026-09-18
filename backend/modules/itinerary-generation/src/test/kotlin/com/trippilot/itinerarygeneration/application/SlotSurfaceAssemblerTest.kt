package com.trippilot.itinerarygeneration.application

import com.trippilot.itinerarygeneration.domain.GenerationMode
import com.trippilot.itinerarygeneration.domain.Itinerary
import com.trippilot.itinerarygeneration.domain.ItineraryDay
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
 * 슬롯 POI 표면 합성(TRIP-307 · BR-U3-09).
 * 핵심은 두 가지 — 확정 슬롯은 **동결값이 이긴다**(INV-U1-03), 표면이 없어도 **슬롯은 사라지지 않는다**.
 */
class SlotSurfaceAssemblerTest : StringSpec({

    val now = Instant.parse("2026-08-06T00:00:00Z")
    val d1 = LocalDate.parse("2026-08-01")
    val poiA = UUID.randomUUID()
    val snapA = UUID.randomUUID()

    fun itinerary(vararg slots: VisitSlot) =
        Itinerary.create(UUID.randomUUID(), SolveMode.FULL_AI, GenerationMode.FULLY_AI, false, listOf(ItineraryDay.of(d1, 0, slots.toList())), now)

    fun slot(poiId: UUID, snapshotId: UUID? = null) =
        VisitSlot.of(poiId, snapshotId, 0, LocalTime.parse("10:00"), LocalTime.parse("11:00"))

    class FakeSurfaces(
        private val live: Map<UUID, PoiSurfaceView> = emptyMap(),
        private val frozen: Map<UUID, FrozenPoiView> = emptyMap(),
    ) : PoiSurfaceFacade {
        var liveCalls = 0
        override fun findSurfaces(poiIds: Collection<UUID>): Map<UUID, PoiSurfaceView> {
            liveCalls++
            return live.filterKeys { it in poiIds }
        }
        override fun findFrozenSurfaces(poiSnapshotIds: Collection<UUID>) = frozen.filterKeys { it in poiSnapshotIds }
    }

    val liveA = PoiSurfaceView(poiA, "성산일출봉", 33.4, 126.9, "ATTRACTION", "09:00-18:00", "https://img/a.jpg", listOf("자연"))

    "정본 표면을 슬롯에 합성한다" {
        val s = SlotSurfaceAssembler(FakeSurfaces(live = mapOf(poiA to liveA))).assemble(itinerary(slot(poiA)))
        s.getValue(poiA).nameKo shouldBe "성산일출봉"
        s.getValue(poiA).lat shouldBe 33.4
        s.getValue(poiA).openingHoursKnown shouldBe true
    }

    "확정 슬롯은 동결값이 이긴다 — 원본이 개명돼도 확정 당시 이름을 보여준다(INV-U1-03)" {
        val renamed = liveA.copy(nameKo = "이름이 바뀐 곳", lat = 0.0)
        val frozen = FrozenPoiView(snapA, poiA, "성산일출봉", 33.4, 126.9, "ATTRACTION")
        val s = SlotSurfaceAssembler(FakeSurfaces(mapOf(poiA to renamed), mapOf(snapA to frozen)))
            .assemble(itinerary(slot(poiA, snapA)))

        s.getValue(poiA).nameKo shouldBe "성산일출봉" // 동결값
        s.getValue(poiA).lat shouldBe 33.4
        // 동결 대상이 아닌 사진·영업시간은 정본에서 best-effort
        s.getValue(poiA).imageUrl shouldBe "https://img/a.jpg"
    }

    "원본이 사라져도 확정 슬롯은 동결값으로 렌더된다" {
        val frozen = FrozenPoiView(snapA, poiA, "성산일출봉", 33.4, 126.9, "ATTRACTION")
        val s = SlotSurfaceAssembler(FakeSurfaces(live = emptyMap(), frozen = mapOf(snapA to frozen)))
            .assemble(itinerary(slot(poiA, snapA)))

        s.getValue(poiA).nameKo shouldBe "성산일출봉"
        s.getValue(poiA).imageUrl shouldBe null       // 동결 안 된 값은 채울 수 없다
        s.getValue(poiA).openingHoursKnown shouldBe false
    }

    "정본에도 동결본에도 없으면 표면만 빠지고 슬롯은 남는다" {
        val s = SlotSurfaceAssembler(FakeSurfaces()).assemble(itinerary(slot(poiA)))
        s[poiA] shouldBe null // 응답에서 표면 필드가 null 로 나가고, 슬롯 자체는 유지된다
    }

    "영업시간 미확인이면 openingHoursKnown=false (US-SCHED-03 확인 후보 분리)" {
        val noHours = liveA.copy(openingHours = null)
        val s = SlotSurfaceAssembler(FakeSurfaces(live = mapOf(poiA to noHours))).assemble(itinerary(slot(poiA)))
        s.getValue(poiA).openingHoursKnown shouldBe false
    }

    "슬롯이 많아도 정본 조회는 한 번 — 슬롯마다 왕복하지 않는다(AC: 추가 왕복 0)" {
        val fake = FakeSurfaces(live = mapOf(poiA to liveA))
        val many = (0 until 5).map { VisitSlot.of(poiA, null, it, LocalTime.parse("10:00"), LocalTime.parse("11:00")) }
        SlotSurfaceAssembler(fake).assemble(itinerary(*many.toTypedArray()))
        fake.liveCalls shouldBe 1
    }

    "빈 일정이면 조회하지 않는다" {
        val fake = FakeSurfaces()
        SlotSurfaceAssembler(fake).assemble(itinerary())
        fake.liveCalls shouldBe 0
    }

    /**
     * **차선책 POI 의 표면도 함께 모은다**(TRIP-851).
     *
     * 화면이 "다른 선택지"를 슬롯 카드와 **같은 카드**로 그리는데, 표면이 없으면 그 카드만
     * "이름 준비 중"으로 남는다 — 같은 화면에서 한쪽만 이름이 보이는 어색한 상태다.
     */
    "차선책 POI 의 표면도 함께 모은다" {
        val altA = UUID.randomUUID()
        val fake = FakeSurfaces(
            live = mapOf(
                poiA to view(poiA, "슬롯장소"),
                altA to view(altA, "차선책장소"),
            ),
        )
        val slot = VisitSlot.of(
            poiA, null, 0, LocalTime.parse("10:00"), LocalTime.parse("11:00"),
            alternatives = listOf(SlotAlternative(altA, "비 오면 여기", null)),
        )

        val out = SlotSurfaceAssembler(fake).assemble(itinerary(slot))

        out[altA]?.nameKo shouldBe "차선책장소"
        out[poiA]?.nameKo shouldBe "슬롯장소"
    }

    /**
     * **한 번에 묻는다.** 카드마다 조회하면 후보 수만큼 왕복이 는다 — 하루 8슬롯 × 차선책 2건이면
     * 24번이다. 조립기가 있는 이유가 그것인데, 차선책을 따로 묻기 시작하면 그 이유가 무너진다.
     */
    "슬롯과 차선책을 한 번의 조회로 묻는다 — 후보 수만큼 왕복이 늘지 않는다" {
        val alts = List(3) { UUID.randomUUID() }
        val fake = FakeSurfaces(live = (listOf(poiA) + alts).associateWith { view(it, "장소") })
        val slot = VisitSlot.of(
            poiA, null, 0, LocalTime.parse("10:00"), LocalTime.parse("11:00"),
            alternatives = alts.map { SlotAlternative(it, "이유", null) },
        )

        SlotSurfaceAssembler(fake).assemble(itinerary(slot))

        fake.liveCalls shouldBe 1
    }

    /** 정본에 없는 차선책은 표면이 없다 — 그래도 **슬롯도 차선책도 사라지지 않는다**(화면이 폴백한다). */
    "정본에 없는 차선책은 표면 없이 지나간다" {
        val ghost = UUID.randomUUID()
        val fake = FakeSurfaces(live = mapOf(poiA to view(poiA, "슬롯장소")))
        val slot = VisitSlot.of(
            poiA, null, 0, LocalTime.parse("10:00"), LocalTime.parse("11:00"),
            alternatives = listOf(SlotAlternative(ghost, "이유", null)),
        )

        val out = SlotSurfaceAssembler(fake).assemble(itinerary(slot))

        out.containsKey(ghost) shouldBe false
        out[poiA]?.nameKo shouldBe "슬롯장소"
    }
})

/** 표면 표본 — 이름 말고는 이 스펙의 관심사가 아니다. */
private fun view(poiId: UUID, nameKo: String) =
    PoiSurfaceView(poiId, nameKo, 33.4, 126.5, "명소", null, null, emptyList())
