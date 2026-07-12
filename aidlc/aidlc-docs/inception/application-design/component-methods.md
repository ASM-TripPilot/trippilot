# Application Design — Component Methods & Contracts

> **범위**: 메서드 시그니처 · 입출력 타입 · 고수준 목적. **상세 비즈니스 규칙·알고리즘·프롬프트·모델 ID는 Functional Design(CONSTRUCTION) 이연.**
> **표기**: Kotlin 유사 시그니처(백엔드 가정). 솔버 서비스는 Python이나 계약은 언어 중립 DTO(JSON). `Result<T>`=성공/폴백 래핑, `Instant`=시각, **duration 필드 없음(INV-3)**.
> **AI/솔버 계약(§2·§3)이 이 문서의 중심**이며 사용자 지시로 최대 구체화. 나머지 facade(§4)는 핵심 메서드만.

---

## 1. 공용 도메인 타입 (일정 지능)

```kotlin
// ── 앵커 · 여행 컨텍스트 ─────────────────────────────
data class RegisteredStay(          // C4 소유 · 일정 출발점(ADR-0002)
  val stayId: StayId, val coord: GeoCoord,
  val checkIn: LocalDate, val checkOut: LocalDate, val partySize: Int)

data class MustVisit(               // C6 · 필수 방문지
  val placeRef: PlaceRef,
  val kind: MustVisitKind,          // TIME_FIXED | INCLUDE_ONLY  (시각 고정 / 포함 고정)
  val fixedStart: Instant? = null,  // TIME_FIXED 일 때만
  val stayMinutes: StayRange? = null)

data class PreferenceVector(        // C2/LLM 해석 결과
  val styles: Set<TravelStyle>, val paceLevel: Pace, val budgetTier: BudgetTier,
  val companions: Set<Companion>, val activities: Set<Activity>,
  val transport: Set<TransportMode>, val cuisines: Set<Cuisine>,
  val freeTextSignals: List<String>)   // 자유 입력 해석 신호

data class StayRange(val min: Int, val recommended: Int, val max: Int) // 체류 분(최소·권장·최대)

// ── 후보 · 거리 ────────────────────────────────────
data class GroundedPlace(          // C7(RAG) — 실재 확인된 후보만(INV-1)
  val placeRef: PlaceRef, val coord: GeoCoord, val category: Category,
  val openingHours: OpeningHours?,   // null → "영업시간 미확인" 분리
  val grounded: Boolean)             // 항상 true (미확인은 풀에서 제외)

data class DistanceEstimate(       // C ── 거리만(INV-3), 소요시간 없음
  val meters: Int, val mode: TransportMode, val basis: EstimateBasis) // ROAD | STRAIGHT_LINE
  // 내부 솔버용 이동시간 버퍼는 솔버 내부에서만 사용 · UI 노출 금지

// ── 솔버 입출력 ────────────────────────────────────
data class SolvedItinerary(
  val days: List<DayPlan>,
  val score: QualityScore,
  val fallbackMode: FallbackMode = FallbackMode.NONE,   // §3.6 폴백 표기
  val excluded: List<ExcludedPlace> = emptyList())      // 못 담은 방문지(사유)

data class DayPlan(val date: LocalDate, val baseStay: RegisteredStay?, val slots: List<TimeSlot>)

data class TimeSlot(
  val placeRef: PlaceRef,
  val start: Instant, val end: Instant,       // ← 솔버 검증 시각(INV-2)
  val stayMinutes: Int,                        // 권장→최소 축소 시 reducedFrom 표기
  val reducedFrom: Int? = null,
  val arrival: DistanceEstimate?,              // 직전→현재 이동(거리만)
  val fixed: Boolean,                          // 앵커/시각 고정
  val reason: PlacementReason)                 // LLM 설명(표시용, 시각 불변)

data class QualityScore(            // §3.7 · FR-SOLVER-02
  val preferenceFit: Double, val constraintSatisfaction: Double,
  val routeEfficiency: Double, val composite: Double)   // 산식·임계 = CONSTRUCTION(O-SOLVER)

enum class FallbackMode { NONE, DETERMINISTIC_ONLY, PARTIAL_PLACE_DATA, STRAIGHT_LINE_DISTANCE, MINIMAL_ANCHORS_ONLY }
```

---

## 2. `SolverPort` — 일정 지능 엔진 (FR-SOLVER) ★

> 소유: C8·C10 도메인 인터페이스. 구현: Phase 1 `DeterministicSolverAdapter`(Python OPTW/TOPTW) → 향후 `BedrockAgentSolverAdapter`. **어댑터 교체만으로 대체.** 반환값은 항상 검증 완료(INV-2).

