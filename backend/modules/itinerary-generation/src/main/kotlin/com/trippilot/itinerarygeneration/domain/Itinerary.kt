package com.trippilot.itinerarygeneration.domain

import com.trippilot.core.error.ConflictDetected
import com.trippilot.core.error.FieldError
import com.trippilot.core.error.ValidationFailed
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.util.UUID

/** 일정 상태. PLANNED→CONFIRMED 단방향(확정 후 읽기전용 잠금). */
enum class ItineraryStatus { PLANNED, CONFIRMED }

/**
 * 솔버 산출 방식. AI 실패 시 폴백 단계 표시(INV-4).
 * **품질 높은 순으로 선언**(뒤일수록 저하) — 2단계 생성이 두 호출의 등급을 합칠 때 이 순서를 쓴다.
 */
enum class SolveMode { FULL_AI, DETERMINISTIC, MINIMAL }

/**
 * 생성 진행 상태 — day1 조기 노출(2단계 호출) 대비 계약. 확정 상태([ItineraryStatus])와는 **다른 축**.
 * PARTIAL=1차(day1)만 채워짐 · COMPLETE=전 일자 완료 · FAILED=2차 결과 반영 실패(1차분은 유효).
 * PARTIAL 인 동안 확정·편집은 409 — 2차 결과가 사용자의 변경을 덮어쓰지 못하게 한다.
 */
enum class GenerationState { PARTIAL, COMPLETE, FAILED }

/**
 * 방문 슬롯 — 솔버가 검증한 시각·순서만 담는다(INV-2). **소요시간(duration) 필드 없음(INV-3, 타입으로 보장)** — 거리만 표시.
 * [poiSnapshotId]는 확정 시 동결(INV-U1-03) — PLANNED 동안 null; [sourcePoiId](생성 시점 POI)는 항상 존재.
 */
class VisitSlot private constructor(
    val sourcePoiId: UUID,
    val poiSnapshotId: UUID?,
    val orderIndex: Int,
    val startAt: LocalTime,
    val endAt: LocalTime,
    val isFixed: Boolean,
    val hasViolation: Boolean,
    val endsNextDay: Boolean,   // 자정 넘김(HC4) — true 면 endAt(익일 시각) < startAt 허용
    /**
     * 직전 지점에서 이 슬롯까지의 이동 **거리 표시 문자열**(BR-U2-08) — 예 "약 1.2km · 도보 추정".
     * 소요시간은 어떤 이유로도 담지 않는다(INV-3). 직선거리 폴백이면 "추정" 표기가 문자열에 포함된다.
     */
    val distanceRange: String?,
    /** 추천 이유(BR-U2-04). 시각·소요시간 언급 없음(BR-U2-09) — 문구 집행은 AI 책임. */
    val placementReason: String?,
    /**
     * 위반 사유(BR-U3-13). [hasViolation] 이 true 일 때만 값이 있다.
     * 배지만 남기면 저장 후 재조회에서 "무엇이 왜 문제인지"가 사라진다 — 지속 가시화가 요건이다.
     */
    val violationReason: String?,
    /**
     * 생성 시점에 AI 가 같이 준 **차선책**(TRIP-873). 슬롯당 ≤2건, 기본 빈 목록.
     *
     * **편집·리비전·재계획 경로는 이 값을 싣지 않는다 — 편집하면 사라진다.** 옛 값을 그대로 들고
     * 가면 **바뀐 슬롯에 옛 대안이 붙고**, 특히 [SlotAlternative.distanceRange] 가 이전 이웃 기준이라
     * 화면에 틀린 거리가 남는다. 사라지는 쪽이 틀린 값을 보여주는 쪽보다 낫다.
     */
    val alternatives: List<SlotAlternative>,
) {
    companion object {
        fun of(
            sourcePoiId: UUID,
            poiSnapshotId: UUID?,
            orderIndex: Int,
            startAt: LocalTime,
            endAt: LocalTime,
            isFixed: Boolean = false,
            hasViolation: Boolean = false,
            endsNextDay: Boolean = false,
            distanceRange: String? = null,
            placementReason: String? = null,
            violationReason: String? = null,
            // 기본값 인자는 **맨 뒤에** — 가운데 끼우면 위치 인자로 부르는 호출이 조용히 어긋난다.
            alternatives: List<SlotAlternative> = emptyList(),
        ): VisitSlot {
            val errors = mutableListOf<FieldError>()
            if (orderIndex < 0) errors += FieldError("orderIndex", "순서는 0 이상입니다.")
            // 자정 넘김이면 endAt 이 익일 시각이라 startAt 보다 작을 수 있음(HC4) — 그 경우만 허용.
            if (endAt < startAt && !endsNextDay) errors += FieldError("endAt", "종료 시각은 시작 이후여야 합니다.")
            // **자기 자신은 대안이 아니다.** 상대가 슬롯 POI 를 후보로 되돌려 주는 일이 있고, 그대로 두면
            // 화면에 "이 장소 대신 이 장소"가 뜬다. 거르는 자리를 도메인에 두는 이유는 경로가 여럿이라서다.
            val kept = alternatives.filter { it.poiId != sourcePoiId }.distinctBy { it.poiId }
            if (errors.isNotEmpty()) throw ValidationFailed(errors)
            return VisitSlot(sourcePoiId, poiSnapshotId, orderIndex, startAt, endAt, isFixed, hasViolation, endsNextDay, distanceRange, placementReason, violationReason, kept)
        }
    }
}

