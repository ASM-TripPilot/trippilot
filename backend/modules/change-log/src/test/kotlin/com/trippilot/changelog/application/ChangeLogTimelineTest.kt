package com.trippilot.changelog.application

import com.trippilot.changelog.api.ChangeSourceType
import com.trippilot.changelog.domain.ChangeLogEntry
import com.trippilot.changelog.domain.ChangeLogRepository
import com.trippilot.changelog.domain.ChangeSource
import com.trippilot.changelog.domain.DaySnapshot
import com.trippilot.changelog.domain.ItinerarySnapshot
import com.trippilot.changelog.domain.SlotSnapshot
import com.trippilot.core.error.ResourceNotFound
import com.trippilot.trip.api.TripFacade
import com.trippilot.trip.api.TripGenerationContext
import com.trippilot.trip.api.TripPeriod
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneOffset
import java.util.UUID

/** 조회가 리포지토리에 무엇을 요구했는지(상한) 보려고 인자를 기억한다. */
private class RecordingChangeLogs : ChangeLogRepository {
    val store = mutableListOf<ChangeLogEntry>()
    var askedLimit: Int? = null

    override fun append(entry: ChangeLogEntry) = entry.also { store += it }

    override fun findByTrip(tripId: UUID, limit: Int): List<ChangeLogEntry> {
        askedLimit = limit
        return store.filter { it.tripId == tripId }.sortedByDescending { it.at }.take(limit)
    }
}

/**
 * 퍼사드 조회(BR-U5-29 · TRIP-543) — 아카이브(U5)가 읽는 유일한 진입점.
 * 소유 판정·상한·최신순은 소비 모듈이 되풀이하지 않으므로 여기서 깨지면 그대로 화면까지 간다.
 */
class ChangeLogTimelineTest : StringSpec({

    val acc = UUID.randomUUID()
    val tripId = UUID.randomUUID()
    val poi = UUID.randomUUID()
    val clock = Clock.fixed(Instant.parse("2026-08-14T00:00:00Z"), ZoneOffset.UTC)

    fun trips(owned: Boolean) = object : TripFacade {
        override fun findPeriod(accountId: UUID, tripId: UUID) =
            if (owned && accountId == acc) TripPeriod(LocalDate.parse("2026-08-01"), LocalDate.parse("2026-08-02")) else null
        override fun findGenerationContext(accountId: UUID, tripId: UUID): TripGenerationContext? = null
    }

    fun snapshot(start: String) = ItinerarySnapshot(
        listOf(
            DaySnapshot(
                LocalDate.parse("2026-08-01"),
                listOf(SlotSnapshot(poi, LocalTime.parse(start), LocalTime.parse("15:00"), isFixed = true, endsNextDay = false)),
            ),
        ),
    )

    fun entry(at: Instant, reason: String?) = ChangeLogEntry(
        entryId = null,
        tripId = tripId,
        actor = "system",
        source = ChangeSource.PLAN_B,
        reason = reason,
        before = snapshot("10:00"),
        after = snapshot("14:00"),
        at = at,
    )

    "전후 스냅숏·사유·시각·출처가 api 표현으로 그대로 나온다" {
        val repo = RecordingChangeLogs().also { it.append(entry(Instant.parse("2026-08-10T01:00:00Z"), "휴무로 대체 방문")) }

        val view = ChangeLogService(repo, trips(true), clock).findTimeline(acc, tripId, 100).single()

        view.actor shouldBe "system"
        view.sourceType shouldBe ChangeSourceType.PLAN_B
        view.reason shouldBe "휴무로 대체 방문"
        view.at shouldBe Instant.parse("2026-08-10T01:00:00Z")
        view.before.days[0].slots[0].startAt shouldBe LocalTime.parse("10:00")
        view.after.days[0].slots[0].startAt shouldBe LocalTime.parse("14:00")
        view.after.days[0].slots[0].isFixed shouldBe true
    }

    "최신 이력이 앞에 온다" {
        val repo = RecordingChangeLogs().apply {
            append(entry(Instant.parse("2026-08-10T01:00:00Z"), "먼저"))
            append(entry(Instant.parse("2026-08-11T01:00:00Z"), "나중"))
        }

        ChangeLogService(repo, trips(true), clock).findTimeline(acc, tripId, 100).map { it.reason } shouldBe
            listOf("나중", "먼저")
    }

    // 시드가 상한보다 적으면 어떤 상한값이어도 통과한다 — 경계를 재려면 상한+1 건이 실제로 쌓여 있어야 한다.
    "상한을 넘겨 요청해도 전량이 아니라 최대치까지만 온다" {
        val over = ChangeLogService.MAX_LIMIT + 1
        val repo = RecordingChangeLogs().apply {
            repeat(over) { append(entry(Instant.parse("2026-08-10T01:00:00Z").plusSeconds(it.toLong()), "$it")) }
        }

        val entries = ChangeLogService(repo, trips(true), clock).findTimeline(acc, tripId, Int.MAX_VALUE)

        entries.size shouldBe ChangeLogService.MAX_LIMIT
        repo.askedLimit shouldBe ChangeLogService.MAX_LIMIT
        entries.first().reason shouldBe "${over - 1}" // 잘려 나가는 쪽은 오래된 끝이다
        entries.last().reason shouldBe "1"
    }

    "0 이하를 넘겨도 최소 한 건은 온다" {
        val repo = RecordingChangeLogs().apply {
            append(entry(Instant.parse("2026-08-10T01:00:00Z"), "먼저"))
            append(entry(Instant.parse("2026-08-11T01:00:00Z"), "나중"))
        }

        val entries = ChangeLogService(repo, trips(true), clock).findTimeline(acc, tripId, 0)

        entries.map { it.reason } shouldBe listOf("나중")
        repo.askedLimit shouldBe 1
    }

    "이력 없는 여행은 빈 목록이다 (오류가 아니다)" {
        ChangeLogService(RecordingChangeLogs(), trips(true), clock).findTimeline(acc, tripId, 100) shouldBe emptyList()
    }

    "타 계정·없는 여행이면 404 로 은닉한다" {
        val repo = RecordingChangeLogs().also { it.append(entry(Instant.parse("2026-08-10T01:00:00Z"), "남의 이력")) }

        shouldThrow<ResourceNotFound> {
            ChangeLogService(repo, trips(false), clock).findTimeline(UUID.randomUUID(), tripId, 100)
        }
    }
})
