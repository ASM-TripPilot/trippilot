# U1 Functional Design — Business Logic Model (Ports · Fakes · Generators)

> **확정 규칙 (플랜 Q5)**: 모든 Port는 `typing.Protocol` (구조적 타이핑, 어댑터 상속 불필요).
> U1은 비즈니스 로직 없음 — Port 계약 + fake 구현 + PBT generator가 산출물의 전부.

---

## 1. 모듈 레이아웃

```
trippilot/
├── domain/          # 외부 의존 0
│   ├── common.py    poi.py    itinerary.py    travel.py
│   ├── trigger.py   edit.py   llm.py          execution.py
│   ├── observability.py   prompt.py   evals.py        # [LLMOps]
│   └── serialization.py   # to_dict/from_dict 공통 헬퍼
├── ports/           # Protocol만 — 구현 없음
│   ├── llm_port.py  travel_port.py  places_port.py
│   ├── poi_db_port.py  cache_port.py  solver_port.py
│   └── trace_port.py                                    # [LLMOps]
└── tests/
    ├── generators/  # Hypothesis strategies
    └── fakes/       # Port별 fake 구현
```

빌드: **uv** (Q6 확정). Python 3.11+. domain·ports는 표준 라이브러리만 의존.

---

## 2. Port 계약

### 2.1 LlmPort — 계측 가능 구조 (NFR-7.1 반영)

```python
@dataclass(frozen=True, slots=True)
class LlmRequest:
    model_id: str
    prompt: str
    prompt_ref: PromptRef        # [LLMOps] 어떤 프롬프트 버전인지 필수
    max_tokens: int
    temperature: float
    timeout_sec: float           # NFR-1.2: 기본 2.5초

@dataclass(frozen=True, slots=True)
class LlmResponse:
    raw_text: str
    input_tokens: int            # [LLMOps] 사용량 메타 필수 반환
    output_tokens: int
    latency_ms: int
    model_id: str

class LlmPort(Protocol):
    def invoke(self, request: LlmRequest) -> LlmResponse: ...
```

- 벤더 중립 (NFR-6.3). 실 벤더 어댑터는 U4 소유 — 벤더는 Anthropic API 직접(AI-D06, 2026-08-25 "Bedrock" 표기 정정)
- **타임아웃 초과 → `LlmTimeoutError`** (침묵 실패 금지 — 소비 측이 FallbackEvent 발행)
- LlmResponse의 토큰·레이턴시 메타가 `LlmCallRecord` 생성의 원천 — 계측이 구조적으로 가능

### 2.2 TravelPort

```python
class TravelPort(Protocol):
    def estimate(self, from_: GeoPoint, to: GeoPoint, mode: TransportMode) -> TravelEstimate: ...
```
- 실 구현은 체인(카카오→네이버→직선거리) — 체인 로직은 U2 소유, Port는 단일 계약
- 동일 입력 → 동일 출력 (U5-P4 결정론)

### 2.3 PlacesPort

```python
class PlacesPort(Protocol):
    def search(self, region: str, category: PoiCategory, limit: int) -> tuple[SourcedPoi, ...]: ...
    def geocode(self, name: str, region: str) -> GeoPoint | None: ...
```

### 2.4 PoiDbPort

```python
class PoiDbPort(Protocol):
    def find_by_radius(self, center: GeoPoint, radius_km: float) -> tuple[Poi, ...]: ...
    def find_by_ids(self, ids: frozenset[PoiId]) -> tuple[Poi, ...]: ...
    def find_nearby(self, coord: GeoPoint, radius_m: int, category: PoiCategory) -> tuple[Poi, ...]: ...
    def upsert(self, poi: Poi) -> PoiId: ...
    def get_open_window(self, poi_id: PoiId, on: date) -> OpenHour | None: ...
    def batch_check_closed(self, poi_ids: frozenset[PoiId], on: date) -> frozenset[PoiId]: ...
```

### 2.5 CachePort

