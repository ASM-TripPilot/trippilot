package com.trippilot.app

import com.trippilot.auth.domain.Account
import com.trippilot.auth.domain.AgeMethod
import com.trippilot.auth.domain.port.AccountRepository
import com.trippilot.core.error.ResourceNotFound
import com.trippilot.itinerarygeneration.api.ReplanProposal
import com.trippilot.itinerarygeneration.api.ReplanSlot
import com.trippilot.recalculation.application.ReplanDiffService
import com.trippilot.recalculation.domain.OriginKind
import com.trippilot.recalculation.domain.ReplanOrigin
import com.trippilot.recalculation.domain.ReplanScope
import com.trippilot.recalculation.domain.ReplanSession
import com.trippilot.recalculation.domain.ReplanSessionRepository
import com.trippilot.recalculation.domain.ReplanStatus
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import com.trippilot.trip.domain.Trip
import com.trippilot.trip.domain.TripDestination
import com.trippilot.trip.domain.TripRepository
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.matchers.collections.shouldBeEmpty
import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.util.UUID

/**
 * 확정 전 전후 비교 실 DB 검증(TRIP-559 · US-PLANB-08).
 *
 * 여기서만 드러나는 것 — 인메모리 대역으로는 **원리적으로** 못 본다:
 * - **`draft` jsonb 왕복** — 초안은 `toMap`/`fromMap` 으로 저장·복원된다. 왕복에서 값이 새면
 *   비교가 조용히 틀린 값을 낸다(그 상태로 사용자가 확정한다)
 * - **소유 은닉** — 남의 여행 세션을 id 로 들여다볼 수 없는가(404)
 * - **배선** — 서비스가 실제로 계획 슬롯 퍼사드와 세션 저장소에 닿는가. 조립 문제라 단위로는 못 본다
 */
@SpringBootTest
class ReplanDiffIT : AbstractPostgresIntegrationTest() {

    @Autowired private lateinit var diffs: ReplanDiffService
    @Autowired private lateinit var sessions: ReplanSessionRepository
    @Autowired private lateinit var trips: TripRepository
    @Autowired private lateinit var accounts: AccountRepository

    private val now = Instant.parse("2026-08-11T01:00:00Z")
    private val day = LocalDate.parse("2026-08-11")

    private fun newAccount(): UUID =
        accounts.save(Account.registerViaSocial(null, AgeMethod.SELF_DECLARED, null, now)).id.value

    private fun newTrip(accountId: UUID): UUID = trips.save(
        Trip.create(
            accountId = accountId, title = null,
            startDate = LocalDate.parse("2026-08-10"), endDate = LocalDate.parse("2026-08-12"),
            party = 2, companionType = null, budgetTotal = null,
            preferenceSnapshot = emptyMap(),
            destinations = listOf(TripDestination(0, "제주", 2)), now = now,
        ),
    ).tripId

    private fun openSession(tripId: UUID) = ReplanSession.start(
        tripId = tripId, itineraryId = UUID.randomUUID(), triggerId = null,
        scope = ReplanScope.FULL_DAY, fromInstant = now,
        origin = ReplanOrigin(OriginKind.STAY_ANCHOR, null, null),
        reasons = listOf("WEATHER"), directives = emptyList(), freeText = null,
        excludedPoiIds = emptyList(), at = now,
    )

    private fun draftOf(vararg pois: UUID) = ReplanProposal(
        itineraryId = UUID.randomUUID(), date = day,
        slots = pois.mapIndexed { i, poi ->
            ReplanSlot(
                poiId = poi,
                startAt = LocalTime.of(10 + i, 0), endAt = LocalTime.of(11 + i, 0),
                isFixed = false, endsNextDay = false,
                distanceRange = "가까움", placementReason = "비 예보로 실내 대안",
            )
        },
    ).toMap()

    @Test
    fun `초안이 나오기 전에는 비교가 없다 — 404 가 아니라 ready=false`() {
        val accountId = newAccount()
        val tripId = newTrip(accountId)
        val session = sessions.save(openSession(tripId)) // COLLECTING

        val view = diffs.diff(accountId, tripId, session.sessionId)

        view.ready shouldBe false
        view.status shouldBe ReplanStatus.COLLECTING
        view.after.shouldBeEmpty()
        // 404 였다면 화면은 "세션이 없다"와 "산출 중"을 구분하지 못한다.
    }

    @Test
    fun `DRAFT 면 초안이 jsonb 왕복을 거쳐 비교로 나온다`() {
        val accountId = newAccount()
        val tripId = newTrip(accountId)
        val poi = UUID.randomUUID()
        val session = sessions.save(openSession(tripId).solving().drafted(draftOf(poi)))

        val view = diffs.diff(accountId, tripId, session.sessionId)

        view.ready shouldBe true
        view.date shouldBe day
        // 왕복에서 값이 새면 여기서 슬롯이 비거나 시각이 어긋난다.
        view.after.single().slotKey shouldBe "$day#$poi"
        view.after.single().startAt shouldBe LocalTime.of(10, 0)
        // 계획이 없는 여행이라 전부 새로 들어온 것으로 잡힌다.
        view.result!!.entries.single().change.name shouldBe "ADDED"
        view.result!!.impact.visitCountDelta shouldBe 1
    }

    @Test
    fun `남의 여행 세션은 보이지 않는다 — id 를 알아도 404`() {
        val owner = newAccount()
        val other = newAccount()
        val tripId = newTrip(owner)
        val session = sessions.save(openSession(tripId).solving().drafted(draftOf(UUID.randomUUID())))

        shouldThrow<ResourceNotFound> { diffs.diff(other, tripId, session.sessionId) }
    }

    @Test
    fun `다른 여행의 세션 id 로는 조회되지 않는다`() {
        val accountId = newAccount()
        val tripA = newTrip(accountId)
        val tripB = newTrip(accountId)
        val session = sessions.save(openSession(tripA).solving().drafted(draftOf(UUID.randomUUID())))

        // 세션 id 가 전역 유일해도 여행 범위로 좁혀 찾는다 — 안 그러면 남의 여행을 건드리는 구멍이 생긴다.
        shouldThrow<ResourceNotFound> { diffs.diff(accountId, tripB, session.sessionId) }
    }

    @Test
    fun `비교는 원 일정을 건드리지 않는다(INV-U4-05)`() {
        val accountId = newAccount()
        val tripId = newTrip(accountId)
        val session = sessions.save(openSession(tripId).solving().drafted(draftOf(UUID.randomUUID())))

        diffs.diff(accountId, tripId, session.sessionId)

        // 세션 상태도 그대로다 — 조회가 상태를 옮기면 확정 흐름이 어긋난다.
        sessions.findById(session.sessionId)!!.status shouldBe ReplanStatus.DRAFT
    }
}
