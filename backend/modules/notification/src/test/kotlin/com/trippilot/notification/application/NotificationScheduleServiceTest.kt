package com.trippilot.notification.application

import com.trippilot.notification.domain.NotificationKind
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldContainExactly
import io.kotest.matchers.shouldBe
import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import java.util.UUID

/**
 * 리마인드 예약 적재·재계산(INV-U6-08 · INV-U6-09).
 *
 * 여기서 깨지면 사용자는 **오지 않는 알림**이나 **지난 일정 알림**을 겪는다. 둘 다 조용히 잘못되는 종류라
 * 로그에도 안 남는다 — 그래서 재계산이 미발화분만 건드리는지, 지난 시각을 애초에 안 적는지를 직접 잰다.
 */
class NotificationScheduleServiceTest : StringSpec({

    val acc = UUID.randomUUID()
    val tripId = UUID.randomUUID()
    // KST 08-10 08:00 = UTC 08-09 23:00. 여행 시작 한참 전에서 본다.
    fun clockAt(i: String): Clock = Clock.fixed(Instant.parse(i), ZoneOffset.UTC)

    fun kst(date: String, hour: Int) =
        LocalDate.parse(date).atTime(hour, 0).atZone(java.time.ZoneId.of("Asia/Seoul")).toInstant()

    fun fixture(now: String, start: String, end: String): Triple<NotificationScheduleService, FakeSchedules, FakeTripOwner> {
        val schedules = FakeSchedules()
        val trips = FakeTripOwner().apply { put(tripId, acc, LocalDate.parse(start), LocalDate.parse(end)) }
        return Triple(NotificationScheduleService(trips, schedules, clockAt(now)), schedules, trips)
    }

    "여행 전날 1건 + 여행일수만큼 당일 알림이 적재된다" {
        val (svc, schedules, _) = fixture(now = "2026-08-01T00:00:00Z", start = "2026-08-10", end = "2026-08-12")

        svc.reload(tripId)

        val rows = schedules.findPendingByTrip(tripId)
        rows.map { it.kind } shouldContainExactly listOf(
            NotificationKind.TRIP_PRE,   // 08-09 08:00 KST
            NotificationKind.TRIP_DAY,   // 08-10
            NotificationKind.TRIP_DAY,   // 08-11
            NotificationKind.TRIP_DAY,   // 08-12 (체크아웃일 포함)
        )
        rows.first().fireAt shouldBe kst("2026-08-09", 8)
        rows.last().fireAt shouldBe kst("2026-08-12", 8)
        rows.all { it.accountId == acc } shouldBe true
    }

    // 시드가 전부 미래면 필터가 없어도 통과한다 — 이미 지난 날이 실제로 섞여 있어야 경계를 잰다.
    "여행 중에 다시 짜면 이미 지난 날짜는 적지 않는다" {
        // 08-11 09:00 KST — 첫날(08-10)과 둘째 날 08:00 이 이미 지났다.
        val (svc, schedules, _) = fixture(now = "2026-08-11T00:00:00Z", start = "2026-08-10", end = "2026-08-12")

        svc.reload(tripId)

        val rows = schedules.findPendingByTrip(tripId)
        rows.map { it.fireAt } shouldContainExactly listOf(kst("2026-08-12", 8))
    }

    "재계산은 미발화분만 갈아끼운다 — 이미 발화·취소된 행은 그대로다(INV-U6-08)" {
        val (svc, schedules, _) = fixture(now = "2026-08-01T00:00:00Z", start = "2026-08-10", end = "2026-08-10")
        svc.reload(tripId)
        val before = schedules.stored.toList()
        // 첫 건은 이미 나갔고, 둘째는 늦어서 닫혔다고 하자.
        schedules.markFired(before[0].scheduleId, Instant.parse("2026-08-09T00:00:00Z"))
        schedules.markCanceled(before[1].scheduleId, Instant.parse("2026-08-10T00:00:00Z"))

        svc.reload(tripId)

        // 지나간 사실은 재계산의 대상이 아니다 — 지우면 같은 알림을 다시 보내게 된다.
        schedules.stored.count { it.firedAt != null } shouldBe 1
        schedules.stored.count { it.canceledAt != null } shouldBe 1
        schedules.findPendingByTrip(tripId).size shouldBe 2 // 새로 적재된 것만
    }

    "같은 이벤트가 두 번 배달돼도 예약은 늘지 않는다 (at-least-once 대응)" {
        val (svc, schedules, _) = fixture(now = "2026-08-01T00:00:00Z", start = "2026-08-10", end = "2026-08-11")

        svc.reload(tripId)
        val first = schedules.findPendingByTrip(tripId).map { it.fireAt }
        svc.reload(tripId)

        schedules.findPendingByTrip(tripId).map { it.fireAt } shouldContainExactly first
    }

    "여행이 사라지면 미발화 예약을 비운다 — 없어진 여행의 알림이 울리지 않게" {
        val (svc, schedules, trips) = fixture(now = "2026-08-01T00:00:00Z", start = "2026-08-10", end = "2026-08-11")
        svc.reload(tripId)
        schedules.findPendingByTrip(tripId).size shouldBe 3

        trips.remove(tripId)
        svc.reload(tripId)

        schedules.findPendingByTrip(tripId) shouldBe emptyList()
    }
})
