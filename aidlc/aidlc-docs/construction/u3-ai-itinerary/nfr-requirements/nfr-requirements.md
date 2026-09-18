# U3 AI Itinerary Generation — NFR Requirements

> **방침**: 얇게. U0·U1 NFR과 상속 기반선(50 RPS · 99.9% · 재시도 없음 · 서킷 분리 · stale-if-error · security-baseline Full · PBT blocking)은 **그대로 승계**하고 여기 다시 적지 않는다.
> **FD 중복 금지**: 지연 예산(BR-U3-03) · day1 조기 노출(04·05) · 침묵 실패 금지(11) · INV-3(08) · 저장 대기(16) · 비차단 검증(12) · 재생성 스냅숏(18·19)은 **`business-rules.md`가 정본**이다.
> **결정 근거 (2026-08-07 사용자 지시)**: **`ai/`·`backend/`·`frontend/` 실장을 먼저 확인하고 실장을 우선**, 실장에 근거가 없는 항목만 권장안으로 채웠다. 실장 확인 결과는 각 요구의 "실장" 열에 그대로 적는다.

---

## 1. 비용 (NFR-U3-COST) — 이 스테이지를 도는 주된 이유

**실장 확인 결과**: `ai/`·`backend/` 어디에도 **호출량 상한이 없다.** ai의 `budget`은 여행 예산(`BudgetLevel`)이지 호출 비용이 아니고, backend에는 rate-limit 라이브러리(bucket4j·resilience4j)가 없다. 상한 부재는 "결정된 부재"가 아니라 **미구현**이므로 여기서 도입한다.

| ID | 요구 | 실장 / 근거 |
|---|---|---|
| **COST-U3-01** | **진행 중 생성 세션이 있으면 같은 여행의 재생성 요청을 거부한다**(409). 완료·취소 전에는 재요청 불가 | **실장 근거로 유도** — 생성 지연 예산이 day1 5s / 전체 20s(`RequestMeta.deadlineMs`)이므로 진행 중 거부만으로 **최소 수 초의 자연 쿨다운**이 생긴다. 임의 쿨다운 상수를 새로 만들지 않는다 |
| **COST-U3-02** | 추천 강도 세그먼트 연타는 **UI에서 흡수**한다 — 요청 중 세그먼트 비활성 + 마지막 선택만 반영 | BR-U3-22. 서버 상한 이전에 클라에서 막는 것이 싸다 |
| **COST-U3-03** | 여행당 **일일 재생성 회차 상한**을 둔다. **설정값으로만** 두고 코드·문서에 하드코딩하지 않는다. 초기값 제안 = 20회/일 — **근거 없는 초기값**이며 실사용 관측 후 조정 | BR-U2-15(임계값 하드코딩 금지) 승계 |
| **COST-U3-04** | LLM 토큰 상한은 **C1 실장값을 승계**한다(`max_tokens=1024`, `temperature=0.0`, `timeout_sec=2.5`). U3가 별도 상한을 만들지 않는다 | 실장 `ai/src/trippilot/c1/config.py` |
| **COST-U3-05** | `proposeSlotCandidates`(슬롯 교체)는 생성보다 가볍지만 **슬롯마다 호출 가능**하다. 같은 `slotKey`의 연속 호출은 **클라 캐시로 재사용**하고 반경 변경 시에만 재호출 | BR-U3-25 |

## 2. 성능 (NFR-U3-PERF) — 화면 쪽만

서버 지연 예산은 FD·U2가 이미 소유한다(day1 5s · 전체 20s · OR-Tools 3s · LLM 2.5s). 여기서는 **화면**만 다룬다.

| ID | 요구 | 실장 / 근거 |
|---|---|---|
| **PERF-U3-01** | 시간표 스크롤은 **기본 `FlatList`로 60fps 목표**. 가상화 라이브러리를 새로 도입하지 않는다 | **실장**: `frontend/package.json`에 `@shopify/flash-list` **없음**. 하루 5~10슬롯 × 며칠 규모라 기본 리스트로 충분 |
| **PERF-U3-02** | **슬롯 200개 초과** 시 성능 재평가 — 초과가 실측되면 그때 가상화 도입을 검토한다(도입 트리거) | 재평가 트리거. 미리 도입하지 않음 |
| **PERF-U3-03** | 지도 초기 렌더 **1초 이내** 목표. 지도는 화면당 **WebView 1장**을 넘지 않는다 | **실장**: 지도 = `@/shared/map/KakaoMapView`(react-native-webview + 카카오 JS SDK). WebView 다중 마운트는 비싸다 |
| **PERF-U3-04** | 뷰 전환(시간표 ⇄ 지도)은 **데이터 재요청 없이** 로컬 상태 전환으로 처리 | BR — 같은 데이터 2뷰(US-SCHED-06) |
| **PERF-U3-05** | 총 이동거리·전후 비교 등 클라 계산(PBT-U3-1·3)은 **서버 왕복 없이** 즉시 | UX 사본 |

## 3. 관측 (NFR-U3-OBS)

