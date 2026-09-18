# U3 Functional Design — Domain Entities (보강)

> 재사용: U1 `Poi` `OpenHour` `DataQuality` `CandidatePool` `GeoPoint` `BudgetLevel` `TransportMode` `PoiId`.
> 근거: ai-data-design.md §2~§8, AI-D04. 규칙은 U1과 동일(frozen·tz-aware·직렬화 왕복).

## 1. CandidatePool 보강 (domain/llm.py — 기존 타입 확장)

정본 §3.3의 `anchor`·`radius_km`가 U1 정의에 누락 → **선택 필드로 추가** (기본 None, 직렬화 호환 — ItineraryProblem.anchor와 동일 방식).

| 추가 필드 | 타입 | 용도 |
|---|---|---|
| `anchor` | `GeoPoint \| None` | 풀 생성 기준점 (재현·디버깅·반경 검증) |
| `radius_km` | `float \| None` | 적용된 반경 (다일 ×0.7 반영 후 값) |

기존 post-init(INV-1: poi_ids == pois의 id 집합)은 그대로.

## 2. 풀 요청 (domain/m7.py — 신규)

| 타입 | 필드 | 불변식 |
|---|---|---|
| `CandidatePoolRequest` | `anchor: GeoPoint` · `dates: tuple[date,...]` · `budget: BudgetLevel` · `transport: TransportMode` · `radius_override_km: float \| None = None` | dates 최소 1일. 직렬화 왕복 대상 |

## 3. 엔티티 해소 (domain/m7.py — 신규, AI-D04)

| 타입 | 필드 | 비고 |
|---|---|---|
| `EntityMatch` | `poi_id: PoiId \| None` · `matched_name: str \| None` · `confidence: float(0~1)` · `decision: MatchDecision` | poi_id=None ⇔ decision=UNRESOLVED |
| `MatchDecision` | Enum: `AUTO / CONFIRM / UNRESOLVED` | 임계 remote config: auto ≥ 0.85, confirm ≥ 0.60 (초기값) |

- **REGION 해소는 U3 범위 밖** (Region 타입·데이터가 라우터/U6 소유 — FD 범위 결정). U3는 POI만.
- UNRESOLVED는 호출측이 AI-D03 웹 소싱으로 연결 (U6).

## 4. M7 설정 (m7 계층 내 — domain 아님)

`M7Config`: `radius_km {WALK:2, PUBLIC:10, CAR:20}` · `multi_day_factor 0.7` · `budget_limit {LOW:15_000, MID:40_000, HIGH:None}` · `max_candidates 5_000(G142)` · `ttl {poi:24h, hours:6h, price:금지}` · `match_auto 0.85 / match_confirm 0.60` — 전부 remote config 초기값, 주입 컨테이너 (AssemblyConfig 패턴).

## 5. U1 타입 활용 확인

- 가격 캐싱 금지: `Poi.to_cacheable_dict()`(U1)가 이미 구조 차단 — U3는 캐시 저장 경로에서 **이 메서드만** 사용
- 캐시: `CachePort`(U1) + InMemoryCache 논리 시계
- 저장소: `PoiDbPort`(U1) — 실 PostgreSQL 어댑터는 후속, 개발·테스트는 InMemoryPoi
