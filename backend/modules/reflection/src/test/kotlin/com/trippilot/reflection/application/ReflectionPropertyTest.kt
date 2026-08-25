package com.trippilot.reflection.application

import com.trippilot.archive.api.ArchiveDayView
import com.trippilot.archive.api.ArchiveRecordFacade
import com.trippilot.archive.api.ArchiveVisitView
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
import io.kotest.core.spec.style.StringSpec
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

    fun service(visits: List<ArchiveVisitView>, coords: Map<UUID, Pair<Double, Double>>, events: Sink = Sink()) =
        ReflectionService(trips, archiveOf(visits), surfacesOf(coords), Reflections(), events, clock)

    // ── PBT-U5-1 (블로킹) ──────────────────────────────────────────────
    "PBT-U5-1 입력이 무엇이든 회고가 비어 있지 않다" {
        checkAll(60, Arb.list(visitArb, 0..8)) { pairs ->
            val visits = pairs.map { it.first }
            val coords = pairs.mapNotNull { (v, c) -> c?.let { v.poiId to it } }.toMap()

            val r = service(visits, coords).generateDaily(acc, tripId, day)

            r.draftNarrative.shouldNotBeBlank()
            r.narrative.shouldNotBeBlank()
            // stats 는 비어 있을 수 없다(INV-U5-07) — 기본 카드가 이 값만으로 그려진다.
            (r.stats.visitCount >= 0) shouldBe true
            (r.stats.photoCount >= 0) shouldBe true
            (r.stats.distanceKm >= 0.0) shouldBe true
        }
    }

    "PBT-U5-1 방문 0곳이어도 기본 카드가 나온다 — 빈 화면을 그리지 않는다" {
        val r = service(emptyList(), emptyMap()).generateDaily(acc, tripId, day)

        r.source shouldBe ReflectionSource.BASIC
        r.draftNarrative shouldBe ReflectionNarrator.BASIC_DAILY
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
        val svc = ReflectionService(trips, archiveOf(visits), surfacesOf(mapOf(poi to (33.4 to 126.5))), repo, Sink(), clock)

        svc.generateDaily(acc, tripId, day)
        svc.generateDaily(acc, tripId, day)

        repo.stored.size shouldBe 1
    }

    "완료 시 ReflectionReady 를 발행한다 — 알림은 U6 몫이다(BR-U5-37)" {
        val events = Sink()
        service(emptyList(), emptyMap(), events).generateDaily(acc, tripId, day)

        val e = events.published.single()
        e.eventType shouldBe "reflection.ReflectionReady"
        e.aggregateType shouldBe "Reflection"
    }
})
