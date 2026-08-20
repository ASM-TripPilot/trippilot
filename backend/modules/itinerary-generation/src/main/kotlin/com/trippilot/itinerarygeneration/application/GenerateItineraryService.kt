package com.trippilot.itinerarygeneration.application

import com.trippilot.core.error.ConflictDetected
import com.trippilot.core.error.ResourceNotFound
import com.trippilot.core.event.DomainEventPublisher
import com.trippilot.itinerarygeneration.api.event.ItineraryGenerated
import com.trippilot.placedata.api.RegionLookupFacade
import com.trippilot.itinerarygeneration.domain.DayAnchor
import com.trippilot.itinerarygeneration.domain.FixedBlock
import com.trippilot.itinerarygeneration.domain.GenerationMode
import com.trippilot.itinerarygeneration.domain.GenerationState
import com.trippilot.itinerarygeneration.domain.Itinerary
import com.trippilot.itinerarygeneration.domain.ItineraryDay
import com.trippilot.itinerarygeneration.domain.ItineraryRepository
import com.trippilot.itinerarygeneration.domain.MinimalItineraryFallback
import com.trippilot.itinerarygeneration.domain.RevisionActor
import com.trippilot.itinerarygeneration.domain.RevisionKind
import com.trippilot.itinerarygeneration.domain.PreferenceProfile
import com.trippilot.itinerarygeneration.domain.RequestMeta
import com.trippilot.itinerarygeneration.domain.ScheduleAgentInput
import com.trippilot.itinerarygeneration.domain.UnplacedMustVisit
import com.trippilot.itinerarygeneration.domain.ScheduleAgentOutput
import com.trippilot.itinerarygeneration.domain.ScheduleAgentPort
import com.trippilot.itinerarygeneration.domain.SolveMode
import com.trippilot.itinerarygeneration.domain.TimeWindow
import com.trippilot.itinerarygeneration.domain.TripContext
import com.trippilot.itinerarygeneration.domain.VisitSlot
import com.trippilot.profile.api.PreferenceFacade
import com.trippilot.profile.api.PreferenceSnapshot
import com.trippilot.savedaccommodation.api.BaseAnchorFacade
import com.trippilot.savedaccommodation.api.DayAnchorView
import com.trippilot.trip.api.TripFacade
import com.trippilot.trip.api.TripGenerationContext
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Service
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.TransactionTemplate
import java.time.Clock
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.util.UUID

/**
 * 일정 생성 오케스트레이션(C8 · US-SCHED-01).
 * 소유 여행의 날짜·목적지·동행·예산·필수방문지(must_visit)·취향(preference_snapshot 7축)·거점 앵커(trip_base)를
 * 조립해 ScheduleAgent를 호출하고 결과를 영속한다.
 */
