package com.trippilot.reflection.application

import com.trippilot.archive.api.ArchiveDayView
import com.trippilot.archive.api.ArchiveRecordFacade
import com.trippilot.archive.api.ArchiveVisitView
import com.trippilot.core.error.ValidationFailed
import com.trippilot.core.event.DomainEvent
import com.trippilot.core.event.DomainEventPublisher
import com.trippilot.placedata.api.FrozenPoiView
import com.trippilot.placedata.api.PoiSurfaceFacade
import com.trippilot.placedata.api.PoiSurfaceView
import com.trippilot.reflection.adapter.`in`.web.ReflectionResponse
import com.trippilot.reflection.domain.Reflection
import com.trippilot.reflection.domain.ReflectionRepository
import com.trippilot.reflection.domain.ReflectionSource
import com.trippilot.trip.api.TripFacade
import com.trippilot.trip.api.TripPeriod
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldBeEmpty
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldNotBeBlank
import io.kotest.property.Arb
import io.kotest.property.arbitrary.arbitrary
import io.kotest.property.arbitrary.boolean
import io.kotest.property.arbitrary.int
import io.kotest.property.arbitrary.list
import io.kotest.property.checkAll
import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import java.util.UUID

/**
 * 회고 생성의 **블로킹 게이트**(PBT-U5-1 · PBT-U5-5).
 *
 * PBT-U5-1 이 이 유닛에서 가장 중요한 성질이다 — **입력이 무엇이든 결과가 비어 있지 않다.**
 * 예시 몇 개로는 부족하다: 방문·사진·메모·건너뜀·좌표 유무가 곱해져 손으로 고른 케이스가 늘 성긴다.
 * 그리고 실패 모습이 "빈 화면"이라 조용하다 — 예외도 로그도 없다.
 */
