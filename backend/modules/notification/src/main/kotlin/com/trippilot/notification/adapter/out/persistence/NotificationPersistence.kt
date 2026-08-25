package com.trippilot.notification.adapter.out.persistence

import com.fasterxml.jackson.databind.ObjectMapper
import com.trippilot.notification.domain.Notification
import com.trippilot.notification.domain.NotificationKind
import com.trippilot.notification.domain.NotificationRepository
import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import org.hibernate.annotations.JdbcTypeCode
import org.hibernate.type.SqlTypes
import org.springframework.data.domain.PageRequest
import org.springframework.data.domain.Pageable
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.stereotype.Component
import java.time.Instant
import java.util.UUID

/**
 * notification 매핑(V2.31). 계정 파기 대상이라 append-only 가 아니다 — 읽음 표시로 UPDATE 가 일어난다.
 *
 * [actionPayload] 는 Map 으로 jsonb 매핑한다. 문자열을 미리 직렬화해 넘기면 이중 인코딩되어
 * jsonb 에 이스케이프된 스칼라가 저장된다(change_log_entry 에서 겪은 것과 같은 함정).
 */
@Entity
@Table(name = "notification")
class NotificationEntity(
    @Id @Column(name = "notification_id") var notificationId: UUID,
    @Column(name = "account_id") var accountId: UUID,
    @Column(name = "kind") var kind: String,
    @Column(name = "title") var title: String,
    @Column(name = "body") var body: String,
    @Column(name = "action_type") var actionType: String?,
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "action_payload") var actionPayload: Map<String, String>?,
    @Column(name = "source_event_id") var sourceEventId: UUID?,
    @Column(name = "dedup_key") var dedupKey: String?,
    @Column(name = "occurred_at") var occurredAt: Instant,
    @Column(name = "read_at") var readAt: Instant?,
    @Column(name = "push_sent_at") var pushSentAt: Instant?,
    @Column(name = "push_failed_reason") var pushFailedReason: String?,
)

interface NotificationJpaRepository : JpaRepository<NotificationEntity, UUID> {
    // occurred_at 동률은 id 로 갈라 순서를 결정론적으로 — 같은 폴링 배치가 여러 건을 같은 시각에 적재한다.
    fun findByAccountIdOrderByOccurredAtDescNotificationIdDesc(accountId: UUID, pageable: Pageable): List<NotificationEntity>

    fun findByAccountIdAndReadAtIsNullOrderByOccurredAtDescNotificationIdDesc(accountId: UUID, pageable: Pageable): List<NotificationEntity>

    fun existsByNotificationIdAndAccountId(notificationId: UUID, accountId: UUID): Boolean
}

@Component
class NotificationRepositoryAdapter(
    private val jpa: NotificationJpaRepository,
    private val jdbc: JdbcTemplate,
    private val mapper: ObjectMapper,
) : NotificationRepository {

    /**
     * 중복 판정을 앱에서 하지 않는 이유는 [NotificationRepository.appendIfAbsent] 에 적었다 —
     * 선검사 후 삽입은 두 인스턴스가 동시에 통과한다. JPA 대신 네이티브를 쓰는 것도 그래서다:
     * `ON CONFLICT` 는 판정과 삽입을 한 문장에 묶는 유일한 방법이고, 그 결과(삽입 행 수)가 곧 답이다.
     *
     * `source_event_id` 가 null 이면 UNIQUE 가 걸리지 않아 언제나 삽입된다 — 스케줄러가 만든 알림은
     * 원천 사건이 없고, 그쪽 멱등은 `notification_schedule.fired_at` 조건부 쓰기가 담당한다.
     */
    override fun appendIfAbsent(notification: Notification): Boolean {
        val inserted = jdbc.update(
            """
            INSERT INTO notification (
                notification_id, account_id, kind, title, body,
                action_type, action_payload, source_event_id, dedup_key, occurred_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?::jsonb, ?, ?, ?)
            ON CONFLICT (source_event_id) DO NOTHING
            """.trimIndent(),
            notification.notificationId,
            notification.accountId,
            notification.kind.name,
            notification.title,
            notification.body,
            notification.actionType,
            notification.actionPayload?.let { mapper.writeValueAsString(it) },
            notification.sourceEventId,
            notification.dedupKey,
            java.sql.Timestamp.from(notification.occurredAt),
        )
        return inserted == 1
    }

    override fun findByAccount(accountId: UUID, unreadOnly: Boolean, limit: Int): List<Notification> {
        val page = PageRequest.of(0, limit)
        val rows = if (unreadOnly) {
            jpa.findByAccountIdAndReadAtIsNullOrderByOccurredAtDescNotificationIdDesc(accountId, page)
        } else {
            jpa.findByAccountIdOrderByOccurredAtDescNotificationIdDesc(accountId, page)
        }
        return rows.map { it.toDomain() }
    }

    /**
     * 조건부 UPDATE 다 — 읽고 검사하고 쓰면 그 사이에 다른 기기가 먼저 읽음 처리할 수 있다.
     * `read_at IS NULL` 을 조건에 넣어 **처음 읽은 시각**이 나중 호출로 덮이지 않게 한다.
     */
    override fun markRead(accountId: UUID, notificationId: UUID, at: Instant): Boolean =
        jdbc.update(
            "UPDATE notification SET read_at = ? WHERE notification_id = ? AND account_id = ? AND read_at IS NULL",
            java.sql.Timestamp.from(at), notificationId, accountId,
        ) == 1

    override fun exists(accountId: UUID, notificationId: UUID): Boolean =
        jpa.existsByNotificationIdAndAccountId(notificationId, accountId)

    private fun NotificationEntity.toDomain() = Notification(
        notificationId = notificationId,
        accountId = accountId,
        // 모르는 값을 조용히 흡수하지 않는다 — 어휘가 갈린 것을 여기서 드러낸다(INV-4).
        kind = NotificationKind.of(kind),
        title = title,
        body = body,
        actionType = actionType,
        actionPayload = actionPayload,
        sourceEventId = sourceEventId,
        dedupKey = dedupKey,
        occurredAt = occurredAt,
        readAt = readAt,
        pushSentAt = pushSentAt,
        pushFailedReason = pushFailedReason,
    )
}
