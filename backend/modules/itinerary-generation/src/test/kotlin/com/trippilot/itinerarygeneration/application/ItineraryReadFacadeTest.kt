package com.trippilot.itinerarygeneration.application

import com.trippilot.itinerarygeneration.domain.GenerationMode
import com.trippilot.itinerarygeneration.domain.GenerationSession
import com.trippilot.itinerarygeneration.domain.GenerationState
import com.trippilot.itinerarygeneration.domain.Itinerary
import com.trippilot.itinerarygeneration.domain.ItineraryDay
import com.trippilot.itinerarygeneration.domain.ItineraryRepository
import com.trippilot.itinerarygeneration.domain.ScoringSignal
import com.trippilot.placedata.api.FrozenPoiView
import com.trippilot.placedata.api.PoiSurfaceFacade
import com.trippilot.placedata.api.PoiSurfaceView
import com.trippilot.itinerarygeneration.domain.ItineraryStatus
import com.trippilot.itinerarygeneration.domain.SolveMode
import com.trippilot.itinerarygeneration.domain.VisitSlot
import com.trippilot.trip.api.TripFacade
import com.trippilot.trip.api.TripPeriod
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldContainExactly
import io.kotest.matchers.shouldBe
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.util.UUID

/**
 * 일정 조회 퍼사드(C8 공개 계약). **U4 재계획·감지가 이것만 보고 동작한다** —
 * 세션의 `itineraryId`, 감지의 "남은 슬롯" 판정이 전부 여기서 나온다.
 *
 * 소비 측 테스트에서는 이 인터페이스를 스텁으로 대신하므로, **실물이 맞는지는 여기서만 확인된다.**
 * 특히 슬롯을 물리 키가 아니라 **경계 키(`{date}#{poiId}`)** 로 내보내는지가 중요하다 —
 * 재계획으로 슬롯 행이 갈려도 참조가 끊기지 않아야 한다(BR-U2-04).
 */
