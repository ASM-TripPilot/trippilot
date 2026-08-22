package com.trippilot.trip.domain

import com.trippilot.core.error.ConflictDetected
import io.kotest.assertions.throwables.shouldNotThrowAny
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.util.UUID

/**
 * 끝난 여행은 편집할 수 없다 — **날짜로 판정한다**.
 *
 * 예전에는 저장된 `status != ENDED` 를 봤는데 그 값은 절대 `ENDED` 가 되지 않는다(상태를 밀어 올리는
 * 코드도 배치도 없다). 그래서 가드가 **한 번도 발동하지 않았고**, 3년 전 끝난 여행의 날짜도 바꿀 수
 * 있었다. 여기 테스트가 그 자리를 잠근다.
 */
class TripEditableTest : StringSpec({

    val acc = UUID.randomUUID()
    val zone = ZoneId.of("Asia/Seoul")

    /** KST 기준 그 날 정오 — 자정 경계에 걸려 하루가 밀리지 않게. */
    fun at(date: String): Instant = LocalDate.parse(date).atTime(12, 0).atZone(zone).toInstant()

    fun trip(start: String, end: String) = Trip.create(
        acc, null, LocalDate.parse(start), LocalDate.parse(end), 2, null, null, emptyMap(),
        listOf(TripDestination(0, "제주", 1)), at("2026-01-01"),
    )

    fun Trip.editOn(day: String) = edit(
        null, startDate, endDate, party, companionType, budgetTotal, destinations, at(day),
    )

    "끝난 여행은 편집할 수 없다" {
        val past = trip("2026-03-01", "2026-03-03")

        shouldThrow<ConflictDetected> { past.editOn("2026-03-04") }
    }

    /** 종료 당일까지는 편집할 수 있다 — 마지막 날 저녁에 일정을 손보는 것이 정상이다. */
    "종료 당일은 아직 편집할 수 있다" {
        val trip = trip("2026-03-01", "2026-03-03")

        shouldNotThrowAny { trip.editOn("2026-03-03") }
    }

    /**
     * **여행 중은 막지 않는다.** 현장에서 일정이 바뀌는 것이 정상이고 재계획(C10)의 전제다.
     * 여기서 막으면 Plan-B 가 통째로 성립하지 않는다.
     */
    "여행 중에도 편집할 수 있다" {
        val ongoing = trip("2026-03-01", "2026-03-05")

        shouldNotThrowAny { ongoing.editOn("2026-03-03") }
    }

    "시작 전에는 당연히 편집할 수 있다" {
        shouldNotThrowAny { trip("2026-03-01", "2026-03-03").editOn("2026-02-20") }
    }

    /**
     * 판정 시각이 **여행지 기준(KST)** 이어야 한다. 서버가 UTC 면 종료일 다음 날 오전 8시 이전이
     * 아직 "종료 당일"로 읽혀 하루가 어긋난다.
     */
    "자정 경계는 여행지 기준으로 가른다" {
        val trip = trip("2026-03-01", "2026-03-03")
        // KST 3/4 00:30 = UTC 3/3 15:30 — 서버 기준이면 아직 3일이라 통과해 버린다.
        val justAfterMidnightKst = LocalDate.parse("2026-03-04").atTime(0, 30).atZone(zone).toInstant()

        shouldThrow<ConflictDetected> {
            trip.edit(null, trip.startDate, trip.endDate, trip.party, trip.companionType,
                trip.budgetTotal, trip.destinations, justAfterMidnightKst)
        }
    }

    "삭제된 여행은 날짜와 무관하게 편집할 수 없다" {
        val base = trip("2026-03-01", "2026-03-03")
        val deleted = Trip.reconstitute(
            base.tripId, base.accountId, base.title, base.startDate, base.endDate, base.party,
            base.companionType, base.budgetTotal, base.preferenceSnapshot, base.destinations,
            base.status, deletedAt = at("2026-02-10"), createdAt = base.createdAt, updatedAt = base.updatedAt,
        )

        deleted.editableAt(LocalDate.parse("2026-02-20")) shouldBe false
    }
})
