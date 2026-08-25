package com.trippilot.app

import com.trippilot.app.event.OutboxRelay
import com.trippilot.auth.domain.Account
import com.trippilot.auth.domain.AgeMethod
import com.trippilot.auth.domain.port.AccountRepository
import com.trippilot.core.event.DomainEvent
import com.trippilot.core.event.DomainEventPublisher
import com.trippilot.notification.domain.NotificationKind
import com.trippilot.notification.domain.NotificationRepository
import com.trippilot.planbdetection.api.event.PlanBTriggered
import com.trippilot.savedaccommodation.api.event.StayRegistered
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import com.trippilot.trip.domain.Trip
import com.trippilot.trip.domain.TripDestination
import com.trippilot.trip.domain.TripRepository
import io.kotest.matchers.shouldBe
import io.kotest.matchers.shouldNotBe
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.jdbc.core.JdbcTemplate
import java.time.Instant
import java.time.LocalDate
import java.util.UUID

/**
 * 도메인 사건 → 릴레이 → 알림 적재 관통 검증(TRIP-550).
 *
 * 여기서만 드러나는 것 — 인메모리 대역으로는 **원리적으로** 못 본다:
 * - **이벤트 타입 문자열이 구독자와 맞는가** — 발행측 `"stay.StayRegistered"` 와 구독측 상수가
 *   한 글자만 달라도 배달이 조용히 안 된다. 단위 테스트는 양쪽을 각자 만족시킨다
 * - **`source_event_id` UNIQUE 가 재배달을 막는가**(INV-U6-01) — at-least-once 라 같은 이벤트가
 *   두 번 온다. Map 대역은 덮어써서 "두 번째는 삽입되지 않는다"는 성질이 없다
 * - **payload 키가 실제로 읽히는가** — jsonb 왕복 뒤에도 `accountId` 가 그 이름으로 있는지
 *
 * ⚠ 여기서는 **발행을 직접** 한다(서비스 경유 아님). 서비스 경로는 각 모듈 테스트가 보고,
 * 이 IT 가 묻는 것은 "발행된 사건이 알림이 되는가"다.
 */
/**
 * 회고 준비 사건 — **이 줄기에는 reflection 모듈이 없다**(U5 는 다른 브랜치 줄기에서 온다).
 *
 * 구독자는 이벤트 타입 문자열과 payload 키로만 붙으므로 발행측 DTO 가 없어도 검증할 수 있다 —
 * 그것이 아웃박스 경계의 성질이다(R1: 알림 모듈은 회고 모듈을 모른다). 통합 시 실제 DTO 가
 * 같은 타입 문자열·키를 내는지는 `ReflectionReady` 정의가 보증한다.
 */
private data class ReflectionReadyEvent(
    override val aggregateId: String,
    val tripId: String,
    val dayDate: String?,
    val kind: String,
    val source: String,
) : DomainEvent {
    override val eventType: String = "reflection.ReflectionReady"
    override val aggregateType: String = "Reflection"
}

@SpringBootTest
class DomainNotificationIT : AbstractPostgresIntegrationTest() {

    @Autowired private lateinit var events: DomainEventPublisher
    @Autowired private lateinit var relay: OutboxRelay
    @Autowired private lateinit var notifications: NotificationRepository
    @Autowired private lateinit var trips: TripRepository
    @Autowired private lateinit var accounts: AccountRepository
    @Autowired private lateinit var jdbc: JdbcTemplate

    private val now = Instant.parse("2026-08-11T01:00:00Z")

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

    /** 배치 상한(100) 때문에 다른 IT 의 미발행분이 앞에 있으면 한 번으로는 못 온다. */
    private fun deliver() = repeat(3) { relay.relay() }

    /**
     * **남기지 않는다.** 소유자를 못 찾는 이벤트는 영영 발행되지 않아, 그대로 두면 같은 컨테이너를
     * 쓰는 다른 IT 의 릴레이 배치를 매번 차지한다(실측으로 `OutboxRelayIT` 를 깨뜨렸다).
     */
    @AfterEach
    fun cleanUp() {
        jdbc.update(
            "DELETE FROM outbox_event WHERE event_type IN ('stay.StayRegistered', 'planb.PlanBTriggered', 'reflection.ReflectionReady')",
        )
    }

    private fun notificationsOf(accountId: UUID, kind: NotificationKind) =
        notifications.findByAccount(accountId, unreadOnly = false, limit = 50).filter { it.kind == kind }

