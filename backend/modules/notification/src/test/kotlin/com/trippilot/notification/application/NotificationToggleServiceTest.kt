package com.trippilot.notification.application

import com.trippilot.core.error.ValidationFailed
import com.trippilot.notification.domain.NotificationKind
import com.trippilot.notification.domain.NotificationSchedule
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldContainExactly
import io.kotest.matchers.shouldBe
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import java.util.UUID

/**
 * 알림 수신 설정(`l02` · INV-U6-02·03·04·05).
 *
 * 두 가지가 조용히 틀릴 수 있다. 하나는 **행이 없는 것을 꺼짐으로 읽는 것** — 그러면 아무도 설정한 적
 * 없는 계정에 알림이 하나도 안 간다. 다른 하나는 **`SYSTEM` 이 토글에 걸리는 것** — 보안 알림이
 * 사라져도 아무 데도 안 나타난다.
 */
class NotificationToggleServiceTest : StringSpec({

    val acc = UUID.randomUUID()
    val tripId = UUID.randomUUID()
    val now = Instant.parse("2026-08-11T00:00:00Z")
    val clock: Clock = Clock.fixed(now, ZoneOffset.UTC)

    fun service(toggles: FakeToggles = FakeToggles()) = NotificationToggleService(toggles, clock) to toggles

    "설정한 적 없어도 7종이 기본값으로 온다 — 행이 없다 ≠ 꺼짐" {
        val (svc, toggles) = service()

        val list = svc.list(acc)

        list.size shouldBe 7
        toggles.stored shouldBe emptyList() // 조회가 행을 만들지 않는다
        // 실물 l02 에서 읽은 기본값 — 앞의 둘만 푸시가 꺼져 있다.
        list.single { it.kind == NotificationKind.SLOT_PRE }.pushEnabled shouldBe false
        list.single { it.kind == NotificationKind.SLOT_PRE }.inAppEnabled shouldBe true
        list.single { it.kind == NotificationKind.PLAN_B }.pushEnabled shouldBe false
        list.single { it.kind == NotificationKind.STAY }.pushEnabled shouldBe true
        list.single { it.kind == NotificationKind.TRIP_DAY }.pushEnabled shouldBe true
    }

    "SYSTEM 은 목록에 없다(INV-U6-04) — 끌 수 있는 것이 아니다" {
        val (svc, _) = service()

        svc.list(acc).none { it.kind == NotificationKind.SYSTEM } shouldBe true
    }

    "COMMUNITY 는 목록에 남긴다(INV-U6-05) — U7 개통 시 마이그레이션 0으로 켜기 위해" {
        val (svc, _) = service()

        svc.list(acc).map { it.kind } shouldContainExactly listOf(
            NotificationKind.STAY, NotificationKind.TRIP_PRE, NotificationKind.TRIP_DAY,
            NotificationKind.SLOT_PRE, NotificationKind.PLAN_B, NotificationKind.REFLECTION,
            NotificationKind.COMMUNITY,
        )
    }

    "SYSTEM 변경은 거부한다" {
        val (svc, toggles) = service()

        shouldThrow<ValidationFailed> { svc.update(acc, NotificationKind.SYSTEM, pushEnabled = false, inAppEnabled = false) }

        toggles.stored shouldBe emptyList()
    }

    "한쪽만 바꾸면 다른 쪽은 그대로다 — null 은 변경 없음이다" {
        val (svc, _) = service()

        // 기본값(푸시 ON · 인앱 ON)에서 푸시만 끈다.
        val afterPush = svc.update(acc, NotificationKind.STAY, pushEnabled = false, inAppEnabled = null)
        afterPush.pushEnabled shouldBe false
        afterPush.inAppEnabled shouldBe true

        // 이번엔 인앱만 끈다 — 푸시가 되살아나면 안 된다.
        val afterInApp = svc.update(acc, NotificationKind.STAY, pushEnabled = null, inAppEnabled = false)
        afterInApp.pushEnabled shouldBe false
        afterInApp.inAppEnabled shouldBe false
    }

    "저장된 값이 기본값을 덮는다" {
        val (svc, _) = service()
        svc.update(acc, NotificationKind.SLOT_PRE, pushEnabled = true, inAppEnabled = null)

        svc.list(acc).single { it.kind == NotificationKind.SLOT_PRE }.pushEnabled shouldBe true
    }

    // ── 실제로 갈리는가 ────────────────────────────────────────────────
    "푸시 OFF · 인앱 ON 이면 적재는 되고 푸시만 막힌다(INV-U6-02)" {
        val (svc, _) = service()
        svc.update(acc, NotificationKind.TRIP_DAY, pushEnabled = false, inAppEnabled = true)

        svc.allowsInApp(acc, NotificationKind.TRIP_DAY) shouldBe true
        svc.allowsPush(acc, NotificationKind.TRIP_DAY) shouldBe false
    }

    "SYSTEM 은 토글과 무관하게 항상 통과한다(INV-U6-03)" {
        val (svc, toggles) = service()
        // 도메인이 막아서 정상 경로로는 못 만들지만, DB 에 어떻게든 들어갔다고 가정해도 통과해야 한다.
        svc.allowsInApp(acc, NotificationKind.SYSTEM) shouldBe true
        svc.allowsPush(acc, NotificationKind.SYSTEM) shouldBe true
        toggles.stored shouldBe emptyList()
    }

    "인앱을 끄면 발화가 알림함에 쌓지 않는다 — 화면만 바뀌는 설정이 아니다" {
        val toggles = FakeToggles()
        val svc = NotificationToggleService(toggles, clock)
        svc.update(acc, NotificationKind.TRIP_DAY, pushEnabled = null, inAppEnabled = false)

        val schedule = NotificationSchedule.pending(acc, tripId, NotificationKind.TRIP_DAY, now.minusSeconds(60))
        val schedules = FakeSchedules().apply { stored += schedule }
        val notifications = FakeNotifications()

        NotificationFiringService(schedules, notifications, svc, clock).fire(schedule) shouldBe FireOutcome.MUTED

        notifications.stored shouldBe emptyList()
        // 예약은 소비된다 — 남겨 두면 다음 폴링이 계속 집어 배치를 채운다.
        schedules.findPendingByTrip(tripId) shouldBe emptyList()
    }

    "인앱이 켜져 있으면 그대로 적재된다 — 대조군" {
        val toggles = FakeToggles()
        val svc = NotificationToggleService(toggles, clock)

        val schedule = NotificationSchedule.pending(acc, tripId, NotificationKind.TRIP_DAY, now.minusSeconds(60))
        val schedules = FakeSchedules().apply { stored += schedule }
        val notifications = FakeNotifications()

        NotificationFiringService(schedules, notifications, svc, clock).fire(schedule) shouldBe FireOutcome.FIRED

        notifications.stored.size shouldBe 1
    }
})
