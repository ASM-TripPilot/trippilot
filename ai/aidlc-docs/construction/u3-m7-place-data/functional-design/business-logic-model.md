# U3 Functional Design — Business Logic Model

> 근거: ai-data-design.md §3(6단계 필터)·§6(캐싱)·§8(엔티티 해소). 웹 소싱은 U6 (본 유닛 제외).

## 1. 모듈 레이아웃

```
src/trippilot/m7/
├── config.py           M7Config (remote config 주입 컨테이너)
├── pool_builder.py     CandidatePoolBuilder — 6단계 필터 파이프라인
├── entity_resolver.py  fuzzy_match — 결정론 (edit-distance + 자모)
└── cached_repo.py      CachedPoiRepository — PoiDbPort 래퍼 + TTL 정책
```

의존: `m7 → domain·ports`만. 외부 패키지 0 (표준 라이브러리) — test_architecture 자동 감시 대상 추가.

## 2. CandidatePoolBuilder (pool_builder.py)

```
build(request: CandidatePoolRequest, now: datetime) -> CandidatePool
  ① 반경: PoiDbPort.find_by_radius(anchor, r)
         r = override 또는 RADIUS[transport] × (len(dates)>1 ? 0.7 : 1.0)
  ② 예산: avg_cost ≤ limit[budget] (None=통과, HIGH=무제한)
  ③ 영업일: open_hours 비면 통과 / 여행일 중 하루라도 해당 요일 창 있으면 통과
           (is_closed_today 당일 배치는 Plan-B 소유 — batch_check_closed는 후속 연결)
  ④ 품질: quality ∈ {FULL, PARTIAL} (MINIMAL 제외)
  ⑤ 인기: saved_count 내림차순 → rating 내림차순(None=0) → poi_id 오름차순 (결정론 tie-break)
  ⑥ 상한: 상위 max_candidates(5천)
  → CandidatePool(poi_ids=frozenset, pois, generated_at=now, anchor, radius_km=r)
```

- 순수 파이프라인: I/O는 ①의 PoiDbPort 한 번. `now` 주입(결정론 — wall-clock 직접 호출 금지).
- 이 출력이 INV-1 화이트리스트의 원천 — U1 CandidatePool post-init이 정합을 한 번 더 강제.

## 3. EntityResolver (entity_resolver.py, AI-D04)

```
fuzzy_match(name: str, pois: Sequence[Poi], config) -> EntityMatch
  ① 정규화: NFC·소문자·공백 제거
  ② 한글 자모 분해 (성심땅→ㅅㅓㅇㅅㅣㅁㄸㅏㅇ) — 오타가 자모 단위인 한글 특성 반영
  ③ 자모열 Levenshtein → confidence = 1 − dist/max_len
  ④ 최고 confidence 항목 채택 (동률은 poi_id 오름차순 — 결정론)
  ⑤ decision: ≥auto→AUTO / ≥confirm→CONFIRM / 미만→UNRESOLVED(poi_id=None)
```

- LLM 아님 — 완전 결정론(RES-P1). 표준 라이브러리만(unicodedata + 자체 Levenshtein).
- "조용히 고치지 않는다": CONFIRM 결정은 호출측(라우터)이 사용자 확인 UI로 (AI-D04).

## 4. CachedPoiRepository (cached_repo.py)

PoiDbPort 구현체 — 내부에 실 저장소(port)와 CachePort를 받아 TTL 정책 적용:

| 경로 | 정책 |
|---|---|
| `find_by_ids` | 키 `poi:{id}` TTL 24h — **저장은 `to_cacheable_dict()`만**(가격 구조 차단, G195). 캐시 히트 시 avg_cost=None으로 복원(가격은 항상 원본 조회 필요함을 타입이 드러냄) |
| `get_open_window` | 키 `hours:{id}:{dow}` TTL 6h |
| 나머지(find_by_radius 등) | 위임 (공간 쿼리 캐싱은 후속 검토) |

- TTL 값은 M7Config. 시계는 CachePort 구현체 소유(InMemoryCache 논리 시계 — 테스트 결정론).

## 5. Fake·Generator 추가

| 신규 | 용도 |
|---|---|
| `pois_with_attrs()` generator | 반경·예산·영업일·품질 필터를 자극하도록 좌표 거리·avg_cost·open_hours·quality 분포 제어 |
| `SpyCache` | set 호출 기록 — "가격이 캐시에 저장된 적 없다" 단언용 |
| (재사용) InMemoryPoi·InMemoryCache | U1 fake 그대로 |

## 6. 관측 (U1 규칙 승계)

U3는 LLM·어셈블리 호출이 없어 의무 이벤트 없음. 후속(U5)에서 풀 크기·필터 단계별 감소량을 파생 지표로 노출 검토(G192 커버리지 모니터링 입력).
