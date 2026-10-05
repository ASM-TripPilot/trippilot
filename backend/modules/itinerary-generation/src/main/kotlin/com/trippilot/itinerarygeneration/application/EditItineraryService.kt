package com.trippilot.itinerarygeneration.application

import com.trippilot.changelog.api.AppendChangeLog
import com.trippilot.changelog.api.ChangeLogFacade
import com.trippilot.changelog.api.ChangeSourceType
import com.trippilot.core.error.ConflictDetected
import com.trippilot.itinerarygeneration.domain.RevisionActor
import com.trippilot.itinerarygeneration.domain.RevisionKind
import com.trippilot.core.error.ResourceNotFound
import com.trippilot.itinerarygeneration.domain.DaySchedule
import com.trippilot.itinerarygeneration.domain.FreshnessMeta
import com.trippilot.itinerarygeneration.domain.GenerationState
import com.trippilot.itinerarygeneration.domain.Itinerary
import com.trippilot.itinerarygeneration.domain.ItineraryDay
import com.trippilot.itinerarygeneration.domain.ItineraryRepository
import com.trippilot.itinerarygeneration.domain.RejectedPoi
import com.trippilot.itinerarygeneration.domain.RejectionStore
import com.trippilot.itinerarygeneration.domain.ItineraryStatus
import com.trippilot.itinerarygeneration.domain.ScheduleAgentOutput
import com.trippilot.itinerarygeneration.domain.ScheduleAgentPort
import com.trippilot.itinerarygeneration.domain.SolveMode
import com.trippilot.itinerarygeneration.application.Revalidation.Companion.violations
import com.trippilot.itinerarygeneration.domain.Violation
import com.trippilot.itinerarygeneration.domain.VisitSlot
import com.trippilot.itinerarygeneration.domain.VisitSlotDisplay
import com.trippilot.placedata.api.PoiSnapshotFacade
import com.trippilot.trip.api.TripFacade
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Service
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.TransactionTemplate
import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.util.UUID

/** 편집 요청 — 전체 교체(사용자가 수정한 일자·슬롯 배열). 슬롯 순서 = 배열 순서. [reason] 은 선택(변경 이력에 남는다). */
data class EditItinerary(val days: List<EditDay>, val reason: String? = null)
data class EditDay(val date: LocalDate, val slots: List<EditSlot>)
data class EditSlot(
    val poiId: UUID,
    val startAt: LocalTime,
    val endAt: LocalTime,
    val isFixed: Boolean,
    val endsNextDay: Boolean, // 자정 넘김(HC4) — 전체 교체 편집이라 클라가 현행 값을 그대로 실어야 소실되지 않는다
)

/**
 * 일정 편집 + 재검증(C8 · US-SCHED-06·07). 편집은 **비차단** — solver.validate(HC1-4)로 위반을 찾아
 * has_violation 으로 표시하되 저장은 허용한다(변경 차단 아님, ADR-0011). CONFIRMED 는 **여행 시작 전**만
 * 409 다(TRIP-999 결정 (a) · BR-U3-28 개정) — 여행 중에는 확정 일정도 이 경로로 고친다.
 * 위반 **내용**(type/detail) 실판정은 실 AI(TRIP-229); 현재 Fake validate 는 빈 목록 → 위반 없음으로 흐름 검증.
 */
