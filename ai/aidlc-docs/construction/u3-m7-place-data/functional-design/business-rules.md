# U3 Functional Design — Business Rules

## 1. 불변식의 U3 책임

| 불변식 | U3 강제 |
|---|---|
| **INV-1** | 후보 풀 = closed-set의 원천. 격리(quarantine) 데이터·게이트 미통과 웹소싱 POI는 파이프라인 진입 자체 불가(입력이 PoiDbPort 정본뿐). 풀 정합은 U1 post-init이 이중 강제 |
| **INV-4** | 전 경로 결정론 — fuzzy 동률 tie-break 고정·인기 정렬 tie-break 고정·now 주입 |
| 가격 캐싱 금지 (G195) | 캐시 저장 경로가 `to_cacheable_dict()`만 사용 — 구조 차단 + SpyCache 테스트 |

## 2. 필터 규칙 (정본 §3.2 확정값 — M7Config 초기값)

| 단계 | 규칙 | 값 |
|---|---|---|
| 반경 | 수단별 + 다일 ×0.7 | WALK 2 / PUBLIC 10 / CAR 20 km |
| 예산 | avg_cost ≤ 상한, **None=통과** (미확인=배제 안 함) | LOW 15,000 / MID 40,000 / HIGH ∞ |
| 영업일 | 여행일 중 하루라도 영업. **open_hours 비면 통과** (U2 checker와 동일 철학) | — |
| 품질 | MINIMAL 제외 | FULL·PARTIAL만 |
| 인기 | rating desc(None=0) → id asc | 결정론 |
| 상한 | 상위 N | 5,000 (G142) |

## 3. 엔티티 해소 규칙 (AI-D04)

- 결정론(RES-P1): 동일 (name, pois) → 동일 EntityMatch. LLM 관여 0
- 정확 일치 → confidence 1.0 · AUTO
- 임계 초기값: AUTO ≥ 0.85 / CONFIRM ≥ 0.60 / 미만 UNRESOLVED — remote config, 캘리브레이션은 후속
- UNRESOLVED → 웹 소싱(AI-D03, U6)으로 위임 — U3는 None 반환까지만

## 4. PBT 매핑 (게이트)

| 속성 | 내용 |
|---|---|
| POOL-P1 | 풀의 모든 poi는 anchor로부터 적용 반경 내 (하버사인 검증) |
| POOL-P2 | 예산 위반 poi 없음 (None 제외) · MINIMAL 없음 · 크기 ≤ 상한 |
| POOL-P3 | 결정론: 동일 (request, 저장소 상태, now) → 동일 풀 |
| POOL-P4 | 여행일 전체 휴무(요일 창 없음) poi는 풀에 없음 |
| **RES-P1** | fuzzy_match 결정론 + 정확 일치 confidence=1.0/AUTO |
| RES-P2 | 반환 decision과 confidence 임계 정합 (경계 포함) |
| CACHE-P1 | 어떤 입력 시퀀스에도 SpyCache에 avg_cost 키 저장 0건 |
| CACHE-P2 | TTL 만료 후 재조회는 원본 재호출 (InMemoryCache 논리 시계) |
| (승계) U5-P10 | CandidatePoolRequest·EntityMatch·보강된 CandidatePool 직렬화 왕복 |

## 5. DoD

- [ ] m7 3컴포넌트 + config 구현, 위 PBT 전부 초록 (기존 76 유지)
- [ ] m7 계층 순수성(외부 패키지 0) test_architecture 확장
- [ ] 성공 기준(unit-of-work U3): 필터 동작·해소 결정론·frozenset O(1)·가격 미캐싱 확인
