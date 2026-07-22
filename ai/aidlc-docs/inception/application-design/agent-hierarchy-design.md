# Agent 계층 세분화 설계 — 2계층 멀티에이전트 (업무 계층 + 정보 계층)

> `agent-redesign.md`(업무 기준 4종)를 **대체하지 않고 확장**하는 추가 설계.
> 업무 에이전트 4종은 그대로 유지하고, 그 아래에 **정보 수집 전담 에이전트 계층**을 신설한다.

---

## 1. 배경과 원칙

### 왜 쪼개는가

현재 설계에서 후보 조회(`m7.*`), 날씨, 교통(거리 추정)은 **수동적인 도구(tool)** 다.
도구는 호출되면 실행만 하고 끝난다 — 데이터가 오래됐는지, 부족한지, 폴백해야 하는지는 호출한 쪽(업무 에이전트)이 전부 판단해야 한다.

정보 수집을 **판단력 있는 에이전트로 승격**하면:

1. **판단의 소유권 이동** — "후보가 부족한가? 웹 소싱을 돌릴까?"는 PlaceScoutAgent가, "이 예보가 트리거 조건인가?"는 WeatherAgent가 스스로 판단
2. **캐싱·신선도 관리 일원화** — 각 정보 도메인의 TTL·재조회 정책을 그 에이전트가 소유 (→ `evaluation-metrics-design.md`의 최신성 지표와 연결)
3. **업무 에이전트 슬림화** — ScheduleAgent는 "후보 확보"를 한 번의 위임으로 끝냄
4. **Fast Path 확장** — "내일 날씨 어때?" 같은 단순 정보 질의를 Orchestrator가 정보 에이전트 직접 호출로 처리

### 유지되는 원칙 (agent-redesign.md 계승)

- 에이전트 = 특정 일에 특화된 end-to-end 비서
- 에이전트별 Tool 제한 (토큰 절감)
- 각 에이전트가 자기 폴백 계단 소유 (INV-4)
- C2 Solver는 여전히 에이전트가 아님 — 시각·순서 확정은 결정론 컴포넌트 (INV-2)

---

## 2. 전체 구조

```
사용자 입력 (자연어 / 이벤트 / 버튼)
        |
        v
+------------------+
|   Orchestrator   |  의도 파악 + 복잡도 판단 + Execution Plan
+------------------+
        |
        |-- Fast Path: 단순 조회는 직접 처리
        |     (정보 질의는 정보 에이전트 1개 직접 호출 포함)
        |
        v  Delegate
+-----------------------------------------------------------+
| [업무 계층 — Task Agents]                                   |
| ScheduleAgent | PlanBAgent | ReflectAgent | EditAgent       |
| 일정 생성      | 변수 대응   | 회고 생성     | 일정 편집      |
+-----------------------------------------------------------+
        |
        |  정보가 필요하면 정보 에이전트에 위임 (병렬 가능)
        v
+-----------------------------------------------------------+
| [정보 계층 — Info Agents]                                   |
| PlaceScoutAgent | WeatherAgent | TransitAgent               |
| 장소 탐색        | 날씨(일단위)  | 교통·이동                  |
| PersonaAgent    | EventAgent                                |
| 사용자 페르소나   | 행사·축제(후순위)                          |
+-----------------------------------------------------------+
        |
        v
+-----------------------------------------------------------+
| [코어/인프라 — 에이전트 아님]                                 |
| C1 LLM Gateway | C2 Solver | M7 Place Data | pgvector       |
| 외부 API 어댑터 (기상청, 카카오모빌리티, 네이버, TourAPI)      |
+-----------------------------------------------------------+
```

### 계층 규칙

| # | 규칙 | 이유 |
|---|---|---|
| H-1 | 업무 에이전트는 정보 에이전트를 **agent-as-tool**로 호출한다 (도구 목록에 정보 에이전트가 함수처럼 등록) | 기존 Tool 제한(토큰 절감) 체계를 그대로 재사용 |
| H-2 | 정보 에이전트는 **다른 에이전트를 호출하지 않는다** (계층 최하단, 코어/외부 API만 접근) | 순환 위임 금지, 깊이 2 고정 → 지연 상한 예측 가능 |
| H-3 | 정보 에이전트는 **쓰기(일정 변경)를 하지 않는다** — 읽기·수집·정제·판정만 | 상태 변경 권한은 업무 계층+솔버 경유로 일원화 (INV-2) |
| H-4 | Orchestrator는 Fast Path에서 정보 에이전트를 **1개까지** 직접 호출 가능. 2개 이상 조합이 필요하면 업무 에이전트로 위임 | Fast Path의 "도구 1~2개" 기준 유지 |
| H-5 | 정보 에이전트의 모든 응답에는 `freshness` 메타(수집 시각, 캐시 여부, 출처)가 필수 | 최신성 지표 측정 기반 (→ evaluation-metrics-design.md) |
| H-6 | 같은 외부 API는 하나의 정보 에이전트만 소유 ("1 외부 API = 1 소유 에이전트") | 기획 정본의 Port/Adapter 소유 규칙(architecture.md)과 정렬 |

