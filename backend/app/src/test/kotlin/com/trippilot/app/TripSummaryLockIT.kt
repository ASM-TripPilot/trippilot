package com.trippilot.app

import com.trippilot.reflection.domain.TripSummaryRepository
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.TransactionTemplate
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * 여행 요약의 여행 단위 잠금(TRIP-1406). 요약 생성(여행 종료)과 경로 갱신(경로 저장)이 겹치면 한쪽이 다른 쪽의 커밋 전 상태를 보고
 * 덮는다 — 마지막 날 경로가 빠진 요약이 굳는다. **행이 없어도**(첫 생성) 잠겨야 한다. 권고 잠금은 실 DB 에만 있다.
 */
@SpringBootTest
class TripSummaryLockIT : AbstractPostgresIntegrationTest() {

    @Autowired private lateinit var summaries: TripSummaryRepository
    @Autowired private lateinit var txManager: PlatformTransactionManager

    @Test
    fun `같은 여행의 요약을 잡은 트랜잭션이 끝나기 전에는 다른 쪽이 잡지 못한다 — 행이 없어도`() {
        val tripId = UUID.randomUUID()
        val tx = TransactionTemplate(txManager)
        val holding = CountDownLatch(1)
        val finish = CountDownLatch(1)
        val pool = Executors.newFixedThreadPool(2)
        try {
            val first = pool.submit {
                tx.executeWithoutResult {
                    summaries.findForUpdate(tripId)
                    holding.countDown()
                    finish.await(10, TimeUnit.SECONDS)
                }
            }
            holding.await(10, TimeUnit.SECONDS) shouldBe true
            val second = pool.submit { tx.executeWithoutResult { summaries.findForUpdate(tripId) } }

            Thread.sleep(500)
            second.isDone shouldBe false
            finish.countDown()
            first.get(10, TimeUnit.SECONDS)
            second.get(10, TimeUnit.SECONDS)
            // 다른 여행은 기다리지 않는다
            tx.executeWithoutResult { summaries.findForUpdate(UUID.randomUUID()) }
        } finally {
            finish.countDown()
            pool.shutdown()
        }
    }
}
