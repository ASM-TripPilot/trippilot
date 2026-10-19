package com.trippilot.notification.application

import ch.qos.logback.classic.Level
import ch.qos.logback.classic.Logger
import ch.qos.logback.classic.spi.ILoggingEvent
import ch.qos.logback.core.read.ListAppender
import com.trippilot.notification.domain.NotificationKind
import com.trippilot.notification.domain.NotificationSchedule
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldContainExactly
import io.kotest.matchers.collections.shouldContainExactlyInAnyOrder
import io.kotest.matchers.collections.shouldBeEmpty
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldContain
import io.mockk.every
import io.mockk.mockk
import io.mockk.verify
import org.slf4j.LoggerFactory
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import java.util.UUID

/**
 * 리마인드 폴러(DEC-U6-10) — 도래한 예약을 하나씩 발화한다.
 *
 * 이 경로의 결함은 조용하다: 한 건이 터져 배치가 멈추면 그 뒤 리마인드가 **전부** 안 가고,
 * 늦어서 닫은 건을 로그 없이 버리면 "서버가 멈춰 있었다"는 첫 단서가 사라진다(INV-4 · INV-U6-09).
 */
class NotificationSchedulePollerTest : StringSpec({

    val now = Instant.parse("2026-10-19T09:00:00Z")
    val clock = Clock.fixed(now, ZoneOffset.UTC)

    fun due(n: Int, schedules: FakeSchedules) = (0 until n).map {
        NotificationSchedule.pending(UUID.randomUUID(), UUID.randomUUID(), NotificationKind.TRIP_DAY, now.minusSeconds(60L * (n - it)))
            .also { s -> schedules.stored += s }
    }

    fun logs(block: () -> Unit): List<ILoggingEvent> {
        val appender = ListAppender<ILoggingEvent>().apply { start() }
        val logger = LoggerFactory.getLogger(NotificationSchedulePoller::class.java) as Logger
        logger.addAppender(appender)
        try {
            block()
        } finally {
            logger.detachAppender(appender)
        }
        return appender.list
    }

    "도래한 예약이 없으면 아무것도 발화하지 않고 아무것도 남기지 않는다" {
        val firing = mockk<NotificationFiringService>()
        val schedules = FakeSchedules()
        schedules.stored += NotificationSchedule.pending(UUID.randomUUID(), UUID.randomUUID(), NotificationKind.TRIP_DAY, now.plusSeconds(60))

        logs { NotificationSchedulePoller(schedules, firing, clock).poll() }.shouldBeEmpty()

        verify(exactly = 0) { firing.fire(any()) }
    }

    "한 건이 터져도 나머지 예약은 끝까지 발화하고, 실패는 그 예약 id 로 경고를 남긴다" {
        val schedules = FakeSchedules()
        val (first, broken, last) = due(3, schedules)
        val firing = mockk<NotificationFiringService>()
        every { firing.fire(first) } returns FireOutcome.FIRED
        every { firing.fire(broken) } throws IllegalStateException("db down")
        every { firing.fire(last) } returns FireOutcome.FIRED

        val events = logs { NotificationSchedulePoller(schedules, firing, clock).poll() }

        verify(exactly = 1) { firing.fire(first) }
        verify(exactly = 1) { firing.fire(last) }
        val warns = events.filter { it.level == Level.WARN }.map { it.formattedMessage }
        warns.single() shouldContain broken.scheduleId.toString()
        events.filter { it.level == Level.INFO }.map { it.formattedMessage } shouldContainExactly
            listOf("리마인드 2건을 알림함에 적재했습니다.")
    }

    "결과별로 센다 — 늦어서 닫은 건은 경고, 수신을 꺼 둔 건은 정보, 이미 집힌 건은 세지 않는다" {
        val schedules = FakeSchedules()
        val list = due(5, schedules)
        val outcomes = listOf(
            FireOutcome.CANCELED_LATE, FireOutcome.CANCELED_LATE, FireOutcome.MUTED, FireOutcome.ALREADY_TAKEN, FireOutcome.FIRED,
        )
        val firing = mockk<NotificationFiringService>()
        list.zip(outcomes).forEach { (s, o) -> every { firing.fire(s) } returns o }

        val events = logs { NotificationSchedulePoller(schedules, firing, clock).poll() }

        events.filter { it.level == Level.WARN }.map { it.formattedMessage } shouldContainExactly
            listOf("시각이 지나 발화하지 않고 닫은 리마인드 2건.")
        events.filter { it.level == Level.INFO }.map { it.formattedMessage } shouldContainExactlyInAnyOrder
            listOf("리마인드 1건을 알림함에 적재했습니다.", "수신을 꺼 두어 적재하지 않은 리마인드 1건.")
    }

    "이미 다른 인스턴스가 집어 간 건뿐이면 아무 집계도 남기지 않는다" {
        val schedules = FakeSchedules()
        val list = due(2, schedules)
        val firing = mockk<NotificationFiringService>()
        list.forEach { every { firing.fire(it) } returns FireOutcome.ALREADY_TAKEN }

        logs { NotificationSchedulePoller(schedules, firing, clock).poll() }.size shouldBe 0
        verify(exactly = 2) { firing.fire(any()) }
    }
})
