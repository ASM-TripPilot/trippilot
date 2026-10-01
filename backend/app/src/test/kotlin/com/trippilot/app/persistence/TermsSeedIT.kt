package com.trippilot.app.persistence

import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import io.kotest.matchers.ints.shouldBeGreaterThan
import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.jdbc.core.JdbcTemplate

/**
 * 약관 시드 재발 잠금(TRIP-1004). "약관 본문이 전부 플레이스홀더" 가 실화면 QA 에서 **두 회차 연속**
 * 발견됐다(2026-09-25 #028 → 09-26 #003) — 시드는 고쳐도 이런 게이트가 없으면 또 조용히 돌아온다.
 *
 * R__ 시드는 체크섬이 바뀔 때 재실행되므로, 이 IT 는 "커밋된 시드가 실제로 본문을 심는다"를
 * 마이그레이션 직후 DB 에서 직접 확인한다.
 */
@SpringBootTest
class TermsSeedIT : AbstractPostgresIntegrationTest() {

    @Autowired private lateinit var jdbc: JdbcTemplate

    @Test
    fun `약관 6종 전부 실본문이 심겨 있다 - 플레이스홀더 0건`() {
        val required = setOf(
            "TERMS_OF_SERVICE", "PRIVACY_POLICY", "LOCATION_TERMS",
            "MARKETING", "GPS_RECORDING", "PERSONALIZATION",
        )
        val rows = jdbc.queryForList(
            "SELECT terms_type, body FROM terms_version WHERE version = '1.0'",
        ).associate { it["terms_type"] as String to it["body"] as String }

        rows.keys shouldBe required
        rows.forEach { (type, body) ->
            // "[플레이스홀더]" 가 본문 어디에도 없어야 한다 — 접두가 아니라 전체를 훑는다(부분 방치 차단).
            body.contains("플레이스홀더") shouldBe false
            // 실본문 하한 — 한 줄짜리 대체 문구로 게이트를 속이지 못하게. 가장 짧은 초안(개인화 동의)도 이보다 길다.
            withClue(type) { body.length shouldBeGreaterThan 500 }
        }
    }

    private fun withClue(clue: String, block: () -> Unit) = io.kotest.assertions.withClue(clue, block)
}
