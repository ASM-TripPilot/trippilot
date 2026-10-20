package com.trippilot.app.views

import com.trippilot.archive.adapter.`in`.web.VisitCheckController
import com.trippilot.archive.adapter.`in`.web.VisitCheckListResponse
import com.trippilot.auth.adapter.`in`.web.LocationConsentController
import com.trippilot.auth.adapter.`in`.web.LocationConsentResponse
import com.trippilot.core.error.ConflictDetected
import com.trippilot.core.error.ResourceNotFound
import com.trippilot.itinerarygeneration.adapter.`in`.web.DayResponse
import com.trippilot.itinerarygeneration.adapter.`in`.web.ItineraryController
import com.trippilot.itinerarygeneration.adapter.`in`.web.ItineraryResponse
import com.trippilot.planbdetection.adapter.`in`.web.TriggerController
import com.trippilot.planbdetection.adapter.`in`.web.TriggerListResponse
import com.trippilot.trip.adapter.`in`.web.TripController
import com.trippilot.trip.adapter.`in`.web.TripResponse
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.matchers.shouldBe
import io.kotest.matchers.types.shouldBeSameInstanceAs
import io.mockk.every
import io.mockk.mockk
import io.mockk.verify
import org.junit.jupiter.api.Test
import java.security.Principal
import java.time.Clock
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZoneOffset
import java.util.UUID

/** 라이브 화면 묶음의 실패 규칙·날짜 규칙. 섹션 모양이 개별 엔드포인트와 같은지는 `LiveViewApiIT` 가 본다. */
class LiveViewControllerTest {

    private val principal = Principal { UUID.randomUUID().toString() }
    private val tripId = UUID.randomUUID()
    private val day1 = LocalDate.parse("2026-10-20")
    private val day2 = LocalDate.parse("2026-10-21")
    private val day3 = LocalDate.parse("2026-10-22")

    private val tripController = mockk<TripController>()
    private val itineraryController = mockk<ItineraryController>()
    private val triggerController = mockk<TriggerController>()
    private val visitController = mockk<VisitCheckController>()
    private val consentController = mockk<LocationConsentController>()

    private val trip = mockk<TripResponse>()
    private val triggers = mockk<TriggerListResponse>()
    private val consent = mockk<LocationConsentResponse>()

    private fun itinerary(vararg dates: LocalDate) = mockk<ItineraryResponse> {
        every { days } returns dates.map { DayResponse(it, emptyList()) }
    }

    /** 서울 날짜로 [today] 인 시계. */
    private fun controller(today: LocalDate = day2) = LiveViewController(
        tripController, itineraryController, triggerController, visitController, consentController,
        Clock.fixed(today.atTime(12, 0).atZone(ZoneId.of("Asia/Seoul")).toInstant(), ZoneOffset.UTC),
    )

    private fun allOk(it: ItineraryResponse = itinerary(day1, day2, day3)) {
        every { tripController.get(principal, tripId) } returns trip
        every { itineraryController.get(principal, tripId) } returns it
        every { triggerController.list(principal, tripId) } returns triggers
        every { visitController.listByDay(principal, tripId, any()) } answers { VisitCheckListResponse(emptyList()) }
        every { consentController.get(principal) } returns consent
    }

    @Test
    fun `섹션 하나가 실패하면 그 섹션만 null 이고 사유가 실린다`() {
        allOk()
        every { triggerController.list(principal, tripId) } throws ConflictDetected()
        every { consentController.get(principal) } throws IllegalStateException("db")

        val res = controller().live(principal, tripId, null)

        res.trip shouldBeSameInstanceAs trip
        res.triggers shouldBe null
        res.locationConsent shouldBe null
        res.visits shouldBe VisitCheckListResponse(emptyList())
        res.unavailable shouldBe listOf(
            UnavailableSection(LiveSection.TRIGGERS, "CONFLICT"),
            UnavailableSection(LiveSection.LOCATION_CONSENT, "INTERNAL"),
        )
    }

    @Test
    fun `방문 섹션이 실패해도 사유가 실린다`() {
        allOk()
        every { visitController.listByDay(principal, tripId, any()) } throws ResourceNotFound()

        val res = controller().live(principal, tripId, null)

        res.visits shouldBe null
        res.day shouldBe day2
        res.unavailable shouldBe listOf(UnavailableSection(LiveSection.VISITS, "RESOURCE_NOT_FOUND"))
    }

    @Test
    fun `일정이 없으면 일정에 매인 섹션은 부르지 않는다`() {
        allOk()
        every { itineraryController.get(principal, tripId) } throws ResourceNotFound()

        val res = controller().live(principal, tripId, null)

        res.itinerary shouldBe null
        res.day shouldBe null
        res.triggers shouldBe null
        res.visits shouldBe null
        res.locationConsent shouldBeSameInstanceAs consent
        res.unavailable shouldBe emptyList()
        verify(exactly = 0) { triggerController.list(any(), any()) }
        verify(exactly = 0) { visitController.listByDay(any(), any(), any()) }
    }

    @Test
    fun `일정의 그 밖의 실패와 여행의 실패는 전체 오류다`() {
        allOk()
        every { itineraryController.get(principal, tripId) } throws IllegalStateException("db")
        shouldThrow<IllegalStateException> { controller().live(principal, tripId, null) }

        every { tripController.get(principal, tripId) } throws ResourceNotFound()
        shouldThrow<ResourceNotFound> { controller().live(principal, tripId, null) }
    }

    @Test
    fun `날짜 — 요청한 날이 일정에 있으면 그날, 아니면 오늘, 오늘이 밖이면 첫날 또는 마지막 날`() {
        allOk()
        controller(today = day2).live(principal, tripId, day3).day shouldBe day3
        controller(today = day2).live(principal, tripId, day3.plusDays(9)).day shouldBe day2
        controller(today = day2).live(principal, tripId, null).day shouldBe day2
        controller(today = day1.minusDays(5)).live(principal, tripId, null).day shouldBe day1
        controller(today = day3.plusDays(5)).live(principal, tripId, null).day shouldBe day3
        verify { visitController.listByDay(principal, tripId, day3) }
    }

    @Test
    fun `일정에 날이 없으면 날짜도 방문도 null 이고 트리거는 준다`() {
        allOk(itinerary())

        val res = controller().live(principal, tripId, null)

        res.day shouldBe null
        res.visits shouldBe null
        res.triggers shouldBeSameInstanceAs triggers
        verify(exactly = 0) { visitController.listByDay(any(), any(), any()) }
    }
}
