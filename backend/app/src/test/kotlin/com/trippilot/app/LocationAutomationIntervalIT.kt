package com.trippilot.app

import com.fasterxml.jackson.databind.ObjectMapper
import com.trippilot.app.event.OutboxRelay
import com.trippilot.archive.application.IntervalReport
import com.trippilot.archive.application.LocationAutomationService
import com.trippilot.archive.domain.IntervalEndReason
import com.trippilot.archive.domain.IntervalKind
import com.trippilot.archive.domain.LocationAutomationIntervalRepository
import com.trippilot.auth.api.LocationIntervalPhase
import com.trippilot.auth.application.AccountDeletionService
import com.trippilot.auth.application.LocationConsentService
import com.trippilot.auth.domain.Account
import com.trippilot.auth.domain.AccountId
import com.trippilot.auth.domain.AgeMethod
import com.trippilot.auth.domain.port.AccountRepository
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import com.trippilot.trip.application.TripService
import com.trippilot.trip.domain.Trip
import com.trippilot.trip.domain.TripDestination
import com.trippilot.trip.domain.TripRepository
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.jdbc.core.JdbcTemplate
import java.time.Instant
import java.time.LocalDate
import java.time.temporal.ChronoUnit
import java.util.UUID

/**
 * 자동화 구간(V2.68 · TRIP-1404) 실 DB 검증.
 *
 * 대역이 원리적으로 못 보는 것:
 * - **조건부 닫기** — 두 닫기가 겹쳐도 `ended_at IS NULL` 을 통과하는 쪽은 하나다. 대역은 그것을 흉내 낼 뿐이다
 * - **법정 로그 행의 모양** — `detail` 에 무엇이 실리는가(좌표가 없어야 한다, LEGAL-U4-03)
 * - **철회 → 릴레이 → 구독자 배선** — 이벤트 타입 문자열이 양쪽에 리터럴로 박혀 있어, 어긋나면 릴레이가 조용히 닫는다
 * - **CHECK** — 끝과 사유는 함께 있거나 함께 없다
 */
@SpringBootTest
class LocationAutomationIntervalIT : AbstractPostgresIntegrationTest() {

    @Autowired private lateinit var automation: LocationAutomationService
    @Autowired private lateinit var intervals: LocationAutomationIntervalRepository
    @Autowired private lateinit var consents: LocationConsentService
    @Autowired private lateinit var relay: OutboxRelay
    @Autowired private lateinit var trips: TripRepository
    @Autowired private lateinit var accounts: AccountRepository
    @Autowired private lateinit var jdbc: JdbcTemplate
    @Autowired private lateinit var mapper: ObjectMapper
    @Autowired private lateinit var deletions: AccountDeletionService
    @Autowired private lateinit var tripService: TripService

    private val past = Instant.now().minus(2, ChronoUnit.HOURS).truncatedTo(ChronoUnit.SECONDS)

    private fun newTrip(): Pair<UUID, UUID> {
        val accountId = accounts.save(Account.registerViaSocial(null, AgeMethod.SELF_DECLARED, null, past)).id.value
        val today = LocalDate.now()
        val tripId = trips.save(
            Trip.create(
                accountId = accountId, title = null, startDate = today.minusDays(1), endDate = today.plusDays(1),
                party = 2, companionType = null, budgetTotal = null, preferenceSnapshot = emptyMap(),
                destinations = listOf(TripDestination(0, "제주", 2)), now = past,
            ),
        ).tripId
        consents.update(AccountId(accountId), legalConsent = true, gpsRecordingOptIn = true)
        return accountId to tripId
    }

    private fun intervalLogs(intervalId: UUID): List<Map<String, Any?>> = jdbc.queryForList(
        "SELECT event_type, detail::text AS detail FROM location_legal_log WHERE detail ->> 'intervalId' = ? ORDER BY occurred_at, log_id",
        intervalId.toString(),
    )

