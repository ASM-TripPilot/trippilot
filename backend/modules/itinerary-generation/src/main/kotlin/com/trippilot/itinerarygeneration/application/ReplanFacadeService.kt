package com.trippilot.itinerarygeneration.application

import com.trippilot.changelog.api.AppendChangeLog
import com.trippilot.changelog.api.ChangeLogFacade
import com.trippilot.changelog.api.ChangeSourceType
import com.trippilot.core.error.ConflictDetected
import com.trippilot.core.error.ResourceNotFound
import com.trippilot.itinerarygeneration.api.ReplanCommand
import com.trippilot.itinerarygeneration.api.ReplanFacade
import com.trippilot.itinerarygeneration.api.ReplanProposal
import com.trippilot.itinerarygeneration.api.ReplanSlot
import com.trippilot.itinerarygeneration.domain.FixedBlock
import com.trippilot.itinerarygeneration.domain.Itinerary
import com.trippilot.itinerarygeneration.domain.ItineraryDay
import com.trippilot.itinerarygeneration.domain.ItineraryRepository
import com.trippilot.itinerarygeneration.domain.RejectionStore
import com.trippilot.itinerarygeneration.domain.ItineraryStatus
import com.trippilot.itinerarygeneration.domain.ReplanInput
import com.trippilot.itinerarygeneration.domain.ReplanScope
import com.trippilot.itinerarygeneration.domain.RequestMeta
import com.trippilot.itinerarygeneration.domain.RevisionActor
import com.trippilot.itinerarygeneration.domain.RevisionKind
import com.trippilot.itinerarygeneration.domain.ScheduleAgentPort
import com.trippilot.itinerarygeneration.domain.VisitSlot
import com.trippilot.itinerarygeneration.domain.ScheduleAgentCallFailed
import com.trippilot.itinerarygeneration.domain.PersonalizationPort
import com.trippilot.itinerarygeneration.domain.ReplanCurrentSlot
import com.trippilot.itinerarygeneration.domain.SavedPlaceRef
import com.trippilot.placedata.api.PoiSnapshotFacade
import com.trippilot.placedata.api.SavedPlaceLookupFacade
import com.trippilot.profile.api.PreferenceFacade
import com.trippilot.savedaccommodation.api.BaseAnchorFacade
import com.trippilot.trip.api.TripFacade
import com.trippilot.trip.api.TripGenerationContext
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.Clock
import java.time.LocalTime
import java.time.ZoneId
import java.util.UUID

/**
 * [ReplanFacade] 구현 — AI 경계 호출과 일정 쓰기를 C8 안에 둔다.
 *
 * 세션·사용자 입력은 C10(재계획) 소유이고, 여기는 **"이 잠금으로 다시 짜고, 확정되면 반영한다"**만 한다.
 * 두 책임을 갈라 두는 이유는 INV-U4-05 다 — 확정 전 쓰기가 없다는 것을 보장하려면 쓰는 곳이 한 군데여야 한다.
 */