---

## 3. 정보 에이전트 5종

### 3.1 PlaceScoutAgent — "장소 탐색 비서"

| 항목 | 내용 |
|---|---|
| **업무** | 조건에 맞는 장소(POI) 후보를 **충분히, closed-set으로** 확보해 주는 것 |
| **호출자** | ScheduleAgent(후보 풀), PlanBAgent(대안 후보), EditAgent(엔티티 해소·추가 후보), Orchestrator Fast Path(단일 POI 조회) |
| **end-to-end 흐름** | ① 요청 조건 해석(반경·예산·카테고리·제외 목록) → ② M7 후보 풀 조회 → ③ **충분성 판단**(개수·다양성) → ④ 부족 시 웹 소싱(`m7.source_web`, 수집 게이트 5단) → ⑤ 신규 POI는 M7 등록 후에만 후보화(INV-1) → ⑥ 후보 세트 + 신선도 메타 반환 |
| **할당 Tool** | `m7.get_candidates`, `m7.source_web`, `m7.resolve_entity`, `m7.get_poi_detail` |
| **판단하는 것** | 후보 충분성(카테고리별 최소 개수), 웹 소싱 발동 여부(비용·지연 트레이드오프), 엔티티 애매성(후보 2개 이상 → 확인 요청 신호) |
| **폴백** | 웹 소싱 실패 → M7 후보만으로 진행 + `sufficiency: LOW` 표시. M7 자체 실패 → 캐시 스냅샷 → 그것도 없으면 `NO_CANDIDATES` (호출자가 폴백 계단 진행) |
| **불변식** | INV-1의 1차 관문 — 이 에이전트를 거치지 않은 POI는 후보가 될 수 없다 |

### 3.2 WeatherAgent — "날씨 비서"

| 항목 | 내용 |
|---|---|
| **업무** | 여행 지역·일자별 날씨 정보를 **일 단위(daily)** 로 제공하고, Plan-B 날씨 트리거를 감지하는 것 |
| **호출자** | PlanBAgent(KB-3 상황 데이터), ScheduleAgent(생성 시 실내/실외 비중 참고), Orchestrator Fast Path("내일 날씨 어때?"), 트리거 스케줄러(주기 폴링) |
| **end-to-end 흐름** | ① 대상 지역+일자 확정 → ② 캐시 확인(TTL 내면 캐시 반환) → ③ 기상청 API 일 단위 조회 → ④ 정규화(강수확률·강수형태·기온·특보) → ⑤ **트리거 판정**(강수확률 80%↑ 등) → ⑥ DailyWeather + 트리거 신호 반환 |
| **호출 주기** | **일 단위 사전 조회** — 매일 아침(및 예보 갱신 시각) 해당 여행일 예보를 당겨와 캐시. 업무 에이전트는 원칙적으로 캐시를 읽고, 트리거 판정 시에만 강제 재조회(`force_refresh`) |
| **할당 Tool** | `weather.fetch_daily`(기상청 어댑터), `weather.get_cached`, `weather.check_trigger` |
| **판단하는 것** | 재조회 필요 여부(예보 발표 시각 경과), 트리거 조건 충족 여부, 특보(호우·태풍) 시 심각도 등급 |
| **폴백** | 기상청 API 실패 → 마지막 캐시 + `stale: true` → 캐시도 없으면 `WEATHER_UNKNOWN`(Plan-B 날씨 트리거 비활성, 일정 생성은 날씨 미반영으로 진행). 침묵 실패 금지 — 항상 신선도 메타로 상태 노출 |
| **불변식** | INV-4 — 날씨 없음이 기능 전체를 막지 않는다 (날씨는 soft 신호) |

### 3.3 TransitAgent — "교통 비서"

