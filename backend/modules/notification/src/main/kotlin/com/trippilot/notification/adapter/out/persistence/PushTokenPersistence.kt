package com.trippilot.notification.adapter.out.persistence

import com.trippilot.notification.domain.DevicePlatform
import com.trippilot.notification.domain.OsPermission
import com.trippilot.notification.domain.PushToken
import com.trippilot.notification.domain.PushTokenRepository
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.stereotype.Component
import java.time.Instant
import java.util.UUID

/**
 * push_token 매핑(V2.40).
 *
 * JPA 가 아니라 네이티브인 이유는 두 가지 쓰기가 **조건을 SQL 안에 넣어야** 하기 때문이다:
 * 등록은 `ON CONFLICT (token)` 로 계정 이전까지 한 문장에서 처리하고, 무효화는
 * `invalidated_at IS NULL` 을 조건에 넣어 "언제 죽었나"가 나중 시도로 밀리지 않게 한다.
 */
@Component
class PushTokenRepositoryAdapter(private val jdbc: JdbcTemplate) : PushTokenRepository {

    /**
     * 토큰이 이미 있으면 **그 행을 새 계정으로 옮긴다**. 기기 교체·계정 전환의 실제 모습이고,
     * 그러지 않으면 UNIQUE 에 걸려 등록이 실패하거나(로그인이 막힌다) 남의 알림이 그 기기로 간다.
     *
     * 재등록은 `invalidated_at` 을 지워 **되살린다** — 앱을 지웠다 다시 깐 기기가 죽은 채로 남으면
     * 알림이 영영 안 간다.
     */
    override fun register(token: PushToken): PushToken {
        jdbc.update(
            """
            INSERT INTO push_token (push_token_id, account_id, token, device_id, platform, os_permission,
                                    last_seen_at, invalidated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
            ON CONFLICT (token) DO UPDATE SET
                account_id = EXCLUDED.account_id,
                device_id = EXCLUDED.device_id,
                platform = EXCLUDED.platform,
                os_permission = EXCLUDED.os_permission,
                last_seen_at = EXCLUDED.last_seen_at,
                invalidated_at = NULL
            """.trimIndent(),
            token.pushTokenId, token.accountId, token.token, token.deviceId,
            token.platform.name, token.osPermission.name, java.sql.Timestamp.from(token.lastSeenAt),
        )
        // 갱신이었으면 기존 `push_token_id` 가 살아 있다 — 방금 만든 id 가 아니라 저장된 것을 돌려준다.
        return findByToken(token.token) ?: token
    }

    override fun findActive(accountId: UUID): List<PushToken> = jdbc.query(
        """
        SELECT push_token_id, account_id, token, device_id, platform, os_permission, last_seen_at, invalidated_at
          FROM push_token
         WHERE account_id = ? AND invalidated_at IS NULL
         ORDER BY last_seen_at DESC
        """.trimIndent(),
        { rs, _ -> rs.toToken() },
        accountId,
    )

    override fun invalidate(token: String, at: Instant): Boolean = jdbc.update(
        "UPDATE push_token SET invalidated_at = ? WHERE token = ? AND invalidated_at IS NULL",
        java.sql.Timestamp.from(at), token,
    ) == 1

    override fun remove(accountId: UUID, token: String): Boolean =
        jdbc.update("DELETE FROM push_token WHERE token = ? AND account_id = ?", token, accountId) == 1

    private fun findByToken(token: String): PushToken? = jdbc.query(
        """
        SELECT push_token_id, account_id, token, device_id, platform, os_permission, last_seen_at, invalidated_at
          FROM push_token WHERE token = ?
        """.trimIndent(),
        { rs, _ -> rs.toToken() },
        token,
    ).firstOrNull()

    private fun java.sql.ResultSet.toToken() = PushToken(
        pushTokenId = getObject("push_token_id", UUID::class.java),
        accountId = getObject("account_id", UUID::class.java),
        token = getString("token"),
        deviceId = getString("device_id"),
        platform = DevicePlatform.valueOf(getString("platform")),
        osPermission = OsPermission.valueOf(getString("os_permission")),
        lastSeenAt = getTimestamp("last_seen_at").toInstant(),
        invalidatedAt = getTimestamp("invalidated_at")?.toInstant(),
    )
}
