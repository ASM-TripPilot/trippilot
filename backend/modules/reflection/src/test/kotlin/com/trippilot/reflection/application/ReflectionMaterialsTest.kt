package com.trippilot.reflection.application

import com.trippilot.archive.api.ArchiveDayView
import com.trippilot.archive.api.ArchiveRecordFacade
import com.trippilot.archive.api.ArchiveVisitView
import com.trippilot.changelog.api.AppendChangeLog
import com.trippilot.changelog.api.ChangeLogEntryView
import com.trippilot.changelog.api.ChangeLogFacade
import com.trippilot.changelog.api.ChangeSourceType
import com.trippilot.changelog.api.DaySnapshotView
import com.trippilot.changelog.api.ItinerarySnapshotView
import com.trippilot.changelog.api.SlotSnapshotView
import com.trippilot.core.event.DomainEvent
import com.trippilot.core.event.DomainEventPublisher
import com.trippilot.placedata.api.FrozenPoiView
import com.trippilot.placedata.api.PoiSurfaceFacade
import com.trippilot.placedata.api.PoiSurfaceView
import com.trippilot.profile.api.PreferenceFacade
import com.trippilot.profile.api.PreferenceSnapshot
import com.trippilot.reflection.domain.Reflection
import com.trippilot.reflection.domain.ReflectionCard
import com.trippilot.reflection.domain.ReflectionRepository
import com.trippilot.reflection.domain.ReflectionSource
import com.trippilot.reflection.domain.port.ReflectionAgentInput
import com.trippilot.reflection.domain.port.ReflectionAgentPort
import com.trippilot.reflection.domain.port.ReflectionEvent
import com.trippilot.trip.api.TripDestinationRef
import com.trippilot.trip.api.TripFacade
import com.trippilot.trip.api.TripGenerationContext
import com.trippilot.trip.api.TripPeriod
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneOffset
import java.util.UUID

/**
 * 회고 AI 요청의 재료(TRIP-1463) — 그날 지역 · 그 여행의 취향 · 그날 있었던 일이 **실제로 요청에 실리는가**.
 *
 * 재료가 비면 화면에는 아무 오류가 없다 — 회고가 "장소명 + 형용사구" 나열로 나올 뿐이다. 그래서 어댑터가 받는 입력을 직접 본다.
 */