```kotlin
interface SolverPort {

  /** 전체 일정 생성. 앵커·취향점수·후보·제약을 풀어 검증된 day별 일정 + score 반환. */
  fun generate(cmd: GenerateItineraryCommand): Result<SolvedItinerary>

  /** Plan-B 잔여 재정렬(warm-start). 완료·시각고정 보존, 남은 일정만 재최적화. */
  fun recalculate(cmd: RecalculateCommand): Result<SolvedItinerary>

  /** 편집·공동편집 재검증(자유 편집/드래그/공동편집). 위반 표기만, 자동 변경 없음. */
  fun validate(draft: ItineraryDraft): ValidationResult

  /** '같이 고르기' 슬롯별 후보 산출(반경 내, 거리 트레이드오프 표기). */
  fun proposeSlotCandidates(cmd: SlotCandidateQuery): Result<List<ScoredCandidate>>
}

data class GenerateItineraryCommand(
  val tripId: TripId, val anchors: List<RegisteredStay>, val dateRange: DateRange,
  val preferences: PreferenceVector, val mustVisits: List<MustVisit>,
  val candidatePool: List<GroundedPlace>,           // C7(RAG) — closed-set(INV-1)
  val scored: List<ScoredCandidate>,                // C(LLM) 선호 점수
  val mode: GenerationMode)                          // FULL_AI | CO_PICK | MANUAL

data class RecalculateCommand(
  val currentItinerary: SolvedItinerary, val fromInstant: Instant, val currentLocation: GeoCoord,
  val trigger: PlanBTrigger, val anchors: List<RegisteredStay>, val candidatePool: List<GroundedPlace>)

data class ValidationResult(val feasible: Boolean, val violations: List<Violation>)
data class Violation(val slotRef: SlotRef, val type: ViolationType, val detail: String)
  // ViolationType: OUTSIDE_OPENING_HOURS | TRAVEL_BUFFER_SHORT | ANCHOR_CONFLICT | TIME_OVERLAP
```

**보장(계약)**: 모든 반환 `TimeSlot.start/end`는 `FeasibilityValidator` 통과값 · `mustVisits(INCLUDE_ONLY)`는 누락 없이 포함 · `anchors`·`TIME_FIXED`는 불변 · 실패 시 `Result`가 `FallbackMode` 동반.

---

## 3. 실현가능성·LLM·후보·거리 포트 ★

```kotlin
/** §3.2 실현가능성 소유자 — 두 단계 불변. 순수 함수(PBT 1순위). */
interface FeasibilityValidator {
  fun checkTimeWindows(slots: List<TimeSlot>, hours: Map<PlaceRef, OpeningHours>): List<Violation>
  fun checkTravelBuffer(slots: List<TimeSlot>, dist: DistanceMatrix): List<Violation>   // 직전종료+이동≤다음시작
  fun checkAnchors(days: List<DayPlan>, anchors: List<RegisteredStay>): List<Violation>
  fun checkMustVisitInclusion(itin: SolvedItinerary, must: List<MustVisit>): List<Violation>
  fun isFeasible(itin: SolvedItinerary, ctx: ConstraintContext): Boolean                // 종합
}

/** §3.3 LLM 판단 계층(어시스턴트·회고 재사용). 어댑터=LlmGateway(향후 Bedrock). */
interface PreferenceScoringPort {
  fun interpret(profile: UserProfileSnapshot, freeText: String?): Result<PreferenceVector>
  fun scoreCandidates(pool: List<GroundedPlace>, pref: PreferenceVector): Result<List<ScoredCandidate>>
  fun explainPlacements(itin: SolvedItinerary, pref: PreferenceVector): Result<List<PlacementReason>>
  // 설명은 표시용 — 시각 불일치 시 검증 시각 우선(INV-2, US-SCHED-05)
}
data class ScoredCandidate(val placeRef: PlaceRef, val score: Double, val rationale: String)

/** §3.4 RAG 후보 풀(INV-1) — C7 Place Data. */
interface CandidatePoolPort {
  fun resolve(area: Area, categories: Set<Category>, filters: PlaceFilters): Result<List<GroundedPlace>>
  fun ground(rawRefs: List<PlaceRef>): Result<List<GroundedPlace>>   // 미확인 제외
}

/** 거리 기반 추정(ADR-0009) — 거리만, 소요시간 미노출(INV-3). */
interface TravelEstimatePort {
  fun estimate(from: GeoCoord, to: GeoCoord, mode: TransportMode): Result<DistanceEstimate>
  fun matrix(points: List<GeoCoord>, mode: TransportMode): Result<DistanceMatrix>
}
```

---

## 4. 컴포넌트 facade 메서드 (1차 핵심 — 핵심 시그니처)

