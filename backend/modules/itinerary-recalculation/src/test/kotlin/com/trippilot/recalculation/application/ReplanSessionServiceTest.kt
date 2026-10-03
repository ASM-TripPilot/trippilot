package com.trippilot.recalculation.application

import com.trippilot.auth.api.LocationCollectionSource
import com.trippilot.auth.api.LocationPurgeScope

import com.trippilot.core.error.ConflictDetected
import com.trippilot.core.error.ResourceNotFound
import com.trippilot.core.error.ValidationFailed
import com.trippilot.itinerarygeneration.api.ItineraryFacade
import com.trippilot.itinerarygeneration.api.ItineraryRef
import com.trippilot.placedata.api.FrozenPoiView
import com.trippilot.placedata.api.PoiSurfaceFacade
import com.trippilot.placedata.api.PoiSurfaceView
import com.trippilot.recalculation.domain.OriginKind
import com.trippilot.savedaccommodation.api.BaseAnchorFacade
import com.trippilot.savedaccommodation.api.DayAnchorView
import com.trippilot.recalculation.domain.ReplanOrigin
import com.trippilot.recalculation.domain.ReplanScope
import com.trippilot.recalculation.domain.ReplanSession
import com.trippilot.recalculation.domain.ReplanSessionRepository
import com.trippilot.recalculation.domain.ReplanStatus
import com.trippilot.trip.api.TripFacade
import com.trippilot.trip.api.TripPeriod
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldContainExactly
import io.kotest.matchers.shouldBe
import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import java.util.UUID

/**
 * 재계획 진입(C10 · LC-U4-4). 정본 불변식이 검증 축이다.
 * - **INV-U4-05** 확정 전 원 일정 무변경 — 취소는 세션만 닫는다
 * - **INV-U4-06** 열린 세션 1개 — 새 진입은 **기존을 닫고 시작**한다(거부가 아니다)
 */