| 항목 | 내용 |
|---|---|
| **업무** | 지점 간 이동 정보(도로 거리·경로)를 제공하고, 이동 지연 트리거를 감지하는 것 |
| **호출자** | PlanBAgent(지연 상황 파악·대안 거리 비교), Orchestrator Fast Path("다음 장소까지 얼마나 걸려?"→ **거리로 응답**, INV-3), 트리거 스케줄러(위치 Tick 기반 지연 감지). **C2 Solver는 호출자가 아님** — 아래 경계 참조 |
| **end-to-end 흐름** | ① 출발·도착(또는 현재 위치+다음 슬롯) 확정 → ② 캐시 확인 → ③ 어댑터 체인 조회(카카오모빌리티 → 네이버 → 직선거리×1.3) → ④ 거리·경로 정규화 → ⑤ 지연 판정(예정 대비 30분+ 지연) → ⑥ TransitInfo + 트리거 신호 반환 |
| **할당 Tool** | `transit.get_route`(어댑터 체인), `transit.get_distance_matrix`, `transit.check_delay` |
| **판단하는 것** | 어댑터 폴백 전환 시점, 지연 트리거 충족 여부, 매트릭스 조회 시 API 호출 수 절약(캐시 조합) |
| **폴백** | 카카오 실패 → 네이버 → 직선거리×1.3 (항상 값 반환, 신뢰도 등급만 하락: `HIGH/MID/LOW`) |
| **⚠ C2와의 경계** | 솔버가 배치 계산 중 쓰는 이동시간 추정은 **기존대로 C2 내부의 `solver.estimate_travel`(동일 어댑터 체인)** 을 사용한다. TransitAgent는 같은 `TravelEstimatePort` 인프라를 **공유**하되, 소비 목적이 다르다 — C2는 "배치 계산용", TransitAgent는 "정보 제공·트리거 감지용". 사용자에게 보이는 시각·순서는 여전히 솔버 검증값만 (INV-2). 사용자 표시용 응답은 **거리만** 노출 (INV-3) |

### 3.4 PersonaAgent — "페르소나 비서"

| 항목 | 내용 |
|---|---|
| **업무** | "이 사용자는 어떤 여행자인가"를 답해주는 것 — 저장 장소, 선호 패턴, 거절 이력의 조회·검색·요약 |
| **호출자** | PlanBAgent(KB-2 retrieve 전담 위임), ScheduleAgent(선호 점수의 개인화 컨텍스트), ReflectAgent(추후 C 확장 — 스타일 분석 시) |
| **end-to-end 흐름** | ① 요청 목적 파악(대안 소싱용? 점수 컨텍스트용?) → ② 저장 장소 조회(구조화 DB) → ③ 벡터 유사도 검색(pgvector: 장소 메모·방문 리뷰·과거 Plan-B 결과) → ④ 거절 이력 필터(과거에 거절한 유형 감점/제외) → ⑤ PersonaContext 반환 |
| **할당 Tool** | `kb.retrieve_persona`(구조화), `kb.vector_search`(pgvector), `kb.get_rejection_history` |
| **판단하는 것** | 데이터 충분성(신규 유저 → 콜드스타트 표시), 검색 질의 구성(상황을 벡터 질의로 변환), 요약 수준(호출 목적별로 다르게) |
| **폴백** | 벡터 검색 실패 → 구조화 데이터(저장 장소·카테고리 통계)만 → 그것도 없으면 `COLD_START`(일반 인기 기반으로 진행) |
| **효과** | 기존 PlanBAgent의 `kb.retrieve_persona` + 벡터 스토어 접근이 이 에이전트로 이동 → PlanBAgent 도구 수 감소, ScheduleAgent도 개인화 컨텍스트를 같은 경로로 획득 (중복 제거) |

### 3.5 EventAgent — "행사 비서" (후순위)

| 항목 | 내용 |
|---|---|
| **업무** | 여행 지역·기간의 축제·행사 정보를 수집해 후보 신호로 제공하는 것 |
| **호출자** | ScheduleAgent(일정 생성 시 기간 내 행사 반영), PlanBAgent(대안으로 행사 제안) |
| **end-to-end 흐름** | ① 지역+기간 확정 → ② TourAPI 행사 조회 → ③ 기간·운영시간 필터 → ④ **M7 등록 게이트 경유**(행사도 POI로 등록되어야 후보 자격, INV-1) → ⑤ EventInfo 반환 |
| **할당 Tool** | `event.fetch_festivals`(TourAPI 어댑터), `m7.register_event_poi`(수집 게이트 경유) |
| **판단하는 것** | 행사-여행기간 겹침, 상설/일회성 구분, 후보 등록 가치(품질 필터) |
| **폴백** | TourAPI 실패 → 행사 없이 진행 (`events: []` + `stale` 표시). 행사는 부가 신호 — 실패가 일정 생성을 막지 않음 |
| **우선순위** | **후순위(P2)** — MVP는 PlaceScout/Weather/Transit/Persona 4종 먼저. EventAgent는 인터페이스만 정의해두고 구현 유예 |

