package com.trippilot.recalculation.domain

import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import io.kotest.property.Arb
import io.kotest.property.arbitrary.boolean
import io.kotest.property.arbitrary.enum
import io.kotest.property.arbitrary.int
import io.kotest.property.arbitrary.long
import io.kotest.property.arbitrary.orNull
import io.kotest.property.checkAll
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.ZoneId
import java.util.UUID

/**
 * 선계산 세션의 시작 주체와 낡음(situation-awareness BR-SA-19 · INV-SA-7 · PBT-SA-16).
 *
 * 낡음은 **시간 창이 아니라 사실**로 판정한다 — 30분 창이면 저녁·전날에 짠 초안이 아침에 무조건 버려진다.
 * 막지 못하면 사용자에게 보이는 것: 지난 슬롯을 다시 배치한 초안이 적용되고(DEC-U4-9 위반),
 * 다녀온 곳이 일정에서 사라진다(INV-U4-04).
 */
class ReplanStalenessTest : StringSpec({

    val kst = ZoneId.of("Asia/Seoul")
    val day = LocalDate.parse("2026-08-11")
    fun at(date: LocalDate, hhmm: String): Instant = LocalDateTime.of(date, LocalTime.parse(hhmm)).atZone(kst).toInstant()
    val gps = ReplanOrigin(OriginKind.GPS, 33.45, 126.56)

    fun session(
        initiatedBy: ReplanInitiator = ReplanInitiator.SYSTEM,
        target: LocalDate = day,
        createdAt: Instant = at(day.minusDays(1), "20:15"),
    ) = ReplanSession.start(
        UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), ReplanScope.FULL_DAY, target, createdAt,
        ReplanOrigin(OriginKind.STAY_ANCHOR, null, null), listOf("WEATHER"), emptyList(), null, emptyList(), createdAt,
        initiatedBy = initiatedBy,
    )

    fun draft(s: ReplanSession) = s.solving().drafted(mapOf("date" to s.targetDate.toString()))

    // ── 시작 주체 ─────────────────────────────────────────────────────────

    "시작 주체를 말하지 않으면 사용자다 — 종전 진입은 모두 사용자 진입이었다" {
        ReplanSession.start(
            UUID.randomUUID(), UUID.randomUUID(), null, ReplanScope.PARTIAL_SLOTS, day, at(day, "09:00"), gps,
            emptyList(), emptyList(), null, emptyList(), at(day, "09:00"),
        ).initiatedBy shouldBe ReplanInitiator.USER
    }

    // 근거 없는 선계산은 '왜 이 대안인가'를 잃는다 — DB CHECK(chk_replan_session_system_trigger)와 같은 규칙.
    "선계산 세션에는 근거 트리거가 있어야 한다" {
        shouldThrow<IllegalArgumentException> {
            ReplanSession.start(
                UUID.randomUUID(), UUID.randomUUID(), null, ReplanScope.FULL_DAY, day, at(day, "09:00"), gps,
                emptyList(), emptyList(), null, emptyList(), at(day, "09:00"), initiatedBy = ReplanInitiator.SYSTEM,
            )
        }
    }

    // ── 낡음 4종 + 고착 ────────────────────────────────────────────────────

    "① 대상 날이 지났으면 EXPIRED — 이미 지나간 하루를 덮어쓰는 초안이다" {
        draft(session(target = day)).stalenessAt(at(day.plusDays(1), "00:01"), DraftFacts.NONE) shouldBe Staleness.EXPIRED
    }

    "② 오늘이고 초안이 바꾸는 첫 슬롯의 계획 시작이 지났으면 EXPIRED — 그 전까지는 유효하다" {
        val facts = DraftFacts(firstChangeAt = LocalTime.parse("10:00"), completedMissing = false)
        val s = draft(session(target = day))

        s.stalenessAt(at(day.minusDays(1), "21:00"), facts) shouldBe null // 저녁에 짠 내일 초안
        s.stalenessAt(at(day, "09:59"), facts) shouldBe null              // 그 날 첫 변경 슬롯 전
        s.stalenessAt(at(day, "10:00"), facts) shouldBe null              // 시작 시각 그 자체는 아직 지나지 않았다
        s.stalenessAt(at(day, "10:01"), facts) shouldBe Staleness.EXPIRED
    }

    "바꾸는 슬롯이 없는 초안은 시각으로 낡지 않는다 — 그 날이 지나기 전까지" {
        draft(session(target = day)).stalenessAt(at(day, "23:59"), DraftFacts.NONE) shouldBe null
    }

    "③ 그 날 완료한 방문이 초안에 없으면 STALE — 적용하면 다녀온 곳이 사라진다" {
        draft(session(target = day)).stalenessAt(at(day, "08:00"), DraftFacts(null, completedMissing = true)) shouldBe Staleness.STALE
    }

    "④ 대체돼 닫힌 선계산은 STALE" {
        session().solving().canceled(at(day, "07:20")).stalenessAt(at(day, "07:21"), DraftFacts.NONE) shouldBe Staleness.STALE
    }

    "수집·산출이 2분을 넘으면 낡음으로 보인다 — 파드 재시작 고착이면 앱이 같은 입력으로 다시 요청한다" {
        val created = at(day, "07:15")
        val solving = session(createdAt = created).solving()

        solving.stalenessAt(created.plus(Duration.ofMinutes(2)), DraftFacts.NONE) shouldBe null
        solving.stalenessAt(created.plus(Duration.ofMinutes(2)).plusSeconds(1), DraftFacts.NONE) shouldBe Staleness.STALE
        session(createdAt = created).stalenessAt(created.plus(Duration.ofMinutes(3)), DraftFacts.NONE) shouldBe Staleness.STALE
    }

    "대안 없음·실패는 초안이 없어 날짜만 본다" {
        val created = at(day, "07:15")
        val none = session(createdAt = created).solving().noSolution(created)
        none.stalenessAt(at(day, "23:00"), DraftFacts(LocalTime.parse("08:00"), true)) shouldBe null
        none.stalenessAt(at(day.plusDays(1), "07:00"), DraftFacts.NONE) shouldBe Staleness.EXPIRED
    }

    "반영된 선계산은 낡지 않는다 — 낡음은 적용 전 초안의 말이다" {
        draft(session()).applied(at(day, "08:00")).stalenessAt(at(day.plusDays(3), "08:00"), DraftFacts(LocalTime.MIN, true)) shouldBe null
    }

    "사용자 세션은 낡음 판정을 받지 않는다 — 사람이 보고 있는 화면이다" {
        val user = draft(session(initiatedBy = ReplanInitiator.USER).copy(triggerId = null))
        user.stalenessAt(at(day.plusDays(5), "12:00"), DraftFacts(LocalTime.MIN, true)) shouldBe null
        user.isStaleAt(at(day.plusDays(5), "12:00"), DraftFacts(LocalTime.MIN, true)) shouldBe false
    }

    // ── 재료(지금 일정·초안·실적) → 사실 ─────────────────────────────────────

    val a = UUID.randomUUID()
    val b = UUID.randomUUID()
    val c = UUID.randomUUID()
    fun slot(poi: UUID, start: String, end: String, fixed: Boolean = false) =
        ReplanDiff.SlotView("$day#$poi", LocalTime.parse(start), LocalTime.parse(end), fixed)

    "바뀌는 슬롯은 추가·삭제·이동이고, 첫 변경 시각은 지금 일정과 초안 시각 중 이른 것이다" {
        val before = listOf(slot(a, "09:00", "10:00"), slot(b, "13:00", "14:00"))
        val after = listOf(slot(a, "09:00", "10:00"), slot(c, "12:00", "13:00"), slot(b, "15:00", "16:00"))

        // a 는 그대로(무시) · c 추가 12:00 · b 이동 13:00 → 15:00
        DraftFacts.of(day, before, after, emptySet()).firstChangeAt shouldBe LocalTime.parse("12:00")
        // 지운 슬롯도 바뀐 것이다 — 계획 시작은 지금 일정 쪽 시각이다
        DraftFacts.of(day, before, listOf(slot(a, "09:00", "10:00")), emptySet()).firstChangeAt shouldBe LocalTime.parse("13:00")
        // 고정 슬롯은 바꾸지 않는다(HC3) — 시각이 같아 그대로다
        DraftFacts.of(day, listOf(slot(a, "08:00", "09:00", fixed = true)), listOf(slot(a, "08:00", "09:00", fixed = true)), emptySet())
            .firstChangeAt shouldBe null
    }

    "완료 방문 대조는 그 날짜 것만 본다 — 다른 날 실적이 오늘 초안을 낡게 하지 않는다" {
        val after = listOf(slot(a, "09:00", "10:00"))
        DraftFacts.of(day, after, after, setOf("$day#$a")).completedMissing shouldBe false
        DraftFacts.of(day, after, after, setOf("$day#$b")).completedMissing shouldBe true
        DraftFacts.of(day, after, after, setOf("${day.minusDays(1)}#$b")).completedMissing shouldBe false
    }

    // ── PBT-SA-16 ─────────────────────────────────────────────────────────

    "PBT-SA-16 — 낡음은 시간에 단조이고(한 번 낡으면 계속 낡다) 사용자 세션은 늘 낡지 않는다" {
        checkAll(
            Arb.enum<ReplanStatus>(),
            Arb.enum<ReplanInitiator>(),
            Arb.int(-2..2),                       // 대상 날짜 = day + n
            Arb.int(0..(24 * 60 - 1)).orNull(),   // 첫 변경 시각(분)
            Arb.boolean(),                        // 완료 방문 누락
            Arb.long(0L..(4 * 24 * 60L)),         // 첫 관측 시각(분, day-2 00:00 부터)
            Arb.long(0L..(3 * 24 * 60L)),         // 그 뒤로 흐른 시간(분)
        ) { status, who, offset, firstChange, missing, t1, dt ->
            val origin = at(day.minusDays(2), "00:00")
            val s = session(initiatedBy = who, target = day.plusDays(offset.toLong()), createdAt = origin.plus(Duration.ofMinutes(t1 / 2)))
                .copy(status = status, closedAt = if (status in OPEN) null else origin)
                .let { if (who == ReplanInitiator.USER) it.copy(triggerId = null) else it }
            val facts = DraftFacts(firstChange?.let { LocalTime.MIN.plusMinutes(it.toLong()) }, missing)
            val first = origin.plus(Duration.ofMinutes(t1))
            val later = first.plus(Duration.ofMinutes(dt))

            if (s.isStaleAt(first, facts)) s.isStaleAt(later, facts) shouldBe true
            if (who == ReplanInitiator.USER) s.isStaleAt(later, facts) shouldBe false
        }
    }
}) {
    private companion object {
        private val OPEN = setOf(ReplanStatus.COLLECTING, ReplanStatus.SOLVING, ReplanStatus.DRAFT)
    }
}
