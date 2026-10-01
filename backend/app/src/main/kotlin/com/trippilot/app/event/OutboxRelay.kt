package com.trippilot.app.event

import com.trippilot.core.event.EventEnvelope
import com.trippilot.core.event.OutboxSubscriber
import io.micrometer.core.instrument.MeterRegistry
import io.micrometer.core.instrument.Timer
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock
import org.slf4j.LoggerFactory
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.scheduling.annotation.Scheduled
import org.springframework.stereotype.Component
import java.sql.ResultSet
import java.time.Clock
import java.time.Duration
import java.util.UUID

/**
 * 아웃박스 릴레이(TRIP-539) — 적재된 이벤트를 [OutboxSubscriber] 에게 배달한다.
 *
 * ## 왜 폴링인가
 *
 * 브로커(Kafka·SQS)는 운영 축을 통째로 추가한다. 이 규모에서는 아웃박스 + DB 폴링으로 충분하고,
 * 발송량이 폴링으로 감당 안 될 때 재평가한다(U6 tech-stack §4).
 * 선례도 이미 있다 — `StalePartialSweeper` 가 같은 형태로 돈다.
 *
 * ## 락이 왜 필요한가
 *
 * 다중 인스턴스에서 둘이 같은 행을 집으면 **푸시가 두 번 나간다**. ShedLock 테이블은 V1.0 부터
 * 있었는데 라이브러리가 없어 아무도 쓰지 못했다 — 이 티켓에서 붙였다.
 *
 * ## at-least-once 이지 exactly-once 가 아니다
 *
 * 배달 후 `published_at` 을 찍기 전에 프로세스가 죽으면 다음 폴링이 **다시 배달**한다.
 * 그래서 구독자가 `eventId` 로 멱등을 보장해야 한다([OutboxSubscriber] 계약).
 * 순서를 바꾸면(먼저 표시 → 배달) 이번엔 **한 번도 안 가는** 경우가 생긴다 — 중복이 유실보다 낫다.
 */
