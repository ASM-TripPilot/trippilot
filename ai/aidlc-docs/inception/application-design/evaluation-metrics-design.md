# 평가 지표 설계 — 최신성(Freshness) · 신속도(Speed)

> C2 솔버의 HC1~HC4 검증은 **합격/불합격(hard)** 게이트다.
> 그 위에 결과 품질을 재는 **핵심 평가 축 2개**를 둔다: **최신성**과 **신속도**.
> 솔버 검증을 통과한 출력이라도 이 두 축에서 점수화되어 모니터링·릴리스 판단에 쓰인다.

---

## 1. 평가 체계 전체 구조

```
                    [Hard Gate — 통과 못 하면 사용자에게 안 나감]
                    C2 solver.validate : HC1~HC4 (기존, 변경 없음)
                    C1 closed-set 게이트 : INV-1 (기존, 변경 없음)
                              |
                              v  통과분에 대해
                    [핵심 평가 축 — 점수화·SLO·릴리스 게이트]
          +-------------------+-------------------+
          |                                       |
   축 1. 최신성 (Freshness)                 축 2. 신속도 (Speed)
   F1 데이터 신선도  F2 결과물 현행성          지연 예산 준수
```

- **hard gate**: 위반 시 그 출력 자체가 폐기·폴백 (기존 설계 유지)
- **평가 축**: 위반이 아니라 **점수** — 낮으면 알람·릴리스 차단·개선 우선순위의 근거

---

## 2. 축 1 — 최신성 (Freshness)

"AI가 **얼마나 새로운 정보로** 판단했고, 결과물이 **지금 상황에 맞는가**." 하위 지표 2개로 나눈다.

### 2.1 F1 — 데이터 신선도 (Input Freshness)

응답 생성에 사용된 각 데이터의 **나이(age)** 를 도메인별 허용 한도와 대비한다.
원천 데이터는 모든 정보 에이전트 응답에 필수인 `FreshnessMeta{source, fetched_at, cache_hit, ttl_sec, stale}` (H-5 규칙).

**도메인별 신선도 한도 (기존 캐싱 정책과 정렬):**

| 데이터 도메인 | 공급자 | 허용 age (max_age) | 근거 |
|---|---|---|---|
| 날씨 예보 | WeatherAgent | 발표 주기 1회분 (약 3~6h) | 기상청 발표 주기, 일 단위 조회 |
| 교통·거리 | TransitAgent | 실시간 요청 시 10분 / 매트릭스 캐시 24h | 지연 트리거는 실시간성 필수 |
| POI 기본 정보 | PlaceScoutAgent | 24h | M7 POI 캐시 정책 |
| 영업시간 | PlaceScoutAgent | 6h | M7 영업시간 캐시 정책 |
| 가격 | PlaceScoutAgent | 캐싱 금지 (항상 원천) | 기존 "가격 캐싱 금지" 정책 |
| 페르소나·저장 장소 | PersonaAgent | 세션 내 (요청 시점 재조회) | D31 서버 재조회 |
| 행사 정보 | EventAgent | 24h | P2 |

**계산:**

```
freshness(d)      = max(0, 1 - age(d) / max_age(d))     # 데이터 1건의 신선도 (0~1)
F1(response)      = min over critical domains            # 응답 단위: 핵심 도메인의 최솟값
                    (Plan-B라면 critical = {날씨, 교통, 영업시간})
```

- **min을 쓰는 이유**: 대안 제안에서 날씨만 6시간 전 것이면 전체가 무의미 — 평균은 이를 가린다
- critical 도메인 집합은 업무별로 다름: 일정 생성 = {POI, 영업시간}, Plan-B = {날씨, 교통, 영업시간}, 회고 = {방문기록(항상 fresh)}

**운영 지표:**

| 지표 | 정의 | 초기 목표 |
|---|---|---|
| `stale_serve_rate` | stale=true 데이터가 포함된 응답 비율 | < 5% |
| `F1_p50 / F1_p10` | 응답 F1 분포 | p50 ≥ 0.8 |
| 도메인별 `age_p95` | 도메인별 데이터 나이 95분위 | 한도 이내 |

### 2.2 F2 — 결과물 현행성 (Output Currency)

생성된 일정·대안이 **응답 시점의 실제 상황**을 반영하는가. 응답 직전 체크리스트로 점수화한다 (각 항목 통과=1, 가중 평균).

| 검사 항목 | 내용 | 적용 대상 |
|---|---|---|
| CUR-1 | 트리거 발생 **이후** 수집된 상황 데이터로 대안을 만들었는가 (`trigger.detected_at < 각 데이터 fetched_at`) | Plan-B |
| CUR-2 | 현재 위치·현재 시각 기준으로 실행 가능한가 (지나간 시각의 슬롯 미포함) | Plan-B, Edit |
| CUR-3 | 포함된 POI가 해당 방문 시각에 영업 중인가 (최신 영업시간으로 재확인) | 전 업무 |
| CUR-4 | `data_status=CLOSED/LOST` POI 미포함 | 전 업무 |
| CUR-5 | 오늘 날씨와 모순되는 배치가 없는가 (호우 특보에 야외 일정 신규 배치 등) | 일정 생성, Plan-B |
| CUR-6 | 이미 방문(completed)·거절한 대안의 재제안이 없는가 | Plan-B |

```
F2(response) = Σ w_i · pass(CUR-i) / Σ w_i        # 업무별 가중치, Plan-B는 CUR-1·2 가중 2배
```