---

## 4. Tool 재배치 — 개정 할당표

정보 수집 도구가 정보 에이전트로 이동하고, 업무 에이전트의 도구 목록에는 **정보 에이전트가 agent-as-tool로 등록**된다.

### 업무 계층 (개정)

| Tool / Info-Agent | Schedule | PlanB | Reflect | Edit | Orchestrator |
|---|---|---|---|---|---|
| **`agent.place_scout`** | O | O | - | O | O (Fast Path, 단일 조회) |
| **`agent.weather`** | O | O | - | - | O (Fast Path) |
| **`agent.transit`** | - | O | - | - | O (Fast Path) |
| **`agent.persona`** | O | O | (추후) | - | - |
| **`agent.event`** | (P2) | (P2) | - | - | - |
| `llm.score_preferences` | O | - | - | - | - |
| `llm.explain_slot` | O | - | - | - | - |
| `llm.select_alternatives` | - | O | - | - | - |
| `llm.generate_reflection` | - | - | O | - | - |
| `llm.analyze_style` | - | - | (추후) | - | - |
| `llm.parse_intent` | - | - | - | O | - |
| `kb.retrieve_schedule` | - | O | - | - | - |
| `kb.retrieve_situation` | - | O | - | - | - |
| `solver.solve` | O | O | - | - | - |
| `solver.validate` | O | O | - | O | O (Fast Path) |
| `solver.repair` | - | - | - | O | - |
| `db.get_visit_history` | - | - | O | - | - |
| `db.get_current_schedule` | - | - | - | - | O (Fast Path) |

> 변경 요점:
> - `m7.get_candidates`·`m7.source_web`·`m7.resolve_entity`는 업무 계층에서 **제거** → PlaceScoutAgent 내부로
> - PlanBAgent의 `kb.retrieve_persona`는 PersonaAgent로 이동. `kb.retrieve_situation`은 WeatherAgent(날씨)+TransitAgent(위치·이동)가 공급하는 데이터의 **조립 접근자**로 축소
> - ScheduleAgent에 `agent.persona` 추가 — 선호 점수의 개인화 컨텍스트를 PlanB와 같은 경로로 획득

### 정보 계층 (신설)

| Tool | PlaceScout | Weather | Transit | Persona | Event |
|---|---|---|---|---|---|
| `m7.get_candidates` | O | - | - | - | - |
| `m7.source_web` | O | - | - | - | - |
| `m7.resolve_entity` | O | - | - | - | - |
| `m7.get_poi_detail` | O | - | - | - | - |
| `m7.register_event_poi` | - | - | - | - | O |
| `weather.fetch_daily` | - | O | - | - | - |
| `weather.get_cached` | - | O | - | - | - |
| `weather.check_trigger` | - | O | - | - | - |
| `transit.get_route` | - | - | O | - | - |
| `transit.get_distance_matrix` | - | - | O | - | - |
| `transit.check_delay` | - | - | O | - | - |
| `kb.retrieve_persona` | - | - | - | O | - |
| `kb.vector_search` | - | - | - | O | - |
| `kb.get_rejection_history` | - | - | - | O | - |
| `event.fetch_festivals` | - | - | - | - | O |

**토큰 절감 유지**: 정보 에이전트는 도구 3~5개의 초경량 에이전트. 업무 에이전트는 도구 수가 오히려 줄어듦(예: ScheduleAgent 6→7이지만 이 중 4개가 단일 함수 시그니처의 agent-as-tool이라 스키마 토큰은 감소).

---

## 5. 실행 흐름 예시 (개정)

### 일정 생성 (ScheduleAgent)

```
ScheduleAgent
  [병렬] agent.place_scout(조건)     ← 후보 확보 (충분성·웹소싱 판단은 Scout이)
        + agent.weather(지역, 기간)   ← 기간 날씨 (실내/실외 비중 참고)
        + agent.persona(user, 목적=점수컨텍스트)
  [대기] 완료
  [순차] llm.score_preferences(후보, 페르소나 컨텍스트)
  [순차] solver.solve(day별 배치)    ← 이동시간은 C2 내부 추정 사용
  [순차] llm.explain_slot(배치 결과)
  [조립] 응답 (day1 5초 우선 반환 정책 유지)
```

### Plan-B (PlanBAgent) — RAG의 Retrieve 단계가 정보 에이전트로 위임됨