@Service
class EditItineraryService(
    private val trips: TripFacade,
    private val itineraries: ItineraryRepository,
    private val scheduleAgent: ScheduleAgentPort,
    private val revisions: ItineraryRevisionService,
    /** 여행 중 수동 편집의 변경 이력(BR-U4-30 MANUAL) — 재계획 반영과 같은 축. */
    private val changeLogs: ChangeLogFacade,
    /** 확정 일정 편집이 열리면서(TRIP-999) 새 슬롯 동결이 필요해졌다 — [ConfirmedSnapshots]. */
    private val poiSnapshots: PoiSnapshotFacade,
    transactionManager: PlatformTransactionManager,
    private val rejections: RejectionStore,
    private val clock: Clock,
) {
    private val tx = TransactionTemplate(transactionManager)

    fun edit(accountId: UUID, tripId: UUID, edit: EditItinerary): Itinerary {
        val period = trips.findPeriod(accountId, tripId) ?: throw ResourceNotFound() // 소유·존재(404 은닉)
        val current = itineraries.findByTrip(tripId).firstOrNull() ?: throw ResourceNotFound("생성된 일정이 없습니다.")
        // 확정 잠금은 **여행 시작 전**만이다(TRIP-999 결정 (a) · BR-U3-28 개정). 여행이 시작되면
        // 이 편집이 확정 일정을 직접 고치는 유일한 수단이라, 여기서 막으면 여행 중 일정 변경 수단이
        // 0 이 된다(QA #066 — FE 허브는 CONFIRMED 일정만 live 로 보낸다).
        if (current.status == ItineraryStatus.CONFIRMED && today() < period.startDate) {
            throw ConflictDetected(message = "확정된 일정은 수정할 수 없습니다.")
        }
        // 생성 중(PARTIAL) 편집은 **이미 만들어진 일자에 한해** 허용한다(TRIP-1000 — day1 조기 노출의
        // 취지가 "보고 고칠 수 있다"다, BR-U3-06). 유실 걱정("2차가 편집을 덮어쓴다")은 병합이
        // 트랜잭션 안 재읽기 + 조건부 쓰기라 성립하지 않는다 — 2차는 최신 상태에 나머지 일자를
        // **이어붙일 뿐** 기존 일자를 다시 만들지 않는다(SecondPhaseGenerator, 스펙으로 잠금).
        // 아직 없는 일자를 싣는 편집만 409 — 그 일자는 2차와 이 편집 중 누가 이겨야 하는지 정의가 없다.
        if (current.generationState == GenerationState.PARTIAL) {
            val existing = current.days.map { it.date }.toSet()
            if (edit.days.any { it.date !in existing }) {
                throw ConflictDetected(message = "일정 생성이 진행 중입니다. 완료 후 수정할 수 있습니다.")
            }
        }

        // 재검증(비차단) — 외부(ScheduleAgent) 호출은 트랜잭션 밖(DB 커넥션 안 물게, generate 와 동일). Fake 는 빈 목록.
        // AI 가 죽어도 편집은 막지 않는다. 대신 판정을 못 했으면 "위반 없음"이라 말하지 않는다(Revalidation 참고).
        val output = edit.toOutput(current.solveMode, current.isFallback, clock.instant())
        // 장소 구성이 바뀐 편집(교체·추가·삭제·순서)은 repair 로 시각·거리를 다시 받는다(2026-10-05 제보 — 교체 뒤
        // 이동 거리·시각이 옛 장소 기준에 머물렀다). BR-U3-13·14 의 [AI 자동 보정]을 이 경우 자동으로 적용한 것 —
        // 정본 개정 주석 참조. 시각만 바꾼 편집은 쌍이 그대로라 부르지 않는다(사용자 시각 존중).
        val repair = if (legsOf(current) != legsOf(edit)) attemptRepair(output, edit, tripId) else RepairAttempt.Skipped
        val verdict = when (repair) {
            is RepairAttempt.Used -> Revalidation.Judged(emptyList()) // 상대가 재검증을 통과시킨 값만 온다(INV-2)
            RepairAttempt.Failed -> Revalidation.Withheld // AI 불통 — 같은 상대를 validate 로 한 번 더 기다리지 않는다
            RepairAttempt.Skipped, RepairAttempt.Rejected -> Revalidation.attempt(scheduleAgent, output, tripId)
        }
        val flagged = reshape(current, edit, verdict, (repair as? RepairAttempt.Used)?.days)
        ViolationText.warnUnattached(verdict.violations(), flagged.days, tripId)
        return tx.execute {
            // 트랜잭션 안에서 다시 읽는다 — 위 재검증(외부 호출) 동안 다른 편집이 커밋됐으면 밖에서 읽은 값은 낡았다.
            val beforeWrite = itineraries.findByTrip(tripId).firstOrNull() ?: current
            // 편집 전 상태로 돌아갈 지점이 없으면 먼저 남긴다 — 첫 편집으로 원본이 사라지면 안 된다(INV-U3-08).
            revisions.ensureRestorePoint(beforeWrite)
            // 확정 일정이면 동결을 잇는다(INV-U1-03) — 편집은 전체 교체라 여기서 안 이으면
            // 시각 하나 바꾼 저장이 전 슬롯의 스냅숏 참조를 지운다. 새 장소는 지금 동결한다.
            val toSave = ConfirmedSnapshots.carry(flagged, beforeWrite) { poiId -> poiSnapshots.freeze(poiId)?.poiSnapshotId }
            val saved = itineraries.replaceForTrip(tripId, toSave)
            // 바뀐 게 없으면 쌓지 않는다 — 되돌리기 목록이 같은 버전으로 도배된다.
            // 위반 상태까지 포함해 비교한다(스냅숏 비교는 위반 변화를 못 본다).
            if (!ItineraryContent.sameAs(beforeWrite, saved)) {
                // 이력은 **같은 트랜잭션**에 — 일정만 바뀌고 이력이 빠지는 상태를 만들지 않는다(INV-U3-06).
                revisions.record(saved, RevisionActor.USER, RevisionKind.EDIT, edit.reason ?: "일정을 직접 수정함")
                // 여행 중 수동 편집은 변경 이력 1행(BR-U4-30 MANUAL) — 재계획 반영(PLAN_B)과 같은 축이다.
                // 여행 전 편집은 이 축의 대상이 아니다(그쪽 기록은 리비전 h36 이 담당한다).
                if (today() >= period.startDate) {
                    changeLogs.append(
                        AppendChangeLog(
                            tripId = tripId,
                            actor = accountId.toString(),
                            sourceType = ChangeSourceType.MANUAL,
                            reason = edit.reason ?: "일정을 직접 수정함", // BR-U4-31 — 비워 두지 않는다
                            before = beforeWrite.toChangeLogSnapshot(),
                            after = saved.toChangeLogSnapshot(),
                        ),
                    )
                }
            }
            // 빠진 POI = 거절(TRIP-964). 사용자가 그 자리를 보고 바꾼 것이라 가장 명확한 신호다.
            // **같은 트랜잭션이어야 한다** — 편집이 롤백되면 거절도 남으면 안 된다(없던 편집을 기억하게 된다).
            // 시간만 바꾼 편집은 집합 차가 공집합이라 아무것도 안 쌓인다.
            val removed = beforeWrite.days.flatMap { d -> d.slots.map { it.sourcePoiId } }.toSet() -
                saved.days.flatMap { d -> d.slots.map { it.sourcePoiId } }.toSet()
            rejections.record(tripId, removed, RejectedPoi.Kind.SWAPPED_OUT)
            saved
        }!!
    }

    /** 여행지 기준 오늘(KST) — 러너 기본 존(UTC)으로 재면 하루가 어긋난다(verify-gates 실측). */
    private fun today(): LocalDate = LocalDate.ofInstant(clock.instant(), TRAVEL_ZONE)

    private companion object {
        /** 국내 전용이라 고정(GenerateItineraryService 와 같은 값). */
        private val TRAVEL_ZONE: ZoneId = ZoneId.of("Asia/Seoul")
        private val log = LoggerFactory.getLogger(EditItineraryService::class.java)
    }

    private sealed interface RepairAttempt {
        data object Skipped : RepairAttempt
        data object Failed : RepairAttempt
        data object Rejected : RepairAttempt
        data class Used(val days: List<DaySchedule>) : RepairAttempt
    }

    /**
     * 수리 결과를 쓸 수 있는가 — **장소·순서·고정 슬롯 시각이 편집 그대로일 때만**. 상대 repair 는 TIME_SHIFT_ONLY
     * (POI·순서 불변)라 정상이면 늘 통과하지만, 사용자의 선택을 바꿔치기한 결과가 오면 종전 validate 로 떨어진다.
     */
    private fun attemptRepair(output: ScheduleAgentOutput, edit: EditItinerary, tripId: UUID): RepairAttempt {
        val result = runCatching { scheduleAgent.repair(output, emptyList()) }.getOrElse { e ->
            log.warn("편집 보정(repair) 실패 — 판정 보류로 저장합니다. tripId={}", tripId, e)
            return RepairAttempt.Failed
        }
        if (result.unrepairable) return RepairAttempt.Rejected
        val days = result.repaired.days
        val keeps = days.map { it.date } == edit.days.map { it.date } &&
            days.zip(edit.days).all { (r, e) ->
                r.slots.map { it.poiId } == e.slots.map { it.poiId } &&
                    r.slots.zip(e.slots).all { (rs, es) -> !es.isFixed || (rs.startAt == es.startAt && rs.endAt == es.endAt) }
            }
        if (!keeps) {
            log.warn("편집 보정 결과가 장소·순서·고정을 바꿨습니다 — 쓰지 않고 재검증으로 갑니다. tripId={}", tripId)
            return RepairAttempt.Rejected
        }
        return RepairAttempt.Used(days)
    }

    private fun legsOf(it: Itinerary) = it.days.flatMap { d -> d.slots.mapIndexed { i, s -> Triple(d.date, d.slots.getOrNull(i - 1)?.sourcePoiId, s.sourcePoiId) } }.toSet()
    private fun legsOf(it: EditItinerary) = it.days.flatMap { d -> d.slots.mapIndexed { i, s -> Triple(d.date, d.slots.getOrNull(i - 1)?.poiId, s.poiId) } }.toSet()

    /**
     * 편집안 + 재검증 결과 → 새 일정 슬롯 배열(위반 슬롯 has_violation=true). identity·createdAt·solveMode 는 현행 보존.
     * [repaired] 가 있으면(장소 교체 편집의 수리 성공) 시각은 그 값(조립 검증값, INV-2), 쌍이 바뀐 구간의 거리도 그 값이다.
     */
    private fun reshape(current: Itinerary, edit: EditItinerary, verdict: Revalidation, repaired: List<DaySchedule>? = null): Itinerary {
        val violations = verdict.violations()
        // 판정 보류면 직전 표시를 잇는다 — 못 물어봤다고 해서 깨끗해진 것은 아니다.
        val prior = if (verdict is Revalidation.Withheld) PriorViolations(current) else null
        // 편집은 전체 교체라 클라이언트가 안 보내는 파생값(추천 근거)은 여기서 이어받지 않으면 사라진다.
        // 장소를 30분 옮겼다고 "왜 이 장소를 골랐는지"가 달라지지는 않으므로 (날짜, poiId) 로 맞춰 옮긴다.
        val reasonBySlot = current.days.flatMap { d -> d.slots.map { (d.date to it.sourcePoiId) to it.placementReason } }.toMap()
        // 거리 보존(TRIP-1002 결정 (a)). distanceRange 는 **직전 지점→이 슬롯** 구간 값이라
        // (날짜, 직전 POI, 이 POI) 쌍이 그대로면 편집 뒤에도 참이다 — 시각만 옮긴 저장이 전 구간
        // 거리를 지워 커넥터가 "이동 거리 계산 중"에 영구 고착됐다(QA #055·056: 재산출 경로가 없다 —
        // TRIP-309 의 validate/repair 응답에 거리 필드가 없음을 실측). 쌍이 바뀐 구간만 null 로 비운다:
        // 재산출은 여전히 상대(조립) 소유라 우리가 직선거리로 덧칠하지 않는다(INV-2).
        // (2026-10-05: 상대 repair 가 POI→POI 구간 거리를 채우게 됐다 — 장소 구성이 바뀐 편집은 그 값을 쓴다, edit() 참고.)
        val distanceByLeg = current.days.flatMap { d ->
            d.slots.mapIndexed { i, s ->
                Triple(d.date, d.slots.getOrNull(i - 1)?.sourcePoiId, s.sourcePoiId) to s.distanceRange
            }
        }.toMap()
        val days = edit.days.mapIndexed { dayIdx, d ->
            ItineraryDay.of(
                d.date, dayIdx,
                d.slots.mapIndexed { slotIdx, s ->
                    val hit = violations.filter { it.dayIndex == dayIdx && it.slotIndex == slotIdx }
                    val fixedUp = repaired?.get(dayIdx)?.slots?.get(slotIdx) // 순서 동일은 attemptRepair 가 보장
                    val leg = Triple(d.date, d.slots.getOrNull(slotIdx - 1)?.poiId, s.poiId)
                    VisitSlot.of(
                        s.poiId, null, slotIdx, fixedUp?.startAt ?: s.startAt, fixedUp?.endAt ?: s.endAt, s.isFixed,
                        hasViolation = if (prior != null) prior.flagOf(d.date, s.poiId) else hit.isNotEmpty(),
                        endsNextDay = s.endsNextDay,
                        // 안 바뀐 쌍은 저장된 값(생성 때의 수단 표기·첫 구간 앵커 거리)을 잇고, 비었거나 바뀐 쌍만 수리 응답 값이다.
                        // 수리 응답엔 앵커가 없어 그날 첫 구간이 바뀌면 여전히 null 이다(상대 와이어 한계).
                        distanceRange = distanceByLeg[leg] ?: fixedUp?.distanceRange,
                        placementReason = reasonBySlot[d.date to s.poiId],
                        // 저장 후에도 "무엇이 왜 문제인지"가 남아야 한다(BR-U3-13 지속 가시화).
                        violationReason = if (prior != null) prior.reasonOf(d.date, s.poiId, s.startAt, s.endAt) else ViolationText.reasonOf(hit),
                    )
                },
            )
        }
        return Itinerary.reconstitute(
            // 상태는 **보존**한다 — 여행 중 확정 일정 편집(TRIP-999 결정 (a))에서 PLANNED 로 적으면
            // 편집 한 번에 확정이 조용히 풀리고, FE 허브 판정(CONFIRMED 만 live)이 그 자리에서 끊긴다.
            current.itineraryId, current.tripId, current.status, current.solveMode, current.generationMode, current.isFallback,
            current.generationState, days, current.createdAt, clock.instant(), // 생성 진행 상태는 편집과 무관 — 보존
            current.candidatesSummary, // 후보 충분성도 편집과 무관 — 보존(빠뜨리면 편집 한 번에 영구 소실)
            // 미배치 보고도 보존한다. 사용자가 슬롯을 옮겼다고 "못 넣었던 곳"이 들어간 것은 아니다 —
            // 그 판정은 AI 가 다시 생성할 때만 바뀐다.
            current.unplacedMustVisits,
        )
    }

}

/** 편집안 → 재검증 입력(ScheduleAgentOutput). 시각·순서·고정은 슬롯 그대로. 거리/소요시간 없음(INV-3). */
private fun EditItinerary.toOutput(solveMode: SolveMode, isFallback: Boolean, at: Instant): ScheduleAgentOutput =
    ScheduleAgentOutput(
        days = days.map { d ->
            DaySchedule(
                d.date,
                d.slots.map { VisitSlotDisplay(it.poiId, it.startAt, it.endAt, it.endsNextDay, distanceRange = null, isFixed = it.isFixed) },
            )
        },
        day1ReadyAt = null,
        explanations = emptyMap(),
        solveMode = solveMode,
        isFallback = isFallback,
        freshness = FreshnessMeta(at, degraded = false),
    )
