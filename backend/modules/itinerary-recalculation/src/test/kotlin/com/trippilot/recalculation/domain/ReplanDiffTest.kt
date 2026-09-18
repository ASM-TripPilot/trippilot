package com.trippilot.recalculation.domain

import com.trippilot.recalculation.domain.ReplanDiff.Change
import com.trippilot.recalculation.domain.ReplanDiff.SlotView
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldContainExactly
import io.kotest.matchers.shouldBe
import io.kotest.property.Arb
import io.kotest.property.arbitrary.int
import io.kotest.property.arbitrary.list
import io.kotest.property.checkAll
import java.time.Duration
import java.time.LocalTime

/**
 * 전후 비교(BR-U4-29). 확정 **전** 판단 재료라, 잘못되면 사용자가 잘못된 근거로 확정한다.
 * 그래서 저장·외부 호출 없이 입력만으로 결과가 정해지는 순수 계산으로 두고 여기서 못 박는다.
 */
class ReplanDiffTest : StringSpec({

    fun slot(
        key: String,
        start: String,
        end: String,
        fixed: Boolean = false,
        distanceM: Int? = null,
        endsNextDay: Boolean = false,
    ) = SlotView(key, LocalTime.parse(start), LocalTime.parse(end), fixed, endsNextDay, distanceM)

    val a = "2026-08-11#aaa"
    val b = "2026-08-11#bbb"
    val c = "2026-08-11#ccc"

    "추가·삭제·시간이동·고정을 구분한다" {
        val before = listOf(
            slot(a, "10:00", "11:00"),
            slot(b, "13:00", "14:00"),
            slot(c, "18:00", "19:00", fixed = true),
        )
        val after = listOf(
            slot(a, "10:00", "11:00"),           // 그대로
            slot("2026-08-11#ddd", "13:00", "14:30"), // 새로 들어옴
            slot(c, "18:00", "19:00", fixed = true),  // 고정
        )

        val result = ReplanDiff.of(before, after)
        result.entries.map { it.change } shouldContainExactly
            listOf(Change.UNCHANGED, Change.ADDED, Change.FIXED, Change.REMOVED)
        result.entries.last().slotKey shouldBe b // 빠진 것은 뒤에 모아 보여준다
        result.entries.last().afterStart shouldBe null
    }

    "시각만 달라지면 MOVED" {
        val result = ReplanDiff.of(listOf(slot(a, "10:00", "11:00")), listOf(slot(a, "15:00", "16:00")))
        result.entries.single().change shouldBe Change.MOVED
        result.entries.single().beforeStart shouldBe LocalTime.parse("10:00")
        result.entries.single().afterStart shouldBe LocalTime.parse("15:00")
    }

    "고정 슬롯은 시각이 달라져도 FIXED 로 표시한다 — 눈에 띄어야 한다(BR-U4-18)" {
        // 고정은 손대지 않는 것이 정상이라, 달라졌다면 그 사실이 드러나야 한다.
        val result = ReplanDiff.of(
            listOf(slot(a, "10:00", "11:00", fixed = true)),
            listOf(slot(a, "12:00", "13:00", fixed = true)),
        )
        result.entries.single().change shouldBe Change.FIXED
    }

    "표시 순서는 바뀐 뒤 일정을 따른다 — 사용자가 보게 될 순서가 그것이다" {
        val result = ReplanDiff.of(
            listOf(slot(a, "10:00", "11:00"), slot(b, "13:00", "14:00")),
            listOf(slot(b, "10:00", "11:00"), slot(a, "13:00", "14:00")),
        )
        result.entries.map { it.slotKey } shouldContainExactly listOf(b, a)
    }

    "영향 지표 — 방문 수·복귀 시각" {
        val impact = ReplanDiff.of(
            listOf(slot(a, "10:00", "11:00"), slot(b, "13:00", "14:00")),
            listOf(slot(a, "10:00", "11:00")),
        ).impact
        impact.visitCountDelta shouldBe -1
        impact.returnTimeDelta shouldBe Duration.ofHours(-3) // 14:00 → 11:00
    }

    "거리를 모르면 총 이동 거리 변화는 null — 0 으로 채우면 '줄었다'는 거짓이 된다" {
        val known = listOf(slot(a, "10:00", "11:00", distanceM = 1000))
        val unknown = listOf(slot(a, "10:00", "11:00")) // distanceM = null

        ReplanDiff.of(known, unknown).impact.totalDistanceDeltaM shouldBe null
        ReplanDiff.of(unknown, known).impact.totalDistanceDeltaM shouldBe null
        ReplanDiff.of(known, known).impact.totalDistanceDeltaM shouldBe 0
    }

    "거리를 다 알면 합의 차를 낸다" {
        val impact = ReplanDiff.of(
            listOf(slot(a, "10:00", "11:00", distanceM = 1000), slot(b, "13:00", "14:00", distanceM = 2000)),
            listOf(slot(a, "10:00", "11:00", distanceM = 1000), slot(c, "13:00", "14:00", distanceM = 500)),
        ).impact
        impact.totalDistanceDeltaM shouldBe -1500
        impact.visitCountDelta shouldBe 0
    }

    "자정을 넘긴 슬롯이 마지막이다 — 시각으로만 재면 부호까지 뒤집힌다(HC4)" {
        // 원 일정은 22:00 에 시작해 **익일** 00:30 에 끝난다. 초안은 19:00 에 끝난다 —
        // 진짜로는 5시간 30분 당겨지는데, endsNextDay 를 빼고 재면 00:30 이 하루 중 가장 이른
        // 시각이라 11:00 이 "마지막"으로 뽑혀 +8시간(늦어짐)이 나온다.
        val before = listOf(slot(a, "10:00", "11:00"), slot(b, "22:00", "00:30", endsNextDay = true))
        val after = listOf(slot(a, "10:00", "19:00"))

        ReplanDiff.of(before, after).impact.returnTimeDelta shouldBe Duration.ofMinutes(-330)
    }

    "자정 넘김 여부가 달라지면 MOVED — 00:30 오늘과 00:30 익일은 다른 시점이다" {
        val result = ReplanDiff.of(
            listOf(slot(a, "22:00", "00:30", endsNextDay = false)),
            listOf(slot(a, "22:00", "00:30", endsNextDay = true)),
        )
        result.entries.single().change shouldBe Change.MOVED
    }

    "빈 일정 — 비교할 대상이 없으면 복귀 시각 변화도 없다" {
        ReplanDiff.of(emptyList(), emptyList()).impact.returnTimeDelta shouldBe null
        ReplanDiff.of(listOf(slot(a, "10:00", "11:00")), emptyList()).impact.returnTimeDelta shouldBe null
        ReplanDiff.of(emptyList(), listOf(slot(a, "10:00", "11:00"))).impact.visitCountDelta shouldBe 1
    }

    // ── 속성 ───────────────────────────────────────────────────────────────
    "바뀐 뒤 일정의 모든 슬롯이 결과에 정확히 한 번 나온다 — 조용히 사라지지 않는다" {
        checkAll(Arb.list(Arb.int(0..20), 0..12), Arb.list(Arb.int(0..20), 0..12)) { bs, `as` ->
            val before = bs.distinct().map { slot("k$it", "10:00", "11:00") }
            val after = `as`.distinct().map { slot("k$it", "12:00", "13:00") }

            val result = ReplanDiff.of(before, after)
            after.forEach { s -> result.entries.count { it.slotKey == s.slotKey } shouldBe 1 }
            // 빠진 것도 전부 드러난다
            before.filterNot { s -> after.any { it.slotKey == s.slotKey } }
                .forEach { s -> result.entries.single { it.slotKey == s.slotKey }.change shouldBe Change.REMOVED }
        }
    }

    "방문 수 변화는 언제나 after - before 와 같다" {
        checkAll(Arb.list(Arb.int(0..20), 0..12), Arb.list(Arb.int(0..20), 0..12)) { bs, `as` ->
            val before = bs.distinct().map { slot("k$it", "10:00", "11:00") }
            val after = `as`.distinct().map { slot("k$it", "12:00", "13:00") }
            ReplanDiff.of(before, after).impact.visitCountDelta shouldBe after.size - before.size
        }
    }
})
