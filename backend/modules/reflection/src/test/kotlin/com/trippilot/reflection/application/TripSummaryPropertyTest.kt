package com.trippilot.reflection.application

import com.trippilot.archive.api.ArchiveDayView
import com.trippilot.archive.api.ArchiveRecordFacade
import com.trippilot.archive.api.ArchiveVisitView
import com.trippilot.core.event.DomainEvent
import com.trippilot.core.event.DomainEventPublisher
import com.trippilot.placedata.api.FrozenPoiView
import com.trippilot.placedata.api.PoiSurfaceFacade
import com.trippilot.placedata.api.PoiSurfaceView
import com.trippilot.reflection.api.event.ReflectionReady
import com.trippilot.reflection.domain.ReflectionSource
import com.trippilot.reflection.domain.TripSummary
import com.trippilot.reflection.domain.TripSummaryRepository
import com.trippilot.reflection.domain.TripSummaryStats
import com.trippilot.trip.api.TripFacade
import com.trippilot.trip.api.TripPeriod
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldBeEmpty
import io.kotest.matchers.doubles.shouldBeGreaterThan
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldNotBeBlank
import io.kotest.property.Arb
import io.kotest.property.PropTestConfig
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
 * 여행 요약의 **블로킹 게이트**(PBT-U5-1 · PBT-U5-5).
 *
 * 회고와 같은 성질을 요약에서 다시 묻는 이유는, 요약이 **날짜별 접기**라는 추가 단계를 거치기
 * 때문이다 — 날이 여럿이고 각 날의 방문 수가 다르고 좌표를 못 찾는 방문이 섞인다. 그 곱을
 * 예시로 덮으려 하면 반드시 성긴다. 그리고 실패 모습은 여기서도 **빈 화면**이라 조용하다.
 *
 * 요약에만 있는 성질도 함께 묻는다 — **날이 바뀌는 사이는 이동이 아니다**(그 사이는 숙박이다).
 * 이걸 놓치면 제주 3일 여행이 서울-부산을 왕복한 것처럼 보인다.
 */
