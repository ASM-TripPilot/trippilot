package com.trippilot.reflection.adapter.out.persistence

import com.trippilot.reflection.domain.port.ShareCardUsageRepository
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.stereotype.Component
import java.time.LocalDate
import java.util.UUID

/**
 * `share_card_copy_usage`(V2.85) — 계정당 한 행. 날이 바뀌면 같은 행을 1 로 되돌려 쓴다.
 *
 * `ON CONFLICT ... DO UPDATE ... WHERE` 가 **갱신 조건**을 걸어, 상한에 닿은 행은 갱신하지 않고 `RETURNING` 이 0행이 된다.
 * 충돌 행은 갱신 전에 잠기므로(Postgres) 같은 계정의 동시 요청은 줄을 서고 뒤쪽은 앞쪽이 더한 값을 본다.
 *
 * **날은 앞으로만 간다.** 저장된 날보다 **새** 날이면 1 로 되돌리고, 같은 날이면 더한다. 저장된 날보다 **옛** 날의 요청(자정 근처에
 * 파드 시계가 어긋나 늦게 도착한 것)은 행을 되돌리지 않고 **저장된(새) 날의 횟수로** 센다 — 옛 날로 되돌리면 새 날의 횟수가 지워져
 * 상한이 우회된다. 그래서 날은 `GREATEST` 로 두고, 더하기 판정은 "새 날이 아니면 지금 횟수 < 상한"이다.
 */
@Component
class ShareCardUsageRepositoryAdapter(private val jdbc: JdbcTemplate) : ShareCardUsageRepository {

    override fun claim(accountId: UUID, day: LocalDate, limit: Int): Boolean = jdbc.query(
        """
        INSERT INTO share_card_copy_usage (account_id, day, calls) VALUES (?, ?, 1)
        ON CONFLICT (account_id) DO UPDATE
           SET calls = CASE WHEN share_card_copy_usage.day < EXCLUDED.day THEN 1 ELSE share_card_copy_usage.calls + 1 END,
               day = GREATEST(share_card_copy_usage.day, EXCLUDED.day)
         WHERE share_card_copy_usage.day < EXCLUDED.day OR share_card_copy_usage.calls < ?
        RETURNING calls
        """.trimIndent(),
        { rs, _ -> rs.getInt(1) }, accountId, java.sql.Date.valueOf(day), limit,
    ).isNotEmpty()
}
