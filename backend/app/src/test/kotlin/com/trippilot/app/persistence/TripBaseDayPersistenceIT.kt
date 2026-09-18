package com.trippilot.app.persistence

import com.trippilot.auth.domain.Account
import com.trippilot.auth.domain.AgeMethod
import com.trippilot.auth.domain.port.AccountRepository
import com.trippilot.savedaccommodation.domain.BaseResolution
import com.trippilot.savedaccommodation.domain.RegisterRoute
import com.trippilot.savedaccommodation.domain.SavedStay
import com.trippilot.savedaccommodation.domain.SavedStayRepository
import com.trippilot.savedaccommodation.domain.TripBaseDay
import com.trippilot.savedaccommodation.domain.TripBaseDayRepository
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import com.trippilot.trip.domain.Trip
import com.trippilot.trip.domain.TripDestination
import com.trippilot.trip.domain.TripRepository
import io.kotest.matchers.collections.shouldHaveSize
import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import java.time.Instant
import java.time.LocalDate
import java.util.UUID

/**
 * TRIP-190 — trip_base_day 실 DB 검증.
 *
 * 이 테이블은 **V2.4 에 있었지만 쓰는 코드가 없었다** — 매핑이 처음 붙는 자리라 실 DB 에서만 드러나는 것이 있다:
 * - **복합 PK(trip_id, day_date) 덮어쓰기** — 다시 고르면 행이 늘지 않고 갱신돼야 한다. 인메모리 Fake 는
 *   Map 이라 언제나 덮어써서 이 차이를 못 본다.
 * - **`resolution` CHECK 어휘** — DB 는 소문자(`user_pick`)를 강제하는데 enum 은 대문자다. 변환이 어긋나면
 *   저장 자체가 실패한다.
 * - **saved_stay FK(DEFERRABLE)** — 거점으로 쓰이는 숙소 참조가 실제로 걸리는지.
 */
@SpringBootTest
class TripBaseDayPersistenceIT : AbstractPostgresIntegrationTest() {

    @Autowired private lateinit var baseDays: TripBaseDayRepository
    @Autowired private lateinit var stays: SavedStayRepository
    @Autowired private lateinit var trips: TripRepository
    @Autowired private lateinit var accounts: AccountRepository

    private val now = Instant.parse("2026-08-01T00:00:00Z")
    private val day = LocalDate.parse("2026-08-01")

    private fun newAccount(): UUID =
        accounts.save(Account.registerViaSocial(null, AgeMethod.SELF_DECLARED, null, now)).id.value

    private fun newTrip(accountId: UUID): UUID = trips.save(
        Trip.create(
            accountId = accountId, title = null,
            startDate = day, endDate = LocalDate.parse("2026-08-04"),
            party = 2, companionType = null, budgetTotal = null,
            preferenceSnapshot = emptyMap(),
            destinations = listOf(TripDestination(0, "제주", 3)),
            now = now,
        ),
    ).tripId

    private fun newStay(accountId: UUID): UUID = stays.save(
        SavedStay.register(accountId, "숙소", 33.45, 126.56, true, null, null, null, null, RegisterRoute.PIN, null, now),
    ).savedStayId

    @Test
    fun `사용자 선택이 그대로 왕복한다 - CHECK 어휘까지`() {
        val account = newAccount()
        val tripId = newTrip(account)
        val stayId = newStay(account)

        baseDays.save(TripBaseDay(tripId, day, stayId, BaseResolution.USER_PICK))

        val found = baseDays.findByTrip(tripId).single()
        found.dayDate shouldBe day
        found.savedStayId shouldBe stayId
        found.resolution shouldBe BaseResolution.USER_PICK
    }

    @Test
    fun `다시 고르면 행이 늘지 않고 덮어쓴다 - 하루 1행`() {
        val account = newAccount()
        val tripId = newTrip(account)
        val first = newStay(account)
        val second = newStay(account)

        baseDays.save(TripBaseDay(tripId, day, first, BaseResolution.USER_PICK))
        baseDays.save(TripBaseDay(tripId, day, second, BaseResolution.USER_PICK))

        val rows = baseDays.findByTrip(tripId)
        rows shouldHaveSize 1
        rows.single().savedStayId shouldBe second
    }

    @Test
    fun `여행이 다르면 같은 날짜라도 각자 행을 갖는다`() {
        val account = newAccount()
        val tripA = newTrip(account)
        val tripB = newTrip(account)
        val stayId = newStay(account)

        baseDays.save(TripBaseDay(tripA, day, stayId, BaseResolution.USER_PICK))
        baseDays.save(TripBaseDay(tripB, day, stayId, BaseResolution.USER_PICK))

        baseDays.findByTrip(tripA) shouldHaveSize 1
        baseDays.findByTrip(tripB) shouldHaveSize 1
    }

    /** `destination_center` 는 아직 구현하지 않았지만 컬럼은 null 을 허용한다 — 스키마가 그 여지를 갖는지 확인. */
    @Test
    fun `거점 없는 확정도 저장된다 - 좌표 대신 여행지 중심을 쓸 자리`() {
        val account = newAccount()
        val tripId = newTrip(account)

        baseDays.save(TripBaseDay(tripId, day, null, BaseResolution.DESTINATION_CENTER))

        val found = baseDays.findByTrip(tripId).single()
        found.savedStayId shouldBe null
        found.resolution shouldBe BaseResolution.DESTINATION_CENTER
    }
}
