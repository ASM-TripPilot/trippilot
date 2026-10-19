package com.trippilot.notification.domain

import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import java.time.Duration
import java.time.Instant
import java.util.UUID

/**
 * 알림·리마인드 예약의 생성 불변식과 기본 문구.
 *
 * 제목·본문 상한은 컬럼 길이와 같아야 한다 — 여기서 못 막으면 저장 시점에 22001 로 터져 알림이 **통째로** 사라진다.
 * 예약의 기본 문구는 AI 문구가 없을 때(정상 경로다) 사용자가 실제로 보는 말이다.
 */
class NotificationInvariantsTest : StringSpec({

    val acc = UUID.randomUUID()
    val trip = UUID.randomUUID()
    val at = Instant.parse("2026-08-10T00:00:00Z")

    fun raise(title: String, body: String) = Notification.raise(acc, NotificationKind.SYSTEM, title, body, at)

    "제목은 비어 있거나 120자를 넘을 수 없다 — 경계값 120자는 들어간다" {
        shouldThrow<IllegalArgumentException> { raise(" ", "본문") }
        // 리터럴로 고정한다 — 상수와 컬럼(varchar(120))이 같이 움직여야 하므로 상수만 보면 둘이 갈려도 통과한다.
        shouldThrow<IllegalArgumentException> { raise("가".repeat(121), "본문") }
        raise("가".repeat(120), "본문").title.length shouldBe 120
    }

    "본문은 비어 있거나 400자를 넘을 수 없다 — 경계값 400자는 들어간다" {
        shouldThrow<IllegalArgumentException> { raise("제목", "") }
        shouldThrow<IllegalArgumentException> { raise("제목", "가".repeat(401)) }
        raise("제목", "가".repeat(400)).body.length shouldBe 400
    }

    "시각으로 발화하지 않는 종류는 예약할 수 없다" {
        (NotificationKind.entries - NotificationKind.REMINDERS).forEach { kind ->
            shouldThrow<IllegalArgumentException> { NotificationSchedule.pending(acc, trip, kind, at) }
        }
    }

    "slotKey 는 SLOT_PRE 만 가진다 — 여행 단위 리마인드에 붙으면 거부한다" {
        NotificationSchedule.pending(acc, trip, NotificationKind.SLOT_PRE, at, slotKey = "2026-08-10#p").slotKey shouldBe "2026-08-10#p"
        NotificationSchedule.pending(acc, trip, NotificationKind.SLOT_PRE, at).slotKey shouldBe null
        shouldThrow<IllegalArgumentException> {
            NotificationSchedule.pending(acc, trip, NotificationKind.TRIP_DAY, at, slotKey = "2026-08-10#p")
        }
    }

    "AI 문구가 없으면 종류별 기본 문구로 발화한다" {
        fun copy(kind: NotificationKind) = NotificationSchedule.pending(acc, trip, kind, at).toNotification(at).let { it.title to it.body }
        copy(NotificationKind.TRIP_PRE) shouldBe ("내일 여행이 시작돼요" to "출발 전에 일정을 한 번 확인해 보세요.")
        copy(NotificationKind.TRIP_DAY) shouldBe ("오늘의 일정" to "오늘 어디를 가는지 확인해 보세요.")
        copy(NotificationKind.SLOT_PRE) shouldBe ("일정 시작 전이에요" to "곧 다음 일정이 시작돼요.")
    }

    "제목·본문이 둘 다 있어야 AI 문구를 쓴다 — 한쪽이 비거나 공백이면 둘 다 기본 문구다" {
        val base = NotificationSchedule.pending(acc, trip, NotificationKind.TRIP_DAY, at)
        base.copy(title = "AI 제목", body = "AI 본문").toNotification(at).let { (it.title to it.body) shouldBe ("AI 제목" to "AI 본문") }
        listOf(
            base.copy(title = "AI 제목", body = " "),
            base.copy(title = "", body = "AI 본문"),
            base.copy(title = null, body = "AI 본문"),
        ).forEach { s ->
            val n = s.toNotification(at)
            (n.title to n.body) shouldBe ("오늘의 일정" to "오늘 어디를 가는지 확인해 보세요.")
        }
    }

    "발화한 알림은 실제 발화 시각을 쓰고, 일정으로 들어가는 진입과 예정 시각이 든 억제 키를 싣는다" {
        val fireAt = Instant.parse("2026-08-10T23:00:00Z")
        val firedAt = fireAt.plusSeconds(45)
        val n = NotificationSchedule.pending(acc, trip, NotificationKind.TRIP_DAY, fireAt).toNotification(firedAt)
        n.occurredAt shouldBe firedAt
        n.actionType shouldBe NotificationAction.TRIP_ITINERARY
        n.actionPayload shouldBe mapOf("tripId" to trip.toString())
        n.sourceEventId shouldBe null
        n.dedupKey shouldBe "TRIP_DAY#$trip#$fireAt"
    }

    "유예 안이면 늦지 않았고, 유예를 넘기면 늦었다(INV-U6-09)" {
        val s = NotificationSchedule.pending(acc, trip, NotificationKind.SLOT_PRE, at)
        val grace = Duration.ofMinutes(5)
        s.isTooLate(at.plus(grace), grace) shouldBe false
        s.isTooLate(at.plus(grace).plusSeconds(1), grace) shouldBe true
    }
})
