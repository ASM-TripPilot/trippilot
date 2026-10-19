package com.trippilot.app.persistence

import com.trippilot.auth.domain.Account
import com.trippilot.auth.domain.AgeMethod
import com.trippilot.auth.domain.port.AccountRepository
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import com.trippilot.trip.api.TripWatchFacade
import com.trippilot.trip.api.WatchedTrip
import com.trippilot.trip.domain.Trip
import com.trippilot.trip.domain.TripDestination
import com.trippilot.trip.domain.TripRepository
import io.kotest.matchers.collections.shouldContainExactlyInAnyOrder
import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.jdbc.core.JdbcTemplate
import java.time.Instant
import java.time.LocalDate
import java.util.UUID

/**
 * 감시 대상 여행 조회 실 DB 검증(설계서 T-IT-3) — Plan-B 상황 스윕이 매 회차 훑는 목록.
 *
 * 여기서만 보이는 것: 겹침 술어의 경계(오늘 끝남·내일 시작 포함, 모레 시작·어제 끝남 제외)와 삭제·종료 기록 제외가
 * 한 SQL 안에서 같은 집합을 내는가, 첫 페이지의 **널 키셋 파라미터**가 PG 에서 바인딩되는가, 키셋으로 이어 읽은 페이지가
 * 한 번에 읽은 것과 같은가. 같은 컨테이너의 다른 IT 여행이 섞일 수 있어 **이 테스트가 만든 여행으로만** 좁혀 본다.
 * 날짜는 다른 IT 가 쓰지 않는 먼 날(2032-03-10)이다 — 조회가 실 시계와 무관하게 인자로만 판정하기 때문이다.
 */
@SpringBootTest
class TripWatchQueryIT : AbstractPostgresIntegrationTest() {

    @Autowired private lateinit var watch: TripWatchFacade
    @Autowired private lateinit var trips: TripRepository
    @Autowired private lateinit var accounts: AccountRepository
    @Autowired private lateinit var jdbc: JdbcTemplate

    private val today = LocalDate.parse("2032-03-10")
    private val tomorrow = today.plusDays(1)
    private val now = Instant.parse("2026-10-19T00:00:00Z")

    private fun account(): UUID = accounts.save(Account.registerViaSocial(null, AgeMethod.SELF_DECLARED, null, now)).id.value

    private fun trip(accountId: UUID, start: LocalDate, end: LocalDate): UUID = trips.save(
        Trip.create(
            accountId = accountId, title = null, startDate = start, endDate = end,
            party = 1, companionType = null, budgetTotal = null, preferenceSnapshot = emptyMap(),
            destinations = listOf(TripDestination(0, "제주", (end.toEpochDay() - start.toEpochDay()).toInt())), now = now,
        ),
    ).tripId

    /** 키셋으로 끝까지 — [limit] 보다 적게 오면 끝이다(퍼사드 계약). */
    private fun readAll(from: LocalDate, to: LocalDate, limit: Int): List<List<WatchedTrip>> {
        val pages = mutableListOf<List<WatchedTrip>>()
        var after: UUID? = null
        repeat(MAX_PAGES) {
            val page = watch.findOverlapping(from, to, after, limit)
            pages += page
            if (page.size < limit) return pages
            after = page.last().tripId
        }
        error("키셋이 앞으로 가지 않습니다 — ${MAX_PAGES}쪽을 넘게 읽었습니다.")
    }

    private companion object {
        /** 키셋이 제자리를 돌면(커서 무시) 무한 반복이 된다 — 그 경우를 실패로 끊는다. */
        private const val MAX_PAGES = 10_000
    }

    @Test
    fun `진행 중·오늘 끝남·내일 시작은 들고, 모레 시작·어제 끝남·삭제·종료 기록은 뺀다`() {
        val acc = account()
        val inProgress = trip(acc, today.minusDays(1), today.plusDays(1))
        val endsToday = trip(acc, today.minusDays(2), today)
        val startsTomorrow = trip(acc, tomorrow, tomorrow.plusDays(1))
        val startsDayAfter = trip(acc, today.plusDays(2), today.plusDays(3))
        val endedYesterday = trip(acc, today.minusDays(3), today.minusDays(1))
        val deleted = trip(acc, today.minusDays(1), today.plusDays(1))
        val endedMarked = trip(acc, today.minusDays(1), today.plusDays(1))
        jdbc.update("UPDATE trip SET deleted_at = now() WHERE trip_id = ?", deleted) shouldBe 1
        jdbc.update("UPDATE trip SET ended_at = now() WHERE trip_id = ?", endedMarked) shouldBe 1
        val mine = setOf(inProgress, endsToday, startsTomorrow, startsDayAfter, endedYesterday, deleted, endedMarked)

        val found = watch.findOverlapping(today, tomorrow, null, 500).filter { it.tripId in mine }

        found.map { it.tripId } shouldContainExactlyInAnyOrder listOf(inProgress, endsToday, startsTomorrow)
        // 스케줄러 경로에는 요청 계정이 없다 — 소유 계정과 구간을 행에서 그대로 준다.
        found.single { it.tripId == startsTomorrow } shouldBe WatchedTrip(startsTomorrow, acc, tomorrow, tomorrow.plusDays(1))
        // 끝 날짜가 [to] 다 — 오늘만 물으면 내일 시작 여행은 빠진다(저녁 D-1 점검만 내일까지 묻는다).
        watch.findOverlapping(today, today, null, 500).map { it.tripId }.filter { it in mine } shouldContainExactlyInAnyOrder
            listOf(inProgress, endsToday)
    }

    @Test
    fun `키셋으로 이어 읽은 페이지는 한 번에 읽은 것과 같은 순서·같은 집합이다 — 빠짐·겹침 없이`() {
        val acc = account()
        val mine = List(5) { trip(acc, today.minusDays(1), today.plusDays(1)) }.toSet()

        val whole = watch.findOverlapping(today, today, null, 500).filter { it.tripId in mine }
        val pages = readAll(today, today, 2)
        val stitched = pages.flatten().filter { it.tripId in mine }

        stitched shouldBe whole
        whole.map { it.tripId }.toSet() shouldBe mine
        // 페이지 사이에 행이 겹치지 않는다 — 다음 페이지는 앞 페이지 마지막 키 **다음**부터다.
        pages.flatten().map { it.tripId }.let { it.size shouldBe it.toSet().size }
    }

    @Test
    fun `페이지 크기 0 은 1건으로 묶인다 — 빈 페이지가 끝으로 읽혀 회차가 조용히 비지 않게`() {
        val acc = account()
        trip(acc, today.minusDays(1), today.plusDays(1))

        watch.findOverlapping(today, today, null, 0).size shouldBe 1
    }
}