class ReflectionMaterialsTest : StringSpec({

    val acc = UUID.randomUUID()
    val tripId = UUID.randomUUID()
    val start = LocalDate.parse("2026-08-10")
    val day2 = start.plusDays(1)
    val clock: Clock = Clock.fixed(Instant.parse("2026-08-11T12:00:00Z"), ZoneOffset.UTC)

    fun prefs(styles: List<String> = emptyList(), activities: List<String> = emptyList(), pace: String? = null, companions: List<String> = emptyList()) =
        PreferenceSnapshot(styles, activities, emptyList(), emptyList(), pace, companions, false, null)

    fun preferencesOf(snapshot: PreferenceSnapshot) = object : PreferenceFacade {
        override fun findPreferences(accountId: UUID) = snapshot
    }

    fun changeLogOf(entries: List<ChangeLogEntryView>) = object : ChangeLogFacade {
        override fun append(command: AppendChangeLog) = Unit
        override fun findTimeline(accountId: UUID, tripId: UUID, limit: Int) = entries
    }

    fun snapshot(vararg days: Pair<LocalDate, UUID>) = ItinerarySnapshotView(
        days.map { (date, poi) -> DaySnapshotView(date, listOf(SlotSnapshotView(poi, LocalTime.NOON, LocalTime.of(13, 0), false, false))) },
    )

    fun entry(source: ChangeSourceType, reason: String?, at: String, before: ItinerarySnapshotView, after: ItinerarySnapshotView) =
        ChangeLogEntryView("actor", source, reason, Instant.parse(at), before, after)

    /** 서울 1박 → 부산 2박. 둘째 날은 부산이다(FE `regionForDay` 와 같은 규칙). */
    fun context(snapshot: Map<String, Any?> = emptyMap(), companion: String? = null) = TripGenerationContext(
        startDate = start, endDate = start.plusDays(3),
        destinationRefs = listOf(TripDestinationRef("서울", null, 1), TripDestinationRef("부산", null, 2)),
        companionType = companion, budgetTotal = null, fixedVisits = emptyList(), preferenceSnapshot = snapshot,
    )

    // ── 재료 단위 ────────────────────────────────────────────────

    "그날 지역은 박수로 펼친 그날의 목적지다 — 첫 목적지가 아니다" {
        val m = ReflectionMaterials(preferencesOf(prefs()), changeLogOf(emptyList()))
        m.regionOn(context(), start) shouldBe "서울"
        m.regionOn(context(), day2) shouldBe "부산"
        m.regionOn(context(), start.plusDays(3)) shouldBe "부산" // 박수 합을 넘는 체크아웃일은 마지막 목적지
        m.regionOn(null, day2) shouldBe ""
    }

    /** #995 · BR-U1-38 이 고친 결함이 회고로 되살아나지 않는다 — 계정엔 "액티비티", 이 여행에선 "미식"을 골랐다. */
    "성향은 그 여행에서 고른 축이 계정 값보다 우선한다 — 안 실린 축만 계정 값이다" {
        val m = ReflectionMaterials(preferencesOf(prefs(styles = listOf("액티비티"), pace = "알차게")), changeLogOf(emptyList()))

        m.personaOf(acc, context(snapshot = mapOf("styles" to listOf("미식")))) shouldBe "여행 스타일 미식, 일정 알차게"
        // 여행에서 축을 비웠으면 계정 값으로 되살리지 않는다.
        m.personaOf(acc, context(snapshot = mapOf("styles" to emptyList<String>()))) shouldBe "일정 알차게"
    }

    "동행은 여행에 적힌 것이 계정의 평소 동행보다 우선한다" {
        val m = ReflectionMaterials(preferencesOf(prefs(companions = listOf("가족"))), changeLogOf(emptyList()))
        m.personaOf(acc, context(companion = "연인")) shouldBe "동행 연인"
        m.personaOf(acc, context()) shouldBe "동행 가족"
    }

    "고른 축이 하나도 없으면 빈 문자열이다 — 상대가 '(요약 없음)'으로 받는다" {
        ReflectionMaterials(preferencesOf(prefs()), changeLogOf(emptyList())).personaOf(acc, context()) shouldBe ""
    }

    "취향을 못 읽어도 회고를 막지 않는다 — 성향만 비운다" {
        val broken = object : PreferenceFacade {
            override fun findPreferences(accountId: UUID): PreferenceSnapshot = error("profile 이 죽었다")
        }
        ReflectionMaterials(broken, changeLogOf(emptyList())).personaOf(acc, context()) shouldBe ""
    }

    "성향 한 줄은 상한에서 자르되 대리 쌍을 반으로 가르지 않는다" {
        // 접두 "여행 스타일 " 은 7자다. 7 + 192 = 199자 뒤의 이모지는 200·201번째 칸 — 200자째가 앞 반쪽이다 → 그 반쪽을 버려 199자.
        val edge = ReflectionMaterials.personaLine(prefs(styles = listOf("가".repeat(192) + "😀")), null)
        edge shouldBe "여행 스타일 " + "가".repeat(192)
        // 이모지가 상한 안에 온전히 들어가면 그대로 둔다(7 + 191 + 2 = 200자).
        val whole = ReflectionMaterials.personaLine(prefs(styles = listOf("가".repeat(191) + "😀" + "나")), null)
        whole shouldBe "여행 스타일 " + "가".repeat(191) + "😀"
    }

    "그날 사건 — 건너뛴 곳은 이름 없이 한 건, 재계획은 그날 칸이 바뀐 PLAN_B 만 시간순으로" {
        val a = UUID.randomUUID()
        val b = UUID.randomUUID()
        val entries = listOf( // 최신순(소유 모듈 계약)
            entry(ChangeSourceType.PLAN_B, "직접 · 실내로", "2026-08-11T06:00:00Z", snapshot(day2 to a), snapshot(day2 to b)),
            entry(ChangeSourceType.MANUAL, "손으로", "2026-08-11T05:00:00Z", snapshot(day2 to b), snapshot(day2 to a)),
            entry(ChangeSourceType.PLAN_B, "다른 날", "2026-08-11T04:00:00Z", snapshot(start to a), snapshot(start to b)),
            entry(ChangeSourceType.PLAN_B, "자동 감지 · 비 예보", "2026-08-11T03:00:00Z", snapshot(day2 to b), snapshot(day2 to a)),
            entry(ChangeSourceType.PLAN_B, "   ", "2026-08-11T02:00:00Z", snapshot(day2 to a), snapshot(day2 to b)),
        )
        val m = ReflectionMaterials(preferencesOf(prefs()), changeLogOf(entries))

        m.eventsOn(acc, tripId, day2, skippedCount = 2) shouldBe listOf(
            ReflectionEvent(ReflectionEvent.SKIPPED, day2, "계획한 곳 중 2곳을 들르지 못했다"),
            ReflectionEvent(ReflectionEvent.PLAN_B, day2, "계획을 바꿨다"),
            ReflectionEvent(ReflectionEvent.PLAN_B, day2, "자동 감지 · 비 예보"),
            ReflectionEvent(ReflectionEvent.PLAN_B, day2, "직접 · 실내로"),
        )
        m.eventsOn(acc, tripId, start.plusDays(3), skippedCount = 0) shouldBe emptyList()
    }

    "변경 이력을 못 읽어도 건너뜀 사건은 남는다" {
        val broken = object : ChangeLogFacade {
            override fun append(command: AppendChangeLog) = Unit
            override fun findTimeline(accountId: UUID, tripId: UUID, limit: Int): List<ChangeLogEntryView> = error("change-log 가 죽었다")
        }
        ReflectionMaterials(preferencesOf(prefs()), broken).eventsOn(acc, tripId, day2, skippedCount = 1) shouldBe
            listOf(ReflectionEvent(ReflectionEvent.SKIPPED, day2, "계획한 곳 중 1곳을 들르지 못했다"))
    }

    // ── 하루 회고가 재료를 실제로 싣는가 ─────────────────────────────

    "하루 회고의 AI 요청에 그날 지역·여행 취향·사건이 실리고, 건너뛴 곳의 이름은 어디에도 없다" {
        val went = UUID.randomUUID()
        val skippedPoi = UUID.randomUUID()
        val trips = object : TripFacade {
            override fun findPeriod(accountId: UUID, tripId: UUID) = TripPeriod(start, start.plusDays(3))
            override fun findGenerationContext(accountId: UUID, tripId: UUID) = context(snapshot = mapOf("styles" to listOf("미식")))
        }
        val visits = listOf(
            ArchiveVisitView(UUID.randomUUID(), went, Instant.parse("2026-08-11T03:00:00Z"), null, false, 1, false),
            ArchiveVisitView(UUID.randomUUID(), skippedPoi, Instant.parse("2026-08-11T04:00:00Z"), null, true, 0, false),
        )
        val archive = object : ArchiveRecordFacade {
            override fun findDailyVisits(tripId: UUID) = listOf(ArchiveDayView(day2, visits))
            override fun findRouteDistances(tripId: UUID) = emptyMap<LocalDate, Int>()
        }
        val names = mapOf(went to "해운대", skippedPoi to "광안리")
        val surfaces = object : PoiSurfaceFacade {
            override fun findSurfaces(poiIds: Collection<UUID>) = poiIds.associateWith {
                PoiSurfaceView(it, names.getValue(it), 35.1, 129.1, "자연", "NATURE", null, null, emptyList())
            }
            override fun findFrozenSurfaces(poiSnapshotIds: Collection<UUID>) = emptyMap<UUID, FrozenPoiView>()
        }
        var sent: ReflectionAgentInput? = null
        val agent = object : ReflectionAgentPort {
            override val enabled = true
            override fun generate(input: ReflectionAgentInput): ReflectionCard? = null.also { sent = input }
        }
        val repo = object : ReflectionRepository {
            val stored = mutableMapOf<LocalDate, Reflection>()
            override fun upsert(reflection: Reflection) = reflection.also { stored[it.dayDate] = it }
            override fun find(tripId: UUID, dayDate: LocalDate) = stored[dayDate]
            override fun exists(tripId: UUID, dayDate: LocalDate) = dayDate in stored
            override fun findForUpdate(tripId: UUID, dayDate: LocalDate) = stored[dayDate]
            override fun findForRedraft(tripId: UUID, dayDate: LocalDate, draft: ReflectionCard, source: ReflectionSource) = stored[dayDate]
            override fun findByTrip(tripId: UUID) = stored.values.toList()
        }
        val replan = entry(ChangeSourceType.PLAN_B, "자동 감지 · 비 예보", "2026-08-11T03:00:00Z", snapshot(day2 to skippedPoi), snapshot(day2 to went))
        val service = ReflectionService(
            trips, archive, surfaces, repo, ReflectionCardCodec(com.fasterxml.jackson.databind.ObjectMapper()), agent,
            object : DomainEventPublisher { override fun publish(event: DomainEvent) = Unit },
            ReflectionMetrics(io.micrometer.core.instrument.simple.SimpleMeterRegistry()), clock,
            ReflectionMaterials(preferencesOf(prefs(styles = listOf("액티비티"))), changeLogOf(listOf(replan))),
        )

        service.generateDaily(acc, tripId, day2)

        val input = sent!!
        input.region shouldBe "부산"
        input.personaSummary shouldBe "여행 스타일 미식"
        input.weatherSummary shouldBe null
        input.events shouldBe listOf(
            ReflectionEvent(ReflectionEvent.SKIPPED, day2, "계획한 곳 중 1곳을 들르지 못했다"),
            ReflectionEvent(ReflectionEvent.PLAN_B, day2, "자동 감지 · 비 예보"),
        )
        input.visits.map { it.poiName } shouldBe listOf("해운대")
        input.toString().contains("광안리") shouldBe false
    }
})