```python
class CachePort(Protocol):
    def get(self, key: str) -> dict | None: ...
    def set(self, key: str, value: dict, ttl_sec: int) -> None: ...
```
- value는 직렬화된 dict만 (도메인 타입은 to_dict 후 저장). **가격 필드 저장 금지는 정책 규칙** (business-rules.md §4)

### 2.6 SolverPort — 하이브리드 체인용 (agent-redesign.md)

```python
class SolverPort(Protocol):
    def solve(self, problem: ItineraryProblem) -> ItinerarySolution | None: ...
```
- `None` = 이 전략으로 해 없음 → 체인의 다음 전략(OR-Tools→LLM 2차→규칙 폴백, U2 소유. **LLM 2차는 현재 미배선** — TRIP-529)

### 2.7 [LLMOps] TracePort — 관측 이벤트 발행 (Q1 확정: 단일 통합)

```python
class TracePort(Protocol):
    def emit(self, event: TraceEvent) -> None: ...
```
- `TraceEvent = LlmCallRecord | FallbackEvent | GateDropEvent | SolverRunRecord`
- **emit은 절대 예외를 밖으로 던지지 않음** — 계측 실패가 비즈니스 로직을 막으면 안 됨 (NFR-2.4와 동일 원리)
- 실 구현(U5): 구조화 로그 → CloudWatch/OTel. 테스트: InMemoryTrace

---

## 3. Fake 구현 (tests/fakes/)

| Fake | 대상 Port | 동작 |
|---|---|---|
| `FakeLlm` | LlmPort | seed 기반 결정론 응답. `respond_with(...)` 주입 가능. 토큰 수는 문자열 길이 비례로 합성 — **call_record 파이프라인까지 테스트 가능** |
| `FakeTravel` | TravelPort | haversine × 우회계수 1.3, 결정론 |
| `FakePlaces` | PlacesPort | 고정 시드 데이터 반환 |
| `InMemoryPoi` | PoiDbPort | dict 기반. find_by_radius는 haversine 필터 |
| `InMemoryCache` | CachePort | dict + 논리 시계 TTL (실시간 sleep 금지) |
| `InMemoryTrace` | TracePort | `events: list[TraceEvent]` 누적. 테스트에서 **"폴백 시 FallbackEvent가 발행됐는가"를 단언하는 용도** (NFR-7 검증 핵심) |
| `FailingLlm` / `SlowLlm` | LlmPort | 항상 실패 / 타임아웃 유발 — 폴백 경로·FallbackEvent 발행 테스트용 |

---

## 4. PBT Generators (tests/generators/, Hypothesis)

| Generator | 생성 대상 | 유효성 조건 |
|---|---|---|
| `geo_points()` | GeoPoint | 위경도 범위 내 (기본: 한국 bounding box) |
| `open_hours()` | OpenHour | open<close, 자정 초과 케이스 포함 |
| `pois()` | Poi | 카테고리·품질 전체 분포, avg_cost=None 케이스 포함 |
| `candidate_pools()` | CandidatePool | poi_ids == pois의 id 집합 (불변식 만족 보장) |
| `scored_pois(pool)` | ScoredPoi | **poi_id ∈ pool 보장** (INV-1 정상 케이스) + 별도 `polluted_scored_pois(pool)` — 풀 밖 ID 주입 (U5-P5 적대적 케이스, U4가 사용) |
| `itinerary_problems()` | ItineraryProblem | day window·고정 블록 정합 |
| `itinerary_solutions()` | ItinerarySolution | 시간순 슬롯 |
| `travel_estimates()` | TravelEstimate | 거리 범위 low≤high |
| `trace_events()` | TraceEvent 4종 | [LLMOps] 직렬화 왕복 대상 |
| `prompt_refs()` / `eval_cases()` | PromptRef, EvalCase | [LLMOps] 〃 |

**U1 소유 PBT 속성**:
- **U5-P10**: 위 generator 전체에 대해 `from_dict(to_dict(x)) == x` (관측·eval 타입 포함)
- **Generator 유효성**: 생성 인스턴스가 각 타입 불변식(post-init 검증) 통과
