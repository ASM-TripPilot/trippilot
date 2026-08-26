package com.trippilot.notification.adapter.out.persistence

import com.trippilot.notification.domain.NotificationKind
import com.trippilot.notification.domain.NotificationToggle
import com.trippilot.notification.domain.NotificationToggleRepository
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.stereotype.Component
import java.sql.ResultSet
import java.time.Instant
import java.util.UUID

/**
 * notification_toggle 매핑(V2.35). 복합 PK `(account_id, kind)` 라 종류당 한 행이 DB 로 보장된다.
 *
 * JPA `@IdClass` 대신 네이티브를 쓰는 이유는 upsert 때문이다 — "있으면 덮고 없으면 만든다"를
 * 한 문장으로 하려면 `ON CONFLICT` 가 필요하고, 그래야 두 기기가 동시에 눌러도 한쪽이 실패하지 않는다.
 */
@Component
class NotificationToggleRepositoryAdapter(private val jdbc: JdbcTemplate) : NotificationToggleRepository {

    override fun findByAccount(accountId: UUID): List<NotificationToggle> = jdbc.query(
        "SELECT account_id, kind, push_enabled, in_app_enabled, updated_at FROM notification_toggle WHERE account_id = ?",
        { rs, _ -> rs.toDomain() },
        accountId,
    )

    override fun upsert(toggle: NotificationToggle): NotificationToggle {
        jdbc.update(
            """
            INSERT INTO notification_toggle (account_id, kind, push_enabled, in_app_enabled, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT (account_id, kind) DO UPDATE
               SET push_enabled = EXCLUDED.push_enabled,
                   in_app_enabled = EXCLUDED.in_app_enabled,
                   updated_at = EXCLUDED.updated_at
            """.trimIndent(),
            toggle.accountId, toggle.kind.name, toggle.pushEnabled, toggle.inAppEnabled,
            java.sql.Timestamp.from(toggle.updatedAt),
        )
        return toggle
    }

    private fun ResultSet.toDomain() = NotificationToggle(
        accountId = getObject("account_id", UUID::class.java),
        // 모르는 값을 조용히 흡수하지 않는다 — 어휘가 갈린 것을 여기서 드러낸다(INV-4).
        kind = NotificationKind.of(getString("kind")),
        pushEnabled = getBoolean("push_enabled"),
        inAppEnabled = getBoolean("in_app_enabled"),
        updatedAt = getTimestamp("updated_at").toInstant(),
    )
}
