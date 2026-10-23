package com.trippilot.recalculation.application

import ch.qos.logback.classic.Logger
import ch.qos.logback.classic.spi.ILoggingEvent
import ch.qos.logback.core.read.ListAppender
import com.trippilot.itinerarygeneration.api.ReplanCommand
import com.trippilot.itinerarygeneration.api.ReplanFacade
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
import org.slf4j.LoggerFactory
import org.springframework.dao.DataAccessResourceFailureException
import org.springframework.dao.DataIntegrityViolationException
import java.time.Duration
import java.time.LocalDate
import java.util.UUID
import java.util.concurrent.CountDownLatch

/** 선계산 서비스 로거의 줄(포맷된 문장) — 산출 끝 요약처럼 실행기 안에서 남긴 줄도 잡힌다(대역 실행기는 호출 스레드에서 돈다). */
private fun preparedLogs(block: () -> Unit): List<String> {
    val logger = LoggerFactory.getLogger(PreparedReplanService::class.java) as Logger
    val appender = ListAppender<ILoggingEvent>().apply { start() }
    logger.addAppender(appender)
    try {
        block()
    } finally {
        logger.detachAppender(appender)
    }
    return appender.list.map { it.formattedMessage }
}

private fun outcomes(lines: List<String>) = lines.map { it.substringAfter("outcome=").substringBefore(' ') }

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

    // 자리는 산출 작업의 finally 에서 돌아오고, 일꾼이 대기열에서 다음 것을 꺼내는 것은 그 뒤다 — 그 사이 대기열은 아직 꽉 차 있다.
    // 거기서 자리를 얻은 사건을 실행기가 거절하면 세션이 FAILED 로 열려 트리거당 1회·하루 상한을 먹는다(자리 선점이 막으려던 바로 그것).
    // 대역 실행기는 용량이 없어 이 창이 안 보인다 — 실물 실행기로 본다.
    "실물 실행기 — 일꾼이 다음 산출을 꺼내기 전에 자리를 얻은 사건도 대기열이 받는다" {
        val f = RecalcFixture(today, "07:15")
        f.replans.proposal = FakeReplans.sampleProposal(today)
        val executor = PreparedReplanService.newExecutor()
        val svc = f.prepared(executor)
        val gate = CountDownLatch(1)
        executor.execute { gate.await() } // 자리를 이미 돌려준 산출이 일꾼을 아직 붙잡고 있는 순간 — 일꾼은 바쁘고 자리는 다 비었다
        val trips = (1..PreparedReplanService.RUNNING + PreparedReplanService.WAITING).map { f.trips.add(today.minusDays(1), today.plusDays(1)) }

        trips.forEach { svc.onRisk(f.riskEvent(today, tripId = it), f.clock.now) }
        gate.countDown()
        svc.shutdown() // 대기열을 다 돌 때까지 기다린다

        f.sessions.system().size shouldBe trips.size
        f.sessions.system().map { it.status }.toSet() shouldBe setOf(ReplanStatus.DRAFT)
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

    // 종료가 시작된 뒤에도 이미 돌던 릴레이 배치는 사건을 넘긴다. 그때 세션을 열면 실행기가 거절해 FAILED 가 그 트리거의 선계산 1회를
    // 먹고(트리거당 1개) 새 파드에서도 다시 준비되지 않는다 — 앱은 i04 대신 실패 얼굴을 본다. 열지 않고 던지면 다음 파드가 다시 받는다.
    "종료가 시작된 뒤 온 사건은 세션을 열지 않고 던진다 — 다음 파드가 같은 사건으로 연다" {
        val f = RecalcFixture(today, "07:15")
        val closing = f.prepared(ParkedExecutor())
        closing.shutdown()
        val event = f.riskEvent(today)

        shouldThrow<IllegalStateException> { closing.onRisk(event, f.clock.now) }
        f.sessions.stored shouldBe emptyMap()

        f.prepared(ParkedExecutor()).onRisk(event, f.clock.now) // 새 파드의 재배달
        f.sessions.system().single().status shouldBe ReplanStatus.SOLVING
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

    // ── 요약 줄 — 결정 28 의 다시 볼 조건을 잰다(G-SA-23) ────────────────────────────

    // 결정 28 은 대기 포함 2분 낡음을 그대로 두고 '오늘 우선'의 예외로 적었다 — 계산 중 2분을 넘긴 이른 날짜 선계산은 늦은 날짜 사건이
    // 닫는다. 그 닫힘이 OPENED 로만 남으면 '낡음으로 닫히는 비율'을 셀 수 없어 2분을 계산 시작부터 잴지((가)) 정할 수 없다.
    "계산 중 2분을 넘긴 이른 날짜 선계산을 늦은 날짜 사건이 닫고 열면 EARLIER_STALE 로 따로 남는다 — OPENED 는 그대로 한 줄" {
        val f = RecalcFixture(today, "07:15")
        val svc = f.prepared(ParkedExecutor()) // 산출이 줄에서 기다린다 — 오늘 선계산은 SOLVING 에 머문다
        svc.onRisk(f.riskEvent(today), f.clock.now)
        val waiting = f.sessions.system().single()
        f.clock.advance(Duration.ofMinutes(3))
        val tomorrows = f.riskEvent(today.plusDays(1))

        val lines = preparedLogs { svc.onRisk(tomorrows, f.clock.now) }

        val opened = f.sessions.openOf(f.tripId).single()
        lines shouldContainExactly listOf(
            "replan.prepared outcome=EARLIER_STALE tripId=${f.tripId} triggerId=${tomorrows.triggerId} session=${waiting.sessionId} date=2026-08-11",
            "replan.prepared outcome=OPENED tripId=${f.tripId} triggerId=${tomorrows.triggerId} session=${opened.sessionId} date=2026-08-12",
        )
        f.sessions.stored.getValue(waiting.sessionId).status shouldBe ReplanStatus.CANCELED // 닫기 규칙은 그대로다
    }

    // 그 예외만 센다 — 섞이면 비율이 부푼다. 저녁마다 오늘 초안(첫 변경 시각이 지남)이 내일 사건에 닫히는 것은 사실로 낡은 정상 닫힘이다.
    "EARLIER_STALE 은 그 예외만이다 — 2분 안(건너뜀)·같은 날 갈아 끼우기·지난 날·초안의 사실로 낡은 이른 날짜는 아니다" {
        val tomorrow = today.plusDays(1)

        // 2분 안 — 결정 28 의 동작 그대로 건너뛴다(오늘 우선)
        RecalcFixture(today, "07:15").run {
            val svc = prepared(ParkedExecutor())
            svc.onRisk(riskEvent(today), clock.now)
            clock.advance(Duration.ofMinutes(1))
            outcomes(preparedLogs { svc.onRisk(riskEvent(tomorrow), clock.now) }) shouldContainExactly listOf("EARLIER_OPEN")
        }
        // 같은 날 — 계산 중 2분을 넘겼어도 낡아서 닫는 것이 아니다(같은 날·늦은 날은 늘 갈아 끼운다)
        RecalcFixture(today, "07:15").run {
            val svc = prepared(ParkedExecutor())
            svc.onRisk(riskEvent(tomorrow), clock.now)
            clock.advance(Duration.ofMinutes(3))
            outcomes(preparedLogs { svc.onRisk(riskEvent(tomorrow), clock.now) }) shouldContainExactly listOf("OPENED")
        }
        // 지난 날 — 산출 중에 멈춘 어제 선계산(EXPIRED)
        RecalcFixture(today, "07:15").run {
            val yesterday = today.minusDays(1)
            sessions.save(
                ReplanSession.start(
                    tripId, UUID.randomUUID(), UUID.randomUUID(), ReplanScope.FULL_DAY, yesterday, kst(yesterday, "20:15"),
                    ReplanOrigin(OriginKind.STAY_ANCHOR, null, null), listOf("WEATHER"), emptyList(), null, emptyList(), kst(yesterday, "20:15"),
                    initiatedBy = ReplanInitiator.SYSTEM,
                ).solving(),
            )
            outcomes(preparedLogs { prepared(ParkedExecutor()).onRisk(riskEvent(today), clock.now) }) shouldContainExactly listOf("OPENED")
        }
        // 초안의 사실로 낡음 — 초안이 바꾸는 첫 슬롯(14:00)이 지났다(EXPIRED)
        RecalcFixture(today, "07:15").run {
            replans.proposal = FakeReplans.sampleProposal(today)
            prepared().onRisk(riskEvent(today), clock.now) // 그 자리에서 초안까지
            clock.now = kst(today, "20:15")
            outcomes(preparedLogs { prepared(ParkedExecutor()).onRisk(riskEvent(tomorrow), clock.now) }) shouldContainExactly listOf("OPENED")
        }
    }

    // 결정 28 의 다른 얼굴 — 2분은 세션 생성부터라 줄에서 기다린 시간이 든다. 줄에서 2분을 넘긴 선계산은 그동안 '없음'으로 보여 늦게
    // 누른 사용자는 직접 요청 화면(i04)으로 간다(BR-SA-23). 산출 끝에 결과와 세션 나이를 남겨야 그 수와 실패 수를 같은 요약에서 센다.
    "산출이 끝나면 FINISHED 로 결과 상태와 세션 나이(산출 시작·끝)를 남긴다 — 2분을 넘겨 끝난 것과 실패를 센다" {
        val f = RecalcFixture(today, "07:15")
        f.replans.proposal = FakeReplans.sampleProposal(today)
        val slow = object : ReplanFacade by f.replans { // 산출 한 번에 40초
            override fun propose(command: ReplanCommand) = f.replans.propose(command).also { f.clock.advance(Duration.ofSeconds(40)) }
        }
        val parked = ParkedExecutor()
        val svc = PreparedReplanService(
            f.service(), f.repository, ReplanSolver(f.sessions, f.archive, slow, NOOP_TX, f.clock),
            ReplanProperties(f.horizon, ReplanProperties.Prepared(PreparedMode.ON)), f.clock, parked,
        )
        val first = f.riskEvent(today)
        val second = f.riskEvent(today, tripId = f.trips.add(today.minusDays(1), today.plusDays(1)))
        svc.onRisk(first, f.clock.now)
        svc.onRisk(second, f.clock.now)
        val (a, b) = f.sessions.system()
        f.clock.advance(Duration.ofMinutes(2)) // 일꾼이 다른 산출을 하는 동안 둘 다 줄에서 기다렸다

        val lines = preparedLogs {
            parked.parked.removeFirst().run() // 대기 2분 + 산출 40초 → 초안
            f.replans.failWith = IllegalStateException("AI 불통")
            parked.parked.removeFirst().run() // 대기 2분 40초 → 실패(FAILED 로 닫힌다)
        }

        lines shouldContainExactly listOf(
            "replan.prepared outcome=FINISHED status=DRAFT waitMs=120000 ageMs=160000 " +
                "tripId=${first.tripId} triggerId=${first.triggerId} session=${a.sessionId} date=2026-08-11",
            "replan.prepared outcome=FINISHED status=FAILED waitMs=160000 ageMs=160000 " +
                "tripId=${second.tripId} triggerId=${second.triggerId} session=${b.sessionId} date=2026-08-11",
        )
    }

    // 요약 한 줄을 위한 조회가 산출 실패처럼 보이면 안 된다 — '기록하지 못했다'는 ERROR 는 화면이 2분 뒤 낡음을 본다는 뜻이다.
    "끝 요약의 상태 조회가 실패해도 기록된 산출은 그대로이고 FINISHED 는 status=null 로 남는다" {
        val f = RecalcFixture(today, "07:15")
        f.replans.proposal = FakeReplans.sampleProposal(today)
        val real = f.sessions
        f.repository = object : ReplanSessionRepository by real {
            override fun findById(sessionId: UUID) = throw DataAccessResourceFailureException("커넥션 없음") // 산출(솔버)은 실물 저장소를 쓴다
        }
        val event = f.riskEvent(today)

        val lines = preparedLogs { f.prepared().onRisk(event, f.clock.now) }

        val s = f.sessions.system().single()
        s.status shouldBe ReplanStatus.DRAFT
        lines shouldContainExactly listOf(
            "replan.prepared outcome=FINISHED status=null waitMs=0 ageMs=0 tripId=${f.tripId} triggerId=${event.triggerId} session=${s.sessionId} date=2026-08-11",
            "replan.prepared outcome=OPENED tripId=${f.tripId} triggerId=${event.triggerId} session=${s.sessionId} date=2026-08-11",
        )
    }
})
