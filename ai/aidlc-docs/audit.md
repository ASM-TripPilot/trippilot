# AI-DLC Audit Log

## Session Start
**Timestamp**: 2026-07-12T00:00:00Z
**User Input**: "ai dlc이용해서 inception과 convention을 지금 있는 repository에 만들고 싶어."
**AI Response**: AI-DLC 워크플로우를 시작합니다. Welcome Message 표시 후 Workspace Detection 실행.
**Context**: 사용자가 AI DLC inception 및 construction 프레임워크 구축을 요청

---

## Workspace Detection
**Timestamp**: 2026-07-12T00:01:00Z
**User Input**: (없음 - 자동 실행 단계)
**AI Response**: Workspace Detection 완료. Brownfield 프로젝트 (설계 문서 존재, 소스 코드 없음). Reverse Engineering 단계로 진행.
**Context**: 
- 소스 코드: 없음
- 설계 문서: ai-architecture.md, ai-implementation-design.md, ai-data-design.md, ai-prompt-design.md, ai-testing-guide.md, ai-adr.md
- 프로그래밍 언어 (설계 대상): Python
- 프로젝트 구조: Multi-component AI Service (C1 LLM Gateway + C2 Solver Engine + M7 Place Data)
- 결정: Brownfield로 취급, Reverse Engineering 실행

---

## Reverse Engineering
**Timestamp**: 2026-07-12T00:05:00Z
**User Input**: (없음 - Workspace Detection 후 자동 진행)
**AI Response**: Reverse Engineering 완료. 기존 설계 문서 6개를 분석하여 8개 산출물 생성.
**Context**: 
- 분석 대상: ai-architecture.md, ai-implementation-design.md, ai-data-design.md, ai-prompt-design.md, ai-testing-guide.md, ai-adr.md
- 생성 산출물: business-overview.md, architecture.md, code-structure.md, api-documentation.md, component-inventory.md, technology-stack.md, dependencies.md, code-quality-assessment.md
- 프로젝트 특성: LLM + 솔버 하이브리드, Python AI 서비스, 4대 불변식, PBT 12+ 속성
- 사용자 승인 대기 중

---

## Reverse Engineering — User Approval
**Timestamp**: 2026-07-12T00:08:00Z
**User Input**: "나는 ai engineer담당이야. 그래서, 지금까지의 설계를 가지고 plan과 requirements만들어줘. ai쪽 관련해서만. \"ai-\"이렇게 시작하는 파일들과 방금 너가 reverse-engineering에다가 만든 파일가지고 만들어줘. 그리고 ai- 로 시작하는 문서들을 구조화해야할거 같아. 그것도 해줘"
**AI Response**: 사용자 승인 확인. AI Engineer 역할로 Requirements Analysis + Workflow Planning 진행, ai- 문서 구조화 추가.
**Context**: 사용자는 AI Engineer 담당. Reverse Engineering 승인 + Requirements/Plan 생성 요청 + ai- 문서 구조화 요청

---

## Design Artifacts Structuring
**Timestamp**: 2026-07-12T00:09:00Z
**User Input**: (위 요청의 일부)
**AI Response**: ai- 문서 6개를 aidlc-docs/inception/design-artifacts/에 복사 정리. README.md 인덱스(계층 L1~L6, 의존 관계 Mermaid, 역할·읽는 시점) 생성.
**Context**: 루트 원본 유지, aidlc-docs 내에서 참조 가능하도록 구조화

---

## Requirements Analysis
**Timestamp**: 2026-07-12T00:10:00Z
**User Input**: (위 요청의 일부)
**AI Response**: requirements.md 생성 완료. AI 서비스(C1+C2+M7) 관점.
**Context**: 
- 기능 요구사항: FR 5그룹 (C2 Solver 8개, C1 Gateway 11개, M7 PlaceData 8개, API Layer 3개, Orchestration 3개)
- 비기능 요구사항: NFR 6그룹 (성능 6, 신뢰성 5, 보안 5, 테스트 5, 관측 5, 확장성 4)
- 아키텍처 제약: 4대 불변식 (INV-1~4)
- 구현 우선순위: Phase 1(Core) → Phase 2(LLM Integration) → Phase 3(Extended)
- Open Items: 6개 (LLM 벤더, 솔버 라이브러리, 프로토콜, Places API, 택소노미, fuzzy 임계)

---

## Workflow Planning
**Timestamp**: 2026-07-12T00:15:00Z
**User Input**: (위 요청의 일부)
**AI Response**: execution-plan.md 생성 완료.
**Context**:
- 실행 단계: Application Design → Units Generation → Functional Design(per-unit) → NFR Requirements → Code Generation(per-unit) → Build and Test
- SKIP: NFR Design, Infrastructure Design
- 유닛 분해: U1(Domain&Ports) → U2(C2 Solver) / U3(M7) / U4(C1 Gateway) → U5(Orchestration&API) → U6(Extended)
- 예상 소요: 22~31일 (1인 AI Engineer)
- 리스크: LLM 벤더 미확정, 솔버 5초 게이트 불확실
- 완화: Port 격리 + fake로 벤더 독립 개발

---

## Application Design
**Timestamp**: 2026-07-12T00:20:00Z
**User Input**: "아냐 아냐 만들어줘"
**AI Response**: Application Design 3개 문서 생성 완료.
**Context**:
- components.md: C1(6모듈)·C2(6모듈)·M7(6모듈)·API(4모듈)·Ports(5종)·Domain. 내부 흐름 다이어그램 + 의존 규칙
- component-methods.md: 전 컴포넌트 공개/내부 메서드 시그니처 + 비즈니스 규칙 테이블 형태
- services.md: 일정 생성·AI도우미·Plan-B·웹소싱 오케스트레이션 4종. 정상/에러 경로, 상태 전이, 타임아웃·서킷·계측·rate-limit 횡단 관심사

---

## Units Generation
**Timestamp**: 2026-07-12T00:25:00Z
**User Input**: "진행해줘~"
**AI Response**: Units Generation 3개 문서 생성 완료. INCEPTION 전체 완료.
**Context**:
- unit-of-work.md: 6유닛 상세 정의 (범위·산출물·성공기준·소요·리스크)
- unit-of-work-dependency.md: 의존 그래프 + 병렬 영역(U2/U3/U4 완전 병렬) + 임계 경로(21일) + 계약 변경 영향
- unit-of-work-story-map.md: 유닛별 FR/NFR 매핑 + PBT 속성 19개 배정
- INCEPTION 전체 완료: Workspace Detection → Reverse Engineering → Requirements → Workflow Planning → Application Design → Units Generation

---

## CONSTRUCTION — U1 Functional Design (Plan 생성)
**Timestamp**: 2026-07-14T00:00:00Z
**User Input**: "U1 설계에 LLMOps 요구사항 반영해서 시작해줘"
**AI Response**: U1 Functional Design Plan + 질문지 9개 생성 (LLMOps 반영).
**Context**:
- claude_.md(커리어 목표) 기반 LLMOps 요구사항을 U1 범위에 선반영: 관측 도메인 타입(LlmCallRecord·FallbackEvent·GateDropEvent), TracePort, PromptRef(프롬프트 버저닝), Eval 타입(EvalCase/EvalRun/EvalScore)
- 근거: U1은 전 유닛의 타입 기반 — 계측/eval 타입 누락 시 U2~U6 재작업 필요. NFR-5.1~5.4의 타입 선행 정의
- 플랜: aidlc-docs/construction/plans/u1-domain-ports-functional-design-plan.md
- 질문 9개 [Answer]: 태그 — 사용자 답변 대기 중

---

## CONSTRUCTION — U1 Functional Design (산출물 생성)
**Timestamp**: 2026-07-14T01:00:00Z
**User Input**: "전부 권장안으로 진행해줘"
**AI Response**: 질문 9개 권장안 확정 → Functional Design 산출물 3종 생성.
**Context**:
- 확정: TracePort 단일 통합 / Eval 타입 U1 포함 / 프롬프트 파일+git 버저닝 / frozen dataclass / typing.Protocol / uv / ExecutionPlan 포함 / tz-aware datetime / NFR-7 등록
- requirements.md: NFR-7 (LLMOps) 4항목 신설 (7.1 관측 이벤트 타입, 7.2 TracePort, 7.3 프롬프트 버저닝, 7.4 Eval 타입)
- domain-entities.md: 도메인 타입 10개 모듈 (공통·poi·itinerary·travel·trigger·edit·llm·execution + LLMOps 3모듈: observability·prompt·evals)
- business-logic-model.md: Port 7종 계약 (LlmPort는 토큰·레이턴시 메타 필수 반환) + Fake 7종 (InMemoryTrace 포함) + Hypothesis generator 목록
- business-rules.md: INV-1~4 타입 수준 강제 지점, 관측 이벤트 발행 의무 규칙, 프롬프트 버저닝·eval 규칙
- 승인 대기 중

---

## INCEPTION 보강 — Application Design 심화 6종
**Timestamp**: 2026-07-16T00:00:00Z
**User Input**: "멀티에이전트 세분화(관광지/날씨/교통 등), FE-BE-Agent 입출력 대응, Orchestrator 위임 방식, 유사질문 기반 의도파악, 최신성·신속도 평가지표, MLOps/LLMOps 세팅 + ML 패턴 유형화"
**AI Response**: application-design/ 신규 설계 문서 6종 생성 (기존 구조 유지, 추가식 확장).
**Context**:
- 사용자 확정: 정보 에이전트 5종 전부(PlaceScout/Weather/Transit/Persona/Event) / 2계층 구조(업무 계층 하위 정보 계층) / 의도파악 하이브리드 / 최신성 = 데이터 신선도 + 결과물 현행성
- agent-hierarchy-design.md: 2계층 세분화 — 정보 에이전트 5종, 계층 규칙 H-1~H-6, Tool 재배치, 폴백 계단 분리, 도입 순서(1차 PlaceScout·Weather)
- agent-io-contracts.md: FE 화면(d/e/f밴드) ↔ BE(전체-최소-스키마·API서피스) ↔ Agent I/O 대응표 + 에이전트별 Input/Output DTO + FreshnessMeta + 공통규약 IO-1~7. INV-3 vs 와이어프레임 시간표기 상충 플래그
- orchestrator-delegation-design.md: AgentTask/AgentResult 표준 봉투, context_refs 참조 전달(D31), deadline 상속, 라우팅 테이블, 실패·재시도 정책
- intent-matching-design.md: 질문뱅크 임베딩 매칭(1차) → LLM 유사질문 생성·가중 투표(2차) → LLM 직접 분류(3차), 뱅크 구축 3단계 + 위생 규칙
- evaluation-metrics-design.md: 최신성(F1 데이터 신선도 + F2 결과물 현행성 CUR-1~6) · 신속도(지연 예산 SLO 승격 + 구간 분해), 트레이드오프 우선순위, 신규 PBT 속성 5개 제안
- mlops-llmops-design.md: LLMOps(프롬프트 레지스트리·4층 평가·트레이싱·비용·카나리) + MLOps(Phase L 학습 로그 6종 선행 → M1/M2) + ML 패턴 유형화(A~D 4유형 10후보 + 금지 목록)
- README.md·claude.md·application-design/claude.md 인덱스 갱신
- U1 Functional Design의 LLMOps 타입(TracePort·PromptRef·Eval)과 정합 — trace_id·프롬프트 파일+git 버저닝 동일 체계

## PLANNING — Epic·Story 백로그 생성 + 실 API 승인 대기 분리
**Timestamp**: 2026-07-21T00:00:00Z
**User Input**: "설계 끝났으니 epic/story 보여줘" → "Claude API 결제 승인 전이라 구현 불가한 부분 어떻게 할지" → "해줘"
**AI Response**: units/epics-and-stories.md 생성 + 🔑(승인 후) 태그 체계 반영.
**Context**:
- 에픽 9종: 기존 U1~U6 + 신규 EP-7(정보 에이전트)·EP-8(의도파악)·EP-9(지표·Ops). 합계 29~42일
- 신규 타입 3묶음(S1.5 위임 봉투, S1.6 FreshnessMeta·정보에이전트 I/O, S1.7 학습 로그 6종)을 U1에 선반영 권고
- 실 API 승인 대기 대응: D37+Port 격리로 U1~U5는 fake 기반 완성 가능 확인. FakeLlm 3모드(golden/timeout/violation)+FakeEmbedding을 S1.2에 명시
- 🔑 승인 후 작업 K-1~K-7 분리 (벤더 어댑터 스모크·프롬프트 튜닝·실벡터 재색인·뱅크 증강·Bedrock 솔버 실험·LLM-judge·비용 실측) — 승인 시 실검증 스프린트 1회로 일괄 소화
- 승인 전 병행: 프롬프트 yaml·seed 질문·채점 기준 작성은 API 불요로 지금 진행