class ReplanSessionServiceTest : StringSpec({

    val acc = UUID.randomUUID()
    val tripId = UUID.randomUUID()
    val itineraryId = UUID.randomUUID()
    val tripStart = LocalDate.parse("2026-08-10")
    val tripEnd = LocalDate.parse("2026-08-12")

    fun clockAt(instant: String): Clock = Clock.fixed(Instant.parse(instant), ZoneOffset.UTC)

    class Sessions : ReplanSessionRepository {
        val stored = mutableListOf<ReplanSession>()
        override fun save(session: ReplanSession) = session.also {
            stored.removeAll { s -> s.sessionId == session.sessionId }
            stored += it
        }
        override fun findById(sessionId: UUID) = stored.firstOrNull { it.sessionId == sessionId }
        // 단일 스레드 테스트라 잠금은 의미가 없다 — 경합 자체는 실 DB IT 가 검증한다.
        override fun findByIdForUpdate(sessionId: UUID) = findById(sessionId)
        override fun findOpenByTrip(tripId: UUID) = stored.firstOrNull { it.tripId == tripId && it.isOpen }
        override fun purgeOrigins(tripIds: List<UUID>): Int {
            var n = 0
            stored.replaceAll { s ->
                if (s.tripId in tripIds && s.origin.kind in setOf(OriginKind.GPS, OriginKind.MANUAL)) {
                    n++; s.copy(origin = ReplanOrigin(OriginKind.PURGED, null, null))
                } else s
            }
            return n
        }
    }

    val trips = object : TripFacade {
        override fun findPeriod(accountId: UUID, tripId: UUID) =
            if (accountId == acc) TripPeriod(tripStart, tripEnd) else null
        override fun findGenerationContext(accountId: UUID, tripId: UUID) = null
    }

    /**
     * 일정이 있는 여행(기본) / 없는 여행을 나눠 본다.
     *
     * [dates] 는 일정에 **실재하는** 일자다 — 기본값이 여행 전 기간인 이유: 2차 생성까지 끝난
     * (`COMPLETE`) 일정이 정상 상태이고, 1일차만 있는 것은 `PARTIAL`(진행 중·실패)이다.
     * 종전 기본값은 1일차뿐이라 **오늘이 일정에 없는 상태**를 상시로 돌렸고, 그 상태는
     * 확정에서 막다른 길이 되는 상태다(resolveTargetDate KDoc).
     */
    fun itineraries(
        present: Boolean = true,
        dates: List<LocalDate> = listOf(tripStart, tripStart.plusDays(1), tripEnd),
    ) = object : ItineraryFacade {
        override fun findCurrent(accountId: UUID, tripId: UUID) =
            if (present && accountId == acc) {
                ItineraryRef(itineraryId, "PLANNED", "COMPLETE", dates, listOf("$tripStart#${UUID.randomUUID()}"))
            } else {
                null
            }
    }

    /** 사다리 전반은 OriginResolverTest 가 본다 — 여기는 **어느 날 거점을 골랐나**만 본다. */
    fun originsWith(anchors: List<DayAnchorView> = emptyList()) = OriginResolver(
        object : BaseAnchorFacade {
            override fun findStayNightAnchors(tripId: UUID, startDate: LocalDate, endDate: LocalDate) = anchors
        },
    )

    /** POI 표면 — 사다리 3단(마지막 완료 방문지)의 좌표 원천이다. 기본은 비어 있다. */
    fun surfacesOf(views: Map<UUID, PoiSurfaceView> = emptyMap()) = object : PoiSurfaceFacade {
        override fun findSurfaces(poiIds: Collection<UUID>) = views.filterKeys { it in poiIds }
        override fun findFrozenSurfaces(poiSnapshotIds: Collection<UUID>) = emptyMap<UUID, FrozenPoiView>()
    }

    fun surfaceAt(poiId: UUID, lat: Double, lng: Double) = PoiSurfaceView(
        poiId = poiId, nameKo = "성산일출봉", lat = lat, lng = lng,
        category = "관광지", categoryCode = "ATTRACTION", openingHours = null, imageUrl = null, tags = emptyList(),
    )

    fun service(
        sessions: Sessions,
        clock: Clock,
        hasItinerary: Boolean = true,
        consents: FakeLocationConsents = FakeLocationConsents(),
        legalLogs: CapturingLegalLogs = CapturingLegalLogs(),
        purgeScope: FakeTripPurgeScope = FakeTripPurgeScope(),
        itineraryDates: List<LocalDate> = listOf(tripStart, tripStart.plusDays(1), tripEnd),
        anchors: List<DayAnchorView> = emptyList(),
        archive: FakeArchive = FakeArchive(),
        surfaces: PoiSurfaceFacade = surfacesOf(),
    ) =
        ReplanSessionService(
            trips, itineraries(hasItinerary, itineraryDates), sessions, originsWith(anchors),
            archive, surfaces,
            ReplanSolver(sessions, archive, FakeReplans(), NOOP_TX, clock),
            FakeReplans(), consents, legalLogs, purgeScope, CapturingReplanEvents(), clock,
        )

    val gpsOrigin = ReplanOrigin(OriginKind.GPS, 33.45, 126.56)
    fun request(reasons: List<String> = listOf("비가 와요")) = StartReplan(
        scope = ReplanScope.PARTIAL_SLOTS,
        targetDate = null,
        origin = gpsOrigin,
        reasons = reasons,
        directives = listOf("실내로 바꿔줘"),
        freeText = null,
        excludedPoiIds = emptyList(),
        triggerId = null,
    )

    // ───── 위치 동의·법정 로그 (TRIP-992) ──────────────────────────────────

    "동의가 있으면 사용자 좌표가 저장되고 수집 로그 1건이 남는다 — 대상은 세션 id, 좌표는 로그에 없다" {
        val sessions = Sessions()
        val logs = CapturingLegalLogs()
        val s = service(sessions, clockAt("2026-08-11T00:00:00Z"), legalLogs = logs).start(acc, tripId, request())

        s.origin.kind shouldBe OriginKind.GPS
        logs.collections shouldContainExactly listOf(LocationCollectionSource.REPLAN_ORIGIN to s.sessionId)
    }

    "동의가 없으면 좌표를 버리고 서버 사다리로 강등한다 — 수집 로그도 없다(그건 수집이 아니다)" {
        val sessions = Sessions()
        val logs = CapturingLegalLogs()
        val s = service(sessions, clockAt("2026-08-11T00:00:00Z"), consents = FakeLocationConsents(legalConsent = false), legalLogs = logs)
            .start(acc, tripId, request()) // 요청에는 GPS 좌표가 실려 있다

        (s.origin.kind in setOf(OriginKind.GPS, OriginKind.MANUAL)) shouldBe false // 저장 안 됨
        s.origin.lat shouldBe null
        logs.collections.isEmpty() shouldBe true
    }

    "사다리로 유도된 기준점은 수집 로그를 남기지 않는다 — 사용자 위치를 모은 것이 아니다" {
        val logs = CapturingLegalLogs()
        service(Sessions(), clockAt("2026-08-11T00:00:00Z"), legalLogs = logs)
            .start(acc, tripId, request().copy(origin = null))

        logs.collections.isEmpty() shouldBe true
    }

    "동의 철회 파기 — GPS·MANUAL 좌표가 PURGED 로 지워지고 파기 로그에 건수가 남는다(INV-L4)" {
        val sessions = Sessions()
        val logs = CapturingLegalLogs()
        val svc = service(sessions, clockAt("2026-08-11T00:00:00Z"), legalLogs = logs, purgeScope = FakeTripPurgeScope(listOf(tripId)))
        val opened = svc.start(acc, tripId, request())

        val purged = svc.purgeOriginCoordinates(acc)

        purged shouldBe 1
        sessions.stored.single { it.sessionId == opened.sessionId }.origin.kind shouldBe OriginKind.PURGED
        sessions.stored.single { it.sessionId == opened.sessionId }.origin.lat shouldBe null
        logs.purges shouldContainExactly listOf(LocationPurgeScope.REPLAN_ORIGIN to 1)

        // 멱등 — 두 번째 배달(at-least-once)은 0건이라 기록이 부풀지 않는다.
        svc.purgeOriginCoordinates(acc) shouldBe 0
        logs.purges.size shouldBe 1
    }

    "지울 좌표가 없으면 파기 로그도 없다 — 확인자료가 '지운 적 없는 파기'를 말하면 안 된다" {
        val logs = CapturingLegalLogs()
        service(Sessions(), clockAt("2026-08-11T00:00:00Z"), legalLogs = logs, purgeScope = FakeTripPurgeScope(listOf(tripId)))
            .purgeOriginCoordinates(acc) shouldBe 0

        logs.purges.isEmpty() shouldBe true
    }

    "여행 기간 안이면 세션이 열리고 곧바로 산출로 넘어간다 — 입력이 그대로 실린다" {
        val sessions = Sessions()
        val s = service(sessions, clockAt("2026-08-11T00:00:00Z")).start(acc, tripId, request())

        // 시트 제출과 동시에 산출이 시작된다 — COLLECTING 에 멈추면 화면이 영원히 로딩이다.
        s.status shouldBe ReplanStatus.SOLVING
        s.itineraryId shouldBe itineraryId
        s.scope shouldBe ReplanScope.PARTIAL_SLOTS
        s.reasons shouldContainExactly listOf("비가 와요")
        s.directives shouldContainExactly listOf("실내로 바꿔줘")
        s.closedAt shouldBe null
        s.draft shouldBe null // 확정은커녕 산출도 아직이다(INV-U4-05)
    }

    "새 진입은 기존 열린 세션을 닫고 시작한다 — 막지 않는다(INV-U4-06)" {
        // 사용자가 앱을 닫았다 다시 들어오는 것이 정상 흐름이라, 거부하면 영영 못 들어간다.
        val sessions = Sessions()
        val svc = service(sessions, clockAt("2026-08-11T00:00:00Z"))
        val first = svc.start(acc, tripId, request(listOf("첫 시도")))
        val second = svc.start(acc, tripId, request(listOf("두 번째 시도")))

        sessions.findById(first.sessionId)!!.status shouldBe ReplanStatus.CANCELED
        sessions.findById(first.sessionId)!!.closedAt shouldBe Instant.parse("2026-08-11T00:00:00Z")
        second.status shouldBe ReplanStatus.SOLVING
        sessions.stored.count { it.isOpen } shouldBe 1 // 언제나 하나
        sessions.stored.size shouldBe 2                // 이전 시도는 이력으로 남는다
    }

    "여행 기간 밖이면 409" {
        shouldThrow<ConflictDetected> {
            service(Sessions(), clockAt("2026-08-09T00:00:00Z")).start(acc, tripId, request())
        }
        shouldThrow<ConflictDetected> {
            service(Sessions(), clockAt("2026-08-13T00:00:00Z")).start(acc, tripId, request())
        }
    }

    "구간 판정은 KST 기준 — UTC 로 보면 하루가 어긋난다" {
        // 08-09T16:00Z = KST 08-10 01:00 → 여행 첫날
        service(Sessions(), clockAt("2026-08-09T16:00:00Z")).start(acc, tripId, request())
            .status shouldBe ReplanStatus.SOLVING
    }

    "다시 짤 일정이 없으면 404 — 그건 재계획이 아니라 생성이다" {
        shouldThrow<ResourceNotFound> {
            service(Sessions(), clockAt("2026-08-11T00:00:00Z"), hasItinerary = false).start(acc, tripId, request())
        }
    }

    "미소유 여행이면 404" {
        shouldThrow<ResourceNotFound> {
            service(Sessions(), clockAt("2026-08-11T00:00:00Z")).start(UUID.randomUUID(), tripId, request())
        }
    }

    "취소는 세션만 닫는다 — 원 일정을 건드리지 않는다(INV-U4-05)" {
        val sessions = Sessions()
        val svc = service(sessions, clockAt("2026-08-11T00:00:00Z"))
        val s = svc.start(acc, tripId, request())

        val canceled = svc.cancel(acc, tripId, s.sessionId)
        canceled.status shouldBe ReplanStatus.CANCELED
        canceled.closedAt shouldBe Instant.parse("2026-08-11T00:00:00Z")
        canceled.itineraryId shouldBe itineraryId // 어느 일정이었는지는 남는다
        shouldThrow<ConflictDetected> { svc.cancel(acc, tripId, s.sessionId) } // 두 번 닫지 않는다
    }

    "다른 여행의 세션은 조회·취소할 수 없다(404)" {
        val sessions = Sessions()
        val otherTrip = UUID.randomUUID()
        val foreign = sessions.save(
            ReplanSession.start(
                otherTrip, itineraryId, null, ReplanScope.FULL_DAY, LocalDate.of(2026, 8, 11),
                Instant.parse("2026-08-11T00:00:00Z"), gpsOrigin,
                emptyList(), emptyList(), null, emptyList(), Instant.parse("2026-08-11T00:00:00Z"),
            ),
        )
        val svc = service(sessions, clockAt("2026-08-11T00:00:00Z"))

        shouldThrow<ResourceNotFound> { svc.get(acc, tripId, foreign.sessionId) }
        shouldThrow<ResourceNotFound> { svc.cancel(acc, tripId, foreign.sessionId) }
    }

    // ───── 대상 일자 (TRIP-1182) ───────────────────────────────────────────
    // 종전에는 '오늘'이 코드에 박혀 있어 내일·모레를 다시 짤 수 없었다.

    val today = LocalDate.parse("2026-08-11")
    val tomorrow = LocalDate.parse("2026-08-12") // == tripEnd
    fun startOn(target: LocalDate?, scope: ReplanScope = ReplanScope.FULL_DAY) = StartReplan(
        scope = scope, targetDate = target, origin = gpsOrigin,
        reasons = emptyList(), directives = emptyList(), freeText = null,
        excludedPoiIds = emptyList(), triggerId = null,
    )

    "대상 일자를 주면 그 날이 세션에 남는다 — 오늘이 아니어도 된다" {
        val sessions = Sessions()
        val svc = service(sessions, clockAt("2026-08-11T00:00:00Z"), itineraryDates = listOf(today, tomorrow))

        svc.start(acc, tripId, startOn(tomorrow)).targetDate shouldBe tomorrow
    }

    "대상 일자를 생략하면 오늘이다 — 종전 클라이언트가 그대로 돈다" {
        val sessions = Sessions()
        val svc = service(sessions, clockAt("2026-08-11T00:00:00Z"), itineraryDates = listOf(today))

        svc.start(acc, tripId, startOn(null, ReplanScope.PARTIAL_SLOTS)).targetDate shouldBe today
    }

    // 막지 못하면 이미 다녀온 하루를 덮어쓴다 — 실적과 계획이 어긋나고 되돌릴 근거가 없다.
    "지난 날짜는 다시 짤 수 없다(409)" {
        val sessions = Sessions()
        val svc = service(sessions, clockAt("2026-08-11T00:00:00Z"), itineraryDates = listOf(tripStart, today))

        shouldThrow<ConflictDetected> { svc.start(acc, tripId, startOn(tripStart)) }
        sessions.stored shouldBe emptyList() // 세션을 열지 않는다
    }

    "여행 기간 밖 날짜는 다시 짤 수 없다(409)" {
        val sessions = Sessions()
        val beyond = tripEnd.plusDays(1)
        val svc = service(sessions, clockAt("2026-08-11T00:00:00Z"), itineraryDates = listOf(today, beyond))

        shouldThrow<ConflictDetected> { svc.start(acc, tripId, startOn(beyond)) }
    }

    // 통과시키면 AI 25초를 태운 뒤 **확정에서야** "그 사이 일정이 바뀌었습니다"가 나온다(원인과 다른 문구다).
    "일정에 아직 없는 날짜는 다시 짤 수 없다(409) — 부분 생성은 1일차뿐이다" {
        val sessions = Sessions()
        val svc = service(sessions, clockAt("2026-08-11T00:00:00Z"), itineraryDates = listOf(today))

        shouldThrow<ConflictDetected> { svc.start(acc, tripId, startOn(tomorrow)) }
    }

    // '그 날의 지금'은 없다. 통과시키면 다른 날의 벽시계로 슬롯이 잠겨 하루 절반이 그대로 남는다.
    "오늘이 아닌 날짜는 '지금 이후'로 다시 짤 수 없다(400)" {
        val sessions = Sessions()
        val svc = service(sessions, clockAt("2026-08-11T00:00:00Z"), itineraryDates = listOf(today, tomorrow))

        shouldThrow<ValidationFailed> { svc.start(acc, tripId, startOn(tomorrow, ReplanScope.PARTIAL_SLOTS)) }
    }

    // 지금 서 있는 좌표는 **그 날의** 출발지가 아니다 — 실으면 AI 가 내일 하루를 오늘 있던 동네에 매단다.
    // 좌표를 **버렸다는 것**만 보면 부족하다: 사다리가 끝까지 떨어져도 같은 결과라(좌표 null) "일어나지도
    // 않았다"와 구분이 안 된다. 그래서 **어느 날 거점을 골랐는지**까지 단언한다.
    "미래일 재계획은 현재 위치가 아니라 그 날 숙소 거점을 기준점으로 쓴다" {
        val sessions = Sessions()
        val legalLogs = CapturingLegalLogs()
        val svc = service(
            sessions, clockAt("2026-08-11T00:00:00Z"),
            legalLogs = legalLogs, itineraryDates = listOf(today, tomorrow),
            anchors = listOf(
                DayAnchorView(today, 33.50, 126.53),    // 오늘 밤 제주시
                DayAnchorView(tomorrow, 33.25, 126.56), // 내일 밤 서귀포
            ),
        )

        val opened = svc.start(acc, tripId, startOn(tomorrow))

        opened.origin.kind shouldBe OriginKind.STAY_ANCHOR // GPS 좌표를 받았지만 쓰지 않았다
        opened.origin.lat shouldBe 33.25 // 오늘(제주시)이 아니라 **그 날**(서귀포) 거점이다
        opened.origin.lng shouldBe 126.56
        legalLogs.collections shouldBe emptyList() // 저장하지 않았으니 수집도 아니다(INV-LL1)
    }

    // 사다리 3단(마지막 완료 방문지)은 2단 아래라 **숙소 앵커보다 먼저 이긴다** — 미래일에 열어 두면
    // 내일 하루가 오늘 마지막으로 서 있던 곳에 매달리고, 화면에는 "추정 출발지"로만 보여 원인을 알 길이 없다.
    "미래일 재계획은 오늘의 마지막 방문지도 기준점으로 쓰지 않는다" {
        val lastPoi = UUID.randomUUID()
        val svc = service(
            Sessions(), clockAt("2026-08-11T00:00:00Z"),
            itineraryDates = listOf(today, tomorrow),
            anchors = listOf(DayAnchorView(tomorrow, 33.25, 126.56)),
            archive = FakeArchive(lastCompletedPoi = lastPoi),
            surfaces = surfacesOf(mapOf(lastPoi to surfaceAt(lastPoi, 33.46, 126.94))), // 오늘 섬 동쪽
        )

        val opened = svc.start(acc, tripId, startOn(tomorrow).copy(origin = null))

        opened.origin.kind shouldBe OriginKind.STAY_ANCHOR // LAST_VISIT 이 아니다
        opened.origin.lat shouldBe 33.25
    }

    // 같은 의도가 필드 유무로 갈리지 않는다. 종전에는 생략하면 가드를 밟지 않아 AI 25초를 태운 뒤
    // 확정에서 "그 사이 일정이 바뀌었습니다"로 막혔다 — 사용자가 빠져나갈 길이 없는 막다른 길이었다.
    "1차 생성만 끝난 일정은 오늘 재계획도 거부한다(409) — 대상 일자를 생략해도 같다" {
        val sessions = Sessions()
        val svc = service(
            sessions, clockAt("2026-08-11T00:00:00Z"),
            itineraryDates = listOf(tripStart), // PARTIAL — 1일차(8/10)뿐, 오늘(8/11)이 없다
        )

        shouldThrow<ConflictDetected> { svc.start(acc, tripId, startOn(null, ReplanScope.PARTIAL_SLOTS)) }
        sessions.stored shouldBe emptyList()
    }
})