    @Test
    fun `무장 구간의 시작과 끝이 좌표 없는 USE 로그 두 줄로 남고 재전송은 더하지 않는다`() {
        val (accountId, tripId) = newTrip()
        val id = UUID.randomUUID()
        val start = IntervalReport(id, IntervalKind.GEOFENCE_ARMED, LocationIntervalPhase.START, past)
        val end = IntervalReport(id, IntervalKind.GEOFENCE_ARMED, LocationIntervalPhase.END, past.plusSeconds(3600), IntervalEndReason.TRIP_ENDED, regionCount = 5)

        automation.report(accountId, tripId, start)
        automation.report(accountId, tripId, start)
        automation.report(accountId, tripId, end)
        automation.report(accountId, tripId, end)

        val logs = intervalLogs(id)
        logs.map { it["event_type"] } shouldBe listOf("USE", "USE")
        val ended = mapper.readTree(logs[1]["detail"] as String)
        ended["purpose"].asText() shouldBe "GEOFENCE_AUTO_VISIT"
        ended["phase"].asText() shouldBe "END"
        ended["endReason"].asText() shouldBe "TRIP_ENDED"
        ended["regionCount"].asText() shouldBe "5"
        ended["tripId"].asText() shouldBe tripId.toString()
        // 좌표가 실리지 않는다 — 확인자료가 또 하나의 파기 대상이 되면 안 된다
        ended.fieldNames().asSequence().toSet() shouldBe setOf("purpose", "intervalId", "tripId", "phase", "at", "endReason", "regionCount")
        intervals.find(id)!!.let { (it.endReason to it.regionCount) shouldBe (IntervalEndReason.TRIP_ENDED to 5) }
    }

    /**
     * TRIP-1486 · 여행 중 사용자가 이 여행의 자동 기록을 잠깐 끈다(동의 철회 아님). 기기는 END(USER_PAUSE)로 닫고,
     * 다시 켜면 새 구간을 START 한다. DB CHECK 가 이 사유를 모르면 END 가 500 이 되어 구간이 SERVER_TIMEOUT 까지 열린다.
     */
    @Test
    fun `일시 중지는 USER_PAUSE 로 닫히고 다시 켜면 새 구간이 열린다`() {
        val (accountId, tripId) = newTrip()
        val first = UUID.randomUUID()
        val second = UUID.randomUUID()
        automation.report(accountId, tripId, IntervalReport(first, IntervalKind.GEOFENCE_ARMED, LocationIntervalPhase.START, past))
        automation.report(
            accountId, tripId,
            IntervalReport(first, IntervalKind.GEOFENCE_ARMED, LocationIntervalPhase.END, past.plusSeconds(600), IntervalEndReason.USER_PAUSE, regionCount = 2),
        )
        automation.report(accountId, tripId, IntervalReport(second, IntervalKind.GEOFENCE_ARMED, LocationIntervalPhase.START, past.plusSeconds(1200)))

        intervals.find(first)!!.endReason shouldBe IntervalEndReason.USER_PAUSE
        intervals.find(second)!!.endReason shouldBe null
        mapper.readTree(intervalLogs(first)[1]["detail"] as String)["endReason"].asText() shouldBe "USER_PAUSE"
    }

    @Test
    fun `경로 기록 구간은 기기 안 수집 COLLECTION 으로 남는다`() {
        val (accountId, tripId) = newTrip()
        val id = UUID.randomUUID()
        automation.report(accountId, tripId, IntervalReport(id, IntervalKind.ROUTE_RECORDING, LocationIntervalPhase.START, past))

        val started = mapper.readTree(intervalLogs(id).single()["detail"] as String)
        (started["source"].asText() to started["scope"].asText()) shouldBe ("ROUTE_TRACE" to "DEVICE")
    }

    /** 기기 END·철회·스위퍼가 같은 구간을 동시에 닫으려 해도 닫는 쪽은 하나다 — 법정 로그 END 가 두 줄이 되지 않는 근거. */
    @Test
    fun `닫기는 열려 있을 때만 통한다`() {
        val (accountId, tripId) = newTrip()
        val id = UUID.randomUUID()
        automation.report(accountId, tripId, IntervalReport(id, IntervalKind.GEOFENCE_ARMED, LocationIntervalPhase.START, past))
        val open = intervals.find(id)!!

        intervals.closeIfOpen(open.close(past.plusSeconds(60), IntervalEndReason.CLIENT_STOP, null, 3)) shouldBe true
        intervals.closeIfOpen(open.close(past.plusSeconds(120), IntervalEndReason.SERVER_TIMEOUT, null, null)) shouldBe false

        intervals.find(id)!!.endReason shouldBe IntervalEndReason.CLIENT_STOP
    }

    /** 같은 START 가 동시에 둘 오면 둘 다 "없다"를 보고 넣으려 한다 — 하나만 들어가야 하고 다른 쪽은 500 이 아니라 조용히 진다. */
    @Test
    fun `같은 구간을 두 번 넣으면 두 번째는 들어가지 않는다`() {
        val (accountId, tripId) = newTrip()
        val row = com.trippilot.archive.domain.LocationAutomationInterval(UUID.randomUUID(), tripId, accountId, IntervalKind.GEOFENCE_ARMED, past)
        intervals.insertIfAbsent(row) shouldBe true
        intervals.insertIfAbsent(row.copy(startedAt = past.plusSeconds(60))) shouldBe false
        intervals.find(row.intervalId)!!.startedAt shouldBe past
    }

