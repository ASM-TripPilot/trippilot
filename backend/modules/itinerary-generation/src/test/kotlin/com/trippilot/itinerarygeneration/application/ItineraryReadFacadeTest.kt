package com.trippilot.itinerarygeneration.application

import com.trippilot.itinerarygeneration.domain.GenerationMode
import com.trippilot.itinerarygeneration.domain.GenerationState
import com.trippilot.itinerarygeneration.domain.Itinerary
import com.trippilot.itinerarygeneration.domain.ItineraryDay
import com.trippilot.itinerarygeneration.domain.ItineraryRepository
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
        now, now, null, emptyList(),
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

    fun facade(stored: Itinerary? = itinerary) = ItineraryReadFacade(trips, repo(stored))

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
            now, now, null, emptyList(),
        )
        ItineraryReadFacade(trips, repo(multi)).findCurrent(acc, tripId)!!.slotKeys shouldContainExactly
            listOf("$d1#$poiA", "$d1#$poiC")
    }
})
