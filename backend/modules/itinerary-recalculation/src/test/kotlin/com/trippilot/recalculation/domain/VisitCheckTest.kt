package com.trippilot.recalculation.domain

import com.trippilot.core.error.ConflictDetected
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import java.time.Instant
import java.util.UUID

/**
 * 방문 실적(US-ONTRIP-01 · US-REC-01).
 *
 * 지키려는 것:
 * - **완료와 건너뜀은 배타** — 둘 다 참이면 "갔나 안 갔나"가 갈린다
 * - **완료는 도착 이후** — 뒤집히면 파생 체류가 음수가 된다
 * - **체류는 파생값** — 저장하지 않는다(두 시각과 어긋날 수 있고, 어긋나면 어느 쪽이 사실인지 모른다)
 * - 건너뛴 방문은 재계획에서 **잠그지 않는다**(INV-U4-04 는 완료분만)
 */
class VisitCheckTest : StringSpec({

    val trip = UUID.randomUUID()
    val poi = UUID.randomUUID()
    val slot = "2026-08-11#$poi"
    val t0 = Instant.parse("2026-08-11T01:00:00Z")
    val t1 = Instant.parse("2026-08-11T02:30:00Z")

    fun arrived(slotKey: String? = slot) = VisitCheck.arrive(trip, slotKey, poi, CheckSource.MANUAL, t0)

    "도착하면 아직 결과가 없다 — 완료도 건너뜀도 아니다" {
        val v = arrived()
        v.arrivedAt shouldBe t0
        v.completedAt shouldBe null
        v.skippedAt shouldBe null
        v.isCompleted shouldBe false
        v.dwellMinutes shouldBe null // 완료 전에는 체류를 말할 수 없다
    }

    "완료하면 체류가 파생된다 — 90분" {
        val done = arrived().complete(t1)
        done.isCompleted shouldBe true
        done.dwellMinutes shouldBe 90
    }

    "도착 없이 완료할 수 없다 — 체류가 계산되지 않아 DELAY 입력이 빈다" {
        val noArrival = VisitCheck.reconstitute(
            UUID.randomUUID(), trip, slot, poi, null, null, null, CheckSource.MANUAL, t0, t0,
        )
        shouldThrow<ConflictDetected> { noArrival.complete(t1) }
    }

    "완료 시각이 도착보다 앞설 수 없다" {
        shouldThrow<ConflictDetected> { arrived().complete(t0.minusSeconds(60)) }
    }

    "건너뜀은 도착 없이도 가능하다 — 계획에 있었지만 아예 안 간 경우" {
        val notVisited = VisitCheck.reconstitute(
            UUID.randomUUID(), trip, slot, poi, null, null, null, CheckSource.MANUAL, t0, t0,
        )
        val skipped = notVisited.skip(t1)
        skipped.skippedAt shouldBe t1
        skipped.isCompleted shouldBe false // 잠금 대상이 아니다 — 안 갔으니 바꿔도 된다
    }

    "완료와 건너뜀은 배타 — 한쪽이 정해지면 다른 쪽으로 못 간다" {
        val done = arrived().complete(t1)
        shouldThrow<ConflictDetected> { done.skip(t1) }
        shouldThrow<ConflictDetected> { done.complete(t1) }

        val skipped = arrived().skip(t1)
        shouldThrow<ConflictDetected> { skipped.complete(t1) }
        shouldThrow<ConflictDetected> { skipped.skip(t1) }
    }

    "시각을 보정할 수 있다 — 기기 시각이 어긋났거나 늦게 눌렀을 때" {
        val fixed = arrived().complete(t1).adjustTimes(
            arrivedAt = Instant.parse("2026-08-11T01:10:00Z"),
            completedAt = Instant.parse("2026-08-11T02:10:00Z"),
            at = t1,
        )
        fixed.dwellMinutes shouldBe 60 // 파생값이라 보정이 곧바로 반영된다
    }

    "보내지 않은 값은 그대로 둔다 — 지움으로 읽으면 잠금이 조용히 풀린다(INV-U4-04)" {
        val done = arrived().complete(t1)
        // 도착만 고치려는 요청. completedAt 을 안 보냈다고 완료가 사라지면 안 된다.
        val fixed = done.adjustTimes(arrivedAt = Instant.parse("2026-08-11T01:10:00Z"), completedAt = null, at = t1)
        fixed.completedAt shouldBe t1
        fixed.isCompleted shouldBe true
    }

    "보정도 순서를 지킨다 — 완료만 남기거나 뒤집을 수 없다" {
        // 도착이 없는 기록에 완료만 얹을 수 없다
        val noArrival = VisitCheck.reconstitute(
            UUID.randomUUID(), trip, slot, poi, null, null, null, CheckSource.MANUAL, t0, t0,
        )
        shouldThrow<ConflictDetected> { noArrival.adjustTimes(null, t1, t1) }
        // 순서가 뒤집히면 거부
        shouldThrow<ConflictDetected> { arrived().adjustTimes(t1, t0, t1) }
    }

    "슬롯 키가 없으면 즉석 방문 — 계획에 없던 곳(US-REC-01)" {
        arrived(slotKey = null).isSpontaneous shouldBe true
        arrived().isSpontaneous shouldBe false
    }
})