/**
 * 추천 근거만 갈아끼운 사본(TRIP-511) — 다른 값은 건드리지 않는다.
 *
 * 근거는 생성과 **따로 도착한다**(설명 LLM 이 ~10초를 쓴다). 이미 확정된 시각·순서를 다시 만들지
 * 않고 그 자리에 문장만 채우기 위한 자리다 — 재구성하면 솔버가 정한 값이 흔들릴 수 있다(INV-2).
 */
fun VisitSlot.withPlacementReason(reason: String?): VisitSlot = VisitSlot.of(
    sourcePoiId, poiSnapshotId, orderIndex, startAt, endAt, isFixed, hasViolation, endsNextDay,
    distanceRange, reason, violationReason, alternatives,
)

/**
 * 차선책의 "대신 골라도 좋은 이유"만 갈아끼운 사본(TRIP-873 · AI TRIP-887).
 *
 * [withPlacementReason] 과 같은 자리·같은 이유다 — 문장이 일정보다 늦게 도착하므로 시각·순서를
 * 다시 만들지 않고 그 자리에 문장만 채운다.
 *
 * **키가 없으면 그대로 둔다.** 생성 시점에 AI 가 준 템플릿 문구(`"같은 카페 후보"`)가 폴백이라,
 * 빈 값으로 덮으면 화면의 "다른 선택지" 칸이 이유 없이 비어 버린다 — 조회가 일부만 답하는 것은
 * 정상 경로다(`slot_explanations_unavailable` 등).
 *
 * @param byAltPoiKey `"{date}#{altPoiId}"` → 문장. 키를 만드는 쪽이 날짜를 알아야 해서 맵으로 받는다.
 * @param key 이 슬롯의 날짜를 아는 호출측이 차선책 POI 로 키를 만든다.
 */
fun VisitSlot.withAlternativeRationales(
    byAltPoiKey: Map<String, String>,
    key: (SlotAlternative) -> String,
): VisitSlot {
    if (byAltPoiKey.isEmpty() || alternatives.isEmpty()) return this
    return VisitSlot.of(
        sourcePoiId, poiSnapshotId, orderIndex, startAt, endAt, isFixed, hasViolation, endsNextDay,
        distanceRange, placementReason, violationReason,
        alternatives.map { alt -> byAltPoiKey[key(alt)]?.let { alt.copy(rationale = it) } ?: alt },
    )
}

/** 하루 일정 — 날짜 + 방문 슬롯(순서 오름차순 정렬 보장). */
class ItineraryDay private constructor(
    val date: LocalDate,
    val dayOrder: Int,
    val slots: List<VisitSlot>,
) {
    companion object {
        fun of(date: LocalDate, dayOrder: Int, slots: List<VisitSlot>): ItineraryDay {
            val errors = mutableListOf<FieldError>()
            if (dayOrder < 0) errors += FieldError("dayOrder", "일자 순서는 0 이상입니다.")
            if (slots.map { it.orderIndex }.toSet().size != slots.size) {
                errors += FieldError("slots", "슬롯 순서(orderIndex)는 중복될 수 없습니다.")
            }
            if (errors.isNotEmpty()) throw ValidationFailed(errors)
            return ItineraryDay(date, dayOrder, slots.sortedBy { it.orderIndex })
        }
    }
}