```
PlanBAgent
  [순차] kb.retrieve_schedule        ← 영향 슬롯 추출 (KB-1)
  [병렬] agent.weather(force_refresh)  ← KB-3 상황 (트리거 사유 검증)
        + agent.transit(현위치→다음슬롯) ← KB-3 상황 (지연 정도)
        + agent.persona(목적=대안소싱)   ← KB-2 (저장 장소 1순위 + 선호 벡터)
        + agent.place_scout(현위치 반경, 실내 필터, 방문 제외)
  [대기] 완료 → Augment(프롬프트 조립, closed-set)
  [순차] llm.select_alternatives(A/B/C)
  [병렬] solver.solve(A) + solver.solve(B) + solver.solve(C)
  [조립] HC 통과 대안만 + 전/후 비교 → 제안 (자동 변경 없음)
```

### Fast Path (Orchestrator 직접)

```
"내일 날씨 어때?"      → agent.weather(내일, 여행지역) → 포맷 → 응답
"다음 장소까지 멀어?"   → agent.transit(현위치→다음슬롯) → 거리만 표시(INV-3)
"OO카페 영업시간은?"   → agent.place_scout(단일 POI 조회) → 응답
```

---

## 6. 폴백 계단 (계층 반영 개정)

정보 에이전트는 **자기 도메인의 폴백**을 소유하고, 업무 에이전트는 **업무 수준의 폴백**만 소유한다.

```
[정보 계층 폴백 — 각자 소유]
PlaceScout : 웹소싱 실패 → M7만 / M7 실패 → 캐시 → NO_CANDIDATES
Weather    : API 실패 → stale 캐시 → WEATHER_UNKNOWN (soft 신호라 진행 가능)
Transit    : 카카오 → 네이버 → 직선×1.3 (항상 값 반환, 신뢰도 하락)
Persona    : 벡터 실패 → 구조화만 → COLD_START
Event      : API 실패 → 행사 없음으로 진행

[업무 계층 폴백 — 기존 유지]
Schedule   : LLM 실패 → 규칙 점수 / 전체 실패 → 최소 일정
PlanB      : 후보 0 → 휴식모드 / 솔버 전멸 → 수동 편집 안내
Reflect    : LLM 실패 → FallbackCard(통계)
Edit       : 해석 실패 → 직접 편집 안내 / 검증 실패 → 미리보기 강등
```

규칙: **정보 에이전트의 실패 신호(`NO_CANDIDATES`, `WEATHER_UNKNOWN`, `COLD_START`)는 예외가 아니라 정상 응답의 상태값**이다. 업무 에이전트는 이 상태값을 보고 자기 폴백 계단을 진행한다. 침묵 실패 금지(INV-4)가 계층 간에도 유지된다.

---

## 7. 불변식 유지 확인 (계층 도입 후)

| 불변식 | 2계층 구조에서 유지 방법 |
|---|---|
| INV-1 (closed-set) | 후보 공급 경로가 PlaceScoutAgent로 **단일화** — 오히려 강화. 웹 소싱·수집 게이트·M7 등록이 한 에이전트 안에서 순서 보장. EventAgent도 M7 등록 게이트 경유 필수 |
| INV-2 (솔버 검증값만) | 정보 에이전트는 쓰기 금지(H-3). 시각·순서는 여전히 C2만 확정. TransitAgent 정보는 "참고 데이터"이지 사용자 표시 시각이 아님 |
| INV-3 (거리만 표시) | TransitAgent의 사용자 표시용 응답 스키마에 `duration` 필드 없음 (내부 트리거 판정용 시간값은 `internal_` 접두 + Display 타입에서 제외) |
| INV-4 (결정론 폴백) | 폴백 계단이 계층별로 분리 소유 — 각 정보 에이전트가 자기 도메인 폴백 + 상태값 반환, 업무 에이전트가 업무 폴백 |

---

## 8. 단계적 도입 순서

| 단계 | 내용 | 근거 |
|---|---|---|
| 1차 (MVP) | **PlaceScoutAgent, WeatherAgent** | Schedule·PlanB 핵심 경로에 즉시 필요. Weather는 Plan-B 트리거의 최다 빈도 사유 |
| 2차 | **TransitAgent, PersonaAgent** | Transit은 지연 트리거·Fast Path용 (C2 내부 추정은 이미 동작). Persona는 PlanB RAG 품질 향상 |
| 3차 (P2) | **EventAgent** | 부가 신호. 인터페이스만 먼저 정의 |

---

## 9. 관련 문서

- 업무 에이전트 4종 원 설계: `agent-redesign.md`
- 위임 프로토콜(Envelope): `orchestrator-delegation-design.md`
- 에이전트 입출력 계약: `agent-io-contracts.md`
- 최신성·신속도 지표: `evaluation-metrics-design.md`
- 기획 정본: `../../../../docs/planning/architecture.md` (모듈 경계·Port 소유 규칙)
