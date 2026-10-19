package com.trippilot.recalculation.application

import com.trippilot.archive.api.ArchiveFacade
import com.trippilot.core.error.ConflictDetected
import com.trippilot.core.error.DomainException
import com.trippilot.core.error.ErrorCode
import com.trippilot.core.error.FieldError
import com.trippilot.core.error.ResourceNotFound
import com.trippilot.core.error.ValidationFailed
import com.trippilot.itinerarygeneration.api.ItineraryFacade
import com.trippilot.itinerarygeneration.api.ItineraryPlanFacade
import com.trippilot.itinerarygeneration.api.ItineraryRef
import com.trippilot.placedata.api.PoiSurfaceFacade
import com.trippilot.planbdetection.api.TriggerLookupFacade
import com.trippilot.recalculation.domain.DraftFacts
import com.trippilot.recalculation.domain.ReplanDiff
import com.trippilot.recalculation.domain.ReplanInitiator
import com.trippilot.recalculation.domain.ReplanOrigin
import com.trippilot.recalculation.domain.ReplanScope
import com.trippilot.recalculation.domain.ReplanSession
import com.trippilot.recalculation.domain.ReplanSessionRepository
import com.trippilot.recalculation.domain.Staleness
import com.trippilot.core.event.DomainEventPublisher
import com.trippilot.itinerarygeneration.api.ReplanCommand
import com.trippilot.itinerarygeneration.api.ReplanFacade
import com.trippilot.itinerarygeneration.api.ReplanProposal
import com.trippilot.recalculation.api.event.ItineraryRecalculated
import com.trippilot.recalculation.domain.ReplanStatus
import com.trippilot.auth.api.LocationCollectionSource
import com.trippilot.auth.api.LocationConsentFacade
import com.trippilot.auth.api.LocationLegalLogFacade
import com.trippilot.auth.api.LocationPurgeScope
import com.trippilot.recalculation.domain.OriginKind
import com.trippilot.trip.api.TripFacade
import com.trippilot.trip.api.TripPeriod
import com.trippilot.trip.api.TripPurgeScopeFacade
import org.slf4j.LoggerFactory
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import org.springframework.transaction.support.TransactionSynchronization
import org.springframework.transaction.support.TransactionSynchronizationManager
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.util.UUID

/** 재계획 진입 입력(`i10`). 어휘는 화면이 정하고 서버는 그대로 싣는다. */
data class StartReplan(
    val scope: ReplanScope,
    /** 다시 짤 일자(TRIP-1182). **null 이면 오늘** — 종전 동작이 기본값이다. */
    val targetDate: LocalDate?,
    /** 클라이언트가 알려준 기준점. **null 이면 서버가 사다리로 정한다**(BR-U4-19). */
    val origin: ReplanOrigin?,
    val reasons: List<String>,
    val directives: List<String>,
    val freeText: String?,
    val excludedPoiIds: List<UUID>,
    /** 자동 진입이면 근거 트리거 — 있으면 대상 날짜는 그 트리거의 날짜로 강제된다(BR-SA-20). 수동이면 null. */
    val triggerId: UUID?,
)

/**
 * 선계산 요청 — 위험 알림 사건 1건(situation-awareness BR-SA-18). 재료(사유·지시·제외)는 [ReplanMaterial] 이 사건에서 만든다.
 * 날짜·범위는 받지 않는다 — 진입 검증이 트리거의 날짜로 정한다(사용자 진입과 같은 규칙, BR-SA-20).
 */
data class PrepareReplan(
    val accountId: UUID,
    val tripId: UUID,
    val triggerId: UUID,
    val reasons: List<String>,
    val directives: List<String>,
    val excludedPoiIds: List<UUID>,
)

/** 선계산 결과 — 저장하지 않는다(요약 로그 `replan.prepared outcome=`). */
sealed interface Prepared {
    /** SYSTEM 세션을 산출 직전(SOLVING)까지 열었다 — 산출은 전용 실행기 몫이다. */
    data class Opened(val session: ReplanSession) : Prepared
    data class Skipped(val reason: PrepareSkip) : Prepared
}

/** 선계산을 건너뛴 까닭(BR-SA-18). [BUSY] 는 실행 자리를 못 얻어 세션을 열지도 않은 것이다(상한·트리거당 1회를 쓰지 않는다). */
enum class PrepareSkip { DUPLICATE, TRIP_CAP, GLOBAL_CAP, INVALID, OPEN_SESSION, EARLIER_OPEN, BUSY }