class TripSummaryPropertyTest : StringSpec({

    val acc = UUID.randomUUID()
    val tripId = UUID.randomUUID()
    val clock: Clock = Clock.fixed(Instant.parse("2026-08-14T12:00:00Z"), ZoneOffset.UTC)
    val day0 = LocalDate.parse("2026-08-11")

    val trips = object : TripFacade {
        override fun findPeriod(accountId: UUID, tripId: UUID) =
            if (accountId == acc) TripPeriod(day0, day0.plusDays(3)) else null
        override fun findGenerationContext(accountId: UUID, tripId: UUID) = null
    }

    class Summaries : TripSummaryRepository {
        val stored = mutableMapOf<UUID, TripSummary>()
        override fun upsert(summary: TripSummary) = summary.also { stored[it.tripId] = it }
        override fun find(tripId: UUID) = stored[tripId]
    }

    class Sink : DomainEventPublisher {
        val published = mutableListOf<DomainEvent>()
        override fun publish(event: DomainEvent) { published += event }
    }

    fun archiveOf(days: List<ArchiveDayView>) = object : ArchiveRecordFacade {
        override fun findDailyVisits(tripId: UUID) = days
    }

    /** 좌표를 아는 POI 만 표면을 낸다 — 못 찾는 방문이 섞이는 것이 실제 상황이다. */
    fun surfacesOf(known: Map<UUID, Pair<Double, Double>>) = object : PoiSurfaceFacade {
        override fun findSurfaces(poiIds: Collection<UUID>) = poiIds.mapNotNull { id ->
            known[id]?.let {
                id to PoiSurfaceView(id, "장소-${id.toString().take(4)}", it.first, it.second, "카페", null, null, emptyList())
            }
        }.toMap()
        override fun findFrozenSurfaces(poiSnapshotIds: Collection<UUID>) = emptyMap<UUID, FrozenPoiView>()
    }

    fun serviceOf(days: List<ArchiveDayView>, known: Map<UUID, Pair<Double, Double>>, sink: Sink, repo: Summaries) =
        TripSummaryService(trips, archiveOf(days), surfacesOf(known), repo, sink, clock)

    fun visit(poi: UUID, skipped: Boolean = false, photos: Int = 0) = ArchiveVisitView(
        visitCheckId = UUID.randomUUID(), poiId = poi,
        arrivedAt = Instant.parse("2026-08-11T03:00:00Z"), completedAt = Instant.parse("2026-08-11T04:00:00Z"),
        skipped = skipped, photoCount = photos, hasMemo = false,
    )

    /** 하루치 — 방문 수·건너뜀·사진·좌표 유무를 전부 흔든다. */
    val dayArb: Arb<Pair<ArchiveDayView, Map<UUID, Pair<Double, Double>>>> = arbitrary {
        val offset = Arb.int(0..3).bind()
        val visits = Arb.list(Arb.boolean(), 0..4).bind()
        val known = mutableMapOf<UUID, Pair<Double, Double>>()
        val views = visits.mapIndexed { i, skipped ->
            val poi = UUID.randomUUID()
            if (Arb.boolean().bind()) known[poi] = 33.4 + i * 0.01 to 126.5 + i * 0.01
            visit(poi, skipped = skipped, photos = Arb.int(0..3).bind())
        }
        ArchiveDayView(day0.plusDays(offset.toLong()), views) to known
    }

    "PBT-U5-1 입력이 무엇이든 요약이 비어 있지 않다" {
        checkAll(PropTestConfig(iterations = 60), Arb.list(dayArb, 0..4)) { generated ->
            val days = generated.map { it.first }
            val known = generated.map { it.second }.fold(emptyMap<UUID, Pair<Double, Double>>()) { a, b -> a + b }
            val repo = Summaries()

            val s = serviceOf(days, known, Sink(), repo).generate(tripId)

            // 도메인 `require` 가 아니라 여기서도 묻는다 — 생성 경로가 그 불변식에 걸리지 않고 지나야 한다.
            s.narrative.shouldNotBeBlank()
            s.highlights.size shouldBe days.size
            s.stats.totalVisits shouldBe days.sumOf { d -> d.visits.count { !it.skipped } }
            s.stats.totalDistanceKm shouldBeGreaterThan -0.0000001
            repo.stored[tripId] shouldBe s
        }
    }

    "방문 0곳 여행도 요약이 나온다 — 빈 화면을 그리지 않는다" {
        val repo = Summaries()

        val s = serviceOf(emptyList(), emptyMap(), Sink(), repo).generate(tripId)

        s.narrative shouldBe TripSummaryService.BASIC_SUMMARY
        s.source shouldBe ReflectionSource.BASIC
        s.stats.totalVisits shouldBe 0
        s.stats.hasLocationData shouldBe false
        s.highlights.shouldBeEmpty()
    }

    "좌표를 하나도 못 찾으면 hasLocationData 가 false — 화면이 지도 대신 목록으로 간다(BR-U5-39)" {
        val poi = UUID.randomUUID()
        val days = listOf(ArchiveDayView(day0, listOf(visit(poi))))

        val s = serviceOf(days, emptyMap(), Sink(), Summaries()).generate(tripId)

        s.stats.hasLocationData shouldBe false
        s.stats.totalDistanceKm shouldBe 0.0
        // 근거가 없는 이름은 지어내지 않는다(BR-U5-31).
        s.highlights.single().places.shouldBeEmpty()
        s.narrative.shouldNotBeBlank()
    }

    "날이 바뀌는 사이는 이동이 아니다 — 하루 안에서만 잰다(BR-U5-43)" {
        val seoul = UUID.randomUUID()
        val busan = UUID.randomUUID()
        val known = mapOf(seoul to (37.5665 to 126.9780), busan to (35.1796 to 129.0756))
        val split = listOf(
            ArchiveDayView(day0, listOf(visit(seoul))),
            ArchiveDayView(day0.plusDays(1), listOf(visit(busan))),
        )
        val sameDay = listOf(ArchiveDayView(day0, listOf(visit(seoul), visit(busan))))

        val across = serviceOf(split, known, Sink(), Summaries()).generate(tripId)
        val within = serviceOf(sameDay, known, Sink(), Summaries()).generate(tripId)

        // 날이 갈리면 그 사이는 숙박이다 — 서울·부산이 이틀에 걸쳐 있어도 이동 0.
        across.stats.totalDistanceKm shouldBe 0.0
        within.stats.totalDistanceKm shouldBeGreaterThan 300.0
    }

    "요약 완료를 알린다 — 알림은 U6 몫이다(BR-U5-37)" {
        val sink = Sink()

        serviceOf(emptyList(), emptyMap(), sink, Summaries()).generate(tripId)

        val e = sink.published.single() as ReflectionReady
        e.tripId shouldBe tripId.toString()
        e.kind shouldBe TripSummaryService.KIND_SUMMARY
        e.dayDate shouldBe null // 요약은 하루가 아니라 여행 전체다
        e.source shouldBe ReflectionSource.BASIC.name
    }

    "같은 이벤트가 두 번 배달돼도 결과가 같다 — 여행당 하나(at-least-once)" {
        val poi = UUID.randomUUID()
        val days = listOf(ArchiveDayView(day0, listOf(visit(poi, photos = 2))))
        val repo = Summaries()
        val sink = Sink()
        val svc = serviceOf(days, mapOf(poi to (33.4 to 126.5)), sink, repo)

        val first = svc.generate(tripId)
        val second = svc.generate(tripId)

        second shouldBe first
        repo.stored.size shouldBe 1
        sink.published.size shouldBe 2 // 발행은 두 번 — 구독자 멱등이 담당한다(TRIP-539)
    }

    "PBT-U5-5 요약 수치에 소요시간 필드가 없다(INV-3)" {
        val forbidden = listOf("duration", "minutes", "eta", "travelTime", "dwell")

        val fields = TripSummaryStats::class.java.declaredFields.map { it.name }

        fields.filter { f -> forbidden.any { f.contains(it, ignoreCase = true) } }.shouldBeEmpty()
    }
})
