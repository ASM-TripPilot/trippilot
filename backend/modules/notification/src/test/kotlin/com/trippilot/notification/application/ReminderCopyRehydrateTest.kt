package com.trippilot.notification.application

import com.trippilot.notification.domain.NotificationKind
import com.trippilot.notification.domain.NotificationSchedule
import com.trippilot.notification.domain.ReminderCopy
import com.trippilot.notification.domain.ReminderCopyPort
import com.trippilot.notification.domain.ReminderCopyRequest
import io.kotest.assertions.throwables.shouldNotThrowAny
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldContainExactly
import io.kotest.matchers.collections.shouldBeEmpty
import io.kotest.matchers.shouldBe
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import java.util.UUID

/**
 * 재시작으로 사라진 문구 채움 대기열을 **기동 때 DB 에서 되살리는가**.
 *
 * 깨지면: 배포 직후 파드가 바뀌는 순간 진행 중이던 재시도 사슬이 통째로 사라지고, 그 여행의 리마인드는 아침까지 상수 문구로 굳는다.
 * 개발 서버는 하루 아홉 번 재시작한다(2026-11-03 실측) — 사슬은 길면 50분이라 재시작과 겹치는 일이 드물지 않다.
 */
class ReminderCopyRehydrateTest : StringSpec({

    val now = Instant.parse("2026-11-04T00:00:00Z")
    val clock: Clock = Clock.fixed(now, ZoneOffset.UTC)
    val acc = UUID.randomUUID()

    class Copies(override val enabled: Boolean) : ReminderCopyPort {
        override fun copiesFor(tripTitle: String?, items: List<ReminderCopyRequest>) = emptyMap<String, ReminderCopy>()
    }

    fun row(trip: UUID, firesInHours: Long, title: String? = null, body: String? = null) =
        NotificationSchedule.pending(acc, trip, NotificationKind.TRIP_DAY, now.plusSeconds(firesInHours * 3600))
            .copy(title = title, body = body)

    class Fixture(enabled: Boolean, clock: Clock) {
        val schedules = FakeSchedules()
        val retries = ReminderCopyRetries(listOf(180_000L, 300_000L))
        val poller = ReminderCopyRetryPoller(
            retries,
            NotificationScheduleService(FakeTripOwner(), schedules, Copies(enabled), FakePlans(), clock, retries),
            clock,
        )
    }

    /** 대기열에서 **지금 시각 + 첫 간격(3분) 뒤** 에 꺼내 본다 — 되살린 사슬은 처음부터(attempt 0)여야 한다. */
    fun Fixture.queued(): List<ReminderCopyRetries.Due> = retries.takeDue(now.plusSeconds(181))

    "기동하면 곧 울릴 문구 없는 예약이 있는 여행을 처음부터 다시 건다" {
        val soon = UUID.randomUUID()
        val later = UUID.randomUUID()
        val f = Fixture(enabled = true, clock = clock)
        f.schedules.stored += listOf(
            row(soon, firesInHours = 8), row(soon, firesInHours = 32),   // 한 여행이 여러 행이어도 한 번
            row(later, firesInHours = 40),
        )

        f.poller.rehydrate()

        f.queued().map { it.tripId to it.attempt }.toSet() shouldBe setOf(soon to 0, later to 0)
    }

    "문구가 이미 있는 예약·이미 발화·취소된 예약·범위 밖은 건드리지 않는다" {
        val filled = UUID.randomUUID()
        val fired = UUID.randomUUID()
        val canceled = UUID.randomUUID()
        val farFuture = UUID.randomUUID()
        val past = UUID.randomUUID()
        val onlyTitle = UUID.randomUUID()   // 제목만 있고 본문이 없다 — 문구 없음이다(attachCopy 와 같은 기준)
        val f = Fixture(enabled = true, clock = clock)
        f.schedules.stored += listOf(
            row(filled, 8, title = "오늘은 제주", body = "공항에서 시작해요"),
            row(fired, 8).copy(firedAt = now),
            row(canceled, 8).copy(canceledAt = now),
            row(farFuture, 49),   // 48시간 밖
            row(past, -1),        // 이미 지난 시각 — 발화기가 곧 집는다
            row(onlyTitle, 8, title = "제목만"),
        )

        f.poller.rehydrate()

        f.queued().map { it.tripId } shouldContainExactly listOf(onlyTitle)
    }

    "AI 문구가 꺼져 있으면 아무것도 걸지 않는다" {
        val f = Fixture(enabled = false, clock = clock)
        f.schedules.stored += row(UUID.randomUUID(), firesInHours = 8)

        f.poller.rehydrate()

        f.queued().shouldBeEmpty()
    }

    "저장소가 터져도 기동을 막지 않는다 — 한 줄 남기고 넘어간다" {
        val f = Fixture(enabled = true, clock = clock)
        val failing = object : com.trippilot.notification.domain.NotificationScheduleRepository by f.schedules {
            override fun findTripsLackingCopy(from: Instant, until: Instant, limit: Int): List<UUID> = error("db down")
        }
        val retries = ReminderCopyRetries(listOf(180_000L))
        val poller = ReminderCopyRetryPoller(
            retries,
            NotificationScheduleService(FakeTripOwner(), failing, Copies(true), FakePlans(), clock, retries),
            clock,
        )

        shouldNotThrowAny { poller.rehydrate() }

        retries.takeDue(now.plusSeconds(181)).shouldBeEmpty()
    }

    "상한을 넘으면 먼저 울릴 여행부터 건다" {
        val f = Fixture(enabled = true, clock = clock)
        val first = UUID.randomUUID()
        val second = UUID.randomUUID()
        val third = UUID.randomUUID()
        f.schedules.stored += listOf(row(third, 30), row(first, 2), row(second, 10))

        // 서비스 계층에서 상한을 직접 본다 — 폴러의 상한(200)은 상수라 테스트에서 못 줄인다.
        val service = NotificationScheduleService(FakeTripOwner(), f.schedules, Copies(true), FakePlans(), clock, f.retries)
        service.tripsLackingCopy(now, java.time.Duration.ofHours(48), limit = 2) shouldContainExactly listOf(first, second)
    }
})