@Component
class OutboxRelay(
    private val jdbc: JdbcTemplate,
    registry: MeterRegistry,
    subscribers: List<OutboxSubscriber>,
    /**
     * 지연 계측의 **끝점**. 시작점(`occurred_at`)도 앱이 찍으므로 **같은 종류의 시계**다 —
     * 종전에는 끝점만 DB `now()` 라 앱·DB 시계 차가 그대로 값에 섞였다(아래 [recordLatency] 참고).
     *
     * ⚠ 다중 인스턴스에서는 **적재한 인스턴스와 배달하는 인스턴스가 다를 수 있다.** 그때는 두 앱
     * 시계 사이의 NTP 편차가 남는데, 그건 DB 와의 편차보다 작고 무엇보다 **음수가 나오면 보인다**
     * (아래 경고). 완전히 없애려면 DB 가 찍는 적재 시각 컬럼이 따로 필요하고, 그건 `occurred_at`
     * 의 의미(도메인 사건 발생 시각)를 바꾸지 않으려면 컬럼 추가가 된다 — 지금 값이 안 된다.
     */
    private val clock: Clock,
) {
    /**
     * 릴레이 지연(OBS-U6-01) — **분위수를 내보내도록 등록한다.**
     *
     * `registry.timer(name)` 으로 만들면 count·sum·max 만 나가고 **p95 가 없다.** 이 지표의 존재
     * 이유가 PERF-U6-01 목표 대조인데 그 대조를 못 하게 된다 — 지표가 있는데 답을 못 하는 상태라
     * 그냥 없는 것보다 나쁘다(있다고 믿게 된다).
     *
     * 클라이언트 계산(`publishPercentiles`) 대신 히스토그램을 고른 이유는 **다중 인스턴스**다
     * (REL-U6-04 가 그것을 전제한다). 인스턴스별로 계산한 분위수는 수집기에서 합칠 수 없다 —
     * 평균의 평균과 같은 종류의 거짓말이 된다. 버킷을 보내면 합산 후 계산이 성립한다.
     *
     * 기대 범위를 묶는 것은 **버킷 수 상한**이다. 열어 두면 마이크로초부터 시간 단위까지 버킷이
     * 생겨 시계열이 불어난다.
     *
     * **아래를 100ms 로 두는 이유**: 폴링 주기(2초)는 *더해지는 지연의 상한*이지 하한이 아니다 —
     * 틱 직전에 적재된 이벤트는 지연이 거의 0 이라, 정상 구간이 사실상 **0~2초 균등**이다.
     * 여기를 1초로 잡으면 그 구간의 절반이 첫 버킷에 뭉개져 p50·p75 가 해석 불가가 되고,
     * "빨라졌다"를 볼 수 없게 된다(앞선 판이 그랬다 — 폴링 주기를 하한으로 착각했다).
     * 위(15분)는 재시도 창(약 13분)을 넘기면 어차피 포기된 건이라는 데서 나온다.
     */
    private val relayLatency: Timer = Timer.builder(RELAY_LATENCY)
        .description("아웃박스 적재에서 배달까지의 지연(OBS-U6-01)")
        .publishPercentileHistogram()
        .minimumExpectedValue(Duration.ofMillis(100))
        .maximumExpectedValue(Duration.ofMinutes(15))
        .register(registry)

    /** 타입당 여럿일 수 있다 — 한 이벤트를 여러 소비자가 본다. */
    private val byType: Map<String, List<OutboxSubscriber>> = subscribers.groupBy { it.eventType }

    @Scheduled(fixedDelayString = "\${trippilot.outbox.relay-delay-ms:2000}",
        // **첫 발화도 미룰 수 있어야 한다.** fixedDelay 는 주기만 정하고 기동 직후 1회는 그대로 쏜다 —
        // 테스트가 주기를 1시간으로 늘려 "껐다"고 적어 둔 것이 실제로는 안 꺼져 있었다(실측: 배경
        // 스레드가 테스트와 동시에 배달해 OutboxRelayIT 가 간헐 실패). 운영 기본은 0 이라 무변경.
        initialDelayString = "\${trippilot.outbox.relay-initial-delay-ms:0}")
    // lockAtMostFor 는 **죽은 인스턴스가 락을 영원히 붙잡는 것**을 막는 안전망이다.
    // lockAtLeastFor 는 0 이다 — cron 방식의 시계 오차 이중 실행을 막는 장치인데 여기는 fixedDelay 라
    // 같은 인스턴스가 겹쳐 돌지 않고, 0 이 아니면 **연속 호출이 조용히 건너뛰어진다**(테스트에서 겪었다).
    // lockAtMostFor 는 **한 번의 실행이 걸릴 수 있는 최대 시간보다 길어야** 한다. 짧으면 처리 도중에
    // 락이 풀려 다른 인스턴스가 같은 행을 집는다 — 그 순간 락이 있는 의미가 없다.
    // [BATCH_SIZE] × 구독자 작업(외부 호출 포함)을 넉넉히 덮는 값이다. 죽은 인스턴스가 붙잡는 시간도
    // 이만큼이지만, 중복 배달보다 회복 지연이 낫다.
    @SchedulerLock(name = "outbox-relay", lockAtMostFor = "PT5M", lockAtLeastFor = "PT0S")
    fun relay() {
        val batch = jdbc.query(
            """
            SELECT event_id, event_type, schema_version, aggregate_type, aggregate_id,
                   correlation_id, payload, occurred_at
              FROM outbox_event
             WHERE published_at IS NULL AND attempts < ? AND next_attempt_at <= now()
             ORDER BY occurred_at
             LIMIT ?
            """.trimIndent(),
            { rs, _ -> rs.toEnvelope() },
            MAX_ATTEMPTS, BATCH_SIZE,
        )
        if (batch.isEmpty()) return

        var dropped = 0
        batch.forEach { envelope ->
            val targets = byType[envelope.eventType]
            if (targets == null) {
                // 아무도 안 듣는 이벤트다. 남겨 두면 배치가 그것으로 채워져 뒤가 밀리고,
                // **나중에 구독자가 생겼을 때 쌓인 과거가 한꺼번에 배달된다**(오래된 알림 폭탄).
                // 지나간 알림은 다시 보낼 값이 없으므로 여기서 닫는다.
                markPublished(envelope.eventId)
                dropped++
                return@forEach
            }
            runCatching { targets.forEach { it.handle(envelope) }; markPublished(envelope.eventId) }
                .onSuccess { published ->
                    // OBS-U6-01 — 적재(occurred_at)에서 배달까지. **구독자 없어 닫은 건은 빼고**
                    // 실제로 배달된 것만 잰다. 그쪽을 섞으면 즉시 닫히는 값이 p95 를 끌어내려
                    // "빠르다"는 착시가 생긴다.
                    //
                    // **경과는 앱 시계로 잰다.** 종전에는 DB 가 `now() - occurred_at` 으로 계산했는데,
                    // `occurred_at` 은 앱이 찍은 값이라 **시작과 끝이 다른 시계**였다. 두 시계가
                    // 수십 ms 만 어긋나도(컨테이너·다른 호스트에서는 흔하다) 값이 음수가 되고,
                    // Micrometer 는 음수 기록을 **조용히 버린다** — 지표는 0 인데 배달은 되고 있어
                    // "계측이 아예 안 붙었다"처럼 보인다(실측: 로컬 −8~−29ms, CI 는 통과).
                    if (published) recordLatency(envelope)
                }
                .onFailure { e ->
                    val attempts = bumpAttempts(envelope.eventId)
                    // 상한에 닿으면 조용히 사라지지 않게 올린다 — dead-letter 테이블 없이 조회로 찾는다.
                    if (attempts >= MAX_ATTEMPTS) {
                        log.error("이벤트 배달을 포기합니다 — eventId={} type={} attempts={}", envelope.eventId, envelope.eventType, attempts, e)
                    } else {
                        log.warn("이벤트 배달 실패 — 재시도합니다. eventId={} attempts={}", envelope.eventId, attempts, e)
                    }
                }
        }
        // 조용히 버리지 않는다 — 구독자를 붙였는데 안 오는 상황의 첫 단서가 이 줄이다(INV-4).
        if (dropped > 0) log.info("구독자 없는 이벤트 {}건을 닫았습니다.", dropped)
    }

    /**
     * 발행으로 표시하고 **적재→배달 지연(초)** 을 돌려준다(OBS-U6-01).
     *
     * 지연을 DB 가 계산하는 이유: 앱 시계로 `now() - occurred_at` 을 하면 **두 시계의 차이가 그대로
     * 지표에 섞인다.** 어긋난 방향에 따라 음수가 나오는데 Micrometer 는 음수를 **조용히 버려서**,
     * 지표가 비는 것을 아무도 눈치채지 못한다. 같은 UPDATE 안에서 같은 시계로 재면 그 문제가 없다.
     */
    /**
     * 지연 1건 기록 — **음수면 버리되 소리를 낸다**(INV-4).
     *
     * Micrometer 는 음수 기록을 예외도 로그도 없이 **그냥 무시한다.** 그래서 종전 결함이
     * "지표가 0 인데 배달은 되고 있다"로만 보였고, 계측이 아예 안 붙은 것과 구분되지 않았다.
     * 여기까지 오는 음수는 이제 **시계가 뒤로 간 경우뿐**이므로(두 끝이 같은 시계다) 드물고,
     * 드물기에 더더욱 조용하면 안 된다.
     */
    private fun recordLatency(envelope: EventEnvelope) {
        val elapsed = Duration.between(envelope.occurredAt, clock.instant())
        if (elapsed.isNegative) {
            log.warn(
                "적재 시각이 미래라 지연 표본을 버립니다 — 시계가 뒤로 갔습니다. eventId={} occurredAt={}",
                envelope.eventId, envelope.occurredAt,
            )
            return
        }
        relayLatency.record(elapsed)
    }

    /**
     * 발행 표시. 실제로 이 호출이 닫았으면 true — 경과 계산은 호출측이 앱 시계로 한다.
     *
     * **행이 없으면 false 다**(종전에는 `queryForObject` 가 예외를 던져 *배달 실패*로 접혔다).
     * 새 쪽이 맞다 — 여기 오기 전에 구독자는 이미 다 돌았으므로, 없는 행에 시도 횟수를 올려 봐야
     * 다음 폴링이 집을 대상도 없다. 실제로 그 경로는 이 리포에 없다(아웃박스는 지우지 않는다).
     */
    private fun markPublished(eventId: UUID): Boolean =
        jdbc.update("UPDATE outbox_event SET published_at = now() WHERE event_id = ?", eventId) > 0

    /**
     * 시도 횟수를 올리고 **다음 시도 시각을 뒤로 민다**(REL-U6-01 지수 백오프). 증가된 값을 돌려준다 —
     * 상한 판정을 다시 조회하지 않게.
     *
     * 한 번의 UPDATE 로 둘을 함께 바꾼다. 나눠 쓰면 그 사이에 다른 인스턴스가 같은 행을 집을 수 있고,
     * 그 순간 백오프가 없는 것과 같아진다.
     *
     * `SET` 우변의 `attempts` 는 **증가 전 값**이다(표준) — 첫 실패면 0 이라 `BACKOFF_BASE_SEC` 가 그대로
     * 첫 지연이 된다.
     */
    private fun bumpAttempts(eventId: UUID): Int = jdbc.queryForObject(
        """
        UPDATE outbox_event
           SET attempts = attempts + 1,
               next_attempt_at = now() + make_interval(
                   secs => LEAST(?::double precision, ?::double precision * power(2, attempts))
               )
         WHERE event_id = ?
        RETURNING attempts
        """.trimIndent(),
        Int::class.java, BACKOFF_MAX_SEC, BACKOFF_BASE_SEC, eventId,
    ) ?: 0

    private fun ResultSet.toEnvelope() = EventEnvelope(
        eventId = getObject("event_id", UUID::class.java),
        eventType = getString("event_type"),
        schemaVersion = getInt("schema_version"),
        aggregateType = getString("aggregate_type"),
        aggregateId = getString("aggregate_id"),
        correlationId = getString("correlation_id"),
        occurredAt = getTimestamp("occurred_at").toInstant(),
        payload = getString("payload"),
    )

    private companion object {
        private val log = LoggerFactory.getLogger(OutboxRelay::class.java)

        /** 한 번에 집는 양. 크게 잡으면 락을 오래 쥐고, 작으면 밀린 이벤트가 안 빠진다. */
        private const val BATCH_SIZE = 100

        /** 이 횟수를 넘기면 포기한다. 조회로 찾는다 — `WHERE published_at IS NULL AND attempts >= 10`. */
        private const val MAX_ATTEMPTS = 10

        /**
         * 첫 재시도까지의 지연(초). 폴링 주기(2초)와 같은 값이라 **첫 실패는 종전과 같은 속도로** 다시 간다 —
         * 일시적 딸꾹질을 백오프가 괜히 늦추지 않는다. 두 번째부터 4·8·16… 으로 벌어진다.
         */
        private const val BACKOFF_BASE_SEC = 2.0

        /**
         * 지연 상한(초 = 5분). 없으면 9회째가 1024초(17분)가 되어 **상대가 살아난 뒤에도 한참 안 간다**.
         * 이 상한에서 10회까지의 총 재시도 창은 약 13분이다(종전엔 20초였다 — 재시도가 이름만 있었다).
         */
        private const val BACKOFF_MAX_SEC = 300.0

        /** 릴레이 지연(OBS-U6-01) — PERF-U6-01 목표 대조용. */
        private const val RELAY_LATENCY = "trippilot.outbox.relay.latency"
    }
}
