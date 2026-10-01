package com.trippilot.app.persistence

import com.trippilot.savedaccommodation.application.RegisterStayCommand
import com.trippilot.savedaccommodation.application.SavedStayService
import com.trippilot.savedaccommodation.domain.RegisterRoute
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.jdbc.core.JdbcTemplate
import java.util.UUID

/**
 * 삭제(소프트)된 여행의 거점은 '사용 중'이 아니다(TRIP-1061 (b) · QA #024 계열).
 *
 * 종전에는 `existsBySavedStayId` 가 여행 삭제 여부를 안 봐서, 화면은 '연결된 여행 없음'
 * (조회는 삭제분을 거른다)인데 숙소 삭제만 409 로 막히는 모순이 있었다 — 그 숙소를 영영 못 지운다.
 * 판정이 trip.deleted_at 조인이라 **실 DB 로만** 검증된다.
 */
@SpringBootTest
class DeletedTripBaseGuardIT : AbstractPostgresIntegrationTest() {

    @Autowired private lateinit var stays: SavedStayService
    @Autowired private lateinit var jdbc: JdbcTemplate

    private fun pin(name: String) = RegisterStayCommand(
        name = name, lat = 33.5, lng = 126.5, coordConfirmed = true,
        checkIn = null, checkOut = null, externalSource = null, externalId = null,
        registerRoute = RegisterRoute.PIN, memo = null,
    )

    @Test
    fun `여행이 소프트 삭제되면 그 거점 숙소를 지울 수 있다 - 살아 있는 여행이면 여전히 409`() {
        val account = UUID.randomUUID()
        jdbc.update("INSERT INTO account (account_id, age_method, age_confirmed_at) VALUES (?, 'SELF_DECLARED', now())", account)
        val stay = stays.register(account, pin("거점 판정 숙소"))
        val trip = UUID.randomUUID()
        jdbc.update(
            """
            INSERT INTO trip (trip_id, account_id, title, start_date, end_date, party, preference_snapshot)
            VALUES (?, ?, '거점 판정', DATE '2026-10-01', DATE '2026-10-03', 2, '{}'::jsonb)
            """.trimIndent(),
            trip, account,
        )
        jdbc.update(
            "INSERT INTO base_assignment (trip_id, saved_stay_id, date_from, date_to) VALUES (?, ?, DATE '2026-10-01', DATE '2026-10-03')",
            trip, stay.savedStayId,
        )

        // 살아 있는 여행의 거점 — 기존 규칙 그대로 막힌다(INV-U1-08 계열).
        shouldThrow<com.trippilot.core.error.ConflictDetected> { stays.delete(account, stay.savedStayId) }

        jdbc.update("UPDATE trip SET deleted_at = now() WHERE trip_id = ?", trip)

        // 삭제된 여행의 배정 행은 남아 있어도 '사용 중'이 아니다 — 이제 지워진다.
        stays.delete(account, stay.savedStayId)
        jdbc.queryForObject(
            "SELECT count(*) FROM saved_stay WHERE saved_stay_id = ?", Int::class.java, stay.savedStayId,
        ) shouldBe 0
    }
}