/** 세션 + 낡음(BR-SA-19) — 화면 응답의 `stale` 과 적용 거절이 같은 판정을 쓴다. */
data class SessionView(val session: ReplanSession, val stale: Boolean)

/**
 * 재계획 세션 수명 관리(C10 · LC-U4-4).
 *
 * 두 불변식이 이 클래스의 존재 이유다:
 * - **INV-U4-05** 확정 전에는 원 일정에 아무것도 쓰지 않는다 — 취소는 세션만 닫는다. 선계산(SYSTEM)도 초안까지다(INV-SA-1) —
 *   일정을 바꾸는 것은 사용자의 [apply] 하나다.
 * - **INV-U4-06** 한 여행에 열린 세션은 최대 1개. 새 진입은 **기존 세션을 CANCELED 로 닫고 시작**한다.
 *   (거부하지 않는다 — 사용자가 앱을 닫았다 다시 들어온 경우가 정상 흐름이라, 막으면 영영 못 들어간다.)
 *   선계산은 그 1개를 함께 쓰되 사용자가 보는 중인 세션을 빼앗지 않는다(INV-SA-6 — [prepare] 의 열린 세션 정책).
 */
@Service
class ReplanSessionService(
    private val trips: TripFacade,
    private val itineraries: ItineraryFacade,
    private val sessions: ReplanSessionRepository,
    private val origins: OriginResolver,
    private val archive: ArchiveFacade,
    private val poiSurfaces: PoiSurfaceFacade,
    private val solver: ReplanSolver,
    private val replans: ReplanFacade,
    /** 위치 동의(L2)·법정 로그(TRIP-992) — 판정은 auth 정본에서 그때그때 읽는다(파생 복사 금지). */
    private val locationConsents: LocationConsentFacade,
    private val legalLogs: LocationLegalLogFacade,
    private val purgeScope: TripPurgeScopeFacade,
    private val events: DomainEventPublisher,
    private val clock: Clock,
    /** 트리거 진입 날짜 강제(BR-SA-20 ①) — C9 api. 사실(kind·상태·날짜)만 읽는다. */
    private val triggers: TriggerLookupFacade,
    /** 낡음 판정의 '지금 일정'(BR-SA-19 ②) — 전후 비교([ReplanDiffService])와 같은 원천이다. */
    private val plans: ItineraryPlanFacade,
    private val properties: ReplanProperties,
) {

    @Transactional
    fun start(accountId: UUID, tripId: UUID, request: StartReplan): ReplanSession {
        val now = clock.instant()
        val entry = resolveEntry(accountId, tripId, request.triggerId, request.targetDate, request.scope, now)

        // 위치 동의 게이트(TRIP-992) — FE 확인만 믿지 않는다. 동의 없이 온 좌표는 받는 순간
        // 수집이라 **저장 전에** 버리고 서버 사다리로 강등한다. 버린 경우 수집 로그도 없다(그건 수집이 아니다).
        val requestedOrigin = request.origin?.takeIf {
            locationConsents.hasLocationLegalConsent(accountId).also { consented ->
                if (!consented) log.info("위치 동의 없음 — 요청 좌표를 버리고 서버 사다리로 강등합니다. tripId={}", tripId)
            }
        }

        // INV-U4-06 — 기존 열린 세션은 **닫고 시작한다**(선계산 포함 — 사용자가 고른 것이 이긴다).
        // 이전 시도의 draft 는 그 세션에 남아 이력이 된다. 잠가 읽는다 — 그 사이 적용된 세션을 CANCELED 로 덮지 않게.
        sessions.findOpenByTripForUpdate(tripId)?.let {
            log.info("이전 재계획 세션을 닫고 새로 시작합니다 — tripId={} previous={}", tripId, it.sessionId)
            sessions.save(it.canceled(now))
        }

        val opened = try {
            sessions.save(
                ReplanSession.start(
                    tripId = tripId,
                    itineraryId = entry.itinerary.itineraryId,
                    triggerId = request.triggerId,
                    scope = entry.scope,
                    targetDate = entry.targetDate,
                    fromInstant = now, // '지금 이후'가 기준 — 이미 지난 슬롯은 대상이 아니다
                    origin = originFor(entry, tripId, requestedOrigin),
                    reasons = request.reasons,
                    directives = request.directives,
                    freeText = request.freeText,
                    excludedPoiIds = request.excludedPoiIds,
                    at = now,
                ),
            )
        } catch (e: DataIntegrityViolationException) {
            // 그 사이 다른 진입(선계산 포함)이 이 여행의 열린 세션을 먼저 저장했다(ux_replan_session_open — BR-SA-20 ④).
            // 잡지 않으면 사용자에게 500 이 나간다. 이 트랜잭션은 이 예외로 롤백되고, 다시 시도하면 그 세션을 닫고 연다.
            log.info("재계획 시작이 다른 진입과 겹쳤습니다 — tripId={}", tripId, e)
            throw ConflictDetected(message = "다른 재계획이 막 시작됐어요. 다시 시도해 주세요.")
        }
        // 위치정보를 **실제로 저장했을 때만** 수집 사실을 남긴다(TRIP-992 · INV-LL1). 판정은 저장
        // **결과**의 kind 다 — 요청에 좌표가 있었는지가 아니다(동의 강등·사다리 폴백이 그 사이에 있다).
        // 같은 트랜잭션이라 세션 저장이 롤백되면 로그도 없던 일이 된다(파사드 규약).
        if (opened.origin.kind in COORD_COLLECTED) {
            legalLogs.recordCollection(accountId, LocationCollectionSource.REPLAN_ORIGIN, opened.sessionId)
        }

        // 시트를 제출하면 곧바로 산출로 넘어간다 — 여기서 시작하지 않으면 세션이 COLLECTING 에 멈춰
        // **영원히 로딩**이 된다. 산출은 비동기라 응답은 SOLVING 이고, 화면(i12)은 세션을 폴링해 로딩을 그린다.
        val solving = sessions.save(opened.solving())
        // **커밋된 뒤에** 시작한다 — 트랜잭션 안에서 부르면 비동기 스레드가 아직 없는 행을 읽어(다른 커넥션)
        // 조용히 아무것도 하지 않고, 세션은 SOLVING 에 영원히 멈춘다(실측: E2E 가 20초 폴링 끝에 잡았다).
        afterCommit { solver.solve(accountId, solving.sessionId) }
        return solving
    }

    /**
     * 선계산(situation-awareness BR-SA-18) — 위험 알림 사건 1건으로 SYSTEM 세션을 **산출 직전(SOLVING)까지** 연다.
     * 산출은 호출자(전용 실행기)가 한다. 일정은 쓰지 않는다(INV-SA-1) — 적용은 사용자의 [apply] 뿐이다.
     *
     * 순서: 트리거당 1개(재배달 멱등) → 진입 검증(사용자 진입과 같은 규칙) → 열린 세션 정책 → 하루 상한 → 연다.
     * 상한은 **실제로 연 세션만** 센다 — 건너뛴 것은 세지 않는다(O-SA-10).
     *
     * 저장 경합(사용자 시작과 같은 순간)은 여기서 잡지 않는다 — 부분 유니크 위반은 이 트랜잭션을 롤백 전용으로 만들어
     * 여기서 삼키고 반환하면 커밋에서 다시 터진다. 호출자가 트랜잭션 밖에서 받아 OPEN_SESSION 으로 접는다.
     */
    @Transactional
    fun prepare(request: PrepareReplan): Prepared {
        val now = clock.instant()
        // 트리거당 1개 — 아웃박스 재배달(at-least-once)은 여기서 끝난다. DB 부분 유니크가 경합의 마지막 방어선이다.
        if (sessions.findSystemByTrigger(request.triggerId) != null) return Prepared.Skipped(PrepareSkip.DUPLICATE)
        val entry = try {
            // 범위는 '지금 이후'로 묻는다 — 오늘은 그대로(CD7: 체크 안 한 지난 슬롯을 잠근다), 미래일은 진입이 하루 전체로 강제한다.
            resolveEntry(request.accountId, request.tripId, request.triggerId, null, ReplanScope.PARTIAL_SLOTS, now)
        } catch (e: DomainException) {
            // 우리 코드가 던진 판정이다(조회 결과가 없음·날짜 규칙) — 트랜잭션 상태를 건드리지 않아 그대로 반환해도 된다.
            log.info("선계산 진입 검증 실패 — tripId={} triggerId={} 사유={}", request.tripId, request.triggerId, e.message)
            return Prepared.Skipped(PrepareSkip.INVALID)
        }
        // 잠가 읽는다 — 정책 판정과 닫기가 같은 행을 본다. 잠금 없이 읽어 두면 그 사이 사용자가 적용한 세션을 CANCELED 로 덮는다.
        val open = sessions.findOpenByTripForUpdate(request.tripId)
        open?.let { blockerOf(request.accountId, it, entry.targetDate, now) }?.let { return Prepared.Skipped(it) }

        // 하루는 여행지 기준이다(KST) — 서버 UTC 로 자르면 아침 9시에 상한이 풀린다.
        val dayStart = entry.today.atStartOfDay(TRAVEL_ZONE).toInstant()
        if (sessions.countSystemSince(request.tripId, dayStart) >= TRIP_DAILY_CAP) return Prepared.Skipped(PrepareSkip.TRIP_CAP)
        if (sessions.countSystemSince(null, dayStart) >= GLOBAL_DAILY_CAP) return Prepared.Skipped(PrepareSkip.GLOBAL_CAP)

        open?.let {
            log.info("열린 재계획 세션을 닫고 선계산을 엽니다 — tripId={} previous={}", request.tripId, it.sessionId)
            sessions.save(it.canceled(now))
        }
        val opened = sessions.save(
            ReplanSession.start(
                tripId = request.tripId,
                itineraryId = entry.itinerary.itineraryId,
                triggerId = request.triggerId,
                scope = entry.scope,
                targetDate = entry.targetDate,
                fromInstant = now,
                // 기기 좌표가 없다 — 서버 사다리(마지막 방문지·숙소)뿐이라 위치 수집도 법정 로그도 없다(INV-LL1).
                origin = originFor(entry, request.tripId, requested = null),
                reasons = request.reasons,
                directives = request.directives,
                freeText = null, // 자유 텍스트는 번역 LLM·발화 해석을 부른다 — 선계산은 닫힌 키만 싣는다
                excludedPoiIds = request.excludedPoiIds,
                at = now,
                initiatedBy = ReplanInitiator.SYSTEM,
            ),
        )
        return Prepared.Opened(sessions.save(opened.solving()))
    }

    /**
     * 열린 세션 정책(BR-SA-18 ② · INV-U4-06 공존) — 선계산을 막는 까닭. 없으면 null(그 세션을 닫고 연다).
     *
     * | 열린 세션 | 선계산 |
     * |---|---|
     * | 30분 안에 연 사용자 세션 | 건너뜀(INV-SA-6 — 날짜와 무관하게 이것이 먼저다) |
     * | 더 이른 날짜의 선계산(낡지 않음) | 건너뜀 — 오늘 초안이 내일 것에 밀리지 않는다 |
     * | 지난 날 · 방치된 사용자 세션 · 같은 날이나 늦은 날 선계산 | 닫고 연다 |
     */
    private fun blockerOf(accountId: UUID, open: ReplanSession, target: LocalDate, now: Instant): PrepareSkip? = when {
        open.initiatedBy == ReplanInitiator.USER && Duration.between(open.createdAt, now) < USER_GRACE -> PrepareSkip.OPEN_SESSION
        open.initiatedBy == ReplanInitiator.SYSTEM && open.targetDate < target && stalenessOf(accountId, open, now) == null ->
            PrepareSkip.EARLIER_OPEN
        else -> null
    }

    /**
     * 그 날짜의 준비된 대안 — 가장 최근 선계산 세션(닫힌 것 포함). 앱은 알림의 **날짜**로 묻는다(트리거에 세션을 매달지
     * 않는다 — 해제 뒤 다시 서면 트리거 id 가 바뀌어도 이어진다, CD11). 없거나 남의 여행이면 404(존재 은닉).
     */
    @Transactional(readOnly = true)
    fun findPrepared(accountId: UUID, tripId: UUID, date: LocalDate): ReplanSession {
        trips.findPeriod(accountId, tripId) ?: throw ResourceNotFound()
        return sessions.findLatestSystem(tripId, date) ?: throw ResourceNotFound("미리 준비한 대안이 없습니다.")
    }

    /** 응답용 — 세션과 낡음(BR-SA-19). 사용자 세션은 읽기 없이 늘 낡지 않음이다. */
    @Transactional(readOnly = true)
    fun view(accountId: UUID, session: ReplanSession): SessionView =
        SessionView(session, stalenessOf(accountId, session, clock.instant()) != null)

    /** 진입 판정 결과 — 시작과 선계산이 같은 값으로 세션을 연다. */
    private class Entry(
        val period: TripPeriod,
        val today: LocalDate,
        val itinerary: ItineraryRef,
        val targetDate: LocalDate,
        val scope: ReplanScope,
    )

    /**
     * 진입 검증(BR-SA-20) — 사용자 시작과 선계산이 **같은 규칙**을 쓴다. 갈라지면 선계산은 열리는데 같은 알림의 사용자 탭은
     * 막히거나(막다른 길) 그 반대가 된다.
     *
     * ① 트리거로 들어오면 대상 날짜는 **그 트리거의 날짜**이고 미래일이면 하루 전체다 — 구 앱(OTA 없음)이 내일 알림으로
     *   오늘을 다시 짜는 길을 서버가 막는다(그 적용은 내일 트리거를 소비하지도 못한다 — 날짜가 다르다). 트리거가 없거나
     *   다른 여행 것이면 409.
     * ② 여행 기간 밖이면 409 — 단 전날 창([preTripEntry])만 연다.
     */
    private fun resolveEntry(
        accountId: UUID,
        tripId: UUID,
        triggerId: UUID?,
        requestedDate: LocalDate?,
        requestedScope: ReplanScope,
        now: Instant,
    ): Entry {
        val period = trips.findPeriod(accountId, tripId) ?: throw ResourceNotFound() // 소유·존재(404 은닉)
        val today = LocalDate.ofInstant(now, TRAVEL_ZONE)
        val triggerDate = triggerId?.let { id ->
            (triggers.find(tripId, id) ?: throw ConflictDetected(message = "재계획 근거 알림을 찾을 수 없습니다.")).affectedDate
        }
        val requested = triggerDate ?: requestedDate ?: today
        val scope = if (triggerDate != null && requested > today) ReplanScope.FULL_DAY else requestedScope
        if (today < period.startDate || today > period.endDate) {
            if (!preTripWindowOpen(period, today)) throw ConflictDetected(message = "여행 기간에만 재계획할 수 있습니다.")
            if (!preTripEntry(period, today, triggerDate != null, requested, scope)) throw ConflictDetected(message = PRE_TRIP_ONLY)
        }
        // 다시 짤 일정이 있어야 재계획이다. 없으면 그건 '생성'이지 재계획이 아니다.
        val itinerary = itineraries.findCurrent(accountId, tripId)
            ?: throw ResourceNotFound("생성된 일정이 없습니다.")
        return Entry(period, today, itinerary, resolveTargetDate(requested, scope, today, period.endDate, itinerary.dates), scope)
    }

    /** 전날 창이 열려 있는가 — 지평 pre-trip ∧ 오늘 = 시작 − 1(DEC-SA-7 — 스윕의 전날 점검과 같은 스위치다). */
    private fun preTripWindowOpen(period: TripPeriod, today: LocalDate): Boolean =
        properties.horizon == ReplanHorizon.PRE_TRIP && today == period.startDate.minusDays(1)

    /**
     * 전날 창이 받는 것(BR-SA-20 ②③) — **알림으로 들어온 첫날 하루 전체**뿐이다. 진입과 적용이 같은 조건을 본다.
     * 트리거 없는 진입은 여행 구간 안에서만이다 — 여행 전 확정 일정은 복원이 409 라 되돌릴 수 없다(INV-U3-04).
     */
    private fun preTripEntry(period: TripPeriod, today: LocalDate, fromTrigger: Boolean, target: LocalDate, scope: ReplanScope) =
        preTripWindowOpen(period, today) && fromTrigger && target == period.startDate && scope == ReplanScope.FULL_DAY

    /**
     * 기준점 사다리(BR-U4-19) — 위치를 못 잡았어도 **막지 않는다**, 사다리를 내려가 가정을 밝힌다.
     * 사다리 3단(마지막 완료 방문지)은 방문 실적 도착으로 채워지고, 좌표는 POI 정본에서 얻는다 — 실적은 poiId 만 들고 있다.
     * 미래일을 다시 짤 때는 **지금 서 있는 좌표를 쓰지 않는다** — 그 날의 출발지는 그 날 거점이다. 오늘 좌표를 그대로
     * 실으면 AI 가 모레 하루를 오늘 있던 동네에 매단다.
     */
    private fun originFor(entry: Entry, tripId: UUID, requested: ReplanOrigin?): ReplanOrigin {
        // 정본에서 사라진 POI 면 null 이 되고 사다리가 다음 단으로 내려간다.
        val lastVisit = archive.findLastCompletedPoi(tripId)
            ?.let { poiSurfaces.findSurfaces(listOf(it))[it] }
        val sameDay = entry.targetDate == entry.today
        return origins.resolve(
            tripId, entry.period.startDate, entry.period.endDate, entry.targetDate,
            requested = requested?.takeIf { sameDay },
            lastVisitLat = lastVisit?.lat?.takeIf { sameDay },
            lastVisitLng = lastVisit?.lng?.takeIf { sameDay },
        )
    }

    /**
     * 낡음(BR-SA-19) — 선계산 초안이면 그 날의 사실(지금 일정·완료 실적)을 모아 판정한다. 사용자 세션은 읽지 않고 null.
     * '바뀐 슬롯'은 전후 비교와 같은 판정이다([DraftFacts.of]) — 화면의 비교와 거절이 다른 말을 하지 않게.
     */
    private fun stalenessOf(accountId: UUID, session: ReplanSession, now: Instant): Staleness? {
        if (session.initiatedBy != ReplanInitiator.SYSTEM) return null
        val facts = session.draft?.takeIf { session.status == ReplanStatus.DRAFT }?.let { raw ->
            val draft = ReplanProposal.fromMap(raw)
            val before = plans.findPlanSlots(accountId, session.tripId)
                .filter { it.date == session.targetDate }
                .map { ReplanDiff.SlotView(it.slotKey, it.startAt, it.endAt, it.isFixed, it.endsNextDay) }
            val after = draft.slots.map {
                ReplanDiff.SlotView("${draft.date}#${it.poiId}", it.startAt, it.endAt, it.isFixed, it.endsNextDay)
            }
            DraftFacts.of(session.targetDate, before, after, archive.getCompletedSlots(session.tripId))
        } ?: DraftFacts.NONE
        return session.stalenessAt(now, facts)
    }

    /**
     * 다시 짤 일자를 정한다(TRIP-1182). **생략하면 오늘** — 종전 동작이 기본값이다.
     *
     * 네 가지를 막는다. 막지 않으면 사용자에게 보이는 결과가 각각 다르다:
     * - **지난 날** — 이미 다녀온 하루를 덮어쓴다. 실적(archive)과 계획이 어긋나고 되돌릴 근거가 없다
     * - **기간 밖** — 거점·커버리지가 없는 날이라 AI 가 매달 곳이 없다(진입 가드와 같은 취지)
     * - **일정에 없는 날** — 부분 생성(`PARTIAL`)은 1일차만 있다. 통과시키면 AI 25초를 태운 뒤
     *   **확정에서야** "그 사이 일정이 바뀌었습니다"가 나온다(실제 원인과 다른 문구다)
     * - **미래일 + `지금 이후`** — 그 날의 '지금'은 없다. 통과시키면 다른 날의 벽시계로 슬롯이 잠겨
     *   하루 절반이 그대로 남는다([com.trippilot.itinerarygeneration.api.ReplanCommand] 의 잠금 판정)
     *
     * **생략 경로에도 같은 가드를 적용한다.** `?: return today` 로 빠져나가면 같은 의도가 필드 유무로
     * 갈린다 — 1차 생성만 끝난(`PARTIAL`) 일정은 1일차만 있어 **오늘이 일정에 없을 수 있고**, 그때
     * 생략 경로는 통과해 AI 25초를 태운 뒤 확정에서 "그 사이 일정이 바뀌었습니다"로 막힌다(막다른 길).
     * 같은 상태에서 오늘을 **명시**하면 진입에서 즉시 409 였다. 지금은 둘 다 409 다.
     */
    private fun resolveTargetDate(
        target: LocalDate,
        scope: ReplanScope,
        today: LocalDate,
        tripEnd: LocalDate,
        itineraryDates: List<LocalDate>,
    ): LocalDate {
        if (target < today) throw ConflictDetected(message = "지난 날짜는 다시 짤 수 없습니다.")
        if (target > tripEnd) throw ConflictDetected(message = "여행 기간 안의 날짜만 다시 짤 수 있습니다.")
        if (target !in itineraryDates) throw ConflictDetected(message = "그 날짜의 일정이 아직 없습니다.")
        if (target > today && scope != ReplanScope.FULL_DAY) {
            throw ValidationFailed(
                listOf(FieldError("scope", "오늘이 아닌 날짜는 하루 전체(FULL_DAY)로만 다시 짤 수 있습니다.")),
            )
        }
        return target
    }

    /**
     * 위치 동의(L2) 철회 파기(TRIP-992 · INV-L4) — 저장된 GPS·MANUAL 기준점 좌표를 지우고
     * 파기 사실을 남긴다. 지울 것이 0건이면 로그도 없다 — 확인자료가 "지운 적 없는 파기"를 말하면 안 된다.
     * 멱등: 두 번 배달돼도(at-least-once) 두 번째는 0건이라 기록이 부풀지 않는다.
     */
    @Transactional
    fun purgeOriginCoordinates(accountId: UUID): Int {
        val purged = sessions.purgeOrigins(purgeScope.findAllTripIdsOf(accountId))
        if (purged > 0) legalLogs.recordPurge(accountId, LocationPurgeScope.REPLAN_ORIGIN, purged)
        return purged
    }

    /**
     * `i18` [확정] — **일정이 바뀌는 유일한 지점**이다(INV-U4-05 · INV-SA-1 — 선계산 초안도 여기를 지난다).
     * 반영 후에는 세션을 닫아 같은 초안이 두 번 반영되지 않게 한다.
     *
     * 선계산 초안이 낡았으면(BR-SA-19) 409 `EXPIRED`·`STALE` 로 거절한다(INV-SA-7) — 시각을 다시 추정해 옮기지 않는다
     * (DEC-U4-9). 앱이 같은 입력으로 새로 계산한다. 여행 전이면 전날 창의 진입만 반영한다(BR-SA-20 ③).
     */
    @Transactional
    fun apply(accountId: UUID, tripId: UUID, sessionId: UUID): ReplanSession {
        val session = owned(accountId, tripId, sessionId, sessions::findByIdForUpdate)
        val now = clock.instant()
        stalenessOf(accountId, session, now)?.let { staleness ->
            log.info("replan.prepared outcome=REFUSED staleness={} tripId={} session={}", staleness, tripId, sessionId)
            throw when (staleness) {
                Staleness.EXPIRED -> ConflictDetected(message = "시간이 지나 이 대안은 지금 일정과 맞지 않아요.", errorCode = ErrorCode.EXPIRED)
                Staleness.STALE -> ConflictDetected(message = "그 사이 일정이 바뀌어 이 대안은 쓸 수 없어요.", errorCode = ErrorCode.STALE)
            }
        }
        if (session.status != ReplanStatus.DRAFT) {
            throw ConflictDetected(message = "확정할 재계획안이 없습니다.")
        }
        val draft = session.draft ?: throw ConflictDetected(message = "재계획안이 비어 있습니다.")
        // 여행 전 반영 가드 — 일정 쪽 적용에는 여행 전 확정 일정 가드가 없다(TRIP-999 — 세션이 여행 중에만 열린다는 전제였다).
        // 전날 창이 그 전제를 넓히므로 여기서 막는다. 확정 일정은 복원이 409 라 되돌릴 수 없다(INV-U3-04).
        val period = trips.findPeriod(accountId, tripId) ?: throw ResourceNotFound()
        val today = LocalDate.ofInstant(now, TRAVEL_ZONE)
        if (today < period.startDate && !preTripEntry(period, today, session.triggerId != null, session.targetDate, session.scope)) {
            throw ConflictDetected(message = PRE_TRIP_ONLY)
        }
        replans.apply(accountId, tripId, ReplanProposal.fromMap(draft), changeReason(session))
        val applied = sessions.save(session.applied(now))
        events.publish(
            ItineraryRecalculated(
                tripId.toString(), sessionId.toString(),
                // 근거 트리거와 다시 짠 날 — C9 가 날짜가 맞을 때만 그 트리거를 소비한다(다른 날 재계획이 닫지 않게).
                triggerId = session.triggerId?.toString(),
                targetDate = session.targetDate.toString(),
            ),
        )
        if (session.initiatedBy == ReplanInitiator.SYSTEM) {
            log.info("replan.prepared outcome=APPLIED tripId={} session={}", tripId, sessionId)
        }
        return applied
    }

    /**
     * 이력의 `reason` 한 줄(BR-U4-31) — 진입 경로 + 사유 + 방향 지시어 + 자유입력을 ` · ` 로 잇는다.
     * 예: `자동 감지 · 비 예보 · 실내로`.
     *
     * **비워서 넘기지 않는다.** 사유·지시어를 하나도 안 고른 수동 진입이면 최소한 "여행 중 재계획"이라도 남긴다 —
     * 빈 칸은 이력을 열었을 때 "왜 바꿨는지"를 되짚을 근거를 없앤다(US-PLANB-09 의 목적 자체).
     *
     * 트리거 **요약**(예: `날씨(비 예보 70%)`)까지는 싣지 않는다 — 그 문구는 C9(planb-detection) 소유이고, C10 이 C9 에서
     * 읽는 것은 진입 날짜 강제용 사실(`TriggerLookupFacade` — kind·상태·날짜)뿐이다. 자동 진입이라는 사실만 `triggerId`
     * 유무로 남긴다(정본 §7 대비 축약 — 문구가 필요해지면 그때 그 계약을 넓힌다).
     */
    private fun changeReason(session: ReplanSession): String {
        val parts = buildList {
            if (session.triggerId != null) add("자동 감지")
            addAll(session.reasons)
            addAll(session.directives)
            session.freeText?.takeIf { it.isNotBlank() }?.let { add(it.trim()) }
        }.filter { it.isNotBlank() }
        return parts.joinToString(REASON_SEPARATOR).ifBlank { DEFAULT_REASON }.take(REASON_MAX)
    }

    @Transactional(readOnly = true)
    fun get(accountId: UUID, tripId: UUID, sessionId: UUID): ReplanSession = owned(accountId, tripId, sessionId, sessions::findById)

    /**
     * 내 여행의 세션. 상태를 바꾸는 쪽(확정·취소)은 [ReplanSessionRepository.findByIdForUpdate] 로 **잠가 읽는다** — 선계산·재진입이
     * 같은 세션을 닫는 것과 직렬화한다. 잠금 없이 읽으면 나중에 쓴 쪽이 이겨, 닫힌 세션이 APPLIED 로 되살아나고 일정이 반영된다
     * (그 옆에는 반영 전 일정으로 짠 새 선계산이 열려 있다).
     */
    private fun owned(accountId: UUID, tripId: UUID, sessionId: UUID, read: (UUID) -> ReplanSession?): ReplanSession {
        trips.findPeriod(accountId, tripId) ?: throw ResourceNotFound()
        // 세션을 **여행 범위로 좁혀** 찾는다 — id 만으로 찾으면 남의 여행 세션을 들여다볼 수 있다.
        return read(sessionId)?.takeIf { it.tripId == tripId }
            ?: throw ResourceNotFound("재계획 세션을 찾을 수 없습니다.")
    }

    /** `i18` [취소] — 세션만 닫는다. 원 일정은 건드리지 않는다(INV-U4-05). */
    @Transactional
    fun cancel(accountId: UUID, tripId: UUID, sessionId: UUID): ReplanSession {
        val session = owned(accountId, tripId, sessionId, sessions::findByIdForUpdate)
        if (!session.isOpen) throw ConflictDetected(message = "이미 끝난 재계획입니다.")
        return sessions.save(session.canceled(clock.instant()))
    }

    /** 트랜잭션이 없으면(테스트 등) 그 자리에서 실행 — 결정론을 잃지 않는다. */
    private fun afterCommit(action: () -> Unit) {
        if (!TransactionSynchronizationManager.isSynchronizationActive()) return action()
        TransactionSynchronizationManager.registerSynchronization(
            object : TransactionSynchronization {
                override fun afterCommit() = action()
            },
        )
    }

    private companion object {
        /** 저장 시 수집 로그 대상 — 사용자 유래 좌표만(서버 사다리 유도는 수집이 아니다). */
        private val COORD_COLLECTED = setOf(OriginKind.GPS, OriginKind.MANUAL)

        private val log = LoggerFactory.getLogger(ReplanSessionService::class.java)

        /** 여행 "오늘"은 사용자가 있는 곳의 날짜지, 서버 UTC 날짜가 아니다. */
        private val TRAVEL_ZONE: ZoneId = ZoneId.of("Asia/Seoul")

        private const val REASON_SEPARATOR = " · "

        /** 사유·지시어를 하나도 안 고른 수동 진입의 최소 문구 — 빈 칸으로 남기지 않는다(BR-U4-31). */
        private const val DEFAULT_REASON = "여행 중 재계획"

        /** `change_log_entry.reason` 은 varchar(500) — 넘치면 저장이 통째로 실패한다(자유입력이 길 수 있다). */
        private const val REASON_MAX = 500

        /** 전날 창 밖의 여행 전 진입·적용(BR-SA-20 ②③). */
        private const val PRE_TRIP_ONLY = "여행 전날에는 알림으로 받은 첫날 일정만 다시 짤 수 있어요."

        /** 선계산 하루 상한(O-SA-10 초기값) — 여행당·전체. 실제로 연 세션만 센다. */
        private const val TRIP_DAILY_CAP = 3
        private const val GLOBAL_DAILY_CAP = 100

        /** 이 안에 연 사용자 세션은 선계산이 닫지 않는다 — 사용자가 보는 중이다(INV-SA-6). 지나면 방치로 본다. */
        private val USER_GRACE: Duration = Duration.ofMinutes(30)
    }
}
