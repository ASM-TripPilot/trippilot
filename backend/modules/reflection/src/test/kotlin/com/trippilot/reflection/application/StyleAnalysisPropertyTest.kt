package com.trippilot.reflection.application

import com.trippilot.archive.api.ArchiveDayView
import com.trippilot.archive.api.ArchiveRecordFacade
import com.trippilot.archive.api.ArchiveVisitView
import com.trippilot.placedata.api.FrozenPoiView
import com.trippilot.placedata.api.PoiSurfaceFacade
import com.trippilot.placedata.api.PoiSurfaceView
import com.trippilot.profile.api.PreferenceFacade
import com.trippilot.profile.api.PreferenceSnapshot
import com.trippilot.reflection.adapter.`in`.web.CategoryShareResponse
import com.trippilot.reflection.adapter.`in`.web.StyleAnalysisBody
import com.trippilot.reflection.adapter.`in`.web.TraitGaugesResponse
import com.trippilot.reflection.domain.CategoryShare
import com.trippilot.reflection.domain.StyleAnalysis
import com.trippilot.reflection.domain.StyleAnalysisRepository
import com.trippilot.reflection.domain.StyleOutcome
import com.trippilot.reflection.domain.TraitGauges
import com.trippilot.trip.api.TripListFacade
import com.trippilot.trip.api.TripSummaryView
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldContainExactly
import io.kotest.matchers.doubles.plusOrMinus
import io.kotest.matchers.ints.shouldBeLessThanOrEqual
import io.kotest.matchers.maps.shouldBeEmpty
import io.kotest.matchers.shouldBe
import io.kotest.matchers.types.shouldBeInstanceOf
import io.kotest.property.Arb
import io.kotest.property.PropTestConfig
import io.kotest.property.arbitrary.int
import io.kotest.property.arbitrary.list
import io.kotest.property.arbitrary.of
import io.kotest.property.checkAll
import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import java.util.UUID

/**
 * 스타일 분석의 **블로킹 게이트**(PBT-U5-4 · PBT-U5-5).
 *
 * PBT-U5-4(임계 경계)를 성질로 쓰는 이유는, 실패가 **조용하기** 때문이다. 9곳에서 정식 분석이
 * 저장되면 화면은 아무 오류 없이 "당신은 미식가입니다"를 그린다 — 근거가 부족하다는 사실이
 * 어디에도 나타나지 않는다. 예시 두 개(9·10)로는 "저장 경로가 하나뿐인가"를 못 본다.
 */
