package com.trippilot.recalculation.application

import com.trippilot.core.error.ConflictDetected
import com.trippilot.core.error.ErrorCode
import com.trippilot.core.error.ResourceNotFound
import com.trippilot.recalculation.domain.OriginKind
import com.trippilot.recalculation.domain.ReplanInitiator
import com.trippilot.recalculation.domain.ReplanOrigin
import com.trippilot.recalculation.domain.ReplanScope
import com.trippilot.recalculation.domain.ReplanSession
import com.trippilot.recalculation.domain.ReplanSessionRepository
import com.trippilot.recalculation.domain.ReplanStatus
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldContainExactly
import io.kotest.matchers.shouldBe
import io.kotest.matchers.types.shouldBeInstanceOf
import org.springframework.dao.DataIntegrityViolationException
import java.time.Duration
import java.time.LocalDate
import java.util.UUID

/**
 * 미리 짜 둔 대안의 서비스 규칙(situation-awareness BR-SA-18·19·20 · INV-SA-1·6·7) — T-D4-U.
 *
 * 축은 넷이다: 트리거 진입 날짜 강제 · 전날 창 · 선계산의 열린 세션 정책과 상한 · 낡은 초안 거절.
 * 막지 못하면 사용자에게 보이는 것은 각각 — 내일 알림으로 오늘이 다시 짜임 · 전날 알림 탭이 막다른 길 ·
 * 보고 있던 재계획 화면이 사라짐 · 지난 시각을 다시 짠 초안이 적용됨이다.
 */