/**
 * 일정(C8) 애그리거트 — 생성 결과 영속·확정. 사용자에게 보이는 시각·순서는 솔버 검증값만(INV-2).
 * 확정(PLANNED→CONFIRMED)은 단방향 잠금이고, poi_snapshot 동결은 확정 서비스(BE-7/272)가 수행한다.
 */
class Itinerary private constructor(
    val itineraryId: UUID,
    val tripId: UUID,
    val status: ItineraryStatus,
    val solveMode: SolveMode,
    /** 사용자가 고른 생성 방식. [solveMode](AI 가 어떻게 풀었나)와 다른 축이다. */
    val generationMode: GenerationMode,
    val isFallback: Boolean,
    val generationState: GenerationState,
    val days: List<ItineraryDay>,
    val createdAt: Instant,
    val updatedAt: Instant,
    /**
     * 후보 충분성(BR-U2-05) — AI 판정값을 그대로 보관·전달. 백엔드는 재계산하지 않는다.
     * 생성자·[reconstitute] 모두 기본값을 두지 않는다 — 전이 진입점에 기본값이 있으면 호출자가 그냥 빠뜨리고
     * 값이 조용히 사라진다(실제로 편집 경로에서 그렇게 유실됐다. endsNextDay·distanceRange 에 이은 세 번째).
     */
    val candidatesSummary: CandidatesSummary?,
    /**
     * 넣지 못한 필수 방문지(계약 M2). AI 판정 그대로 보관한다 — 백엔드가 재계산하지 않는다.
     * 빈 목록 = 전부 배치됨. **기본값을 두지 않는다** — 두면 전이 지점에서 조용히 빠져
     * 재조회 시 보고가 사라진다(같은 유실을 endsNextDay·distanceRange 등에서 이미 겪었다).
     */
    val unplacedMustVisits: List<UnplacedMustVisit>,
    /**
     * 취향 점수 신호(TRIP-1173) — AI 판정을 보관하되 2단계 생성은 [ScoringSignal.merge] 로 합친 값이다. **기본값을 두지 않는다**(위 두 필드와 같은 이유 —
     * 전이 지점에서 빠지면 편집·확정 한 번에 신호가 "모름"으로 바뀐다).
     */
    val scoring: ScoringSignal,
) {
    /** 확정 — PLANNED + 생성 완료만 가능(이미 확정이거나 생성 중이면 409). 상태 전이만(동결 없음). */
    fun confirm(now: Instant): Itinerary {
        requireConfirmable()
        return Itinerary(itineraryId, tripId, ItineraryStatus.CONFIRMED, solveMode, generationMode, isFallback, generationState, days, createdAt, now, candidatesSummary, unplacedMustVisits, scoring)
    }

    /**
     * 확정 + poi_snapshot 동결(INV-U1-03) — 각 슬롯 sourcePoiId 를 동결 스냅숏 id 로 세팅. 이미 확정이면 409.
     * [snapshotByPoi] 는 전 슬롯 POI 를 덮어야 한다(호출 서비스가 freeze 로 완비 후 전달).
     */
    fun confirm(snapshotByPoi: Map<UUID, UUID>, now: Instant): Itinerary {
        requireConfirmable()
        val frozenDays = days.map { d ->
            ItineraryDay.of(
                d.date, d.dayOrder,
                d.slots.map { s ->
                    VisitSlot.of(
                        s.sourcePoiId, snapshotByPoi.getValue(s.sourcePoiId), s.orderIndex,
                        // 동결은 스냅숏 참조만 붙이는 것 — 표시값은 **전부 그대로 옮긴다**.
                        // 하나라도 빠뜨리면 확정하는 순간 조용히 사라진다(endsNextDay 로 이미 겪은 회귀).
                        s.startAt, s.endAt, s.isFixed, s.hasViolation, s.endsNextDay, s.distanceRange, s.placementReason,
                        s.violationReason, s.alternatives,
                    )
                },
            )
        }
        return Itinerary(itineraryId, tripId, ItineraryStatus.CONFIRMED, solveMode, generationMode, isFallback, generationState, frozenDays, createdAt, now, candidatesSummary, unplacedMustVisits, scoring)
    }

    /**
     * 확정 가능 조건 — PLANNED(단방향 잠금) **AND** 생성 완료.
     * 생성 중(PARTIAL)에 확정하면 day1 만 동결된 채 잠겨(INV-U1-03) 2차 결과를 반영할 수 없다 → 409.
     */
    private fun requireConfirmable() {
        if (status != ItineraryStatus.PLANNED) throw ConflictDetected(message = "이미 확정된 일정입니다.")
        if (generationState == GenerationState.PARTIAL) {
            throw ConflictDetected(message = "일정 생성이 진행 중입니다. 완료 후 확정할 수 있습니다.")
        }
    }

    /**
     * 2차 생성 완료 — 전 일자를 채우고 COMPLETE 로 전이(PARTIAL 에서만). identity·createdAt·확정상태는 보존.
     * U5 2단계 호출의 완료 콜백이 쓴다 — [reconstitute] 를 직접 호출하면 status 를 실수로 되돌릴 수 있어 이 경로를 둔다.
     */
    fun completeGeneration(
        allDays: List<ItineraryDay>,
        now: Instant,
        secondSolveMode: SolveMode = solveMode,
        secondIsFallback: Boolean = isFallback,
        secondCandidatesSummary: CandidatesSummary? = null,
        /**
         * 2차가 보고한 미배치 필수 방문지. **기본값을 두지 않는다** — 2차는 전 일자를 보고 판정하므로
         * 그 결과가 곧 최종이다. 기본값을 두면 1차(day1만) 판정이 남아 사용자가 낡은 보고를 본다.
         */
        secondUnplaced: List<UnplacedMustVisit>,
        /**
         * 2차 호출의 점수 신호 — 1차 값과 [ScoringSignal.merge] 로 합친다. null = 2차 호출이 없었다(하루 여행이라
         * 1차가 곧 전체) — 이때는 1차 값이 최종이다. **기본값을 두지 않는다** — 두면 2차 신호를 빠뜨려도 컴파일된다.
         */
        secondScoring: ScoringSignal?,
    ): Itinerary {
        if (generationState != GenerationState.PARTIAL) {
            throw ConflictDetected(message = "생성 중인 일정이 아닙니다.")
        }
        if (allDays.map { it.dayOrder }.toSet().size != allDays.size) {
            throw ValidationFailed(listOf(FieldError("days", "일자 순서(dayOrder)는 중복될 수 없습니다.")))
        }
        return Itinerary(
            // 두 호출의 품질이 다르면 **낮은 쪽**을 기록한다 — 2차가 폴백으로 떨어졌는데 FULL_AI 로 남으면
            // 저하가 사용자·운영에 감춰진다(INV-4 침묵 금지).
            itineraryId, tripId, status, maxOf(solveMode, secondSolveMode), generationMode, isFallback || secondIsFallback,
            GenerationState.COMPLETE, allDays.sortedBy { it.dayOrder }, createdAt, now,
            // 2차가 요약을 주면 그 값(전 일자 기준), 없으면 1차 값 유지
            secondCandidatesSummary ?: candidatesSummary,
            // 미배치 보고도 같은 규칙 — 2차가 보고하면 그 값이 전 일자 기준이다.
            // 빈 목록은 "전부 배치됨"이라는 **판정**이라 1차 값으로 되돌리지 않는다.
            secondUnplaced,
            secondScoring?.let(scoring::merge) ?: scoring,
        )
    }

    /** 2차 생성 실패 — 1차분(day1)은 유효하게 두고 FAILED 로 전이(PARTIAL 에서만). 침묵 실패 금지(INV-4). */
    fun failGeneration(now: Instant): Itinerary {
        if (generationState != GenerationState.PARTIAL) {
            throw ConflictDetected(message = "생성 중인 일정이 아닙니다.")
        }
        return Itinerary(
            itineraryId, tripId, status, solveMode, generationMode, isFallback, GenerationState.FAILED, days, createdAt, now,
            candidatesSummary, unplacedMustVisits, scoring,
        )
    }

    companion object {
        fun create(
            tripId: UUID,
            solveMode: SolveMode,
            generationMode: GenerationMode,
            isFallback: Boolean,
            days: List<ItineraryDay>,
            now: Instant,
            generationState: GenerationState = GenerationState.COMPLETE, // 단일 호출=완료. 2단계(day1)는 PARTIAL
            candidatesSummary: CandidatesSummary? = null,
            /** AI 가 못 넣었다고 보고한 필수 방문지. 기본 빈 목록 = 전부 배치됨. */
            unplacedMustVisits: List<UnplacedMustVisit> = emptyList(),
            /** AI 점수 신호(TRIP-1173). 기본 모름 — AI 를 부르지 않는 경로(직접 만들기·폴백)는 줄 값이 없다. */
            scoring: ScoringSignal = ScoringSignal.UNKNOWN,
        ): Itinerary {
            if (days.map { it.dayOrder }.toSet().size != days.size) {
                throw ValidationFailed(listOf(FieldError("days", "일자 순서(dayOrder)는 중복될 수 없습니다.")))
            }
            return Itinerary(
                UUID.randomUUID(), tripId, ItineraryStatus.PLANNED, solveMode, generationMode, isFallback, generationState,
                days.sortedBy { it.dayOrder }, now, now, candidatesSummary, unplacedMustVisits, scoring,
            )
        }

        @Suppress("LongParameterList")
        fun reconstitute(
            itineraryId: UUID, tripId: UUID, status: ItineraryStatus, solveMode: SolveMode,
            generationMode: GenerationMode, isFallback: Boolean, generationState: GenerationState, days: List<ItineraryDay>,
            createdAt: Instant, updatedAt: Instant, candidatesSummary: CandidatesSummary?,
            unplacedMustVisits: List<UnplacedMustVisit>, scoring: ScoringSignal,
        ): Itinerary = Itinerary(
            itineraryId, tripId, status, solveMode, generationMode, isFallback, generationState,
            days.sortedBy { it.dayOrder }, createdAt, updatedAt, candidatesSummary, unplacedMustVisits, scoring,
        )
    }
}