class StyleAnalysisPropertyTest : StringSpec({

    val acc = UUID.randomUUID()
    val tripId = UUID.randomUUID()
    val clock: Clock = Clock.fixed(Instant.parse("2026-08-14T12:00:00Z"), ZoneOffset.UTC)
    val day0 = LocalDate.parse("2026-08-11")

    class Analyses : StyleAnalysisRepository {
        val stored = mutableMapOf<UUID, StyleAnalysis>()
        override fun upsert(analysis: StyleAnalysis) = analysis.also { stored[it.accountId] = it }
        override fun find(accountId: UUID) = stored[accountId]
    }

    val trips = object : TripListFacade {
        override fun findTripsOf(accountId: UUID, limit: Int) = listOf(
            TripSummaryView(tripId, "제주", day0, day0.plusDays(2), listOf("제주")),
        )
        override fun hasAnyTrip(accountId: UUID) = true
    }

    fun archiveOf(days: List<ArchiveDayView>) = object : ArchiveRecordFacade {
        override fun findDailyVisits(tripId: UUID) = days
    }

    fun surfacesOf(known: Map<UUID, Pair<String, Pair<Double, Double>>>) = object : PoiSurfaceFacade {
        override fun findSurfaces(poiIds: Collection<UUID>) = poiIds.mapNotNull { id ->
            known[id]?.let { (cat, ll) ->
                id to PoiSurfaceView(id, "장소-${id.toString().take(4)}", ll.first, ll.second, cat, null, null, emptyList())
            }
        }.toMap()
        override fun findFrozenSurfaces(poiSnapshotIds: Collection<UUID>) = emptyMap<UUID, FrozenPoiView>()
    }

    fun preferencesOf(styles: List<String>, foods: List<String>) = object : PreferenceFacade {
        override fun findPreferences(accountId: UUID) =
            PreferenceSnapshot(styles, emptyList(), foods, emptyList(), null, emptyList(), false, null)
    }

    fun visit(poi: UUID, dwellMinutes: Long? = 60) = ArchiveVisitView(
        visitCheckId = UUID.randomUUID(), poiId = poi,
        arrivedAt = Instant.parse("2026-08-11T03:00:00Z"),
        completedAt = dwellMinutes?.let { Instant.parse("2026-08-11T03:00:00Z").plusSeconds(it * 60) },
        skipped = false, photoCount = 0, hasMemo = false,
    )

    /** 방문 n건을 카테고리·좌표와 함께 만든다. 하루에 몰아넣지 않고 3일에 나눈다(반경·밀도가 살아야 한다). */
    fun sampleOf(n: Int, categories: List<String>): Pair<List<ArchiveDayView>, Map<UUID, Pair<String, Pair<Double, Double>>>> {
        val known = mutableMapOf<UUID, Pair<String, Pair<Double, Double>>>()
        val visits = (0 until n).map { i ->
            val poi = UUID.randomUUID()
            known[poi] = categories[i % categories.size] to (33.4 + i * 0.01 to 126.5 + i * 0.01)
            visit(poi)
        }
        val days = visits.chunked(maxOf(1, (n + 2) / 3)).mapIndexed { d, vs -> ArchiveDayView(day0.plusDays(d.toLong()), vs) }
        return days to known
    }

    fun serviceOf(
        days: List<ArchiveDayView>,
        known: Map<UUID, Pair<String, Pair<Double, Double>>>,
        repo: Analyses,
        prefs: PreferenceFacade = preferencesOf(listOf("바다"), listOf("해산물")),
    ) = StyleAnalysisService(trips, archiveOf(days), surfacesOf(known), prefs, repo, clock)

    "PBT-U5-4 임계 경계 — 저장되는 것과 정식인 것이 정확히 같은 집합이다" {
        checkAll(PropTestConfig(iterations = 40), Arb.int(0..20)) { n ->
            val (days, known) = sampleOf(n, listOf("맛집", "카페", "자연", "명소", "쇼핑"))
            val repo = Analyses()

            val outcome = serviceOf(days, known, repo).analyze(acc)

            val official = outcome is StyleOutcome.Official
            official shouldBe (n >= StyleAnalysis.MIN_VISITS)
            // 저장 여부가 정식 여부와 같아야 한다 — 미리보기가 저장되면 이후 둘을 가를 근거가 없다(BR-U5-41).
            repo.stored.containsKey(acc) shouldBe official
        }
    }

    "9곳은 미리보기, 10곳은 정식 — 경계에서 승격되지 않는다" {
        val nine = Analyses()
        val ten = Analyses()

        val (d9, k9) = sampleOf(9, listOf("카페"))
        val (d10, k10) = sampleOf(10, listOf("카페"))
        val a = serviceOf(d9, k9, nine).analyze(acc)
        val b = serviceOf(d10, k10, ten).analyze(acc)

        a.shouldBeInstanceOf<StyleOutcome.Preview>().preview.let {
            it.current shouldBe 9
            it.required shouldBe 10
            // 미리보기는 온보딩 취향에서 온다 — 실적이 아니다.
            it.descriptors shouldContainExactly listOf("#바다", "#해산물")
        }
        nine.stored.shouldBeEmpty()
        b.shouldBeInstanceOf<StyleOutcome.Official>().analysis.sampleVisitCount shouldBe 10
        ten.stored.size shouldBe 1
    }

    "건너뛴 방문은 근거가 아니다 — 세지 않아 임계도 넘지 않는다" {
        val known = mutableMapOf<UUID, Pair<String, Pair<Double, Double>>>()
        val visits = (0 until 12).map { i ->
            val poi = UUID.randomUUID()
            known[poi] = "카페" to (33.4 + i * 0.01 to 126.5)
            visit(poi).copy(skipped = i >= 5) // 5곳만 실제로 갔다
        }
        val repo = Analyses()

        val outcome = serviceOf(listOf(ArchiveDayView(day0, visits)), known, repo).analyze(acc)

        outcome.shouldBeInstanceOf<StyleOutcome.Preview>().preview.current shouldBe 5
        repo.stored.shouldBeEmpty()
    }

    "카테고리 막대는 4줄을 넘지 않고 비율 합이 1이다(O-U5-7)" {
        checkAll(PropTestConfig(iterations = 40), Arb.list(Arb.of("맛집", "카페", "자연", "명소", "쇼핑", "문화", "야경", "액티비티"), 10..30)) { cats ->
            val (days, known) = sampleOf(cats.size, cats)
            val repo = Analyses()

            val a = serviceOf(days, known, repo).analyze(acc).shouldBeInstanceOf<StyleOutcome.Official>().analysis

            a.categoryBreakdown.size shouldBeLessThanOrEqual (CategoryShare.TOP_N + 1)
            a.categoryBreakdown.sumOf { it.ratio } shouldBe (1.0 plusOrMinus 1e-9)
            // 묶음 줄은 하나뿐이고 맨 뒤다 — 화면이 마지막 막대를 `기타` 로 그린다.
            a.categoryBreakdown.count { it.isOther } shouldBeLessThanOrEqual 1
            a.categoryBreakdown.dropLast(1).none { it.isOther } shouldBe true
        }
    }

    "같은 데이터면 같은 순서 — 동률은 코드 오름차순으로 깬다" {
        val (days, known) = sampleOf(12, listOf("카페", "맛집", "자연", "명소")) // 각 3건씩 동률
        val repo = Analyses()

        val first = serviceOf(days, known, repo).analyze(acc).shouldBeInstanceOf<StyleOutcome.Official>().analysis
        val second = serviceOf(days, known, Analyses()).analyze(acc).shouldBeInstanceOf<StyleOutcome.Official>().analysis

        first.categoryBreakdown shouldBe second.categoryBreakdown
        // 전부 동률이라 코드 오름차순이 순서를 정한다. 결정론이 없으면 같은 데이터에 화면이 매번 다르게 그려진다.
        first.categoryBreakdown.filter { !it.isOther }.map { it.category } shouldContainExactly listOf("맛집", "명소", "자연")
    }

    "게이지는 입력이 무엇이든 0~5 를 벗어나지 않는다" {
        checkAll(PropTestConfig(iterations = 40), Arb.int(10..40), Arb.int(1..8)) { n, catCount ->
            val cats = listOf("맛집", "카페", "자연", "명소", "쇼핑", "문화", "야경", "액티비티").take(catCount)
            val (days, known) = sampleOf(n, cats)

            val g = serviceOf(days, known, Analyses()).analyze(acc)
                .shouldBeInstanceOf<StyleOutcome.Official>().analysis.traitGauges

            listOf(g.easygoing, g.foodAffinity, g.activeness).forEach { it shouldBeLessThanOrEqual TraitGauges.MAX }
            listOf(g.easygoing, g.foodAffinity, g.activeness).forEach { (it >= 0) shouldBe true }
        }
    }

    "체류를 잴 수 없으면 null 이다 — 0 으로 채우지 않는다" {
        val known = mutableMapOf<UUID, Pair<String, Pair<Double, Double>>>()
        val visits = (0 until 10).map { i ->
            val poi = UUID.randomUUID()
            known[poi] = "카페" to (33.4 + i * 0.01 to 126.5)
            visit(poi, dwellMinutes = null) // 완료 시각이 없다(도착만 찍혔다)
        }

        val a = serviceOf(listOf(ArchiveDayView(day0, visits)), known, Analyses()).analyze(acc)
            .shouldBeInstanceOf<StyleOutcome.Official>().analysis

        // "0분 머물렀다"는 거짓말이다. 모른다는 것을 모른다고 낸다.
        a.avgDwellMinutes shouldBe null
    }

    "PBT-U5-5 소요시간 필드는 avgDwellMinutes 하나뿐이다(BR-U5-08a)" {
        val forbidden = listOf("duration", "minutes", "eta", "travelTime", "dwell")
        val fields = listOf(StyleAnalysisBody::class, TraitGaugesResponse::class, CategoryShareResponse::class)
            .flatMap { it.java.declaredFields.map { f -> f.name } }

        val hits = fields.filter { f -> forbidden.any { f.contains(it, ignoreCase = true) } }

        // 성질을 "duration 문자열 전면 금지"로 쓰면 그린 화면을 못 만든다(정본 PBT-U5-5 주석).
        hits shouldContainExactly listOf("avgDwellMinutes")
    }
})