    @Test
    fun `끝과 사유는 함께 있거나 함께 없다`() {
        val (accountId, tripId) = newTrip()
        val e = shouldThrow<DataIntegrityViolationException> {
            jdbc.update(
                "INSERT INTO location_automation_interval (interval_id, trip_id, account_id, kind, started_at, ended_at) VALUES (?, ?, ?, 'GEOFENCE_ARMED', now(), now())",
                UUID.randomUUID(), tripId, accountId,
            )
        }
        (e.message!!.contains("chk_location_automation_interval_end")) shouldBe true
    }

    /** 철회에서 출발한다 — 아웃박스 적재·릴레이 배달·구독자 배선이 전부 경로에 들어온다(LocationPurgeRelayIT 와 같은 이유). */
    @Test
    fun `GPS 기록 동의를 철회하면 릴레이를 지나 경로 기록만 닫히고, 위치 동의를 철회하면 무장도 닫힌다`() {
        val (accountId, tripId) = newTrip()
        val armed = UUID.randomUUID()
        val route = UUID.randomUUID()
        automation.report(accountId, tripId, IntervalReport(armed, IntervalKind.GEOFENCE_ARMED, LocationIntervalPhase.START, past))
        automation.report(accountId, tripId, IntervalReport(route, IntervalKind.ROUTE_RECORDING, LocationIntervalPhase.START, past))

        consents.update(AccountId(accountId), legalConsent = null, gpsRecordingOptIn = false)
        repeat(RELAY_TRIES) { if (intervals.find(route)!!.isOpen) relay.relay() }

        intervals.find(route)!!.endReason shouldBe IntervalEndReason.CONSENT_REVOKED
        intervals.find(armed)!!.isOpen shouldBe true

        consents.update(AccountId(accountId), legalConsent = false, gpsRecordingOptIn = null)
        repeat(RELAY_TRIES) { if (intervals.find(armed)!!.isOpen) relay.relay() }

        intervals.find(armed)!!.endReason shouldBe IntervalEndReason.CONSENT_REVOKED
        intervalLogs(armed).size shouldBe 2
    }

    /** 계정 삭제는 L2 철회 이벤트를 내지 않고 GPS 옵트아웃(사유 = 계정 삭제)만 낸다. 같은 요청이 세션을 끊어 기기 END 도 못 온다. */
    @Test
    fun `계정 삭제를 요청하면 무장 구간까지 닫힌다`() {
        val (accountId, tripId) = newTrip()
        val armed = UUID.randomUUID()
        automation.report(accountId, tripId, IntervalReport(armed, IntervalKind.GEOFENCE_ARMED, LocationIntervalPhase.START, past))

        deletions.requestDeletion(AccountId(accountId))
        repeat(RELAY_TRIES) { if (intervals.find(armed)!!.isOpen) relay.relay() }

        intervals.find(armed)!!.endReason shouldBe IntervalEndReason.CONSENT_REVOKED
        intervalLogs(armed).size shouldBe 2
        // 끝은 처리 시각이 아니라 **철회(이벤트) 시각**이다 — 릴레이 지연만큼 법정 로그가 이용을 늘려 적지 않는다
        val revokedAt = jdbc.queryForObject(
            "SELECT occurred_at FROM outbox_event WHERE event_type = 'auth.GpsRecordingOptOut' AND aggregate_id = ? ORDER BY occurred_at DESC LIMIT 1",
            java.sql.Timestamp::class.java, accountId.toString(),
        )!!.toInstant()
        intervals.find(armed)!!.endedAt shouldBe revokedAt
    }

    /** 여행 삭제는 소프트 삭제라 CASCADE 가 닿지 않는다 — 실 여행 파사드로 스위퍼가 그것을 닫는지 본다. */
    @Test
    fun `지워진 여행의 열린 구간은 스위퍼가 닫는다`() {
        val (accountId, tripId) = newTrip()
        val id = UUID.randomUUID()
        automation.report(accountId, tripId, IntervalReport(id, IntervalKind.GEOFENCE_ARMED, LocationIntervalPhase.START, past))
        tripService.delete(accountId, tripId)

        automation.sweep()

        intervals.find(id)!!.endReason shouldBe IntervalEndReason.SERVER_TIMEOUT
        intervalLogs(id).size shouldBe 2
    }

    private companion object {
        const val RELAY_TRIES = 20
    }
}