/** 일정 영속 포트. 애그리거트 단위 저장·조회(days·slots 포함). */
interface ItineraryRepository {
    fun save(itinerary: Itinerary): Itinerary
    fun findById(itineraryId: UUID): Itinerary?
    fun findByTrip(tripId: UUID): List<Itinerary>

    /** 여행의 현행 일정을 교체(원자적) — 재생성 시 기존 제거 후 저장. 여행당 1개 유지. */
    fun replaceForTrip(tripId: UUID, itinerary: Itinerary): Itinerary

    /**
     * 현행 일정이 [expectedItineraryId] 이고 아직 [GenerationState.PARTIAL] 일 때만 교체한다(조건부 쓰기).
     * 백그라운드 2차 생성이 쓰는 경로 — 읽고-쓰는 사이에 재생성이 끼어들면 삭제 키가 `trip_id` 라
     * 방금 만들어진 일정까지 지워버린다. 교체 여부를 **DB 조건**으로 판정해 그 창을 없앤다.
     * @return 교체했으면 true, 조건이 깨져 아무것도 하지 않았으면 false.
     */
    fun replaceIfCurrent(tripId: UUID, expectedItineraryId: UUID, itinerary: Itinerary): Boolean

    /** [Instant] 이전에 마지막으로 갱신된 채 아직 PARTIAL 인 일정 — 중단된 2차 생성을 찾는 용도. */
    fun findStalePartial(updatedBefore: Instant): List<Itinerary>