class PreparedReplanPolicyTest : StringSpec({

    val start = LocalDate.parse("2026-08-10")
    val end = LocalDate.parse("2026-08-12")
    val today = LocalDate.parse("2026-08-11")
    val tomorrow = today.plusDays(1)

    fun Fixture(now: String = "12:00", on: LocalDate = today, horizon: ReplanHorizon = ReplanHorizon.TODAY) =
        RecalcFixture(on, now, horizon, start, end)

    fun Prepared.opened(): ReplanSession = (this as Prepared.Opened).session
    fun Prepared.skip(): PrepareSkip = (this as Prepared.Skipped).reason

    // ── 트리거 진입 날짜 강제(BR-SA-20 ①) ───────────────────────────────────

    "트리거 진입은 그 트리거의 날짜로 강제된다 — 내일 트리거에 날짜가 없으면 내일 하루 전체" {
        val f = Fixture()
        val t = f.triggers.add(f.tripId, tomorrow)

        val s = f.startUser(triggerId = t, target = null, scope = ReplanScope.PARTIAL_SLOTS)

        s.targetDate shouldBe tomorrow
        s.scope shouldBe ReplanScope.FULL_DAY // 미래일에는 '지금 이후'가 없다
        s.triggerId shouldBe t
    }

    // 구 앱(OTA 없음)은 날짜를 보내지 않거나 오늘을 보낸다 — 서버가 막지 않으면 내일 알림이 오늘을 다시 짠다.
    "요청 날짜가 트리거 날짜와 달라도 트리거가 이긴다" {
        val f = Fixture()
        val t = f.triggers.add(f.tripId, tomorrow)

        f.startUser(triggerId = t, target = today).targetDate shouldBe tomorrow
    }

    "오늘 트리거면 요청한 범위를 그대로 쓴다" {
        val f = Fixture()
        val t = f.triggers.add(f.tripId, today)

        f.startUser(triggerId = t, scope = ReplanScope.PARTIAL_SLOTS).scope shouldBe ReplanScope.PARTIAL_SLOTS
    }

    "없는 트리거·다른 여행의 트리거면 409 — 세션을 열지 않는다" {
        val f = Fixture()
        val otherTrip = f.trips.add(start, end)
        val foreign = f.triggers.add(otherTrip, tomorrow)

        shouldThrow<ConflictDetected> { f.startUser(triggerId = UUID.randomUUID()) }
        shouldThrow<ConflictDetected> { f.startUser(triggerId = foreign) }
        f.sessions.stored shouldBe emptyMap()
    }

    // ── 전날 창(BR-SA-20 ②) ───────────────────────────────────────────────

    val dayBefore = start.minusDays(1)

    "전날 창 — pre-trip 이고 알림으로 들어온 첫날 하루 전체면 연다" {
        val f = Fixture(on = dayBefore, now = "20:20", horizon = ReplanHorizon.PRE_TRIP)
        val t = f.triggers.add(f.tripId, start)

        val s = f.startUser(triggerId = t)

        s.targetDate shouldBe start
        s.scope shouldBe ReplanScope.FULL_DAY
    }

    "전날이어도 지평이 pre-trip 이 아니면 여행 기간 밖이라 409" {
        val f = Fixture(on = dayBefore, now = "20:20", horizon = ReplanHorizon.TOMORROW)
        val t = f.triggers.add(f.tripId, start)

        shouldThrow<ConflictDetected> { f.startUser(triggerId = t) }.message shouldBe "여행 기간에만 재계획할 수 있습니다."
    }

    "전날 창 — 알림 없이 들어오거나 첫날이 아닌 날을 짜려 하면 409(전날 문구)" {
        val f = Fixture(on = dayBefore, now = "20:20", horizon = ReplanHorizon.PRE_TRIP)
        val second = f.triggers.add(f.tripId, start.plusDays(1))

        listOf(
            { f.startUser(triggerId = null, target = start, scope = ReplanScope.FULL_DAY) },
            { f.startUser(triggerId = second) },
        ).forEach { attempt ->
            shouldThrow<ConflictDetected> { attempt() }.message shouldBe "여행 전날에는 알림으로 받은 첫날 일정만 다시 짤 수 있어요."
        }
        f.sessions.stored shouldBe emptyMap()
    }

    "전날 창은 하루 전만이다 — 이틀 전은 여행 기간 밖" {
        val f = Fixture(on = start.minusDays(2), now = "20:20", horizon = ReplanHorizon.PRE_TRIP)
        val t = f.triggers.add(f.tripId, start)

        shouldThrow<ConflictDetected> { f.startUser(triggerId = t) }.message shouldBe "여행 기간에만 재계획할 수 있습니다."
    }

    // ── 여행 전 반영 가드(BR-SA-20 ③) ─────────────────────────────────────

    "여행 전 반영 — 전날 창 조건을 다 만족하면 반영된다" {
        val f = Fixture(on = dayBefore, now = "20:20", horizon = ReplanHorizon.PRE_TRIP)
        f.replans.proposal = FakeReplans.sampleProposal(start)
        val s = f.startUser(triggerId = f.triggers.add(f.tripId, start))

        f.service().apply(f.acc, f.tripId, s.sessionId).status shouldBe ReplanStatus.APPLIED
        f.replans.applied.size shouldBe 1
    }

    // 확정 일정은 복원이 409 라 되돌릴 수 없다 — 정본 승인 전(지평 pre-trip 아님)에는 여행 전 일정을 쓰지 않는다.
    "여행 전 반영 — 전날 창이 닫혔으면 409 이고 일정은 그대로다" {
        val f = Fixture(on = dayBefore, now = "20:20", horizon = ReplanHorizon.PRE_TRIP)
        f.replans.proposal = FakeReplans.sampleProposal(start)
        val s = f.startUser(triggerId = f.triggers.add(f.tripId, start))

        shouldThrow<ConflictDetected> { f.service(ReplanHorizon.TOMORROW).apply(f.acc, f.tripId, s.sessionId) }
        f.replans.applied shouldBe emptyList()
    }

    "여행 전 반영 — 트리거 없는·첫날이 아닌·하루 전체가 아닌 초안은 409" {
        val f = Fixture(on = dayBefore, now = "20:20", horizon = ReplanHorizon.PRE_TRIP)
        fun drafted(trigger: UUID?, date: LocalDate, scope: ReplanScope) = f.sessions.save(
            ReplanSession.start(
                f.tripId, UUID.randomUUID(), trigger, scope, date, f.clock.now, ReplanOrigin(OriginKind.STAY_ANCHOR, null, null),
                emptyList(), emptyList(), null, emptyList(), f.clock.now,
            ).solving().drafted(FakeReplans.sampleProposal(date).toMap()),
        )

        listOf(
            Triple(null, start, ReplanScope.FULL_DAY),
            Triple(UUID.randomUUID(), start.plusDays(1), ReplanScope.FULL_DAY),
            Triple(UUID.randomUUID(), start, ReplanScope.PARTIAL_SLOTS),
        ).forEach { (trigger, date, scope) ->
            val s = drafted(trigger, date, scope)
            shouldThrow<ConflictDetected> { f.service().apply(f.acc, f.tripId, s.sessionId) }
                .message shouldBe "여행 전날에는 알림으로 받은 첫날 일정만 다시 짤 수 있어요."
            f.sessions.save(s.canceled(f.clock.now)) // 다음 경우를 열 자리(여행당 열린 세션 1개)
        }
        f.replans.applied shouldBe emptyList()
    }

    // ── 저장 경합(BR-SA-20 ④) ─────────────────────────────────────────────

    "사용자 시작이 저장에서 다른 세션과 겹치면 409 — 500 으로 새지 않는다" {
        val f = Fixture()
        val racing = f.sessions
        f.repository = object : ReplanSessionRepository by racing {
            override fun save(session: ReplanSession): ReplanSession =
                if (session.status == ReplanStatus.COLLECTING) throw DataIntegrityViolationException("ux_replan_session_open")
                else racing.save(session)
        }

        shouldThrow<ConflictDetected> { f.startUser() }.message shouldBe "다른 재계획이 막 시작됐어요. 다시 시도해 주세요."
    }

    // ── 선계산 — 무엇을 여나 ─────────────────────────────────────────────────

    "선계산은 SYSTEM 세션을 산출 직전(SOLVING)까지 연다 — 사건의 재료를 싣고 자유 텍스트·사용자 좌표는 없다" {
        val f = Fixture()
        val t = f.triggers.add(f.tripId, today)

        val s = f.service().prepare(
            PrepareReplan(f.acc, f.tripId, t, listOf("TEMP_CLOSED"), emptyList(), listOf(UUID.fromString("00000000-0000-4000-8000-0000000000aa"))),
        ).opened()

        s.initiatedBy shouldBe ReplanInitiator.SYSTEM
        s.triggerId shouldBe t
        s.status shouldBe ReplanStatus.SOLVING
        s.targetDate shouldBe today
        s.scope shouldBe ReplanScope.PARTIAL_SLOTS // 오늘은 '지금 이후'(CD7) — 체크 안 한 지난 슬롯을 잠근다
        s.reasons shouldContainExactly listOf("TEMP_CLOSED")
        s.excludedPoiIds shouldContainExactly listOf(UUID.fromString("00000000-0000-4000-8000-0000000000aa"))
        s.freeText shouldBe null
        (s.origin.kind in setOf(OriginKind.GPS, OriginKind.MANUAL)) shouldBe false // 서버 사다리 — 기기 좌표 없음
        f.legalLogs.collections shouldBe emptyList()
        f.replans.commands shouldBe emptyList() // 산출은 전용 실행기 몫이다 — 여기서 AI 를 부르지 않는다
    }

    "내일 위험의 선계산은 내일 하루 전체다" {
        val f = Fixture(now = "20:15")
        val s = f.prepare(f.triggers.add(f.tripId, tomorrow)).opened()

        s.targetDate shouldBe tomorrow
        s.scope shouldBe ReplanScope.FULL_DAY
    }

    "같은 트리거로 두 번 오면 둘째는 DUPLICATE — 재배달에도 세션은 하나다" {
        val f = Fixture()
        val t = f.triggers.add(f.tripId, today)

        f.prepare(t).shouldBeInstanceOf<Prepared.Opened>()
        f.prepare(t).skip() shouldBe PrepareSkip.DUPLICATE
        f.sessions.system().size shouldBe 1
    }

    "진입 검증에 걸리면 INVALID — 없는 트리거·지난 날·남의 여행" {
        val f = Fixture()
        val yesterday = f.triggers.add(f.tripId, today.minusDays(1))

        f.prepare(UUID.randomUUID()).skip() shouldBe PrepareSkip.INVALID
        f.prepare(yesterday).skip() shouldBe PrepareSkip.INVALID
        f.service().prepare(PrepareReplan(UUID.randomUUID(), f.tripId, f.triggers.add(f.tripId, today), listOf("WEATHER"), emptyList(), emptyList()))
            .skip() shouldBe PrepareSkip.INVALID
        f.sessions.stored shouldBe emptyMap()
    }

    // ── 선계산 — 열린 세션 정책(BR-SA-18 ② · INV-SA-6) ─────────────────────────

    "30분 안에 연 사용자 세션이 있으면 건너뛴다 — 보고 있는 화면을 빼앗지 않는다(INV-SA-6)" {
        val f = Fixture()
        val user = f.startUser()
        f.clock.advance(Duration.ofMinutes(29))

        f.prepare(f.triggers.add(f.tripId, today)).skip() shouldBe PrepareSkip.OPEN_SESSION
        f.sessions.stored.getValue(user.sessionId).isOpen shouldBe true
    }

    "30분이 지난 사용자 세션은 방치로 보고 닫고 연다" {
        val f = Fixture()
        val user = f.startUser()
        f.clock.advance(Duration.ofMinutes(30))

        f.prepare(f.triggers.add(f.tripId, today)).shouldBeInstanceOf<Prepared.Opened>()
        f.sessions.stored.getValue(user.sessionId).status shouldBe ReplanStatus.CANCELED
        f.sessions.openOf(f.tripId).single().initiatedBy shouldBe ReplanInitiator.SYSTEM
    }

    "더 이른 날짜의 선계산이 살아 있으면 건너뛴다 — 오늘 초안이 내일 것에 밀리지 않는다" {
        val f = Fixture(now = "07:15")
        f.replans.proposal = FakeReplans.sampleProposal(today) // 초안이 바꾸는 첫 슬롯 14:00 — 아침엔 살아 있다
        val todays = f.prepare(f.triggers.add(f.tripId, today)).opened().also { f.solver.solveNow(f.acc, it.sessionId) }
        f.clock.advance(Duration.ofMinutes(5))

        f.prepare(f.triggers.add(f.tripId, tomorrow)).skip() shouldBe PrepareSkip.EARLIER_OPEN
        f.sessions.stored.getValue(todays.sessionId).isOpen shouldBe true
    }

    "더 이른 날짜의 선계산이 낡았으면 닫고 연다 — 낡은 초안이 내일 대안을 막지 않는다" {
        val f = Fixture(now = "07:15")
        f.replans.proposal = FakeReplans.sampleProposal(today)
        val todays = f.prepare(f.triggers.add(f.tripId, today)).opened()
        f.solver.solveNow(f.acc, todays.sessionId) // DRAFT — 초안 14:00 슬롯을 더한다
        f.clock.now = kst(today, "20:15")         // 그 시각이 지났다 → ② EXPIRED

        f.prepare(f.triggers.add(f.tripId, tomorrow)).shouldBeInstanceOf<Prepared.Opened>()
        f.sessions.stored.getValue(todays.sessionId).status shouldBe ReplanStatus.CANCELED
    }

    "지난 날의 열린 세션은 닫고 연다 — 이미 지나간 하루의 초안이 오늘을 막지 않는다" {
        val f = Fixture(now = "07:15")
        val yesterday = today.minusDays(1)
        val stuck = f.sessions.save(
            ReplanSession.start(
                f.tripId, UUID.randomUUID(), UUID.randomUUID(), ReplanScope.FULL_DAY, yesterday, kst(yesterday, "20:15"),
                ReplanOrigin(OriginKind.STAY_ANCHOR, null, null), listOf("WEATHER"), emptyList(), null, emptyList(), kst(yesterday, "20:15"),
                initiatedBy = ReplanInitiator.SYSTEM,
            ).solving().drafted(FakeReplans.sampleProposal(yesterday).toMap()),
        )

        f.prepare(f.triggers.add(f.tripId, today)).shouldBeInstanceOf<Prepared.Opened>()
        f.sessions.stored.getValue(stuck.sessionId).status shouldBe ReplanStatus.CANCELED
    }

    "같은 날·늦은 날의 선계산은 닫고 연다 — 새 위험 그림으로 갈아 끼우고, 대체된 것은 낡음(STALE)이다" {
        val f = Fixture(now = "07:15")
        val first = f.prepare(f.triggers.add(f.tripId, tomorrow)).opened()
        val sameDay = f.prepare(f.triggers.add(f.tripId, tomorrow)).opened()
        val earlier = f.prepare(f.triggers.add(f.tripId, today)).opened()

        f.sessions.stored.getValue(first.sessionId).status shouldBe ReplanStatus.CANCELED
        f.sessions.stored.getValue(sameDay.sessionId).status shouldBe ReplanStatus.CANCELED
        f.sessions.openOf(f.tripId).single().sessionId shouldBe earlier.sessionId
        f.service().view(f.acc, f.sessions.stored.getValue(first.sessionId)).stale shouldBe true
    }

    "사용자 진입은 열린 선계산을 닫고 시작한다 — 사용자가 고른 것이 이긴다" {
        val f = Fixture()
        val sys = f.prepare(f.triggers.add(f.tripId, today)).opened()

        f.startUser()

        f.sessions.stored.getValue(sys.sessionId).status shouldBe ReplanStatus.CANCELED
        f.sessions.openOf(f.tripId).single().initiatedBy shouldBe ReplanInitiator.USER
    }

    // ── 선계산 — 상한(BR-SA-18 ③ · O-SA-10) ─────────────────────────────────

    "여행당 하루 3개까지 — 넷째는 TRIP_CAP, 다음 날(KST)이면 다시 센다" {
        val f = Fixture(now = "07:15")
        repeat(3) { f.prepare(f.triggers.add(f.tripId, tomorrow)).shouldBeInstanceOf<Prepared.Opened>() }

        f.prepare(f.triggers.add(f.tripId, tomorrow)).skip() shouldBe PrepareSkip.TRIP_CAP

        f.clock.now = kst(tomorrow, "07:15")
        f.prepare(f.triggers.add(f.tripId, tomorrow)).shouldBeInstanceOf<Prepared.Opened>()
    }

    "전체 하루 100개까지 — 101째 여행은 GLOBAL_CAP" {
        val f = Fixture(now = "07:15")
        val tripIds = (1..101).map { f.trips.add(start, end) }
        tripIds.take(100).forEach { f.prepare(f.triggers.add(it, today), it).shouldBeInstanceOf<Prepared.Opened>() }

        f.prepare(f.triggers.add(tripIds.last(), today), tripIds.last()).skip() shouldBe PrepareSkip.GLOBAL_CAP
        f.sessions.system().size shouldBe 100
    }

    // ── 준비된 대안 조회 · 낡음(BR-SA-19 · INV-SA-7) ───────────────────────────

    "그 날짜의 가장 최근 선계산을 돌려준다 — 대체돼 닫힌 것도(앱이 '없음'으로 읽는다)" {
        val f = Fixture(now = "07:15")
        f.prepare(f.triggers.add(f.tripId, tomorrow))
        f.clock.advance(Duration.ofMinutes(60))
        val latest = f.prepare(f.triggers.add(f.tripId, tomorrow)).opened()
        f.startUser() // 사용자 진입이 선계산을 닫는다

        val found = f.service().findPrepared(f.acc, f.tripId, tomorrow)
        found.sessionId shouldBe latest.sessionId
        found.status shouldBe ReplanStatus.CANCELED
    }

    "준비된 대안이 없거나 남의 여행이면 404 — 존재를 숨긴다" {
        val f = Fixture()
        f.prepare(f.triggers.add(f.tripId, today))

        shouldThrow<ResourceNotFound> { f.service().findPrepared(f.acc, f.tripId, tomorrow) }
        shouldThrow<ResourceNotFound> { f.service().findPrepared(UUID.randomUUID(), f.tripId, today) }
    }

    "초안이 바꾸는 첫 슬롯이 지나면 낡음으로 보이고 적용은 409 EXPIRED — 일정은 그대로다" {
        val f = Fixture(now = "07:15")
        val poi = UUID.randomUUID()
        f.trips.trips.getValue(f.tripId).slots = listOf(plannedSlot(today, poi, "10:00", "11:00"))
        f.replans.proposal = FakeReplans.sampleProposal(today) // 10:00 슬롯을 빼고 14:00 를 넣는다
        val s = f.prepare(f.triggers.add(f.tripId, today)).opened().also { f.solver.solveNow(f.acc, it.sessionId) }

        f.clock.now = kst(today, "09:59")
        f.service().view(f.acc, f.sessions.stored.getValue(s.sessionId)).stale shouldBe false

        f.clock.now = kst(today, "10:01")
        f.service().view(f.acc, f.sessions.stored.getValue(s.sessionId)).stale shouldBe true
        shouldThrow<ConflictDetected> { f.service().apply(f.acc, f.tripId, s.sessionId) }.errorCode shouldBe ErrorCode.EXPIRED
        f.replans.applied shouldBe emptyList()
    }

    "그 날 다녀온 곳이 초안에 없으면 적용은 409 STALE" {
        val f = Fixture(now = "07:15")
        f.replans.proposal = FakeReplans.sampleProposal(today)
        val s = f.prepare(f.triggers.add(f.tripId, today)).opened().also { f.solver.solveNow(f.acc, it.sessionId) }
        f.completed += "$today#${UUID.randomUUID()}"

        shouldThrow<ConflictDetected> { f.service().apply(f.acc, f.tripId, s.sessionId) }.errorCode shouldBe ErrorCode.STALE
        f.replans.applied shouldBe emptyList()
    }

    "대체돼 닫힌 선계산의 적용은 409 STALE — 일반 충돌이 아니라 낡음으로 말한다" {
        val f = Fixture(now = "07:15")
        val first = f.prepare(f.triggers.add(f.tripId, today)).opened()
        f.prepare(f.triggers.add(f.tripId, today))

        shouldThrow<ConflictDetected> { f.service().apply(f.acc, f.tripId, first.sessionId) }.errorCode shouldBe ErrorCode.STALE
    }

    "낡지 않은 선계산은 사용자가 적용한다 — 반영은 그때 한 번이고 확정 사건이 트리거·날짜를 싣는다" {
        val f = Fixture(now = "07:15")
        f.replans.proposal = FakeReplans.sampleProposal(tomorrow)
        val t = f.triggers.add(f.tripId, tomorrow)
        val s = f.prepare(t).opened().also { f.solver.solveNow(f.acc, it.sessionId) }
        f.replans.applied shouldBe emptyList() // 산출까지는 초안뿐이다(INV-SA-1)

        f.service().apply(f.acc, f.tripId, s.sessionId).status shouldBe ReplanStatus.APPLIED

        f.replans.applied.size shouldBe 1
        (f.events.published.single() as com.trippilot.recalculation.api.event.ItineraryRecalculated).let {
            it.triggerId shouldBe t.toString()
            it.targetDate shouldBe tomorrow.toString()
        }
    }

    "사용자 세션은 낡음 판정을 받지 않는다 — 종전 적용 그대로" {
        val f = Fixture(now = "07:15")
        f.replans.proposal = FakeReplans.sampleProposal(today)
        val s = f.startUser()
        f.completed += "$today#${UUID.randomUUID()}"

        f.service().view(f.acc, f.sessions.stored.getValue(s.sessionId)).stale shouldBe false
        f.service().apply(f.acc, f.tripId, s.sessionId).status shouldBe ReplanStatus.APPLIED
    }

    // ── 산출 분리(BR-SA-18 ③) ─────────────────────────────────────────────

    "solveNow 는 산출 중이 아니면 AI 를 부르지 않는다 — 대체된 선계산은 비용 0" {
        val f = Fixture()
        val s = f.prepare(f.triggers.add(f.tripId, today)).opened()
        f.sessions.save(s.canceled(f.clock.now))

        f.solver.solveNow(f.acc, s.sessionId)

        f.replans.commands shouldBe emptyList()
    }

    "포기하면 FAILED 로 닫는다 — 열린 자리를 붙잡지 않는다" {
        val f = Fixture()
        val s = f.prepare(f.triggers.add(f.tripId, today)).opened()

        f.solver.giveUp(s.sessionId)

        f.sessions.stored.getValue(s.sessionId).status shouldBe ReplanStatus.FAILED
        f.sessions.openOf(f.tripId) shouldBe emptyList()
    }
})
