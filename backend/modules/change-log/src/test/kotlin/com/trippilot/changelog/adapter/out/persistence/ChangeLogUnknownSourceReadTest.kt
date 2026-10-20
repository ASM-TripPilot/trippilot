package com.trippilot.changelog.adapter.out.persistence

import ch.qos.logback.classic.Level
import ch.qos.logback.classic.Logger
import ch.qos.logback.classic.spi.ILoggingEvent
import ch.qos.logback.core.read.ListAppender
import com.trippilot.changelog.domain.ChangeLogEntry
import com.trippilot.changelog.domain.ChangeSource
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import io.mockk.every
import io.mockk.mockk
import org.slf4j.LoggerFactory
import java.time.Instant
import java.util.UUID

/**
 * 저장 계약 밖의 옛 행 읽기(TRIP-1476). 모르는 `source_type` 행(E)과, 스냅숏을 한 조각이라도 못 읽는 행(B·H).
 *
 * 모르는 `source_type` 행(E). V2.11 CHECK 가 INSERT 를 막으므로 이런 행은 **enum 값을 지우거나 이름을
 * 바꾼 뒤 옛 행이 남았을 때**, 또는 CHECK 에 새 값을 더한 뒤 앱을 이전 판으로 되돌렸을 때 생긴다. 앱 롤로는 CHECK 에
 * 막혀 INSERT 할 수 없고, `source_type` 은 그냥 varchar 라 Hibernate 층에서 다를 것이 없어 JPA 대역으로 본다.
 * 그 행만 빠지고 나머지 타임라인은 그대로 나와야 한다(종전: `No enum constant` 로 여행 타임라인 전체가 500).
 * 버린 행은 WARN 으로 남아야 한다 — 조용히 빠지면 "이력이 왜 비나"를 못 찾는다(INV-4).
 */
