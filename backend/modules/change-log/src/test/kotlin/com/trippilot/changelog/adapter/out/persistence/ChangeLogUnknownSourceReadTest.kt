package com.trippilot.changelog.adapter.out.persistence

import ch.qos.logback.classic.Level
import ch.qos.logback.classic.Logger
import ch.qos.logback.classic.spi.ILoggingEvent
import ch.qos.logback.core.read.ListAppender
import com.trippilot.changelog.domain.ChangeSource
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import io.mockk.every
import io.mockk.mockk
import org.slf4j.LoggerFactory
import java.time.Instant
import java.util.UUID

/**
 * 모르는 `source_type` 행(TRIP-1476 E). V2.11 CHECK 가 INSERT 를 막으므로 이런 행은 **enum 값을 지우거나 이름을
 * 바꾼 뒤 옛 행이 남았을 때만** 생긴다 — 실 DB 로는 만들 수 없어 JPA 대역으로 본다.
 * 그 행만 빠지고 나머지 타임라인은 그대로 나와야 한다(종전: `No enum constant` 로 여행 타임라인 전체가 500).
 * 버린 행은 WARN 으로 남아야 한다 — 조용히 빠지면 "이력이 왜 비나"를 못 찾는다(INV-4).
 */
class ChangeLogUnknownSourceReadTest : StringSpec({

    val tripId = UUID.randomUUID()

    fun row(id: Long, source: String) = ChangeLogEntryEntity(
        changeLogEntryId = id, tripId = tripId, actor = "u", sourceType = source, reason = "r$id",
        beforeSnapshot = emptyMap(), afterSnapshot = emptyMap(), at = Instant.parse("2026-08-14T00:00:00Z"),
    )

    "모르는 출처의 행만 버리고 나머지 이력은 순서대로 돌려준다" {
        val jpa = mockk<ChangeLogJpaRepository>()
        every { jpa.findByTripIdOrderByAtDescChangeLogEntryIdDesc(tripId, any()) } returns
            listOf(row(3, "MANUAL"), row(2, "RETIRED"), row(1, "PLAN_B"))

        val logger = LoggerFactory.getLogger(ChangeLogRepositoryAdapter::class.java) as Logger
        val logs = ListAppender<ILoggingEvent>().apply { start() }
        logger.addAppender(logs)
        val read = try {
            ChangeLogRepositoryAdapter(jpa).findByTrip(tripId, 10)
        } finally {
            logger.detachAppender(logs)
        }

        read.map { it.entryId to it.source } shouldBe listOf(3L to ChangeSource.MANUAL, 1L to ChangeSource.PLAN_B)
        logs.list.map { it.level to it.formattedMessage } shouldBe
            listOf(Level.WARN to "모르는 변경 출처라 이력 행을 건너뜁니다. changeLogEntryId=2 sourceType=RETIRED")
    }
})