class ItineraryReadFacadeTest : StringSpec({

    val acc = UUID.randomUUID()
    val tripId = UUID.randomUUID()
    val d1 = LocalDate.parse("2026-08-10")
    val d2 = LocalDate.parse("2026-08-11")
    val poiA = UUID.randomUUID()
    val poiB = UUID.randomUUID()
    val now = Instant.parse("2026-08-10T00:00:00Z")

    fun slot(poi: UUID, order: Int, start: String) =
        VisitSlot.of(poi, null, order, LocalTime.parse(start), LocalTime.parse(start).plusHours(1))

    val itinerary = Itinerary.reconstitute(
        UUID.randomUUID(), tripId, ItineraryStatus.PLANNED, SolveMode.FULL_AI, GenerationMode.FULLY_AI, false,
        GenerationState.COMPLETE,
        listOf(
            ItineraryDay.of(d1, 0, listOf(slot(poiA, 0, "10:00"))),
            ItineraryDay.of(d2, 1, listOf(slot(poiB, 0, "11:00"))),
        ),
        now, now, null, emptyList(), ScoringSignal.UNKNOWN,
    )

    val trips = object : TripFacade {
        override fun findPeriod(accountId: UUID, tripId: UUID) =
            if (accountId == acc) TripPeriod(d1, d2) else null
        override fun findGenerationContext(accountId: UUID, tripId: UUID) = null
    }

    fun repo(stored: Itinerary?) = object : ItineraryRepository {
        override fun save(itinerary: Itinerary) = itinerary
        override fun findById(itineraryId: UUID) = stored
        override fun findByTrip(tripId: UUID) = listOfNotNull(stored)
        override fun replaceForTrip(tripId: UUID, itinerary: Itinerary) = itinerary
        override fun replaceIfCurrent(tripId: UUID, expectedItineraryId: UUID, itinerary: Itinerary) = true
        override fun findStalePartial(updatedBefore: Instant) = emptyList<Itinerary>()
    }

    /** 표면 대역 — poiId 를 그대로 이름으로 쓴다. 이름 규칙 자체는 [SlotSurfaceAssembler] 스펙이 잰다. */
    fun surfaces(names: Map<UUID, String>) = object : PoiSurfaceFacade {
        override fun findSurfaces(poiIds: Collection<UUID>) = poiIds.mapNotNull { id ->
            names[id]?.let { id to PoiSurfaceView(id, it, 33.0, 126.0, "명소", "SIGHT", null, null, emptyList()) }
        }.toMap()
        override fun findFrozenSurfaces(poiSnapshotIds: Collection<UUID>) = emptyMap<UUID, FrozenPoiView>()
    }

    fun facade(stored: Itinerary? = itinerary, names: Map<UUID, String> = emptyMap()) =
        ItineraryReadFacade(trips, repo(stored), SlotSurfaceAssembler(surfaces(names)), FakeGenerationSessions())

    /**
     * 여행 목록 카드가 이 요약으로 일정 상태를 싣는다 — 앱이 여행마다 일정을 따로 부르지 않게(10-14 개발 서버 429).
     * 다시 만들기 중에는 상태가 옛 일정의 COMPLETE 로 남으므로 진행 여부는 세션에서 따로 본다.
     */
    "요약에 생성 방식이 실리고, 진행 중 여부는 여행 목록을 한 번에 묻는다" {
        val sessions = FakeGenerationSessions()
        val f = ItineraryReadFacade(trips, repo(itinerary), SlotSurfaceAssembler(surfaces(emptyMap())), sessions)
        val other = UUID.randomUUID()

        f.findCurrent(acc, tripId)!!.generationMode shouldBe "FULLY_AI"
        f.runningGenerationTripIds(acc, listOf(tripId, other)) shouldBe emptySet()

        sessions.save(GenerationSession.start(acc, tripId, GenerationMode.FULLY_AI, now))
        sessions.save(GenerationSession.start(UUID.randomUUID(), other, GenerationMode.FULLY_AI, now))  // 남의 계정 세션
        f.runningGenerationTripIds(acc, listOf(tripId, other)) shouldBe setOf(tripId)
        f.findCurrent(acc, tripId)!!.generationState shouldBe "COMPLETE"  // 옛 일정 — 진행 여부는 상태로 알 수 없다
        f.runningGenerationTripIds(acc, emptyList()) shouldBe emptySet()
    }

    /**
     * 계획 슬롯에 표면이 실린다(TRIP-1060 · BR-U3-09) — 재계획 비교(before 열)의 재료다.
     * 합성은 일정 조회와 같은 [SlotSurfaceAssembler] 라, 확정 슬롯의 동결값 우선(INV-U1-03)이
     * 두 응답에서 갈리지 않는다. 표면이 없으면 null — 이름을 지어내지 않는다.
     */
    "계획 슬롯에 POI 표면이 실린다 — 없으면 null" {
        val slots = facade(names = mapOf(poiA to "성산일출봉")).findPlanSlots(acc, tripId)

        val a = slots.single { it.poiId == poiA }
        a.nameKo shouldBe "성산일출봉"
        a.category shouldBe "명소"
        a.lat shouldBe 33.0
        a.lng shouldBe 126.0
        // poiB 는 정본에 없다 — 항목은 남고 표면만 비운다
        val b = slots.single { it.poiId == poiB }
        b.nameKo shouldBe null
        b.imageUrl shouldBe null
    }

    /**
     * 위반·거리는 일정 화면이 보여 주는 값 그대로 나간다(U8 G-U8-3). 도우미의 진행 검토가 이 값을 읽어
     * "무엇이 문제인지"를 말한다 — 화면은 위반이라는데 도우미는 문제없다고 하면 둘 중 하나는 거짓이다.
     */
    "계획 슬롯에 위반 여부·사유와 구간 거리가 실린다 — 화면이 보여 주는 값 그대로" {
        val stored = Itinerary.create(
            tripId, SolveMode.DETERMINISTIC, GenerationMode.FULLY_AI, false,
            listOf(
                ItineraryDay.of(
                    d1, 0,
                    listOf(
                        VisitSlot.of(poiA, null, 0, LocalTime.parse("09:00"), LocalTime.parse("10:00"), distanceRange = "약 1.2km"),
                        VisitSlot.of(
                            poiB, null, 1, LocalTime.parse("10:30"), LocalTime.parse("11:30"),
                            hasViolation = true, violationReason = "영업시간 밖이에요", distanceRange = "약 3km",
                        ),
                    ),
                ),
            ),
            Instant.parse("2026-08-01T00:00:00Z"),
        )

        val slots = facade(stored).findPlanSlots(acc, tripId)

        val clean = slots.single { it.poiId == poiA }
        clean.hasViolation shouldBe false
        clean.violationReason shouldBe null
        clean.distanceRange shouldBe "약 1.2km"
        val flagged = slots.single { it.poiId == poiB }
        flagged.hasViolation shouldBe true
        flagged.violationReason shouldBe "영업시간 밖이에요"
        flagged.distanceRange shouldBe "약 3km"
    }

    "거리를 모르는 슬롯은 null 이다 — 0 이나 빈 문자열로 접지 않는다" {
        facade().findPlanSlots(acc, tripId).map { it.distanceRange } shouldContainExactly listOf(null, null)
    }

    "슬롯을 경계 키로 내보낸다 — 물리 키를 내보내면 재계획으로 행이 갈릴 때 참조가 끊긴다" {
        val ref = facade().findCurrent(acc, tripId)!!

        ref.slotKeys shouldContainExactly listOf("$d1#$poiA", "$d2#$poiB")
        ref.dates shouldContainExactly listOf(d1, d2)
        ref.itineraryId shouldBe itinerary.itineraryId
    }

    "상태를 문자열로 넘긴다 — 내부 enum 을 공개 계약에 싣지 않는다" {
        val ref = facade().findCurrent(acc, tripId)!!
        ref.status shouldBe "PLANNED"
        ref.generationState shouldBe "COMPLETE"
    }

    "타 계정이면 null — 존재를 숨긴다(호출 측이 404 로 매핑)" {
        facade().findCurrent(UUID.randomUUID(), tripId) shouldBe null
    }

    "생성된 일정이 없으면 null" {
        facade(stored = null).findCurrent(acc, tripId) shouldBe null
    }

    "여러 날·여러 슬롯이 표시 순서대로 나온다 — 감지의 '남은 슬롯' 판정이 이 순서를 쓴다" {
        val poiC = UUID.randomUUID()
        val multi = Itinerary.reconstitute(
            UUID.randomUUID(), tripId, ItineraryStatus.PLANNED, SolveMode.FULL_AI, GenerationMode.FULLY_AI, false,
            GenerationState.COMPLETE,
            listOf(ItineraryDay.of(d1, 0, listOf(slot(poiA, 0, "10:00"), slot(poiC, 1, "14:00")))),
            now, now, null, emptyList(), ScoringSignal.UNKNOWN,
        )
        ItineraryReadFacade(trips, repo(multi), SlotSurfaceAssembler(surfaces(emptyMap())), FakeGenerationSessions())
            .findCurrent(acc, tripId)!!.slotKeys shouldContainExactly listOf("$d1#$poiA", "$d1#$poiC")
    }

    /**
     * 리마인드 문구의 재료(TRIP-883). **동선 순서**여야 한다 — 문구가 "A 들렀다 B" 로 읽히는데
     * 저장 순서로 나가면 사용자가 실제로 가는 순서와 거꾸로 말할 수 있다.
     */
    "날짜별 장소 이름을 방문 순서로 준다" {
        val names = facade(names = mapOf(poiA to "성산일출봉", poiB to "우도"))
            .findPlannedPlaces(acc, tripId)

        names[d1]!!.map { it.nameKo } shouldContainExactly listOf("성산일출봉")
        names[d2]!!.map { it.nameKo } shouldContainExactly listOf("우도")
    }

    "orderIndex 가 순서를 정한다 — 저장 순서가 아니다" {
        val poiC = UUID.randomUUID()
        val multi = Itinerary.reconstitute(
            UUID.randomUUID(), tripId, ItineraryStatus.PLANNED, SolveMode.FULL_AI, GenerationMode.FULLY_AI, false,
            GenerationState.COMPLETE,
            // 뒤에 저장된 것이 orderIndex 는 앞이다.
            listOf(ItineraryDay.of(d1, 0, listOf(slot(poiA, 1, "14:00"), slot(poiC, 0, "10:00")))),
            now, now, null, emptyList(), ScoringSignal.UNKNOWN,
        )
        val facade = ItineraryReadFacade(
            trips, repo(multi), SlotSurfaceAssembler(surfaces(mapOf(poiA to "나중", poiC to "먼저"))), FakeGenerationSessions(),
        )

        facade.findPlannedPlaces(acc, tripId)[d1]!!.map { it.nameKo } shouldContainExactly listOf("먼저", "나중")
    }

    /**
     * **이름을 못 찾은 날은 키까지 뺀다.** 빈 목록으로 남기면 호출측이 "그 날은 일정이 없다"로 읽는데
     * 사실은 이름만 모르는 것이다 — 그 오독이 그대로 "오늘은 일정이 없으니…" 라는 거짓 문구가 된다.
     */
    "표면이 없으면 그 날은 키가 없다 — 빈 목록으로 남기지 않는다" {
        facade(names = emptyMap()).findPlannedPlaces(acc, tripId) shouldBe emptyMap()
    }

    "타 계정에는 재료를 주지 않는다" {
        facade(names = mapOf(poiA to "성산일출봉")).findPlannedPlaces(UUID.randomUUID(), tripId) shouldBe emptyMap()
    }
})