    @Test
    fun `숙소 등록 사건이 STAY 알림이 된다`() {
        val accountId = newAccount()

        events.publish(
            StayRegistered(UUID.randomUUID().toString(), accountId.toString(), "제주 게스트하우스", "2026-08-10", "2026-08-12"),
        )
        deliver()

        val notification = notificationsOf(accountId, NotificationKind.STAY).single()
        // 문구에 재료가 실제로 들어갔는지 — payload 키가 하나만 어긋나도 여기서 빈 문자열이 된다.
        (notification.body.contains("제주 게스트하우스")) shouldBe true
        notification.sourceEventId shouldNotBe null
    }

    @Test
    fun `Plan-B 발화 사건이 PLAN_B 알림이 된다 — 사유가 실린다`() {
        val accountId = newAccount()
        val tripId = newTrip(accountId)

        events.publish(
            PlanBTriggered(
                UUID.randomUUID().toString(), accountId.toString(), tripId.toString(),
                "WEATHER", "2026-08-11#${UUID.randomUUID()}", "비 예보로 실내 대안이 필요해요",
            ),
        )
        deliver()

        val notification = notificationsOf(accountId, NotificationKind.PLAN_B).single()
        notification.body shouldBe "비 예보로 실내 대안이 필요해요"
        // 알림에서 그 여행으로 들어간다 — 진입이 없으면 사용자가 읽고도 갈 곳이 없다.
        notification.actionPayload?.get("tripId") shouldBe tripId.toString()
    }

    @Test
    fun `회고 준비 사건이 REFLECTION 알림이 된다 — 계정은 여행에서 찾는다`() {
        val accountId = newAccount()
        val tripId = newTrip(accountId)

        // 이 이벤트는 계정을 싣지 않는다 — 소유자를 못 찾으면 알림도 없다.
        events.publish(
            ReflectionReadyEvent(UUID.randomUUID().toString(), tripId.toString(), "2026-08-11", "DAILY", "RULE"),
        )
        deliver()

        notificationsOf(accountId, NotificationKind.REFLECTION).single().title shouldBe "오늘의 회고가 준비됐어요"
    }

    @Test
    fun `여행 요약과 하루 회고는 문구가 다르다`() {
        val accountId = newAccount()
        val tripId = newTrip(accountId)

        events.publish(ReflectionReadyEvent(UUID.randomUUID().toString(), tripId.toString(), null, "SUMMARY", "RULE"))
        deliver()

        notificationsOf(accountId, NotificationKind.REFLECTION).single().title shouldBe "여행 요약이 준비됐어요"
    }

    @Test
    fun `같은 사건이 두 번 배달돼도 알림은 하나다(INV-U6-01)`() {
        val accountId = newAccount()
        val stayId = UUID.randomUUID().toString()
        val event = StayRegistered(stayId, accountId.toString(), "같은 숙소", "2026-08-10", "2026-08-12")

        events.publish(event)
        deliver()
        // 릴레이가 이미 발행 표시한 행을 되돌려 **재배달을 강제한다** — at-least-once 의 실제 모습이다.
        jdbc.update("UPDATE outbox_event SET published_at = NULL WHERE aggregate_id = ?", stayId)
        deliver()

        // 앱에서 "이미 있나" 검사했다면 두 인스턴스가 동시에 통과한다 — 판정은 DB UNIQUE 가 한다.
        notificationsOf(accountId, NotificationKind.STAY).size shouldBe 1
    }

    @Test
    fun `지워진 여행의 회고 알림은 만들어지지 않는다`() {
        val accountId = newAccount()
        val tripId = newTrip(accountId)
        jdbc.update("UPDATE trip SET deleted_at = now() WHERE trip_id = ?", tripId) shouldBe 1

        events.publish(ReflectionReadyEvent(UUID.randomUUID().toString(), tripId.toString(), "2026-08-11", "DAILY", "RULE"))
        deliver()

        // **계정으로 묻지 않는다.** 소유자 판정이 엉뚱한 계정으로 폴백하면 우리 계정에는 여전히
        // 아무것도 없어 통과해 버린다(역검증으로 확인했다) — 그 사건으로 만들어진 알림이 **어디에도**
        // 없어야 한다. 소유자를 못 찾으면 구독자가 예외로 올리고, 릴레이가 상한에서 error 로 남긴다.
        jdbc.queryForObject(
            "SELECT count(*) FROM notification WHERE dedup_key LIKE ?", Int::class.java, "REFLECTION#$tripId#%",
        ) shouldBe 0
    }
}
