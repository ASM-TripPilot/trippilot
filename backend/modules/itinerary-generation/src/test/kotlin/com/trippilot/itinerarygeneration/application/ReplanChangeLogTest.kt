package com.trippilot.itinerarygeneration.application

import com.trippilot.changelog.api.ChangeLogEntryView
import com.trippilot.changelog.api.ChangeSourceType
import com.trippilot.changelog.api.DaySnapshotView
import com.trippilot.changelog.api.ItinerarySnapshotView
import com.trippilot.changelog.api.SlotSnapshotView
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldBeEmpty
import io.kotest.matchers.collections.shouldHaveSize
import io.kotest.matchers.shouldBe
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.util.UUID

/**
 * 재계획에 싣는 변경 이력(TRIP-975) — 이 날짜의 diff 만, 장소가 바뀐 것만, 상한까지.
 * 시각·행위자는 경계로 나가지 않는다(타입에 필드가 없다 — [com.trippilot.itinerarygeneration.domain.ReplanChange]).
 */
class ReplanChangeLogTest : StringSpec({
    val day = LocalDate.parse("2026-10-14")
    val other = LocalDate.parse("2026-10-15")
    val a = UUID.fromString("00000000-0000-0000-0000-00000000000a")
    val b = UUID.fromString("00000000-0000-0000-0000-00000000000b")
    val c = UUID.fromString("00000000-0000-0000-0000-00000000000c")

    fun slot(id: UUID, h: Int) = SlotSnapshotView(id, LocalTime.of(h, 0), LocalTime.of(h + 1, 0), false, false)
    fun snap(date: LocalDate, vararg slots: SlotSnapshotView) = ItinerarySnapshotView(listOf(DaySnapshotView(date, slots.toList())))
    fun entry(before: ItinerarySnapshotView, after: ItinerarySnapshotView, reason: String? = null) =
        ChangeLogEntryView("acct-1", ChangeSourceType.PLAN_B, reason, Instant.parse("2026-10-14T03:00:00Z"), before, after)

    "그날 빠진 곳과 들어온 곳을 diff 로 낸다" {
        val out = changesOn(listOf(entry(snap(day, slot(a, 10), slot(b, 12)), snap(day, slot(a, 10), slot(c, 12)), "비 예보")), day)
        out shouldHaveSize 1
        out.single().removedPoiIds shouldBe listOf(b)
        out.single().addedPoiIds shouldBe listOf(c)
        out.single().reason shouldBe "비 예보"
        out.single().source shouldBe "PLAN_B"
    }

    "다른 날짜만 건드린 이력은 싣지 않는다" {
        changesOn(listOf(entry(snap(other, slot(a, 10)), snap(other, slot(b, 10)))), day).shouldBeEmpty()
    }

    "시각만 옮긴 편집은 장소 변화가 없어 버린다" {
        changesOn(listOf(entry(snap(day, slot(a, 10)), snap(day, slot(a, 14)))), day).shouldBeEmpty()
    }

    "상대 계약 상한(20)을 넘기지 않는다 — 넘기면 422 다" {
        val many = (1..30).map { entry(snap(day, slot(a, 10)), snap(day, slot(UUID.randomUUID(), 10))) }
        changesOn(many, day) shouldHaveSize CHANGE_LOG_MAX
    }
})
