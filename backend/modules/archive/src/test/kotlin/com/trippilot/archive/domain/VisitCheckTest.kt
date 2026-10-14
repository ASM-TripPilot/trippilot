package com.trippilot.archive.domain

import com.trippilot.core.error.ConflictDetected
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import io.kotest.property.Arb
import io.kotest.property.arbitrary.boolean
import io.kotest.property.arbitrary.element
import io.kotest.property.arbitrary.list
import io.kotest.property.checkAll
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
    /** 체류 초과(DELAY)는 완료가 추정인지 알아야 한다(DEC-U10-6) — 완료 버튼은 사람이다, 도착이 자동이어도. */
    "완료하면 출처가 남고, 시각을 고쳐도 출처는 그대로다" {
        val auto = VisitCheck.arrive(trip, slot, poi, CheckSource.AUTO_GEOFENCE, t0)
        auto.completionSource shouldBe null
        val done = auto.complete(t1)
        done.completionSource shouldBe CompletionSource.MANUAL
    }

    "자동 완료는 그 출처로 남고 보정해도 바뀌지 않는다" {
        val exit = arrived().complete(t1, CompletionSource.AUTO_GEOFENCE_EXIT)
        exit.completionSource shouldBe CompletionSource.AUTO_GEOFENCE_EXIT
        exit.adjustTimes(arrivedAt = null, completedAt = t1.plusSeconds(60), at = t1).completionSource shouldBe CompletionSource.AUTO_GEOFENCE_EXIT
    }

    /** 보정으로 처음 생긴 완료는 사람이 적은 것이다 — 출처 없이 남기면 INV-U10-3 이 깨진다. */
    "보정으로 처음 완료가 생기면 출처는 MANUAL 이다" {
        arrived().adjustTimes(arrivedAt = null, completedAt = t1, at = t1).completionSource shouldBe CompletionSource.MANUAL
        arrived().adjustTimes(arrivedAt = t0.plusSeconds(60), completedAt = null, at = t1).completionSource shouldBe null
    }

    /** 억제 표식만 남은 행(자동 도착을 되돌린 자리)은 방문이 아니다(G-U10-12). 건너뜀은 기록이다. */
    "도착도 건너뜀도 없으면 기록으로 세지 않는다" {
        val suppressed = VisitCheck.reconstitute(
            UUID.randomUUID(), trip, slot, poi, null, null, null, CheckSource.AUTO_GEOFENCE, t0, t1, autoSuppressedAt = t1,
        )
        suppressed.isRecorded shouldBe false
        arrived().isRecorded shouldBe true
        suppressed.copy(skippedAt = t1).isRecorded shouldBe true
    }

    /** PBT-U10-2 의 출처 짝 — 어떤 도착·완료·건너뜀·보정 순서에서도 `completion_source IS NULL ⇔ completed_at IS NULL`. */
    "어떤 순서로 기록해도 완료와 완료 출처는 함께 있거나 함께 없다(INV-U10-3)" {
        val op = Arb.element("complete", "completeExit", "skip", "adjustArrive", "adjustComplete")
        checkAll(Arb.list(op, 0..6), Arb.boolean()) { ops, autoArrival ->
            var v = VisitCheck.arrive(trip, slot, poi, if (autoArrival) CheckSource.AUTO_GEOFENCE else CheckSource.MANUAL, t0)
            var at = t0
            for (o in ops) {
                at = at.plusSeconds(60)
                v = runCatching {
                    when (o) {
                        "complete" -> v.complete(at)
                        "completeExit" -> v.complete(at, CompletionSource.AUTO_GEOFENCE_EXIT)
                        "skip" -> v.skip(at)
                        "adjustArrive" -> v.adjustTimes(arrivedAt = t0, completedAt = null, at = at)
                        else -> v.adjustTimes(arrivedAt = null, completedAt = at, at = at)
                    }
                }.getOrDefault(v) // 거절된 전이는 상태를 바꾸지 않는다
                (v.completionSource == null) shouldBe (v.completedAt == null)
            }
        }
    }
})
