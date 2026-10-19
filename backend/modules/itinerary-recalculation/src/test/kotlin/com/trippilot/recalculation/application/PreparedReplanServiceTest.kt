package com.trippilot.recalculation.application

import com.trippilot.recalculation.domain.ReplanInitiator
import com.trippilot.recalculation.domain.ReplanSession
import com.trippilot.recalculation.domain.ReplanSessionRepository
import com.trippilot.recalculation.domain.ReplanStatus
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldContainExactly
import io.kotest.matchers.shouldBe
import org.springframework.dao.DataAccessResourceFailureException
import org.springframework.dao.DataIntegrityViolationException
import java.time.Duration
import java.time.LocalDate
import java.util.UUID

/**
 * 선계산 실행(BR-SA-18 ①③) — 거름·실행 자리·전용 실행기·실패 경로.
 *
 * 막지 못하면 사용자에게 보이는 것: 대기열이 넘친 날 FAILED 세션이 하루 상한을 먹어 정작 오늘 위험에 초안이 없다 ·
 * 산출이 릴레이 스레드를 25초씩 막아 알림이 늦게 간다 · 실행기 거절로 SOLVING 이 남아 화면이 끝나지 않는다.
 */
class PreparedReplanServiceTest : StringSpec({

    val today = LocalDate.parse("2026-08-11")

    "위험 사건 → SYSTEM 세션을 열고 전용 실행기가 초안까지 짠다 — 일정은 그대로다(INV-SA-1)" {
        val f = RecalcFixture(today, "07:15")
        f.replans.proposal = FakeReplans.sampleProposal(today)
        val event = f.riskEvent(today, risks = listOf(ReplanMaterial.Risk("WEATHER", "WIND", emptyList(), null)))

        f.prepared().onRisk(event, f.clock.now)

        val s = f.sessions.system().single()
        s.status shouldBe ReplanStatus.DRAFT
        s.triggerId shouldBe event.triggerId
        s.reasons shouldContainExactly listOf("WEATHER")
        s.directives shouldContainExactly listOf("AVOID_OUTDOOR")
        f.replans.commands.single().directives shouldContainExactly listOf("AVOID_OUTDOOR")
        f.replans.applied shouldBe emptyList()
    }

    "스위치가 꺼져 있으면 아무것도 하지 않는다 — 세션도 AI 호출도 없다" {
        val f = RecalcFixture(today, "07:15")

        f.prepared(mode = PreparedMode.OFF).onRisk(f.riskEvent(today), f.clock.now)

        f.sessions.stored shouldBe emptyMap()
        f.replans.commands shouldBe emptyList()
    }

    "30분 넘은 사건은 무시한다 — 릴레이가 오래 밀렸던 사건의 초안은 이미 늦다" {
        val f = RecalcFixture(today, "09:00")
        val svc = f.prepared()

        svc.onRisk(f.riskEvent(today), f.clock.now.minus(Duration.ofMinutes(31)))
        f.sessions.stored shouldBe emptyMap()

        svc.onRisk(f.riskEvent(today), f.clock.now.minus(Duration.ofMinutes(30)))
        f.sessions.system().size shouldBe 1
    }

    "재료가 없으면(흐림뿐) 열지 않는다" {
        val f = RecalcFixture(today, "07:15")

        f.prepared().onRisk(f.riskEvent(today, risks = listOf(ReplanMaterial.Risk("WEATHER", "CLOUD", emptyList(), "SOME"))), f.clock.now)

        f.sessions.stored shouldBe emptyMap()
    }

    // 자리를 먼저 잡고 세션을 연다 — 순서가 거꾸로면 넘친 날 FAILED 세션이 하루 상한을 먹는다.
    "실행 자리(실행 1 + 대기 10)를 못 얻으면 세션 없이 BUSY — 상한도 트리거당 1회도 쓰지 않는다" {
        val f = RecalcFixture(today, "07:15")
        val parked = ParkedExecutor()
        val svc = f.prepared(parked)
        val trips = (1..12).map { f.trips.add(today.minusDays(1), today.plusDays(1)) }
        val events = trips.map { f.riskEvent(today, tripId = it) }

        events.take(11).forEach { svc.onRisk(it, f.clock.now) }
        svc.onRisk(events.last(), f.clock.now)

        f.sessions.system().size shouldBe 11
        f.sessions.openOf(trips.last()) shouldBe emptyList() // BUSY — 세션이 없다

        parked.runAll() // 자리가 비었다
        svc.onRisk(events.last(), f.clock.now) // 같은 사건의 재배달 — 트리거당 1회를 쓰지 않았으니 이번엔 연다
        f.sessions.openOf(trips.last()).single().initiatedBy shouldBe ReplanInitiator.SYSTEM
    }

    "실행기가 거절하면(종료 중) 세션을 FAILED 로 닫는다 — 열린 자리를 붙잡지 않고 실행 자리도 돌려준다" {
        val f = RecalcFixture(today, "07:15")
        val closing = ParkedExecutor(reject = true)
        val svc = f.prepared(closing)

        svc.onRisk(f.riskEvent(today), f.clock.now)

        f.sessions.system().single().status shouldBe ReplanStatus.FAILED
        f.sessions.openOf(f.tripId) shouldBe emptyList()
        closing.reject = false
        repeat(11) { svc.onRisk(f.riskEvent(today, tripId = f.trips.add(today.minusDays(1), today.plusDays(1))), f.clock.now) }
        closing.parked.size shouldBe 11 // 거절된 한 건이 자리를 새게 했다면 11번째는 BUSY 였다
    }

    "사용자 시작과 같은 순간 저장이 겹치면(부분 유니크) OPEN_SESSION 으로 접는다 — 던지지 않는다" {
        val f = RecalcFixture(today, "07:15")
        val real = f.sessions
        f.repository = object : ReplanSessionRepository by real {
            override fun save(session: ReplanSession): ReplanSession =
                if (session.initiatedBy == ReplanInitiator.SYSTEM && session.status == ReplanStatus.COLLECTING) {
                    throw DataIntegrityViolationException("ux_replan_session_open")
                } else {
                    real.save(session)
                }
        }

        f.prepared().onRisk(f.riskEvent(today), f.clock.now)

        f.sessions.stored shouldBe emptyMap()
        f.replans.commands shouldBe emptyList()
    }

    // 던져야 릴레이가 이벤트째 다시 배달한다(#1348). 삼키면 그 위험의 초안은 영영 없다 — 앱은 i04 로만 간다.
    "일시 오류(DB)는 던진다 — 릴레이가 재시도하고, 실행 자리는 돌려준다" {
        val f = RecalcFixture(today, "07:15")
        val real = f.sessions
        var down = true
        f.repository = object : ReplanSessionRepository by real {
            override fun findSystemByTrigger(triggerId: UUID) =
                if (down) throw DataAccessResourceFailureException("커넥션 없음") else real.findSystemByTrigger(triggerId)
        }
        val parked = ParkedExecutor()
        val svc = f.prepared(parked)
        val event = f.riskEvent(today)

        repeat(11) { shouldThrow<DataAccessResourceFailureException> { svc.onRisk(event, f.clock.now) } }

        down = false
        svc.onRisk(event, f.clock.now) // 자리가 새지 않았다 — 열한 번 실패 뒤에도 연다
        f.sessions.system().size shouldBe 1
    }

    "종료 때 시작 못 한 산출은 FAILED 로 닫는다 — SOLVING 으로 남기지 않는다(INV-4)" {
        val f = RecalcFixture(today, "07:15")
        val parked = ParkedExecutor()
        val svc = f.prepared(parked)
        svc.onRisk(f.riskEvent(today), f.clock.now)

        svc.shutdown()

        f.sessions.system().single().status shouldBe ReplanStatus.FAILED
        f.replans.commands shouldBe emptyList()
    }
})