**실장 확인 결과**: AI는 이미 관측 레코드 **4종**을 발행한다 — `LlmCallRecord`(**input/output 토큰**·latency·success·model_id·feature) · `FallbackEvent`(from_mode→to_mode·reason) · `GateDropEvent`(closed-set 드롭) · `SolverRunRecord`(solve_mode·elapsed_ms·violations_found·repaired). **토큰이 이미 기록되므로 비용 관측은 AI 쪽이 이미 가능하다.** backend는 actuator가 `health,info`만 노출한다.

| ID | 요구 | 실장 / 근거 |
|---|---|---|
| **OBS-U3-01** | AI 관측 4종을 **정본으로 승계**한다. U3가 같은 지표를 다시 만들지 않는다 | 실장 `ai/src/trippilot/domain/observability.py` |
| **OBS-U3-02** | U3가 **새로 발행**하는 것은 **사용자 행동 지표 2종** — 생성 후 **수동 편집률**, **재생성 요청률**. 둘은 backend·frontend에만 존재한다 | U2 BR-U2-13이 O-SOLVER 판정 입력으로 지정 |
| **OBS-U3-03** | 생성 결과 분포(`solveMode` · `isFallback` · `candidatesSummary.level`)를 **저장**해 사후 집계 가능하게 한다 | 폴백률 산출의 원천 |
| **OBS-U3-04** | **임계값을 두지 않는다** — 관측만 하고 판정은 O-SOLVER 회의(BR-U2-14) | BR-U2-15 승계 |
| **OBS-U3-05** | 생성 실패·경계 오류는 기존 에러 관측 경로(`@sentry/react-native` · backend 예외 핸들러)를 재사용한다 | **실장**: Sentry 이미 도입 |

## 4. 데이터·보관 (NFR-U3-DATA)

| ID | 요구 | 실장 / 근거 |
|---|---|---|
| **DATA-U3-01** | `ItineraryRevision.snapshot`은 일정 전체 jsonb라 편집마다 쌓인다 → **itinerary당 최근 50개 유지**, 초과 시 오래된 것부터 정리 | 신설 엔티티(실장 없음) — 권장안 |
| **DATA-U3-02** | **`kind=BASELINE`(AI가 처음 짠 일정)은 정리 대상에서 제외**하고 항상 보존한다 | 화면 h36 최하단 "기준 버전"이 사라지면 되돌릴 원점이 없다 |
| **DATA-U3-03** | 보관 기간·U5 아카이브 이관은 **O-U3-2로 유지**(여기서 정하지 않음) | U5 설계 |
| **DATA-U3-04** | 확정 시 동결한 `poiSnapshotId`는 리비전 정리와 무관하게 보존한다 | INV-U3-05 |

## 5. 오프라인 (NFR-U3-OFFLINE)

**실장 확인 결과**: `@react-native-community/netinfo`가 있어 **연결 상태 감지는 가능**하지만, `@react-native-async-storage/async-storage`도 TanStack Query persist도 **없다** — 즉 **영속 캐시 저장소가 없다**. `expo-secure-store`는 소량 비밀 저장용이라 일정 캐시에 부적합하다.

| ID | 요구 | 실장 / 근거 |
|---|---|---|
| **OFFLINE-U3-01** | **확정 일정(`CONFIRMED`)만 로컬 캐시**한다. 편집은 온라인에서만 | 여행 중 조회는 U4의 전제 |
| **OFFLINE-U3-02** | 편집분 완전 오프라인·충돌 해소는 **1차 제외** | 비용 대비 실익 낮음 |
| **OFFLINE-U3-03** | 저장 실패 시 임시 보관은 BR-U3-16 그대로(메모리·세션 범위) | FD 정본 |
| **OFFLINE-U3-04** | OFFLINE-U3-01 이행에는 **영속 저장소 의존 추가가 필요**하다 → `tech-stack-decisions.md` 델타 2 | 실장 부재 |

## 6. 보안 (NFR-U3-SEC)

| ID | 요구 | 근거 |
|---|---|---|
| **SEC-U3-01** | 일정·리비전은 **객체 수준 인가** — 소유 계정만 접근, 타 계정은 404 | SEC-U1-01 승계 |
| **SEC-U3-02** | 재생성·슬롯 교체 요청은 **여행 소유자 검증 후**에만 AI 경계로 나간다. 경계 호출에 타 사용자 컨텍스트가 섞이지 않는다 | ADR-0015 권한 경계 |
| **SEC-U3-03** | `explanations`·`rationale`은 LLM 생성 텍스트다 — **그대로 렌더하되 HTML/링크 해석은 하지 않는다**(플레인 텍스트) | 인젝션 표면 축소 |

## 7. PBT (blocking 게이트)

`business-rules.md` §8의 **PBT-U3-1~5**를 그대로 승계한다. NFR 관점에서 추가하는 것은 없다.

## 8. 재평가 트리거

| 트리거 | 조치 |
|---|---|
| 슬롯 200개 초과 사례 실측 | 가상화 리스트 도입 검토(PERF-U3-02) |
| 재생성 요청률이 관측 창 대비 뚜렷이 상승 | COST-U3-03 회차 상한값 조정 + O-SOLVER 회의 소집(BR-U2-14) |
| 리비전 스냅숏 저장량이 문제로 실측 | DATA-U3-01 상한값 하향 또는 스냅숏 압축·델타 저장 검토 |