    /**
     * 여행 단위 일정 쓰기 잠금(트랜잭션 범위 권고 잠금)을 잡고 현행 일정을 읽는다 — 호출자의 트랜잭션이 끝날 때까지 같은 잠금을
     * 잡는 다른 쓰기가 기다린다. 잠금을 얻은 뒤의 읽기라 그 전에 커밋된 쓰기는 다 보인다(같은 트랜잭션이 먼저 읽어 둔 값도
     * 잠금 뒤 값으로 갈아 읽는다). **트랜잭션 안에서** 부른다.
     *
     * 잡는 쓰기 — **이 저장소로 일정을 쓰는 경로 전부**: 재계획 반영·되돌리기(TRIP-1412) · 편집 · 범용 복원 · 확정 · 생성 1차와
     * 직접 만들기 · 2차 마무리와 그 실패 표시 · 중단된 생성 정리. 각자 쓰기 트랜잭션 안에서만 잡는다 — AI 호출을 기다리는 동안에는
     * 쥐지 않는다(잡은 뒤에는 짧은 쓰기뿐이다).
     *
     * @return 잠금 뒤 현행 일정. 여행에 일정이 없으면 null(호출자가 404 또는 "그 사이 바뀌었다"로 읽는다).
     *   기본 구현은 잠금 없는 읽기 — 단위 테스트 대역은 단일 스레드라 잠글 상대가 없다.
     */
    fun lockForTrip(tripId: UUID): Itinerary? = findByTrip(tripId).firstOrNull()
}
