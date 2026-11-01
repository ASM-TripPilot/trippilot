package com.trippilot.reflection.application

import com.trippilot.archive.api.ArchiveDayView
import com.trippilot.archive.api.ArchiveRecordFacade
import com.trippilot.archive.api.ArchiveVisitView
import com.trippilot.changelog.api.AppendChangeLog
import com.trippilot.changelog.api.ChangeLogFacade
import com.trippilot.core.error.ConflictDetected
import com.trippilot.core.error.ErrorCode
import com.trippilot.core.error.RateLimited
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
import com.trippilot.reflection.domain.port.ShareCardUsageRepository
import com.trippilot.trip.api.TripDestinationRef
import com.trippilot.trip.api.TripFacade
import com.trippilot.trip.api.TripGenerationContext
import com.trippilot.trip.api.TripPeriod
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldBeEmpty
import io.kotest.matchers.shouldBe
import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

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
        override val maxWaitMs = 24_000L
        var sent: ReflectionAgentInput? = null
        override fun copy(input: ReflectionAgentInput) = answer.also { sent = input }
    }

    class ChangeLogNeverRead : ChangeLogFacade {
        var reads = 0
        override fun append(command: AppendChangeLog) = Unit
        override fun findTimeline(accountId: UUID, tripId: UUID, limit: Int) = emptyList<com.trippilot.changelog.api.ChangeLogEntryView>().also { reads++ }
    }

    /** 집은 날을 센다 — 무엇을 셌는지(AI 까지 간 호출만)를 본다. [limit] 에 닿으면 false. */
    class Usage(private val limit: Int = Int.MAX_VALUE) : ShareCardUsageRepository {
        val claims = mutableListOf<LocalDate>()
        override fun claim(accountId: UUID, day: LocalDate, limit: Int): Boolean =
            (claims.size < minOf(limit, this.limit)).also { if (it) claims += day }
    }

    // 2026-08-13 00:30 KST = 2026-08-12 15:30 UTC — 두 날짜가 다른 시각이라 KST 로 세는지가 보인다.
    val clock: Clock = Clock.fixed(Instant.parse("2026-08-12T15:30:00Z"), ZoneOffset.UTC)

    fun service(
        copier: ShareCardCopyPort,
        usage: ShareCardUsageRepository = Usage(),
        properties: ShareCardCopyProperties = ShareCardCopyProperties(),
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
        return ShareCardCopyService(trips, archive, surfaces, summaries, ReflectionMaterials(preferences, changeLogs, RegionNames), copier, usage, properties, clock)
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

    "AI 를 못 받으면 규칙 문구 — 캡션은 비우고(TRIP-766) 목적지마다 태그, isFallback" {
        val copy = service(Copier(null)).copy(acc, tripId)

        copy shouldBe rule
        copy.caption shouldBe ""
        copy.hashtags shouldBe listOf("#부산여행", "#경주여행")
        copy.isFallback shouldBe true
    }

    "캡션이 150자를 넘으면 자르지 않고 규칙 문구 — 150자는 통과(UTF-16 단위)" {
        service(Copier(ShareCardCopy("가".repeat(151), listOf("#부산여행"), isFallback = false))).copy(acc, tripId) shouldBe rule
        val exact = "가".repeat(150)
        service(Copier(ShareCardCopy(exact, listOf("#부산여행"), isFallback = false))).copy(acc, tripId).caption shouldBe exact
        // 이모지는 UTF-16 두 칸이다 — 75개면 150, 76개면 넘는다(앱 validateCaption 과 같은 단위).
        service(Copier(ShareCardCopy("😀".repeat(76), emptyList(), isFallback = false))).copy(acc, tripId) shouldBe rule
    }

    "AI 해시태그를 다듬는다 — # 를 하나만 앞에, 공백·빈 것·중복을 빼고 10개까지" {
        val tags = listOf("부산여행", "##해운대", " # 감천 문화마을 ", "#", "", "#부산여행") + (1..12).map { "#태그$it" }
        val got = service(Copier(ShareCardCopy("바다를 담은 사흘", tags, isFallback = false))).copy(acc, tripId)

        got.hashtags shouldBe listOf("#부산여행", "#해운대", "#감천문화마을") + (1..7).map { "#태그$it" }
        got.isFallback shouldBe false
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

    "여러 단어 이름도 해시태그에서 잡는다 — 태그는 공백을 못 담는다(대소문자 무시)" {
        ShareCardCopyService.tagLeaks(listOf("#부산여행", "#제주동문시장"), banned = listOf("제주 동문시장"), visited = listOf("해운대")) shouldBe
            listOf("제주 동문시장")
        ShareCardCopyService.tagLeaks(listOf("#seoulforest"), banned = listOf("Seoul Forest"), visited = emptyList()) shouldBe listOf("Seoul Forest")
        // 간 곳 이름에 삼켜지는 금지 이름은 뺀다 — "카페"를 건너뛰고 "카페 델문도"에 갔으면 #카페델문도 는 정당하다.
        ShareCardCopyService.tagLeaks(listOf("#카페델문도"), banned = listOf("카페"), visited = listOf("카페 델문도")).shouldBeEmpty()
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

    "태그 공백은 앱(ECMAScript \\s)이 공백으로 보는 것 전부다 — BOM(U+FEFF) 포함" {
        // ECMAScript \s 의 원소 전부(WhiteSpace + LineTerminator).
        val jsSpaces = "\t\n\u000B\u000C\r \u00A0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF"
        jsSpaces.filterNot(ShareCardCopyService::isTagSpace) shouldBe ""
        ShareCardCopyService.normalizeTags(listOf("#\uFEFF부산\u3000여행", "\uFEFF")) shouldBe listOf("#부산여행")
        ShareCardCopyService.ruleCopy(listOf("제주\uFEFF서귀포")).hashtags shouldBe listOf("#제주서귀포여행")
    }

    "규칙 문구 — 캡션은 비고, 태그는 공백을 지워 10개까지" {
        ShareCardCopyService.ruleCopy(listOf("제주 서귀포", "부산")) shouldBe
            ShareCardCopy("", listOf("#제주서귀포여행", "#부산여행"), isFallback = true)
        ShareCardCopyService.ruleCopy(emptyList()) shouldBe ShareCardCopy("", emptyList(), isFallback = true)
        ShareCardCopyService.ruleCopy((1..12).map { "지역$it" }).hashtags.size shouldBe 10
    }

    "하루 상한 — AI 까지 갈 호출만 KST 날짜로 세고, 닿으면 429(SHARE_CARD_DAILY_LIMIT)·Retry-After 는 KST 자정까지" {
        val usage = Usage(limit = 2)

        service(Copier(aiCopy), usage = usage).copy(acc, tripId) shouldBe aiCopy
        service(Copier(aiCopy), usage = usage).copy(acc, tripId) shouldBe aiCopy
        val over = Copier(aiCopy)
        val e = shouldThrow<RateLimited> { service(over, usage = usage).copy(acc, tripId) }

        over.sent shouldBe null // 상한은 AI 를 부르기 **전에** 본다
        e.errorCode shouldBe ErrorCode.SHARE_CARD_DAILY_LIMIT
        e.retryAfterSeconds shouldBe (23 * 60 + 30) * 60L // 00:30 KST → 다음 KST 자정
        usage.claims shouldBe listOf(LocalDate.parse("2026-08-13"), LocalDate.parse("2026-08-13"))
    }

    "AI 가 실패해도 센다 — 호출은 나갔다" {
        val usage = Usage()
        service(Copier(null), usage = usage).copy(acc, tripId) shouldBe rule
        service(Copier(null), usage = usage).copy(acc, tripId) shouldBe rule
        usage.claims.size shouldBe 2
    }

    "같은 계정의 두 번째 동시 요청은 하루 횟수를 집기 전에 429(RATE_LIMITED) — 끝나면 다시 된다" {
        val entered = CountDownLatch(1)
        val release = CountDownLatch(1)
        val blocking = object : ShareCardCopyPort {
            override val enabled = true
            override val maxWaitMs = 24_001L // 연결 3초 + 읽기 21초 + 1ms — 올림을 본다
            override fun copy(input: ReflectionAgentInput): ShareCardCopy {
                entered.countDown()
                release.await(5, TimeUnit.SECONDS)
                return aiCopy
            }
        }
        val usage = Usage()
        val svc = service(blocking, usage = usage)
        val pool = Executors.newSingleThreadExecutor()
        try {
            val first = pool.submit<ShareCardCopy> { svc.copy(acc, tripId) }
            entered.await(5, TimeUnit.SECONDS) shouldBe true

            val e = shouldThrow<RateLimited> { svc.copy(acc, tripId) }
            e.errorCode shouldBe ErrorCode.RATE_LIMITED
            e.retryAfterSeconds shouldBe 25L // 앞 요청의 정상 경로 상한을 올림한 초
            usage.claims.size shouldBe 1 // 두 번째는 횟수를 태우지 않았다

            release.countDown()
            first.get(5, TimeUnit.SECONDS) shouldBe aiCopy
            svc.copy(acc, tripId) shouldBe aiCopy // 끝나면 풀린다
        } finally {
            release.countDown()
            pool.shutdownNow()
        }
    }

    "AI 호출이 예외로 끝나도 진행 표시가 풀린다" {
        var calls = 0
        val throwing = object : ShareCardCopyPort {
            override val enabled = true
            override val maxWaitMs = 24_000L
            override fun copy(input: ReflectionAgentInput): ShareCardCopy? {
                calls++
                if (calls == 1) error("어댑터가 약속을 어겼다")
                return aiCopy
            }
        }
        val svc = service(throwing)
        shouldThrow<IllegalStateException> { svc.copy(acc, tripId) }
        svc.copy(acc, tripId) shouldBe aiCopy
    }

    "AI 까지 가지 않는 호출은 세지 않는다 — 꺼짐·간 곳 없음·404·409" {
        val usage = Usage()
        service(Copier(aiCopy, enabled = false), usage = usage).copy(acc, tripId)
        service(Copier(aiCopy), usage = usage, archive = CountingArchive(emptyList())).copy(acc, tripId)
        runCatching { service(Copier(aiCopy), usage = usage).copy(UUID.randomUUID(), tripId) }
        runCatching { service(Copier(aiCopy), usage = usage, summaryExists = false).copy(acc, tripId) }
        usage.claims.shouldBeEmpty()
    }

    "상한 설정은 1 이상이다 — 끄는 일은 AI 모드 스위치의 몫" {
        shouldThrow<IllegalArgumentException> { ShareCardCopyProperties(dailyLimit = 0) }
        ShareCardCopyProperties(dailyLimit = 1).dailyLimit shouldBe 1
    }
})
