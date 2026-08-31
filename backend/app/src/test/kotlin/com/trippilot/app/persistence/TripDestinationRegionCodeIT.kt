package com.trippilot.app.persistence

import com.trippilot.auth.domain.Account
import com.trippilot.auth.domain.AgeMethod
import com.trippilot.auth.domain.port.AccountRepository
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import com.trippilot.trip.domain.Trip
import com.trippilot.trip.domain.TripDestination
import com.trippilot.trip.domain.TripRepository
import io.kotest.matchers.shouldBe
import io.kotest.matchers.shouldNotBe
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.core.io.ClassPathResource
import org.springframework.jdbc.core.JdbcTemplate
import java.time.Instant
import java.time.LocalDate
import java.util.UUID

/**
 * `trip_destination.region_code` 실 DB 왕복(TRIP-361 · V2.43).
 *
 * 인메모리 Fake 로는 **원리적으로 못 보는** 것들을 여기서 본다:
 * - 컬럼이 실제로 왕복하는가(엔티티 매핑 누락은 단위테스트를 통과한다)
 * - FK 가 카탈로그에 없는 코드를 막는가
 * - 실 카탈로그 시드에서 동명이지역이 정말 여럿인가 — 대역이 아니라 **진짜 데이터**로
 */
@SpringBootTest
class TripDestinationRegionCodeIT : AbstractPostgresIntegrationTest() {

    @Autowired private lateinit var trips: TripRepository

    @Autowired private lateinit var jdbc: JdbcTemplate

    @Autowired private lateinit var accounts: AccountRepository

    private val now: Instant = Instant.parse("2026-08-01T00:00:00Z")

    /** trip.account_id 는 account 를 FK 로 건다 — 임의 UUID 를 쓰면 **엉뚱한 제약**에서 터진다. */
    private fun newAccountId(): UUID =
        accounts.save(Account.registerViaSocial(null, AgeMethod.SELF_DECLARED, null, now)).id.value

    private fun saveTrip(vararg dests: TripDestination): UUID {
        val trip = Trip.create(
            newAccountId(), "코드 왕복", LocalDate.parse("2026-09-01"), LocalDate.parse("2026-09-05"),
            2, null, null, emptyMap(), dests.toList(), now,
        )
        return trips.save(trip).tripId
    }

    @Test
    fun `region_code 가 저장되고 그대로 읽힌다`() {
        val tripId = saveTrip(TripDestination(0, "제주특별자치도", 2, regionCode = "50"))

        val loaded = trips.findById(tripId)!!.destinations.single()

        loaded.regionCode shouldBe "50"
        loaded.region shouldBe "제주특별자치도"
    }

    @Test
    fun `코드를 못 정한 목적지는 NULL 로 남는다`() {
        val tripId = saveTrip(TripDestination(0, "중구", 2, regionCode = null))

        trips.findById(tripId)!!.destinations.single().regionCode shouldBe null
    }

    /**
     * FK 가 실제로 거는지 본다. 이것이 없으면 오타 난 코드가 조용히 저장되고, 나중에 카탈로그를
     * 조인하는 쪽에서 행이 사라진다 — 원인에서 먼 자리에서 터진다.
     */
    @Test
    fun `카탈로그에 없는 코드는 저장 자체가 막힌다`() {
        val failure = runCatching {
            saveTrip(TripDestination(0, "제주", 2, regionCode = "99999"))
        }.exceptionOrNull()

        failure shouldNotBe null
        // **어느 제약인지까지 본다.** 그냥 "무결성 위반이 났다"로 두면 계정 FK 같은 다른 이유로
        // 터져도 통과한다 — 실제로 처음 판이 그렇게 가짜 초록이었다.
        val text = generateSequence(failure) { it.cause }.mapNotNull { it.message }.joinToString(" ")
        (failure is DataIntegrityViolationException) shouldBe true
        text.contains("region_code") shouldBe true
    }

    /**
     * 백필이 **확정되는 것만** 채우는가.
     *
     * 이 테스트가 필요한 이유는 역검증에서 드러났다 — 백필의 `HAVING COUNT(DISTINCT ...) = 1` 을
     * 지워도 **아무 테스트도 깨지지 않았다.** Testcontainers 는 빈 DB 로 시작하므로 마이그레이션의
     * UPDATE 가 0행을 훑고 끝나기 때문이다. 즉 그 가드는 스테이징 데이터에서만 의미가 있고,
     * 정작 거기서 틀리면 실제 여행에 엉뚱한 지역 코드가 조용히 박힌다.
     *
     * **배포되는 SQL 을 그대로 읽어 실행한다.** 여기에 SQL 을 베껴 쓰면 사본이 갈라져,
     * 마이그레이션이 바뀌어도 이 테스트는 옛 모양을 계속 지킨다.
     */
    @Test
    fun `백필은 확정되는 이름만 채우고 동명이지역은 비워 둔다`() {
        val tripId = saveTrip(
            TripDestination(0, "제주특별자치도", 1, regionCode = null),   // 정식명
            TripDestination(1, "부산", 1, regionCode = null),            // 별칭(정식명은 '부산광역시')
            TripDestination(2, "중구", 1, regionCode = null),            // 동명이지역
        )

        jdbc.execute(backfillStatement())

        val byRegion = trips.findById(tripId)!!.destinations.associateBy { it.region }
        byRegion.getValue("제주특별자치도").regionCode shouldNotBe null
        // 별칭도 채워야 한다 — 옛 행은 '부산광역시'가 아니라 '부산'으로 저장돼 있다.
        // 이것이 이 칸이 없애려는 표기 흔들림 그 자체다.
        byRegion.getValue("부산").regionCode shouldBe "26"
        // 다섯 중 하나를 집으면 부산 중구를 고른 사용자에게 서울 중구가 박힌다.
        byRegion.getValue("중구").regionCode shouldBe null
    }

    /** V2.43 이 실제로 싣고 있는 백필 UPDATE 문. 파일이 바뀌면 이 테스트도 함께 움직인다. */
    private fun backfillStatement(): String {
        val sql = ClassPathResource("db/migration/V2.43__trip_destination_region_code.sql")
            .inputStream.bufferedReader().readText()
        val start = sql.indexOf("UPDATE trip_destination")
        require(start >= 0) { "V2.43 에서 백필 UPDATE 를 찾지 못했다 — 문이 바뀌었으면 이 테스트도 고친다" }
        return sql.substring(start, sql.indexOf(';', start) + 1)
    }

    /**
     * 이 칸이 NULL 을 허용하는 근거를 **실 시드로** 확인한다. 대역이 아니라 진짜 카탈로그에서
     * 동명이지역이 여럿이어야 `singleOrNull` 가드가 지킬 대상이 존재한다.
     *
     * 숫자를 못 박지 않는 이유: 행정구역 개편(광주·전남 통합 같은)이 있으면 개수가 바뀐다.
     * 지켜야 할 것은 "겹치는 이름이 존재한다"이지 특정 개수가 아니다.
     */
    @Test
    fun `실 카탈로그에 동명이지역이 존재한다 — NULL 허용의 근거`() {
        val duplicated = jdbc.queryForList(
            """
            SELECT name, COUNT(*) AS c FROM region
            WHERE selectable GROUP BY name HAVING COUNT(*) > 1 ORDER BY c DESC
            """.trimIndent(),
        )

        (duplicated.isNotEmpty()) shouldBe true
        // '중구' 처럼 광역시마다 있는 이름이 대표 사례다.
        duplicated.any { (it["name"] as String) == "중구" } shouldBe true
    }
}
