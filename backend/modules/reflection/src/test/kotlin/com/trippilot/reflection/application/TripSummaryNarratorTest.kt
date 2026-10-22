package com.trippilot.reflection.application

import com.fasterxml.jackson.databind.ObjectMapper
import com.trippilot.archive.api.ArchiveDayView
import com.trippilot.archive.api.ArchiveRecordFacade
import com.trippilot.archive.api.ArchiveVisitView
import com.trippilot.changelog.api.AppendChangeLog
import com.trippilot.changelog.api.ChangeLogEntryView
import com.trippilot.changelog.api.ChangeLogFacade
import com.trippilot.placedata.api.FrozenPoiView
import com.trippilot.placedata.api.PoiSurfaceFacade
import com.trippilot.placedata.api.PoiSurfaceView
import com.trippilot.profile.api.PreferenceFacade
import com.trippilot.profile.api.PreferenceSnapshot
import com.trippilot.reflection.domain.ReflectionCard
import com.trippilot.reflection.domain.ReflectionSource
import com.trippilot.reflection.domain.TripSummary
import com.trippilot.reflection.domain.TripSummaryRepository
import com.trippilot.reflection.domain.TripSummaryStats
import com.trippilot.reflection.domain.DistanceSource
import com.trippilot.reflection.domain.port.ReflectionAgentInput
import com.trippilot.reflection.domain.port.ReflectionAgentPort
import com.trippilot.reflection.domain.port.ReflectionEvent
import com.trippilot.reflection.domain.port.ReflectionVisit
import com.trippilot.trip.api.OwnedTripPeriod
import com.trippilot.trip.api.TripDestinationRef
import com.trippilot.trip.api.TripFacade
import com.trippilot.trip.api.TripGenerationContext
import com.trippilot.trip.api.TripOwnerFacade
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import io.micrometer.core.instrument.simple.SimpleMeterRegistry
import org.springframework.transaction.support.TransactionOperations
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.LocalDate
import java.util.UUID
import java.util.concurrent.AbstractExecutorService
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.TimeUnit

/**
 * 여행 요약의 AI 회고(TRIP-1488) — 붙일 때만 붙이고, 못 붙이면 규칙 요약이 그대로 남는가.
 *
 * 실패 모습이 조용하다 — AI 가 엉뚱한 문장을 줘도, 이미 붙은 문장을 덮어도 화면에는 오류가 없다. 그래서 갈래마다 저장된 값을 본다.
 */
