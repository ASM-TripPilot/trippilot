package com.trippilot.reflection.application

import com.trippilot.archive.api.ArchiveDayView
import com.trippilot.archive.api.ArchiveRecordFacade
import com.trippilot.archive.api.ArchiveVisitView
import com.trippilot.changelog.api.AppendChangeLog
import com.trippilot.changelog.api.ChangeLogFacade
import com.trippilot.core.error.ConflictDetected
import com.trippilot.core.error.ResourceNotFound
import com.trippilot.placedata.api.FrozenPoiView
import com.trippilot.placedata.api.PoiSurfaceFacade
import com.trippilot.placedata.api.PoiSurfaceView
import com.trippilot.profile.api.PreferenceFacade
import com.trippilot.profile.api.PreferenceSnapshot
import com.trippilot.reflection.domain.TripSummary
import com.trippilot.reflection.domain.TripSummaryRepository
import com.trippilot.reflection.domain.port.ReflectionAgentInput
import com.trippilot.reflection.domain.port.ShareCardCopy
import com.trippilot.reflection.domain.port.ShareCardCopyPort
import com.trippilot.trip.api.TripDestinationRef
import com.trippilot.trip.api.TripFacade
import com.trippilot.trip.api.TripGenerationContext
import com.trippilot.trip.api.TripPeriod
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldBeEmpty
import io.kotest.matchers.shouldBe
import java.time.Instant
import java.time.LocalDate
import java.util.UUID

/**
 * 공유 카드 문구(TRIP-1411) — **늘 답이 있다**(INV-4)와 **안 간 곳을 말하지 않는다**(BR-U5-31)를 갈래마다 본다.
 *
 * 규칙 문구로 내려가도 화면에는 오류가 없다 — 그래서 "왜 AI 문구가 아니었나"를 갈래마다 고정한다.
 */
