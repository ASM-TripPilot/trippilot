# U2 Functional Design — Domain Entities (보강)

> U1이 정의한 타입은 **그대로 재사용**한다: `ItineraryProblem` `ItinerarySolution` `DaySolution` `VisitSlot` `FixedBlock` `TimeWindow` `Violation` `SolveMode` `TravelEstimate` `ScoredPoi` `AssemblyRunRecord` `FallbackEvent`.
> 본 문서는 U2가 **추가로 필요로 하는 타입**만 정의한다. 규칙은 U1과 동일: frozen+slots, tz-aware, 직렬화 왕복(U5-P10), domain은 표준 라이브러리만.

---

## 1. 어셈블리 설정 (domain/assembly_config.py) — AI-D07 반영

| 타입 | 필드 | 불변식 |
|---|---|---|
| `AssemblyConfig` | `or_tools_limit_ms: int = 3000` · `llm_stage_timeout_ms: int = 2500` · `local_search_min_remaining_ms: int = 3000` · `buffer_min: int = 15` · `speeds_kmph: {WALK:4.0, PUBLIC:20.0, CAR:30.0}` · `safety: {WALK:1.4, PUBLIC:1.5, CAR:1.5}` · `detour_factor: float = 1.3` | 전 필드 양수. **초기값 = AI-D07·G106 확정값** — 실체는 remote config, 이 타입은 주입 컨테이너. 하드코딩 금지 |

- `speeds`/`safety`는 `TransportMode` 키의 고정 매핑(직렬화 시 `.value` 키 dict).
- day1 예산 5초·전체 20초·Plan-B 10초 같은 **경로별 deadline은 이 타입에 없다** — 호출자(U5)가 `deadline_ms`로 전달 (AI-D07 시한 인지).

## 2. 검증·수리 (domain/repair.py)

§1.2 정본의 미확정 참조 타입을 다음과 같이 확정한다:

| 정본 표기 | U2 확정 | 근거 |
|---|---|---|
| `ItineraryLike` | **`ItinerarySolution`** (별도 타입 안 만듦) | U1 타입으로 충분 — 스냅샷 검증도 from_dict로 복원해 동일 경로 |
| `ConstraintSet` | **`ItineraryProblem`에서 유도** — `validate(solution, problem)` | 제약의 원천(영업시간·고정블록·day window)이 전부 problem 안에 있음 |
| `MinimalChangePolicy` | Enum: `TIME_SHIFT_ONLY / ALLOW_REORDER` | 1차는 TIME_SHIFT_ONLY만 구현 (시각만 조정, POI·순서 불변) |
| `RepairResult` | `repaired: ItinerarySolution \| None` · `changes: tuple[RepairChange,...]` | None = 수리 불가 → 체인 다음 단계 |
| `RepairChange` | `poi_id: PoiId` · `field: str("start_at"/"end_at")` · `before: datetime` · `after: datetime` | 최소 변경 감사 추적 |

## 3. 시계 주입 (ports/clock_port.py) — G116 결정론

```python
class ClockPort(Protocol):
    def monotonic_ms(self) -> int: ...   # 단조 시계 — deadline 잔여 계산 전용
```

- **시한 인지 체인의 잔여 시간 계산은 반드시 이 Port 경유** — `time.monotonic()` 직접 호출 금지.
- 테스트: `FakeClock(advance(ms))` — sleep 없이 시간 경과 시뮬레이션 (InMemoryCache 논리 시계와 동일 패턴).
- 참고: `ClockPort`는 wall-clock이 아니므로 tz 무관. 도메인 타입의 `occurred_at` 등 wall-clock은 기존 규칙(tz-aware) 유지.

## 4. LLM 2차 어셈블리 출력 스키마 (domain/llm_assembler.py)

| 타입 | 필드 | 불변식 |
|---|---|---|
| `LlmSlotProposal` | `poi_id: PoiId` · `start_at: datetime` · `end_at: datetime` | LLM **제안**일 뿐 — HC 검증·수리 통과 전까지 절대 ItinerarySolution이 되지 못함 (INV-2). tz-aware, start<end는 파싱 단계에서 위반 시 드롭 |
| `LlmDayProposal` | `date: date` · `slots: tuple[LlmSlotProposal,...]` | 파싱 실패·부분 위반은 해당 슬롯만 드롭 후 잔여로 진행 |

- `poi_id ∉ problem.candidates`인 제안 슬롯은 **드롭 + GateDropEvent** (INV-1 — 어셈블리 경로에도 closed-set 게이트 적용).

## 5. U1 타입과의 연결

| U1 타입 | U2에서의 역할 |
|---|---|
| `ItineraryProblem.seed` | FallbackScorer 결정론 시드 (U5-P3) |
| `SolveMode` | 체인 단계별 태깅: OR_TOOLS / BEDROCK¹ / RULE_FALLBACK / MINIMAL |
| `AssemblyRunRecord` | 매 solve 완료 시 발행 의무 (business-rules §3) |
| `FallbackEvent(stage="assembly")` | 체인 단계 스킵·강등 시 발행 (침묵 실패 금지) |
| `TravelEstimate.internal_minutes` | HC2 계산 전용 — 표시 금지 규칙은 U1이 이미 강제 (U5-P4) |

> ¹ ~~`SolveMode.BEDROCK`은 U1에서 정의된 enum 값 유지 — enum 개명은 직렬화 호환을 위해 보류.~~
> **정정 (2026-08-25, TRIP-530)**: **개명은 완료됐다** — `SolveMode.BEDROCK` → `SolveMode.LLM`(TRIP-256, 2026-08-04).
> 현 enum 값은 `OR_TOOLS`·`LLM`·`RULE_FALLBACK`·`MINIMAL` (`domain/itinerary.py`). 보류 상태가 아니다.