## DECISION — AI-D06 LLM 벤더 확정 (Anthropic API 직접)
**Timestamp**: 2026-07-21T01:00:00Z
**User Input**: "결제 승인 대상은 Anthropic API 직접이야"
**AI Response**: ai-adr.md에 AI-D06 신설, 관련 문서 정합화.
**Context**:
- 확정: LLM 경로 = Anthropic API 직접 (Bedrock 아님). 어댑터 = ChatAnthropic/anthropic SDK (LlmPort 뒤 격리, 구조 무변경)
- 티어 라우팅 초기 제안: 경량 claude-haiku-4-5 / 상위 claude-sonnet-5 / 오프라인(judge·증강·솔버실험) claude-opus-4-8 — model_id는 설정값
- 임베딩 재선정: Titan v2는 Bedrock 전용이라 불가 → 잠정 로컬 오픈소스(multilingual-e5-large 또는 BGE-M3, 1024차원 유지 → pgvector 스키마 무변경, 결제 승인 불요). 미결 #6으로 등록
- 파급: 미결 #1(LLM 벤더) 해소 / K-3(실벡터 색인) 승인 대기 목록에서 해소 — S6.1·S8.1 즉시 착수 가능으로 변경 / K-1 어댑터 확정 / "Bedrock" 표기는 "LLM API(Anthropic)"로 읽기 (README 표기 규칙 명시, 점진 개정)
- 후속 필요: ai-cost-estimation.md를 Anthropic API 요금 기준으로 재산정, langchain-adoption.md의 ChatBedrock 표기 개정

