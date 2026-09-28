package com.trippilot.app.persistence

import com.trippilot.core.error.ConflictDetected
import com.trippilot.savedaccommodation.application.RegisterStayCommand
import com.trippilot.savedaccommodation.application.SavedStayService
import com.trippilot.savedaccommodation.domain.RegisterRoute
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.jdbc.core.JdbcTemplate
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * 저장 숙소 중복 등록(TRIP-1059 · QA #012 — 연타로 같은 외부 숙소 30행) 실 DB 검증.
 *
 * 인메모리로는 원리적으로 못 보는 것:
 * - **동시 경합** — 선검사를 함께 통과한 요청들 중 하나만 INSERT 되고 나머지가
 *   ux_saved_stay_external 위반 → 409 로 번역되는가(500 금지 AC). 단일 스레드 대역은 경합이 없다.
 * - **아웃박스도 1건** — 유니크에 걸린 트랜잭션은 StayRegistered 적재까지 함께 롤백되는가.
 */
@SpringBootTest
class SavedStayDuplicateIT : AbstractPostgresIntegrationTest() {

    @Autowired private lateinit var stays: SavedStayService
    @Autowired private lateinit var jdbc: JdbcTemplate

    private fun newAccount(): UUID = UUID.randomUUID().also {
        jdbc.update("INSERT INTO account (account_id, age_method, age_confirmed_at) VALUES (?, 'SELF_DECLARED', now())", it)
    }

    @Test
    fun `같은 외부 숙소 동시 등록 10회 - 1행만 남고 나머지는 409, 아웃박스도 1건`() {
        val account = newAccount()
        val cmd = RegisterStayCommand(
            name = "경합 호텔", lat = 33.5, lng = 126.5, coordConfirmed = true,
            checkIn = null, checkOut = null,
            externalSource = "LOCALDATA", externalId = "IT-RACE-1",
            registerRoute = RegisterRoute.MAP_SEARCH, memo = null,
        )

        val threads = 10
        val ready = CountDownLatch(threads)
        val go = CountDownLatch(1)
        val pool = Executors.newFixedThreadPool(threads)
        val outcomes = (1..threads).map {
            pool.submit<String> {
                ready.countDown(); go.await()
                try {
                    stays.register(account, cmd); "OK"
                } catch (e: ConflictDetected) {
                    "CONFLICT"
                }
                // 그 외 예외(500 갈래)는 Future 에서 터져 아래 집계가 실패한다 — 금지 AC.
            }
        }
        ready.await(); go.countDown()
        val results = outcomes.map { it.get(30, TimeUnit.SECONDS) }
        pool.shutdown()

        results.count { it == "OK" } shouldBe 1
        results.count { it == "CONFLICT" } shouldBe threads - 1
        jdbc.queryForObject(
            "SELECT count(*) FROM saved_stay WHERE account_id = ?", Int::class.java, account,
        ) shouldBe 1
        // 없는 새 숙소의 등록 알림이 가면 위반(TRIP-550) — 롤백된 트랜잭션의 이벤트는 남지 않는다.
        jdbc.queryForObject(
            "SELECT count(*) FROM outbox_event WHERE event_type = 'stay.StayRegistered' AND payload::jsonb->>'accountId' = ?",
            Int::class.java, account.toString(),
        ) shouldBe 1
    }

    @Test
    fun `외부 키 없는 등록은 같은 이름 두 번도 두 행이다 - 자연 키 없음`() {
        val account = newAccount()
        val pin = RegisterStayCommand(
            name = "핀 숙소", lat = 33.5, lng = 126.5, coordConfirmed = true,
            checkIn = null, checkOut = null, externalSource = null, externalId = null,
            registerRoute = RegisterRoute.PIN, memo = null,
        )
        stays.register(account, pin)
        stays.register(account, pin)
        jdbc.queryForObject(
            "SELECT count(*) FROM saved_stay WHERE account_id = ?", Int::class.java, account,
        ) shouldBe 2
    }
}