```kotlin
// C1 Auth
interface AuthFacade {
  fun startSocialLogin(provider: SocialProvider): AuthChallenge
  fun completeSocialLogin(provider: SocialProvider, code: String): Result<Session>
  fun signUpEmail(email: Email, password: Password): Result<PendingVerification>
  fun refresh(token: RefreshToken): Result<Session>
  fun validate(access: AccessToken): Principal?          // 매 요청 서버측 검증(SEC-AUTHZ)
  fun deleteAccount(userId: UserId): Result<Unit>        // → AccountDeletionRequested(캐스케이드)
}

// C2 User Profile
interface UserProfileFacade {
  fun getPreferenceVector(userId: UserId): PreferenceVector      // 미설정=중립 기본값
  fun updatePreferences(userId: UserId, patch: PreferencePatch): Result<Unit> // → PreferencesUpdated
}

// C3 Accommodation Search
interface AccommodationSearchFacade {
  fun search(destination: Area, filters: StayFilters): Result<List<StayCard>>     // 대표 가격대(정적)
  fun livePrice(stayId: StayId): Result<LivePrice>                                 // 표시 시점만(캐싱 금지)
  fun saveToWishlist(userId: UserId, stayId: StayId, memo: String?): Result<Unit>
}

// C4 Saved Accommodation (앵커)
interface RegisteredStayFacade {
  fun register(cmd: RegisterStayCommand): Result<RegisteredStay>   // → StayRegistered
  fun getAnchors(tripId: TripId): List<RegisteredStay>             // 솔버 입력
  fun resolveBaseForDate(tripId: TripId, date: LocalDate): RegisteredStay?  // 스마트 기본 거점
}

// C5 Affiliate Link
interface AffiliateLinkFacade {
  fun buildDeeplink(stayId: StayId, dates: DateRange?): Deeplink   // 파라미터 정확성
  fun recordOutbound(userId: UserId, deeplink: Deeplink)           // 내부 지표(비노출)
  fun onPostback(evt: ConversionPostback)                          // 멱등 처리
}

// C6 Trip Creation
interface TripFacade {
  fun create(cmd: CreateTripCommand): Result<Trip>                 // 숙소 미등록 시작 허용
  fun getTripContext(tripId: TripId): TripContext                  // 앵커+취향+필수방문지 집약
  fun changeMustVisits(tripId: TripId, patch: MustVisitPatch): Result<Unit> // → MustVisitChanged
}

// C8 Itinerary Generation (오케스트레이션 — 포트 조립)
interface ItineraryGenerationFacade {
  fun generate(tripId: TripId, mode: GenerationMode): Result<SolvedItinerary>
    // 내부: getAnchors → CandidatePool.resolve → PreferenceScoring.score → SolverPort.generate → explain
  fun edit(itineraryId: ItineraryId, ops: List<EditOp>): ValidationResult  // = SolverPort.validate
  fun recommendStayAfterPlan(itineraryId: ItineraryId): Result<List<StayRegion>> // US-SCHED-11
  fun confirm(itineraryId: ItineraryId): Result<Unit>              // 확정 lock
}

// C9 Plan-B Detection
interface PlanBDetectionFacade {
  fun evaluate(activeItineraryId: ItineraryId, signals: ContextSignals): TriggerResult
  fun suppress(itineraryId: ItineraryId, placeRef: PlaceRef, reason: SuppressReason) // "그대로 둘게요"
}

// C10 Itinerary Recalculation
interface RecalculationFacade {
  fun proposeAlternatives(cmd: RecalculateCommand): Result<List<AlternativeOption>>  // 2~3개(검증분)
  fun apply(itineraryId: ItineraryId, chosen: AlternativeId): Result<ItineraryDiff>  // → change log
}

// C12 Travel Archive
interface ArchiveFacade {
  fun checkVisit(cmd: CheckVisitCommand): Result<Unit>             // → VisitChecked
  fun attachPhotoMeta(visitId: VisitId, meta: PhotoMetadata): Result<Unit> // 로컬 참조·메타만
  fun uploadForCommunity(photoRef: LocalAssetRef): Result<S3Url>   // 공개 시만·EXIF 제거
  fun getRecords(tripId: TripId): TripRecords                      // plan/actual/changelog
}

// C13 AI Reflection/Summary
interface ReflectionFacade {
  fun generateDaily(tripId: TripId, date: LocalDate): Result<Reflection>  // 실패 시 기본 카드
  fun generateTripSummary(tripId: TripId): Result<TripSummary>
  fun analyzeStyle(userId: UserId): Result<StyleAnalysis>          // 누적 방문 ≥10
}

// C14 Notification
interface NotificationFacade {
  fun onDomainEvent(evt: DomainEvent)                              // 이벤트 구독
  fun setToggles(userId: UserId, toggles: NotificationToggles): Result<Unit>
  fun catchUp(userId: UserId, since: Instant): List<PendingNotification>  // 누락 0
}
```

> 후속 게이트(C15 Community·C16 Assistant·C17 Collab) 메서드는 인터페이스 수준만 `components.md §2`에 명시, 상세 시그니처는 후속 인셉션.
