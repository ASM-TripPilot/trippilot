package com.trippilot.app

import com.trippilot.app.event.OutboxRelay
import com.trippilot.auth.domain.Account
import com.trippilot.auth.domain.AgeMethod
import com.trippilot.auth.domain.port.AccountRepository
import com.trippilot.core.event.DomainEvent
import com.trippilot.core.event.DomainEventPublisher
import com.trippilot.notification.domain.DevicePlatform
import com.trippilot.notification.domain.NotificationKind
import com.trippilot.notification.application.NotificationRaiseService
import com.trippilot.notification.application.PushPolicy
import com.trippilot.notification.domain.NotificationRepository
import com.trippilot.notification.domain.OsPermission
import com.trippilot.notification.domain.PushToken
import com.trippilot.notification.domain.PushTokenRepository
import com.trippilot.planbdetection.api.event.DateRisk
import com.trippilot.planbdetection.api.event.PlanBTriggered
import com.trippilot.savedaccommodation.api.event.StayRegistered
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import com.trippilot.trip.domain.Trip
import com.trippilot.trip.domain.TripDestination
import com.trippilot.trip.domain.TripRepository
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.matchers.shouldBe
import io.kotest.matchers.shouldNotBe
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.transaction.IllegalTransactionStateException
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.TransactionTemplate
import java.sql.Timestamp
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.util.UUID
import java.util.concurrent.atomic.AtomicReference

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
    @Autowired private lateinit var pushTokens: PushTokenRepository
    @Autowired private lateinit var trips: TripRepository
    @Autowired private lateinit var accounts: AccountRepository
    @Autowired private lateinit var jdbc: JdbcTemplate
    @Autowired private lateinit var raiser: NotificationRaiseService
    @Autowired private lateinit var txManager: PlatformTransactionManager

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

    /** 쏠 수 있는 기기 하나 — 기본 발송기(미발송 모드)도 `SENT` 를 보고해 발송 시각이 찍힌다. */
    private fun registerDevice(accountId: UUID) {
        pushTokens.register(
            PushToken.register(
                accountId, "ExponentPushToken[${UUID.randomUUID()}]", null,
                DevicePlatform.ANDROID, OsPermission.GRANTED, Instant.now(),
            ),
        )
    }

    /** 감지가 지금 내는 위험 사건(대표 + 새 선택 필드). */
    private fun risk(accountId: UUID, tripId: UUID, kind: String, reason: String, push: Boolean, others: Int = 0) =
        PlanBTriggered(
            UUID.randomUUID().toString(), accountId.toString(), tripId.toString(), kind,
            "2026-08-11#${UUID.randomUUID()}", reason,
            affectedDate = "2026-08-11", scope = "PARTIAL_SLOTS", severity = "RISK", variant = null,
            push = push, others = others, dateRisks = emptyList(),
        )

    @Test
    fun `숙소 등록 사건이 STAY 알림이 된다`() {
        val accountId = newAccount()

        events.publish(
            StayRegistered(UUID.randomUUID().toString(), accountId.toString(), "제주 게스트하우스"),
        )
        deliver()

        val notification = notificationsOf(accountId, NotificationKind.STAY).single()
        // 문구에 재료가 실제로 들어갔는지 — payload 키가 하나만 어긋나도 여기서 빈 문자열이 된다.
        (notification.body.contains("제주 게스트하우스")) shouldBe true
        // BR-U6-01 개정(TRIP-1052·1066): 본문은 숙소 이름만 — 날짜를 싣지 않는다.
        // FE 가 날짜를 안 보내면서 모든 등록 알림이 "이름 · null ~ null" 로 나가던 결함(QA #013).
        (notification.body.contains("null")) shouldBe false
        (notification.body.contains("~")) shouldBe false
        notification.sourceEventId shouldNotBe null
    }

    /**
     * 옛 6필드 사건(새 선택 필드 없음) 회귀 — 배포 순간 아웃박스에 남아 있던 것이 이 모양이다(지금 발행처는 날씨
     * 확인을 포함해 언제나 새 필드를 싣는다). 제목은 종전 그대로이고(BR-SA-21 ①), `push` 가 없으면 푸시 대상이다
     * (BR-SA-21 ②) — 기기가 있으면 발송 시각이 찍힌다.
     */
    @Test
    fun `Plan-B 발화 사건이 PLAN_B 알림이 된다 — 옛 6필드 사건도 사유가 실리고 푸시된다`() {
        val accountId = newAccount()
        val tripId = newTrip(accountId)
        registerDevice(accountId)

        val triggerId = UUID.randomUUID().toString()
        events.publish(
            PlanBTriggered(
                triggerId, accountId.toString(), tripId.toString(),
                "WEATHER", "2026-08-11#${UUID.randomUUID()}", "비 예보로 실내 대안이 필요해요",
            ),
        )
        deliver()

        val notification = notificationsOf(accountId, NotificationKind.PLAN_B).single()
        notification.title shouldBe "일정을 다시 짜는 게 좋겠어요"
        notification.body shouldBe "비 예보로 실내 대안이 필요해요"
        // 일정 화면이 아니라 **재계획 진입**이다(BR-U6-08 '대안 일정 보기'). 일정만 열면
        // 사용자가 알림을 읽고도 무엇을 하라는 것인지 다시 찾아야 한다.
        notification.actionType shouldBe "PLANB_REPLAN"
        // 어느 트리거로 열린 재계획인지 실어야 화면이 사유를 다시 묻지 않는다. 날짜·세션 id 는 싣지 않는다.
        notification.actionPayload shouldBe mapOf("tripId" to tripId.toString(), "triggerId" to triggerId)
        notification.pushSentAt shouldNotBe null
    }

    @Test
    fun `위험 사건은 kind 제목과 외 N건 본문으로 적재되고 푸시된다`() {
        val accountId = newAccount()
        val tripId = newTrip(accountId)
        registerDevice(accountId)

        events.publish(risk(accountId, tripId, kind = "CLOSURE", reason = "성산일출봉은 매주 월요일 휴무예요.", push = true, others = 1))
        deliver()

        val notification = notificationsOf(accountId, NotificationKind.PLAN_B).single()
        notification.title shouldBe "가려던 곳의 영업을 확인해 주세요"
        notification.body shouldBe "성산일출봉은 매주 월요일 휴무예요. (외 1건)"
        notification.pushSentAt shouldNotBe null
    }

    /** 기기가 있고 토글도 켜져 있어(행 없음 = PLAN_B 푸시 기본 ON) **사건의 push 만** 푸시를 막는다. */
    @Test
    fun `푸시 대상이 아닌 사건은 알림함에만 남는다 — 구독자는 모르는 키를 무시한다`() {
        val accountId = newAccount()
        val tripId = newTrip(accountId)
        registerDevice(accountId)
        val triggerId = UUID.randomUUID().toString()
        events.publish(
            PlanBTriggered(
                triggerId, accountId.toString(), tripId.toString(), "WEATHER", null, "오후에 비 소식이 있어요.",
                affectedDate = "2026-08-11", scope = "PARTIAL_SLOTS", severity = "RISK", variant = "RAIN",
                push = false, others = 2, dateRisks = listOf(DateRisk("WEATHER", "RAIN", listOf(UUID.randomUUID().toString()))),
            ),
        )
        deliver()

        val notification = notificationsOf(accountId, NotificationKind.PLAN_B).single()
        notification.body shouldBe "오후에 비 소식이 있어요. (외 2건)"
        notification.actionPayload?.get("triggerId") shouldBe triggerId
        notification.pushSentAt shouldBe null
    }

    /**
     * 같은 여행 10분 1회(BR-SA-21 ②) — 실 DB 에서 **앞 건의 발송 시각이 다음 판정에 보이는가**.
     * 발송 시각은 JDBC 로 쓰고 판정은 JPA 로 읽는다 — 둘이 엇갈리면 두 건 다 울린다.
     */
    @Test
    fun `같은 여행의 위험 두 건은 첫 건만 푸시된다 — 둘째는 알림함에만`() {
        val accountId = newAccount()
        val tripId = newTrip(accountId)
        registerDevice(accountId)

        events.publish(risk(accountId, tripId, kind = "WEATHER", reason = "오후에 비 소식이 있어요.", push = true))
        deliver()
        events.publish(risk(accountId, tripId, kind = "CLOSURE", reason = "성산일출봉은 매주 월요일 휴무예요.", push = true))
        deliver()

        val rows = notificationsOf(accountId, NotificationKind.PLAN_B)
        rows.size shouldBe 2
        rows.single { it.title == "날씨가 일정에 영향을 줄 수 있어요" }.pushSentAt shouldNotBe null
        rows.single { it.title == "가려던 곳의 영업을 확인해 주세요" }.pushSentAt shouldBe null
    }

    /**
     * 같은 묶음의 두 사건이 **동시에** 와도 푸시는 한 번이다 — Kafka 모드(TRIP-1469)는 키(triggerId)가 다른 같은 여행의
     * 사건을 소비 스레드 여럿이 함께 배달한다. 앞 사건의 트랜잭션을 커밋 전에 붙잡아 두고 뒤 사건을 돌린다: 잠금이 없으면
     * 뒤 사건은 미커밋 발송을 못 봐 바로 또 쏜다.
     */
    @Test
    fun `같은 묶음의 두 사건이 동시에 와도 앞 사건의 발송을 기다려 한 번만 푸시한다`() {
        val accountId = newAccount()
        val tripId = newTrip(accountId)
        registerDevice(accountId)

        whileFirstUncommitted(first = { raisePlanB(accountId, tripId, "앞") }, second = { raisePlanB(accountId, tripId, "뒤") })

        pushedPlanB(accountId, tripId) shouldBe 1
        pushSentAtOf("PLAN_B#$tripId#뒤") shouldBe null // 뒤 행은 적재됐고(행이 없으면 여기서 터진다) 푸시만 생략됐다
    }

    /** 권고 잠금은 트랜잭션 밖에서는 문장 끝에 풀려 아무것도 줄 세우지 않는다 — 그런 호출은 조용히 지나가지 않고 터진다. */
    @Test
    fun `묶음 잠금은 트랜잭션 밖에서 부르면 터진다`() {
        shouldThrow<IllegalTransactionStateException> { notifications.lockPushGroup(UUID.randomUUID(), "PLAN_B#x#") }
    }

    private fun raisePlanB(accountId: UUID, tripId: UUID, note: String) = raiser.raise(
        accountId = accountId, kind = NotificationKind.PLAN_B, title = note, body = note,
        sourceEventId = UUID.randomUUID(), dedupKey = "PLAN_B#$tripId#$note",
        push = PushPolicy.OncePer("PLAN_B#$tripId#", Duration.ofMinutes(10)),
    )

    /**
     * [first] 를 트랜잭션 안에서 돌리고 **커밋 전에** 다른 스레드로 [second] 를 돌린다. 뒤 스레드는 잠금에 막혀 1초 안에
     * 끝나지 않아야 하고, 앞이 커밋한 뒤에는 끝나야 하며, 그 안의 예외는 삼키지 않고 여기서 다시 던진다.
     */
    private fun whileFirstUncommitted(first: () -> Unit, second: () -> Unit) {
        val failure = AtomicReference<Throwable>()
        var thread: Thread? = null
        TransactionTemplate(txManager).execute {
            first()
            thread = Thread { runCatching(second).onFailure(failure::set) }.apply { start() }
            thread!!.join(1_000)
            thread!!.isAlive shouldBe true // 앞 트랜잭션의 잠금을 기다리고 있다
        }
        thread!!.join(10_000)
        thread!!.isAlive shouldBe false
        failure.get()?.let { throw it }
    }

    private fun pushSentAtOf(dedupKey: String): Timestamp? =
        jdbc.queryForObject("SELECT push_sent_at FROM notification WHERE dedup_key = ?", Timestamp::class.java, dedupKey)

    /**
     * 그 계정의 알림을 도메인으로 읽지 못하게 하는 행을 심고 [block] 을 돈다 — 어휘 밖 kind(`NotificationKind.of` 는
     * fail-loud)·평면이 아닌 `action_payload`(Map<String, String> 역직렬화 실패) 두 모양이다. 공유 컨테이너라
     * 단언이 깨져도 지우도록 finally 에서 지운다.
     */
    private fun withUnreadableRow(accountId: UUID, kind: String, actionPayload: String?, block: () -> Unit) {
        val id = UUID.randomUUID()
        jdbc.update(
            "INSERT INTO notification (notification_id, account_id, kind, title, body, action_payload, occurred_at) " +
                "VALUES (?, ?, ?, 't', 'b', ?::jsonb, now())",
            id, accountId, kind, actionPayload,
        )
        try {
            block()
        } finally {
            jdbc.update("DELETE FROM notification WHERE notification_id = ?", id)
        }
    }

    /** 이 사건으로 적재되고 실제로 푸시된 PLAN_B 행 수 — 이 계정의 목록 조회(JPA)는 심은 행에서 터지므로 JDBC 로 센다. */
    private fun pushedPlanB(accountId: UUID, tripId: UUID): Int = jdbc.queryForObject(
        "SELECT count(*) FROM notification WHERE account_id = ? AND dedup_key LIKE ? AND push_sent_at IS NOT NULL",
        Int::class.java, accountId, "PLAN_B#$tripId#%",
    )!!

    /**
     * 묶음 판정은 그 계정의 최근 알림을 도메인으로 읽는다. 읽다 터진 예외가 적재 트랜잭션을 롤백하면, 릴레이가 재시도
     * 상한에서 포기할 때 알림함·푸시가 둘 다 사라진다 — 막는 것은 푸시뿐이어야 한다(BR-SA-21 ② · INV-U6-02).
     * 판정을 못 하면 푸시한다(그 계정은 목록 API 도 같은 매핑에서 죽어 있어 푸시가 유일한 길이다).
     */
    @Test
    fun `최근 알림에 모르는 kind 행이 섞여 있어도 위험 사건은 적재되고 푸시된다`() {
        val accountId = newAccount()
        val tripId = newTrip(accountId)
        registerDevice(accountId)

        withUnreadableRow(accountId, kind = "LEGACY_X", actionPayload = null) {
            events.publish(risk(accountId, tripId, kind = "WEATHER", reason = "오후에 비 소식이 있어요.", push = true))
            deliver()

            pushedPlanB(accountId, tripId) shouldBe 1
        }
    }

    /**
     * 이 모양은 Hibernate 가 행을 읽는 **도중**(저장소 프록시 안)에 터진다 — 그 자리에 트랜잭션 속성이 생기면
     * (예: 저장소에 `@Transactional(readOnly = true)`) 예외가 바깥 트랜잭션을 rollback-only 로 표시해, 푸시는 나가고
     * 행은 롤백되며 재시도마다 다시 울린다. 그 회귀를 여기서 잡는다.
     */
    @Test
    fun `최근 알림에 평면이 아닌 payload 행이 섞여 있어도 위험 사건은 적재되고 푸시된다`() {
        val accountId = newAccount()
        val tripId = newTrip(accountId)
        registerDevice(accountId)

        withUnreadableRow(accountId, kind = "PLAN_B", actionPayload = """{"x": {"y": 1}}""") {
            events.publish(risk(accountId, tripId, kind = "WEATHER", reason = "오후에 비 소식이 있어요.", push = true))
            deliver()

            pushedPlanB(accountId, tripId) shouldBe 1
        }
    }

    @Test
    fun `회고에 쓸 데이터가 없으면 액션이 없다 — 빈 화면으로 보내지 않는다(BR-U6-12)`() {
        val accountId = newAccount()
        val tripId = newTrip(accountId)

        // source=BASIC 이 "근거가 하나도 없어 기본 카드로 떨어졌다"는 신호다.
        events.publish(
            ReflectionReadyEvent(UUID.randomUUID().toString(), tripId.toString(), "2026-08-11", "DAILY", "BASIC"),
        )
        deliver()

        val notification = notificationsOf(accountId, NotificationKind.REFLECTION).single()
        notification.body shouldBe "기록할 활동이 없어 회고를 생성하지 못했습니다"
        // 액션 있는 척 그리면 사용자가 빈 화면에 도착한다(INV-4).
        notification.actionType shouldBe null
        notification.actionPayload shouldBe null
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

        val notification = notificationsOf(accountId, NotificationKind.REFLECTION).single()
        notification.title shouldBe "오늘의 회고가 준비됐어요"
        notification.actionType shouldBe "REFLECTION_DAILY"
        // 여행 하나에 하루 회고가 여러 장이라 날짜가 없으면 어느 것을 열지 정할 수 없다.
        notification.actionPayload?.get("dayDate") shouldBe "2026-08-11"
    }

    @Test
    fun `여행 요약과 하루 회고는 문구가 다르다`() {
        val accountId = newAccount()
        val tripId = newTrip(accountId)

        events.publish(ReflectionReadyEvent(UUID.randomUUID().toString(), tripId.toString(), null, "SUMMARY", "RULE"))
        deliver()

        val notification = notificationsOf(accountId, NotificationKind.REFLECTION).single()
        notification.title shouldBe "여행 요약이 준비됐어요"
        // 요약은 여행 하나로 열린다 — 하루 회고와 액션이 갈려야 화면이 다른 곳으로 간다.
        notification.actionType shouldBe "TRIP_SUMMARY"
        notification.actionPayload?.get("dayDate") shouldBe null
    }

    @Test
    fun `같은 사건이 두 번 배달돼도 알림은 하나다(INV-U6-01)`() {
        val accountId = newAccount()
        val stayId = UUID.randomUUID().toString()
        val event = StayRegistered(stayId, accountId.toString(), "같은 숙소")

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
