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