@Service
class GenerateItineraryService(
    private val trips: TripFacade,
    private val preferences: PreferenceFacade,
    private val baseAnchors: BaseAnchorFacade,
    private val scheduleAgent: ScheduleAgentPort,
    private val itineraries: ItineraryRepository,
    private val events: DomainEventPublisher,
    private val secondPhase: SecondPhaseGenerator,
    private val genSessions: GenerationSessionService,
    private val revisions: ItineraryRevisionService,
    /** 숙소 없는 날의 앵커(TRIP-384) — 지역 대표 좌표. place-data.api 만 참조(R1). */
    private val regions: RegionLookupFacade,
    transactionManager: PlatformTransactionManager,
    private val clock: Clock,
) {
    private val tx = TransactionTemplate(transactionManager)

    fun generate(accountId: UUID, tripId: UUID, mode: GenerationMode): Itinerary {
        val ctx = trips.findGenerationContext(accountId, tripId) ?: throw ResourceNotFound() // 소유·존재(404 은닉)
        // **지킬 계획이 있을 때만 막는다.** 첫 생성(일정 없음)과 실패한 생성은 대상이 아니다 —
        // 여행 중에 "아직 일정이 없는데 지금 만들래"도, "생성이 깨졌으니 다시"도 정상 요구다.
        // 2차 생성이 중단되면 스위퍼가 FAILED 로 내리되 **행은 남기므로**, 이 구분이 없으면
        // 여행 중 사용자가 반쪽 일정에 갇힌다.
        val existing = previousOf(tripId)
        if (existing != null && existing.generationState != GenerationState.FAILED) {
            guardTripPeriod(ctx.startDate, ctx.endDate)
        }
        val prefs = preferences.findPreferences(accountId)                                    // 취향 7축·예산등급(계정 스코프)
        // 소유·기간은 위에서 선검증 — 거점 앵커는 기간을 넘겨 조립(중복 trip 조회 없음).
        val stayAnchors = baseAnchors.findStayNightAnchors(tripId, ctx.startDate, ctx.endDate)
        val planDates = planDates(ctx.startDate, ctx.endDate)

        // 직접 만들기는 AI 를 아예 부르지 않는다 — 빈 일자만 깔고 사용자가 편집으로 채운다(US-SCHED-09).
        // 상대 enum 에 MANUAL 이 없어 경계로 나가면 422 이므로, 여기서 갈라 아예 호출 경로에 들어가지 않게 한다.
        if (mode == GenerationMode.MANUAL) return createEmpty(tripId, ctx, planDates, previousOf(tripId))

        // day1 조기 노출(TRIP-267 · PR #104 합의): 1차는 첫날만 짧은 시한으로 풀어 즉시 반환하고,
        // 나머지 일자는 배정된 POI 를 제외 목록으로 넘겨 백그라운드 2차 호출로 채운다(AI 는 동기 REST 유지).
        val firstDates = planDates.take(1)
        val remainingDates = planDates.drop(1)
        // 2차가 고정 블록으로 배치할 must_visit 은 1차 후보에서 빼둔다 —
        // 안 그러면 1차가 그 POI 를 자유 슬롯으로 day1 에 넣고, 2차가 제 날짜에 또 넣어 같은 곳을 두 번 간다.
        val reservedForSecond = if (remainingDates.isEmpty()) {
            emptyList()
        } else {
            ctx.fixedVisits.filterNot { it.date in firstDates }.map { it.poiId }.distinct()
        }
        // 화면(h09·h10)이 단계·[취소]를 그릴 상태 원천을 연다(BR-U3-04·05).
        val session = genSessions.start(accountId, tripId, mode)

        // 재생성이라면 **직전 상태로 돌아갈 지점**이 반드시 있어야 한다(INV-U3-08 · BR-U3-19).
        val previous = previousOf(tripId)

        // 1차가 터지면 세션을 닫는다 — 안 닫으면 사용자는 500 을 받고도 화면에서 영원히 "생성 중"을 본다(INV-4 침묵 금지).
        val saved = try {
            val firstAssembly = assembleInput(
                tripId, mode, ctx, prefs, stayAnchors, firstDates, DAY1_DEADLINE_MS,
                excluded = reservedForSecond,
                carriesUndatedFixed = remainingDates.isEmpty(), // 날짜 미지정 must_visit 은 2차가 맡는다(없으면 1차)
            )
            val firstInput = firstAssembly.input

            // 외부(ScheduleAgent) 호출은 트랜잭션 밖 — DB 커넥션을 물지 않게.
            // INV-4: AI 실패 시 침묵 금지 — 결정론 최소 폴백(must_visit 고정블록)으로 대체하고 isFallback 로 표시.
            val output = try {
                scheduleAgent.generate(firstInput)
            } catch (e: Exception) {
                log.warn("ScheduleAgent 실패 — 결정론 최소 폴백 적용(INV-4). tripId={}", tripId, e)
                MinimalItineraryFallback.of(firstInput, clock.instant())
            }
            // 단일일 여행이면 1차로 끝 — 2차 없이 COMPLETE.
            val state = if (remainingDates.isEmpty()) GenerationState.COMPLETE else GenerationState.PARTIAL

            // 영속 + 생성이벤트(TRIP-230)를 한 트랜잭션으로 — confirm()과 대칭(향후 아웃박스 relay 원자성). 발행은 인프로세스.
            tx.execute {
                previous?.let { revisions.ensureRestorePoint(it) }
                val it = itineraries.replaceForTrip(tripId, output.toItinerary(tripId, mode, state, firstDates, firstAssembly.unplaced))
                events.publish(ItineraryGenerated(it.itineraryId.toString(), tripId.toString(), it.isFallback))
                // day1 이 나왔다 — 폴백 여부·후보 등급을 함께 실어 배너가 **첫 노출부터** 사실을 말하게 한다(BR-U3-11).
                genSessions.day1Ready(
                    session.sessionId, it.itineraryId,
                    isFallback = it.isFallback, candidatesLevel = it.candidatesSummary?.level,
                )
                // 리비전은 **생성이 끝난 상태**에서만 남긴다. 여기서 PARTIAL(day1만)을 남기면 그 스냅숏으로 되돌릴 때
                // 2차가 채운 나머지 일자가 통째로 사라진다 — 다일 여행은 2차 완료 시점에 남긴다(SecondPhaseGenerator).
                if (state == GenerationState.COMPLETE) {
                    revisions.record(it, RevisionActor.AI, kindFor(previous), summaryFor(previous))
                }
                it
            }!!
        } catch (e: Exception) {
            genSessions.failed(session.sessionId)
            throw e
        }

        if (remainingDates.isEmpty()) {
            // 하루 여행은 2차가 없다 — 여기서 닫지 않으면 세션이 DAY1_READY 로 영원히 남아 화면이 계속 폴링한다.
            genSessions.completed(session.sessionId, saved.isFallback, saved.candidatesSummary?.level)
        } else {
            // 1차에서 배정된 POI 는 2차 후보에서 제외(TRIP-293) — 같은 장소가 두 번 들어가지 않게.
            val assigned = saved.days.flatMap { d -> d.slots.map { it.sourcePoiId } }.distinct()
            val secondAssembly = assembleInput(
                tripId, mode, ctx, prefs, stayAnchors, remainingDates, TOTAL_DEADLINE_MS, excluded = assigned,
                carriesUndatedFixed = true,
            )
            val secondInput = secondAssembly.input
            // 2차가 고정 블록(HC3: 반드시 포함)으로 다시 싣는 POI 는 제외 목록에서 뺀다 —
            // 같은 POI 를 "반드시 넣어라 + 후보에서 빼라"로 동시에 주면 계약이 모순된다(INV-1 ↔ HC3).
            val fixedInSecond = secondInput.fixedBlocks.map { it.poiId }.toSet()
            secondPhase.completeRemaining(
                tripId, saved.itineraryId,
                secondInput.copy(excludedPoiIds = secondInput.excludedPoiIds.filterNot { it in fixedInSecond }),
                isRegeneration = previous != null,
                assemblyUnplaced = secondAssembly.unplaced,
                sessionId = session.sessionId,
            )
        }
        return saved
    }

    private fun previousOf(tripId: UUID) = itineraries.findByTrip(tripId).firstOrNull()

    /**
     * 빈 일정 — 일자만 있고 슬롯이 없다. AI 산출물이 아니므로 [SolveMode.MINIMAL]·`isFallback=false` 다
     * (폴백이 아니라 **사용자가 고른 방식**이다 — isFallback 을 켜면 화면이 "AI 실패"로 오해한다).
     */
    private fun createEmpty(
        tripId: UUID,
        ctx: TripGenerationContext,
        dates: List<LocalDate>,
        previous: Itinerary?,
    ): Itinerary = tx.execute {
        previous?.let { revisions.ensureRestorePoint(it) } // 전환 전 상태를 남긴다 — 진행분이 사라지지 않게
        val empty = Itinerary.create(
            tripId, SolveMode.MINIMAL, GenerationMode.MANUAL, isFallback = false,
            days = dates.mapIndexed { i, d -> ItineraryDay.of(d, i, emptyList()) },
            now = clock.instant(), generationState = GenerationState.COMPLETE, candidatesSummary = null,
        )
        val saved = itineraries.replaceForTrip(tripId, empty)
        events.publish(ItineraryGenerated(saved.itineraryId.toString(), tripId.toString(), saved.isFallback))
        revisions.record(
            saved, RevisionActor.USER,
            if (previous == null) RevisionKind.BASELINE else RevisionKind.GENERATE,
            "직접 만들기로 시작",
        )
        saved
    }!!

    /**
     * 조립 결과 — 요청과 **넣을 자리가 없어 보내지 못한 필수 방문지**를 함께 돌려준다.
     * 로그로만 남기면 사용자는 자기가 넣은 곳이 왜 없는지 끝내 알 수 없다(M2 채널로 이어붙인다).
     */
    private data class Assembled(val input: ScheduleAgentInput, val unplaced: List<UnplacedMustVisit>)

    /** 최초 생성이면 기준 버전(BASELINE), 재생성이면 GENERATE. */
    private fun kindFor(previous: Itinerary?) = if (previous == null) RevisionKind.BASELINE else RevisionKind.GENERATE
    private fun summaryFor(previous: Itinerary?) = if (previous == null) "AI가 처음 짠 일정" else "AI가 일정을 다시 짬"

    @Suppress("LongParameterList")
    private fun assembleInput(
        tripId: UUID,
        mode: GenerationMode,
        ctx: TripGenerationContext,
        prefs: PreferenceSnapshot,
        stayAnchors: List<DayAnchorView>,
        dates: List<LocalDate>,
        deadlineMs: Long,
        excluded: List<UUID> = emptyList(),
        carriesUndatedFixed: Boolean = true,
    ): Assembled {
        // ANYTIME(날짜·시각 미지정)을 여기서 **물질화**한다(계약 M1) — AI 고정 블록은 시간창이 필수라
        // null 을 담을 자리가 없고, 솔버가 날짜를 다시 고르지도 못한다. 넣을 자리가 없으면 보내지 않고
        // 미배치로 보고한다(M2 채널) — AI 가 거부할 모양을 보내 요청 전체를 죽이느니 낫다.
        val candidates = ctx.fixedVisits
            .filter { it.date in dates || (it.date !in planDates(ctx.startDate, ctx.endDate) && carriesUndatedFixed) }
            .map { FixedBlock(it.poiId, it.date, it.start, it.dwellMin) }
        val materialized = MustVisitMaterializer.materialize(
            dated = candidates.filter { it.date != null && it.start != null },
            anytime = candidates.filter { it.date == null || it.start == null },
            dates = dates,
            dayStart = DEFAULT_START,
            dayEnd = DEFAULT_END,
        )
        if (materialized.unplaced.isNotEmpty()) {
            log.info(
                "필수 방문지 {}건은 넣을 자리가 없어 보내지 않고 보고합니다(M1). tripId={}",
                materialized.unplaced.size, tripId,
            )
        }
        return Assembled(
            ScheduleAgentInput(
            tripId = tripId,
            generationMode = mode,
            // budgetLevel(등급) = preference_set.budget_tier (경계 계약; trip.budget_total 아님)
            tripContext = TripContext(ctx.destinations, ctx.startDate, ctx.endDate, ctx.companionType, prefs.budgetTier),
            anchors = dayAnchors(ctx.startDate, ctx.endDate, stayAnchors, ctx.destinations).filter { it.date in dates },          // 이 호출이 맡은 일자의 거점 좌표
            timeWindows = dates.map { TimeWindow(it, DEFAULT_START, DEFAULT_END) },
            // must_visit → 고정 블록(HC3). 이 호출이 맡은 일자분만.
            // 날짜 미지정(ANYTIME)·여행 기간 밖 날짜는 **일자가 많은 쪽**(2차; 2차가 없으면 1차)에 싣는다 —
            // 하루짜리 1차에 전부 몰면 배치 공간이 없어 HC3 가 깨질 수 있고, 양쪽에 실으면 중복 배치된다.
            //
            // ⚠ 예전 주석은 "기간 밖 날짜도 실어야 AI 가 실현 불가를 보고한다"고 적었는데 **그 보고는 나오지 않는다** —
            // AI 는 `problem.days` 에 없는 날짜의 고정 블록을 위반으로 세지 않고 스킵한다(그쪽 `constraints.py`).
            // 회신 필드(`unplaced_must_visits`)가 계약에 생겨야 성립한다(경계 계약 확정 문서 M2). 그때까지는
            // 침묵 드롭 위치가 백엔드에서 AI 로 옮겨간 상태일 뿐이다.
            fixedBlocks = materialized.fixedBlocks,
            preferenceProfile = prefs.toProfile(),                                                            // preference_snapshot 7축
            recommendationStrength = null,
            requestMeta = RequestMeta(UUID.randomUUID().toString(), clock.instant(), deadlineMs),
                excludedPoiIds = excluded,
            ),
            materialized.unplaced,
        )
    }

    /**
     * 계획일별 공간 앵커. 숙박일=확정 거점, 체크아웃일(endDate)=전날 거점(prev_stay).
     *
     * **거점이 없는 날은 목적지 중심으로 채운다**(TRIP-384). 예전에는 그런 날을 그냥 뺐는데, 숙소를
     * 하나도 등록하지 않은 여행은 앵커가 **전부** 비어 AI 가 요청 자체를 거절했다
     * (422 "anchors 최소 1개 필요"). 백엔드는 그 실패를 폴백으로 받지만 폴백은 must_visit 만으로
     * 일정을 만들므로, 필수 방문지가 없으면 **일정이 통째로 빈 채** 201 로 나갔다.
     *
     * 정본은 숙소 없는 생성을 허용한다(BR-U1-40 · BR-U1-47 · US-SCHED-11) — 계약이 그걸 막고 있었다.
     *
     * **다목적지의 날짜별 배정은 하지 않는다.** 목적지에 박수(nights)가 실려 오지 않아
     * (`TripGenerationContext.destinations` 는 이름 목록뿐) 어느 날이 어느 도시인지 알 수 없다.
     * 첫 목적지 중심을 쓴다 — 단일 목적지(대부분)는 정확하고, 다목적지는 거칠지만 앵커가 없는 것보다 낫다.
     */
    private fun dayAnchors(
        startDate: LocalDate,
        endDate: LocalDate,
        stayAnchors: List<DayAnchorView>,
        destinations: List<String>,
    ): List<DayAnchor> {
        val byDate = stayAnchors.associateBy { it.date }
        // 목적지 중심은 한 번만 조회한다 — 날짜마다 부르면 같은 값을 계획일 수만큼 다시 읽는다.
        val fallback = destinations.firstNotNullOfOrNull { regions.centerOf(it) }
        return planDates(startDate, endDate).mapNotNull { d ->
            val stay = byDate[d] ?: if (d == endDate) byDate[d.minusDays(1)] else null // 체크아웃일만 전날 거점
            when {
                stay != null -> DayAnchor(d, stay.lat, stay.lng)
                // 목적지 좌표조차 없으면 그 날은 앵커 없이 둔다 — 지어낸 좌표를 보내지 않는다.
                fallback != null -> DayAnchor(d, fallback.lat, fallback.lng)
                else -> null
            }
        }
    }

    /** 취향 스냅숏(profile.api) → ScheduleAgent 취향 프로필(7축). 미설정 축은 빈 목록/null 그대로. */
    private fun PreferenceSnapshot.toProfile(): PreferenceProfile =
        PreferenceProfile(styles, activities, foodTastes, transportModes, pace, companionTypes, petFriendly, budgetTier)

    /**
     * **재생성**이 허용되는 시점인가 — 기존 일정이 있을 때만 부른다(첫 생성은 대상이 아니다).
     *
     * 재생성은 기존 일정을 지우고 새로 만든다(`replaceForTrip`). 여행 중에 그러면 사용자가 따라가던 계획이
     * 통째로 갈리고, **방문 실적이 유령이 된다** — `visit_check` 는 `trip_id + slotKey` 로 남아 삭제를 견디므로
     * 일정에 없는 장소에 "방문 완료"가 남는다. 여행 중 계획 변경은 재계획(Plan-B)이 할 일이고, 그쪽은 오늘 하루만
     * 다시 짜면서 다녀온 슬롯을 잠근다(INV-U4-04). 끝난 여행은 다시 만들 이유 자체가 없다.
     *
     * **여행 상태(`TripStatus`)로 판정하지 않는 이유**: 여행은 `PLANNED` 로 생성된 뒤 전이되지 않는다 —
     * `canTransitionTo` 를 부르는 프로덕션 코드가 없다. 상태로 막으면 영원히 발화하지 않는 죽은 가드가 된다.
     * 이 리포가 "여행 중"을 판정하는 방식은 날짜다 — `ReplanSessionService`·`TriggerService` 가 같은 식을 쓴다.
     *
     * **확정(`CONFIRMED`) 일정은 막지 않는다.** 편집도 복원도 이미 409 라, 재생성까지 막으면 확정한 여행은
     * 손댈 방법이 하나도 없는 막다른 길이 된다. 확정 해제 API 가 생기기 전까지 재생성이 유일한 탈출구다.
     */
    private fun guardTripPeriod(startDate: LocalDate, endDate: LocalDate) {
        val today = LocalDate.ofInstant(clock.instant(), TRAVEL_ZONE)
        if (today > endDate) {
            throw ConflictDetected(message = "이미 끝난 여행은 일정을 다시 만들 수 없어요.")
        }
        if (today >= startDate) {
            throw ConflictDetected(message = "여행 중에는 일정을 다시 만들 수 없어요. 재계획으로 오늘 일정을 바꿔 주세요.")
        }
    }

    /** 여행 날짜(체크인~체크아웃 각 날짜, 체크아웃일 포함). */
    private fun planDates(start: LocalDate, end: LocalDate): List<LocalDate> =
        generateSequence(start) { it.plusDays(1) }.takeWhile { !it.isAfter(end) }.toList()

    /** ScheduleAgentOutput → Itinerary 애그리거트. 시각·순서는 솔버 검증값만(INV-2). poi_snapshot 동결은 확정(272). */
    private fun ScheduleAgentOutput.toItinerary(
        tripId: UUID,
        mode: GenerationMode,
        state: GenerationState,
        dates: List<LocalDate>,
        /** 조립 단계에서 자리를 못 찾아 **보내지도 못한** 것 — AI 보고와 합쳐 하나의 목록으로 낸다. */
        assemblyUnplaced: List<UnplacedMustVisit> = emptyList(),
    ): Itinerary {
        // 요청 일자에 맞춰 정렬 — 응답이 어긋나도 중복/누락 일자가 조용히 통과하지 못하게(외부 값 신뢰 금지).
        val days = DayReconciliation.alignTo(dates, this.days).mapIndexed { dayIdx, d ->
            ItineraryDay.of(
                d.date, dayIdx,
                d.slots.mapIndexed { slotIdx, s ->
                    VisitSlot.of(
                        s.poiId, null, slotIdx, s.startAt, s.endAt, s.isFixed,
                        endsNextDay = s.endsNextDay,
                        // AI 문자열은 컬럼 상한을 넘을 수 있다 — 자르지 않으면 22001 로 생성 전체가 롤백된다.
                        distanceRange = BoundedText.clamp(s.distanceRange, BoundedText.DISTANCE_RANGE_MAX),
                        // 추천 근거를 슬롯에 붙여 영속한다 — 안 붙이면 재조회에서 사라진다(BR-U2-04 영속 항).
                        placementReason = BoundedText.clamp(
                            explanations[SlotKey.of(d.date, s.poiId)], BoundedText.PLACEMENT_REASON_MAX,
                        ),
                    )
                },
            )
        }
        SlotKey.warnIfUnmatched(
            received = explanations.size,
            matched = days.sumOf { d -> d.slots.count { it.placementReason != null } },
            tripId = tripId,
        )
        // 못 넣은 필수 방문지 보고를 일정에 실어 영속한다 — 안 실으면 생성 직후 화면에만 보이고
        // 재조회하면 사라진다(candidates_summary 에서 겪은 것과 같은 유실).
        if (unplacedMustVisits.isNotEmpty()) {
            log.info(
                "필수 방문지 {}건을 넣지 못했습니다 — 사용자에게 사유와 함께 알립니다. tripId={} 사유={}",
                unplacedMustVisits.size, tripId, unplacedMustVisits.map { it.reasonCode },
            )
        }
        return Itinerary.create(
            tripId, solveMode, mode, isFallback, days, clock.instant(), state, candidatesSummary,
            assemblyUnplaced + unplacedMustVisits,
        )
    }

    companion object {
        private val log = LoggerFactory.getLogger(GenerateItineraryService::class.java)
        private val DEFAULT_START = LocalTime.of(9, 0)
        private val DEFAULT_END = LocalTime.of(21, 0)
        private const val TOTAL_DEADLINE_MS = 20_000L
        private const val DAY1_DEADLINE_MS = 5_000L // day1 조기 노출 예산(IO-1)

        /** 여행 "오늘"은 사용자가 있는 곳의 날짜다(서버 UTC 아님) — 재계획·감지와 같은 기준. */
        private val TRAVEL_ZONE: ZoneId = ZoneId.of("Asia/Seoul")
    }
}