class ReflectionPropertyTest : StringSpec({

    val acc = UUID.randomUUID()
    val tripId = UUID.randomUUID()
    val day = LocalDate.parse("2026-08-11")
    val clock: Clock = Clock.fixed(Instant.parse("2026-08-11T12:00:00Z"), ZoneOffset.UTC)

    val trips = object : TripFacade {
        override fun findPeriod(accountId: UUID, tripId: UUID) =
            if (accountId == acc) TripPeriod(day, day.plusDays(2)) else null
        override fun findGenerationContext(accountId: UUID, tripId: UUID) = null
    }

    class Reflections : ReflectionRepository {
        val stored = mutableMapOf<Pair<UUID, LocalDate>, Reflection>()
        override fun upsert(reflection: Reflection) = reflection.also { stored[it.tripId to it.dayDate] = it }
        override fun find(tripId: UUID, dayDate: LocalDate) = stored[tripId to dayDate]
        override fun findByTrip(tripId: UUID) = stored.values.filter { it.tripId == tripId }.sortedBy { it.dayDate }
    }

    class Sink : DomainEventPublisher {
        val published = mutableListOf<DomainEvent>()
        override fun publish(event: DomainEvent) { published += event }
    }

    fun archiveOf(visits: List<ArchiveVisitView>) = object : ArchiveRecordFacade {
        override fun findDailyVisits(tripId: UUID) =
            if (visits.isEmpty()) emptyList() else listOf(ArchiveDayView(day, visits))
    }

    /** 좌표를 아는 POI 만 표면을 낸다 — 못 찾는 방문이 섞이는 것이 실제 상황이다. */
    fun surfacesOf(known: Map<UUID, Pair<Double, Double>>) = object : PoiSurfaceFacade {
        override fun findSurfaces(poiIds: Collection<UUID>) = poiIds.mapNotNull { id ->
            known[id]?.let { id to PoiSurfaceView(id, "장소-${id.toString().take(4)}", it.first, it.second, "카페", null, null, emptyList()) }
        }.toMap()
        override fun findFrozenSurfaces(poiSnapshotIds: Collection<UUID>) = emptyMap<UUID, FrozenPoiView>()
    }

    /** 방문 한 건 — 건너뜀·사진·메모·좌표 유무를 전부 흔든다. */
    val visitArb: Arb<Pair<ArchiveVisitView, Pair<Double, Double>?>> = arbitrary {
        val poi = UUID.randomUUID()
        val hasCoord = Arb.boolean().bind()
        ArchiveVisitView(
            visitCheckId = UUID.randomUUID(),
            poiId = poi,
            arrivedAt = Instant.parse("2026-08-11T03:00:00Z"),
            completedAt = if (Arb.boolean().bind()) Instant.parse("2026-08-11T04:00:00Z") else null,
            skipped = Arb.boolean().bind(),
            photoCount = Arb.int(0, 5).bind(),
            hasMemo = Arb.boolean().bind(),
        ) to if (hasCoord) (33.0 + Arb.int(0, 100).bind() / 100.0) to (126.0 + Arb.int(0, 100).bind() / 100.0) else null
    }

    /**
     * AI 경계 대역 — **미배선을 값으로 말한다**(null → 규칙 카드). 기본 경로가 이것이라,
     * 이 스펙의 단정들은 폴백 아래 두 단(RULE·BASIC)을 잰다.
     */
    /** payload 가 JSON 이 아닌 카드를 주는 상대. 도메인 검사는 통과한다(제목·원문이 비지 않았다). */
    class BrokenAgent : com.trippilot.reflection.domain.port.ReflectionAgentPort {
        override val enabled = true
        override fun generate(input: com.trippilot.reflection.domain.port.ReflectionAgentInput) =
            com.trippilot.reflection.domain.ReflectionCard(
                "ai.daily.v1", "CARD", "제목", "부제", "이건 JSON 이 아니다",
            )
    }

    /** 계약을 어기고 예외를 던지는 상대. 폴백이 그것까지 받아야 한다. */
    class ThrowingAgent : com.trippilot.reflection.domain.port.ReflectionAgentPort {
        override val enabled = true
        override fun generate(input: com.trippilot.reflection.domain.port.ReflectionAgentInput): Nothing =
            error("상대가 죽었다")
    }

    /** AI 가 카드를 만들어 준 경우. */
    class CardAgent(private val title: String) : com.trippilot.reflection.domain.port.ReflectionAgentPort {
        override val enabled = true
        override fun generate(input: com.trippilot.reflection.domain.port.ReflectionAgentInput) =
            com.trippilot.reflection.domain.ReflectionCard(
                "ai.daily.v1", "CARD", title, "부제",
                """{"template_id":"ai.daily.v1","cover":{"title":"$title"}}""",
            )
    }

    class NoAgent : com.trippilot.reflection.domain.port.ReflectionAgentPort {
        var calls = 0
        override val enabled = false
        override fun generate(input: com.trippilot.reflection.domain.port.ReflectionAgentInput) =
            null.also { calls++ }
    }

    /** 사용자가 보내는 카드 원문 — 편집 단위는 카드 통째다(BR-U5-35). */
    fun userCard(title: String) =
        """{"template_id":"user.edit.v1","format":"CARD","cover":{"title":"$title","subtitle":""},"scenes":[]}"""

    fun service(visits: List<ArchiveVisitView>, coords: Map<UUID, Pair<Double, Double>>, events: Sink = Sink()) =
        ReflectionService(
            trips, archiveOf(visits), surfacesOf(coords), Reflections(),
            ReflectionCardCodec(com.fasterxml.jackson.databind.ObjectMapper()), NoAgent(), events, clock,
        )

    // ── 폴백 3단(BR-U5-32) ────────────────────────────────────────────
    "AI 카드가 나오면 그것을 쓰고 source 는 AI 다" {
        val svc = ReflectionService(
            trips, archiveOf(emptyList()), surfacesOf(emptyMap()), Reflections(),
            ReflectionCardCodec(com.fasterxml.jackson.databind.ObjectMapper()), CardAgent("AI 가 쓴 제목"), Sink(), clock,
        )

        val r = svc.generateDaily(acc, tripId, day)

        r.source shouldBe ReflectionSource.AI
        r.draftCard.title shouldBe "AI 가 쓴 제목"
        r.draftCard.templateId shouldBe "ai.daily.v1"
    }

    /**
     * **AI 가 못 만들면 규칙 카드로 내려간다** — 예외가 아니라 값(null)으로 온다. 이 갈래가 없으면
     * AI 가 죽는 날 회고가 통째로 사라진다(INV-4 · BR-U5-32).
     */
    "AI 가 null 을 주면 규칙 카드로 내려가고 source 는 AI 가 아니다" {
        val svc = ReflectionService(
            trips, archiveOf(emptyList()), surfacesOf(emptyMap()), Reflections(),
            ReflectionCardCodec(com.fasterxml.jackson.databind.ObjectMapper()), NoAgent(), Sink(), clock,
        )

        val r = svc.generateDaily(acc, tripId, day)

        r.source shouldBe ReflectionSource.BASIC
        r.draftCard.templateId shouldBe ReflectionNarrator.BASIC_TEMPLATE
    }

    /**
     * 꺼져 있으면 **호출조차 하지 않는다**.
     *
     * 단순한 최적화가 아니다 — 입력 조립이 여행 컨텍스트 조회를 부르는데, 기본 모드(`rule`)에서는
     * 그 조회가 **항상 null 을 줄 호출을 위해** 돈다. 회고 생성과 편집 경로가 같이 값을 치른다.
     * 이 단정이 없으면 다음 사람이 `enabled` 검사를 지워도 아무 신호가 없다.
     */
    "경계가 꺼져 있으면 generate 를 부르지 않는다" {
        val agent = NoAgent()
        val svc = ReflectionService(
            trips, archiveOf(emptyList()), surfacesOf(emptyMap()), Reflections(),
            ReflectionCardCodec(com.fasterxml.jackson.databind.ObjectMapper()), agent, Sink(), clock,
        )

        svc.generateDaily(acc, tripId, day)

        agent.calls shouldBe 0
    }

    /**
     * **AI 가 깨진 카드를 줘도 회고는 나온다.**
     *
     * 포트가 준 카드는 제목·원문이 비었는지만 검사받았고 `payload` 가 유효 JSON 인지는 아무도 안 본다.
     * 그대로 두면 저장 시점에 500 으로 터지고, **그때는 규칙 카드로 내려갈 기회조차 없다** — 폴백
     * (BR-U5-32)이 통째로 무력화된다.
     */
    "AI 가 깨진 payload 를 주면 규칙 카드로 내려간다 — 요청을 죽이지 않는다" {
        val svc = ReflectionService(
            trips, archiveOf(emptyList()), surfacesOf(emptyMap()), Reflections(),
            ReflectionCardCodec(com.fasterxml.jackson.databind.ObjectMapper()), BrokenAgent(), Sink(), clock,
        )

        val r = svc.generateDaily(acc, tripId, day)

        r.source shouldBe ReflectionSource.BASIC
        r.draftCard.templateId shouldBe ReflectionNarrator.BASIC_TEMPLATE
    }

    "AI 가 예외를 던져도 규칙 카드로 내려간다" {
        val svc = ReflectionService(
            trips, archiveOf(emptyList()), surfacesOf(emptyMap()), Reflections(),
            ReflectionCardCodec(com.fasterxml.jackson.databind.ObjectMapper()), ThrowingAgent(), Sink(), clock,
        )

        svc.generateDaily(acc, tripId, day).source shouldBe ReflectionSource.BASIC
    }

    // ── PBT-U5-1 (블로킹) ──────────────────────────────────────────────
    "PBT-U5-1 입력이 무엇이든 회고가 비어 있지 않다" {
        checkAll(60, Arb.list(visitArb, 0..8)) { pairs ->
            val visits = pairs.map { it.first }
            val coords = pairs.mapNotNull { (v, c) -> c?.let { v.poiId to it } }.toMap()

            val r = service(visits, coords).generateDaily(acc, tripId, day)

            // PBT-U5-F1 — 표시본 카드가 비어 있지 않다. **장면 개수는 조건이 아니다**:
            // 방문 0곳이면 근거가 없어 장면을 만들 수 없고, 요구하면 지어내야 한다(BR-U5-31).
            r.draftCard.title.shouldNotBeBlank()
            r.card.title.shouldNotBeBlank()
            r.draftCard.payload.shouldNotBeBlank()
            // stats 는 비어 있을 수 없다(INV-U5-07) — 기본 카드가 이 값만으로 그려진다.
            (r.stats.visitCount >= 0) shouldBe true
            (r.stats.photoCount >= 0) shouldBe true
            (r.stats.distanceKm >= 0.0) shouldBe true
        }
    }

    "PBT-U5-1 방문 0곳이어도 기본 카드가 나온다 — 빈 화면을 그리지 않는다" {
        val r = service(emptyList(), emptyMap()).generateDaily(acc, tripId, day)

        r.source shouldBe ReflectionSource.BASIC
        r.draftCard.templateId shouldBe ReflectionNarrator.BASIC_TEMPLATE
        r.draftCard.subtitle shouldBe ReflectionNarrator.BASIC_DAILY
        r.stats.visitCount shouldBe 0
        r.stats.photoCount shouldBe 0
    }

    "근거가 있으면 RULE, 없으면 BASIC — source 가 항상 실린다(BR-U5-33)" {
        checkAll(40, Arb.list(visitArb, 0..6)) { pairs ->
            val visits = pairs.map { it.first }
            val coords = pairs.mapNotNull { (v, c) -> c?.let { v.poiId to it } }.toMap()

            val r = service(visits, coords).generateDaily(acc, tripId, day)

            val expected = if (visits.count { !it.skipped } > 0) ReflectionSource.RULE else ReflectionSource.BASIC
            r.source shouldBe expected
        }
    }

    // ── PBT-U5-5 ──────────────────────────────────────────────────────
    // INV-3 — 소요시간은 어디에도 없다. 필드 이름으로 잰다: 값이 0/null 인 것과 "칸이 없는 것"은 다르다.
    "PBT-U5-5 응답에 이동 소요시간 필드가 없다 — 거리만" {
        val names = ReflectionResponse::class.java.declaredFields.map { it.name } +
            com.trippilot.reflection.adapter.`in`.web.ReflectionStatsResponse::class.java.declaredFields.map { it.name }

        names.none { it.contains("duration", true) || it.contains("eta", true) || it.contains("travelTime", true) } shouldBe true
        // 거리는 있어야 한다 — 없으면 이 성질이 "아무 필드도 없다"로 공허해진다.
        names.any { it == "distanceKm" } shouldBe true
    }

    "PBT-U5-5 개별 방문의 체류도 응답에 없다(BR-U5-08)" {
        val names = com.trippilot.reflection.adapter.`in`.web.ReflectionStatsResponse::class.java.declaredFields.map { it.name }
        names.none { it.contains("dwell", true) } shouldBe true
    }

    // ── 재생성 · 이벤트 ────────────────────────────────────────────────
    "다시 만들어도 하루 한 장이다 — 덮어쓴다(BR-U5-35)" {
        val poi = UUID.randomUUID()
        val visits = listOf(
            ArchiveVisitView(UUID.randomUUID(), poi, Instant.parse("2026-08-11T03:00:00Z"), null, false, 1, false),
        )
        val repo = Reflections()
        val svc = ReflectionService(trips, archiveOf(visits), surfacesOf(mapOf(poi to (33.4 to 126.5))), repo, ReflectionCardCodec(com.fasterxml.jackson.databind.ObjectMapper()), NoAgent(), Sink(), clock)

        svc.generateDaily(acc, tripId, day)
        svc.generateDaily(acc, tripId, day)

        repo.stored.size shouldBe 1
    }

    // ── 초안·수정본 2열(INV-U5-06 · TRIP-553) ─────────────────────────
    "재생성이 사용자 수정본을 지우지 않는다 — 초안만 갈아끼운다" {
        val repo = Reflections()
        val svc = ReflectionService(trips, archiveOf(emptyList()), surfacesOf(emptyMap()), repo, ReflectionCardCodec(com.fasterxml.jackson.databind.ObjectMapper()), NoAgent(), Sink(), clock)
        svc.generateDaily(acc, tripId, day)
        val edited = svc.edit(acc, tripId, day, userCard("내가 쓴 제목"))

        val again = svc.generateDaily(acc, tripId, day)

        // 초안은 다시 만들 수 있지만 사용자가 고친 카드는 어디에도 없다 — 그래서 이쪽이 더 나쁜 손실이다.
        again.editedCard?.title shouldBe "내가 쓴 제목"
        again.card.title shouldBe "내가 쓴 제목"
        again.generatedAt shouldBe edited.generatedAt
        repo.stored.size shouldBe 1
    }

    "수정해도 초안은 남는다 — 2열 비교의 왼쪽(INV-U5-06)" {
        val svc = ReflectionService(
            trips, archiveOf(emptyList()), surfacesOf(emptyMap()), Reflections(), ReflectionCardCodec(com.fasterxml.jackson.databind.ObjectMapper()), NoAgent(), Sink(), clock,
        )
        val draft = svc.generateDaily(acc, tripId, day).draftCard.title

        val edited = svc.edit(acc, tripId, day, userCard("고친 제목"))

        edited.draftCard.title shouldBe draft
        edited.editedCard?.title shouldBe "고친 제목"
    }

    "회고가 없어도 바로 쓸 수 있다 — 기본 카드 위에 얹는다(BR-U5-36)" {
        val repo = Reflections()
        val events = Sink()
        val svc = ReflectionService(trips, archiveOf(emptyList()), surfacesOf(emptyMap()), repo, ReflectionCardCodec(com.fasterxml.jackson.databind.ObjectMapper()), NoAgent(), events, clock)

        val written = svc.edit(acc, tripId, day, userCard("생성은 실패했지만 내가 쓴다"))

        written.card.title shouldBe "생성은 실패했지만 내가 쓴다"
        written.draftCard.title.shouldNotBeBlank() // 근거 수치만으로 된 기본 카드 — 지어낸 문장이 아니다
        repo.stored.size shouldBe 1
        // 사용자가 글을 쓰는 순간에 "회고가 준비됐어요" 알림이 본인에게 가면 안 된다.
        events.published.shouldBeEmpty()
    }

    "여행 기간 밖 날짜는 거부한다 — 근거 데이터가 없는 날이다" {
        val svc = ReflectionService(
            trips, archiveOf(emptyList()), surfacesOf(emptyMap()), Reflections(), ReflectionCardCodec(com.fasterxml.jackson.databind.ObjectMapper()), NoAgent(), Sink(), clock,
        )

        shouldThrow<ValidationFailed> { svc.generateDaily(acc, tripId, day.minusDays(1)) }
        shouldThrow<ValidationFailed> { svc.edit(acc, tripId, day.plusDays(3), "여행 밖 회고") }
    }

    "완료 시 ReflectionReady 를 발행한다 — 알림은 U6 몫이다(BR-U5-37)" {
        val events = Sink()
        service(emptyList(), emptyMap(), events).generateDaily(acc, tripId, day)

        val e = events.published.single()
        e.eventType shouldBe "reflection.ReflectionReady"
        e.aggregateType shouldBe "Reflection"
    }
})