class ChangeLogUnknownSourceReadTest : StringSpec({

    val tripId = UUID.randomUUID()

    val empty = mapOf<String, Any>("days" to emptyList<Any>())

    fun row(id: Long, source: String, before: Map<String, Any> = empty, after: Map<String, Any> = empty) = ChangeLogEntryEntity(
        changeLogEntryId = id, tripId = tripId, actor = "u", sourceType = source, reason = "r$id",
        beforeSnapshot = before, afterSnapshot = after, at = Instant.parse("2026-08-14T00:00:00Z"),
    )

    fun readWithLogs(vararg rows: ChangeLogEntryEntity): Pair<List<ChangeLogEntry>, List<Pair<Level, String>>> {
        val jpa = mockk<ChangeLogJpaRepository>()
        every { jpa.findByTripIdOrderByAtDescChangeLogEntryIdDesc(tripId, any()) } returns rows.toList()
        val logger = LoggerFactory.getLogger(ChangeLogRepositoryAdapter::class.java) as Logger
        val logs = ListAppender<ILoggingEvent>().apply { start() }
        logger.addAppender(logs)
        val read = try {
            ChangeLogRepositoryAdapter(jpa).findByTrip(tripId, 10)
        } finally {
            logger.detachAppender(logs)
        }
        return read to logs.list.map { it.level to it.formattedMessage }
    }

    "모르는 출처의 행만 버리고 나머지 이력은 순서대로 돌려준다" {
        val (read, logs) = readWithLogs(row(3, "MANUAL"), row(2, "RETIRED"), row(1, "PLAN_B"))

        read.map { it.entryId to it.source } shouldBe listOf(3L to ChangeSource.MANUAL, 1L to ChangeSource.PLAN_B)
        logs shouldBe listOf(Level.WARN to "모르는 변경 출처라 이력 행을 건너뜁니다. changeLogEntryId=2 sourceType=RETIRED")
    }

    /**
     * 스냅숏을 반쯤 읽어 돌려주면 소비자가 없던 변경을 본다 — 재계획 `changesOn` 은 `before − after` 로 "그날 뺀 곳"을
     * 계산하므로, 한쪽 슬롯만 사라져도 그 슬롯이 "그날 뺀 곳"으로 AI 에 실린다. 그래서 한 조각이라도 못 읽으면 행째 건너뛴다.
     * `{}` 는 최상위가 객체가 아닌 행을 `@ColumnTransformer` 가 바꿔 읽은 모양이다(실 DB 경로는 ChangeLogApiIT).
     */
    "스냅숏을 한 조각이라도 못 읽으면 그 행을 통째로 건너뛰고, 슬롯 없는 생성 이력은 그대로 읽는다" {
        val poi = UUID.randomUUID().toString()
        val good = mapOf("poiId" to poi, "startAt" to "10:00", "endAt" to "11:00", "isFixed" to false, "endsNextDay" to false)
        fun day(vararg slots: Any) = mapOf("days" to listOf(mapOf("date" to "2026-08-11", "slots" to slots.toList())))
        val (read, logs) = readWithLogs(
            row(9, "MANUAL", before = day(good), after = day(good)),
            row(8, "MANUAL", before = emptyMap()),
            row(7, "MANUAL", before = mapOf("days" to listOf("x"))),
            row(6, "MANUAL", before = day(good), after = day(1, good)),
            row(5, "MANUAL", before = day(good), after = day(good - "endAt")),
            row(4, "MANUAL", before = day(good + ("isFixed" to "yes"))),
            row(3, "MANUAL", before = mapOf("days" to listOf(mapOf("date" to "2026-08-11")))),
            row(2, "PLAN_B"),
        )

        read.map { it.entryId } shouldBe listOf(9L, 2L)
        read.first().after.days.single().slots.single().poiId shouldBe UUID.fromString(poi)
        read.last().before.days shouldBe emptyList()
        logs.map { it.second } shouldBe listOf(
            "스냅숏을 읽지 못해 이력 행을 건너뜁니다. changeLogEntryId=8 beforeReadable=false afterReadable=true",
            "스냅숏을 읽지 못해 이력 행을 건너뜁니다. changeLogEntryId=7 beforeReadable=false afterReadable=true",
            "스냅숏을 읽지 못해 이력 행을 건너뜁니다. changeLogEntryId=6 beforeReadable=true afterReadable=false",
            "스냅숏을 읽지 못해 이력 행을 건너뜁니다. changeLogEntryId=5 beforeReadable=true afterReadable=false",
            "스냅숏을 읽지 못해 이력 행을 건너뜁니다. changeLogEntryId=4 beforeReadable=false afterReadable=true",
            "스냅숏을 읽지 못해 이력 행을 건너뜁니다. changeLogEntryId=3 beforeReadable=false afterReadable=true",
        )
        logs.map { it.first }.toSet() shouldBe setOf(Level.WARN)
    }

    /**
     * 날·슬롯의 필수 키 7개(`date`·`slots`·`poiId`·`startAt`·`endAt`·`isFixed`·`endsNextDay`) 하나하나 — 없음·못 읽는 값·
     * 다른 타입 — 가 각각 행째 건너뛰기여야 한다. 한 키라도 `?: 기본값`(EPOCH·UUID(0,0)·MIDNIGHT·false)으로 메우면
     * 그 키의 케이스만 읽혀 나와 이 단정이 깨진다.
     */
    "날·슬롯의 필수 키가 하나라도 없거나 못 읽거나 타입이 다르면 그 행을 건너뛴다" {
        val good = mapOf<String, Any>(
            "poiId" to UUID.randomUUID().toString(), "startAt" to "10:00", "endAt" to "11:00",
            "isFixed" to false, "endsNextDay" to false,
        )
        val goodDay = mapOf<String, Any>("date" to "2026-08-11", "slots" to listOf(good))
        fun slot(key: String, value: Any?) = goodDay + ("slots" to listOf(if (value == null) good - key else good + (key to value)))
        fun day(key: String, value: Any?) = if (value == null) goodDay - key else goodDay + (key to value)
        val broken = listOf(
            day("date", null), day("date", "2026-13-40"), day("date", 20260811),
            day("slots", null), day("slots", "x"),
            slot("poiId", null), slot("poiId", "x"), slot("poiId", 1),
            slot("startAt", null), slot("startAt", "25:00"), slot("startAt", 10),
            slot("endAt", null), slot("endAt", "x"), slot("endAt", 11),
            slot("isFixed", null), slot("isFixed", "yes"),
            slot("endsNextDay", null), slot("endsNextDay", "no"),
        )
        val rows = broken.mapIndexed { i, d -> row(i + 2L, "MANUAL", after = mapOf("days" to listOf(d))) }
        val (read, logs) = readWithLogs(row(1, "MANUAL", after = mapOf("days" to listOf(goodDay))), *rows.toTypedArray())

        read.map { it.entryId } shouldBe listOf(1L)
        logs shouldBe rows.map {
            Level.WARN to "스냅숏을 읽지 못해 이력 행을 건너뜁니다. changeLogEntryId=${it.changeLogEntryId} beforeReadable=true afterReadable=false"
        }
    }
})