@Service
class ReplanFacadeService(
    private val trips: TripFacade,
    private val itineraries: ItineraryRepository,
    private val scheduleAgent: ScheduleAgentPort,
    private val baseAnchors: BaseAnchorFacade,
    private val revisions: ItineraryRevisionService,
    private val changeLogs: ChangeLogFacade,
    private val preferences: PreferenceFacade,
    private val personalization: PersonalizationPort,
    private val savedPlaces: SavedPlaceLookupFacade,
    private val regions: com.trippilot.placedata.api.RegionLookupFacade,
    private val rejectionStore: RejectionStore,
    /** 확정 일정에 반영이 열리면서(TRIP-999) 새 슬롯 동결이 필요해졌다 — [ConfirmedSnapshots]. */
    private val poiSnapshots: PoiSnapshotFacade,
    private val clock: Clock,
) : ReplanFacade {

    /** 산출은 **읽기 전용**이다 — 여기서 일정에 손대면 [취소]가 원상복구를 보장하지 못한다(INV-U4-05). */
    @Transactional(readOnly = true)
    override fun propose(command: ReplanCommand): ReplanProposal? {
        val current = ownedItinerary(command.accountId, command.tripId)
        // 목적지는 여행에서 얻는다 — 빈 목록으로 보내면 상대가 422 로 거부한다(실측).
        val ctx = trips.findGenerationContext(command.accountId, command.tripId) ?: throw ResourceNotFound()
        // 기준점이 없으면 상대가 후보 풀을 매달 곳이 없다 — 숙소 앵커로 채운다(BR-U4-19 사다리의 마지막 단).
        val origin = groundingPoint(command, ctx)
        // 취향은 생성 경로와 **같은 척도**로 만든다(PreferenceProfiles KDoc). §2 이탈 1건만 남는다:
        // 예산 등급을 trip.budget_total 변환 대신 preference_set.budget_tier(경계 계약 어휘)로.
        // 종전에는 원천도 이탈해 있었다 — trip.preference_snapshot 이 "클라이언트 자유 맵이라 타입
        // 보증이 없다"는 이유로 통째로 버려졌고, 그래서 **사용자가 여행에서 고른 취향이 양쪽 경로
        // 모두에서 반영되지 않았다**. 정제는 trip 모듈이 지고(TripPreferenceSnapshot) 여기서는 읽는다.
        // 두 경로가 다른 취향으로 돌면 "원래 자리보다 나은 것만 바꾼다"(§4) 비교가 성립하지 않는다.
        val prefs = preferences.findPreferences(command.accountId)
        val profile = prefs.toProfile(personalization.hintsFor(command.accountId), ctx.preferences)
        val output = scheduleAgent.replan(
            ReplanInput(
                tripId = command.tripId,
                itineraryId = current.itineraryId,
                scope = if (command.fullDay) ReplanScope.FULL_DAY else ReplanScope.PARTIAL_SLOTS,
                destinations = ctx.destinations,
                fromInstant = command.fromInstant,
                targetDate = command.targetDate,
                originLat = origin.first,
                originLng = origin.second,
                lockedBlocks = lockedBlocks(current, command),
                reasons = command.reasons,
                directives = command.directives,
                freeText = command.freeText,
                excludedPoiIds = command.excludedPoiIds,
                companionType = ctx.companionType,
                // 합성된 취향에서 집는다 — 생성 경로와 같은 이유로, 한 요청 안에서 예산이 갈리면 안 된다.
                budgetLevel = profile.budgetTier,
                preferenceProfile = profile,
                // 원 일정 슬롯 — KB-1 컨텍스트이자 후보 풀 합류 대상(§4). 대상 일자만.
                currentSlots = current.days.firstOrNull { it.date == command.targetDate }?.slots.orEmpty().map {
                    ReplanCurrentSlot(it.sourcePoiId, it.startAt, it.endAt, it.isFixed, it.endsNextDay, it.placementReason)
                },
                savedPlaces = this.savedPlaces.findSaved(command.accountId).map { SavedPlaceRef(it.poiId, it.nameKo) },
                // 거절 이력(TRIP-964). '다시 짜줘' 직후의 재계획이 정확히 이 이력의 소비처다 —
                // 방금 밀어낸 곳을 다시 제안하지 않게 하는 것이 저장의 목적이다.
                rejections = rejectionStore.findByTrip(command.tripId),
                requestMeta = RequestMeta(UUID.randomUUID().toString(), clock.instant(), REPLAN_DEADLINE_MS),
            ),
        )
        // **요청한 날짜만** 받는다. 다른 날을 돌려줬을 때 그것을 오늘 초안으로 삼으면, 확정 순간
        // 오늘 일정이 엉뚱한 날의 계획으로 덮인다(생성 경로에도 같은 취지의 가드가 있다).
        val day = output.days.firstOrNull { it.date == command.targetDate }
        // 잠긴 슬롯은 재해결 대상이 아니다 — 원본의 위반 표시(BR-U3-13)가 현실에 그대로 남으므로
        // 이어받는다(TRIP-839). 판정은 상대 에코(isFixed)가 아니라 **우리 잠금 집합**으로 한다 —
        // 잠금 규칙의 주인이 이쪽이다. 재배치된 슬롯은 어셈블리를 새로 통과했으니 위반 없음이 정당하다.
        // 짝은 (장소, 시작 시각)으로 짓는다 — 잠금은 원 시각 그대로 돌아온다(HC3). 장소만으로 지으면 같은 곳을
        // 하루 두 번 잠갔을 때(아침에 다녀옴 + 점심 예약) 둘째가 첫 슬롯의 위반 표시로 덮인다.
        val lockedByStart = lockedSlots(current, command).associateBy { it.sourcePoiId to it.startAt }
        val slots = day?.slots.orEmpty().map {
            val locked = lockedByStart[it.poiId to it.startAt]
            ReplanSlot(
                poiId = it.poiId, startAt = it.startAt, endAt = it.endAt, isFixed = it.isFixed,
                endsNextDay = it.endsNextDay, distanceRange = it.distanceRange,
                placementReason = output.explanations["${command.targetDate}#${it.poiId}"],
                hasViolation = locked?.hasViolation ?: false,
                violationReason = locked?.takeIf { l -> l.hasViolation }?.violationReason,
            )
        }
        // 빈 초안은 "해 없음"이다 — 빈 하루를 초안이라고 보여 주면 사용자가 그걸 확정한다.
        if (slots.isEmpty()) return null
        return ReplanProposal(current.itineraryId, command.targetDate, slots, output.totalDistanceKm)
    }

    /**
     * 후보 풀을 매달 좌표. 사다리: 현재 위치 → 그 날 숙소 앵커 → **그 날의 목적지 중심 → 첫 목적지 중심**(TRIP-963).
     *
     * 마지막 단은 생성 경로가 TRIP-384 에서 같은 문제를 푼 그 단이다(`GenerateItineraryService.dayAnchors`
     * 의 `RegionAnchors.centerOf` 폴백). 재계획에만 이 단이 없어서, 숙소 0·실적 0·GPS 0 인 사용자가
     * 재계획을 누르면 **AI 를 부르지도 않고 40ms 만에 FAILED** 였다(재현 세션 8e72c8e7) —
     * BR-U4-19 "위치를 못 잡았다고 재계획을 막지 않으며"와 모순이었다.
     *
     * **반드시 맨 뒤 단이어야 한다.** 도시 중심은 사용자가 실제로 서 있는 곳과 멀 수 있다 —
     * 실측·핀·숙소가 있으면 항상 그쪽이 이긴다.
     *
     * 목적지 좌표조차 없으면 **종전대로 실패**다(INV-4 — 조용히 빈 결과 대신 수동 편집으로).
     * 지어낸 좌표를 AI 에 보내지 않는다 — 생성 경로도 같은 판단이다(앵커 없이 간다).
     */
    private fun groundingPoint(command: ReplanCommand, ctx: TripGenerationContext): Pair<Double, Double> {
        command.originLat?.let { lat -> command.originLng?.let { lng -> return lat to lng } }
        baseAnchors.findStayNightAnchors(command.tripId, ctx.startDate, ctx.endDate)
            .firstOrNull { it.date == command.targetDate }
            ?.let { return it.lat to it.lng }
        // 그 날의 목적지 → 첫 목적지 — 생성 경로 `dayAnchors` 와 같은 사다리(PR #932). 첫 목적지로만 내려가면
        // "서울 1박 + 인천 1박"의 2일차 재계획이 서울에 매달린다.
        val dayDestination = RegionAnchors.destinationOn(ctx.destinationRefs, ctx.startDate, command.targetDate)
        (dayDestination?.let { RegionAnchors.centerOf(regions, it) }
            ?: ctx.destinationRefs.firstNotNullOfOrNull { RegionAnchors.centerOf(regions, it) })
            ?.let { return it.lat to it.lng }
        throw ScheduleAgentCallFailed(
            "NO_GROUNDING_POINT", retryable = false,
            message = "현재 위치도 숙소 거점도 목적지 중심도 없어 재계획 기준점을 정할 수 없습니다.",
        )
    }

    /**
     * 다시 짜도 그대로여야 하는 슬롯(INV-U4-04):
     * - **완료** — 이미 다녀왔다. 지우면 실적과 계획이 어긋난다(C10 이 알려 준다)
     * - **시각 고정** — 예약처럼 시각이 정해진 것(HC3)
     * - **시각상 끝난 슬롯** — '지금 이후만' 범위일 때. 오늘 전체를 다시 짜도 지나간 시각을 새로 채우지는 않는다
     *
     * '지금 이전'(INV-U4-04 · 정본 §3.1 "fromInstant 이전 슬롯")을 **끝난 슬롯**(`endAt <= now`)으로 읽는다 —
     * 시작 기준(`startAt < now`)이면 **진행 중인 슬롯**까지 잠긴다. 18:30 에 18:19–19:34 저녁이 잠기면 AI 는
     * 19:34 뒤 하루 창 끝(21:00)까지만 채울 수 있어 대개 "대안 없음"이었고(2026-10-04 실측 8건 중 4건),
     * 사유가 휴무·만석이면 바로 그 진행 중 장소를 바꿀 수 없었다. 풀어도 지난 시각은 새로 채워지지 않는다 —
     * AI 가 새 방문을 `from_instant` 이후에만 넣는다. 자정 넘김(`endsNextDay`)의 `endAt` 은 익일 시각이라
     * 끝난 것으로 보지 않는다.
     *
     * 잠금을 빠뜨리면 이미 다녀온 곳이 일정에서 사라지거나 예약 시각이 밀린다.
     */
    private fun lockedBlocks(current: Itinerary, command: ReplanCommand): List<FixedBlock> =
        // 시각을 함께 싣는다 — 시각 없는 고정 블록은 상대가 거부한다(계약 M1).
        lockedSlots(current, command)
            .map { FixedBlock(it.sourcePoiId, command.targetDate, it.startAt, dwellMinutes(it.startAt, it.endAt)) }

    /** 잠금 판정의 단일 지점 — 요청 블록과 위반 상속(TRIP-839)이 같은 집합을 봐야 한다. */
    private fun lockedSlots(current: Itinerary, command: ReplanCommand): List<VisitSlot> {
        val day = current.days.firstOrNull { it.date == command.targetDate } ?: return emptyList()
        val now = LocalTime.ofInstant(command.fromInstant, TRAVEL_ZONE)
        val completed = command.completedSlotKeys.toSet()
        return day.slots.filter {
            it.isFixed ||
                (!command.fullDay && !it.endsNextDay && it.endAt <= now) ||
                "${command.targetDate}#${it.sourcePoiId}" in completed
        }
    }

    /** 체류 분 — 자정 넘김이면 하루를 더한다(HC4). */
    private fun dwellMinutes(start: LocalTime, end: LocalTime): Int {
        val minutes = java.time.Duration.between(start, end).toMinutes()
        return (if (minutes < 0) minutes + MINUTES_PER_DAY else minutes).toInt()
    }

    /**
     * 초안을 일정에 반영 — **대상 일자만** 교체하고 나머지 일자는 손대지 않는다.
     * 되돌릴 지점을 먼저 남긴다(BR-U3-19) — 반영 후에 남기면 그 시점으로 못 돌아간다.
     */
    @Transactional
    override fun apply(accountId: UUID, tripId: UUID, proposal: ReplanProposal, reason: String) {
        val current = ownedItinerary(accountId, tripId)
        if (current.itineraryId != proposal.itineraryId) {
            // 그 사이 재생성으로 일정이 교체됐다 — 낡은 초안을 덮어쓰면 방금 만든 일정이 사라진다.
            throw ConflictDetected(message = "그 사이 일정이 바뀌었습니다. 다시 재계획해 주세요.")
        }
        // CONFIRMED 가드는 없다(TRIP-999 결정 (a), 2026-09-27) — 재계획 세션은 여행 기간 안에서만
        // 열리므로 여기 오는 확정 일정은 전부 "여행 중"이고, 그때 확정 잠금(BR-U3-28)은 여행 시작 전
        // 한정으로 개정됐다. 종전 가드는 산출(AI 20초)까지 다 하고 마지막에만 막아 여행 중 일정 변경
        // 수단이 0 이었다(QA #063).
        revisions.ensureRestorePoint(current)

        // 초안의 날짜가 일정에 없으면 **아무 일도 일어나지 않는다** — 조용히 통과시키면 바뀐 것 없이
        // "재계획 반영" 리비전만 쌓이고 사용자는 반영됐다고 믿는다.
        if (current.days.none { it.date == proposal.date }) {
            throw ConflictDetected(message = "그 사이 일정이 바뀌었습니다. 다시 재계획해 주세요.")
        }
        val replaced = current.days.map { day ->
            if (day.date != proposal.date) day else ItineraryDay.of(day.date, day.dayOrder, proposal.slots.toSlots())
        }
        val next = Itinerary.reconstitute(
            itineraryId = current.itineraryId, tripId = current.tripId, status = current.status,
            solveMode = current.solveMode, generationMode = current.generationMode, isFallback = current.isFallback,
            generationState = current.generationState, days = replaced,
            createdAt = current.createdAt, updatedAt = clock.instant(),
            candidatesSummary = current.candidatesSummary, unplacedMustVisits = current.unplacedMustVisits,
        )
        // 확정 일정이면 동결을 잇는다(INV-U1-03) — 유지 슬롯은 참조 승계, 새 슬롯은 지금 동결.
        val frozen = ConfirmedSnapshots.carry(next, current) { poiId -> poiSnapshots.freeze(poiId)?.poiSnapshotId }
        val saved = itineraries.replaceForTrip(tripId, frozen)
        revisions.record(saved, RevisionActor.AI, RevisionKind.EDIT, "여행 중 재계획 반영")
        // BR-U4-30 — 확정 시 이력 1행. **같은 트랜잭션**이라 일정만 바뀌고 이력이 빠지는 상태가 없다.
        // 리비전(되돌리기용 전체 스냅숏)과 역할이 다르다: 이쪽은 "무엇을 왜 바꿨나"를 사람이 읽는 기록이다.
        changeLogs.append(
            AppendChangeLog(
                tripId = tripId,
                actor = accountId.toString(),
                sourceType = ChangeSourceType.PLAN_B,
                reason = reason,
                before = current.toChangeLogSnapshot(),
                after = saved.toChangeLogSnapshot(),
            ),
        )
    }

    private fun List<ReplanSlot>.toSlots(): List<VisitSlot> = mapIndexed { i, s ->
        VisitSlot.of(
            sourcePoiId = s.poiId, poiSnapshotId = null, orderIndex = i,
            startAt = s.startAt, endAt = s.endAt, isFixed = s.isFixed, endsNextDay = s.endsNextDay,
            distanceRange = s.distanceRange, placementReason = s.placementReason,
            hasViolation = s.hasViolation, violationReason = s.violationReason,
        )
    }

    /** 소유·존재 검증(404 은닉). 일정이 없으면 재계획 대상 자체가 없다. */
    private fun ownedItinerary(accountId: UUID, tripId: UUID): Itinerary {
        trips.findPeriod(accountId, tripId) ?: throw ResourceNotFound()
        return itineraries.findByTrip(tripId).firstOrNull() ?: throw ResourceNotFound("일정이 없습니다.")
    }

    private companion object {
        /** 사용자가 화면에서 기다리는 동작이라 생성(20s)보다 짧게 잡는다. */
        /**
         * 재계획 마감(연동 설계 §6). 10초에서 올렸다 — 재계획은 생성보다 **입력이 많고**
         * (취향·동반·예산·사유·지시·원 일정) 상대가 그만큼 더 쓴다. 짧게 끊으면 폴백이 잦아지고,
         * 폴백은 거리순 정렬이라 "다시 짰는데 더 나빠졌다"로 보인다.
         *
         * 소켓 상한과는 무관하다 — 재계획은 생성용 클라이언트를 쓰고 그쪽 read 타임아웃이 훨씬 길다.
         */
        private const val REPLAN_DEADLINE_MS = 25_000L

        /** 여행 "지금"은 사용자가 있는 곳의 시각이다(서버 UTC 아님). */
        private val TRAVEL_ZONE: ZoneId = ZoneId.of("Asia/Seoul")
        private const val MINUTES_PER_DAY = 24 * 60L
    }
}