class ShareCardCopyServiceTest : StringSpec({

    val acc = UUID.randomUUID()
    val tripId = UUID.randomUUID()
    val start = LocalDate.parse("2026-08-10")
    val day2 = start.plusDays(1)

    val went1 = UUID.randomUUID()
    val went2 = UUID.randomUUID()
    val skippedPoi = UUID.randomUUID()
    val names = mapOf(went1 to "해운대", went2 to "감천문화마을", skippedPoi to "광안리")

    fun visit(poi: UUID, skipped: Boolean = false) = ArchiveVisitView(UUID.randomUUID(), poi, Instant.parse("2026-08-10T03:00:00Z"), null, skipped, 1, false)

    val twoDays = listOf(
        ArchiveDayView(start, listOf(visit(went1), visit(skippedPoi, skipped = true))),
        ArchiveDayView(day2, listOf(visit(went2))),
    )

    fun context(destinations: List<String> = listOf("부산", "경주")) = TripGenerationContext(
        startDate = start, endDate = start.plusDays(2),
        destinationRefs = destinations.map { TripDestinationRef(it, null, 1) },
        companionType = "연인", budgetTotal = null, fixedVisits = emptyList(), preferenceSnapshot = emptyMap(),
    )

    class CountingArchive(private val days: List<ArchiveDayView>) : ArchiveRecordFacade {
        var reads = 0
        override fun findDailyVisits(tripId: UUID) = days.also { reads++ }
        override fun findRouteDistances(tripId: UUID) = emptyMap<LocalDate, Int>()
    }

    class Copier(private val answer: ShareCardCopy?, override val enabled: Boolean = true) : ShareCardCopyPort {
        var sent: ReflectionAgentInput? = null
        override fun copy(input: ReflectionAgentInput) = answer.also { sent = input }
    }

    class ChangeLogNeverRead : ChangeLogFacade {
        var reads = 0
        override fun append(command: AppendChangeLog) = Unit
        override fun findTimeline(accountId: UUID, tripId: UUID, limit: Int) = emptyList<com.trippilot.changelog.api.ChangeLogEntryView>().also { reads++ }
    }

    fun service(
        copier: ShareCardCopyPort,
        archive: ArchiveRecordFacade = CountingArchive(twoDays),
        ctx: TripGenerationContext? = context(),
        summaryExists: Boolean = true,
        changeLogs: ChangeLogFacade = ChangeLogNeverRead(),
    ): ShareCardCopyService {
        val trips = object : TripFacade {
            override fun findPeriod(accountId: UUID, tripId: UUID) = TripPeriod(start, start.plusDays(2))
            override fun findGenerationContext(accountId: UUID, tripId: UUID) = ctx.takeIf { accountId == acc }
        }
        val surfaces = object : PoiSurfaceFacade {
            override fun findSurfaces(poiIds: Collection<UUID>) = poiIds.associateWith {
                PoiSurfaceView(it, names.getValue(it), 35.1, 129.1, "자연", "NATURE", null, null, emptyList())
            }
            override fun findFrozenSurfaces(poiSnapshotIds: Collection<UUID>) = emptyMap<UUID, FrozenPoiView>()
        }
        val summaries = object : TripSummaryRepository {
            override fun upsert(summary: TripSummary) = summary
            override fun find(tripId: UUID): TripSummary? = null
            override fun findForUpdate(tripId: UUID): TripSummary? = null
            override fun exists(tripId: UUID) = summaryExists
        }
        val preferences = object : PreferenceFacade {
            override fun findPreferences(accountId: UUID) =
                PreferenceSnapshot(listOf("사진"), emptyList(), emptyList(), emptyList(), null, emptyList(), false, null)
        }
        return ShareCardCopyService(trips, archive, surfaces, summaries, ReflectionMaterials(preferences, changeLogs), copier)
    }

    val aiCopy = ShareCardCopy("바다와 골목을 담은 사흘", listOf("#부산여행", "#해운대"), isFallback = false)
    val rule = ShareCardCopyService.ruleCopy(listOf("부산", "경주"))

    "AI 문구가 오면 그대로 준다 — 재료는 여행 전체의 간 곳·첫 목적지·그 여행의 취향이다" {
        val copier = Copier(aiCopy)
        val changeLogs = ChangeLogNeverRead()

        service(copier, changeLogs = changeLogs).copy(acc, tripId) shouldBe aiCopy

        val sent = copier.sent!!
        sent.kind shouldBe "TRIP_SUMMARY"
        sent.region shouldBe "부산"
        sent.startDate shouldBe start
        sent.endDate shouldBe start.plusDays(2)
        // 건너뛴 곳은 싣지 않는다. 순서는 그날 안의 순서다(둘째 날은 다시 1).
        sent.visits.map { it.poiName to it.orderInDay } shouldBe listOf("해운대" to 1, "감천문화마을" to 1)
        sent.visits.map { it.date } shouldBe listOf(start, day2)
        sent.personaSummary shouldBe "여행 스타일 사진, 동행 연인"
        sent.weatherSummary shouldBe null
        sent.events.shouldBeEmpty()
        changeLogs.reads shouldBe 0 // 사건을 싣지 않으므로 변경 이력을 읽지 않는다
    }

    "AI 를 못 받으면 규칙 문구 — 비어 있지 않고 isFallback 이다" {
        val copy = service(Copier(null)).copy(acc, tripId)

        copy shouldBe rule
        copy.caption shouldBe "부산·경주 여행의 기록"
        copy.hashtags shouldBe listOf("#부산여행", "#경주여행")
        copy.isFallback shouldBe true
    }

    "상대가 자기 폴백으로 답하면 우리 규칙 문구를 쓴다 — 목적지마다 태그가 있다" {
        service(Copier(ShareCardCopy("부산 여행의 기록", listOf("#부산여행"), isFallback = true))).copy(acc, tripId) shouldBe rule
    }

    "빈 캡션은 내리지 않는다" {
        service(Copier(ShareCardCopy("  ", listOf("#부산여행"), isFallback = false))).copy(acc, tripId) shouldBe rule
    }

    "건너뛴 장소를 말하면 규칙 문구로 간다 — 해시태그에 섞여도 잡는다(BR-U5-31)" {
        service(Copier(ShareCardCopy("바다를 담은 사흘", listOf("#부산여행", "#광안리"), isFallback = false))).copy(acc, tripId) shouldBe rule
        service(Copier(ShareCardCopy("광안리 야경까지 담은 사흘", emptyList(), isFallback = false))).copy(acc, tripId) shouldBe rule
    }

    "꺼져 있으면 방문을 읽지 않고 규칙 문구" {
        val archive = CountingArchive(twoDays)
        val copier = Copier(aiCopy, enabled = false)

        service(copier, archive = archive).copy(acc, tripId) shouldBe rule

        archive.reads shouldBe 0
        copier.sent shouldBe null
    }

    "간 곳이 없거나 목적지가 없으면 AI 를 부르지 않는다" {
        val noVisits = Copier(aiCopy)
        service(noVisits, archive = CountingArchive(listOf(ArchiveDayView(start, listOf(visit(skippedPoi, skipped = true)))))).copy(acc, tripId) shouldBe rule
        noVisits.sent shouldBe null

        val noDestination = Copier(aiCopy)
        service(noDestination, ctx = context(destinations = emptyList())).copy(acc, tripId) shouldBe ShareCardCopyService.ruleCopy(emptyList())
        noDestination.sent shouldBe null
    }

    "남의 여행이면 404, 요약 전이면 409(BR-U5-48) — 둘 다 AI 를 부르지 않는다" {
        val copier = Copier(aiCopy)
        shouldThrow<ResourceNotFound> { service(copier).copy(UUID.randomUUID(), tripId) }
        shouldThrow<ConflictDetected> { service(copier, summaryExists = false).copy(acc, tripId) }
        copier.sent shouldBe null
    }

    "규칙 문구 — 태그는 공백을 지우고, 목적지가 없어도 캡션은 비지 않는다" {
        ShareCardCopyService.ruleCopy(listOf("제주 서귀포", "부산")) shouldBe
            ShareCardCopy("제주 서귀포·부산 여행의 기록", listOf("#제주서귀포여행", "#부산여행"), isFallback = true)
        ShareCardCopyService.ruleCopy(emptyList()) shouldBe ShareCardCopy("여행의 기록", emptyList(), isFallback = true)
    }
})