**F2가 낮을 때의 동작**: F2는 평가 축이지만, CUR-2(지나간 시각)·CUR-4(폐업 포함)는 **hard로 승격**되어 솔버 재실행 또는 해당 대안 폐기를 트리거한다 — 나머지는 점수로만 집계.

### 2.3 최신성을 지키는 설계 장치 (측정 → 개선 연결)

- 정보 에이전트가 TTL·재조회 정책을 소유 (agent-hierarchy-design.md) — F1이 낮으면 해당 에이전트의 TTL/폴링 조정
- context_refs 재조회 원칙 (DL-2) — 봉투에 실어 나르는 낡은 스냅샷 원천 차단
- Plan-B의 `force_refresh` — 트리거 검증 시 캐시 우회

---

## 3. 축 2 — 신속도 (Speed)

"요청부터 사용자가 쓸 수 있는 응답까지 **얼마나 빠른가**." 기존 지연 예산(D38, nfr §1.1)을 **측정 가능한 SLO**로 승격한다.

### 3.1 업무별 지연 예산과 SLO

| 업무 | 예산 (기존 확정) | SLO (신규) |
|---|---|---|
| 일정 생성 — day1 | 5초 (독립 TX 우선 반환) | p95 ≤ 5s, 위반율 < 5% |
| 일정 생성 — 전체 | 20초 | p95 ≤ 20s |
| Plan-B 대안 제안 | 10초 | p95 ≤ 10s |
| AI 도우미 첫 응답 | 3초 | p95 ≤ 3s |
| AI 도우미 전체 | 15초 | p95 ≤ 15s |
| Fast Path 조회 | (신규) | p95 ≤ 500ms, LLM 0회 |
| 의도 파악 (CONFIDENT 경로) | (신규) | p95 ≤ 100ms |

### 3.2 구간 분해 측정

`AgentResult.metrics{elapsed_ms, llm_calls, tokens}`와 `trace_id`(delegation §7)로 전 구간을 분해한다:

```
총 지연 = 의도파악 + Plan수립 + Σ(병렬 step의 max)
   step = 정보수집(병렬 max) + LLM 판단 + 솔버 + 조립
```

| 지표 | 정의 | 용도 |
|---|---|---|
| `latency_p50/p95` (업무별) | 요청→응답 | SLO 판정 |
| `budget_burn` | elapsed / deadline | 0.8 초과 시 경고 (예산 임박 경향 탐지) |
| `stage_breakdown` | 구간별 점유율 | 병목 식별 (예: PlaceScout 웹소싱이 60% 차지) |
| `fast_path_ratio` | Fast Path로 처리된 요청 비율 | 높을수록 체감 신속 — 의도파악 CONFIDENT 비중과 연동 |
| `partial_serve_rate` | PARTIAL로 응답한 비율 | 신속도-완전성 트레이드오프 감시 |

### 3.3 신속도-최신성 트레이드오프 규칙

두 축은 충돌한다 (재조회할수록 최신, 캐시 쓸수록 빠름). 충돌 시 우선순위:

| 상황 | 우선 | 근거 |
|---|---|---|
| Plan-B 트리거 검증 | **최신성** (force_refresh) | 낡은 날씨로 만든 대안은 무가치 |
| 일정 생성 (여행 전) | **신속도** (캐시 허용) | 여행 3일 전 영업시간은 6h 캐시로 충분 |
| Fast Path 정보 질의 | 신속도 우선, stale이면 **stale 표시와 함께** 반환 | 침묵 열화 금지 (INV-4 정신) |

---

## 4. 지표 산출 파이프라인 (→ mlops-llmops-design.md)

```
AgentResult(metrics, freshness) + trace_id 구조화 로그
        |
        v
  지표 집계 (배치/스트림) — 업무별·에이전트별·경로별
        |
        +→ 대시보드 (SLO 현황, F1/F2 분포, stage_breakdown)
        +→ 알람 (SLO 위반율, stale_serve_rate 초과)
        +→ 릴리스 게이트 (오프라인 평가셋에서 두 축 회귀 시 배포 차단)
        +→ 개선 루프 (병목 구간·낮은 F1 도메인 → 백로그)
```

- **오프라인**: 평가셋 리플레이 시 최신성은 "기록된 fetched_at" 기준으로 재현 (D37 — 외부 API fake)
- **온라인**: 전 요청 계측 (샘플링 없음 — 로그 비용은 구조화 필드만이라 낮음)

---

## 5. PBT·테스트 연계

| 속성 (신규 제안) | 내용 |
|---|---|
| FRESH-P1 | 정보 에이전트 응답에는 FreshnessMeta가 항상 존재하고 `fetched_at ≤ now` |
| FRESH-P2 | stale=true인 응답은 반드시 폴백 경로 표시(`fallback_level ≥ 1`)와 동행 |
| CUR-P1 | Plan-B 대안 슬롯의 시작 시각은 항상 `now` 이후 (CUR-2의 속성화) |
| CUR-P2 | 출력 슬롯의 POI는 `data_status=ACTIVE`만 (CUR-4의 속성화) |
| SPEED-P1 | 자식 task deadline ≤ 부모 잔여 deadline (DL-4의 속성화) |

기존 PBT 19속성 체계에 추가 — 상세 케이스는 `ai-testing-guide.md` 개정 시 반영(후속).