class TripSummaryNarratorTest : StringSpec({

    val acc = UUID.randomUUID()
    val tripId = UUID.randomUUID()
    val start = LocalDate.parse("2026-08-10")
    val day2 = start.plusDays(1)
    val end = start.plusDays(2)

    val went1 = UUID.randomUUID()
    val went2 = UUID.randomUUID()
    val went3 = UUID.randomUUID()
    val missed = UUID.randomUUID()
    val names = mapOf(went1 to "성산일출봉", went2 to "섭지코지", went3 to "협재해변", missed to "우도")

    fun visit(poi: UUID, skipped: Boolean = false, photos: Int = 0) =
        ArchiveVisitView(UUID.randomUUID(), poi, Instant.parse("2026-08-10T03:00:00Z"), null, skipped, photos, false)

    val days = listOf(
        ArchiveDayView(start, listOf(visit(went1, photos = 2), visit(went2))),
        ArchiveDayView(day2, listOf(visit(missed, skipped = true), visit(went3, photos = 1))),
    )

    fun ruleSummary(source: ReflectionSource = ReflectionSource.RULE) = TripSummary(
        tripId, "3일 동안 3곳을 다녀왔어요.", emptyList(), TripSummaryStats(3, 10.0, DistanceSource.VISIT_LINE, 3, true), source,
        Instant.parse("2026-08-13T00:00:00Z"),
    )

    /** 저장소 대역 — 시도 선점·스윕 조회도 실 어댑터(조건부 UPDATE·SELECT)와 같은 조건으로 흉내 낸다(실 쿼리는 IT 가 본다). */
    class Summaries(initial: TripSummary?, private val clock: Clock) : TripSummaryRepository {
        var stored: TripSummary? = initial
        var beforeLock: () -> Unit = {}
        var locks = 0
        var attempts = 0
        var attemptedAt: Instant? = null
        var claimFails = false
        override fun claimAiAttempt(tripId: UUID, reclaimAfter: Duration, maxAttempts: Int): Int? {
            if (claimFails) throw IllegalStateException("선점 쓰기가 실패했다")
            val s = stored ?: return null
            val now = clock.instant()
            if (s.source != ReflectionSource.RULE || attempts >= maxAttempts || attemptedAt?.isBefore(now.minus(reclaimAfter)) == false) return null
            attempts++
            attemptedAt = now
            return attempts
        }
        override fun retireAiAttempts(tripId: UUID, maxAttempts: Int) { attempts = maxOf(attempts, maxAttempts) }
        var pendingQueries = 0
        override fun findAiPending(window: Duration, reclaimAfter: Duration, maxAttempts: Int, limit: Int): List<UUID> {
            pendingQueries++
            val s = stored ?: return emptyList()
            val now = clock.instant()
            val due = s.source == ReflectionSource.RULE && s.generatedAt.isAfter(now.minus(window)) && attempts < maxAttempts &&
                attemptedAt?.isBefore(now.minus(reclaimAfter)) != false
            return if (due) listOf(s.tripId) else emptyList()
        }
        override fun upsert(summary: TripSummary) = summary.also { stored = it }
        override fun find(tripId: UUID) = stored
        override fun findForUpdate(tripId: UUID): TripSummary? {
            locks++
            beforeLock() // 잠금을 기다리는 사이 다른 쪽이 쓴 것을 흉내 낸다
            return stored
        }
    }

    class Agent(var reply: (ReflectionAgentInput) -> ReflectionCard?) : ReflectionAgentPort {
        override var enabled = true
        override val summaryCallTimeout: Duration = Duration.ofMinutes(10)
        val sent = mutableListOf<ReflectionAgentInput>()
        override fun generate(input: ReflectionAgentInput): ReflectionCard? = reply(input.also { sent += it })
    }

    fun card(subtitle: String, fallback: Boolean = false, scene: String = "바다") = ObjectMapper().writeValueAsString(
        mapOf(
            "template_id" to "summary.v1", "kind" to "TRIP_SUMMARY", "format" to "CARD", "is_fallback" to fallback,
            "cover" to mapOf("title" to "제주 3일", "subtitle" to subtitle), "scenes" to listOf(mapOf("caption" to scene)),
        ),
    ).let { ReflectionCard("summary.v1", "CARD", "제주 3일", subtitle, it) }

    /** 넘겨받은 일을 모아 두는 실행기 — [run] 으로 돌린다. 거절도 흉내 낸다. */
    class HeldExecutor : AbstractExecutorService() {
        val held = ArrayDeque<Runnable>()
        var reject = false
        var terminates = true
        fun run() { while (held.isNotEmpty()) held.removeFirst().run() }
        override fun execute(command: Runnable) { if (reject) throw RejectedExecutionException("full") else held += command }
        override fun shutdown() = Unit
        override fun shutdownNow(): MutableList<Runnable> = mutableListOf()
        override fun isShutdown() = false
        override fun isTerminated() = false
        override fun awaitTermination(timeout: Long, unit: TimeUnit) = terminates
    }

    /** 스윕의 "마지막 시도 뒤 상한이 지났나"를 재려고 움직이는 시계. */
    class MutableClock(var now: Instant) : Clock() {
        override fun getZone(): ZoneId = ZoneOffset.UTC
        override fun withZone(zone: ZoneId?) = this
        override fun instant() = now
    }

    class Fixture(
        val summaries: Summaries,
        val agent: Agent,
        val executor: HeldExecutor,
        val registry: SimpleMeterRegistry,
        val narrator: TripSummaryNarrator,
        val clock: MutableClock,
    )


    fun fixture(
        summary: TripSummary? = ruleSummary(),
        reply: (ReflectionAgentInput) -> ReflectionCard? = { card("바다와 오름을 따라 함께 걸었다.") },
        owned: OwnedTripPeriod? = OwnedTripPeriod(acc, start, end),
        trip: List<ArchiveDayView> = days,
        onLookup: () -> Unit = {},
        onArchive: () -> Unit = {},
    ): Fixture {
        val clock = MutableClock(Instant.parse("2026-08-13T01:00:00Z"))
        val summaries = Summaries(summary, clock)
        val agent = Agent(reply)
        val executor = HeldExecutor()
        val registry = SimpleMeterRegistry()
        val owners = object : TripOwnerFacade { override fun findOwnedPeriod(tripId: UUID) = owned }
        val trips = object : TripFacade {
            override fun findPeriod(accountId: UUID, tripId: UUID) = null
            override fun findGenerationContext(accountId: UUID, tripId: UUID) = TripGenerationContext(
                start, end, listOf(TripDestinationRef("제주", null, 2)), "연인", null, emptyList(), mapOf("styles" to listOf("미식")),
            )
        }
        val archive = object : ArchiveRecordFacade {
            override fun findDailyVisits(tripId: UUID) = trip.also { onArchive() }
            override fun findRouteDistances(tripId: UUID) = emptyMap<LocalDate, Int>()
        }
        val surfaces = object : PoiSurfaceFacade {
            override fun findSurfaces(poiIds: Collection<UUID>) = poiIds.mapNotNull { id ->
                names[id]?.let { id to PoiSurfaceView(id, it, 33.4, 126.5, "자연", "NATURE", null, null, emptyList()) }
            }.toMap()
            override fun findFrozenSurfaces(poiSnapshotIds: Collection<UUID>) = emptyMap<UUID, FrozenPoiView>()
        }
        val preferences = object : PreferenceFacade {
            override fun findPreferences(accountId: UUID) = PreferenceSnapshot(listOf("액티비티"), emptyList(), emptyList(), emptyList(), null, emptyList(), false, null)
        }
        val changeLog = object : ChangeLogFacade {
            override fun append(command: AppendChangeLog) = Unit
            override fun findTimeline(accountId: UUID, tripId: UUID, limit: Int) = emptyList<ChangeLogEntryView>().also { onLookup() } // 근거 조회의 마지막
        }
        val narrator = TripSummaryNarrator(
            owners, trips, archive, surfaces, summaries, agent, ReflectionCardCodec(ObjectMapper()),
            ReflectionMaterials(preferences, changeLog), ReflectionMetrics(registry), ObjectMapper(),
            TransactionOperations.withoutTransaction(), executor,
        )
        return Fixture(summaries, agent, executor, registry, narrator, clock)
    }

    "AI 가 회고를 주면 같은 요약의 문장을 그 부제로, 출처를 AI 로 바꾼다 — 실적·통계는 그대로다" {
        val f = fixture()
        f.narrator.request(tripId)
        f.agent.sent shouldBe emptyList() // 맡기기만 하고 돌아온다 — 부르는 쪽(릴레이)은 기다리지 않는다
        f.executor.run()

        f.summaries.stored shouldBe ruleSummary().copy(narrative = "바다와 오름을 따라 함께 걸었다.", source = ReflectionSource.AI)
        f.summaries.locks shouldBe 1
    }

    "여행 전체를 한 번에 묻는다 — 건너뛴 방문은 빼고, 그날 안에서 순서를 세고, 건너뜀은 이름 없이 사건으로 간다" {
        val f = fixture()
        f.narrator.request(tripId)
        f.executor.run()

        val input = f.agent.sent.single()
        input.kind shouldBe "TRIP_SUMMARY"
        input.region shouldBe "제주"
        (input.startDate to input.endDate) shouldBe (start to end)
        input.visits shouldBe listOf(
            ReflectionVisit(went1, start, "성산일출봉", "자연", 1, 2),
            ReflectionVisit(went2, start, "섭지코지", "자연", 2, 0),
            ReflectionVisit(went3, day2, "협재해변", "자연", 1, 1),
        )
        input.events shouldBe listOf(ReflectionEvent(ReflectionEvent.SKIPPED, day2, "계획한 곳 중 1곳을 들르지 못했다"))
        input.personaSummary shouldBe "여행 스타일 미식, 동행 연인" // 계정 "액티비티" 위에 그 여행의 "미식"
        input.weatherSummary shouldBe null
    }

    "상대가 자기 폴백으로 답하면 쓰지 않는다 — 규칙 요약이 남는다" {
        val f = fixture(reply = { card("바다를 걸었다.", fallback = true) })
        f.narrator.request(tripId)
        f.executor.run()
        f.summaries.stored shouldBe ruleSummary()
    }

    "부제가 비었거나 자리표시자가 남았으면 쓰지 않는다" {
        for (subtitle in listOf("", "   ", "{region} · {start_date}~{end_date}", "제주 {start_date} 여행")) {
            val f = fixture(reply = { card(subtitle) })
            f.narrator.request(tripId)
            f.executor.run()
            f.summaries.stored shouldBe ruleSummary()
            f.summaries.locks shouldBe 0 // 쓰러 가지도 않는다 — 빈 문장을 도메인 불변식 예외에 맡기면 "쓰기 실패" WARN 으로 둔갑한다
        }
    }

    "건너뛴 곳을 말하는 카드는 쓰지 않고 강등을 센다(BR-U5-31)" {
        val f = fixture(reply = { card("바다를 걸었다.", scene = "우도에서 자전거를 탔다") })
        f.narrator.request(tripId)
        f.executor.run()
        f.summaries.stored shouldBe ruleSummary()
        f.registry.counter(ReflectionMetrics.HALLUCINATION_REJECTED, "kind", "TRIP_SUMMARY").count() shouldBe 1.0
        f.registry.counter(ReflectionMetrics.HALLUCINATION_REJECTED, "kind", "DAILY").count() shouldBe 0.0 // 하루 회고 강등률을 오염시키지 않는다
    }

    "AI 가 못 만들거나 던지면 규칙 요약이 남는다" {
        for (reply in listOf<(ReflectionAgentInput) -> ReflectionCard?>({ null }, { error("AI 가 죽었다") })) {
            val f = fixture(reply = reply)
            f.narrator.request(tripId)
            f.executor.run()
            f.summaries.stored shouldBe ruleSummary()
        }
    }

    "이미 AI 문장이 붙었거나 규칙 요약이 아니면 부르지 않는다 — 재배달에 두 번 부르지 않는다" {
        for (summary in listOf(ruleSummary(ReflectionSource.AI), ruleSummary(ReflectionSource.BASIC), null)) {
            val f = fixture(summary = summary)
            f.narrator.request(tripId)
            f.executor.run()
            f.agent.sent shouldBe emptyList()
            f.summaries.stored shouldBe summary
        }
    }

    "기다리는 사이 다른 쪽이 먼저 붙였으면 덮지 않는다" {
        val f = fixture()
        val first = ruleSummary().copy(narrative = "먼저 붙은 문장", source = ReflectionSource.AI)
        f.summaries.beforeLock = { f.summaries.stored = first }
        f.narrator.request(tripId)
        f.executor.run()
        f.summaries.stored shouldBe first
    }

    "지워진 여행·목적지·실을 방문이 없는 여행은 부르지 않는다" {
        val deleted = fixture(owned = null)
        deleted.narrator.request(tripId)
        deleted.executor.run()
        deleted.agent.sent shouldBe emptyList()

        val allSkipped = fixture(trip = listOf(ArchiveDayView(start, listOf(visit(missed, skipped = true)))))
        allSkipped.narrator.request(tripId)
        allSkipped.executor.run()
        allSkipped.agent.sent shouldBe emptyList()
        allSkipped.summaries.stored shouldBe ruleSummary()
        // 더 할 것이 없다 — 스윕이 다시 집지 않게 시도를 채운다(방문 0곳·전부 건너뜀 요약을 쓸어 담지 않는다)
        (deleted.summaries.attempts to allSkipped.summaries.attempts) shouldBe (TripSummaryNarrator.MAX_ATTEMPTS to TripSummaryNarrator.MAX_ATTEMPTS)
        (deleted.summaries.attemptedAt to allSkipped.summaries.attemptedAt) shouldBe (null to null) // 선점 없이 채운다 — 부르러 간 적이 없다
        allSkipped.narrator.sweep()
        allSkipped.executor.held.size shouldBe 0
    }

    "경계가 꺼져 있으면 맡지도 않는다" {
        val f = fixture()
        f.agent.enabled = false
        f.narrator.request(tripId)
        f.executor.held.size shouldBe 0
    }

    "같은 여행이 대기·실행 중이면 다시 맡지 않는다 — 끝나면 다시 받는다" {
        val f = fixture(summary = ruleSummary(ReflectionSource.BASIC)) // 일 자체는 곧바로 접힌다 — 맡는 횟수만 본다
        f.narrator.request(tripId)
        f.narrator.request(tripId)
        f.executor.held.size shouldBe 1
        f.narrator.request(UUID.randomUUID())
        f.executor.held.size shouldBe 2 // 다른 여행은 막지 않는다
        f.executor.run()
        f.narrator.request(tripId)
        f.executor.held.size shouldBe 1
    }

    "실행기가 거절해도 던지지 않고(릴레이를 막지 않는다) 다음 요청은 받는다" {
        val f = fixture()
        f.executor.reject = true
        f.narrator.request(tripId)
        f.executor.reject = false
        f.narrator.request(tripId)
        f.executor.held.size shouldBe 1
    }

    "쓰기가 실패해도 실행기 밖으로 던지지 않고 다음 요청을 받는다" {
        val f = fixture()
        f.summaries.beforeLock = { error("DB 가 죽었다") }
        f.narrator.request(tripId)
        f.executor.run()
        f.summaries.stored shouldBe ruleSummary()
        f.narrator.request(tripId)
        f.executor.held.size shouldBe 1
    }

    // ── 사라진 회고를 다시 맡기기(스윕) ──────────────────────────────

    fun warns(block: () -> Unit): List<String> {
        val appender = ch.qos.logback.core.read.ListAppender<ch.qos.logback.classic.spi.ILoggingEvent>().apply { start() }
        val logger = org.slf4j.LoggerFactory.getLogger(TripSummaryNarrator::class.java) as ch.qos.logback.classic.Logger
        logger.addAppender(appender)
        try { block() } finally { logger.detachAppender(appender) }
        return appender.list.filter { it.level == ch.qos.logback.classic.Level.WARN }.map { it.formattedMessage }
    }

    "대기열이 넘쳐 버린 회고는 스윕이 다시 맡아 붙인다 — 넘침은 시도를 쓰지 않는다" {
        val f = fixture()
        f.executor.reject = true
        warns { f.narrator.request(tripId) }.single().let { ("스윕이 다음 회차에 다시 맡습니다" in it && tripId.toString() in it) shouldBe true }
        f.executor.reject = false
        f.summaries.attempts shouldBe 0

        f.narrator.sweep()
        f.executor.run()

        f.summaries.stored?.source shouldBe ReflectionSource.AI
        f.summaries.attempts shouldBe 1
    }

    "진행 중일 수 있는 시도는 호출 상한이 지나기 전엔 다시 맡지도 선점하지도 않는다 — 다른 파드의 호출을 중복하지 않는다" {
        val f = fixture(reply = { null })
        f.narrator.request(tripId)
        f.executor.run() // 1회 시도, 실패
        f.clock.now = f.clock.now.plus(Duration.ofMinutes(9))
        f.narrator.sweep()
        f.executor.held.size shouldBe 0
        f.narrator.request(tripId) // 재배달이 와도
        f.executor.run()
        f.agent.sent.size shouldBe 1

        f.clock.now = f.clock.now.plus(Duration.ofMinutes(1).plusSeconds(30)) // 호출 상한(10분)은 지났지만 여유(60초) 안이다
        f.narrator.sweep()
        f.executor.held.size shouldBe 0
        f.clock.now = f.clock.now.plus(Duration.ofSeconds(31)) // 상한 + 여유를 넘었다
        f.narrator.sweep()
        f.executor.run()
        f.agent.sent.size shouldBe 2
    }

    "시도 상한을 다 쓰면 더 맡지 않는다 — 마지막 시도를 선점하는 순간 WARN 을 한 번 남긴다(그 시도가 파드와 사라져도 기록된다)" {
        val f = fixture(reply = { null })
        val messages = warns {
            repeat(TripSummaryNarrator.MAX_ATTEMPTS + 2) {
                f.narrator.sweep()
                f.executor.run()
                f.clock.now = f.clock.now.plus(Duration.ofMinutes(12))
            }
        }
        f.agent.sent.size shouldBe TripSummaryNarrator.MAX_ATTEMPTS
        f.summaries.stored shouldBe ruleSummary()
        messages.filter { "마지막 시도" in it && tripId.toString() in it }.size shouldBe 1
    }

    "마지막 시도의 WARN 은 부르기 전에 남는다 — 그 호출이 파드와 함께 사라져도 기록돼 있다" {
        val appender = ch.qos.logback.core.read.ListAppender<ch.qos.logback.classic.spi.ILoggingEvent>().apply { start() }
        val logger = org.slf4j.LoggerFactory.getLogger(TripSummaryNarrator::class.java) as ch.qos.logback.classic.Logger
        var warnedBeforeCall: Boolean? = null
        val f = fixture(reply = {
            // 부르는 순간을 본다 — 이 뒤로는 아무것도 실행되지 않는다고 친다(파드가 사라졌다).
            warnedBeforeCall = appender.list.any { "마지막 시도(3/3)" in it.formattedMessage && tripId.toString() in it.formattedMessage }
            error("파드가 이 호출 도중 사라졌다")
        })
        f.summaries.attempts = TripSummaryNarrator.MAX_ATTEMPTS - 1
        logger.addAppender(appender)
        try {
            f.narrator.request(tripId)
            f.executor.run()
        } finally {
            logger.detachAppender(appender)
        }
        warnedBeforeCall shouldBe true
    }

    "선점은 조회가 다 끝난 뒤(마지막 조회 = 변경 이력), 부르기 바로 앞이다 — 다시 선점 여유가 덮을 것은 연결 시간뿐이다" {
        var attemptsAtLookup: Int? = null
        var attemptsAtCall: Int? = null
        lateinit var f: Fixture
        f = fixture(onLookup = { attemptsAtLookup = f.summaries.attempts }, reply = { attemptsAtCall = f.summaries.attempts; card("바다를 걸었다.") })
        f.narrator.request(tripId)
        f.executor.run()
        (attemptsAtLookup to attemptsAtCall) shouldBe (0 to 1)
    }

    "스윕에서 넘친 것은 한 줄로 모아 남기고 시도를 쓰지 않는다" {
        val f = fixture()
        f.executor.reject = true
        val messages = warns { f.narrator.sweep() }
        messages shouldBe listOf("요약 회고 실행기가 1건을 받지 않았습니다(대기열 포화·종료 중) — 다음 회차에 다시 맡습니다.")
        f.summaries.attempts shouldBe 0
    }

    "스윕은 창보다 오래된 요약·이미 AI 인 요약을 집지 않고, 경계가 꺼져 있으면 돌지 않는다" {
        val old = fixture()
        old.clock.now = ruleSummary().generatedAt.plus(TripSummaryNarrator.SWEEP_WINDOW).plusSeconds(1)
        old.narrator.sweep()
        old.executor.held.size shouldBe 0

        val ai = fixture(summary = ruleSummary(ReflectionSource.AI))
        ai.narrator.sweep()
        ai.executor.held.size shouldBe 0

        val off = fixture()
        off.agent.enabled = false
        off.narrator.sweep()
        off.executor.held.size shouldBe 0
        off.summaries.pendingQueries shouldBe 0 // 맡지도 않을 것을 찾으러 DB 에 가지 않는다
    }

    "종료 대기를 넘기면 대기·진행 중이던 여행을 남긴다 — 스윕이 다시 맡는다" {
        val f = fixture()
        val other = UUID.randomUUID()
        f.narrator.request(tripId)
        f.narrator.request(other)
        f.executor.terminates = false

        val messages = warns { f.narrator.shutdown() }

        messages.single().let { (tripId.toString() in it && other.toString() in it && "2건" in it) shouldBe true }
        warns { f.executor.terminates = true; f.narrator.shutdown() } shouldBe emptyList() // 제때 끝나면 조용하다
    }

    "선점 전 조회가 늘 던지는 여행도 시도로 세어 상한에서 멈춘다 — 매 스윕 되풀이하며 다른 여행을 굶기지 않는다" {
        var lookups = 0
        val f = fixture(onArchive = { lookups++; error("실적 조회가 늘 깨진다") })
        val messages = warns {
            repeat(TripSummaryNarrator.MAX_ATTEMPTS + 3) {
                f.narrator.sweep()
                f.executor.run()
                f.clock.now = f.clock.now.plus(Duration.ofMinutes(12))
            }
        }
        lookups shouldBe TripSummaryNarrator.MAX_ATTEMPTS
        f.agent.sent shouldBe emptyList()
        messages.count { "선점 전" in it && "시도 1/3" in it } shouldBe 1
        messages.count { "선점 전" in it && "상한(3)을 다 써" in it && tripId.toString() in it } shouldBe 1
    }

    "선점 전 실패도 진행 중인 다른 쪽 시도는 덮어 세지 않는다 — 다시 선점 기준을 지킨다" {
        val f = fixture(onArchive = { error("실적 조회가 깨졌다") })
        f.summaries.attempts = 1
        f.summaries.attemptedAt = f.clock.now.minus(Duration.ofMinutes(1)) // 다른 파드가 1분 전에 선점해 아직 기다리는 중
        f.narrator.request(tripId)
        f.executor.run()
        f.summaries.attempts shouldBe 1
    }

    "선점 뒤에 던지면 쓴 시도를 밝혀 남긴다" {
        val f = fixture()
        f.summaries.beforeLock = { error("쓰기 DB 가 죽었다") }
        warns {
            f.narrator.request(tripId)
            f.executor.run()
        }.single().let { ("선점 뒤" in it && "시도 1/3 로 세고 스윕이 다시 맡습니다" in it) shouldBe true }
    }

    "스윕은 맡긴 것과 이 파드에서 이미 대기·진행 중이라 건너뛴 것을 따로 센다" {
        val f = fixture()
        f.narrator.request(tripId) // 대기 중(아직 안 돌았다)
        val appender = ch.qos.logback.core.read.ListAppender<ch.qos.logback.classic.spi.ILoggingEvent>().apply { start() }
        val logger = org.slf4j.LoggerFactory.getLogger(TripSummaryNarrator::class.java) as ch.qos.logback.classic.Logger
        logger.addAppender(appender)
        try { f.narrator.sweep() } finally { logger.detachAppender(appender) }
        appender.list.single { "다시 맡깁니다" in it.formattedMessage }.formattedMessage.let {
            ("다시 맡깁니다 0건" in it && "건너뜀 1건" in it) shouldBe true
        }
    }

    fun events(block: () -> Unit): List<ch.qos.logback.classic.spi.ILoggingEvent> {
        val appender = ch.qos.logback.core.read.ListAppender<ch.qos.logback.classic.spi.ILoggingEvent>().apply { start() }
        val logger = org.slf4j.LoggerFactory.getLogger(TripSummaryNarrator::class.java) as ch.qos.logback.classic.Logger
        logger.addAppender(appender)
        try { block() } finally { logger.detachAppender(appender) }
        return appender.list.filter { it.level == ch.qos.logback.classic.Level.WARN }
    }

    "선점 전 실패를 세는 쓰기마저 실패하면 그렇게 밝히고 그 예외를 함께 붙인다 — 다음 스윕이 다시 집는다" {
        val f = fixture(onArchive = { error("실적 조회가 깨졌다") })
        f.summaries.claimFails = true
        val warn = events { f.narrator.request(tripId); f.executor.run() }.single()
        ("시도를 기록하지 못했습니다" in warn.formattedMessage && "다음 스윕이 다시 집습니다" in warn.formattedMessage) shouldBe true
        warn.throwableProxy.message shouldBe "실적 조회가 깨졌다"
        warn.throwableProxy.suppressed.map { it.message } shouldBe listOf("선점 쓰기가 실패했다")
        f.summaries.attempts shouldBe 0
    }

    "선점 전 실패인데 셀 수 없으면(이미 AI·다른 쪽 진행 중·상한) 다시 집힌다고 말하지 않는다" {
        val f = fixture(onArchive = { error("실적 조회가 깨졌다") })
        f.summaries.attempts = TripSummaryNarrator.MAX_ATTEMPTS
        val message = events { f.narrator.request(tripId); f.executor.run() }.single().formattedMessage
        ("시도로 세지 못했습니다" in message && "다시 집" !in message) shouldBe true
    }

    "선점 전에 종료 인터럽트로 끊기면 시도로 세지 않고 인터럽트 표시를 지우지 않는다" {
        for (how in listOf("flag", "cause")) {
            val f = fixture(onArchive = {
                if (how == "flag") Thread.currentThread().interrupt()
                throw IllegalStateException("조회가 끊겼다", if (how == "cause") InterruptedException() else null)
            })
            val messages = events { f.narrator.request(tripId); f.executor.run() }.map { it.formattedMessage }
            val stillInterrupted = Thread.interrupted() // 확인하며 지운다 — 다음 테스트로 새지 않게
            f.summaries.attempts shouldBe 0
            messages.single().let { ("종료로 끊겼습니다" in it && "스윕이 다시 맡습니다" in it) shouldBe true }
            stillInterrupted shouldBe (how == "flag")
        }
    }

    "Error 는 시도 실패로 삼키지 않고 올린다 — 실행 중 표시는 풀린다" {
        val f = fixture(onArchive = { throw AssertionError("메모리 부족 같은 것") })
        f.narrator.request(tripId)
        io.kotest.assertions.throwables.shouldThrow<AssertionError> { f.executor.run() }
        f.summaries.attempts shouldBe 0
        f.narrator.request(tripId)
        f.executor.held.size shouldBe 1

        val call = fixture(reply = { throw AssertionError("호출 중 Error") }) // 카드 경로도 같은 규칙
        call.narrator.request(tripId)
        io.kotest.assertions.throwables.shouldThrow<AssertionError> { call.executor.run() }
    }
})
