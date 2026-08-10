package com.trippilot.app.persistence

import com.trippilot.auth.domain.Account
import com.trippilot.auth.domain.AgeMethod
import com.trippilot.auth.domain.port.AccountRepository
import com.trippilot.planb.domain.TriggerEvent
import com.trippilot.planb.domain.TriggerEventRepository
import com.trippilot.planb.domain.TriggerStatus
import com.trippilot.planb.domain.TriggerType
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import com.trippilot.trip.domain.Trip
import com.trippilot.trip.domain.TripDestination
import com.trippilot.trip.domain.TripRepository
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.dao.DataIntegrityViolationException
import java.time.Instant
import java.time.LocalDate
import java.util.UUID

/**
 * TRIP-273 — trigger_event 실 DB 검증(V2.18).
 *
 * 여기서만 드러나는 것:
 * - **null 슬롯(일정 전체 신호)의 이력 조회.** SQL 에서 `null = null` 은 참이 아니라, 조건을 잘못 쓰면
 *   이력이 항상 비어 보이고 **억제가 통째로 무력화**된다. 단위 테스트는 in-memory 라 이 함정을 못 본다.
 * - **부분 유니크 인덱스.** 앱이 억제를 놓쳐도 같은 사유·같은 방문지로 두 번 활성화되지 않는다.
 * - **하루 총량의 날짜 경계**가 여행지(KST) 기준인지.
 */
@SpringBootTest
class TriggerEventPersistenceIT : AbstractPostgresIntegrationTest() {

    @Autowired private lateinit var triggers: TriggerEventRepository
    @Autowired private lateinit var trips: TripRepository
    @Autowired private lateinit var accounts: AccountRepository

    private val now = Instant.parse("2026-08-11T03:00:00Z") // KST 12:00

    private fun newTrip(): UUID = trips.save(
        Trip.create(
            accountId = accounts.save(Account.registerViaSocial(null, AgeMethod.SELF_DECLARED, null, now)).id.value,
            title = null,
            startDate = LocalDate.parse("2026-08-10"),
            endDate = LocalDate.parse("2026-08-12"),
            party = 2,
            companionType = null,
            budgetTotal = null,
            preferenceSnapshot = emptyMap(),
            destinations = listOf(TripDestination(0, "제주", 2)),
            now = now,
        ),
    ).tripId

    @Test
    fun `일정 전체 신호(슬롯 null)도 이력으로 찾힌다 — 못 찾으면 억제가 무력화된다`() {
        val tripId = newTrip()
        triggers.save(TriggerEvent.raise(tripId, TriggerType.WEATHER, null, "강수확률 80%", now))

        val history = triggers.findHistory(tripId, TriggerType.WEATHER, null)
        history.size shouldBe 1
        history.single().status shouldBe TriggerStatus.ACTIVE
    }

    @Test
    fun `이력은 사유·방문지로 정확히 갈린다 — 남의 슬롯 이력이 섞이지 않는다`() {
        val tripId = newTrip()
        val slotA = UUID.randomUUID()
        val slotB = UUID.randomUUID()
        triggers.save(TriggerEvent.raise(tripId, TriggerType.HOURS, slotA, "당일 휴무", now))

        triggers.findHistory(tripId, TriggerType.HOURS, slotA).size shouldBe 1
        triggers.findHistory(tripId, TriggerType.HOURS, slotB).size shouldBe 0 // 다른 방문지
        triggers.findHistory(tripId, TriggerType.WEATHER, slotA).size shouldBe 0 // 다른 사유
        triggers.findHistory(tripId, TriggerType.HOURS, null).size shouldBe 0 // 전체 신호가 아니다
    }

    @Test
    fun `같은 사유·같은 방문지로 두 번 활성화되지 않는다 — 앱이 놓쳐도 DB 가 막는다`() {
        val tripId = newTrip()
        val slot = UUID.randomUUID()
        triggers.save(TriggerEvent.raise(tripId, TriggerType.DELAY, slot, "이동 20분 지연", now))

        shouldThrow<DataIntegrityViolationException> {
            triggers.save(TriggerEvent.raise(tripId, TriggerType.DELAY, slot, "이동 25분 지연", now))
        }
    }

    @Test
    fun `닫거나 해소되면 같은 자리에 다시 띄울 수 있다 — 인덱스는 활성만 본다`() {
        val tripId = newTrip()
        val first = triggers.save(TriggerEvent.raise(tripId, TriggerType.WEATHER, null, "강수확률 80%", now))
        triggers.save(first.resolved(now))

        // 상황이 재발했다 — 활성이 없으므로 DB 가 막지 않는다
        triggers.save(TriggerEvent.raise(tripId, TriggerType.WEATHER, null, "강수확률 90%", now))
        triggers.findHistory(tripId, TriggerType.WEATHER, null).size shouldBe 2
    }

    @Test
    fun `하루 총량은 여행지(KST) 날짜로 센다 — UTC 로 세면 자정 무렵 한도가 어긋난다`() {
        val tripId = newTrip()
        // KST 08-11 00:30 = UTC 08-10 15:30. UTC 날짜로 세면 08-10 로 잡혀 다른 날이 된다.
        val kstEarly = Instant.parse("2026-08-10T15:30:00Z")
        triggers.save(TriggerEvent(UUID.randomUUID(), tripId, TriggerType.WEATHER, null, "v", TriggerStatus.NORMAL, kstEarly, kstEarly))
        triggers.save(TriggerEvent(UUID.randomUUID(), tripId, TriggerType.DELAY, null, "v", TriggerStatus.NORMAL, now, now))

        triggers.countRaisedOn(tripId, LocalDate.parse("2026-08-11")) shouldBe 2 // 둘 다 KST 08-11
        triggers.countRaisedOn(tripId, LocalDate.parse("2026-08-10")) shouldBe 0
    }
}
