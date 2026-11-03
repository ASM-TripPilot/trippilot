package com.trippilot.notification.application

import ch.qos.logback.classic.Logger
import ch.qos.logback.classic.spi.ILoggingEvent
import ch.qos.logback.core.read.ListAppender
import com.trippilot.itinerarygeneration.api.ItineraryPlanFacade
import com.trippilot.itinerarygeneration.api.PlannedPlaceView
import com.trippilot.itinerarygeneration.api.PlannedSlotView
import com.trippilot.notification.domain.CopyBasis
import com.trippilot.notification.domain.NotificationKind
import com.trippilot.notification.domain.NotificationSchedule
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import org.slf4j.LoggerFactory
import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import java.util.UUID

/**
 * **발화 직전 문구 대조.** 문구는 적재 시점의 그날 장소 이름·순서로 만들어져 저장되는데 일정 편집(직접·도우미)·되돌리기는 예약을 다시
 * 적재하지 않는다 — 그러면 "성산일출봉에서 시작해요"가 이미 바뀐 일정의 아침 푸시에 나간다. 그래서 발화 때 지문을 다시 계산해 다르면 상수 문구로 간다.
 */
class NotificationFiringCopyGuardTest : StringSpec({

    val acc = UUID.randomUUID()
    val tripId = UUID.randomUUID()
    val day = LocalDate.parse("2026-08-10")
    val fireAt = Instant.parse("2026-08-09T23:00:00Z")     // 8/10 08:00 KST
    val clock: Clock = Clock.fixed(Instant.parse("2026-08-09T23:00:30Z"), ZoneOffset.UTC)

    fun place(name: String) = PlannedPlaceView(name, "SIGHT")

    fun copied(basis: String?) = NotificationSchedule.pending(acc, tripId, NotificationKind.TRIP_DAY, fireAt)
        .copy(title = "AI 제목", body = "AI 본문", copyBasis = basis)

    /** 발화하고 알림함에 쌓인 제목을 돌려준다. */
    fun fireTitle(schedule: NotificationSchedule, plans: ItineraryPlanFacade): String {
        val notifications = FakeNotifications()
        val toggles = NotificationToggleService(FakeToggles(), clock)
        val svc = NotificationFiringService(
            FakeSchedules().apply { stored += schedule }, notifications, toggles, noPush(clock, notifications, toggles), plans, clock,
        )
        svc.fire(schedule) shouldBe FireOutcome.FIRED
        return notifications.stored.single().title
    }

    fun logsFrom(block: () -> Unit): List<String> {
        val appender = ListAppender<ILoggingEvent>().apply { start() }
        val logger = LoggerFactory.getLogger(NotificationFiringService::class.java) as Logger
        logger.addAppender(appender)
        try { block() } finally { logger.detachAppender(appender) }
        return appender.list.map { it.formattedMessage }
    }

    "일정이 그대로면 AI 문구가 나간다" {
        val basis = CopyBasis.of(listOf("성산일출봉", "섭지코지"))

        fireTitle(copied(basis), FakePlans(mapOf(day to listOf(place("성산일출봉"), place("섭지코지"))))) shouldBe "AI 제목"
    }

    "문구를 만든 뒤 일정이 바뀌었으면 상수 문구로 나간다 — 옛 장소 이름이 새 일정의 아침 푸시에 나가지 않게" {
        val basis = CopyBasis.of(listOf("성산일출봉", "섭지코지"))
        val edits = listOf(
            listOf("우도", "섭지코지"),               // 한 곳이 바뀜
            listOf("섭지코지", "성산일출봉"),         // 순서가 바뀜
            listOf("성산일출봉"),                     // 한 곳이 빠짐
            emptyList(),                              // 그날 일정이 비었다
        )
        edits.forEach { names ->
            val logs = logsFrom {
                fireTitle(copied(basis), FakePlans(mapOf(day to names.map(::place)))) shouldBe "오늘의 일정"
            }
            logs.any { "일정이 바뀌어 리마인드 문구를 쓰지 않고" in it } shouldBe true
        }
    }

    "지문이 없는 문구(이 칸이 생기기 전에 붙은 것)는 대조할 근거가 없어 그대로 쓴다" {
        fireTitle(copied(basis = null), FakePlans(mapOf(day to listOf(place("완전히 다른 곳"))))) shouldBe "AI 제목"
    }

    "일정을 읽다 실패하면 검증할 수 없으니 상수 문구로 간다" {
        val failing = object : ItineraryPlanFacade {
            override fun findPlanSlots(accountId: UUID, tripId: UUID): List<PlannedSlotView> = emptyList()
            override fun findPlannedPlaces(accountId: UUID, tripId: UUID): Map<LocalDate, List<PlannedPlaceView>> = error("db down")
        }

        fireTitle(copied(CopyBasis.of(listOf("성산일출봉"))), failing) shouldBe "오늘의 일정"
    }

    "문구가 없는 예약은 일정을 읽지도 않는다" {
        var reads = 0
        val counting = object : ItineraryPlanFacade {
            override fun findPlanSlots(accountId: UUID, tripId: UUID): List<PlannedSlotView> = emptyList()
            override fun findPlannedPlaces(accountId: UUID, tripId: UUID): Map<LocalDate, List<PlannedPlaceView>> { reads++; return emptyMap() }
        }
        val plain = NotificationSchedule.pending(acc, tripId, NotificationKind.TRIP_DAY, fireAt)

        fireTitle(plain, counting) shouldBe "오늘의 일정"
        reads shouldBe 0
    }

    "여행 전날 알림(TRIP_PRE)은 첫날의 일정과 대조한다 — 발화일이 아니라" {
        val pre = NotificationSchedule.pending(acc, tripId, NotificationKind.TRIP_PRE, Instant.parse("2026-08-08T23:00:00Z"))   // 8/9 08:00 KST → 말하는 날 8/10
            .copy(title = "AI 제목", body = "AI 본문", copyBasis = CopyBasis.of(listOf("성산일출봉")))
        val c = Clock.fixed(Instant.parse("2026-08-08T23:00:30Z"), ZoneOffset.UTC)
        val notifications = FakeNotifications()
        val toggles = NotificationToggleService(FakeToggles(), c)
        val svc = NotificationFiringService(
            FakeSchedules().apply { stored += pre }, notifications, toggles, noPush(c, notifications, toggles),
            FakePlans(mapOf(day to listOf(place("성산일출봉")))), c,
        )

        svc.fire(pre) shouldBe FireOutcome.FIRED

        notifications.stored.single().title shouldBe "AI 제목"
    }
})
