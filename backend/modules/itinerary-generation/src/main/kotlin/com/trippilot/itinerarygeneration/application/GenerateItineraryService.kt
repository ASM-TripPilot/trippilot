package com.trippilot.itinerarygeneration.application

import com.trippilot.core.error.ResourceNotFound
import com.trippilot.core.event.DomainEventPublisher
import com.trippilot.itinerarygeneration.api.event.ItineraryGenerated
import com.trippilot.itinerarygeneration.domain.DayAnchor
import com.trippilot.itinerarygeneration.domain.FixedBlock
import com.trippilot.itinerarygeneration.domain.GenerationMode
import com.trippilot.itinerarygeneration.domain.GenerationState
import com.trippilot.itinerarygeneration.domain.Itinerary
import com.trippilot.itinerarygeneration.domain.ItineraryDay
import com.trippilot.itinerarygeneration.domain.ItineraryRepository
import com.trippilot.itinerarygeneration.domain.MinimalItineraryFallback
import com.trippilot.itinerarygeneration.domain.PreferenceProfile
import com.trippilot.itinerarygeneration.domain.RequestMeta
import com.trippilot.itinerarygeneration.domain.ScheduleAgentInput
import com.trippilot.itinerarygeneration.domain.ScheduleAgentOutput
import com.trippilot.itinerarygeneration.domain.ScheduleAgentPort
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
    transactionManager: PlatformTransactionManager,
    private val clock: Clock,
) {
    private val tx = TransactionTemplate(transactionManager)

    fun generate(accountId: UUID, tripId: UUID, mode: GenerationMode): Itinerary {
        val ctx = trips.findGenerationContext(accountId, tripId) ?: throw ResourceNotFound() // 소유·존재(404 은닉)
        val prefs = preferences.findPreferences(accountId)                                    // 취향 7축·예산등급(계정 스코프)
        // 소유·기간은 위에서 선검증 — 거점 앵커는 기간을 넘겨 조립(중복 trip 조회 없음).
        val stayAnchors = baseAnchors.findStayNightAnchors(tripId, ctx.startDate, ctx.endDate)
        val planDates = planDates(ctx.startDate, ctx.endDate)

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
        val firstInput = assembleInput(
            tripId, mode, ctx, prefs, stayAnchors, firstDates, DAY1_DEADLINE_MS,
            excluded = reservedForSecond,
            carriesUndatedFixed = remainingDates.isEmpty(), // 날짜 미지정 must_visit 은 2차가 맡는다(없으면 1차)
        )

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
        val saved = tx.execute {
            val it = itineraries.replaceForTrip(tripId, output.toItinerary(tripId, state, firstDates))
            events.publish(ItineraryGenerated(it.itineraryId.toString(), tripId.toString(), it.isFallback))
            it
        }!!

        if (remainingDates.isNotEmpty()) {
            // 1차에서 배정된 POI 는 2차 후보에서 제외(TRIP-293) — 같은 장소가 두 번 들어가지 않게.
            val assigned = saved.days.flatMap { d -> d.slots.map { it.sourcePoiId } }.distinct()
            val secondInput = assembleInput(
                tripId, mode, ctx, prefs, stayAnchors, remainingDates, TOTAL_DEADLINE_MS, excluded = assigned,
                carriesUndatedFixed = true,
            )
            // 2차가 고정 블록(HC3: 반드시 포함)으로 다시 싣는 POI 는 제외 목록에서 뺀다 —
            // 같은 POI 를 "반드시 넣어라 + 후보에서 빼라"로 동시에 주면 계약이 모순된다(INV-1 ↔ HC3).
            val fixedInSecond = secondInput.fixedBlocks.map { it.poiId }.toSet()
            secondPhase.completeRemaining(
                tripId, saved.itineraryId,
                secondInput.copy(excludedPoiIds = secondInput.excludedPoiIds.filterNot { it in fixedInSecond }),
            )
        }
        return saved
    }

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
    ): ScheduleAgentInput =
        ScheduleAgentInput(
            tripId = tripId,
            generationMode = mode,
            // budgetLevel(등급) = preference_set.budget_tier (경계 계약; trip.budget_total 아님)
            tripContext = TripContext(ctx.destinations, ctx.startDate, ctx.endDate, ctx.companionType, prefs.budgetTier),
            anchors = dayAnchors(ctx.startDate, ctx.endDate, stayAnchors).filter { it.date in dates },          // 이 호출이 맡은 일자의 거점 좌표
            timeWindows = dates.map { TimeWindow(it, DEFAULT_START, DEFAULT_END) },
            // must_visit → 고정 블록(HC3). 이 호출이 맡은 일자분만.
            // 날짜 미지정(ANYTIME)·여행 기간 밖 날짜는 **일자가 많은 쪽**(2차; 2차가 없으면 1차)에 싣는다 —
            // 하루짜리 1차에 전부 몰면 배치 공간이 없어 HC3 가 깨질 수 있고, 양쪽에 실으면 중복 배치된다.
            // 기간 밖 날짜를 버리지 않는 이유: 어느 단계에도 안 실으면 AI 가 실현 불가를 보고할 기회조차 없이
            // 백엔드가 조용히 삭제하게 된다(must_visit 등록은 기간을 검증하지 않는다).
            fixedBlocks = ctx.fixedVisits
                .filter { it.date in dates || (it.date !in planDates(ctx.startDate, ctx.endDate) && carriesUndatedFixed) }
                .map { FixedBlock(it.poiId, it.date, it.start, it.dwellMin) },
            preferenceProfile = prefs.toProfile(),                                                            // preference_snapshot 7축
            recommendationStrength = null,
            requestMeta = RequestMeta(UUID.randomUUID().toString(), clock.instant(), deadlineMs),
            excludedPoiIds = excluded,
        )

    /**
     * 계획일별 공간 앵커. 숙박일=확정 거점, 체크아웃일(endDate)=전날 거점(prev_stay).
     * 거점 미해결(GAP/OVERLAP)일은 앵커에서 제외(부분 목록) — 솔버가 앵커 없는 날을 폴백 처리.
     */
    private fun dayAnchors(startDate: LocalDate, endDate: LocalDate, stayAnchors: List<DayAnchorView>): List<DayAnchor> {
        val byDate = stayAnchors.associateBy { it.date }
        return planDates(startDate, endDate).mapNotNull { d ->
            val src = byDate[d] ?: if (d == endDate) byDate[d.minusDays(1)] else null // 체크아웃일만 전날 거점
            src?.let { DayAnchor(d, it.lat, it.lng) }
        }
    }

    /** 취향 스냅숏(profile.api) → ScheduleAgent 취향 프로필(7축). 미설정 축은 빈 목록/null 그대로. */
    private fun PreferenceSnapshot.toProfile(): PreferenceProfile =
        PreferenceProfile(styles, activities, foodTastes, transportModes, pace, companionTypes, petFriendly, budgetTier)

    /** 여행 날짜(체크인~체크아웃 각 날짜, 체크아웃일 포함). */
    private fun planDates(start: LocalDate, end: LocalDate): List<LocalDate> =
        generateSequence(start) { it.plusDays(1) }.takeWhile { !it.isAfter(end) }.toList()

    /** ScheduleAgentOutput → Itinerary 애그리거트. 시각·순서는 솔버 검증값만(INV-2). poi_snapshot 동결은 확정(272). */
    private fun ScheduleAgentOutput.toItinerary(tripId: UUID, state: GenerationState, dates: List<LocalDate>): Itinerary {
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
        return Itinerary.create(tripId, solveMode, isFallback, days, clock.instant(), state, candidatesSummary)
    }

    companion object {
        private val log = LoggerFactory.getLogger(GenerateItineraryService::class.java)
        private val DEFAULT_START = LocalTime.of(9, 0)
        private val DEFAULT_END = LocalTime.of(21, 0)
        private const val TOTAL_DEADLINE_MS = 20_000L
        private const val DAY1_DEADLINE_MS = 5_000L // day1 조기 노출 예산(IO-1)
    }
}
