# U2 Functional Design — Business Rules

> U2가 강제하는 규칙과 검증(PBT) 매핑. "강제" = 코드 구조상 위반 불가능, "게이트" = CI에서 실패 시 머지 불가.

---

## 1. 4대 불변식의 U2 책임 (U1 business-rules §1의 "상위 유닛" 몫 이행)

| 불변식 | U2에서의 강제 |
|---|---|
| **INV-1** | LLM 2차 제안의 `poi_id ∉ candidates` → 드롭+GateDropEvent. 솔버 출력 POI ⊆ 후보 풀 |
| **INV-2** | **모든 반환 해는 check_all 통과 후에만** — LLM 2차 포함, 검증 우회 반환 경로 없음. solve_mode로 출처 기록(U1 정합 규칙과 결합) |
| **INV-3** | HC2 계산은 `internal_minutes` 사용하되 표시 경로 없음 — U1 `to_public_dict`가 이미 차단, U2는 신규 노출 경로를 만들지 않는다 |
| **INV-4** | 체인 최후의 RuleFallbackSolver는 `required_ms()=0`·항상 해 반환 — solve()가 예외·빈손으로 끝나는 경로 없음. 모든 강등은 FallbackEvent로 관측 |

## 2. 하드 제약 (정본 §4.2 — 게이트 G114: CI 100% 통과)

| ID | 규칙 | 비고 |
|---|---|---|
| HC1 | `start ≥ open ∧ end ≤ close` | OpenHour close>1440(자정 초과) 규칙 포함 |
| HC2 | `prev.end + travel(prev,next) ≤ next.start` | travel = TravelEstimator (버퍼 15분 포함) |
| HC3 | 고정 블록 시각 불변 | RepairEngine도 못 건드림 |
| HC4 | day window 내 · 자정 초과는 시작일 귀속 | 기본 09:00~21:00 |
| — | **예산은 하드 제약 아님** | 소프트 가중치만 (G37/G47, INV-SOLVE3). Violation 코드에 예산 없음 (U1 타입이 이미 HC1~4만 허용) |

## 3. 시한 인지 체인 규칙 (AI-D07) — 신규

| ID | 규칙 |
|---|---|
| DL-1 | `solve(problem, deadline_ms)`는 **deadline을 초과해 반환하지 않는다** (마진 포함 검증) |
| DL-2 | 각 단계는 진입 전 `잔여 ≥ required_ms()` 확인 — 미달 시 실행 없이 스킵 + FallbackEvent(reason="deadline") |
| DL-3 | 잔여 시간은 **ClockPort.monotonic_ms()로만** 계산 — `time.monotonic()` 직접 호출 금지 (테스트 결정론, G116) |
| DL-4 | 단계에 잔여를 전파 — OR-Tools time limit = `min(config 한도, 잔여)` |
| DL-5 | 스킵·강등은 반드시 FallbackEvent — 침묵 스킵 금지 |
| DL-6 | 경로별 deadline은 호출자 소유: day1 5,000ms(D38 무변경) · Plan-B 10,000ms · 백그라운드/regenerate 관대(예: 60,000ms) — U2는 값을 모르고 파라미터로만 받는다 |

## 4. 결정론 규칙 (INV-4·U5-P3)

- 시드: `problem.seed` → OR-Tools random_seed·규칙 점수 rng. 시드 없는 무작위성 금지.
- 시계: ClockPort 주입만. wall-clock을 로직 분기에 사용 금지.
- 동일 (problem, deadline_ms, config, clock 시나리오) → 동일 ItinerarySolution. 단 **OR-Tools의 시간 기반 탐색 편차**는 벤치마크에서 실측 — 편차 발견 시 결정론 모드(고정 iteration)로 강등하는 결정을 벤치마크 절편에서 내린다 (미결 #3의 일부).

## 5. PBT 매핑 (게이트 — 전부 fake 기반, 실 API 0)

| 속성 | 내용 | 상태 |
|---|---|---|
| U5-P1 | 임의 problem에 대해 반환 해는 HC1~4 위반 0 + 소규모(≤8 후보) oracle 전수 대조 일치 | U2 신규 |
| U5-P2 | warm-start: locked_slots의 시각 불변 + 재실행 멱등 | U2 신규 |
| U5-P3 | 동일 입력 → 동일 출력 (시드·시계 고정) | U2 신규 |
| U5-P4 | 이동 추정 결정성 + internal_minutes 미노출 | U1 완료 — U2 estimator로 재검증 |
| U5-P6 | 예산 가중치 단조성: budget↑ ⇒ 저비용 카테고리 보상 단조 | U2 신규 |
| **DL-P1** | 임의 (problem, deadline, clock 시나리오)에서 반환 시각 ≤ deadline | **U2 신규 (AI-D07)** |
| **DL-P2** | 잔여 < 단계 요구 시간 ⇒ 그 단계 미실행 + FallbackEvent 발행 | **U2 신규 (AI-D07)** |
| GATE-P (U5-P5 계열) | 적대적 LLM 제안(후보 밖 id) ⇒ 반환 해에 미포함 + GateDropEvent | U2 신규 (2차 솔버 경로) |

## 6. 벤치마크 게이트 (미결 #3 해소 — U2 첫 절편)

| 항목 | 기준 |
|---|---|
| 조건 | 후보 50 / 500 / 5,000 (G142 규모), 3일 일정, 고정 블록 0~3개 |
| 통과선 | **후보 50에서 day1 배치 ≤ 3,000ms** (U2 성공 기준) + 5,000에서 회귀 없이 완료 |
| 판정 | 통과 → OR-Tools 확정(미결 #3 종결) / 실패 → 자체 휴리스틱 구현으로 전환 결정 |
| 기록 | 결과를 ai-adr.md 미결 #3에 기록 + audit |

## 7. U2 완료 기준 (DoD)

- [ ] 컴포넌트 6종 구현 + 상기 PBT 전부 초록 (기존 52개 유지 포함)
- [ ] 벤치마크 게이트 판정 완료 (미결 #3 종결)
- [ ] 관측 발행 의무 4종 테스트로 검증 (InMemoryTrace)
- [ ] ortools 의존은 c2 계층에만 (test_architecture 확장으로 자동 감시)
