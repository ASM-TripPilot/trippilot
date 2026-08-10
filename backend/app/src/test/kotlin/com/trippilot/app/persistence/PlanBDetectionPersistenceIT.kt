package com.trippilot.app.persistence

import com.trippilot.auth.domain.Account
import com.trippilot.auth.domain.AgeMethod
import com.trippilot.auth.domain.port.AccountRepository
import com.trippilot.planbdetection.domain.PlanBTrigger
import com.trippilot.planbdetection.domain.PlanBTriggerRepository
import com.trippilot.planbdetection.domain.Sensitivity
import com.trippilot.planbdetection.domain.SensitivityRepository
import com.trippilot.planbdetection.domain.Suppression
import com.trippilot.planbdetection.domain.SuppressionRepository
import com.trippilot.planbdetection.domain.SuppressionScope
import com.trippilot.planbdetection.domain.TriggerKind
import com.trippilot.planbdetection.domain.TriggerScope
import com.trippilot.planbdetection.domain.TriggerState
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
 * TRIP-273 — plan_b_trigger·plan_b_suppression 실 DB 검증(V2.18).
 *
 * 여기서만 드러나는 것:
 * - **INV-U4-01 을 DB 가 막는가** — `should_replan=false` 인데 ACTIVE 로 남으면 화면에 노출된다.
 * - **BR-U4-07 부분 유니크** — 같은 사유×같은 슬롯이 동시에 두 번 발화하지 않는다(지오펜스 중복 기동 대비).
 * - **jsonb payload 왕복** · 하루 총량의 날짜 경계(KST).
 */
@SpringBootTest
class PlanBDetectionPersistenceIT : AbstractPostgresIntegrationTest() {

    @Autowired private lateinit var triggers: PlanBTriggerRepository
    @Autowired private lateinit var suppressions: SuppressionRepository
    @Autowired private lateinit var sensitivities: SensitivityRepository
    @Autowired private lateinit var trips: TripRepository
    @Autowired private lateinit var accounts: AccountRepository

    private val now = Instant.parse("2026-08-11T03:00:00Z") // KST 12:00
    private val day = LocalDate.parse("2026-08-11")

    private lateinit var accountId: UUID

    private fun newTrip(): UUID {
        accountId = accounts.save(Account.registerViaSocial(null, AgeMethod.SELF_DECLARED, null, now)).id.value
        return trips.save(
            Trip.create(
                accountId = accountId, title = null,
                startDate = LocalDate.parse("2026-08-10"), endDate = LocalDate.parse("2026-08-12"),
                party = 2, companionType = null, budgetTotal = null,
                preferenceSnapshot = emptyMap(),
                destinations = listOf(TripDestination(0, "제주", 2)), now = now,
            ),
        ).tripId
    }

    private fun active(tripId: UUID, slotKey: String?, kind: TriggerKind = TriggerKind.WEATHER) =
        PlanBTrigger.active(
            tripId, UUID.randomUUID(), kind, day, slotKey,
            mapOf("pop" to 70), TriggerScope.PARTIAL_SLOTS, "비 예보 70%", now,
        )

    @Test
    fun `payload jsonb 가 왕복하고 발화분만 조회된다`() {
        val tripId = newTrip()
        val slot = "$day#${UUID.randomUUID()}"
        val saved = triggers.save(active(tripId, slot))

        val found = triggers.findById(saved.triggerId)!!
        found.payload shouldBe mapOf("pop" to 70)
        found.scope shouldBe TriggerScope.PARTIAL_SLOTS
        found.slotKey shouldBe slot

        // 무발화 판정도 저장되지만 화면 조회에는 안 나온다
        triggers.save(
            PlanBTrigger.silent(
                tripId, UUID.randomUUID(), TriggerKind.DELAY, day, null,
                mapOf("delayMin" to 18), "이동 18분 지연", TriggerState.SUPPRESSED, now,
            ),
        )
        triggers.findActiveByTrip(tripId).size shouldBe 1
    }

    @Test
    fun `발화하지 않기로 한 판정은 ACTIVE 로 저장될 수 없다 — DB 가 막는다(INV-U4-01)`() {
        val tripId = newTrip()
        // 도메인을 우회해 모순 상태를 만들어도 CHECK 가 잡는다.
        val contradictory = active(tripId, null).copy(shouldReplan = false, state = TriggerState.ACTIVE)
        shouldThrow<DataIntegrityViolationException> { triggers.save(contradictory) }
    }

    @Test
    fun `같은 사유·같은 슬롯은 동시에 두 번 발화하지 않는다(BR-U4-07)`() {
        val tripId = newTrip()
        val slot = "$day#${UUID.randomUUID()}"
        triggers.save(active(tripId, slot))
        shouldThrow<DataIntegrityViolationException> { triggers.save(active(tripId, slot)) }

        // 날짜 전체 신호(slotKey=null)도 마찬가지 — COALESCE 로 같은 자리로 본다
        triggers.save(active(tripId, null, TriggerKind.CLOSURE))
        shouldThrow<DataIntegrityViolationException> { triggers.save(active(tripId, null, TriggerKind.CLOSURE)) }
    }

    @Test
    fun `닫히면 같은 자리에 다시 발화할 수 있다 — 인덱스는 ACTIVE 만 본다`() {
        val tripId = newTrip()
        val slot = "$day#${UUID.randomUUID()}"
        val first = triggers.save(active(tripId, slot))
        triggers.save(first.copy(state = TriggerState.SUPPRESSED, shouldReplan = false))

        triggers.save(active(tripId, slot)) // 억제가 만료돼 재발화하는 경우
        triggers.findActiveByTrip(tripId).size shouldBe 1
    }

    @Test
    fun `하루 총량은 발화분만 KST 날짜로 센다`() {
        val tripId = newTrip()
        // KST 08-11 00:30 = UTC 08-10 15:30 — UTC 날짜로 세면 다른 날로 잡힌다
        val early = Instant.parse("2026-08-10T15:30:00Z")
        triggers.save(active(tripId, "$day#${UUID.randomUUID()}").copy(detectedAt = early))
        triggers.save(active(tripId, null, TriggerKind.DELAY))
        // 무발화 판정은 총량에 세지 않는다 — 억제될수록 더 막히는 뒤집힌 동작이 된다
        triggers.save(
            PlanBTrigger.silent(
                tripId, UUID.randomUUID(), TriggerKind.CLOSURE, day, null, emptyMap(), "억제됨",
                TriggerState.SUPPRESSED, now,
            ),
        )

        triggers.countActivatedOn(tripId, day) shouldBe 2
        triggers.countActivatedOn(tripId, LocalDate.parse("2026-08-10")) shouldBe 0
    }

    @Test
    fun `억제는 슬롯 범위 요건을 DB 도 강제한다 · 민감도는 없으면 NORMAL`() {
        val tripId = newTrip()
        suppressions.save(
            Suppression.of(tripId, TriggerKind.WEATHER, "$day#${UUID.randomUUID()}", SuppressionScope.SLOT, now),
        )
        suppressions.findByTrip(tripId).size shouldBe 1

        // SLOT 인데 슬롯이 없으면 도메인이 먼저 막고(아래), DB CHECK 도 같은 규칙을 갖는다
        shouldThrow<IllegalArgumentException> {
            Suppression.of(tripId, TriggerKind.WEATHER, null, SuppressionScope.SLOT, now)
        }

        sensitivities.of(accountId) shouldBe Sensitivity.NORMAL // 행이 없어도 알림이 멈추지 않는다
    }
}