## DECISION — AI-D07 U2 솔버 시간 정책 (U2 착수 전 세팅 4건)
**Timestamp**: 2026-07-25T00:00:00Z
**User Input**: "U2 시간제한·제약 재세팅 — 4개 항목 차례로 선택"
**AI Response**: ai-adr.md에 AI-D07 신설, FakeTravel SPEED 정정.
**Context**:
- ① 솔버 라이브러리: OR-Tools 우선 벤치마크 (미결 #3 진행 방식 확정 — U2 첫 절편)
- ② day1 예산 5초→10초 상향 + day1부터 하이브리드 체인 전면 적용 (사용자 결정). ⚠️ D38 개정 사항 — 백엔드·기획 합의 전까지 "AI팀 제안" 플래그. 기존 5초 예산으로는 2차 LLM 솔버가 day1에서 구조적으로 불가능(설계 모순)했던 것의 해소
- ③ SPEED 초기값: 도보4/대중교통20/차30 km/h (remote config). FakeTravel 차 40→30 정정, 52 tests green 유지
- ④ 2차 솔버 모델: 경로별 분리 — day1·Plan-B=sonnet-5 / 백그라운드·regenerate=opus-4-8 (AI-D06 연장, 설정값)
- 후속: D38 개정 합의(백엔드·기획), evaluation-metrics day1 SLO 개정(합의 후), U2 Functional Design에 본 결정 반영

## DECISION — AI-D07 개정: day1 5초 유지 + 시한 인지 하이브리드 체인
**Timestamp**: 2026-07-25T01:00:00Z
**User Input**: "5초로 돌려주고, day1부터 하이브리드 방식 이용"
**AI Response**: AI-D07을 같은 날 개정 — 10초 상향안 철회.
**Context**:
- day1 5초 유지 (D38 무변경 → 기획·백엔드 합의 절차 불필요해짐)
- 모순 해소 방식: deadline-aware 체인 — 각 단계가 진입 전 잔여 시간 확인, 부족하면 스킵하고 다음 단계로. 체인 구조는 전 경로 동일, 경로별로 deadline만 다름
- day1에서 2차 LLM이 도는 조건 = OR-Tools 조기 실패로 잔여 ≥ 2.5s일 때. 타임아웃 소진 시 규칙 직행(INV-4 자연 강등)
- 후속: U2 FD에 deadline 파라미터 명세 + "deadline 초과 반환 없음" PBT 속성

## CONSTRUCTION — U2 Functional Design (산출물 생성)
**Timestamp**: 2026-07-25T02:00:00Z
**User Input**: "U2 시작해줘" (사전 세팅 4건 AI-D07로 확정 후)
**AI Response**: U2 Functional Design 3종 생성, aidlc-state 갱신, Jira TRIP-165 In Progress.
**Context**:
- 정본 근거: ai-implementation-design §1.2(C2 퍼사드)·§4.2(HC 4종)·§4.3(알고리즘)·§4.4(이동 추정), ai-testing-guide U5-P1~P6, AI-D07
- domain-entities.md: SolverConfig(AI-D07 초기값 주입 컨테이너)·RepairResult/MinimalChangePolicy(§1.2 미확정 타입 확정)·ClockPort(G116 시계 주입)·LlmSlotProposal(2차 제안 스키마). SolveMode.BEDROCK enum 개명은 직렬화 호환 위해 보류(표기 규칙으로 커버)
- business-logic-model.md: 컴포넌트 6종(facade·constraints·ortools·llm_solver·fallback·repair) + 시한 인지 체인 의사코드 + FakeClock/SlowSolver/적대적 제안 generator
- business-rules.md: HC 게이트(G114)·시한 인지 규칙 DL-1~6·결정론 규칙·PBT 매핑(U5-P1/2/3/6 + 신규 DL-P1/P2·GATE-P)·벤치마크 게이트(후보 50≤3s, 미결 #3 판정 절차)·DoD
- 다음: 사용자 승인 → 첫 절편 = OR-Tools 벤치마크

## CONSTRUCTION — U2 첫 절편: OR-Tools 벤치마크 (미결 #3 종결)
**Timestamp**: 2026-07-29T00:00:00Z
**User Input**: "승인 + A" (U2 FD 승인, 스택 브랜치)
**AI Response**: feature/TRIP-165-solver-core 분기, ortools 설치, day1 벤치마크 작성·실행 → 게이트 통과.
**Context**:
- 결과: 후보 50 = 2,813ms ✅(≤3s) · 고정블록 2개 포함 2,813ms ✅ · 500/5,000(top-60 프리필터) 회귀 없음 · 결정론 ✅(동일 시드 2회 동일 선택)
- 판정: OR-Tools(CP-SAT) 확정 — 미결 #3 종결
- 과정에서 얻은 설계 교훈 2건:
  ① 다중 워커는 결정론 깨짐 → 단일 워커 + 그리디 초기해 힌트로 해소. 그리디(구성 휴리스틱)가 RuleFallbackSolver의 원형이자 CP-SAT 웜스타트를 겸함 — 체인 구조(규칙→OR-Tools 개선)가 벤치마크에서 실증됨
  ② CP-SAT는 anytime — 주어진 예산을 전부 써서 개선. 리밋은 게이트 안쪽(2.8s)으로 설정해 반환 마진 확보
  ③ 후보 >60은 점수 상위 60 프리필터 (이동행렬 O(N²) 방지, 하루 슬롯 물리 한계 ~8개라 품질 손실 무시 가능) — 솔버 전처리로 설계 채택
- 다음 절편: constraints.py(HC 순수함수) + scorer/fallback_solver + facade 시한 인지 체인 + PBT(U5-P1·P3, DL-P1·P2)

## CONSTRUCTION — U2 절편2: HC 검증기 · 규칙 폴백 · 시한 인지 체인
**Timestamp**: 2026-07-29T02:00:00Z
**User Input**: "계속 가줘"
**AI Response**: c2 컴포넌트 5개 + 테스트 11개 (63 green), 커밋·푸시.
**Context**:
- constraints.py HC1~4 순수함수(영업정보 없음=미적용/요일 없음=휴무 규칙 확정) · fallback_solver.py(그리디 정식판, RULE_FALLBACK/MINIMAL 정직 태깅) · facade.py(DL-1~5 구현, SolverConflictError는 d08 충돌 흐름으로 위임 예정) · config.py(G51 체류 테이블 초기값 확정) · travel.py
- 도메인 보강: ItineraryProblem.anchor(정본 §4.1 누락분, 기본 None — 직렬화 호환)
- 검증: DL-P1(예산 내 반환)·DL-P2(잔여 부족 시 스킵+관측)·INV-2(위반 해 반환 차단)·U5-P1 그리디판·U5-P3 결정론 — FakeClock으로 sleep 없이
- 잔여: ortools_solver 정식 승격(SolverPort화)·llm_solver(2차)·repair·warm-start(U5-P2)·예산 단조(U5-P6)

## CONSTRUCTION — U2 절편3: OR-Tools 승격 · LLM 2차 · repair · warm-start (U2 코어 완료)
**Timestamp**: 2026-07-29T04:00:00Z
**User Input**: "U2 계속"
**AI Response**: c2 컴포넌트 완성 (8모듈), 테스트 76 green.
**Context**:
- ortools_solver.py: 벤치마크 모델 정식 승격 — 일자별 순차 CP-SAT, 규칙해 웜스타트, 프리필터 top-60, 요일 영업창(다중 창은 최장 창 보수 채택), 결정론(단일 워커+시드)
- llm_solver.py: 2차 단계 — 파싱→closed-set 게이트(GateDropEvent)→검증→repair 1회→재검증, LlmCallRecord 성공/실패 모두 계측. 모델 주입(sonnet-5, AI-D07 ④)
- repair.py: TIME_SHIFT_ONLY 전방 이동 수리, 고정 블록 불가침, 출처 보존. (FD의 domain 배치를 c2로 조정 — 직렬화 대상 아님, U5 API 노출 시 재검토)
- facade.regenerate: locked→FixedBlock 승격으로 HC3 보호 하에 재배치 (U5-P2 멱등)
- scorer.py: budget_fit 단조(U5-P6) + build_rule_score(A-1 ML 폴백)
- PBT로 잡은 실버그 1건: regenerate 시 잠근 슬롯=기존 고정블록 중복 승격 → 규칙 폴백이 이중 배치 → HC2 위반 → SolverConflictError. 폴백 솔버에 중복 고정 방어 추가로 해소 (hypothesis 반례 재검증 통과)
- 아키텍처 감시 확장: ortools import는 c2 계층에만 (자동 차단)
- U2 잔여(경미): 소규모 oracle 전수 대조(U5-P1 보강)·2차 진입 '품질 미달' 트리거·지역탐색 2-opt(CP-SAT가 사실상 대체)

## CONSTRUCTION — U2 마무리 + U3 Functional Design
**Timestamp**: 2026-07-29T05:00:00Z
**User Input**: "C하고 U3 시작해줘"
**AI Response**: U2 정리(스택 PR #40·TRIP-165 In Review·state 갱신) 후 U3 FD 3종 생성, TRIP-166 In Progress.
**Context**:
- U3 FD 근거: ai-data-design.md §3(6단계 필터 확정값)·§6(TTL: POI 24h/영업시간 6h/가격 금지)·§8(AI-D04 fuzzy)
- 스코프 결정: REGION 해소는 U3 제외(라우터/U6 소유) · is_closed_today 당일 배치는 Plan-B 소유 · 웹 소싱 U6 · 공간 쿼리 캐싱 후속
- CandidatePool에 anchor·radius_km 선택 필드 보강(정본 §3.3 누락분 — ItineraryProblem.anchor 방식)
- 가격 캐싱 금지: U1 to_cacheable_dict 단일 경로 + SpyCache PBT(CACHE-P1)로 이중 강제
- 신규 PBT: POOL-P1~P4·RES-P1/P2·CACHE-P1/P2
- 브랜치: feature/TRIP-166-m7-place-data (TRIP-165 위 스택)

## CONSTRUCTION — U3 코어 구현 (M7 Place Data)
**Timestamp**: 2026-07-29T06:00:00Z
**User Input**: "승인, 바로 코드로"
**AI Response**: m7 4모듈 + 도메인 보강 + 테스트 15개 (91 green).
**Context**:
- pool_builder: 6단계 필터 (정본 확정값, now 주입 결정론) · entity_resolver: 자모 분해 Levenshtein — "성심땅→성심당" 실증 테스트 통과 · cached_repo: TTL 정책 + 가격 구조 차단(to_cacheable_dict 단일 경로, 히트 시 avg_cost=None로 원본 조회 필요성 명시)
- 도메인: CandidatePool anchor·radius_km 보강(호환 유지), domain/m7.py(CandidatePoolRequest·EntityMatch·MatchDecision — poi_id=None ⇔ UNRESOLVED 정합 강제)
- PBT: POOL-P1~4(반경·예산·품질·상한·결정론·휴무 배제) · RES-P1/P2 · CACHE-P1(가격 저장 0건)/P2(TTL 만료 재조회) — 전부 첫 실행 green
- m7 계층 순수성 자동 감시 추가. U3 잔여: 실 PostgreSQL 어댑터(스캐폴딩 후속)·batch_check_closed Plan-B 연결(U6)

## DESIGN — Agent 구조 v2: 4상자 파이프라인 (멘토 피드백 반영)
**Timestamp**: 2026-08-02T00:00:00Z
**User Input**: "멘토 피드백 — agent 도구가 겹치면 orchestrator가 위임을 혼동. 겹침 금지" + 구조 문답 후 확정
**AI Response**: agent-structure-v2.md 신설 (정본), v1 배너 처리, 위임 프로토콜·인덱스·README 갱신.
**Context**:
- 확정 구조: Orchestrator(의도파악·Fast Path·InfoCollector 수집·위임) → Provider 5종(수집 전담, LLM 0회 — '정보 에이전트'에서 개명) → Agent 4종(LLM 판단, 전속 도구 완전 배타) → Solver 공통 관문(배치·검증·수리, Reflect는 스킵)
- 용어 규칙 확정: Agent = LLM 판단 주체만(4종, 사용자 결정으로 명칭 유지) / Provider = 수집 / Solver = 관문
- 겹침 해소: v1의 5개 중복 도구(place_scout 4곳·solver.validate 4곳 등) → 0. 라우팅은 테이블 유일 기준(도구 목록 판단 금지)
- 신설 계약: 정보 요구표(intent별 수집 항목), InfoBundle(패킷+FreshnessMeta+상태값, 풀은 세션 캐시 참조), NEED_MORE_INFO 재요청(1회)
- 웹 소싱 위치 명확화: Provider 아님 — 백그라운드 소싱 파이프라인(U6) 소속, LLM 추출은 그 안에서 (INV-1·지연 예산 근거)
- 트레이드오프 기록: 이전 피드백(에이전트 도구 자율)과 절충 — 판단 자율 유지, 수집·확정 중앙화
- 코드 영향 0 (U1~U4 무관, U5/U6 미구현 시점의 무비용 개정)

## 2026-08-02 — U4 C1 LLM Gateway 착수 (FD)
- 브랜치: feature/TRIP-167-c1-llm-gateway (U3 스택). Jira TRIP-167 → 진행중
- FD 3종 작성: construction/u4-c1-gateway/functional-design/{domain-entities, business-logic-model, business-rules}.md
- 설계 축: 코드-주도 단발 호출 (Claude tool-use 미채택 — 결정론·지연·검증·비용 근거 명문화)
- "제한된 소형 LLM" 4겹 장치: LlmFeature closed-set(8기능) · 전용 프롬프트(yaml+semver) · 스키마 파서 · ClosedSetGate
- 도메인 보강: LlmFeature/ModelTier(llm.py), PersonaSummary·TasteTag 7축(persona.py — 미결 #3 해소), Principal/ResourceRef/PermissionDeniedError(context.py — D31)
- 어댑터: AnthropicAdapter는 client 주입식, 실 스모크 K-1 유보 (D37 CI 실 API 0 유지)
- PBT 계획 8속성: GATE-P1/P2(U5-P5 승계) · GW-P1/P2 · ROUTE-P1 · CTX-P1 · PROMPT-P1 · SER-P1

## 2026-09-02 — BR-AF-07 소급 기록: 2026-08-02 이후 추가된 LlmFeature
- 이 로그는 `## 2026-08-02 — U4 C1 LLM Gateway 착수 (FD)` 에서 멈춰 있었다. 그 사이 코드에 들어간 feature 를 소급 기록해 BR-AF-07(FD 개정 + tier_map + 프롬프트 yaml + ROUTE-P1 + **audit**) 의 audit 칸을 채운다 — 나머지 4칸은 각 티켓에서 이미 이행됐고 audit 만 누락돼 있었다. 즉 규칙이 깨진 게 아니라 **기록만 밀렸다**
- `EDIT_TRANSLATION` — EditAgent 전속, 확정된 EDIT_SCHEDULE 의 세부 번역(라우팅 재해석 아님). enum 선등록은 TRIP-286(#96), 잔여 세트(FD 티어 표·타입 승격·컨텍스트 경계)는 TRIP-315(#134). 정의 정본 = agent-foundation FD domain-entities §1
- `REFLECTION_NUDGE` (TRIP-347, #180) — 회고 유도 푸시 문구 1문장. 발송은 백엔드 notification 소유, c1 은 문구 생성까지
- `EVENT_EXTRACTION` (TRIP-421, #268) — 웹 검색 스니펫 → 행사 구조화 추출(백그라운드). 행사는 POI 가 아니라 후보 풀 비편입(INV-1 비적용)
- `REFLECTION_TEMPLATE` (TRIP-429, #350) — 회고 연출 템플릿. 구 `REFLECTION` 을 TRIP-558(#386)에서 흡수·폐지
- `PHOTO_HIGHLIGHT` (TRIP-595, #436) — 동의된 사진 → 대표 N장 선별(Reflect Phase 2). 이미지 파트를 싣는 첫 feature
- `REFLECTION_TEMPLATE_VISION` (TRIP-595, #436) — 텍스트판과 같은 출력 계약, 모델 라우팅 때문에 feature 분리
- **개수·전체 목록은 여기 적지 않는다** — 정본은 `ai/src/trippilot/domain/llm.py::LlmFeature`, 티어 매핑은 `ai/src/trippilot/llm_gateway/config.py::default_tier_map`, 프롬프트는 `ai/prompts/`
- u6-reflect FD `business-rules.md` §4 DoD 의 "신규 LlmFeature 5종 세트 완료 (BR-AF-07)" 체크는 Reflect Phase 2 소유자에게 남긴다 — audit 칸은 본 항목으로 채워졌다

## 2026-09-02 — AI-DLC 상태 문서 스테일 정정 (코드 변경 없음)
**Timestamp**: 2026-09-02
**변경**: 코드보다 낡아 사실과 어긋나던 안내 문장을 교체. 문서만 수정, `src/` 무변경.
- `aidlc-state.md`: "Existing Code: No" → Yes(`src/trippilot/` 가동), Project Type·Build System(uv)·Workspace Root(모노레포 `ai/`) 갱신, CONSTRUCTION 체크박스 3종(Functional Design·Code Generation·Build and Test) 체크. Current/Next Stage("U4 FD 승인 대기")는 2026-08-03 U4 머지 이후 갱신이 끊겨 스테일이었으므로 값을 다시 박지 않고 `../claude.md` §Current Status 로 위임. U1~U3 Status 서술은 시점 기록으로 보존.
- `construction/claude.md`·`claude.ko.md`: "Not Yet Started / 아직 미착수" → 현재 상태. 계획 트리는 "최초 계획"으로 강등하고, `code/` 부재(Code Location Rules)와 U5 FD 부재(TRIP-237/238/239/241/242 코드 선행)를 결정으로 명시.
- `inception/reverse-engineering/code-structure.md`·`code-quality-assessment.md`: 본문 보존 + "2026-07-12 시점 관측" 배너 삽입.
- `inception/claude.md`·`claude.ko.md`·`inception/design-artifacts/claude.md`·`claude.ko.md`: 에이전트 구조 최신 문서 지목을 `agent-redesign.md` → `agent-structure-v2.md`(2026-08-02 도구 배타 원칙 개정)로 정정. `application-design/claude.md` 의 지목과 일치시킴.

## 2026-09-12 — 신규 LlmFeature `SHARE_CARD_COPY` (BR-AF-07 5종 세트)
**Timestamp**: 2026-09-12 · TRIP-429 후속 (j06 공유 카드)
- **무엇**: 공유 카드 이미지 아래 붙는 SNS 캡션·해시태그를 LLM 카피로 생성한다. 종전엔 클라이언트가 기계 문자열로 조립했다(`ShareCardPage.tsx` — 캡션은 여행 제목 시드, 해시태그는 목적지마다 `#{지역}여행`). 카드 이미지(통계·동선 목록·워터마크)는 서비스가 조립하는 사실 영역이라 범위 밖
- **5종 세트 이행**: ① FD 개정 — `construction/u4-c1-gateway/functional-design/domain-entities.md` §1 표에 행 추가 ② tier_map — `llm_gateway/config.py::default_tier_map` LIGHT ③ 프롬프트 yaml — `prompts/share_card_copy.yaml` v0.1.0 ④ ROUTE-P1 — 전 feature 스윕(`tests/test_llm_gateway_gateway.py`)이 자동 커버, 폴백 모드 이중 대장(`_EXPECTED_MODES`)도 갱신 ⑤ audit — 본 항목
- **설계 결정**: 에이전트를 만들지 않는다 — u6-reflect FD §2.1 **워커 직행 패턴**의 적용 대상(`reflection_nudge` 와 동형). 후보 선택·다단 구성·예산 계단·하드 교체를 하나도 쓰지 않는 "판단 없는 단발 변환"이라 껍데기 위임 메서드는 대칭 말고 얻는 게 없다. 방어 폴백 이벤트는 `component="api.wiring"`(발행 주체 = 경계)
- **게이트 등급 이탈(의도적)**: 판정 로직은 `gates/reflection_template.py` 재사용(`_TIME_EXPR`·`_tag_allowed`·`_PLACEHOLDER`)이지만 `CAPTION_LEN`·`HASHTAG_OUT` 의 **등급이 다르다** — 그쪽은 "N회 생성 → 최선 채택"이라 SOFT 감점을 적용할 랭킹 자리가 있고, 여기는 단발 1건이라 그 자리가 없다(통과 아니면 전량 드롭 → 정적 폴백). 그래서 **과잉 드롭이 실질 위험**이고, 게이트가 검사하는 규칙을 프롬프트에 빠짐없이 싣는 것이 방어선이다(정합 테스트가 고정)
- **경계 추가**: `POST /ai/v1/reflection/share-card` — 요청은 `ReflectionGenerateRequest` 재사용(회고와 같은 재료), 응답은 `ShareCardCopy`. 기존 `/generate`·`/nudge` 스키마 무변경(openapi diff 삭제 0줄)
- **미결로 남긴 것**: ⓐ 캡션의 자리표시자(`{region}`·`{visit_count}` 등) **바인딩 주체가 아직 없다** — 백엔드·FE 어디에도 치환 코드가 없어 붙는 순간 리터럴이 노출된다. `REFLECTION_TEMPLATE` 도 같은 상태이므로 이 feature 가 새로 만든 결함은 아니지만, 공유 캡션은 SNS 로 바로 나가는 자리라 노출 경로가 더 짧다 ⓑ 폴백이 FE 종전 문구를 재현하지 못한다 — `ReflectionRequest` 에 여행 제목·목적지 목록이 없어 지역 1개로 접힌다(요청 스키마 확장 협의 필요)
- **선행 기록 누락 1건**: `REPLAN_DIRECTIVE_TRANSLATION`(재계획 연동 설계 §3) 은 위 2026-09-02 소급 기록 이후에 들어와 FD 표·audit 양쪽에 없다 — 본 항목과 별개로 그 티켓 소유자가 채울 몫으로 남긴다(여기서 대신 적으면 근거 없는 기록이 된다)

## 2026-09-14 — 도우미 대화 FD 초안 (인자 추출 · 다중 의도 · 멀티턴) — **승인 대기**
**Timestamp**: 2026-09-14 · TRIP-853 · 산출물 `construction/assistant-dialogue/functional-design/` 3종
- **무엇**: 자연어 도우미가 성립하려면 필요한 셋의 FD 초안. 정본 무수정 — 개정 필요 항목은 business-rules §4 목록으로만 올렸다
- **유닛 번호를 붙이지 않았다**: 모노레포 정본(`aidlc/.../unit-of-work.md`)은 이 영역을 **U8 Conversational Assistant**(Phase 7+, 후속 게이트)로, ai 패키지 정본은 U1~U6 까지만 쓴다. 번호 충돌 시 이름 표기가 팀 규칙이다(anti-patterns §설계·문서) — `agent-foundation` 과 같은 방식
- **셋을 한 유닛으로 묶은 근거**: 발화 하나 → N개 프레임, 프레임 = `(의도, 인자)`, 필수 인자가 다 차야 실행 가능. 인자 추출 = 프레임 채우기 · 다중 의도 = N>1 · 멀티턴 = 덜 찬 프레임이 다음 턴까지 사는 것. 쪼개면 중심 타입 `IntentFrame` 을 세 번 정의한다
- **결정 ①  하이브리드 유지**: 도구 호출은 **3차 자리에만** 넣는다. 1·2차에 LLM 이 들어가면 CONFIDENT 의 존재 이유인 "LLM 0회"가 사라진다(뱅크 417문장 기준 평가 87발화 중 28건). 뱅크가 이기는 칸(의도·지연·사람이 고칠 수 있음)과 도구 호출이 이기는 칸(인자·분해)이 정확히 갈린다
- **결정 ②  ③의 핵심은 도구 호출이 아니라 `ARGUMENT_TABLE`**: 현재 인자 어휘는 의도 13종 공통 3칸(`date`·`category`·`constraint`, `prompts/intent.yaml:36`)뿐이다. 의도별 표를 만들면 도구 스키마(`tool_specs()`)와 규칙 추출기가 **거기서 파생**되므로, 도구 호출을 채택하지 않아도 이득이 남는다
- **결정 ③  `slot_pattern` 폐기 제안**(`intent-matching-design.md` §3.1): 로더·라우터·정규식 추출기·테스트가 전부 있는데 뱅크 417문장에 데이터 **0건**이다. 문장마다 패턴을 달 수 없고(증강기가 못 만든다) 같은 `date` 를 의도마다 다르게 뽑는 드리프트가 난다. 대신 `ArgumentKind` 별 추출기 9종 — 의도가 늘어도 안 는다. **기능이 없는 것보다 "있는데 아무도 안 쓰는" 편이 위험하다**(다음 사람이 채우려 든다)
- **결정 ④  다중 의도에 새 타입을 만들지 않는다**: `domain/execution.py` 의 `ExecutionPlan`/`ExecutionStep`/`AgentCall` 이 이미 있고 프로덕션 소비자가 0이다. 정본도 "Execution Plan 에서 step 1개에 병렬 배치"라고 적었다(`orchestrator-delegation-design.md:182`). 컴파일 규칙은 한 줄 — 의존 없으면 같은 step, 있으면 다음 step. 상한은 **프레임 2개 · 상태 변경 의도 1개**
- **결정 ⑤  대화 상태의 정본은 백엔드 (추천 · 합의 필요)**: AI 서비스는 무상태로 남고 매 턴 `DialogueContext` 를 받고 돌려준다. `CONFIRM_REQUIRED` 왕복(서버가 아무것도 안 들고 클라가 전체를 재전송)이 **이미 같은 모양**이다. 근거는 확장성보다 **책임 소재** — 제품이 O3 로 "대화 이력 보관 정책"을 운영 미결로 걸어 뒀는데, AI 가 발화를 들기 시작하면 **결정 전에 사실을 만든다**. 대안 C(클라이언트 소유)는 비용 0이지만 에픽 J 스토리 "5) 대화 이력·세션"의 기기 간 연속성을 포기해야 한다 — 그러려면 스토리를 먼저 줄여야 하므로 순서가 거꾸로다
- **결정 ⑥  되묻기를 `NEED_MORE_INFO` 에 합치지 않는다**: 그쪽 `missing` 은 **Provider 데이터**이고 해법이 "Orchestrator 재수집·재위임 최대 1회"(BR-AF-05)라 **사람 왕복이 없다**. 합치면 "데이터가 없다"와 "사용자가 안 말했다"가 같은 재시도 정책을 탄다. 되묻기 상한은 프레임당 1회로 따로 둔다
- **실측이 범위를 줄여 줬다**: 필수 인자가 **아예 없는 의도가 13종 중 6종**(`REGENERATE`·`REPLAN`·`TRIP_SUMMARY`·`STYLE_ANALYSIS`·`GET_NEXT_SLOT`·`SHOW_SCHEDULE`)이다 — 되묻기가 필요 없다. ⑤의 실제 적용 범위는 7종이고 필수 인자 2개짜리는 `GET_DISTANCE` 하나뿐이다
- **착수 순서 — 지금 할 수 있는 것은 하나뿐**: ① 인자표 + 규칙 추출기(선행 없음) → ② 도구 호출 포트 확장(①  후) → ⑤ 멀티턴(대화 상태 소유 합의 + 자연어 진입 경계 — **둘 다 제품 결정 선행**) → ④ 다중 의도(**`AgentTask` 봉투 이관** = agent-foundation 미결 #8 + 복합 발화 평가셋)
- **미결로 남긴 것**: ⓐ 대화 상태 소유 합의 — 백엔드에 assistant/chat 모듈도 테이블도 없고 `ChangeSource.ASSISTANT` enum 값만 있다 ⓑ 자연어 진입 경계 부재 — 9개 경계 중 발화를 받는 것은 `/ai/v1/itinerary/edit` 의 `utterance` 하나이고 백엔드가 안 부른다. 신설은 제품 결정 선행(`backend/docs/design/work-graph.toml` `AI-NL-EDIT`) ⓒ 복합 의심 신호("접속 표지 + top1 < T_high")는 **가설이다** — 평가셋 87건에 복합 발화가 0건이라 지금은 잴 수 없다. 근거 없는 임계를 코드에 박지 않는다 ⓓ 도구 호출용 신규 `LlmFeature` 필요 여부(`INTENT` 재사용이면 BR-AF-07 5종 세트 불요) ⓔ 되묻기 문안의 소유(AI vs FE) — 어시스턴트 화면 설계 후 ⓕ `TRIP_SUMMARY.day_date`·`STYLE_ANALYSIS` 가 `agent-io-contracts` 에만 있고 `domain/reflection.py` 에 필드가 없다 — 어느 쪽이 정본인지 미정
- **대신 적지 않은 것**: `INTENT` 프롬프트의 3칸 슬롯을 지금 고치지 않았다 — `ARGUMENT_TABLE` 승인 전에 프롬프트만 바꾸면 게이트·표·프롬프트가 셋으로 갈린다. 승인 후 한 번에 간다

## 2026-09-15 — 도우미 대화 FD 개정 ①: 의도 되묻기 신설 · 의도 쪼개기 기각 (TRIP-853 초안 보완)
**Timestamp**: 2026-09-15 · 초안(2026-09-14) 승인 전 보완 — 정본 무수정 유지
- **발단**: 검수 페이지를 읽은 팀원이 둘을 제안했다 — ⓐ "의도를 더 쪼개면 질문뱅크가 더 확실히 갈릴 것 같다" ⓑ "애매하면 REGENERATE 인지 SUGGEST_ALTERNATIVE 인지 되묻게 하고, **그 질문을 LLM 이 발화를 되짚어 만들게** 하자". 둘 다 재 보고 판정했다
- **ⓐ 기각 — 실측**: `EDIT_SCHEDULE` 31문장을 연산별로 쪼개(ADD 8·MOVE 7·REPLACE 9·REMOVE 3·분류불가 4) 같은 조건(평가셋 87·t_high 0.82·margin 0.02)으로 1차를 다시 돌렸다. **1차 확정 28 → 28(변화 없음)** · EDIT↔REGENERATE·REPLAN 경계 **9쌍 → 9쌍(변화 없음)** · **새로 생긴 내부 경계 12쌍**(최고 `EDIT_MOVE`↔`EDIT_REPLACE` 0.877 — 없애려던 외부 경계 0.823 보다 더 붙었다). 쪼개기는 외부 경계를 줄이지 않고 내부 경계를 만든다
- **ⓐ 가 안 통하는 구조적 이유**: `op` 는 지금 `EDIT_TRANSLATION` 워커가 **현재 일정을 손에 들고** 정한다(`EditTranslationContext{pool, current_slots}`). 의도로 올리면 라우터가 **발화만 보고** 같은 판단을 하게 된다 — 결정을 더 이른 자리로, 더 적은 정보로 옮기는 것이다. 그래서 `op` 는 계속 **인자**로 둔다
- **ⓐ 에서 건진 것**: 쪼개 보니 EDIT↔REGENERATE·REPLAN 압력 9쌍 중 **7쌍이 MOVE 계열**에 몰려 있다("재배치·옮겨"가 재계획처럼 들린다). closed-set 을 건드릴 일이 아니라 **뱅크 위생의 표적**이다
- **ⓑ 채택 — 실측이 지지한다**: 의도 쌍별 경계 압력(≥0.80 문장 쌍)이 한 군집에 몰려 있다 — `REGENERATE`↔`REPLAN` **19쌍**(최고 0.841) · `GENERATE_SCHEDULE`↔`SHOW_SCHEDULE` **12쌍**(0.880) · `GENERATE_SCHEDULE`↔`REGENERATE` 6 · `GET_NEXT_SLOT`↔`SHOW_SCHEDULE` 5 · `EDIT_SCHEDULE`↔`REPLAN` 5 · `EDIT_SCHEDULE`↔`REGENERATE` 4. 여섯 의도가 "일정"이라는 한 낱말을 공유한다. **여기는 뱅크·임계·쪼개기 어느 것으로도 안 갈린다 — 차이가 문장 안에 없고 상황에 있기 때문이다**("일정 다시 짜줘"는 아무 일 없으면 REGENERATE, 비 오면 REPLAN). 없는 정보를 만드는 길은 문맥에서 가져오거나(Provider 몫, 라우터가 못 쓴다) **사용자에게 묻는 것**뿐이다
- **신설 타입**: `IntentClarify{question, choices: IntentChoice[], source}` + `IntentChoice{intent, label}`. 기존 `ClarifyRequest` 는 `ArgumentClarify` 로 개명 — **되묻기가 두 종류**이고 성격이 다르다(의도가 안 갈림 / 인자가 빔). `RouterOutcome.clarify` 한 칸에 둘을 담는다: **동시에 나올 수 없다**(의도를 모르면 어떤 인자가 필요한지도 모른다 — `ARGUMENT_TABLE` 이 의도로 색인된다). 두 칸이면 표현 불가능한 상태가 타입에 생긴다
- **질문 생성의 소유를 AI 로 확정** (미결 #6 해소): 고정 문구로는 안 된다 — 갈리는 자리는 차이가 문장 안에 없어서 사용자가 **자기 말을 되짚어** 보지 못하면 무엇을 고르는지 모른다. 신규 `LlmFeature.INTENT_CLARIFY`(LIGHT) + `prompts/intent_clarify.yaml` + `IntentClarifyGate` — **BR-AF-07 5종 세트 대상**
- **후보는 서버가 주입한다 — 갈등하는 2~3개만, 13종 전체를 주지 않는다.** 게이트가 모든 보기를 그 목록으로 되매핑한다(INV-1). `EDIT_TRANSLATION` 의 `$edit_ops` 와 같은 구조 — 모델에게 라우팅을 다시 시키는 것이 아니라 **이미 좁혀진 둘 중 무엇인지 물을 문장**을 만들게 하는 것이다
- **넣는 자리를 실측으로 갈랐다**: ⓘ 2차 동률대(득표 0.73~0.76)에는 **넣지 않는다** — 3차가 승격분을 전건 맞혔으므로 공짜로 맞힐 것을 왕복 비용으로 바꾼다 ⓘⓘ `FALLBACK` 자리(9건/87)를 **대체한다** — 현행 "기본 응답 + 수동 편집 안내"보다 낫고 침묵하지 않으므로 INV-4 유지 ⓘⓘⓘ 3차가 **낮은 신뢰도로 상태 변경 의도**를 냈을 때 실행 전 확인
- **되묻기 총량 상한 1회**(BR-DLG-33): 의도 되묻기 뒤에 인자 되묻기를 이어 붙이지 않는다 — 2연속이면 사용자가 이탈한다. BR-DLG-23(프레임당 1회)의 상위 상한
- **미결로 남긴 것**: ⓐ **후보 선정 규칙 미정**(미결 #10) — FALLBACK 발화에서 후보 2~3종을 1차 top-k 로 뽑을지 3차 산출과 그 경쟁자로 뽑을지. **후보에 정답이 없으면 되묻기가 폴백보다 나쁘다**(틀린 보기만 준다) → DoD 에 "후보 안에 정답이 든 비율" 실측을 걸었다 ⓑ **`OUT_OF_SCOPE` 거부 앵커 뱅크 부재**(미결 #9) — 집 없는 발화 25/87 중 9건이 범위 밖인데 전부 엉뚱한 의도에 붙는다(뱅크가 13종만 덮는다). 범위 밖은 **열린 집합**이라 전수 커버 불가, 흔한 갈래만 덮는다. 이득은 정확도가 아니라 비용(LLM 호출 ~10%) → 별도 티켓
- **대신 적지 않은 것**: 프롬프트 `intent_clarify.yaml` 실물을 만들지 않았다 — 승인 게이트 전이고, 후보 선정 규칙(미결 #10)이 정해져야 프롬프트가 받을 입력이 확정된다

## 2026-09-19 — 도우미 대화 FD 개정 ②: 인자표를 코드 실측본으로 교체 (초안 13행 전부 오류)
**Timestamp**: 2026-09-19 · 승인 후 개정 · 워크플로 49에이전트 실측
- **무엇을 했나**: 의도 13종의 인자표를 **실제 핸들러·DTO·Provider 코드에 하나씩 대조**하고, 인자 종류 9종의 한국어 추출기를 설계한 뒤 **렌즈 셋(오탐·누락·경계)으로 반증**했다. 반증자는 정규식을 실제로 파이썬에 옮겨 돌렸고 반례는 저장소 말뭉치(뱅크 485 + 평가셋 87)에서 골랐다
- **결과: 13행이 전부 초안과 달랐다.** 초안을 `agent-io-contracts.md` 로 썼는데 **계약 문서와 코드가 갈라져 있었고 표는 계약 쪽만 보고 있었다.** 이것이 이번 개정의 한 줄 교훈이고 BR-DLG-00 으로 규칙화했다 — **인자표는 계약이 아니라 코드에 대고 만든다**
- **가장 큰 정정 — 필수 인자는 6개 의도가 아니라 4개다**(`SUGGEST_ALTERNATIVE`·`EDIT_SCHEDULE`·`GET_DISTANCE`·`GET_POI_INFO`). `GENERATE_SCHEDULE` 은 초안이 `region`·`period` 둘을 필수로 뒀는데 **실측은 0개**다: 도우미는 여행 화면에서 호출되고(에픽 J "현재 여행·등록 숙소") 지역·기간·예산·동행은 전부 여행 기록에서 온다. 처리자가 실제로 거부하는 유일한 조건은 **앵커 좌표 부재**이지 목적지 이름이 아니다(`api/wiring.py:326`). 초안대로였으면 뱅크의 가장 전형적인 문장 **"일정 만들어줘"가 항상 되묻기**로 빠졌다 — 사용자는 이미 그 여행 화면에 있는데 "어디로 가세요?"를 듣는다
- **초안이 자기모순이기도 했다**: `period`(DATE_RANGE)는 "3박 4일"처럼 기점 없는 기간을 포함하므로 필수를 다 채워도 `days` 를 못 만드는 조합이 남는다 — "없으면 착수 불가" 라는 판정 기준을 필수 집합 자신이 어긴다. 한 쌍으로 묶으면 되묻기 2회가 필요해져 BR-DLG-33 과도 충돌한다
- **`ArgumentSpec` 자체가 실측을 담지 못해 5가지를 고쳤다**: ① `kind` → `kinds` 튜플(`target`·`origin`·`destination` 이 SLOT_REF 와 PLACE_REF 둘 다 실제로 나온다 — 초안은 표에 `A|B` 라 적었지만 타입은 한 칸이라 추출기 선택과 도구 스키마가 갈린다) ② `requires_group` 신설(`EDIT_SCHEDULE` 은 "`day` 가 있거나 `target` 이 한 날짜로 해소되거나" 중 하나면 착수한다 — bool 로는 못 적는다) ③ `multiple` 신설(`REPLAN` 은 `reasons: list[str]`, `SUGGEST_ALTERNATIVE` 는 `reason: str` — 같은 칸을 복사하면 복수 사유가 조용히 잘린다) ④ †각주 철회(실재 enum 이 넷이다: `EditOp`·`ReplanScope`·`CompanionType`·`BudgetLevel`. 주석뿐인 것은 PlanB `reason` 하나) ⑤ `lands_in` 신설
- **⑤가 중요하다 — 뽑아도 갈 곳이 없는 인자가 7칸이다.** `GENERATE_SCHEDULE.region` 은 와이어에 `trip_context.destinations` 가 있지만 **소비자가 0건**(grep 정의 1줄), `GENERATE_REFLECTION.tone` 은 필드 자체가 없고, `TRIP_SUMMARY.day_date` 는 `ai/` 전체에 0건, `REPLAN.from_slot` 도 착지 필드가 없다. **받을 칸 없는 인자를 필수로 박으면 되묻기가 발생하고 채워도 버려진다** — `lands_in=None` 이면 `required` 가 될 수 없게 post-init 으로 막는다
- **핸들러가 아예 없는 의도가 4종**(`STYLE_ANALYSIS`·`GET_NEXT_SLOT`·`SHOW_SCHEDULE`·`GET_POI_INFO`), Provider 대행 2종(`GET_WEATHER`·`GET_DISTANCE`). `ROUTING_TABLE` 의 `WeatherAgent`·`TransitAgent`·`PlaceScoutAgent` 는 **문자열일 뿐 클래스가 없다**(에이전트는 schedule·planb·reflect·edit 4종). 그 6종의 인자표는 "AI 가 처리한다"가 아니라 **"라우터가 백엔드에 넘길 봉투"** 로 읽어야 한다 (미결 #13)
- **추출기 9종이 전부 `rules_partial` 이다.** 초안은 `DATE`·`DATE_RANGE`·`ORDINAL`·`COUNT`·`ENUM` 다섯을 "정규식·0회·결정론" 으로 적었지만 셋 다 반증에서 깨졌다(종류당 반례 25~37건). 한국어의 조사 결합·띄어쓰기 변이·한자어/고유어 수사 이중화·축약이 규칙 하나로 수렴하지 않는다
- **그래서 정책을 바꿨다 — 정밀도를 택한다(BR-DLG-08b).** 필수 인자가 4개 의도뿐이라 추출기 일의 대부분이 선택 인자인데, 선택 인자는 **못 뽑으면 그냥 비지만 잘못 뽑으면 처리자가 틀린 값으로 일한다**(사용자가 말하지 않은 조건이 걸린 결과를 받는다). 두 실패의 대가가 대칭이 아니다. 애매하면 `None` 을 낸다
- **소비 지점이 제약이다**: `_extract_slots` 가 `re.search(...).group(0)` 로 슬롯당 문자열 하나를 만든다 — 종류마다 `wrong_span` 반례가 나온 근본 원인이고, `multiple` 인자를 표현할 수 없다(미결 #12)
- **의도 되묻기는 자리가 사라졌다**(§6.1.1 신설). FD 는 되묻기를 `FALLBACK` 9건/87 자리에 넣기로 했는데 거부 앵커가 그 9건을 **전건** 가져갔다. 남은 오답 2건은 둘 다 `VOTED` confidence 1.000 이라 "낮은 신뢰도" 조건에 안 걸리고, 그중 하나는 1차 top-3 후보에 정답이 없다(미결 #10 이 경고한 그 경우). **더 근본적으로 — 라벨이 하나뿐인 평가셋은 구조적으로 "진짜 애매한 발화"를 담을 수 없다**(라벨러가 하나를 골라야 했다). 설계는 두되 **구현은 착수하지 않는다**
- **미결로 남긴 것**: #11 `⌀` 7칸의 처리(칸을 만들든 인자를 빼든) · #12 `multiple` 인자의 추출 계약 · #13 핸들러 없는 6종의 봉투 모양(백엔드 합의)
- **대신 적지 않은 것**: 추출기 정규식 실물을 아직 코드로 옮기지 않았다 — 반례 25~37건을 테스트로 먼저 옮기고 그 위에서 구현하는 것이 순서다. 반례 목록은 워크플로 산출에 있다

## 2026-09-26 — MLOps 서빙·운영 유닛 신설 (사후 FD) + 정본 정정 2건
**Timestamp**: 2026-09-26 · 유닛 `construction/mlops-serving/` · PR #657 · TRIP-965·967·971
- **무엇을 했나**: 서빙·오토스케일링·캐시를 먼저 만들고(코드가 앞섰다) 그 위에 FD 3종을 썼다. **사후 FD 라 v0.1 초안으로 두고 승인 게이트를 남겼다** — U5 처럼 FD 없이 지나가지 않게 하되, 승인받은 설계인 척하지도 않는다
- **대상은 둘뿐이다**: 가중치를 우리가 들고 있는 것(KURE-v1 임베딩 · 리마인드 파인튜닝 Qwen3-4B). 외부 LLM 호출 경로는 이 유닛 밖이다. 두 모델의 **운영 성격이 정반대**(동기·상주 ↔ 비동기·0 으로 내려도 됨)라 규칙이 갈린다
- **규칙 23개(BR-MLO-01~23)의 성격**: 대부분 "조용히 틀리는 것을 시끄럽게 만드는 장치"다. 서빙은 틀려도 예외가 안 난다 — 다른 모델이 답해도, 벡터 공간이 어긋나도 200 이 나간다. 그래서 동등성 게이트(코사인 ≥ 0.9999 ∧ top-4 전부 일치)·모델 동일성 단언·풀링 한 벌 규칙이 규칙의 중심이다
- **판단이 두 번 뒤집힌 기록을 문서로 남겼다**(`ai/docs/mlops/서빙-의사결정-기록.md`): 첫 측정 "Triton 3.5배 느림" → 서버측 분해가 결론과 안 맞음(오버헤드 queue 1.8ms) → 2×2 재측정에서 **환경에 따라 우열이 뒤집힘**(네이티브 ORT 1.29배 빠름 ↔ 컨테이너 1.60배 느림) → 배포 대상 amd64 에서 ONNX 13~15% 우세. **결론: 이득은 엔진 몫이지 서버 몫이 아니다** → Triton 기각, 인프로세스 ONNX 채택(TRIP-965, 기본값은 컨테이너 실측 후 전환)
- **정본 정정 2건(TRIP-967)** — `mlops-llmops-design.md`: ① §2.1·§2.3 의 SageMaker 표기 → 실제는 MLX(Mac) 학습 + Bedrock Custom Model Import 서빙. **서빙만 고치고 학습 실행 환경은 "미정"으로 되돌렸다** — 리마인드 트랙이 Mac 이었다는 사실이 A-1·B-1 의 학습 환경까지 정해 주지 않는다 ② 머리말 "모델은 DAU 1천 이후" → 지우지 않고 **범위를 명시**했다. 단계 위반이 아니라 문서가 한 축만 보고 있었다(라벨이 사용자 행동이 아니라 교사 모델 출력이라 DAU 무관)
- **유형 E 신설**: 기존 A~D 는 판정 기준 3개(반복 구조·자동 라벨·soft 신호)를 전제하는데 E 는 **기준 2 가 안 맞아 칸 자체가 없었다** — 그래서 이미 가동 중인 것이 카탈로그에 안 보였다. **"다음 후보 없음"을 명시**했다: 늘리는 기준을 안 적으면 "파인튜닝했으니 다음도"가 된다
- **미결 — 서빙 목표의 이름표가 두 갈래다**: 이 세션은 사용자에게 "EKS GPU 가 목표, Bedrock 은 다리"를 받았고, 서빙 트랙 세션은 같은 날 PR #750(ADR AI-D08, 열림)에 "Bedrock 이 실서비스, EKS 는 측정 실험"으로 적었다. **목표와 실험의 이름표가 반대**다. 사용자 확인 대기 중이고 FD §4 에 경고를 박았다. 다만 **절차와 코드는 어느 쪽이든 같다** — 전송로를 값으로 고르는 구조라 조작도 되돌리기도 동일하다
- **대신 적지 않은 것**: `aidlc-state.md` 에 유닛을 추가하지 않았다 — 그 파일이 "유닛 목록은 여기 적지 말고 디렉토리를 볼 것"을 스스로 규약으로 적고 있다. 그리고 컨테이너 안 ONNX 지연·HPA 실동작·무요청 24시간 청구액은 **못 쟀다고 적었고 추정치로 채우지 않았다**

## 2026-10-01 — 서빙 목표 이름표 결정 + 인클러스터 GPU 매니페스트 철회
**Timestamp**: 2026-10-01 · 유닛 `construction/mlops-serving/` · PR #657(범위 축소) · ADR AI-D08
- **직전 항목의 미결을 닫는다** — "서빙 목표의 이름표가 두 갈래"(2026-09-26). 사용자가 판단을 위임해(“너의 추천대로 결정할게”) **(a) Bedrock Custom Model Import 가 실서비스, EKS GPU 는 전환 판정기가 비용 우위를 수치로 낼 때 여는 선택지**로 정했다. 서빙 트랙 세션이 PR #750(ADR AI-D08)에 적은 쪽과 **같은 결론**이다 — 이름표가 반대였던 것은 이 세션 쪽이었다
- **그래서 매니페스트를 지웠다**: `deploy/eks/chart/templates/reminder-llm.yaml` + `reminderLlm` 값·스키마. 감사에서 결함 4건이 나왔다 — ① Triton 이 `/v1` OpenAI 프런트엔드를 안 띄우는데 앱은 `/v1` 로 부른다(파드 Ready·호출 404) ② `trippilot.podSpec`·`containerSecurity` 미적용 ③ 모델 PVC 없음(재시작마다 2.1GB 재다운로드) ④ KEDA 트리거가 존재하지 않는 메트릭을 본다(영구 0). **넷을 다 고쳐도 남는 것은 "Bedrock 과 같은 일을 하는 두 번째 운영 경로"** 라서 고치는 대신 접었다
- **값만 되살아나는 사고를 테스트로 묶었다**: 템플릿이 없는 상태에서 `reminderLlm.enabled=true` 를 주면 **조용히 아무 일도 안 일어난다** — 스키마(`additionalProperties: false`)가 거부하는지 차트 테스트가 본다(`test_in_cluster_reminder_serving_was_withdrawn`)
- **BR-MLO-17(GPU 한도는 템플릿에 박는다)은 지우지 않고 철회 표시**했다. 규칙 자체는 맞다 — 다시 열 때 같이 되살린다. 규칙을 지우면 다음 사람이 같은 함정을 다시 밟는다
- **되살리는 조건을 적었다**: `ai/scripts/mlops/serving_judge.py`(주 1회 CloudWatch·CE 실측)가 Bedrock 대비 EKS GPU 우위를 수치로 제안할 때. 그때는 결함 4건이 미해결 상태이므로 **이 커밋을 revert 하지 않고 처음부터 다시 쓴다**
- **TRIP-961(GPU NodePool·쿼터)을 조건 기록으로 되돌렸다.** 09-26 에 "착수 요청으로 승격"으로 적었던 것을 취소한다 — 지금 쿼터를 신청하지 않는다
- **대신 적지 않은 것**: 전환 판정기의 판정 임계값을 수치로 고치지 않았다. 기준선(문구 1건 1,375ms · CMU 1 · 5분 창 과금)은 있지만 EKS 쪽 실측이 없어 비교할 숫자가 한쪽뿐이다 — 없는 숫자로 임계를 적지 않는다

## 2026-10-14 — 대중교통 실측을 ODsay 로 (TMAP 대중교통 상품 미구독)
**Timestamp**: 2026-10-14 · ADR `ai-adr.md` 어댑터 순서 항목 추가 · `adapters/odsay.py` · `chained_travel.ByModeTravelTime` · `ODSAY_API_KEY`
- **사용자 입력(원문)**: "카카오맵이나 네이버맵으로 해봐" → 확인 결과를 보고 "2번으로 가자."
- **왜 카카오·네이버가 아닌가**: 문서로 확인 — 카카오모빌리티 공개 상품은 자동차 길찾기뿐(도보·자전거는 제휴 전용), 카카오맵 Local API 는 경로 없음, 네이버 Directions 5/15 는 자동차만(대중교통은 지도 표시 레이어). 둘 다 대중교통 경로 API 가 없다. 로컬에 두 회사 키도 없어 호출 시도 자체가 불가능했고, 엔드포인트가 없으니 키가 있어도 같다
- **선택지 둘**: ① TMAP 대중교통 상품 구독(코드 0, 사용자가 콘솔에서 신청) ② ODsay LAB 어댑터. 권고는 ①이었고 사용자가 ②를 골랐다
- **무엇을 했나**: `OdsayTransitAdapter`(GET `searchPubTransPathT`, `result.path[].info` 의 `totalTime` **분**·`totalDistance` 미터, 본문 오류 → `TravelTimeError` + `__cause__.code`) · 수단별 1차 라우터 `ByModeTravelTime`(자동차·보행 TMAP, 대중교통 ODsay) · `main._travel_chain`(ODsay 키 없으면 종전대로 TMAP 이 대중교통도 맡아 상품 구독 시 바로 산다) · 시크릿 허용목록·차트·compose·env 예시 · smoke 표식 `실경로 배선`
- **지키는 것**: 메서드 1회 = HTTP 1건·재시도 없음(TMAP 선례). 실패는 승격·체인이 하버사인으로 폴백·원인별 첫 1회 경고(INV-4). 키가 쿼리 파라미터라 예외 메시지에 원문을 싣지 않는다. 사용자 노출 시각·순서는 여전히 조립값(INV-2) — 실경로가 바꾸는 것은 표시 거리와 TransitProvider 패킷뿐
- **확인하지 못한 것**: ODsay 의 **제주 커버리지**("전국"만 명시)·무료 일 한도·서버 플랫폼 키의 IP 등록 요건(dev 이그레스는 NAT EIP 1개). 픽스처는 문서 기준이라 실 응답 드리프트는 실키 첫 실행에서 잡는다 — 키 발급 뒤 로컬 스모크로 확정한다
- **대신 적지 않은 것**: 구현 리포트·스모크 스크립트(`smoke_itinerary.py`) ODsay 분기 — 실키가 생긴 뒤 한 번에 한다

## 2026-10-17 — 도우미 오케스트레이터 유닛 신설(FD) + 정본 개정 블록
**Timestamp**: 2026-10-17 · 유닛 `construction/assistant-orchestrator/`(번호 없음 — 번호 충돌 안티패턴, assistant-dialogue 선례) · 브랜치 `feat/assistant-orchestrator`(origin/develop 3dc23b4b) · **승인 대기**(같은 PR 머지 = 승인, #1071 선례)
- **사용자 입력(원문 요지)**: "챗봇 의도파악을 3단계(뱅크→투표→LLM)로 거치지 말고 바로 LLM 이 분류하되 이상한 프롬프트는 막는다 · AI 에 오케스트레이터를 두고 의도 파악 → 필요한 에이전트·Provider 에 병렬로 일을 시켜 결과를 받아 사용자에게 보일 답변을 조합한다(결과는 DB 에도 반영), 간단한 건 오케스트레이터가 직접 DB 조회 · 장단기 메모리 — 세션 id 당 10턴을 20줄로 요약해 DB 에 저장, 같은 사용자가 다시 쓰면 로드 · agent·provider·DB 를 전부 연결, 새 agent/provider 추가 가능, EditAgent 를 살리는 방향도 좋다 · 질문뱅크 3단은 서비스에서 빼되 병렬로 돌려 성능만 측정". 확인 질문 답(AskUserQuestion): ① 접근 = 안 A(기존 `/ai/v1/dialogue/interpret` 확장) ② 메모리 = AI 자체 DB 새 테이블 ③ EDIT_SCHEDULE 은 2단계 분리(1단계는 BE 기존 경로 `FRAME` 유지) ④ 일 LLM 턴 상한 30→100 · 섀도 DEV 100%·운영 20% · 섀도 LLM 호출은 사용량 상한 제외(로그만)
- **무엇을 했나(FD + 같은 PR 의 spec-kit 구현 — 코드·테스트·openapi·prompts·deploy 변경은 PR 본문·`ai/specs/001-assistant-orchestrator/tasks.md` 가 목록)**: FD 3종 신설(`construction/assistant-orchestrator/functional-design/`) + 뒤집는 정본에 `[개정 · 2026-10-17 · assistant-orchestrator FD]` 블록(원문 보존·삭제 0) — 모노레포 U8 `business-logic-model.md`(DEC-U8-1·4·5·6·8·11 · §2 7·8단계 · §3 계약 · §4 디스패치 표)·`business-rules.md`(BR-U8-22·26, BR-U8-45 유지 확인)·`nfr-requirements.md`(SEC-U8-03/05/06 · COST-U8-02/06 · PERF-U8-01/02/05 · DATA-U8-02/05/06/07 · OBS-U8-02), ai `assistant-dialogue` business-rules(BR-DLG-07·20·21 · §4 개정 목록 · 미결 #1·#2·#13 재개), inception `intent-matching-design.md` 배선 註 · `agent-structure-v2.md` §1·§3 · `orchestrator-delegation-design.md` §5, `ai/CLAUDE.md`·`claude.ko.md`·`README.md` Orchestrator 절, 모노레포 `aidlc/aidlc-docs/audit.md` append. `aidlc-state.md`·`docs/SCOPE.md` 는 건드리지 않았다
- **결정 4건**: ① **접근 안 A** — 새 경계가 아니라 `POST /ai/v1/dialogue/interpret` 확장. 요청 += `session_id`·`account_ref`·`recent_turns`(≤20, text ≤300), `request_meta.deadline_ms`(9,000)를 반드시 읽어 모든 LLM·Provider 호출에 시한을 내린다; 응답 `outcome` += `ANSWER` + `answer{kind TEXT|INFO|CANDIDATES, text ≤600, next_actions ≥1, quick_replies, footnote}`. 서비스 판정은 `DIALOGUE_INTENT`(LLM 직접, 새 feature·새 yaml, `IntentGate` 재사용) → `DialogueOrchestrator.turn()` 이 공유 풀에 병렬 팬아웃(Provider Weather·Transit·PoiInfo[신규]·PlanBAgent 인프로세스·스냅샷 계산, submit 전 마감 고정·미완 cancel → PARTIAL) → `DIALOGUE_ANSWER`(출구 게이트 ≤400자·줄 ≤6·INV-3·연락처, 실패·잔여 <1.5s 면 결정론 템플릿). 3단 `IntentRouter`·`prompts/intent.yaml` 0.2.0·`tests/fixtures/intent_gate` 는 **무변경**으로 섀도 전용(`ShadowIntentProbe`: 별도 LLM 카운터·trace 접미 `:shadow`·`intent_shadow` INFO 1줄, 발화 원문·slots 금지) ② **메모리 = AI 자체 DB** `ai_kb.dialogue_memory`(session_id PK · summary ≤20줄·줄 ≤120자 · `turn_index − summarized_turn_index ≥ 10` ∧ 잔여 ≥2.5s 일 때 `DIALOGUE_MEMORY`, 실패 시 결정론 압축 · expires_at = 90일, 쓸 때 연장) + 단기 기억은 BE 가 싣는 `recent_turns`(AI 는 원문 미저장) + BE 파기 경로(`clear`·`deleteForTrip`·`purgeAccount`)가 `DELETE /ai/v1/dialogue/memory` 호출(purge 실패는 예외 → 아웃박스 재시도, 나머지는 WARN + TTL 백스톱) · 내보내기 `GET …?account_ref=` → 섹션 `assistantMemory` ③ **EDIT_SCHEDULE 2단계** — 1단계(이 PR)는 `FRAME` 으로 BE `ProposalCards` `/edit` 경로 그대로, 2단계에 스냅샷 `end_at`·`is_fixed` + EditAgent 인프로세스 + `answer.kind=PROPOSAL`. 저장 지점은 어느 단계에서도 바뀌지 않는다(DEC-U8-2/3·BR-U8-30/33 유지) ④ **시한·상한** — BE `interpret-stage-max-ms` 5000→9000, 해석 read timeout = interpret + 5000 = 14s, 턴 예산 13s 유지(앱 15s 안), `daily-llm-turn-limit` 30→100, 턴당 LLM ≤3(분류 1·답변 ≤1·요약 ≤1 — 요약은 10턴에 1회), AI 내부 배분 분류 min(2.5s, 잔여×0.35)·팬아웃 min(3.0s, 잔여×0.4)·답변 min(2.5s, 잔여−0.4s)·요약 2.0s, 섀도 샘플링 `TRIPPILOT_DIALOGUE_SHADOW_RATE` DEV 1.0·운영 0.2(풀 2·in-flight ≤4), 기능 스위치 `TRIPPILOT_DIALOGUE_ORCHESTRATOR` 기본 off
- **뒤집는 결정**: U8 DEC-U8-1("AI 는 해석만")·DEC-U8-4/5(대화 상태는 BE 만)·DEC-U8-6(LLM 문장 비노출)·DEC-U8-8/11(첫 응답 정의·3단 전제) · BR-U8-22·26 · SEC-U8-03/05/06 · COST-U8-02/06 · PERF-U8-01/02/05 · DATA-U8-02/05/06/07 · OBS-U8-02 · ai BR-DLG-07(도구 호출은 3차에서만)·BR-DLG-20/21(AI 무상태·턴 목록 미전달) · inception "Orchestrator 판단 최소"(agent-structure-v2 §1·§3)·delegation §5 "DB 조회"·intent-matching 배선 註(2026-08-25 "호출자 0"). **유지**: DEC-U8-2/3·BR-U8-30/33(저장은 [적용]만)·INV-U8-07(`dialogue_context` 모양)·BR-U8-45(interpret 실패 ≠ 일정 폴백)·BR-DLG-06(closed-set 보증은 IntentGate)·INV-1~4
- **지키는 것**: AI → BE DB 직접 SQL 없음(열린 길 `/internal/pois` 반경·배치 둘) · BE `HttpDialogueInterpreterTest` 가 응답 키 집합을 정확 동등 단언하고 요청은 `extra=forbid` → AI·BE **한 PR** · FE 변경 0(kind 10종·NextAction 17종·서버 발급 quick reply) · 발화 원문은 두 곳만(SEC-U8-06 — 요약은 파생물) · 섀도 호출은 `llm_calls`·사용량 상한 비포함 · 허용 blast radius = "보이는 문장 오염"까지(재제안 금지) · 아키텍처 테스트 L-1~L-6(오케스트레이터 → agents·providers import 는 선례 허용, agents ← 금지) · 새 LlmFeature 3종은 BR-AF-07 5종 세트
- **대신 적지 않은 것(코드 전·실측 없음)**: 섀도 일치율·경로 비중·p95·턴당 비용 수치 — 측정 전이라 추정치로 채우지 않았다(최소 2회 측정 규약). `aidlc-state.md` 에 유닛을 추가하지 않았다(유닛 목록은 디렉토리를 볼 것 규약). 2단계(EditAgent 인프로세스)·다중 의도(DEC-U8-11)·여행 간 장기 기억 UX·prod 시크릿 값·LLM 단가표 GPT 모델 추가는 후속. DEV 시크릿 `TRIPPILOT_DIALOGUE_ORCHESTRATOR=on`·`TRIPPILOT_LLM_FEATURE_MODELS` 의 DIALOGUE_INTENT/ANSWER/MEMORY 배정은 배포 뒤 쓰기 세션 몫(ai-wiring 표식으로 확인)

## 2026-10-18 — 도우미 오케스트레이터 롤아웃: 시한 상한 실측 개정 + 배포 입력
**Timestamp**: 2026-10-18 · 유닛 `construction/assistant-orchestrator/` · 브랜치 `feat/assistant-orchestrator-rollout`(origin/develop f05fa159 = #1308 머지본) · **승인 대기**(같은 PR 머지 = 승인, #1071 선례)
- **사용자 입력(원문)**: "싹다 진행시켜. 다 머지 하고. 다 배포시켜."
- **무엇을 했나**: ① 실 모델 실측(gpt-5.6-luna 20턴 — 끝난 턴 기준 분류 p90 1.9s·답변 p90 2.4s, 2.5s 상한에서 분류 1/20·답변 2/17 이 잘림)으로 FD 시한 상한을 분류 `min(4.0s, 잔여×0.45)`·답변 `min(3.5s, 잔여−0.4s)` 로 개정(BLM §4 註·DE §2.8·BR 미결 #21 완화) ② 로컬 AWS 샌드박스 토큰 만료(`ExpiredToken`)로 시크릿 손편집이 막혀, `push_mode` 선례대로 배포 입력 `dialogue_orchestrator`·`llm_feature_models` 를 더함(BLM §11 註) — 기능 이름은 이 커밋과 **지금 떠 있는 AI 이미지** 양쪽이 알아야 쓴다(리뷰 확정 결함: 새 이름이 든 런이 helm 롤백되면 옛 이미지가 재시작 때 기동에서 죽는다) ③ 운영 대상 섀도 비율 0.2 를 배포 도구가 비어 있을 때 심음(사용자 결정 2026-10-17) ④ 배포 smoke 에 도우미 한 턴(기록만). U8 NFR PERF-U8-02 에 재개정 문장 덧붙임(원문 보존).
- **지키는 것**: 최악 합 9s 안(비율·예약 몫이 지키고 PBT 가 그 항을 단언) · 새 기능 이름은 두 번에 나눠 넣는다(입력 없는 배포 → 다음 런에서 배정) · 시크릿 값은 로그에 찍지 않는다(쓴 키 이름만, 백엔드 `ASSISTANT_INTERPRET_MODE` 모드 값만)
- **대신 적지 않은 것**: 기동 직후 첫 턴 지연은 따로 재지 않았다 — 개발·운영 배포 smoke 의 `ai-dialogue:` 줄이 그 표본이고 미결 #21 을 닫는 조건이다

## 2026-10-18 — 도우미 오케스트레이터 개발·운영 서버 켜짐 (FD DoD 배포 항목 · 미결 #21 해소)
**Timestamp**: 2026-10-18 · main `db78a7e8`(#1310 승격 — #1307·#1308·#1309·#1311) · **사실 기록**(결정 변경 없음)
- **무엇**: 개발 서버(target=dev)와 운영 서버(target=prod, 출시 앱이 보는 서버)에 각각 두 번 배포 — ① 입력 없이 새 코드(오케스트레이터 꺼짐, 운영은 섀도 비율 0.2 시드) ② `dialogue_orchestrator=on` + `llm_feature_models=DIALOGUE_INTENT/ANSWER/MEMORY=gpt-5.6-luna`. 운영 run 39109665486 → 39110593286, 개발 run 39104094998 → 39107006208 → 39108391074(상한 수정 재배포, 입력 유지 — 저장값 보존 확인)
- **확인한 것(배포 로그)**: `ai secret keys written: TRIPPILOT_DIALOGUE_ORCHESTRATOR, TRIPPILOT_LLM_FEATURE_MODELS` · `backend ASSISTANT_INTERPRET_MODE=http` · `기능별 모델 배정 23종 / 미배정 0종` · `ai-dialogue: {"http": 200, "outcome": "ANSWER", "llm_calls": 3, "memory_deleted": 1}`(운영 6,698ms) · Terraform 변경 0
- **함께 고친 것**: 분류 출력 상한 256 → 1024(#1311, 개발 서버 실측 출력 239/256) · main 등록용 사본 `ai-business-status-reminder.yml` 동기화(#1312 — #1295·#1302 때부터 main 대상 PR 의 ai-ci 를 빨갛게 하던 테스트)

## 2026-10-18 — 도우미 오케스트레이터 Codex 리뷰 반영 (확정 결함 8건)
**Timestamp**: 2026-10-18 · 브랜치 `fix/assistant-orchestrator-review`(develop 012a7413) · **승인 대기**(같은 PR 머지 = 승인)
- **입력**: 사용자가 다른 세션에 "챗봇 관련해서 codex code review 진행해. 그리고 챗봇 다루는 세션한테 알려줘." — 그 세션이 재현 스크립트로 검증한 확정분(medium 3·low 5)을 넘겼다.
- **무엇을 했나**: FD business-rules §6 표의 8건을 고쳤다 — ① 파기 뒤 되살아난 요약을 BE 가 "대화가 지워졌다" 갈래에서 한 번 더 지움 ② Provider 상태값 장애도 팬아웃 이벤트로 보고 ③ 답변 문장 시각을 Facts 와 대조(집합·장소 짝·대조 불가 한글 시각) + 영문 소요시간 단위 ④ BE 메모리 클라이언트를 해석 모드와 분리 ⑤ 만료 행 읽기 제외 ⑥ 이번 턴을 요약 재료에 ⑦ 결정론 압축에 게이트 술어 ⑧ 팬아웃 풀 32·메모리 DB 시한. BR-AO-05 의 "별도 시각 검사 없음"(미결 #18) 결정은 ③ 으로 뒤집었다(원문 취소선 보존).
- **지키는 것**: 이벤트 사유는 코드만(예외 메시지 미기록) · 대조 기준은 Facts 만(발화는 사실이 아님) · 재현 스크립트의 음성 사례가 수정 전 코드에서 실패함을 확인(10건 중 9건 실패, 1건은 정상 복사 통제군)

## 2026-10-18 — U6 Reflect 위반 코드 `PHOTO_SLOT_EMPTY` 추가 (하드)
**Timestamp**: 2026-10-18 · 유닛 `construction/u6-reflect/` · 브랜치 `fix/reflect-empty-photo-slot`(origin/develop a21c6b1a) · **승인 대기**(같은 PR 머지 = 승인)
- **무엇**: 사진 0장 방문(`photo_count == 0`)을 가리키는 `photo_slot`(장면·표지)을 하드 위반으로 판정하고, 사진 있는 방문으로 교체·없으면 슬롯 제거(PHOTO_* → STATS). 목록 밖 참조는 `VISIT_REF_OUT` 하나로 끝(이중 계상 없음). FD 개정: business-logic-model §4 교체 맵 · domain-entities §1 `ViolationCode` · business-rules BR-U6R-16, 계약 `reflection-template-design.md` §4.1 개정 블록. 프롬프트 `reflection_template.yaml`·`reflection_template_vision.yaml` v0.2.0 에 같은 규칙
- **왜**: FE 가 그 방문의 기기 사진으로 슬롯을 채우기로 했다(사진 바이너리는 서버로 오지 않는다) — 0장 방문 슬롯은 빈 칸이 된다
- **지키는 것**: 와이어 스키마 무변 · 장면 생략 없음(TRIP-558 카드 보존) · 교체 캡션 인덱스는 전체 방문 목록 기준

## 2026-10-18 — 도우미 오케스트레이터 Codex 2차 리뷰 반영 (low 1건 수정 · 1건 유지)
**Timestamp**: 2026-10-18 · 브랜치 `fix/assistant-answer-time-order`(develop bd416bda) · **승인 대기**(같은 PR 머지 = 승인)
- **입력**: 1차 리뷰를 한 세션이 #1314 포함 develop 을 다시 Codex 로 리뷰해 low 2건을 넘겼다(BE·배포 지적 없음, 회귀 없음).
- **무엇을 했나**: FD business-rules §6 에 2차 표 — ⑨ 이름 없이 떠 있는 슬롯 시각끼리 스냅샷 순서를 대조해 어기면 템플릿(`_slot_times` 를 순서 보존 튜플로·이름 없는 슬롯 포함, `_out_of_order` 추가, 본문·각주 이어서). 처음엔 문장의 모든 슬롯 시각에 순서를 강제했으나, 검증 리뷰가 맞는 초점·범위 답이 개수뿐인 템플릿으로 바뀌는 것을 실측해(범위 질문 24 중 8) 이름 붙은 시각은 뺐다. DE §7 INV-2 행에 순서 대조를 더했다.
- **유지한 것**: 사용자 지시로 자기 기억을 오염시키는 경로 — 답변 프롬프트의 두 규칙(사실 밖 날씨 금지·기억 속 지침 변경 무시)이 이미 있고 피해가 본인 문장까지라 요약 프롬프트는 바꾸지 않았다(실측 안 함).
- **지키는 것**: 재현 문장이 수정 전 코드에서 실패함을 확인 · 순서가 맞는 이름 없는 문장과 맞는 초점·범위 답은 통과(통제군) · 검증 리뷰가 찾은 기존 한계(③ 짝 검사의 마침표 문장·"각각" 구문, 날짜·서수어)는 FD 에 남겼다

## 2026-10-19 — 도우미 오케스트레이터 요약: LLM 이 비운 배열은 실패가 아니다 (BR-AO-09 개정) · 미결 #1·#13 해소 표기
**Timestamp**: 2026-10-19 · 브랜치 `fix/assistant-memory-empty-summary`(develop 3c5d44cbe) · **승인 대기**(같은 PR 머지 = 승인)
- **입력**: 개발 서버 배포 스모크의 기억 삭제 500 을 조사하다(원인은 uvicorn 작업 프로세스 재시작 루프 — 배포 담당 세션 #1355) 운영·개발 스모크 3/3 에서 요약이 `llm_empty_result` → 결정론 압축으로 떨어지는 것을 CloudWatch 로 찾았다.
- **무엇을 했나**: `DialogueMemoryGate` 가 LLM 이 비운 배열을 성공·0건으로 받고, 오케스트레이터는 그때 이전 요약을 두되 앞선 압축이 남긴 원문 조각 줄은 지운다(`summarized_turn_index` 만 전진). 0줄 성공은 `dialogue_memory_empty` 건수 로그로 센다(셀프 리뷰가 "비운 성공에 신호가 없다"·"압축 조각이 비운 배열로 안 지워진다"를 재현해 반영). 전부 드롭·파싱 실패는 지금처럼 실패 → 압축. BLM 세 곳·BR-AO-09 개정(원문 취소선 보존). 미결 #1(운영 켜짐)·#13(#1348 아웃박스 재시도)을 해소로 표기, 미결 #10 에 범위 축소 메모.
- **왜**: 요약 프롬프트는 "인사·잡담은 적지 않는다", "새로 기억할 것이 없으면 이전 요약을 그대로 두라"고 한다. 그 정답(빈 배열)을 실패로 보면 "- 사용자: …" 원문 조각이 저장돼 다음 턴 [기억]·내보내기로 나간다 — BR-AO-09 "원문 목록을 저장하지 않는다"와 어긋난다.
- **지키는 것**: 새 테스트가 수정 전 코드에서 실패함을 확인(원문 조각 저장 재현) · 전부 드롭은 여전히 실패(라벨 `gate_dropped_all` 유지) · 비운 배열 성공은 게이트가 아무것도 안 버렸을 때뿐(PBT)

## 2026-10-19 — 도우미 오케스트레이터 E2E 결함 3건 (휴무 표기 · 넘기기 답변 · 대체 사유 사상)
**Timestamp**: 2026-10-19 · 브랜치 `fix/assistant-handler-answers`(develop f52f58cf) · **승인 대기**(같은 PR 머지 = 승인)
- **입력**: 사용자 요청으로 챗봇 실동작을 검증한 세션이 실 LLM·실 Provider E2E(제주 IN_TRIP 12상황)에서 재현한 결함 3건을 넘겼다.
- **무엇을 했나**: ① GET_POI_INFO — `hours_label` None("그 요일이 휴무로 읽힘")을 "미확인"으로 뭉개던 것을 "휴무일 수 있음"으로, 기준일이 오늘이 아니면 "날짜" 행(BLM 표 개정; 테스트 대역이 None 으로 "모름"을 흉내 내던 것도 실물 문구로) ② 사실이 하나도 없는 Facts(넘기기 의도 6종·남은 일정 없음)는 답변 LLM 없이 안내 문구로(BR-AO-25 개정), 일정 자체가 없을 때의 다음 일정 답은 만들기로 ③ SUGGEST_ALTERNATIVE 의 한글 자유문 사유를 말꼴 정규식으로 PlanB 어휘에 사상(BR-AO-20 개정) + 속성 테스트. 셀프 리뷰(불변식) 경고 7건 반영 — 날씨 오탐·휴무 단정·날짜 없음·판정 범위·결정론 목록·spec 정합·PBT.
- **지키는 것**: 새 테스트가 수정 전 코드에서 실패함을 확인(휴무가 "미확인", 일정 만들기 요청에 엉뚱한 LLM 문장) · 사유 사상은 오탐보다 미탐("비싸서"는 none) · 후보 카드의 사유 라벨("근처의 대안")은 BR-AO-20 그대로.
- **남긴 것**: 비식사 칸의 대안에 식당이 섞이는 것(문학관 대신 국숫집) — `_same_role` 은 식사 칸만 좁힌다(10-14 결정). 반대 방향 규칙은 제품 결정이라 보고만 한다.

## 2026-10-19 — 도우미 오케스트레이터 GET_DISTANCE: 직선 추정 거리를 추정으로 밝힌다
**Timestamp**: 2026-10-19 · 브랜치 `fix/assistant-distance-estimate-label` · **승인 대기**(같은 PR 머지 = 승인)
- **입력**: 챗봇 E2E 재검증 세션 — 경로 키 일일 한도 초과 동안 거리가 직선 추정 "약 3.1km"(실제 경로 5.8km)로 표시 없이 나갔다.
- **무엇을 했나**: 거리 작업이 Provider `confidence` 를 넘기고, LOW(하버사인×우회계수)면 행·장소 거리 뒤에 "(추정)", 메모 "직선 거리로 어림한 값". BLM GET_DISTANCE 행 개정.
- **지키는 것**: INV-3(거리만, 소요시간 없음) · 경로 API 값(HIGH)은 그대로 · 상태는 OK 유지(거리 미확인으로 바꾸지 않는다 — 어림값도 쓸모가 있다)

## 2026-10-19 — 후보 풀 ⑥ 상한 절단을 카테고리별 공평 몫으로 (U3 M7 FD 개정)
**Timestamp**: 2026-10-19 · 브랜치 `fix/ai-pool-fair-cut` · **승인 대기**(같은 PR 머지 = 승인)
- **입력**: 개발 서버 서울 생성 로그에서 프리필터가 매번 "잔존 0: CAFE,NATURE,NIGHT_VIEW" 를 냈다(후보 5,000 중 FOOD 4,321). 사용자가 고치라고 했다.
- **무엇을 했나**: `CandidatePoolBuilder` ⑥ 을 "정렬 앞 5,000" 에서 카테고리별 공평 몫으로 바꿨다. 몫은 작은 카테고리부터 남은 자리 ÷ 남은 카테고리 수이고, 카테고리 안은 종전 정렬(영업시간 보유 → 저장 수)의 앞부분이다. FD business-logic-model §2 ⑥ · business-rules 상한 행을 개정했다.
- **왜**: 공유본 재현(서울시청 10km, 1.4만 곳 중 FOOD 89%)에서 영업시간 있는 FOOD 가 앞을 다 차지해 자연 132→11·쇼핑 251→45·명소 339→152 만 남았다. 그 뒤 점수·프리필터는 남은 것만 보므로 하루가 식당·명소로만 채워졌다.
- **지키는 것**: 새 테스트가 수정 전 코드에서 실패함을 확인했다(공평 몫 PBT · 서울 모양 예제). 끝까지 돌린 실측(공유본 서울 4거점, 규칙 점수 → OR 조립)에서 카페·자연이 든 날이 0/4 → 4/4 였다. 풀 크기 5,000·순서 규칙(전체 정렬 순서 보존)은 그대로다.
- **남긴 것**: 카페 데이터 자체가 적다(시청 10km 카페 126곳, 식당 중 카페류 이름 173곳) — 수집 범위 문제로 따로 보고했다. 프리필터의 쇼핑 잔존 0 은 규칙 점수가 낮아서다(점수 몫).

## 2026-10-19 — 도우미 답변 말투: 친근한 대화체 (답변 프롬프트 0.3.0 · 넘기기 안내 문구)
**Timestamp**: 2026-10-19 · 브랜치 `feat/assistant-friendly-tone`(develop c6271dfc2) · **승인 대기**(같은 PR 머지 = 승인)
- **입력**: 사용자 요청 — 도우미 답변을 더 친근하게, 대화하듯이. "지금은 너무 answer 만 띄워 주는 느낌".
- **원인**: `prompts/dialogue_answer.yaml` 0.2.0 이 "짧게 답하세요"·"첫 문장에 답, 다음 문장에 꼭 필요한 보충만"을 시켰고 예시 둘이 한두 문장 단답이었다 — 말투는 규칙 줄보다 예시가 정한다. 문체 상수 `ANSWER_STYLE` 도 "2~4문장, 존댓말" 정도뿐이었다.
- **무엇을 했나**: ① 프롬프트 0.3.0 — 해요체 대화로 맞장구·공감 한마디 → 답(사실은 [확인된 사실]에서만, 장소의 분위기·특징도 지어내지 않고 맞장구에 발화의 시각·숫자를 옮기지 않는다) → 도우미가 이어서 할 수 있는 일(날씨·거리·다음 장소·대신 갈 곳·영업시간) 하나를 제안·되묻기. 예시 2건을 그 말투로 다시 썼다(시각은 "14:00" 표기 그대로, Figma 밴드 b 말풍선 근거). ② 공유 정규식(`_TIME_EXPR`·`_NUM`)이 소요 표현으로 읽는 "두 분이"·"이 분께"·"이 시간에는"을 규칙 줄로 피하게 하고 예시에도 쓰지 않는다 — 정규식은 리마인드·회고 게이트와 공유라 바꾸지 않았다. ③ `ANSWER_STYLE` 을 같은 말투로(한 줄·단일 공백). ④ 넘기기 6의도(GENERATE_SCHEDULE·REGENERATE·REPLAN 여행 중/그 밖·회고 3종) 결정론 문구를 안내 한 문장 + 아래 버튼으로 이끄는 제안으로 — BE `IntentDispatcher` 원문도 같은 문장(한 벌, BE 고정 테스트 신설). FD DE §2.10·§6, BLM §5 넘기기 3행 개정(원문 취소선 보존).
- **지키는 것**: 규칙 고정 문구 10개·주입 방어·400자·6줄·이모지 한도·평문·시각 표기 규칙 무변 · 모든 템플릿이 답변 게이트를 스스로 통과(AO-P17) · 새 테스트가 수정 전 코드에서 실패함을 확인(AI 4건 — 판본·말투 규칙 문구·예시 말투·문구 고정, BE 2건) · 이 브랜치에서 실 LLM 호출 0(실측은 메인 세션)

## 2026-10-19 — 도우미 의도 분류: 짧은 수락을 직전 도우미 제안으로 (분류 프롬프트 0.2.2)
**Timestamp**: 2026-10-19 · 브랜치 `feat/assistant-friendly-tone`(195fdd7c8 위) · **승인 대기**(같은 PR 머지 = 승인)
- **입력**: 같은 브랜치의 답변 프롬프트 0.3.0 이 답을 "출발 전에 날씨도 볼까요?"처럼 제안·되묻기로 끝내 "응"·"좋아"·"그래"·"네 알려줘" 같은 짧은 수락 턴이 는다 — 메인 세션이 넘긴 후속 작업.
- **원인**: `prompts/dialogue_intent.yaml` 0.2.1 에 짧은 수락을 [최근 대화]의 직전 도우미 제안으로 풀어 읽는 규칙·예시가 없다 — "응" 홀로는 `{"intent": null}`(→ OUT_OF_SCOPE)로 떨어질 수 있다. 판단 순서 1("다룰 요청인지")·5("발화에 나온 값만")도 그쪽으로 민다.
- **무엇을 했나**: ① 프롬프트 0.2.2 — 규칙 한 줄(마지막 도우미 말이 제안·되묻기로 끝났고 현재 발화가 짧은 수락이면 그 제안의 의도로, 제안의 장소·날짜는 그 의도의 parameters 에 있는 이름으로만; 짧은 사양 "아니"·"괜찮아"는 범위 밖 null 이되 규칙을 바꾸려는 요청과 달리 사양 뒤에 붙은 요청은 고른다), 판단 순서 1·5 괄호, 예시 2건(GET_WEATHER `date` · SUGGEST_ALTERNATIVE `target` — 평가셋·측정 스크립트 밖 문장), 머리 주석 판본 표기 v0.2.0 → v0.2.2(0.2.1 때 필드만 올라갔다)·판본 이력. ② 넘겨받은 예시안("응" → GET_WEATHER, slots 에 그 장소)은 그대로 쓰지 않았다 — GET_WEATHER 가 묻는 인자는 `date`·`period` 뿐이라(`region` 은 `lands_in=None`) 장소 키는 `IntentGate` ⑤가 버리고 드롭으로 센다. 날씨 예시는 제안의 날짜를 담는 꼴로, 장소를 담는 예시는 필수 인자가 있는 SUGGEST_ALTERNATIVE 로 보였다. ③ FD DE §2.10 판본 표 개정(원문 취소선 보존)·개정 블록.
- **지키는 것**: `IntentGate`·인자표·`$intents`·`prompts/intent.yaml`·재생 픽스처 무변(BR-AO-14) · 게이트는 슬롯의 모양·키만 보고 값이 발화에 있는지는 보지 않는다(지시어 풀이 선례) · 새 테스트 2건과 판본 고정 1건이 수정 전 코드에서 실패함을 확인(규칙 문구 · 예시 전부 게이트 무드롭 통과 + 수락 예시의 값이 발화가 아니라 제안에서 온다 + 평가셋 문장이 아니다) · 이 브랜치에서 실 LLM 호출 0(실측은 메인 세션)
- **남긴 것**: 짧은 사양은 지시대로 범위 밖이라 BE SCOPE 카드("그건 제가 도와드리기 어려워요.")가 나가고 거절 스트릭이 오른다(2연속이면 사용 안내). 실측 전이라 수락 정확도·지연 숫자는 적지 않았다.

## 2026-10-19 — 도우미 대화체 마무리: 맞장구·인사 답(BR-AO-26) · 마무리 제안 규칙 · 짧은 수락 측정 사례
**Timestamp**: 2026-10-19 · 브랜치 `feat/assistant-friendly-tone`(f9fce52a6 위) · **승인 대기**(같은 PR 머지 = 승인)
- **입력**: 같은 브랜치의 답변 0.3.0·분류 0.2.2 를 실 LLM 으로 잰 메인 세션 — ① 답이 "확인되지 않았어요" 바로 뒤에 "다시 확인해 드릴까요?"를 붙인다(수락하면 같은 답이 되풀이된다) ② 분류 0.2.2 는 짧은 사양("아니 괜찮아")을 범위 밖으로 두므로 BE SCOPE 카드가 나간다(같은 브랜치 앞 항목의 "남긴 것").
- **무엇을 했나**: ① 오케스트레이터 2″ — 분류가 거절 표지로 닫았고 발화 전체가 맞장구·인사면 결정론 ANSWER(감사 → "천만에요! …", 그 밖 → "알겠어요! …"), 시한·벤더 실패는 종전대로 범위 밖(BR-AO-26 신설, BLM §3·§7·DE §2.2 개정, AO-P6 범위 주석) ② 답변 0.3.0 마무리 규칙에 "방금 확인 못 한 것을 다시 확인해 주겠다고 하지 않기"·"길 안내·이동 경로 금지"(판본은 미배포라 0.3.0 그대로, DE §2.10 메모) ③ `measure_prompt_ab.py intent` 에 짧은 수락 사례 8건(제안별 6 · 제안 없는 "응" · 사양) — 평가셋은 대화 맥락을 못 실어 러너의 맥락 사례 옆에 두었다.
- **지키는 것**: 분류가 먼저 돈다(제안 뒤 "응"은 수락) · 발화 전체 일치만(뒤에 요청이 붙으면 분류 몫) · 답 문장은 답변 게이트를 그대로 통과 · 새 테스트 7건이 수정 전 코드에서 실패함을 확인 · BE·와이어 무변(ANSWER 무프레임은 BR-AO-18 선례)
- **실측**(Azure 게이트웨이 경유 gpt-5.6-luna, 같은 시각 나란히 54회): 답변 0.2.0 → 0.3.0 게이트 통과 88.9% → 96.3%(실패는 전부 3.5s 시한), 시각-장소 짝 위반 0 · 0, 출력 토큰 평균 44.5 → 62.5. 마무리 규칙 전후 "다시·더·따로 확인" 제안 17 → 0, "이동 경로" 3 → 0, p90 2.16s → 2.22s.

## 2026-10-19 — 도우미 대화체 리뷰 반영: 맞장구 판정 · 긴 답의 제안 보존 · 넘기기 문구
**Timestamp**: 2026-10-19 · 브랜치 `feat/assistant-friendly-tone`(e6d3a5100 위) · **승인 대기**(같은 PR 머지 = 승인)
- **입력**: 세 브랜치 읽기 전용 리뷰 + 반박 검증(살아남은 지적 medium 3건이 이 브랜치 몫, low 3건).
- **무엇을 했나**: ① 맞장구 판정(BR-AO-26 개정) — `normalize`(NFKC)가 ㅎ·ㅋ 를 첫소리 자모로 바꿔 "고마워ㅎㅎ"가 범위 밖으로 떨어졌다 → 문장부호·쉼표·웃음(두 자모 모두)을 낱말 사이로 보고 낱말이 전부 목록이면 맞장구("아니요, 괜찮아요"·"네, 감사합니다" 포함), 감사 낱말이 있으면 감사 답. 조건은 `is_refusal` 이 아니라 `{"intent": null}`(게이트 상수 `NULL_INTENT`)·범위 밖 라벨만 — 깨진 출력·절단·슬롯 모양은 판단이 아니라 실패라 종전대로 범위 밖(제안 뒤 "응"의 수락을 삼키지 않는다) ② BE 최근 턴 300자 — 앞만 남기던 것을 앞 200자 + "…" + 끝으로(답의 끝 문장이 제안이다), 자르는 자리에서 서로게이트 쌍을 가르지 않는다(PBT) ③ 넘기기 문구 6종이 "…볼까요?"로 끝나 수락 규칙과 맞물려 "응"에 같은 문장이 되풀이됐다 → "아래 버튼을 누르면 바로 시작해요"처럼 안내로 끝낸다(AI·BE 한 벌) ④ AO-P10 문구(ANSWER ⇒ frames ≤1)·spec.md FR-005·US4 개정.
- **지키는 것**: 새·개정 테스트가 수정 전 코드에서 실패함을 확인 · 게이트 동작 무변(문구를 상수로만) · 와이어 무변

## 2026-10-19 — 회고 카드: 장소 이름 자리표시자를 AI 가 응답 전에 채운다 (계약 §2 개정)
**Timestamp**: 2026-10-19 · 브랜치 `fix/reflect-bind-poi-names` · **승인 대기**(같은 PR 머지 = 승인)
- **입력**: FE `fillTemplate`(TRIP-1212·1425)가 `{region}`·`{start_date}`·`{end_date}` 3종만 알고 모르는 토큰을 빈칸으로 지운다는 실측. AI 어휘는 7종이고 장면 캡션·교체 안전 문구가 `{poi:i.name}` 을 쓴다 → FE 가 장면을 그리는 순간(장면 렌더 티켓) "{poi:1.name}에서 보낸 저녁" 이 "에서 보낸 저녁" 으로 깨진다.
- **무엇을 했나**: `composer.bind_poi_names` — `finalize` 의 하드 교체 **뒤**에서 `{poi:i.name}` 을 `visits[i].poi_name` 으로(해시태그는 공백 제거). 토큰 판정은 게이트와 같은 상수(`POI_PLACEHOLDER_PATTERN`, fullmatch)라 형식이 어긋나지 않는다. 범위 밖·빈 이름·공백 섞인 토큰은 손대지 않는다. 계약 §2 에 개정 단락, FD §3 에 ⑤′ 단계.
- **왜 AI 가**: i 는 AI 요청 visits 의 인덱스라 순서를 정확히 아는 곳이 AI 뿐이다. 환각 차단 원리는 그대로(LLM 은 인덱스만, 이름은 결정론 코드). 부수 효과로 BE `HallucinationGate`(건너뛴 장소 이름이 payload 에 있으면 강등)가 처음으로 캡션 속 장소를 읽게 된다.
- **지키는 것**: 나머지 어휘 6종은 렌더러 몫으로 그대로 · 와이어 스키마 무변 · `wiring.py` 무변 · 공유 카드는 이 토큰을 쓰지 않아 무변 · 변이 4종(순서 뒤집기·바인딩 제거·태그 공백·공백 토큰 인정)이 각각 테스트를 빨갛게 함을 확인

## 2026-10-19 — 도우미 답변 프롬프트 0.3.1: 여는 말 반복 · 질문과 안 이어지는 마무리
**Timestamp**: 2026-10-19 · 브랜치 `fix/assistant-answer-openers`(develop b1fb3b737) · **승인 대기**(같은 PR 머지 = 승인)
- **입력**: 챗봇 테스트 화면을 만든 세션이 실 LLM 대화에서 본 두 건 — 답마다 "알려 드릴게요!"·"확인해 볼게요!"로 연다(이미 확인한 결과를 이제 하겠다는 말로), 날씨 답 끝에 거리 확인을 권한다(질문과 안 이어진다).
- **원인**: 0.3.0 예시 둘이 "바로 알려 드릴게요!"·"…궁금하시군요."로 시작했다 — 모델이 여는 말을 따라 한다. 마무리 규칙은 "할 수 있는 일 하나"만 말하고 질문과의 연결은 말하지 않았다.
- **무엇을 했나**: 예시 여는 말 제거(공감은 내용에 맞을 때만 — "아쉽게도"), 날씨 예시 추가(비 → 실내에서 대신 갈 곳), 규칙 두 줄(어디에나 붙는 여는 말 금지 · 마무리는 방금 질문과 이어지는 것), 문체 상수 `ANSWER_STYLE` 같은 뜻으로. DE §2.10 행 개정.
- **실측**(Azure 경유 luna, 같은 시각 나란히 54회): 여는 말 22 → 0, 날씨 답의 엉뚱한 마무리 12/12 → 0, 게이트 100% 유지, 짝 위반 0, p90 2.17s → 2.54s.
