# AI-DLC Audit Log — TripPilot

이 파일은 모든 사용자 입력과 AI 응답/결정을 시간순으로 기록한다. 항상 **추가(append/edit)** 하며 절대 전체 덮어쓰지 않는다.

---

## Workflow Start — Initial User Request
**Timestamp**: 2026-07-11T07:45:03Z
**User Input**: "AIDLC 워크플로우 시작해줘. docs/SCOPE.md 범위를 따라줘."
**AI Response**: AIDLC 워크플로우를 시작. `docs/SCOPE.md`를 필수 사전 읽기로 로드하여 이번 실행 범위(INCEPTION 단계 완료까지, 그린필드)를 확인. 룰 상세 디렉토리를 `.aidlc-rule-details/`로 확정하고 공통 룰(process-overview, session-continuity, welcome-message, question-format-guide, content-validation) 및 확장 opt-in 3종(security, resiliency, property-based testing)을 로드. 입력 정본 `docs/PRD/README.md`와 `docs/design/wireframes.md`를 확인.
**Context**: Workflow initialization. Scope = INCEPTION only (Workspace Detection → Requirements Analysis[Comprehensive] → User Stories → Workflow Planning → Application Design → Units Generation → STOP).

---

## Workspace Detection
**Timestamp**: 2026-07-11T07:45:03Z
**User Input**: (N/A — 자동 실행 단계)
**AI Response**: 워크스페이스 스캔 수행. 소스코드 파일(.java/.py/.js/.ts/.tsx 등) 및 빌드 파일(package.json/pom.xml 등) 없음 확인 → **그린필드(Greenfield)** 프로젝트로 판정. 기존 `aidlc-docs/aidlc-state.md` 없음 → 신규 프로젝트. `aidlc-docs/` 디렉토리 구조 및 `aidlc-state.md`, `audit.md` 생성. Reverse Engineering 불필요(그린필드). 다음 단계: Requirements Analysis (Comprehensive).
**Context**: Workspace Detection stage (ALWAYS). Greenfield confirmed. Inputs: docs/PRD/ (16 docs) + docs/design/wireframes.md (Figma, fileKey 1MTF3dtptIrbg8gld5IdO2).

---

## Requirements Analysis (Comprehensive) — Stage Start
**Timestamp**: 2026-07-11T07:45:03Z
**User Input**: (N/A — 자동 진행. 사용자 초기 지시 "AIDLC 워크플로우 시작해줘. docs/SCOPE.md 범위를 따라줘." 기준)
**AI Response**: docs/PRD/ 16개 문서(01~15 + README) 전체 정독 완료. Intent Analysis: 요청 유형=신규 프로젝트(그린필드), 범위=시스템 전반(모바일 클라이언트 + 백엔드), 복잡도=Complex, 요구 명확도=상당히 명확(PRD가 수용 기준·예외·ADR까지 정본화). 확장 opt-in 3종 및 핵심 스코핑·NFR 결정을 `requirement-verification-questions.md`로 작성해 사용자 승인 대기(Step 6 GATE).
**Context**: Requirements Analysis Step 2~6. Depth=Comprehensive (SCOPE.md 지정). PRD=기능 정본, Figma 와이어프레임=UI/UX 정본.

---

## Requirements Analysis — Verification Questions Presented (GATE)
**Timestamp**: 2026-07-11T07:45:03Z
**AI Response (Approval/Question Prompt)**: `aidlc-docs/inception/requirements/requirement-verification-questions.md` 생성. 질문 구성 — (1) 보안 확장 opt-in, (2) 복원력(Resiliency) 확장 opt-in, (3) 속성 기반 테스트(PBT) 확장 opt-in, (4) 인셉션 유닛 커버리지 범위, (5) 딜리버리 표면/플랫폼 확인, (6) 비기능 요구 수록 수준, (7) Figma 프레임 갭 분석 시점. 사용자가 [Answer]: 태그를 채운 뒤 완료를 알리면 모호성 분석 후 requirements.md 생성 예정.
**Context**: Requirements Analysis Step 5.1 + Step 6. DO NOT PROCEED until answers received.

---

## Requirements Analysis — User Answers Received
**Timestamp**: 2026-07-11T07:45:03Z
**User Input**: "다 작성함 이어서ㄱㄱ"
**User Input (verification file answers, verbatim)**:
- Q1 (Security 확장): "A"
- Q2 (Resiliency 베이스라인): "A"
- Q3 (Property-Based Testing): "B"
- Q4 (인셉션 유닛 커버리지): "A"
- Q5 (딜리버리 표면/플랫폼): "A"
- Q6 (NFR 수록 수준): "B"
- Q7 (Figma 프레임 갭 분석 시점): "B"
- [추가 메모]: "ai 솔버의 경우 새롭게 설계 현대 에이전트 방식으로 설계 aws 베드락 agent core를 통해 사용하는 에이전트 새로 정의 현재 PRD 내용은 잊어 버리도록"
**AI Response**: 답변 수신·검증. 확장 3종 상태 확정(Security=ON/full, Resiliency=ON/full, PBT=ON/partial[순수함수·직렬화 왕복만]). 활성화 확장 규칙 파일 로드. Q4=A(핵심 여정 1차 + 어시스턴트/커뮤니티/공동편집 후속 분리 게이트), Q5=A(모바일 iOS+Android+클라우드 백엔드·국내·한국어), Q6=B(정량 성능/확장성/가용성 목표를 가정으로 명시), Q7=B(인셉션에서 Figma 대표 화면 갭 점검 수행). **[중대 지시 반영] AI 일정 솔버(모듈 8·9·10 및 어시스턴트/공동편집이 의존하는 '솔버' 개념)는 PRD의 결정론적 OPTW/TOPTW 하이브리드(ADR-0008/0009 솔버 메커니즘)를 버리고 AWS Bedrock AgentCore 기반의 새 에이전트형 설계로 대체한다. 사용자 가치 불변식(등록 숙소 앵커·영업시간·이동시간·필수 방문지·취향 반영 일정의 실현가능성)은 유지하되, 그 실현 메커니즘을 에이전트+도구 방식으로 재정의. 상세 설계는 Application Design/CONSTRUCTION에서 확정.** 모순 점검: 다중선택 답변 간 논리 모순 없음. 솔버 지시는 PRD 정본을 부분 대체하는 명시적 사용자 지시로 requirements에 1급 요구+가정으로 기록.
**Context**: Requirements Analysis Step 6 answers + Step 5.1 extension config. Proceeding to Figma light gap check + requirements.md generation.

---

## Requirements Analysis — Figma Light Gap Check (Q7=B)
**Timestamp**: 2026-07-11T07:45:03Z
**AI Response**: 서브에이전트로 Figma(fileKey 1MTF3dtptIrbg8gld5IdO2) 13개 대표 화면 get_metadata + 전체 페이지 스크린샷 점검. 결과: 매니페스트 화면그룹↔에픽↔유닛 매핑 신뢰도 높음, 프레임 수 대체로 일치(a5·c19·d3·e15·g5·h35·i22·j17·k17·l16). PRD 세부 규칙(날짜·인원 없는 숙소검색, 거리만 표기·소요시간 미표시, plan/actual 체크, 탐색 3진입, 5탭/2뷰, 필수/선택 폼 분기)이 화면에 반영됨. DS-Catalog(59:2)에 EmptyState/ErrorState/SkeletonCard/Banner 등 상태 컴포넌트 확인. **인셉션 진행을 막는 갭 없음.** 후속 정리 2건: (1) 매니페스트 미기재 '입력 컴포저' 프로토타입 섹션(~10프레임) 유닛 매핑/제외 결정, (2) 네거티브·엣지(공유카드 3비율·로그인 4종·계획↔실제 토글 등) 부재 확정은 형제 프레임 전수 감사 필요(라이트 점검 한계).
**Context**: Requirements Analysis. Figma UI/UX 정본 라이트 검증 완료.

---

## Requirements Analysis — Follow-up Questions Presented (Resiliency mandate + Solver scope) (GATE)
**Timestamp**: 2026-07-11T07:45:03Z
**AI Response (Question Prompt)**: 복원력 확장(ON) 규칙이 요구 단계에서 사용자 결정을 의무화(RESILIENCY-02 RTO/RPO·DR 전략은 "요구 확정 전 필수 질문", RESILIENCY-03 변경관리, RESILIENCY-08 리전 토폴로지, RESILIENCY-15 장애대응). 또한 AI 솔버 재설계 지시의 범위/실현가능성 보장 방식을 확정하기 위해 `requirements/requirements-followup-questions.md` 생성 — Part A(솔버 2문항: 범위, 실현가능성 보장 방식), Part B(복원력 4문항: RTO/RPO+DR, 리전 토폴로지, 변경관리, 장애대응). RESILIENCY-04(CI/CD·롤백·배포방식)·RESILIENCY-14(복원력 테스트)는 규칙상 NFR Design(CONSTRUCTION)으로 이연 — 이번 범위 밖, 해당 단계에서 질의 예정. 사용자 답변 후 requirements.md 생성.
**Context**: Requirements Analysis follow-up gate (deferred resiliency rule loading triggered mandated questions). DO NOT PROCEED to requirements.md until answered.

---

## Requirements Analysis — Follow-up Answers Received
**Timestamp**: 2026-07-12T00:00:00Z
**User Input**: "다 답변했어"
**User Input (follow-up file answers, verbatim)**:
- Q1 (솔버 재설계 범위): "AI solver개념은 그대로 두고 최종 산출물의 score가 낮을경우 bedrock agent를 활용하여 재설계. 여기서 재설계는 선택사항 B를 따른다."
- Q2 (실현가능성 보장 방식): "A"
- Q3 (RTO/RPO + DR 전략): "E"
- Q4 (리전 토폴로지): "A"
- Q5 (변경관리): "A jira slack git 프로젝트에서 사용"
- Q6 (장애대응): "B"
- [추가 메모]: (비어 있음)
**AI Response**: 답변 수신·검증. **[중대: 이전 지시 정제/부분 번복]** Q1 답변이 2026-07-11 기록된 1급 지시("결정론적 OPTW/TOPTW 솔버를 *버리고* Bedrock AgentCore 에이전트로 전면 대체")를 정제함. 새 결정: **결정론적 AI 솔버 개념을 1차 엔진으로 유지**하되, 솔버 최종 산출물의 품질 score가 임계 미만일 때에만 **Bedrock AgentCore 에이전트가 개입해 재설계(재계획)**하며, 그 에이전트 재설계의 범위는 옵션 B(엔진 + 일부 PRD 강제 규칙까지 재검토/완화 대상 포함). Q2=A와 정합 — 실현가능성(영업시간·이동시간·숙소 앵커·시각 충돌 없음)은 에이전트가 호출하는 결정론적 검증/최적화 도구(=유지된 솔버)가 소유·보장, 환각 시각 노출 불가. 복원력: Q3=E(단일 리전+다중 AZ, 리전간 DR 불필요), Q4=A(단일 리전·다중 AZ) — 상호 정합. Q5=A(기존 조직 프로세스: Jira/Slack/Git 사용 — 이에 맞춰 변경관리 산출물 정합), Q6=B(경량 장애대응 + COE/포스트모템을 AI가 제안). 모순 점검: 복원력 답변 정합(E↔A). 단, Q1이 기록된 상태(aidlc-state.md Key User Directive)와 상충하므로 requirements.md 생성 전 해석 확정을 위해 사용자에게 1건 집중 확인 진행.
**Context**: Requirements Analysis follow-up answers. 솔버 아키텍처 해석 확인 게이트 → 확인 후 aidlc-state.md 지시 갱신 + requirements.md 생성.

---

## Requirements Analysis — Solver Architecture Interpretation Confirmed
**Timestamp**: 2026-07-12T00:05:00Z
**AI Response (Question Prompt)**: Q1 답변이 2026-07-11 기록된 1급 지시("솔버 폐기·에이전트 전면 대체")를 뒤집는 정제이므로, requirements.md 확정 전 해석을 사용자에게 확인. 제시 해석 = "결정론적 OPTW/TOPTW 솔버 1차 엔진 유지 → 최종 산출물 품질 score < 임계일 때만 Bedrock AgentCore 에이전트가 옵션 B(엔진+일부 규칙 완화) 범위로 재설계 → 실현가능성은 에이전트가 호출하는 결정론적 검증도구(=유지된 솔버)가 보장(Q2=A)".
**User Input**: "맞음 — 하이브리드 확정" (AskUserQuestion 선택)
**AI Response**: 하이브리드 아키텍처 확정. aidlc-state.md Key User Directive를 하이브리드로 갱신 완료(이전 '전면 대체' 지시 폐기). 이 해석을 requirements.md에 1급 요구(FR-SOLVER)로 기록. requirements.md 생성 진행.
**Context**: Requirements Analysis Step 6 ambiguity resolution 완료. 모든 후속 모호성 해소 → Step 7(requirements.md 생성) 진입.

---

## Requirements Analysis — requirements.md Generated + Approval Prompt (GATE)
**Timestamp**: 2026-07-12T00:10:00Z
**AI Response**: `aidlc-docs/inception/requirements/requirements.md` 생성(Comprehensive). 구성 — 의도분석, 스코핑(Q4=A 핵심여정 1차+후속게이트 3), 기능요구(FR-CORE/SHELL/ONBOARD/STAY/TRIP/SCHED/PLANB/ONTRIP/RECORD/NOTIF + 후속 ASSIST/COMMUNITY/COEDIT + **FR-SOLVER 하이브리드**), NFR(Q6=B 가정), 보안(SECURITY-01~15), 복원력(Q3=E/Q4=A/Q5=A Jira·Slack·Git/Q6=B; RES-04·14 이연), PBT(Partial), 법적(위치정보법·국내지도API), 범위제외, 가정·미해결, 추적성. 콘텐츠 검증(ASCII 다이어그램 표준·특수문자) 수행.
**Extension Compliance (Requirements 단계 적용분)**: Security=요구 반영(설계단계 검증 예정) / Resiliency=RESILIENCY-02·03·08·15 사용자 결정 확정·반영, 04·14 이연(N/A this stage) / PBT=PBT-09 프레임워크 선정은 NFR Requirements로, PBT-01은 Functional Design으로 이연(요구 수준 반영). **이 단계 blocking finding 없음.**
**AI Response (Approval Prompt)**: "Requirements Analysis Complete. requirements.md 검토 요청. 옵션: 🔧 Request Changes / ✅ Approve & Continue → User Stories." DO NOT PROCEED until user confirms.
**Context**: Requirements Analysis Step 8~9. 승인 시 stage [x] 처리 후 User Stories 진입.

---

## Requirements Analysis — FR-SOLVER Correction (Request Changes)
**Timestamp**: 2026-07-12T00:20:00Z
**User Input**: "FR-SOLVER — AI 솔버 하이브리드 아키텍처 (사용자 지시로 PRD 부분 대체 · 2026-07-12 확정) -> 하이브리드라는게 일단 AI 솔버로 구현하고 이게 별로면 나중에 베드락으로 교체한다는 뜻"
**AI Response**: FR-SOLVER 해석 정정. 직전 requirements.md는 '하이브리드'를 **런타임 이중 엔진(요청별 score 폴백)**으로 기술했으나, 사용자 의도는 **단계적/진화형 교체 전략** — Phase 1: 결정론적 AI 솔버로 구현·출시 → 향후 솔버 산출물 품질이 부적절('별로')하면 엔진을 Bedrock AgentCore 에이전트로 **교체(프로젝트 수준 마이그레이션 결정, 런타임 폴백 아님)**. 교체 범위=옵션 B, 실현가능성은 두 단계 모두 결정론적 컴포넌트가 소유(Phase 1=솔버, 교체 후=검증도구, Q2=A). requirements.md의 FR-SOLVER 섹션·다이어그램·Assumptions(A2·A3)·Open Item(O-SOLVER 신설)·Traceability를 이 해석으로 수정. aidlc-state.md Key User Directive도 단계적 교체로 재확정. 이번 구현 범위 = Phase 1(결정론적 솔버).
**Context**: Requirements Analysis Step 6 재-모호성 해소(사용자 정정). 수정 후 승인 게이트 재제시.

---

## Requirements Analysis — Approved (Stage Complete)
**Timestamp**: 2026-07-12T00:30:00Z
**User Input**: "이대로 진행ㄱㄱ"
**AI Response**: requirements.md 승인 수신. Requirements Analysis (Comprehensive) 단계 완료 처리(aidlc-state.md `[x]`). 이 단계 blocking finding 없음(Security 반영·Resiliency 필수결정 확정·PBT 요구반영). 다음 단계 = **User Stories**. User Stories는 신규 사용자대면 기능·다중 페르소나·복합 비즈니스 규칙에 해당하므로 실행(intelligent assessment=Execute). Part 1(스토리 플랜+질문) 작성 진입.
**Context**: Requirements Analysis Step 9 승인 완료 → INCEPTION User Stories 진입.

---

## User Stories — Part 1 Planning: Assessment + Story Plan Presented (GATE)
**Timestamp**: 2026-07-12T00:35:00Z
**AI Response**: Intelligent Assessment 수행 → Execute=Yes(신규 사용자대면·다중 페르소나·복합 규칙). `inception/plans/user-stories-assessment.md` 생성. `inception/plans/story-generation-plan.md` 생성 — Product Owner 역할, 실행 체크리스트, 스토리 분해 옵션(§C), 필수 산출물(stories.md/personas.md), 결정 질문 6종 임베드: Q1(PRD 120스토리 처리=정규화 권장) Q2(후속게이트 3모듈 깊이=에픽+대표+계약 권장) Q3(분해방식=에픽 기반 모듈매핑 권장) Q4(페르소나=핵심 5종 권장) Q5(수용기준=Given-When-Then 권장) Q6(추적성=PRD+FR 권장). FR-SOLVER는 사용자대면 일정동작만 스토리화, 엔진 교체전략은 아키텍처 요구로 유지(스토리 아님)로 계획에 명시.
**AI Response (Approval Prompt)**: "Story Generation Plan(Part 1) 작성 완료. story-generation-plan.md의 Q1~Q6 [Answer] 작성 요청. 완료 시 모호성 점검 후 Part 2(stories.md·personas.md 생성) 진행." DO NOT PROCEED until answers received + plan approved.
**Context**: User Stories Part 1 Steps 1~13. GATE — 사용자 답변·플랜 승인 대기.

---

## User Stories — Part 1 Answers Received + Ambiguity Analysis (Step 9/10)
**Timestamp**: 2026-07-12T00:45:00Z
**User Input**: "6번 질문까지 답했는데 이어서 진행하면 되나?"
**User Input (story-generation-plan.md answers, verbatim)**:
- Q1: "A로 하되 스토리 사이의 공백은 채우고 부자연스러운 스토리는 수정"
- Q2: "C"
- Q3: "A"
- Q4: (X 줄에 서술) "C를 기본으로하는데 여행 취향,동행 4가지 케이스로 페르소나 생성" ([Answer] 칸은 공란)
- Q5: "A"
- Q6: "A"
- [추가 메모]: "대신 한 문서에 담긴 PRD 새로 작성 현재 PRD는 PRD이상의 권한을 가진 상태이기에 기존 PRD 형식에 맞춘 내용만 구성하고 나머지 내용들은 다른 문서들에 위임"
**AI Response (Step 9 분석)**: 명확 확정 = Q1(A + 공백 채움 + 부자연 스토리 수정), Q2(C — 후속게이트 3모듈은 에픽 헤더만), Q3(A — 에픽=모듈 매핑), Q5(A — Given-When-Then), Q6(A — PRD+FR 추적성). **모호 2건 → Step 10 필수 후속질문**: (1) **Q4 페르소나** — "동행 4가지 케이스"가 어떤 4개인지 불명(PRD 동행 유형은 6종: 혼자·커플·친구·가족(아동)·부모님·반려동물). 'C를 기본으로(7+ 세분)'와 '4 케이스'가 상충. (2) **[추가 메모] 'PRD 새로 작성'** — stories.md를 PRD형식 단일 문서로 구성하라는 뜻(R1)인지, docs/PRD/ 원본을 리팩터링(순수 PRD 분리+ADR/구현결정 위임, R2)하라는 뜻인지, 아니면 나중 별도 작업인지 불명. 정본 입력(docs/PRD/) 재구성 여부는 SCOPE·범위에 영향 → 임의 진행 금지. 후속 확인 진행.
**Context**: User Stories Part 1 Step 9~10. 모호성 미해소 → 생성(Part 2) 진입 불가. 후속 2건 확인 후 진행.

---

## User Stories — Follow-up: Q4 Confirmed + PRD 형식 예시 제공 (Scope 모호성 발견)
**Timestamp**: 2026-07-12T00:55:00Z
**User Input (Q4 확인, AskUserQuestion)**: "동행 4축 × 대표 스타일" 선택 → Q4 = 옵션 A 확정(혼자·커플·친구·가족 4축에 대표 여행 스타일 결합, 부모님·반려동물·진입경로·예산 등은 속성).
**User Input (추가 메모 관련, verbatim 핵심)**: [대용량 'PRD: TripPilot (Full Scope)' 예시 문서 붙여넣음 — Problem/Solution/User Stories(한 줄형 A~T 섹션)/Implementation Decisions(딥 모듈+ADR-0001~0013)/Testing Decisions/Out of Scope/Further Notes 구조] + 지시: "이내용을 쓰라는게 아니고 해당 예시 처럼 수용기준 예외와 같은 세세한 내용을 PRD에 놓는게 아닌 다른 문서에 담기게하고 PRD에는 담백하게만 구성"
**AI Response (해석)**: 붙여넣은 문서는 **'담백한 PRD 형식' 예시**이며 내용(B2B 숙박업주 양면 마켓플레이스)은 채택 대상 아님으로 명시됨. 형식 원칙 = PRD에는 Problem/Solution + 한 줄 유저스토리 + Implementation Decisions/ADR + Testing + Out of Scope + Further Notes만, 수용기준·예외 등 상세는 별도 문서(AIDLC stories.md/requirements)로 위임. **단, 예시 문서가 기존 docs/PRD/(B2C 전용) 및 승인된 requirements.md·Figma 정본과 근본적으로 다른 '양면 마켓(B2C 여행자 + B2B 숙박업주)' 스코프**여서, 제품 범위 유지/확장 여부가 불명 → 임의 진행 시 requirements·SCOPE·Figma 재작업 리스크. Scope 확정 질문 후 진행(생성 보류).
**Context**: User Stories Part 1 Step 10 계속. Q4 확정. PRD 형식 원칙 수용. 제품 Scope(B2C 유지 vs Full Scope 확장) 확인 게이트.

---

## User Stories — Scope & PRD Location Confirmed → Plan Finalized (GATE)
**Timestamp**: 2026-07-12T01:05:00Z
**User Input**: "제품범위는 A / PRD는 기존은 보존하고 새 단일 파일"
**AI Response**: **제품 범위 = A(B2C 유지)** 확정 — 'Full Scope' 예시는 담백 PRD 형식만 차용, B2B 양면마켓 내용 미채택. 승인된 requirements.md·SCOPE.md·Figma 정본 그대로 유효(재작업 없음). **PRD 위치 = 기존 docs/PRD/ 16파일 보존 + 새 단일 파일 `docs/PRD/PRD-lean.md` 생성**. 상세 수용기준·예외는 stories.md로 위임. story-generation-plan.md에 확정 결정(A2 섹션) + 산출물 3종(PRD-lean.md·stories.md·personas.md) + 갱신 체크리스트 잠금. 모든 모호성 해소(Step 9/10 완료) → 플랜 최종본 승인 게이트 제시.
**AI Response (Approval Prompt)**: "User Stories 플랜 최종 확정. 산출물 3종 생성 진행할까요? (docs/PRD/PRD-lean.md 신규 · stories.md · personas.md)" DO NOT PROCEED to Part 2 generation until user approves.
**Context**: User Stories Part 1 Step 11~13. 최종 플랜 승인 대기.

---

## User Stories — Part 1 Plan Approved → Part 2 Generation Start
**Timestamp**: 2026-07-12T01:10:00Z
**User Input**: "ㄱㄱ"
**AI Response**: 플랜 최종 승인 수신. Part 2 생성 진입. 정확한 정규화를 위해 PRD 모듈 01·02·04~15 전체 정독 후 산출물 3종 생성: (1) docs/PRD/PRD-lean.md (2) personas.md (3) stories.md. 체크리스트 단계별 [x] 갱신.
**Context**: User Stories Part 1 Step 13 승인 → Part 2 Steps 15~18 생성 시작.

---

## User Stories — Part 2 Generation Complete + Approval Prompt (GATE)
**Timestamp**: 2026-07-12T01:40:00Z
**AI Response**: PRD 모듈 01~15 전체 정독 후 산출물 3종 생성 완료. (1) **docs/PRD/PRD-lean.md**(신규·담백 B2C PRD: Problem/Solution + 전 12모듈 한 줄 유저스토리 + 17모듈·ADR-0001~0017 + Testing + Out of Scope + Further Notes + FR-SOLVER 솔버 전략, 기존 docs/PRD/ 16파일 보존). (2) **user-stories/personas.md**(4종 = 동행 4축[혼자·커플·친구·가족] × 대표 스타일[미식·휴양·액티비티·관광], 속성·페인·여정·에픽 매핑). (3) **user-stories/stories.md**(에픽=모듈, Given-When-Then + 예외, 1차 핵심여정 9모듈 94스토리 상세 + 후속 게이트 3모듈[J 어시스턴트·K 커뮤니티·L 공동편집] 에픽 헤더+인터페이스 계약, PRD+FR 추적성, PBT/SEC 접점 표기). PRD 05-10은 교차참조라 US-STAY-05로 흡수(Q1 보강). FR-SOLVER 엔진 교체 전략은 스토리 아닌 아키텍처 요구로 유지. content-validation(ASCII·표·특수문자) 통과, blocking finding 없음. 플랜 체크박스 전 항목 [x].
**AI Response (Approval Prompt)**: "User Stories Complete. stories.md·personas.md·PRD-lean.md 검토 요청. 옵션: 🔧 Request Changes / ✅ Approve & Continue → Workflow Planning." DO NOT PROCEED until user confirms.
**Context**: User Stories Part 2 Steps 19~22. 승인 시 stage [x] 처리 후 Workflow Planning 진입.

---

## User Stories — 사용자 결정: 사진 저장 모델 (Request Changes)
**Timestamp**: 2026-07-12T02:00:00Z
**User Input**: "우리가 사용자의 모든 사진을 s3로 저장할까 이야기 하다가 그냥 로컬에 있는거 가져다가 우리서비스에서 보여주는 식으로 생각을 했어 메타데이터 같은 것만 뽑아서" → (후속 확인) "커뮤니티는 s3로 하고 멀티 디바이스는 지원안하는걸로"
**AI Response**: 사진 저장 모델 결정 확정·반영. (1) **회고/기록 사진 = 로컬 자산 참조 + 서버는 메타데이터만**(자산 식별자·촬영 시각·EXIF 위치·연결 장소), S3 일괄 저장 안 함. (2) **커뮤니티 공개 사진만 EXIF 제거 후 S3 업로드**(타 사용자 열람 위해). (3) **멀티 디바이스 미지원** — 기기 변경 시 로컬 사진 유실(메타데이터만 잔존), 수용된 트레이드오프. 반영 위치: stories.md(US-REC-02 재작성·에픽 H 저장모델 註·에픽 K 계약 S3 명시) / PRD-lean.md(Further Notes '데이터 결정' 신설·Out of Scope 멀티디바이스) / requirements.md(NFR-DATA-03 신설·§9 Out of Scope). 아키텍처/데이터 결정이므로 상세 구현(로컬 자산 접근·공개 사진 S3 라이프사이클)은 Application Design에서 확정.
**Context**: User Stories 승인 대기 중 결정 반영. 스토리·PRD-lean·requirements 정합 갱신. 승인 게이트 유지.

---

## User Stories — Approved (Stage Complete)
**Timestamp**: 2026-07-12T02:10:00Z
**User Input**: "승인하고 이어서 ㄱㄱ"
**AI Response**: User Stories 승인 수신(사진 저장 모델 결정 반영분 포함). 단계 완료 처리(aidlc-state.md `[x]`). 산출물 확정 = docs/PRD/PRD-lean.md · user-stories/stories.md(94 상세 + J·K·L 헤더) · personas.md(4종). 다음 단계 = **Workflow Planning**(ALWAYS). SCOPE.md 남은 인셉션 경로(Workflow Planning → Application Design → Units Generation → STOP) 확정용 산출물 작성 진입.
**Context**: User Stories Step 22~23 승인 완료 → INCEPTION Workflow Planning 진입.

---

## Workflow Planning — Execution Plan Generated + Approval Prompt (GATE)
**Timestamp**: 2026-07-12T02:20:00Z
**AI Response**: 전 컨텍스트(requirements·stories·personas·PRD-lean) 로드 후 `inception/plans/execution-plan.md` 생성. 그린필드 → Reverse Engineering N/A. Change Impact = 전 영역 Yes. Risk = Low(이번 실행 문서 산출물, 제품 자체 복잡도는 High 별도 표기). Mermaid 워크플로우 시각화(content-validation 통과). **단계 결정**: Application Design=EXECUTE(17 신규 모듈·컴포넌트·솔버 계약 정의 필요), Units Generation=EXECUTE(다수 유닛 분해·복잡). **SCOPE.md 경계**: Units Generation 승인 후 STOP. CONSTRUCTION 전체(Functional/NFR/Infra Design·Code Gen·Build&Test)+Operations = 범위 밖·자동 진입 안 함(템플릿 기본 'Code Gen ALWAYS'보다 SCOPE.md 우선). RESILIENCY-04·14 질의는 CONSTRUCTION NFR 단계로 이연. aidlc-state.md Stage Progress·Execution Plan Summary 갱신.
**AI Response (Approval Prompt)**: "Workflow Planning Complete. execution-plan.md 검토 요청. 남은 실행 = Application Design → Units Generation → STOP. 옵션: 🔧 Request Changes / ✅ Approve & Continue → Application Design." DO NOT PROCEED until user confirms.
**Context**: Workflow Planning Step 9~11. 승인 시 Application Design 진입.

---

## Workflow Planning — Approved (Stage Complete)
**Timestamp**: 2026-07-12T02:35:00Z
**User Input**: "진행ㄱㄱ"
**AI Response**: execution-plan.md 승인 수신. Workflow Planning 단계 완료 처리(aidlc-state.md `[x]`). 다음 단계 = **Application Design**(EXECUTE). 17개 모듈 컴포넌트·비즈니스 규칙·의존성·솔버 계약·데이터 흐름 설계 진입.
**Context**: Workflow Planning 승인 완료 → INCEPTION Application Design 진입.

---

## Application Design — Design Plan + Questions Presented (GATE)
**Timestamp**: 2026-07-12T02:45:00Z
**AI Response**: `inception/plans/application-design-plan.md` 생성(Solution Architect 역할). 필수 산출물 5종(components·component-methods·services·component-dependency·application-design 통합) + 실행 체크리스트 + 설계 결정 질문 6종 임베드: Q1(아키텍처 스타일=모듈러 모놀리스+분리 솔버 서비스 하이브리드 권장) Q2(컴포넌트=PRD 17모듈 1:1 권장) Q3(통신=동기 facade+비동기 이벤트 혼합 권장) Q4(솔버=Port/Adapter 격리로 Bedrock 교체 대비 권장) Q5(외부연동=1 API=1 포트/어댑터 권장) Q6(스택=팀 스택 가정 채택 권장). 후속 게이트 3모듈은 인터페이스만 1차.
**AI Response (Approval Prompt)**: "application-design-plan.md의 Q1~Q6 [Answer] 작성 요청. 완료 시 모호성 점검 후 설계 산출물 5종 생성." DO NOT PROCEED until answers received.
**Context**: Application Design Step 4~7. GATE — 설계 결정 답변 대기.

---

## Application Design — Answers Received (Q1~6=A) + AI/Solver Deep-Dive Directive
**Timestamp**: 2026-07-12T03:00:00Z
**User Input**: (application-design-plan.md 답변) Q1=A · Q2=A · Q3=A · Q4=A · Q5=A · Q6=A / (채팅) "AI/솔버 계약 최대한 구체적으로 뽑아줘"
**AI Response (Step 8 분석)**: 6개 답변 모두 권장(A) — 모호·모순 없음. 설계 방침 확정: 모듈러 모놀리스 + 결정론적 솔버 별도 서비스, PRD 17모듈 1:1 컴포넌트(후속 3게이트 인터페이스만), 동기 facade+비동기 이벤트, SolverPort/Adapter 격리(Bedrock 교체 대비), 1 API=1 포트/어댑터, 팀 스택 가정. **특별 지시 반영**: AI/솔버 계약을 Application Design 최대 깊이(포트 인터페이스·메서드 시그니처·DTO·불변식 INV-1~4·폴백 체인·품질 score)로 구체화, 프롬프트·모델 ID·알고리즘 상세·score 임계는 CONSTRUCTION 이연(O-SOLVER). 산출물 5종 생성 진행(Step 10).
**Context**: Application Design Step 8~10. 모호성 없음 → 설계 산출물 생성.

---

## Application Design — Artifacts Generated + Approval Prompt (GATE)
**Timestamp**: 2026-07-12T03:30:00Z
**AI Response**: 설계 산출물 5종 생성(`inception/application-design/`): components.md(17 컴포넌트 C1~C17 + AI/솔버 포트 심화 §3: SolverPort·FeasibilityValidator·PreferenceScoringPort·CandidatePoolPort·TravelEstimatePort, INV-1~4, 폴백 체인, QualityScore/교체 트리거) · component-methods.md(도메인 DTO + SolverPort/검증기/LLM/RAG/거리 포트 시그니처 + 1차 facade 메서드) · services.md(S1 Spine·S2 솔버 파이프라인·S3 Plan-B·S4 알림·S5 핸드오프·S6 후속) · component-dependency.md(의존성 매트릭스·이벤트 카탈로그·솔버/사진 데이터 흐름 Mermaid·외부 어댑터 포트 12종·순환 방지) · application-design.md(통합본). **사용자 지시대로 AI/솔버 계약 최대 구체화**(포트·시그니처·DTO·불변식·폴백·score), 프롬프트·모델·알고리즘·score 임계는 CONSTRUCTION 이연(O-SOLVER). 후속 게이트 3(C15·C16·C17)=인터페이스만. content-validation(Mermaid 2개·표·특수문자) 통과. 플랜 체크박스 전 항목 [x].
**AI Response (Approval Prompt)**: "Application Design Complete. application-design/ 검토 요청. 옵션: 🔧 Request Changes / ✅ Approve & Continue → Units Generation(인셉션 마지막)." DO NOT PROCEED until user confirms.
**Context**: Application Design Step 11~14. 승인 시 stage [x] 처리 후 Units Generation(인셉션 마지막 단계) 진입.

---

## Application Design — Approved (Stage Complete)
**Timestamp**: 2026-07-12T03:45:00Z
**User Input**: "나머지도 이어서ㄱㄱ"
**AI Response**: Application Design 승인 수신 + 인셉션 마지막 단계(Units Generation)까지 이어서 진행 지시. Application Design 단계 완료 처리(aidlc-state.md `[x]`). 산출물 확정 = application-design/ 5종. 다음 = **Units Generation**(인셉션 마지막) 진입 — Part 1(유닛 분해 플랜+질문) → Part 2(유닛 산출물) → 승인 → STOP.
**Context**: Application Design 승인 완료 → INCEPTION Units Generation(마지막 단계) 진입.

---

## Units Generation — Part 1 Plan (Q1~5=A) → Part 2 Generation
**Timestamp**: 2026-07-12T03:55:00Z
**User Input**: "나머지도 이어서ㄱㄱ" (Units Generation까지 이어서 진행 지시)
**AI Response**: `inception/plans/unit-of-work-plan.md` 생성(분해 결정 질문 5종 + 필수 산출물 3종 + 체크리스트). 사용자 "이어서" 지시로 Q1~Q5 모두 권장(A) 채택 — Q1(능력+여정 단계 그룹핑) Q2(워킹 스켈레톤 우선→수직 슬라이스, Phase 0 보안·복원력·PBT·아웃박스 스캐폴딩) Q3(독립 일정 지능 유닛 — 솔버·포트 격리·PBT·Bedrock 교체) Q4(후속 게이트 3 각각 별도 유닛+인터페이스만) Q5(부모 모노레포 정합). 모호·모순 없음(Step 7 통과). Part 2 유닛 산출물 3종 생성 진행.
**Context**: Units Generation Part 1 Steps 1~9 + Part 2 진입. 승인 게이트는 Part 2 산출물 완료 후(STOP 직전).

---

## Units Generation — Part 2 Complete + Final Approval Prompt (STOP GATE)
**Timestamp**: 2026-07-12T04:10:00Z
**AI Response**: 유닛 산출물 3종 생성(`inception/application-design/`): unit-of-work.md(U0~U9 정의·빌드 순서 Phase 0~7·코드 조직 전략 모노레포) · unit-of-work-dependency.md(유닛 의존성 매트릭스·빌드 순서 근거·크로스커팅 게이트·순환 검증) · unit-of-work-story-map.md(119 스토리 전부 유닛 배정·U2 엔진 유닛 주석). 유닛: U0 Foundation/워킹스켈레톤·U1 Accom&Trip(앵커)·**U2 Itinerary Intelligence/Solver(독립·Bedrock 교체·PBT 격리)**·U3 AI Itinerary·U4 In-trip&Plan-B·U5 Records&Reflection·U6 Notification&Settings·U7 Community·U8 Assistant·U9 Collab(후속 3 게이트). 순환 없음·전 스토리 배정 검증. content-validation 통과. 플랜 체크박스 전 [x].
**AI Response (Approval Prompt)**: "Units Generation Complete. **이 승인이 INCEPTION의 마지막입니다.** 승인 시 전체 인셉션 요약 제시 후 STOP(CONSTRUCTION 자동 진입 안 함, SCOPE.md). 옵션: 🔧 Request Changes / ✅ Approve → Inception 종료." DO NOT PROCEED to CONSTRUCTION.
**Context**: Units Generation Part 2 Steps 16~19. 최종 승인 게이트 = 인셉션 종료 = STOP.

---

## Units Generation — Approved · ✋ INCEPTION COMPLETE (STOP)
**Timestamp**: 2026-07-13T00:00:00Z
**User Input**: "아 일단 인셉션 전과정 마무리 가능하면 마무리"
**AI Response**: Units Generation 최종 승인 수신 → **INCEPTION 전 과정 종료(STOP)**. aidlc-state.md: Units Generation `[x]`·STOP `[x]`·Current Phase=INCEPTION 완료. 전체 인셉션 산출물 요약 제시. **SCOPE.md 준수 — CONSTRUCTION(유닛별 Functional/NFR/Infra Design·Code Gen·Build&Test)·Operations 자동 진입하지 않음.** 다음 진행은 사용자의 명시적 별도 지시 필요(예: "CONSTRUCTION 시작", "U0부터 Functional Design"). 이연 항목: O-SOLVER(솔버 score 임계·Bedrock 교체 기준)·RESILIENCY-04/14·후속 게이트 3(Community·Assistant·Collab) 상세.
**Context**: INCEPTION 단계 완료. 워크플로우 정지(STOP). CONSTRUCTION 진입 금지.

---

## Post-Inception Sync — 워크스페이스 상태·프로젝트 문서 최신화
**Timestamp**: 2026-07-17T06:50:29Z
**User Input**: "../aidlc에서 CLAUDE.md 읽고 aidlc-docs planning 빼고 업데이트 부분 업데이트ㄱㄱ" → "아니 여기 프론트엔드 아키텍처랑 백엔드 아키텍처 상황보고 aidlc CLAUDE 읽고 rules에 맞처 문서들 최신화 진행하라고"
**AI Response**: (1) `aidlc/CLAUDE.md` 현행화 — 헤더에 INCEPTION 완료·✋STOP(2026-07-13) 상태와 완료 산출물(`aidlc-docs/inception/`) 포인터 명시, Directory Structure에 TripPilot 모노레포 배치 예외(애플리케이션 코드는 모노레포 루트 `backend/`·`frontend/`·`ai/`, 패키지별 아키텍처 정본은 패키지 소유) 추가. (2) `aidlc-state.md` Workspace State 동기화 — Existing Code=Yes(backend: Gradle 멀티모듈 골격+Flyway V1.0~V1.6+docker-compose/GHCR CI = TRIP-145~147 main 머지 / frontend: 아키텍처 정본 README 확정 = TRIP-160), Workspace Root 모노레포 이관 반영(`~/Desktop/dev/aidlc` → `trippilot/aidlc`), Post-Inception Progress 섹션 신설. `planning/`은 사용자 지시로 참조·수정 대상에서 제외. CONSTRUCTION 미진입 — 워크플로 스테이지 상태 변화 없음(STOP 유지).
**Context**: INCEPTION 완료(STOP) 이후 상태 동기화. AI-DLC 밖 팀 개발 현황의 기록 반영이며 스테이지 진행 아님.

---

## Scope Change — planning 제거 · CONSTRUCTION 설계 문서 단계 진입 (U0)
**Timestamp**: 2026-07-17T07:05:00Z
**User Input**: "그리고 planning 제거하고 construction u1 진행 문서 작성만 하고 개발은 각자의 디렉토리에서 개발 할 예정" · 후속 확인 답변: 대상 유닛 = "U0 Foundation"(inception 체계 — 사용자 호칭 U1), 작성 주체 = "지금 나랑 진행"
**AI Response**: (1) `aidlc-docs/planning/` 저장소에서 제거(git rm — 이력은 git에 보존). (2) `docs/SCOPE.md` 범위 개정 — CONSTRUCTION 진입하되 **유닛별 설계 문서(Functional/NFR Requirements/NFR Design/Infrastructure Design)까지만**, Code Generation·Build and Test 제외(코드는 팀이 모노레포 각 패키지 디렉토리에서 직접 개발), 첫 유닛 U0 Foundation, 이후 유닛은 유닛별 사용자 지시. (3) `aidlc-state.md` — Current Phase=CONSTRUCTION(설계 문서 단계만)·Current Stage=U0 Functional Design 진행·CONSTRUCTION 체크리스트 신설. (4) 리포 루트 `CLAUDE.md` — planning 참조 전면 교체(기획 정본=inception, 패키지 정본=각 패키지), 실코드 현황 반영. (5) U0 Functional Design 착수 — `.aidlc-rule-details/construction/functional-design.md` 규칙 적용.
**Context**: 사용자 명시 지시에 의한 SCOPE 개정(처리 규칙 3 충족). CONSTRUCTION Per-Unit Loop 진입 — U0 Functional Design 시작.

---

## U0 Functional Design — Approved (Stage Complete)
**Timestamp**: 2026-07-17T08:05:00Z
**User Input**: "ㄱㄱ"
**AI Response**: U0 Functional Design 승인 수신 → 단계 완료 처리(aidlc-state.md `[x]`). 산출물 4종 확정: `construction/u0-foundation/functional-design/{business-logic-model, domain-entities, business-rules(BR-U0-01~30), frontend-components}.md` + 정합 검증(갭 G-1~G-4, 핵심 G-1=openapi SocialLoginRequest SDK 토큰 개정 필요). 사전 질문 Q1~Q9+보충 4건 확정 내역은 플랜 파일 기록. 다음 = **U0 NFR Requirements** 진입.
**Context**: CONSTRUCTION Per-Unit Loop — U0 Functional Design 승인 완료 → NFR Requirements 진입. Code Generation은 범위 외(SCOPE.md).

---
## U0 NFR Requirements — Plan + Generation Complete → Approval Prompt
**Timestamp**: 2026-07-17T09:10:00Z
**User Input**: "지금 u0 작업 이어서 하자" (선행 세션 캘리브레이션 지시: "적당한 규모 서비스 + 쾌적한 사용자 경험")
**AI Response**: U0 NFR Requirements 단계 재개 — 선행 세션에서 산출물 2종은 생성되었으나 플랜 체크박스·audit 기록이 누락된 상태 확인. (1) `construction/plans/u0-foundation-nfr-requirements-plan.md` 체크박스 1~4 `[x]` 처리 + Q1~Q6 확정 답변 기록(캘리브레이션 지시로 전 항목 권장안 채택 + 파생 조정: PERF 체감 성능 상향·SEC-03 레이트리미터 PostgreSQL 카운터[Redis 미도입, 과설계 회피]·NFR-U0-UX 절 신설). (2) 산출물 확정 = `u0-foundation/nfr-requirements/nfr-requirements.md`(SCALE 3·PERF 4·UX 5·AVAIL 3·SEC 10·RES 4·OBS 3·LEGAL 3 = 35개 요구 + PBT 게이트 매핑 6종) · `tech-stack-decisions.md`(기존 확정 기록 + U0 델타 6종 + Infra Design 이연 5종). 익스텐션 준수: security-baseline Full → SEC-01~10으로 전 rule 커버 / resiliency-baseline Full → RES-01~04(RESILIENCY-04·14는 기지시대로 NFR Design 이연 = 계획된 이연, 미준수 아님) / PBT 부분(02·03·07·08·09) → §9 매핑 6종으로 blocking rule 충족.
**AI Response (Approval Prompt)**: "U0 NFR Requirements Complete. 옵션: 🔧 Request Changes / ✅ Continue to Next Stage → NFR Design." DO NOT PROCEED until user confirms.
**Context**: CONSTRUCTION Per-Unit Loop — U0 NFR Requirements 완료, 승인 게이트. 승인 시 aidlc-state.md `[x]` 처리 후 NFR Design 진입.

---
## U0 NFR Requirements — Approved (Stage Complete)
**Timestamp**: 2026-07-17T09:15:00Z
**User Input**: "이어서 ㄱㄱ"
**AI Response**: U0 NFR Requirements 승인 수신 → 단계 완료 처리(aidlc-state.md `[x]`). 산출물 확정 = `u0-foundation/nfr-requirements/{nfr-requirements, tech-stack-decisions}.md`. 다음 = **U0 NFR Design** 진입 (`.aidlc-rule-details/construction/nfr-design.md` 규칙 적용). 이 단계에서 기지시 이연분 RESILIENCY-04(CI/CD·배포·롤백)·RESILIENCY-14(복원력 테스트) 확정 예정.
**Context**: CONSTRUCTION Per-Unit Loop — U0 NFR Requirements 승인 완료 → NFR Design 진입.

---
## U0 NFR Design — Plan Created (Questions Pending)
**Timestamp**: 2026-07-17T09:20:00Z
**AI Response**: `construction/plans/u0-foundation-nfr-design-plan.md` 생성 — 실행 계획 6단계 + 질문 Q1~Q9. nfr-design.md Step 3 필수 카테고리 5종 전부 커버: 복원력 패턴(Q1 재시도 전략) · 확장성 패턴(Q2 오토스케일·DB 복제본 미도입) · 성능 패턴(Q3 인메모리 캐시만, Redis 미도입) · 보안 패턴(Q4 JWK 2키 중첩 롤오버 절차) · 논리 컴포넌트(Q5 U0 신규 7종 + TRIP-148~150 기존 자산 수용). 추가로 **기지시 이연분 확정 질문**: RESILIENCY-04(Q6 CI/CD 툴링·Q7 롤백 메커니즘·Q8 배포 스타일) · RESILIENCY-14(Q9 복원력 테스트) — 두 규칙 모두 "모델 추론 금지·사용자 명시 선택" 요구이므로 답변 필수(blocking)로 표기. 특기 분석: Q7에서 Flyway forward-only 제약상 'DB 인지 롤백(역실행)'은 구조적 불가 → 스키마 전방호환(확장-후-수축) 규약을 롤백 가능성의 전제로 제시.
**Context**: CONSTRUCTION Per-Unit Loop — U0 NFR Design Steps 1~4 완료. Step 5(답변 수집) 대기 중.

---
## U0 NFR Design — Answers Collected + Artifacts Generated → Approval Prompt
**Timestamp**: 2026-07-17T09:35:00Z
**User Input**: "했으니 확인ㄱㄱ" (플랜 파일 직접 편집으로 답변 기입: Q1~Q5="추천으로" · Q6="A" · Q7~Q9="추천으로")
**AI Response**: Step 5(답변 수집·분석) — Q1~Q9 전항 확정, 모호·모순 없음. **RESILIENCY-04·14의 "사용자 명시 선택" 요구 충족**(Q6=A GitHub Actions · Q7=A 버전 핀+DB 규약 · Q8=B 롤링 · Q9=B 경량 제안). Step 6 산출물 2종 생성: (1) `nfr-design-patterns.md` — 패턴 24종(P-RES-1~4 재시도 경계 분리·IdP별 서킷 벌크헤드·stale-if-error·fail-closed/fail-open 구분 / P-SCALE-1~3 / P-PERF-1~4 / P-SEC-1~7 / **P-DEP-1~3 배포·롤백** / P-OBS-1~3) + NFR 35요구 → 패턴 커버리지 표 + **미도입 결정·재평가 트리거 5종**(Redis·읽기 복제본·블루그린/카나리·상시 카오스·메시지 브로커 — 과설계 회피 명시 기록). §6 복원력 테스트 RT-1~10(CI 7 + 배포 2[롤백 리허설 포함] + 게임데이 1). (2) `logical-components.md` — U0 신규 논리 컴포넌트 C-1~C-7(SocialOAuthPort+어댑터4·TokenService·RateLimiter·CircuitBreaker×4·OutboxRelay골격·ConsentLedger·BootstrapAssembler) + 횡단 캐시 C-8 + 기존 자산 수용 5종(TRIP-147~150·CI — **델타는 PII 마스킹 컨버터·공개 핸들러 ArchUnit 규칙·호환 테스트 잡 3건뿐**) + 프론트 논리 요소 5 + 컴포넌트→NFR 추적 + Infra Design 이연 7종. **핵심 설계 판단**: Flyway forward-only 제약 → 롤백은 앱 버전 핀 + **스키마 전방호환(확장-후-수축) 규약**에 의존, 불변식 "스키마 N에서 앱 N-1 동작" + CI 구버전앱↔신스키마 호환 테스트(RT-7)로 강제. 익스텐션 준수: security-baseline Full → P-SEC-1~7 ✅ / resiliency-baseline Full → **RESILIENCY-04·14 이연분 본 단계에서 해소 완료** ✅ / PBT blocking → C-6·C-7 명세에 속성 게이트 명시 ✅. 플랜 체크박스 2~5 `[x]`.
**AI Response (Approval Prompt)**: "🎨 NFR Design Complete - u0-foundation. 옵션: 🔧 Request Changes / ✅ Continue to Next Stage → Infrastructure Design." DO NOT PROCEED until user confirms.
**Context**: CONSTRUCTION Per-Unit Loop — U0 NFR Design Steps 5~7 완료, 승인 게이트(Step 8). 승인 시 aidlc-state.md `[x]` 후 Infrastructure Design(U0 마지막 설계 단계) 진입.

---
## U0 NFR Design — Approved · Infrastructure Design — SKIPPED (Scope Decision) · ✅ U0 설계 종료
**Timestamp**: 2026-07-17T09:45:00Z
**User Input**: "근데 지금 개발에서는 서버에 안올리가 로컬 작업만 할거임" → (AskUserQuestion 선택) "Infrastructure Design 건너뛰기"
**AI Response**: (1) 로컬 스택 확인 — 리포 루트 `docker-compose.yml` 실재(postgres:16-alpine + backend/ai/frontend GHCR 이미지, TRIP-146). (2) NFR Design 영향 분석 제시 — 패턴·논리 컴포넌트는 로컬에서도 동일 구현이라 영향 없음, 배포 의존 항목 RT-8·9·10만 자동 이연. (3) Infrastructure Design 범위 3안 제시(로컬 범위 재정의 / SKIP / 원안 클라우드 토폴로지) + 로컬 전용이어도 남는 실제 결정(소셜 IdP 콘솔 설정·로컬 시크릿 주입) 고지. (4) 사용자 선택 = **SKIP**. 선택 옵션 미리보기에 NFR Design `[x]`가 명시되어 NFR Design 승인으로 처리(사용자에게 정정 가능함을 고지). (5) aidlc-state.md 반영 — NFR Design `[x]` 승인 완료 / Infrastructure Design `[~] SKIPPED`(사유: 배포 계획 부재 → 클라우드 리소스 결정의 근거·검증 수단 없음, 규칙상 CONDITIONAL "no infrastructure changes" 해당. 재개 조건: 배포/클라우드 진입 시 별도 지시) / **U0 설계 단계 종료** — 총 산출물 8종(functional-design 4 + nfr-requirements 2 + nfr-design 2). (6) **Open Items 섹션 신설** — 설계 문서 없이 개발 중 처리될 항목 명시 기록: 소셜 IdP 4종 콘솔 설정(U0 인증 개발 선결 블로커) · 로컬 시크릿 주입 규약 · 배포 의존 이연 항목(RT-8/9/10·클라우드 토폴로지) · G-1 openapi grantType 개정(백엔드 협의).
**Context**: CONSTRUCTION Per-Unit Loop — U0 NFR Design 승인 완료 → Infrastructure Design 사용자 지시로 SKIP → **U0 설계 종료**. Code Generation은 SCOPE.md 범위 외(팀이 각 패키지에서 직접 개발). 다음 = 사용자 지시 대기(U1 설계 착수 또는 U0 개발 착수).

---
## U0 구현 현황 점검 → U1 진입 지시
**Timestamp**: 2026-07-22T07:34:55Z
**User Input**: "지금 frontend backend 폴더 확인해보고 u0 잔행상황 파악해봐 다 되었다 판단되면 u1 설계 드자가" → (AskUserQuestion 선택) "지금 진입 (권장)"
**AI Response**: (1) `backend/`·`frontend/` 실물을 U0 설계문서(BR-U0-01~30 · frontend-components.md)와 대조. **backend = U0 범위 사실상 완료** — auth(소셜4·AUTH_CODE/SDK_TOKEN·연령확인·리프레시 회전/재사용감지·로그아웃·동의 append-only·위치동의·삭제 30일 유예+철회) · profile(부트스트랩·온보딩완료·닉네임·취향 7축 NULL/중립기본값) · moderation · 횡단(ArchUnit·Konsist·CorrelationId·마스킹로깅·도메인이벤트·PBT), openapi 20경로 전부 컨트롤러 매핑 존재(Kotlin 170파일). 단 `./gradlew test`는 Docker/Testcontainers 필요로 **미실행 — 녹색 여부 미검증**. **frontend ≈ 85%** — 완료(스플래시/부트스트랩 분기·소셜로그인 실OAuth·약관·닉네임·취향2페이지·위치프리프롬프트·force-update·reconsent·5탭셸·tokenManager/secure-store, 46스위트 256테스트 통과) / 진행중(TRIP-170 홈+BottomTabBar 미커밋, HomeScreen.test.tsx **3 red** — `toHaveTextContent` 단정문 문제로 보이며 설계 결손 아님) / **미착수 4건**: `(auth)/deletion-pending` 복구화면(BR-U0-24) · 로그아웃 클라 흐름(BR-U0-09) · 마이탭 닉네임·취향 수정(BR-U0-18) · `age.tsx` 별도화면이 로그인화면 `onAgeConfirm`으로 흡수(설계 이탈). (2) 판정 = "다 되었다"는 아님, 다만 **U1 설계 문서는 U0 코드 완료를 전제하지 않음**(U0 설계는 2026-07-17 승인 종료, 잔여 4건은 백엔드 계약이 이미 있는 프론트 슬라이스라 U1 설계 입력 불변) — 3안 제시(지금 진입 / TRIP-170만 마감 후 / U0 잔여 전부 마감 후). (3) 사용자 선택 = **지금 진입**, U0 잔여는 프론트 티켓으로 병렬.
**Context**: CONSTRUCTION Per-Unit Loop — U0 설계 종료 상태에서 **U1 Accommodation & Trip Setup 진입 지시 수신**. 다음 = U1 Functional Design (`.aidlc-rule-details/construction/functional-design.md`).

---
## U1 Functional Design — Plan Created (Questions Pending)
**Timestamp**: 2026-07-22T07:34:55Z
**AI Response**: `construction/plans/u1-accommodation-trip-functional-design-plan.md` 생성 — 실행 계획 8단계 + 질문 Q1~Q10. Step 1(유닛 컨텍스트 분석) 완료: unit-of-work.md(U1=C3 Accommodation Search·C4 Saved Accommodation·C5 Affiliate Link·C6 Trip Creation) · story-map 21스토리(US-SHELL-05 + US-STAY-01~11 + US-TRIP-01~09) · components.md C3~C6 · component-methods §4 facade 4종 · unit-of-work-dependency(U1은 U0에 동기 api 의존만, 순환 없음). **기존 자산 조사 결과**(U0 Q2와 동형의 기준선 문제): backend에 U1 관련 코드는 0(Flyway V1.0~V1.7 = auth/profile/moderation만, 컨트롤러도 U0 범위만)이나 **설계 문서는 선재** — `backend/docs/design/전체-최소-스키마.dbml`(poi·poi_snapshot·saved_place·saved_stay·ota_partner·outbound_click·trip·base_assignment·trip_base_day·must_visit) · `전체-API-서피스.md`(밴드 e·g·h) · `전체-도메인-ERD.md`. **번호 충돌 주의 기록**: backend 문서의 `U1-API-설계.md`·`U1-DB스키마-설계.md`는 제거된 planning/units.md 체계의 U1(기반·계정·온보딩)로 **AI-DLC U0에 해당** — AI-DLC U1(숙소·여행)과 다름. **선재 문서와 인셉션 스토리 간 상충 4건 식별**하여 질문화: 위시리스트(스토리 U1 포함 vs 서피스 "1차 제외") · 숙소 등록 경로(2경로 vs 3경로) · 다중거점 겹침 기본값(체크인 우선 vs 날짜별 primary) · 홈 집계 API 소유 유닛. 그 외 질문: 기준선 지위 · OTA 실연동 가능 여부(제휴 계약 상태) · POI 검색 소유 경계(U1 얇은 어댑터 vs C7 Place Data는 U3) · 지도 SDK 도입 시점 · 여행 상태머신/소프트삭제 범위 · 국내 한정 강제.
**Context**: CONSTRUCTION Per-Unit Loop — U1 Functional Design Steps 1~4 완료. Step 5(답변 수집) 대기 중.

---
## U1 Functional Design — 라이브 Figma 밴드 d·e 대조 → 계획·질문 개정
**Timestamp**: 2026-07-22T08:11:00Z
**User Input**: "피그마 mcp 연결되어있지? 여기서 TripPilot 와이어프레임에서 d e 화면들 보고 다시 문서 대조해서 생각해봐 바뀐 부분들이 존재할거야"
**AI Response**: Figma MCP로 라이브 정본(fileKey `1MTF3dtptIrbg8gld5IdO2`, 페이지 `1228:1045`) 밴드 d(탐색)·e(숙소) 전 프레임 관측 — d01·d02(default/empty)·d03·d04·d05·d1b · e00·e02(default+5상태)·e03(default/affiliate-sheet)·e04(default/empty)·e05(default/multi-candidate/conflict/error-mapapi). **드리프트 13건(D-1~D-13) 식별해 계획 파일에 표로 기록**: D-1 탐색 탭(밴드 d) 전체가 어느 유닛 스토리에도 미배정(U0은 빈 셸) · **D-2 위시리스트 부활 + 저장·등록 통합**(e04 "저장한 숙소 ♥로 담아둔 곳" 목록에 `거점` 배지 + "다른 숙소를 거점으로 지정" → API 서피스의 "위시리스트 1차 제외"와 정면 충돌) · **D-3 가격 표기**(목록·상세·지역카드 전부 구체 시작가 `₩145,000~ · 1박` vs 스토리의 "대표 가격대(정적 구간)"·캐싱 금지) · D-4 OTA 다중선택 시트·제휴 고지는 정합 ✅ · D-5 e01 결번·e00 신설·지역선택 화면 2벌(d1b vs e00) · D-6 등록 경로 신구 불일치(신=검색+핀, 구=3탭 지도/링크/핀) · **D-7 같은 화면코드에 신·구 두 벌**(default는 노드 169x·183x 재디자인, 상태 변형은 134x·135x 구 디자인 잔존) · D-8 여행 생성 주 진입이 "담은 곳 N곳 → 여행 만들기"로 역전 · **D-9 커뮤니티(여행자 일정)가 탐색 탭 1차에 노출**(밴드 k=M15=U7 후속 게이트인데 d01·d03·d05에 이미 존재) · D-10 지도 상시 전제(e03·e05, `error-mapapi` 폴백 존재) · D-11 e03 CTA "일정에 추가" 신설(거점 등록과 동일 여부 불명) · D-12 숙소 필터 축 축소(가격대·지역·필터 3개) · D-13 "날짜 미정" 탐색은 정합 ✅. **밴드 맵 자체는 라이브와 일치**(a~m, f 결번) — `figma-structure.md` 수정 불필요. 계획 파일 개정: 실행계획에 1b(Figma 대조) 추가·완료 표시, 질문을 **Q1~Q10 → Q1~Q14로 확대**(Q1에 "Figma 우선" 선택지 추가, Q2·Q5·Q6을 라이브 기준으로 재작성, **Q11 가격 표기 모델 · Q12 탐색 탭 소유 유닛 · Q13 커뮤니티 1차 노출 범위 · Q14 신·구 두 벌 정본 판별** 신설), Step 6 산출물 범위를 "밴드 e·g·h" → **"밴드 d·e·g"**로 정정(h=일정 생성은 U3 소관).
**Context**: CONSTRUCTION Per-Unit Loop — U1 Functional Design Step 1b(라이브 정본 대조) 추가 수행. 여전히 Step 5(답변 수집) 대기 중.

---
## U1 Functional Design — 인셉션 영향 판정 (사용자 질의)
**Timestamp**: 2026-07-22T08:40:00Z
**User Input**: "그러면 이것 때문에 inception도 수정해야하는게 있나?"
**AI Response**: 인셉션 원문 대조 후 **직전 보고의 오진 2건 정정**: (1) D-1 "탐색 랜딩이 문서에 없다"는 오독 — `US-SHELL-03`에 "각 탭 루트(홈/**탐색 랜딩[숙소·장소·여행자 일정 3진입]**/일정/기록/마이)", `US-SHELL-05`에 "탐색 랜딩 '장소' 진입"·"이 장소들로 여행 만들기"가 이미 명시됨. 진짜 문제는 US-SHELL-03이 story-map상 **U0** 배정인데 U0 `frontend-components.md`가 explore를 "빈 상태 셸만"으로 축소한 **인셉션 배정 ↔ U0 construction 문서 불일치**. (2) D-2 위시리스트 — `FR-STAY-01`이 "검색·필터·상세·**위시리스트**"를 명시하므로 인셉션이 옳고, `backend/docs/design/전체-API-서피스.md`의 "위시리스트 1차 제외"가 요구사항을 임의 축소한 것. 인셉션 수정 후보 3건+조건부 1건 제시(I-1 US-STAY-01·02 가격 문구 / I-2 US-SHELL-03↔unit-of-work 커뮤니티 내부 모순 / I-3 스토리 없는 화면 d03·d1b·e00 / I-4 FR-STAY-03 등록 2경로 — Q6=A일 때만). 수정 불필요 확인: D-8(FR-CORE-01이 Case A/B 1급 지원 명시 ✅)·D-4·D-13·화면 수준 항목. 절차는 `common/workflow-changes.md` §4(완료 스테이지 수정 = 영향평가+명시 승인, Low impact면 modify 허용) 적용 고지. 권고 = Q6·Q11·Q13 답변 후 일괄 수정.
**Context**: CONSTRUCTION Per-Unit Loop — U1 Functional Design Step 5 진행 중(답변 대기). 인셉션 수정은 답변 확정 후 별도 승인 게이트.

---
## U1 Functional Design — Q1~Q14 답변 수령 → 모순 검출 → 명확화 질문 생성
**Timestamp**: 2026-07-23T00:00:00Z
**User Input**: "답변 작성했어" (플랜 파일 직접 편집으로 기입: **Q1=D · Q2=A · Q3=A · Q4=B · Q5=A · Q6=A · Q7=A · Q8=B · Q9=A · Q10=A · Q11=A · Q12=A · Q13=A · Q14=A**)
**AI Response**: Step 5(답변 수집·분석) — 14문항 전항 응답, **모호(vague) 답변 0건**. 그러나 `question-format-guide.md`의 모순 검출 절차에 따라 **충돌 3건 + 승인 필요 1건** 검출하여 `construction/plans/u1-accommodation-trip-functional-design-clarification-questions.md` 생성: **모순1** Q2=A의 `isBase` 단일 플래그로는 일자별 다중 거점(US-STAY-07·US-TRIP-06·07 "체크인~체크아웃 모든 숙박일 동일 거점")을 표현 불가 — 거점은 (숙소×날짜구간) 관계이며 선재 dbml도 `saved_stay`/`base_assignment`/`trip_base_day` 3테이블 분리 → CQ1(관계형 유지 vs 거점 1개로 축소+스토리 3건 이연). **모순2** Q8=B(차단형)가 US-TRIP-06 수용기준("스마트 기본 거점으로 **미리 채우고** **비차단** 안내로 사후 수정")과 정면 충돌 + Q8은 겹침만 물어 **공백일 처리 미답** → CQ2(전면 차단 vs 겹침만 차단 vs 차단 지점을 AI 일정 생성 직전으로 이동). **모순3** Q4=B가 컴포넌트-유닛 경계 위반 — C7 Place Data는 `components.md`상 U3 소속·RAG 게이트·INV-1 집행 소유자인데 U1이 `poi`·`poi_snapshot` 정규화를 가져감 → CQ3(스키마만 선행 정의 vs C7 자체 U1 이동). **CQ4** = 인셉션 수정 승인 요청 — 답변으로 확정된 수정 목록 I-1(US-STAY-01·02 가격 문구→최저가 스냅숏·최저가순 정렬, Q11=A) · I-2(US-SHELL-03 여행자 일정 "1차 자리만" 주해, Q13=A) · I-3(US-EXPL-* 신규 스토리 3종 추가 → 119 스토리 수 갱신, Q12=A) · I-4(FR-STAY-03 등록 2경로→3경로, Q6=A) · I-5(C7 경계, CQ3 종속) · I-6(US-TRIP-06 비차단→차단, CQ2 종속) + I-7(인셉션 아님 — backend `전체-API-서피스.md`의 위시리스트 제외가 FR-STAY-01 위반이므로 철회 협의) / 처리 방식 3안(지금 일괄 수정 · 갭 기록만 · 인셉션 스테이지 정식 재개).
**Context**: CONSTRUCTION Per-Unit Loop — U1 Functional Design Step 5 미완(모순 미해소). `functional-design.md` Step 5 "Do not proceed until ALL ambiguities are resolved"에 따라 CQ1~CQ4 답변 대기. 해소 후 Step 6(산출물 4종) 진행.

---
## U1 Functional Design — 명확화 답변 수령 → 산출물 4종 생성 → 승인 게이트
**Timestamp**: 2026-07-23T00:30:00Z
**User Input**: "함 ㄱㄱ" (명확화 파일 직접 편집: **CQ1=A · CQ2=A · CQ3=B**, **CQ4 미기입**)
**AI Response**: (1) 모순 3건 해소 확인 — CQ1=A(저장은 `saved_stay`, 거점은 `base_assignment`+`trip_base_day` 관계 / 통합 UI 유지) · CQ2=A(겹침·공백 **모두 차단형**) · CQ3=B(**C7 Place Data를 U3→U1 이동**, U3는 C8만 보유 · INV-1 집행과 closed-set PBT 게이트도 U1로 이동). **CQ4(인셉션 수정 승인) 미응답 → `workflow-changes.md` §4 "명시 승인 없이 완료 스테이지 수정 금지"에 따라 인셉션 파일 무수정**, 대신 전량 갭(G-U1-*)으로 기록. (2) 산출물 생성 전 **밴드 g 추가 대조**(g01 여행 생성 · g02 거점 숙소 · e02 partial-failure · e05 conflict) — 신규 드리프트 5건: **G-U1-08 다중 목적지 여행**("부산 2박 + 경주 1박 + 도시 추가" vs `trip.destination` 단수) · **G-U1-09 예산 입력 UI 부재**(g01 1/2·g02 2/2 어디에도 없음 vs US-TRIP-01 예산 총액) · G-U1-10 동반 유형 값 도메인 불일치(g01 `연인` vs 온보딩 `커플`, `부모님` 미노출) · G-U1-11 여행별 취향 오버라이드("당신 취향으로 맞췄어요·바꾸기") · 기간 프리셋. **정합 확인**: g02의 구간별 거점 UI("1~2박 부산 / 3박 경주")가 CQ1=A 관계 모델과 정확히 일치, "숙소 없이 시작하기"는 US-TRIP-02 정합, e02 partial-failure("일부 숙소 정보를 불러오지 못했어요" + "가격 미확인")는 US-STAY-11 정합, e05 conflict(좌표 미확정 시 등록 비활성)는 US-STAY-06 예외 정합. (3) **Step 6 산출물 4종 생성**: `business-logic-model.md`(확정 결정 DEC-1~13 · 컴포넌트 경계 5종 · 플로우 F-1~F-6 · 외부 포트 6종 전부 스텁 · 유닛 간 계약 · **갭 G-U1-01~13** · US-EXPL-01~04 신설 제안) · `domain-entities.md`(Poi·PoiSnapshot·SavedPlace·Stay·SavedStay·OtaPartner·OutboundClick·Trip·**TripDestination 신설**·BaseAssignment·TripBaseDay·MustVisit + **INV-U1-01~19** + 이벤트 6종[`TripBaseResolved` 신설] + INV-3 duration 금지 재확인) · `business-rules.md`(**BR-U1-01~56**: 장소·탐색 9 / 숙소·가격 9 / 저장·등록·거점 10 / 제휴 4 / 여행 생성 10 / 커버리지 5 / 필수방문지 4 / 홈집계 2 / 횡단 3) · `frontend-components.md`(라우트 골격 + features/explore·stay·trip 컴포넌트 30여종 + 폼검증 UX사본 + testID + **클라 PBT 4종**). 플랜 체크박스 2~7 `[x]`.
**AI Response (Approval Prompt)**: "🔧 Functional Design Complete - u1-accommodation-trip. 옵션: 🔧 Request Changes / ✅ Continue to Next Stage → NFR Requirements." DO NOT PROCEED until user confirms. 승인과 별개로 **CQ4(인셉션 수정 I-1~I-6) 결정은 여전히 미결**로 남아 재질의 예정.
**Context**: CONSTRUCTION Per-Unit Loop — U1 Functional Design Steps 5~7 완료, 승인 게이트(Step 8). 승인 시 aidlc-state.md `[x]` 후 NFR Requirements 진입.

---
## Change Request — INCEPTION 산출물 사후 개정 (완료 스테이지 수정)
**Timestamp**: 2026-07-23T01:00:00Z
**Request**: 인셉션 수정 I-1~I-6을 지금 일괄 반영 (= 명확화 CQ4=A)
**User Input**: "인셉션도 지금 일괄 수정 ㄱㄱ"
**Current State**: CONSTRUCTION / U1 Functional Design 승인 게이트 대기 중. INCEPTION은 2026-07-13 승인 완료 상태.
**Impact Assessment**: `workflow-changes.md` §4 "Restarting Previous Stage"의 **Low impact → Modify and update dependents** 경로 적용(전면 재실행 아님). 영향 = 인셉션 4파일 + application-design 4파일 → U1 설계 입력. **U0 설계 산출물(8종)은 무영향**(가격·탐색·커버리지·C7 모두 U0 범위 밖). 백업은 git 히스토리로 대체(수정 전 인셉션은 전부 커밋된 상태였음 — 작업 트리 clean 확인).
**User Confirmation**: 명시 승인 수령("인셉션도 지금 일괄 수정 ㄱㄱ").
**Action Taken**:
- **I-1 (Q11=A 가격)** `stories.md` — 에픽 C 헤더 주석에 "목록용 최저가 스냅숏은 정적 저장 허용 / 정확 1박가만 캐싱 금지"로 ADR-0012 적용 대상 정밀화 · US-STAY-01 "대표 가격대(정적 구간)"→**"최저가 스냅숏('부터 가격')"** + 스냅숏 부재 시 "가격 미확인" 규칙 추가 · US-STAY-02 필터·정렬 축 "대표 가격대순"→**"최저가순"**.
- **I-2 (Q13=A 커뮤니티)** `stories.md` US-SHELL-03 — 탐색 랜딩 3진입 표기에 **"여행자 일정은 1차에서 자리만, 실데이터는 U7"** 명시.
- **I-3 (Q12=A 탐색)** `stories.md` — 에픽 A에 **US-EXPL-01~04 신설**(통합 탐색 랜딩 d01 · 지역 선택 d1b/e00 · 목적지 상세 d03 · 장소 탐색/담기 d04·d02), 출처를 PRD가 아닌 **라이브 Figma**로 명기 + 신설 경위 주석. 커버리지 표 A 에픽 5→**9**, 핵심 소계 94→**98**, 합계 119→**123**.
- **I-4 (Q6=A 등록 경로)** `requirements.md` FR-STAY-03 — "등록 **2경로**"→**"3경로"**(지도·장소 검색 / OTA 링크 붙여넣기 / 지도 핀 지정) + 좌표 미확정 시 등록 차단 명문화. "예약번호·메일 자동 인식 없음"은 유지.
- **I-5 (CQ3=B C7 이관)** `components.md` C7 헤더에 **유닛 배정 변경 주석**(U3→U1, INV-1 집행·closed-set PBT 동반 이동, U3는 C8만 보유하고 `CandidatePoolPort` 소비) · `unit-of-work.md` U1 컴포넌트에 C7 추가·U3에서 제거·에픽에 A(탐색) 추가·빌드 순서 Phase 1 문구 갱신 · `unit-of-work-dependency.md` U3 선행 근거 문구 + **PBT 배치를 U3(Place 표준화)→U1**로 이동 · `unit-of-work-story-map.md` U1 행에 C7 이관 표기.
- **I-6 (Q8=B·CQ2=A 커버리지)** `stories.md` US-TRIP-06 — 비차단 스마트 기본값 → **차단형**(후보 1개인 날만 자동 확정, 겹침·공백은 미해결로 일정 생성 차단, 해소 시트 선택지 명시) + **등록 숙소 0개 여행은 차단 대상 아님**(US-TRIP-02 보존) 비고 추가.
- 파생 정합: `unit-of-work.md` §4 검증 문구 94/119→98/123 · `unit-of-work-story-map.md` 헤더·에픽 매핑·유닛별 수(U1 21→**25**)·검증 결과 갱신 · **리포 루트 `CLAUDE.md`의 "(119 stories)"→"(123 stories)"** 정정 · U1 `business-logic-model.md` 갭 표 G-U1-01~06을 "✅ 인셉션 반영"으로 갱신하고 §7 제목을 "신설 제안"→"신설(반영 완료)"로 변경 · `aidlc-state.md` INCEPTION 섹션에 **개정 이력** 블록 신설.
- 미수정(의도적): `inception/plans/*.md`(당시 실행 기록이므로 역사 보존) · `component-dependency.md`(컴포넌트 간 관계는 불변, 유닛 배정만 바뀜) · `backend/docs/design/전체-API-서피스.md`(팀 소유 문서 — I-7 위시리스트 철회는 협의 대상으로 잔존).
**Artifacts Affected**: `inception/user-stories/stories.md` · `inception/requirements/requirements.md` · `inception/application-design/{components,unit-of-work,unit-of-work-dependency,unit-of-work-story-map}.md` · `aidlc-docs/aidlc-state.md` · `construction/u1-accommodation-trip/functional-design/business-logic-model.md` · (리포 루트) `CLAUDE.md`
**Context**: INCEPTION 스테이지 승인 상태는 **유지**(재실행 아님, 국소 수정). U1 Functional Design 승인 게이트는 여전히 열려 있음.

---
## U1 Functional Design — Approved (Stage Complete) → NFR Requirements 진입
**Timestamp**: 2026-07-23T01:20:00Z
**User Input**: "ㄱㄱ"
**AI Response**: U1 Functional Design 승인 수신 → 단계 완료 처리(aidlc-state.md `[x]`). 확정 산출물 = `u1-accommodation-trip/functional-design/{business-logic-model, domain-entities, business-rules, frontend-components}.md` (DEC-1~13 · INV-U1-01~19 · **BR-U1-01~56** · 갭 G-U1-01~13). 다음 = **U1 NFR Requirements** 진입(`.aidlc-rule-details/construction/nfr-requirements.md` 규칙 적용). Step 1(기능 설계 분석) 완료 후 Step 2~4로 계획·질문 파일 생성 예정.
**Context**: CONSTRUCTION Per-Unit Loop — U1 Functional Design 승인 완료 → NFR Requirements 진입.

---
## U1 NFR Requirements — Plan Created (Questions Pending)
**Timestamp**: 2026-07-23T01:25:00Z
**AI Response**: `construction/plans/u1-accommodation-trip-nfr-requirements-plan.md` 생성 — 실행 계획 5단계 + 질문 Q1~Q9. Step 1 분석: U0와 달리 U1의 NFR 표면은 **외부 의존·데이터 신선도·비용**에 몰려 있음(외부 포트 6종·최저가 스냅숏 갱신 주기·POI 수집 게이트·지도 SDK 쿼터·딥링크 포스트백). U0에서 확정된 기준선(SCALE-01~03 DAU 1만·피크 500세션·50RPS / AVAIL 99.9% / SEC 레이트리밋 PostgreSQL 카운터 / OBS 구조화 JSON+Sentry / 단일 리전·다중 AZ / 익스텐션 3종 설정)은 **상속**하고 U1 델타만 질문화. 질문 구성: Q1 스냅숏 갱신 주기·신선도 표기 · Q2 목록/상세 성능 목표(외부 호출 포함) · Q3 외부 포트 타임아웃·서킷·부분 실패 정책 · Q4 POI 데이터 규모·수집 게이트 처리량 · Q5 지도 SDK 쿼터·비용 상한 · Q6 딥링크 포스트백 멱등·보안(서명 검증) · Q7 위치정보 취급(내 주변 탐색 — 위치정보법 접점) · Q8 캐싱 계층(스냅숏·POI·지역 집계) 저장소 선택 · Q9 U1 PBT 게이트 범위(closed-set 게이트가 CQ3=B로 U1 편입됨).
**Context**: CONSTRUCTION Per-Unit Loop — U1 NFR Requirements Steps 1~4 완료. Step 5(답변 수집) 대기 중.

---
## U1 NFR Requirements — 답변 수령 → 산출물 2종 생성 → 승인 게이트
**Timestamp**: 2026-07-23T01:45:00Z
**User Input**: "다했다ㄱㄱ" (플랜 파일 직접 편집: **Q1=A · Q2=A · Q3=B · Q4=A · Q5=B · Q6=A · Q7=A · Q8=B · Q9=A**)
**AI Response**: Step 5(답변 수집·분석) — 9문항 전항 응답, 모호 답변 0건. 모순 검사 결과 **blocking 모순 없음**. 단 **Q8=B(Redis 도입)는 U0의 "Redis 미도입(과설계 회피)" 기준선을 뒤집는 기준선 변경**으로 판정 → 되묻지 않고 진행하되 산출물에 파급 명시(tech-stack §4). 추천과 갈린 3항(Q3=B 재시도 없음 · Q5=B 쿼터 상한 없이 모니터링만 · Q8=B Redis 선제 도입)은 각각 "파급 주의" 블록으로 리스크 기록(RES-U1-02 재시도 제거→부분실패 표면화, UX 배너가 유일 완충 / COST-U1-01 상한 부재→버그성 폭주=비용, OBS 소진율 경보로 보완 / 재평가 트리거 3종). Step 6 산출물 2종 생성: (1) `nfr-requirements.md` — SCALE-U1-01~03 · PERF-U1-01~04(자체 p95<300ms / 외부 p95<1.5s) · UX-U1-01~05 · **DATA-U1-01~04(스냅숏 일1회·48h 초과 숨김·정확가 캐싱금지)** · AVAIL/RES-U1-01~05(포트별 타임아웃·재시도 없음·벤더별 서킷 분리·stale-if-error) · SEC-U1-01~05(객체인가·포스트백 서명검증+멱등·지표 노출차단·URL 화이트리스트·키 서버프록시) · LEGAL-U1-01~03(내 주변 좌표 미저장·법정로그·거부 무차단) · **COST-U1-01~03(쿼터 상한 없이 모니터링)** · OBS-U1-01~04 · **PBT 3종 blocking(closed-set 게이트·커버리지 전수성·정규화 왕복)** · 재평가 트리거 3종. (2) `tech-stack-decisions.md` — 상속 6영역 + U1 신규 모듈 5종(place-data 이관 포함, 마이그레이션 V2.x) + U1 델타 6종(카카오 지도/검색·포트+스텁+Resilience4j·스냅숏 배치 ShedLock 재사용·Redis 도입·PG 영속+Redis 캐시·쿼터 무상한) + **Q8=B 파급 정리**(Redis 용도=조회 캐시 / U0 레이트리밋 카운터는 PostgreSQL 유지·재작업 안 함 / U0 재평가 트리거를 당긴 형태라 규칙 위반 아님 / 로컬 docker-compose에 Redis 컨테이너 추가 / 역방향 재평가) + Infra 이연 5종. 플랜 체크박스 2~4 `[x]`.
**AI Response (Approval Prompt)**: "📊 NFR Requirements Complete - u1-accommodation-trip. 옵션: 🔧 Request Changes / ✅ Continue to Next Stage → NFR Design." DO NOT PROCEED until user confirms.
**Context**: CONSTRUCTION Per-Unit Loop — U1 NFR Requirements Steps 5~7 완료, 승인 게이트(Step 8). 승인 시 aidlc-state.md `[x]` 후 NFR Design 진입.

---
## U1 NFR Requirements — Approved (Stage Complete) → NFR Design 진입
**Timestamp**: 2026-07-23T02:00:00Z
**User Input**: "NFR Design ㄱㄱ"
**AI Response**: U1 NFR Requirements 승인 수신 → 단계 완료 처리(aidlc-state.md `[x]`). 확정 산출물 = `u1-accommodation-trip/nfr-requirements/{nfr-requirements, tech-stack-decisions}.md`. 다음 = **U1 NFR Design** 진입(`.aidlc-rule-details/construction/nfr-design.md` 규칙). **U0와의 차이**: U0 NFR Design은 RESILIENCY-04·14 이연분(배포·복원력 테스트) 해소가 blocking 필수였으나, 그 둘은 U0에서 이미 확정됨 → U1 NFR Design은 **이연 blocking 질문 없이 U1 델타 패턴·논리 컴포넌트에만 집중**. Step 1(NFR 요구 분석) 완료 후 계획·질문 파일 생성.
**Context**: CONSTRUCTION Per-Unit Loop — U1 NFR Requirements 승인 완료 → NFR Design 진입.

---
## U1 NFR Design — Plan Created (Questions Pending)
**Timestamp**: 2026-07-23T02:05:00Z
**AI Response**: `construction/plans/u1-accommodation-trip-nfr-design-plan.md` 생성 — 실행 계획 5단계 + 질문 Q1~Q6(전부 추천안 제시, blocking 필수 없음). nfr-design.md Step 3 필수 카테고리 5종 커버: **복원력**(Q1 서킷 임계·반열림 정책 상세 — RES-U1-02 재시도 없음 확정분 위에) · **확장성**(Q2 POI 검색·목록 인덱스·페이지네이션, 읽기 복제본 미도입 유지) · **성능/캐시**(Q3 Redis 캐시 대상·TTL·무효화 — Q8=B 파급을 설계로 구체화) · **보안**(Q4 포스트백 서명 방식·URL 화이트리스트 관리) · **논리 컴포넌트**(Q5 U1 신규 LC-U1-* 경계 · Q6 스냅숏 배치+closed-set 게이트 배치 위치). U0 명명 체계 계승(`P-{RES/SCALE/PERF/SEC/OBS}-#` 패턴, `C-#`/`LC-U1-#` 컴포넌트). 산출물 예정 = nfr-design-patterns.md + logical-components.md.
**Context**: CONSTRUCTION Per-Unit Loop — U1 NFR Design Steps 1~4 완료. Step 5(답변 수집) 대기 중.

---
## U1 NFR Design — 답변 수령 → 산출물 2종 생성 → 승인 게이트
**Timestamp**: 2026-07-23T02:20:00Z
**User Input**: "추천대로 진행" (Q1~Q6 전항 추천 채택)
**AI Response**: Step 5 — 6문항 전항 추천 확정, 모호·모순 없음. Step 6 산출물 2종 생성: (1) `nfr-design-patterns.md` — **복원력** P-RES-U1-1(다벤더 서킷 격리, 실패율 50%/20호출 open·30s half-open)·2(재시도 없음+부분결과)·3(stale-if-error)·4(폴백 사슬) / **확장성** P-SCALE-U1-1(단일 프라이머리 유지·읽기복제본 미도입)·2(복합인덱스·커서페이지네이션·PostGIS GiST)·3(스파이크 계승) / **성능·캐시** P-PERF-U1-1(응답예산 2계층)·2(**Redis 조회캐시** — 검색10분·집계1h·POI10분·검색어5분, 스냅숏/POI원본/정확가는 캐시 안 함, 캐시=가속층·정합성은 PG)·3(디바운스·클라계산) / **보안·비용** P-SEC-U1-1(객체인가)·2(딥링크 HMAC-SHA256·skew±5m·멱등·지표차단)·3(URL 화이트리스트·키 서버프록시)·P-COST-U1-1(쿼터 상한 없이 소진율 관측) / **데이터·관측** P-DATA-U1-1(배치 스냅숏+48h 신선도 게이트)·P-OBS-U1-1(U1 지표 델타) + NFR 커버리지표 + 미도입·재평가 5종. (2) `logical-components.md` — **LC-U1-1~8**(AccommodationContentPort+스텁 / PriceSnapshotBatch[ShedLock] / LivePriceGateway[캐시금지] / OtaDeeplinkService[서명·멱등] / PlaceSearchPort+MapRenderPort[카카오·서버프록시·쿼터모니터] / **PoiCollectionGate[INV-1 소유·PBT-U1-1·쓰기경로 동기게이트]** / **CoverageResolver[PBT-U1-2·순수함수]** / CandidatePoolProvider[U3 계약]) + 기존 자산 수용 6종(**Redis만 신규**, 나머지 U0 자산 재사용) + 프론트 논리 요소 5 + 컴포넌트→NFR 추적 + Infra 이연. 익스텐션 준수: security Full → P-SEC-U1-1~3 ✅ / resiliency Full → P-RES-U1-1~4 ✅(RESILIENCY-04·14는 U0에서 기해소, U1 이연분 없음) / PBT blocking → LC-U1-6·7 + 프론트 요소에 게이트 배치 ✅. 플랜 체크박스 2~4 `[x]`.
**AI Response (Approval Prompt)**: "🎨 NFR Design Complete - u1-accommodation-trip. 옵션: 🔧 Request Changes / ✅ Continue to Next Stage → Infrastructure Design." DO NOT PROCEED until user confirms. Infrastructure Design은 U0 선례(로컬 전용 SKIP)와 동형이라 승인 시 SKIP 여부 재확인 예정.
**Context**: CONSTRUCTION Per-Unit Loop — U1 NFR Design Steps 5~7 완료, 승인 게이트(Step 8). 승인 시 aidlc-state.md `[x]` 후 Infrastructure Design(SKIP 예상) → U1 설계 종료.

---
## U1 NFR Design — Approved · Infrastructure Design — SKIPPED · ✅ U1 설계 종료
**Timestamp**: 2026-07-23T02:40:00Z
**User Input**: "승인, Infrastructure Design은 U0처럼 스킵"
**AI Response**: (1) U1 NFR Design 승인 수신 → 단계 완료(aidlc-state.md `[x]`). 확정 산출물 = `u1-accommodation-trip/nfr-design/{nfr-design-patterns, logical-components}.md`. (2) Infrastructure Design = **SKIPPED**(사용자 명시 지시, U0 선례와 동형) · 사유 = 배포/클라우드 계획 부재로 클라우드 리소스 결정의 근거·검증 수단 없음, 규칙상 CONDITIONAL "no infrastructure changes" 해당. 재개 조건 = 배포/클라우드 진입 결정 시 별도 지시. **특기**: U1은 Redis 도입(Q8=B)이라는 신규 인프라 요소가 있으나, 이는 로컬 docker-compose 스택 확장이지 배포 인프라 설계가 아니므로 SKIP 사유 유지 — 대신 Open Items에 "로컬 Redis 컨테이너 추가"로 명시. (3) **U1 설계 단계 종료** — 총 산출물 8종(functional-design 4 + nfr-requirements 2 + nfr-design 2). (4) **Open Items에 U1 섹션 신설**: 로컬 Redis 컨테이너 추가 · 카카오 콘솔 설정(개발 선결 블로커) · 선재 backend 설계 문서 정합(I-7 위시리스트 철회·가격 스냅숏 컬럼·trip_destination·등록 3경로) · G-U1-09 예산 UI 부재 · G-U1-10 동반유형 매핑 · 배포 의존(실어댑터 벤더 계약·POI 적재·쿼터 상한). Code Generation은 SCOPE.md 범위 외(팀이 각 패키지에서 직접 개발).
**Context**: CONSTRUCTION Per-Unit Loop — U1 NFR Design 승인 → Infrastructure Design SKIP → **U1 설계 종료**. 다음 = 사용자 지시 대기(U2 설계 착수 또는 U1 팀 개발 핸드오프). U0에 이어 U1도 설계 문서 8종으로 종료.

---
## Post-Design Correction — U0·U1 frontend-components.md 정본 사본 드리프트 삭감 (A1)
**Timestamp**: 2026-07-29T05:10:00Z
**User Input**: "그러니까 내가 승인하면 기록까지해서 사이클 끝 -> 후속작업으로 aidlc/CLAUDE.md 규칙에 맞게 문서들 수정까지 하겠다는거 맞지?" → "아니 이어서 진행해 내 개입없이" (TRIP-179 사이클 종료 후 후속 티켓 A1 착수 지시)
**AI Response**: 승인 완료된 설계 문서 2종(`u0-foundation/functional-design/frontend-components.md` · `u1-accommodation-trip/functional-design/frontend-components.md`)의 **드리프트만 정정**. 새 설계 결정·새 컴포넌트·새 요구사항 추가 0건 — 따라서 스테이지 진행이 아니며 승인 게이트 대상이 아니다.
(1) **층 구조 사본 제거(2건)** — 두 문서 머리말이 `frontend/README.md`를 "정본"이라 선언하면서 정작 층 구조(`src/app` 얇은 라우트 + `features/` 구현 + `shared/` 횡단)를 **베껴 적고 있었고**, TRIP-173의 FSD 재편(`pages/`·`app-shell/`·`ui/model/lib/config`)으로 그 사본이 틀린 값이 됐다. 포인터만 남기고 서술 삭제 + "폴더가 아니라 컴포넌트의 책임·상태·서버 연동을 정한다"는 문서 역할을 명시. 처방이 FSD 포팅이 아니라 **삭감**인 이유: 다시 베끼면 다음 층 변경에 또 갈라진다(TRIP-173만 해도 층이 두 번 이동).
(2) **폴더 단정 제목 제거(5건)** — `## 2. features/explore`·`## 3. features/stay`·`## 4. features/trip`(U1) / `## 2. features/onboarding`·`## 3. features/home`(U0) → 밴드·역할 기반 제목으로. 슬라이스 배치는 프론트 정본과 후속 티켓 A2 소관.
(3) **경로·메서드 정정 — `backend/docs/design/openapi.yaml` 전수 대조(29경로)**. U1: `GET /stays?region=&filters=`→`GET /stays/search`(+BR-U1-10/15 제약 병기) · `POST/DELETE /stays/{id}/save`→`POST /saved-stays`·`DELETE /saved-stays/{savedStayId}` · `GET /me/saved-stays?tripId=`→`GET /saved-stays` · `GET /stays/geocode?q=`→`GET /stays/geocode` · `POST /trips/{id}/bases/coverage`→`GET /trips/{tripId}/coverage`(해소는 `POST /trips/{tripId}/bases` 재배정) · `GET /trips/{id}/bases`→`GET /trips/{tripId}/coverage`+`DELETE .../bases/{baseAssignmentId}`. U0: `GET /nickname/suggestions`→**POST** · `PUT /me/profile/nickname`→**PATCH**.
(4) **계약 미존재 표식 신설(11건)** — 문서가 계약보다 앞서 나간 경로에 `⚠️ 계약 미존재`를 달았다. §2 탐색 전량(`/explore/landing`·`/regions`·`/regions/{region}`·`/places`·`/places/{poiId}/save`·`/me/saved-places`) + §3 숙소 일부(`/stays/{id}`·`/stays/{id}/live-price`·`/stays/{id}/outbound`·`/stays/parse-link`·`/stays/reverse-geocode`) + §4 `/regions`·`/me/saved-places`. §2 머리에 "장소 도메인은 openapi 0경로·백엔드 모듈 0개(2026-07-29 실측) — 후속 티켓 C 선행 필요" 경고를 달았다. 서버 연동 열 표기 규약도 머리말에 신설(정본은 openapi.yaml, 이 표는 사본).
(5) **숫자 사본 제거(1건)** — U0 §4 "현행 openapi 20 경로"(실제 29) → 숫자를 박지 말고 정본을 가리키도록 교체.
**존치**: 라우트 목록 · 컴포넌트 책임표 · testID 규약 · BR 매핑 · PBT 대상 — 폴더에 매이지 않은 실질이라 그대로 둔다.
**Context**: SCOPE.md 현행 범위(CONSTRUCTION 설계 문서 단계) 내 **기존 승인 산출물의 사후 정정**. 스테이지 진행 아님 → `aidlc-state.md` 체크박스 변동 없음. 발단은 TRIP-179 사이클 [설계] 3-a 맹점 훑기에서 사용자가 제기한 "장소·숙소 비대칭" 논의이고, 그 자리에서 사이클 내 수정을 보류한 이유는 **역류 방지**(같은 사이클의 게이트가 방금 쓴 문서를 AC 근거로 인용하게 된다). 후속 티켓 A1으로 분리해 사이클 종료 후 착수. 남은 후속: **B**(장소 상세 스토리 신설 — Inception 변경, 승인 게이트 필요) · **C**(`place-data` 모듈 + 장소 계약 — 진짜 병목) · **A2**(장소 동급 재배치 — B 의존).

---

## Post-Design Correction — U1 frontend-components.md 잔여 드리프트 2건 (TRIP-181 [기록] 반영)
**Timestamp**: 2026-07-29T22:35:00Z
**User Input**: TRIP-181 사이클 [설계] 3-a 맹점 훑기에서 사용자가 정본 반영 후보 4건(D1~D4) 중 D1·D2·D3 3건을 선택(`_workspace/20260729-trip181-stay-search-list/01b_ouroboros_seed.md` §6 — D4 밴드맵 드리프트는 하네스 파일이라 관측만 유지, 반영 대상에서 제외).
**AI Response**: 승인 완료된 `u1-accommodation-trip/functional-design/frontend-components.md`의 **잔여 드리프트만 정정**(새 설계 결정·컴포넌트·요구사항 추가 0건 — 위 2026-07-29T05:10:00Z A1 정정과 같은 성격의 후속).
(1) **D1** — §3 `StaySearchResult` 행의 state/props 열에서 "무한 스크롤" 삭제(`필터 Zustand · 무한 스크롤` → `필터 Zustand`, 파일 55행). 근거: `backend/docs/design/openapi.yaml`의 `/stays/search`에 페이지네이션 파라미터가 없어 구현 불가함을 TRIP-179·TRIP-181 두 사이클에서 실측 — 요구사항 근거 아니라 계약 실측 근거다.
(2) **D2** — §3 `StayCard` 행의 가격 표기 `` `₩120,000~ · 1박` `` → `` `120,000원~ · 1박` `` 정정(파일 56행). 근거: TRIP-180에서 사용자가 확정한 구현 결정(`frontend/src/features/stay/model/formatPrice.ts`가 `120,000원~`을 반환) — **구현 결정이지 요구사항 근거가 아니다.** 다음 사이클이 이 서식을 요구사항 근거로 인용해서는 안 된다.
D3(지라 TRIP-181 티켓 본문의 사실 오기 2건 — 빈 스텁 서술·경로 드리프트 서술)은 aidlc 문서가 아니라 **지라 TRIP-181 코멘트(comment id 10072)로 오케스트레이터가 이미 반영 완료** — 여기서는 중복 작업하지 않는다.
**Context**: SCOPE.md 현행 범위(CONSTRUCTION 설계 문서 단계) 내 **기존 승인 산출물의 사후 정정**. 스테이지 진행 아님 → `aidlc-state.md` 체크박스 변동 없음. 정정 실행 주체: TRIP-181 사이클 [기록](scribe) 단계.

---

## Post-Design Correction — U1 SEC-U1-05 지도 표시 키 예외 명시 (TRIP-197 [기록] 반영)
**Timestamp**: 2026-07-31T11:45:00Z
**User Input**: TRIP-197 사이클 [설계] 3-a 맹점 훑기에서 사용자가 정본 공백·드리프트 6건 중 3건을 선택했고 그중 하나가 이 항목("aidlc SEC-U1-05 문장에 예외 명시"). [기록] 단계에서 scribe가 승인 게이트 필요를 이유로 미반영 처리한 뒤, 종료 보고에서 미해결로 제시하자 사용자가 착수 지시: **"2 ㄱㄱ"** (종료 보고의 '다음에 이어서 할 일' 2번 = aidlc SEC-U1-05 미반영 건).

**AI Response**: 승인 완료된 `u1-accommodation-trip/nfr-requirements/nfr-requirements.md`의 **드리프트만 정정**. 새 요구사항·새 설계 결정 추가 0건 — 따라서 스테이지 진행이 아니며 승인 게이트 대상이 아니다(2026-07-29T05:10:00Z A1 정정 · 2026-07-29T22:35:00Z D1·D2 정정과 같은 성격의 세 번째 후속).

**무엇이 드리프트였나**: SEC-U1-05가 *"지도·장소 검색 API 키는 서버측 보관·프록시. 클라이언트에 원 키 노출 금지"*로 **두 종류의 키를 한 문장에 묶어** 동일 규칙을 적용했다. 실제로는 경로가 갈린다 —

- **장소 검색(로컬 REST) 키**: 서버 프록시가 성립한다. 프론트는 `GET /stays/geocode`만 부르면 되고 계약도 이미 있다. 원 문장 그대로 유효.
- **지도 표시 키**: 지도 SDK가 **클라이언트 안에서 초기화**되므로 키가 앱/번들에 들어가는 것을 물리적으로 피할 수 없다(네이티브 경로면 AndroidManifest/Info.plist, WebView 경로면 JS 번들). *"서버에서 받아와 SDK에 넣자"*는 SDK 초기화 시점보다 응답이 늦어 지도가 뜨지 않는다.

그 결과 이 문장은 **동일 리포의 프론트 정본(`frontend/README.md` §93 "지도 앱 키 등은 EAS 시크릿으로 빌드 시 주입")과 정면으로 충돌**했고, 같은 취지의 문장이 `nfr-design-patterns.md` §68 · `logical-components.md`(지도·검색 어댑터 "키 미보유")에도 반복돼 있다. 루트 `CLAUDE.md`의 문서 충돌 규칙(패키지 아키텍처·구현 결정은 해당 패키지 정본)은 프론트 정본 쪽을 가리킨다.

**정정 내용**: SEC-U1-05 행을 두 키로 분리하고, 지도 표시 키에 예외를 명시했다. 핵심은 **보호 수단이 은닉이 아니라 벤더 콘솔의 사용처 제한**이라는 것 — 즉 요구는 "노출 금지"가 아니라 **"등록된 사용처에서만 유효하게 유지"**다.

**실측 근거(TRIP-197 층 C)**: 카카오는 요청 origin을 검사해 미등록 도메인에 접근을 거부한다. 미등록 상태에서 `{"errorType":"AccessDeniedError","message":"domain mismatched! caller=https://localhost. check out registered web domains."}`를 반환했고, `JavaScript SDK 도메인` 등록 후 정상 SDK 코드를 반환했다(상세: `_workspace/20260730-trip197-map-bridge/04b_smoke_1_PASS.md` §5-2·§6). 즉 키가 번들에 있어도 등록되지 않은 곳에서는 쓸 수 없다 — 이것이 예외를 성립시키는 기제다.

**미반영으로 남긴 것**: 같은 취지가 반복된 `nfr-design-patterns.md` §68과 `logical-components.md`의 "키 미보유" 서술은 **이번에 손대지 않았다**. 사용자 선택 항목이 SEC-U1-05 한 곳이었고, 정본 반영은 고른 것만 한다는 사이클 규칙(3-a 정본 반영 선택)에 따른다. 두 문서는 여전히 "클라이언트 키 0"으로 읽히므로 **후속 정정 후보**다.

**Context**: SCOPE.md 현행 범위(CONSTRUCTION 설계 문서 단계) 내 **기존 승인 산출물의 사후 정정**. 스테이지 진행 아님 → `aidlc-state.md` 체크박스 변동 없음. 발단은 TRIP-197 [인지] 브리프 §11-⑤ 드리프트 1(정본끼리 어긋남) 관측이고, 사이클 도중 수정을 보류한 이유는 역류 방지(같은 사이클의 게이트가 방금 쓴 문서를 AC 근거로 인용하게 된다). 실행 주체: 사이클 종료 후 오케스트레이터 직접(scribe 1차 시도는 승인 게이트 판단으로 미수행, 사용자 착수 지시 후 재개).

---

## Post-Design Correction — U1 frontend-components.md 장소 도메인 계약 실재 반영 + 밴드 d 라이브 실측 (TRIP-184 서브태스크 준비)
**Timestamp**: 2026-08-02T03:00:00Z
**User Input**: "지라 TRIP-184 스토리 서브테스크에 지금 FE 구현 내용이 없는거 같은데 채워 넣어야해 확인후 채워넣어야하는 서브테크스 목록 출력만 해봐" → (라이브 Figma 확인 요구) → **"그럼 지금 여기서 aidlc에 없는 부분은 aidlc를 보강할 수 있도록하고 이를 통해서 이번 스토리 필요한 서브테스크들 사항들 상세하게해서 추가해놔"**. 이후 결정 4건을 사용자가 선택: (1) 사진 필드는 [BE] 칸으로 계약 보강 요청 (2) 정렬·검색은 클라이언트 처리 (3) 카테고리는 계약 enum이 정본 + 태그는 [BE] 요청 (4) 계약 보강 요청은 TRIP-184 밑 [BE] 칸 1개로.

**AI Response**: 승인 완료된 `u1-accommodation-trip/functional-design/frontend-components.md`의 **드리프트 정정 + 라이브 실측 기록**. 새 스토리·새 컴포넌트 신설 0건 → 스테이지 진행 아님, `aidlc-state.md` 체크박스 변동 없음 (2026-07-29T05:10:00Z A1 · 2026-07-29T22:35:00Z D1·D2 · 2026-07-31T11:45:00Z SEC-U1-05 정정과 같은 성격의 네 번째 후속).

(1) **§2 머리말 — "계약 미존재" 경고 해소(담기·장소 목록 한정)**. `origin/develop` openapi 실측으로 `GET /places?region&category` · `POST /saved-places`(409/404) · `GET /saved-places` · `DELETE /saved-places/{savedPlaceId}` 실재 확인. 백엔드도 TRIP-212(place-data 코어)·TRIP-214(saved_place + poi_snapshot 동결) 완료. **경로 이름이 이 문서가 앞서 적어둔 것과 다르다** — `/places/{poiId}/save`→`POST /saved-places`, `/me/saved-places`→`GET /saved-places`. 2026-07-29 시점 문장은 그때 사실이었으므로 삭제하지 않고 인용으로 남겼다. **탐색 랜딩·지역·목적지 상세(`/explore/landing`·`/regions`·`/regions/{region}`)는 여전히 계약 미존재**임을 같은 자리에 명시.

(2) **§2 표 2행 정정** — `PlaceExplorer`·`SavedPlaceList`의 서버 연동 열을 실제 경로로 바꾸고, 책임 열에 라이브 d04·d02 실측(정렬 칩 3종 · 2열 사진 그리드 · `♥ 담음` 배지 · 순번 배지 · 태그 칩 · 확정 CTA 문구 · empty 문구)을 반영.

(3) **§2-1 신설 — 밴드 d 라이브 노드 색인(7개)**. d01 `1672:1183` · d02 `1693:1183`/`1695:1183`(default·empty) · d03 `2091:2020` · **d04 `1692:1183`(default 1개뿐 — e02와 달리 상태 변형 프레임 없음)** · d05 `2176:2336` · **d06 `1907:1083`** · d1b `1834:2283`. 화면 상세 정본은 라이브이고 이 표는 "어느 노드를 열지"의 색인임을 명시.

(4) **d06-장소 상세를 관측만 하고 표에 행을 추가하지 않았다.** 열어보면 `이 일정에 추가` CTA · "이 장소를 추천한 이유"(AI 추천 근거) · "현재 위치서 560m · 반경 내"로 **일정 생성·여행중 맥락**이고 ♥ 담기 CTA가 없다 — US-EXPL-04 소관이 아니다. 이 관측은 2026-07-29T05:10:00Z 항목이 남긴 **후속 B(장소 상세 스토리 신설 — Inception 변경이라 승인 게이트 필요)**의 근거를 보강한다. **스토리 없이 컴포넌트만 늘리면 근거 없는 구현이 되므로 행 추가는 승인 게이트로 넘긴다.**

(5) **§2-2 신설 — 라이브 ↔ 계약 드리프트 5건(F-1~F-5) + 사용자 결정**. F-1 `Place.imageUrl` 부재(화면은 사진이 주역) → [BE] 계약 보강 요청 · F-2 정렬 3축에 `sort` 파라미터 없음 → 클라 정렬(`가까운 순`은 좌표 부재로 미노출) · F-3 검색바에 `q` 없음 → 클라 이름 필터 · F-4 칩 6종 vs enum 7종 + `바다`·`감성 골목`·`미식` 등 enum 밖 값 → **계약 enum이 정본** · F-5 `Place.tags` 부재 → [BE] 요청. BR-U1-06의 "N 저장" 배지가 라이브에서 정렬 칩 `지금 뜨는 순`·d05 `🔥 지금 급상승`으로 나타나는 표기 위치 차이도 같은 자리에 기록(BR의 실질 — 집계 실패 시 배지만 생략 — 은 유효).

(6) **§4 `MustVisitSeedStrip` 행 정정** — `⚠️ 계약 미존재(/me/saved-places) — C 대기` → `GET /saved-places` · `/trips/{tripId}/must-visits` 둘 다 실재. **TRIP-209가 보류 사유로 적은 선행 2건이 해소됐다.** 같은 절에 밴드 g 라이브 변형 신설(`g01 · no-saved-places` `2226:1732` · `g01 · error` `2226:1929` · `g01 · blocked-overseas` `2228:1738` · **`g03 필수 방문지 관리` `2230:1732`**)을 기록 — TRIP-209가 "Figma에 담은 곳 0 변형이 없다"로 남긴 미결이 프레임 실재로 풀린다. g03은 US-TRIP-08(지라 티켓 미존재)의 화면.

(7) **§6 testID — 공백 명시**. d04 카테고리 칩·정렬 칩·카드 컨테이너, d02 순번 항목·해제·빈 상태의 testID가 이 문서에 없음을 적고, TRIP-182가 e02 5상태 이름을 구현에서 확정해 소급 기록한 방식대로 **TRIP-184 게이트①에서 확정 후 소급**하도록 지정.

**미반영으로 남긴 것**: ① d06 컴포넌트 행·장소 상세 스토리(후속 B — 승인 게이트) ② `business-rules.md` BR-U1-06 문면(표기 위치 차이는 FE 문서에만 적었다 — BR은 서버 판정 정본이고 배지 위치는 화면 결정) ③ `figma-structure.md` 밴드 맵(밴드 구성 자체는 라이브와 일치 — 화면 목록은 그 파일이 두지 않는다) ④ `stories.md` US-EXPL-04 AC(검색·정렬이 계약에 없다는 사실은 티켓의 미충족 기록으로 처리, 스토리 문면은 Inception이라 손대지 않는다).

**Context**: SCOPE.md 현행 범위(CONSTRUCTION 설계 문서 단계) 내 **기존 승인 산출물의 사후 정정**. 실행 주체: TRIP-184 서브태스크 작성 작업(오케스트레이터 직접). 실측 근거는 `origin/develop:backend/docs/design/openapi.yaml`(448·464·484행)과 라이브 Figma(fileKey `1MTF3dtptIrbg8gld5IdO2` 캔버스 `1228:1045`) 전수 조회.

---

## Post-Design Correction — U1 frontend-components.md 거점·커버리지 3건 (TRIP-84 서브태스크 준비)
**Timestamp**: 2026-08-02T04:30:00Z
**User Input**: "야 그거 하고 TRIP-84도 똑같이해라" — 직전 TRIP-184 작업(2026-08-02T03:00:00Z 항목)과 같은 처리를 TRIP-84(US-TRIP-04 저장 숙소에서 등록)에 적용하라는 지시. 앞선 "그거"는 TRIP-209 본문 전면 갱신.

**AI Response**: 승인 완료된 `u1-accommodation-trip/functional-design/frontend-components.md`의 **드리프트 정정 3건**. 새 요구사항·컴포넌트 0건 → 스테이지 진행 아님, `aidlc-state.md` 불변(같은 성격의 다섯 번째 후속).

(1) **§7 PBT 대상 `resolveCoverage(trip, assignments)` — 클라이언트 대상에서 제외(취소선 + 사유)**. 실제 계약 `GET /trips/{tripId}/coverage`가 날짜별 `status`(AUTO·GAP·OVERLAP)와 `blocked`를 **서버에서 계산해 준다**(openapi `Coverage`·`DayCoverage`). 클라이언트가 같은 판정을 다시 구현하면 서버와 갈라지고 **INV-2**(사용자에게 보이는 판정은 서버·솔버 검증값)에 정면으로 어긋난다. 이 줄은 계약보다 앞서 쓰인 문서다. 클라이언트가 갖는 것은 표시용 구간 파생(`toBaseSections` — 박 번호 라벨·N박 묶음)뿐이며 그 속성을 대체 기재했다(TRIP-224).

(2) **§4 `BaseSectionList` 서버 연동 정정** — 구간 행의 원본은 `GET /trips/{tripId}/bases`(BaseAssignment[])다. 기존 표기는 `GET /trips/{tripId}/coverage`를 "구간·배정 상태"의 원본으로 적었으나, coverage는 **날짜별 판정과 `blocked`**를 주는 별개 응답이고 구간(dateFrom~dateTo·savedStayId)을 주지 않는다. coverage는 하단 CTA 차단에만 쓴다(BR-U1-44 · INV-U1-16).

(3) **§5 폼 검증 표의 오류 코드 정정** — "BR-U1-22·26 (409/422)" → **400(ValidationError)·404**. `/saved-stays`·`/trips/{tripId}/bases` 계약에 409·422는 존재하지 않는다. 잘못된 코드로 오류 분기를 짜면 모든 검증 실패가 미처리 경로로 빠진다.

**함께 확인해 미반영으로 남긴 것**: ① US-TRIP-04 예외 AC("저장 숙소가 외부에서 더 이상 조회되지 않으면 캐시로 등록 허용 + '최신 정보 확인 불가' 표시")는 **계약에 판정 근거가 없다** — `SavedStay`에 외부 조회 상태·최신성 필드가 없고(externalSource·externalId·updatedAt뿐), 저장 숙소는 이미 계정 DB 값이라 프론트가 외부 조회 실패를 알 수단이 없다. 스토리 문면은 Inception이라 손대지 않고 **TRIP-226 본문에 미충족으로 기록**했다(계약 보강이 필요한 후속). ② Figma g02·e04 카드의 가격 표기가 여전히 `₩190,000~`인 것은 이미 알려진 D-3/D2 드리프트이고 구현 정본(`120,000원~` 형식)이 이긴다 — 문서는 2026-07-29에 이미 정정돼 추가 조치 없음.

**Context**: SCOPE.md 현행 범위(CONSTRUCTION 설계 문서 단계) 내 **기존 승인 산출물의 사후 정정**. 실행 주체: TRIP-84 서브태스크 작성 작업(오케스트레이터 직접). 실측 근거는 `origin/develop:backend/docs/design/openapi.yaml`(590~668행 · schemas `AssignBaseRequest`·`BaseAssignment`·`Coverage`·`DayCoverage`·`SavedStay`·`EditSavedStayRequest`)과 라이브 Figma(g02 `1707:1183`·`1708:1183` · e04 `1701:1183`·`1702:1183` · g01 no-saved-places `2226:1732`), 그리고 리포 실측(`src/shared/api/generated/trips/trips.ts`에 bases·coverage·must-visits 훅이 TRIP-203 codegen으로 이미 생성돼 있어 **TRIP-84에는 계약 동기화 칸이 불필요**).

---

## Post-Design Correction — U1 frontend-components.md·business-rules.md 예산 블록 5건 (TRIP-207 [기록] 반영)
**Timestamp**: 2026-08-02T23:10:00Z
**User Input**: TRIP-207 사이클 [설계] 3-a 맹점 훑기에서 사용자가 정본 반영 후보 중 4건(§4 실측 문단 갱신·§6 testID 5종 등재·§7 PBT 대상 추가·BR-U1-33 예산 열거 추가)을 전부 채택했고, §4 `[구현 결정]` 컴포넌트 행 추가 1건은 지라 티켓 본문이 명시 요구해 선택 여부와 무관하게 함께 반영한다(근거: `_workspace/20260802-trip207-budget-block/01b_ouroboros_seed.md` AC-9 — "사용자가 3-a에서 4건 전부 채택 + 티켓 요구분 1건", TRIP-181/TRIP-197 [기록] 반영과 같은 처리 방식).

**AI Response**: 승인 완료된 `u1-accommodation-trip/functional-design/frontend-components.md`·`business-rules.md`의 **드리프트 정정 + 구현 결정 소급 기록**. 새 스토리·새 컴포넌트 계약(엔드포인트) 신설 0건 → 스테이지 진행 아님, `aidlc-state.md` 체크박스 변동 없음(2026-07-29T05:10:00Z A1 · 2026-07-29T22:35:00Z D1·D2 · 2026-07-31T11:45:00Z SEC-U1-05 · 2026-08-02T03:00:00Z·04:30:00Z 정정과 같은 성격의 여섯 번째 후속).

(1) **frontend-components.md §4 — `BudgetInputField` 구현 결정 행 신설(티켓 명시 요구)**. 예산 총액 입력(선택) — 온보딩 취향 러프값(`PreferenceView.budget.rawAmount`) 프리필 + 고정 안내 문구, 비우면 `budgetTotal` 키 자체 미전송(BR-U1-38 덮어쓰기 허용). 이 문서 승인(2026-07-23) 당시 §4 표에 예산 컴포넌트 행이 없었다(티켓이 직접 지목한 공백) — TRIP-182 `StateNotice`·`SkeletonList` 소급 기록 방식을 그대로 따른다.

(2) **frontend-components.md §4 라이브 실측 문단 갱신** — `g01 · default`(`1675:1183`) **내부** 구성이 바뀐 것을 기존 "밴드 g 변형 프레임 신설" 문단과 분리해 별도로 적었다. 프레임 **개수**는 안 변했고 **내용**이 변했다: 예산 블록 `sec_budget`(`2225:2375`, 구분선 `d3w` `2225:2373`) + 등록 숙소 날짜 가져오기 행 `stayImportRow`(`2225:2362`, TRIP-208 소관 — 이번엔 컴포넌트 행을 두지 않고 존재만 기록, TRIP-208 [기록]에서 소급).

(3) **frontend-components.md §6 — 예산 testID 5종 등재**. `trip-wizard-budget-block`·`trip-wizard-budget-input`(티켓 확정)·`trip-wizard-budget-edit`·`trip-wizard-budget-note`·`trip-wizard-error-budget`(블록 슬러그 규약, 기존 `trip-wizard-error-destination`·`-period`와 동형). 이 문서 승인 당시 공백이었다.

(4) **frontend-components.md §7 — PBT 대상에 예산 정규화 추가**. `parseBudgetAmount`/`formatBudgetAmount`의 왕복 성질(표시값↔전송값, `0` 유효값, `toLocaleString`/`Intl` 0건). 이 문서 승인 당시 PBT 대상 목록에 없었다(공백).

(5) **business-rules.md BR-U1-33 — 위저드 1단계 열거에 "예산" 추가**. "(1/2) 여행지·꼭 갈 곳·기간·인원·동반" → "…·동반·예산(선택, 온보딩 러프값 프리필)". g01 라이브 화면에는 있고 정본 열거에는 없던 공백.

**미반영으로 남긴 것**: `stayImportRow`(TRIP-208 소관) 컴포넌트 행 자체는 아직 안 둔다 — 이번 반영은 존재 사실만 기록하고, 책임·state/props·서버 연동 정의는 TRIP-208 [기록]이 채운다.

**Context**: SCOPE.md 현행 범위(CONSTRUCTION 설계 문서 단계) 내 **기존 승인 산출물의 사후 정정**. 정정 실행 주체: TRIP-207 사이클 [기록](scribe) 단계. 실측 근거는 `_workspace/20260802-trip207-budget-block/01_spec-analyst_brief.md`(§3·§4·§7-④)·`02a_test-design_spec.md`(§2-6)와 라이브 Figma(`2225:2375`·`2225:2362`).

---

## Post-Design Correction — U1 frontend-components.md 꼭 갈 곳 시드 표면 6건 (TRIP-209 [기록] 반영)
**Timestamp**: 2026-08-06T14:20:00Z
**User Input**: TRIP-209 사이클 [설계] 3-a 맹점 훑기에서 사용자가 정본 공백 후보(`01_spec-analyst_brief.md` §8-③ "must-visit 등록 실패 표면이 정본에 없어 발명 대상")에 "(가) 반영"을 선택했다(`_workspace/20260805-trip209-mustvisit-seed/01b_ouroboros_seed.md` §4). 발명한 문구·자리·재시도 범위·썸네일 상한은 게이트①-1 승인(2026-08-06 02:50, 승인 발화 "ㄱㄱ")에서 5건 확정했고, 담은 목록 도착 전 제출 잠금 1건은 게이트①-1 이후 code-critic 적대적 리뷰가 찾은 무방비 경로를 메우며 게이트①-2 승인(2026-08-06 13:22, 승인 발화 "ㄱ")에서 별도로 확정했다(정본 AC 없음 — 게이트 결정으로 표기).

**AI Response**: 승인 완료된 `u1-accommodation-trip/functional-design/frontend-components.md`의 **드리프트 정정(구현 결정 소급 기록) + testID 등재**. 새 스토리·새 컴포넌트 계약(엔드포인트) 신설 0건 → 스테이지 진행 아님, `aidlc-state.md` 체크박스 변동 없음(2026-07-29T05:10:00Z A1 · 2026-07-29T22:35:00Z D1·D2 · 2026-07-31T11:45:00Z SEC-U1-05 · 2026-08-02T03:00:00Z·04:30:00Z · 2026-08-02T23:10:00Z 정정과 같은 성격의 일곱 번째 후속).

(1) **frontend-components.md §4 — `MustVisitSeedStrip` 구현 결정 문단 신설**. 썸네일 상한 3장 고정(특례 없음) · 등록 실패 배너 문구 `꼭 갈 곳 {N}곳 중 {M}곳을 등록하지 못했어요` · 배너 자리(제출 실패 배너와 같은 자리·다른 testID) · 재시도 사정거리(실패분만) · 조회 실패 부제 `담은 곳을 불러오지 못했어요` — 이상 5건은 게이트①-1 사용자 결정. 담은 목록 도착 전 `[다음]` 잠금(비회원 예외)은 게이트①-2 사용자 결정이며 **정본 AC 문장이 없음을 명시**했다. 전 6건에 "요구사항 근거가 아니라 구현 결정 — 다음 사이클이 요구사항 근거로 인용 금지" 라벨을 달았다(TRIP-181 D2 정정과 같은 규율).

(2) **frontend-components.md §6 — 꼭 갈 곳 시드 testID 9종 등재**. 티켓 고정 4종(`trip-wizard-mustvisit-{sourcePoiId}`·`-remove-{sourcePoiId}`·`-more`·`-empty`) + 게이트①에서 확정한 신규 5종(`-block`·`-image-{sourcePoiId}`·`-overflow`·`-retry`·`-banner`/`-banner-retry`). 이 문서 승인 당시 공백이었다.

**미반영(확인만)**: §7 PBT 대상 `seedMustVisits(savedPlaces)`는 이 문서 승인 당시 이미 등재돼 있어(중복 sourcePoiId 없음·원본 담기 해제와 독립) 추가 조치 없음.

**Context**: SCOPE.md 현행 범위(CONSTRUCTION 설계 문서 단계) 내 **기존 승인 산출물의 사후 정정**. 정정 실행 주체: TRIP-209 사이클 [기록](scribe) 단계. 실측 근거는 `_workspace/20260805-trip209-mustvisit-seed/00_gates.md`(게이트①-1·①-2 절)·`01_spec-analyst_brief.md`(§8-③)·`01b_ouroboros_seed.md`(§4)·`02a_test-design_spec.md`(§2-4).

---

## CONSTRUCTION — U2 Itinerary Intelligence/Solver · Functional Design 착수 (Step 1~4)
**Timestamp**: 2026-08-07T03:59:55Z
**User Input**: "그럼 2 -> 3진행하자 실제 구현은 우리가 할거야 너는 문서 작업만"

**AI Response**: U2(Itinerary Intelligence/Solver) Functional Design **Step 1~4 수행**, Step 5(답변 수집) 대기. 산출물 = `aidlc-docs/construction/plans/u2-itinerary-intelligence-functional-design-plan.md`(계획 + 질문 Q1~Q8).

**Step 1 기존 자산 조사 — 핵심 발견**: U2는 **그린필드가 아니다**. U1 착수(코드 0줄)와 상황이 근본적으로 다르다.
- `ai/src/trippilot/` 에 U2 실질이 **구현 완료**: c2 9모듈(facade·HC1~HC4 constraints·ortools·llm·fallback·scorer·travel·repair·quality) = `SolverPort`+`FeasibilityValidator`+`TravelEstimatePort`, c1(gateway·gates 4·workers 4·anthropic 어댑터) = `PreferenceScoringPort`/`LlmGatewayPort`, ports 9종.
- `ai/aidlc-docs/` = **별도 AI-DLC 워크스페이스**(자체 inception + construction). 유닛 번호 체계가 다르다: aidlc U2 ≈ ai `u1-domain-ports`(2026-07-23 완료) + `u2-solver`(2026-07-29 코어 완료, 76 tests green) + `u4-c1-gateway`(FD 완료·승인 대기) + `agent-foundation`. **U2 기능설계가 이미 존재**(`u2-solver/functional-design/` 3종).
- `backend/modules/itinerary-generation/` 에 U3(C8) 착수분 실재: `ScheduleAgentPort.kt`(경계 포트, TRIP-228) · 서비스 4 · 도메인 3 · 테스트 8 · `V2.7__itinerary.sql`·`V2.8__visit_slot_ends_next_day.sql`.
- 프런트는 `(tabs)/itinerary.tsx` 셸뿐 — U3 화면 설계는 통째로 남음.
- 드리프트 감사 `ai/docs/backend-ai-정합성-점검.md`(2026-08-06 재감사) P1~P8·N1~N6을 계획서에 표로 옮기고 현황 갱신: **N1(자정 넘김 HC4)은 `V2.8` + `endsNextDay`로 해소 확인**(TRIP-279 반영됨), P5 해소, 잔여 = P6(정본 `solver/` 디렉토리 표기)·N2~N6·Violation 스키마(TRIP-280·281·282).

**제기한 쟁점**: 같은 대상의 설계 문서가 이미 세 곳(aidlc `component-methods.md` / ai `aidlc-docs` / backend `ai-backend-경계-계약-초안.md`)에 있고 서로 어긋나 있다. U2 FD를 규칙대로 풀세트로 새로 쓰면 **네 번째 정본**이 되어 즉시 드리프트한다 → Q1로 산출물 성격 자체를 사용자 결정에 부침(A 경계 접합 2종[권장] / B 풀세트 3종 / C U2 스킵).

**질문 Q1~Q8**: Q1 산출물 성격 · Q2 정본 우선순위(실장 vs 설계, 권장=분할) · Q3 SolverPort 4메서드↔ScheduleAgentPort 3메서드 · Q4 O-SOLVER 임계(권장=관측·트리거만) · Q5 잔여 드리프트 결정 위치 · Q6 FeasibilityValidator 명명(권장=HC1~HC4 승격) · Q7 Bedrock 교체 취급 범위 · Q8 U3 라이브 Figma 밴드 h 대조 여부.

**Context**: SCOPE.md 현행 범위(CONSTRUCTION 설계 문서 단계) 내. 사용자 지시로 U2→U3 순차 착수, **Code Generation은 범위 밖**(사용자 재확인: "실제 구현은 우리가 할거야 너는 문서 작업만"). 계획 승인 게이트 대기 중 — Step 6(산출물 생성) 미착수.

---

## CONSTRUCTION — U2 Functional Design · 답변 수집 + 산출물 생성 (Step 5~6)
**Timestamp**: 2026-08-07T04:35:00Z
**User Input**: "ㄱㄱ" (계획서 `[Answer]:` 태그에 직접 기입: **Q1=A · Q2=A · Q3=A · Q4=B · Q5=A · Q6=A · Q7=C/ai 폴더 확인 · Q8=A**)

**AI Response**: 답변 8건 수집 — 모호 응답("depends"·"maybe"·"섞어서" 등) 0건 → 명확화 질문 파일 미생성. **Q2는 AI 권장안(C 분할)이 아닌 A(실장 우선)를 사용자가 선택** — 그대로 적용하되, 양쪽 실장이 서로 다를 때는 문서가 결정한다는 2순위 규칙을 business-rules §0에 명시(Q5=A와 정합). 불변식(INV-1~4)은 개정 대상이 아님을 3순위 규칙으로 못박음(현재 양쪽 실측 위반 0).

**Q7=C 조사 실행**: `ai/` 전수 조사 결과 — `ai-adr.md` **AI-D06(2026-07-21)**: LLM 벤더 = **Anthropic API 직접(`api.anthropic.com`), AWS Bedrock 경유 아님**(회사 결제 승인이 Anthropic 직접 경로로 진행). 같은 ADR이 "'Bedrock 2차 솔버'도 Anthropic API 호출로 구현"이라 명시. ai 소스 전체 Bedrock/AgentCore 참조 **0건**, 2차 솔버 실장은 `c2/llm_solver.py`. → **인셉션 FR-SOLVER-02/03의 "Bedrock AgentCore 교체" 전제가 이미 폐기된 상태**임을 확인, BR-U2-16(벤더 중립 "엔진 교체"로 재정의)과 갭 G-U2-02로 기록.

**산출물 2종** (`aidlc-docs/construction/u2-itinerary-intelligence/functional-design/`):
1. **business-logic-model.md** — 소유 경계 지도(정본 계약 ↔ 실장 위치 ↔ 소유 팀) · 인용 정본 목록(재서술 금지) · **경계 2개**(포워드 ScheduleAgent · 리버스 POI read, 굵은 경계) · 포워드 요청/응답 필드표 · `validate`/`repair` 계약(N6 해소) · 호출 흐름 F-U2-1~3 · 폴백 체인 정본↔실장 대조 · **불변식 INV-1~4 집행 지점** · 미개통 2건(`recalculate`·`proposeSlotCandidates`) · 갭 **G-U2-01~09**
2. **business-rules.md** — 규칙 적용 순서 3단(실장 우선 → 양쪽 상이 시 문서 결정 → 불변식은 개정 불가) · **BR-U2-01~16** · O-SOLVER 관측 4지표·판정 트리거 · PBT 경계 신설 3종 · 미결 O-U2-1~3

**드리프트 종결 결정(핵심)**: BR-U2-01 Violation `{code, slotKey, detail}` 통일(P4 잔여) · BR-U2-02 **HC1~HC4를 정본 어휘로 승격**, 정본 5메서드 표기 폐기(Q6=A) · BR-U2-03 **SolveMode 4→3 매핑 확정**(`RULE_FALLBACK`→`DETERMINISTIC`+`isFallback`, 단사·역매핑 가능, 금지 조합 2건 명시 — N2 종결) · BR-U2-04 `slotKey="{date}#{poiId}"` 규약 + 영속 유실 해소 필요(N3) · BR-U2-05 `candidatesSummary` 신설(N4, 양쪽 미구현 확인) · BR-U2-06 FreshnessMeta는 경계=집계형 유지, AI per-source는 내부 관측용(N5) · BR-U2-07 **`FallbackMode` 5종 enum 폐기 → 3축 표현** · BR-U2-08 거리=표시 문자열, **경계에 duration 필드 추가 영구 금지**(INV-3) · BR-U2-09 explanations 시각·소요시간 언급 금지(INV-2/3 우회 차단).

**Q4=B 이행**: 임계 숫자를 문서에 넣지 않고 관측 지표 4종(composite 분포·강등 비율·수동 편집률·재생성 요청률)과 판정 회의 트리거(표본 도달 / 4주 / 상대 악화)만 확정. **`QualityScore`는 경계로 넘기지 않기로 결정** — 소비자가 아직 없어 backend에 해석 책임만 생김. AI 텔레메트리 + backend 행동 지표를 판정 회의에서 합침.

**Context**: SCOPE.md 현행 범위(CONSTRUCTION 설계 문서 단계). Code Generation 미수행(사용자: "실제 구현은 우리가 할거야 너는 문서 작업만"). **승인 게이트 대기** — 승인 시 U3 Functional Design Plan 착수(Q8=A: 라이브 Figma 밴드 h 대조 포함).

---

## CONSTRUCTION — U2 Functional Design 승인 + U3 착수 지시
**Timestamp**: 2026-08-07T04:50:00Z
**User Input**: "ㄱㄱ"

**AI Response**: U2 Functional Design **승인 완료**로 처리. 산출물 2종(`u2-itinerary-intelligence/functional-design/business-logic-model.md`·`business-rules.md`) 확정. 완료 메시지의 2선택지 중 "Continue to Next Stage — U3 AI Itinerary Generation · Functional Design"를 사용자가 선택 → U3 FD Step 1(유닛 컨텍스트 분석 + 기존 자산 조사 + Q8=A 라이브 Figma 대조) 착수.

**U2 잔여 스테이지 처리**: NFR Requirements·NFR Design은 **미실행 상태로 남긴다**(스킵 확정 아님). 사용자 지시가 "2 → 3 진행"이었고 U2 산출물이 경계 접합 문서라 NFR 스테이지의 소비자가 아직 없다. 필요 시 U3 이후 복귀 가능. Infrastructure Design은 U0·U1과 동형으로 배포 계획 부재 → 해당 없음.

**Context**: SCOPE.md 현행 범위 내. Code Generation 미수행(팀 직접 개발).

---

## CONSTRUCTION — U3 AI Itinerary Generation · Functional Design 착수 (Step 1~4)
**Timestamp**: 2026-08-07T05:20:00Z
**User Input**: (직전 "ㄱㄱ" 승인에 이은 U3 착수 — 별도 입력 없음)

**AI Response**: U3 FD **Step 1~4 수행**, Step 5(답변) 대기. 산출물 = `plans/u3-ai-itinerary-functional-design-plan.md`(기존 자산 + 라이브 대조 + 질문 Q1~Q9).

**Step 1 기존 자산**: backend `modules/itinerary-generation` 골격 실재 — 컨트롤러(`POST/GET/PUT /api/v1/trips/{tripId}/itinerary` + `POST /confirm`)·서비스 4(Generate·Edit·Confirm·Query)·도메인 3(`Itinerary`·`ScheduleAgentPort`·`MinimalItineraryFallback`)·테스트 8 + `V2.7`·`V2.8`. 도메인에 `ItineraryStatus{PLANNED,CONFIRMED}` 단방향 잠금(US-SCHED-12)·`VisitSlot`의 duration 필드 부재(INV-3 타입 강제)가 이미 반영됨. **frontend는 `(tabs)/itinerary.tsx` 빈 셸 = 화면 통째 미착수** → U3의 실질은 프런트 설계.

**Step 1c 라이브 Figma 밴드 h 대조 (Q8=A 이행)**: 캔버스 `1228:1045` 행 `y=10640` **프레임 33개 = 화면 코드 30 + h36 변형 4**(`h04·h05·h07·h09~h21·h23~h36`, 결번 `h01·h02·h03·h06·h08·h22`). **시각 확인 4장**(`h04`·`h11`·`h25`·`h36-default` 스크린샷), 나머지 26코드는 프레임 이름 수준 매핑 — 계획서에 그 한계를 명시.

**드리프트 D-U3-1~14**: (1) **h36 변경 이력·되돌리기가 스토리 0** — 실측 "바꾼 내용은 언제든 되돌릴 수 있어요" + 항목별 [되돌리기] (2) **U3·U4·U5·U9 4중 경계가 한 화면**(AI 재계획=U4 · 편집=U3 · 이력=U5 · `with-companions`=U9 후속게이트) (3) **동선 재정렬 제안 신규**(h25 "3.2km→2.4km, 이동 25% 감소" 배너 + h28 전·후) — U2가 미개통으로 남긴 `recalculate` 호출 (4) **시각 노출이 단계마다 다름** — h11 추천안은 시간대 라벨만(`오전·활동`), h25 완성은 구체 시각(`09:30`) (5) 추천 강도 `최소|균형|많이`가 요청 입력이 아니라 **결과 화면**에 (6) **"다른 후보 N"이 완전 AI 경로에도 존재** → U2가 `proposeSlotCandidates`를 CO_PLAN 소관으로 이연한 전제(O-U2-3)가 틀림 (7) 영업시간·`⚠︎ 월요일 휴관`이 화면에 있으나 경계 `VisitSlotDisplay`에 필드 없음 (8) 완성 일정 지도 5벌·시간표 2벌 신구 혼재 (9) 필수 방문지 화면(h05·h07)이 h밴드에 있으나 데이터는 U1 소유 (10) 같이 고르기 6화면 플로우 vs 스토리 한 줄 (11) h04 방식 카드에 스토리가 요구한 예상 소요·인터랙션 양 없음 (12·13) **정합 확인**: 2뷰 세그먼트·구간 거리만 표기(소요시간 0건, INV-3 준수)·[길찾기] 외부 위임·h35 후보 0건·h31 지도 폴백·h34 확정 읽기전용 (14) `h22map`이 밴드 d `d06-장소 상세` 자식에 잔존(이름 오탈).

**질문 Q1~Q9**: Q1 변경 이력 소관(권장 A: U3=편집 이력만, Plan-B=U4·아카이브=U5·동행자=1차 제외) · Q2 동선 재정렬 지위(권장 A: 1차 포함 + `recalculate` 개통) · Q3 시각 노출 단계 정책(권장 A: 라이브대로) · Q4 추천 강도 동작(권장 A: 재생성) · Q5 `proposeSlotCandidates` 개통(권장 A: 지금 개통 + U2 O-U2-3 사후 종결) · Q6 화면 다벌 정본(권장 A: U1 선례) · Q7 필수 방문지 화면 소관(권장 A: 데이터=U1·화면=U3) · Q8 공동편집 1차 노출(권장 A: 제외) · Q9 영업시간 데이터 경로(권장 A: backend 합성).

**Context**: SCOPE.md 현행 범위. Code Generation 미수행. **Q2·Q5 답변에 따라 U2 산출물(O-U2-3)의 사후 정정이 발생**할 수 있음 — 그 경우 U1 선례(2026-07-23 인셉션 사후 개정)와 같은 방식으로 처리.

---

## CONSTRUCTION — U3 Functional Design · 답변 수집 + 산출물 생성 (Step 5~6) + U2 사후 정정
**Timestamp**: 2026-08-07T06:05:00Z
**User Input**: "적음 ㄱㄱ" (계획서 `[Answer]:` 기입: **Q1=A · Q2=B · Q3=(D 줄에 "A") · Q4=A · Q5=A · Q6=A · Q7=A · Q8=A · Q9=A**)

**AI Response**: 답변 9건 수집. **Q3은 `D) Other` 줄 끝에 "A"가 적히고 `[Answer]:`는 비어 있어 A(라이브대로 확정)로 해석**했고 그 해석을 계획서·본 로그에 명시했다. **Q2는 AI 권장안(A: `recalculate` 개통)이 아닌 B(재생성으로 대체)를 사용자가 선택** — 그대로 적용. 그 외 모호 응답 0 → 명확화 파일 미생성.

**Q2=B와 Q4=A의 결합 결과를 설계로 흡수**: 둘 다 `generate` 재호출로 귀결되고 재생성은 사용자 편집분을 지운다 → **"재생성 계열" 공통 절차**(확인 대화 → 직전 상태 리비전 스냅숏 → 재호출 → 사용자 채택)를 신설(business-logic-model §1.1, BR-U3-17~22, INV-U3-08).

**Q2=B가 드러낸 갭 G-U3-1**: `h25` 배너가 재생성 **전에** "동선 정리하면 3.2km → 2.4km · 이동 25% 감소"를 단언하는데, 재생성 방식에서는 돌려보기 전 그 수치를 알 수 없다. → 배너 문구에서 수치 제거(예: "동선을 더 짧게 정리해볼까요?") + 수치는 결과 화면(h28)에서만, 개선 없으면 원본 유지 + "지금 동선이 이미 짧아요"(BR-U3-20). **디자인 협의 필요**로 표기.

**산출물 4종** (`aidlc-docs/construction/u3-ai-itinerary/functional-design/`):
1. **business-logic-model.md** — DEC-U3-1~9 · 재생성 계열 공통 절차 · 플로우 F-U3-1~7(방식분기·완전AI·같이고르기·직접·편집재검증·완성확정·숙소후등록) · U2 경계 소비 지점 4종 · **`proposeSlotCandidates` 계약 §3.1** · 폴백 표시 표 · 갭 G-U3-1~7
2. **domain-entities.md** — 기존 실장 3종(`Itinerary`·`ItineraryDay`·`VisitSlot`)을 정본으로 기록 + 신설 **`ItineraryRevision`**(편집 이력·되돌리기)·**`GenerationSession`**(day1 조기노출) · INV-U3-01~08 · 이벤트 4종 · 소유 경계표
3. **business-rules.md** — **BR-U3-01~34**(진입·표시·편집·재생성·슬롯교체·확정·이력) + PBT-U3-1~5 + 미결 O-U3-1~4
4. **frontend-components.md** — 라우트 15(빈 셸 `(tabs)/itinerary.tsx`를 채움) · 컴포넌트 33종 · 폼검증 · testID 제안값(구현 확정 시 소급 기록 규약 명시) · PBT

**핵심 규칙**: BR-U3-07 **시각 노출 단계 정책**(초안=시간대 라벨만·완성/확정=검증 시각, 고정 블록은 초안에서도 시각) · BR-U3-09 영업시간은 backend가 C7 합성 · BR-U3-29 **확정 후 재편집 = `CONFIRMED → PLANNED` 역전이 신설**(도메인이 현재 단방향이라 이 규칙이 만드는 변경임을 명시, G-U3-6 해소) · BR-U3-31 U3 리비전은 4종(BASELINE·GENERATE·EDIT·RESTORE)뿐이고 Plan-B는 U4 기록 · BR-U3-34 `with-companions`는 컬럼도 만들지 않음.

**U2 사후 정정 (Q5=A)**: 승인 완료된 U2 산출물 2종을 정정 — `business-logic-model.md` §7에서 `proposeSlotCandidates` 행을 취소선 처리하고 **§7.1 개통 확정** 신설(정정 사유 = U2 승인 시점 전제 "CO_PLAN 전용"이 라이브 실측으로 반증됨: `h11` "다른 후보 3" · `h12` 완전AI 슬롯 교체 화면), `business-rules.md` **O-U2-3 종결**(`recalculate`는 U4 유지 — U3가 DEC-U3-2로 부르지 않음). 결과: `ScheduleAgentPort`가 **4메서드**로 확정. 시그니처 정본은 U3 §3.1에 두고 U2는 참조만(중복 서술 금지). 스테이지 체크박스 변동 없음 — U1 정정 선례(2026-07-29·07-31·08-02·08-06)와 같은 성격.

**Context**: SCOPE.md 현행 범위. Code Generation 미수행. **승인 게이트 대기.**

---

## CONSTRUCTION — U3 Functional Design 승인 + NFR Requirements 착수 (Step 1~4)
**Timestamp**: 2026-08-07T06:40:00Z
**User Input**: "nfr이 뭐지" → (설명 후) "ㄱㄱ"

**AI Response**: (1) **NFR 개념 설명** — 기능 요구("무엇을 하는가") vs 비기능 요구("얼마나 잘 하는가"), U0·U1이 만든 4문서(`nfr-requirements`·`tech-stack-decisions`·`nfr-design-patterns`·`logical-components`)의 실물 예시(P-RES-U1-1 서킷 브레이커 격리 등) 제시. **U3 NFR의 실익을 솔직히 축소 평가**: 지연 예산·폴백·침묵 실패 금지 등 절반은 이미 U3 FD(BR-U3-*)에 들어갔고, 새로 나올 건 **재생성 비용 상한**·화면 성능 예산·오프라인 정책·관측 지표 정도 → "얇게, 신규 항목만" 권고.

(2) **U3 Functional Design 승인 처리** — 사용자가 "NFR 돌릴까? U4로 갈까?"에 "ㄱㄱ"로 답해 다음 스테이지 진입을 선택했으므로 **직전 스테이지(U3 FD) 승인으로 해석**했다. 산출물 4종 확정.

(3) **U3 NFR Requirements Step 1~4 수행**, Step 5 대기. 산출물 = `plans/u3-ai-itinerary-nfr-requirements-plan.md`.
- **Step 1 결과**: FD에 이미 확정된 NFR성 규칙 **7건**(BR-U3-03 지연 예산 · 04·05 day1 조기노출/취소 · 11 침묵 실패 금지 · 08 INV-3 · 16 저장 대기 · 12 비차단 검증 · 18·19 재생성 스냅숏)을 표로 식별하고 **재서술 금지** 대상으로 못박음. 상속 기반선(50 RPS·99.9%·재시도 없음·서킷 분리·stale-if-error·security-baseline Full·PBT blocking) 명시.
- **질문 Q1~Q6**(얇게 — 6문항): Q1 **재생성 비용 상한**(권장 A: 쿨다운+일일 회차 상한 — 이 스테이지를 도는 주된 이유) · Q2 화면 성능 예산(권장 A: 느슨한 목표치 + 가상화 도입 트리거) · Q3 관측 지표(권장 A: 수동 편집률·재생성 요청률 발행, **임계 없음** — BR-U2-15 승계) · Q4 오프라인 범위(권장 A: 확정 일정만 로컬 캐시) · Q5 리비전 보관 상한(권장 A: 최근 N개 + `BASELINE` 항상 보존) · Q6 기술 스택 델타(권장 A: 델타 없음, 구현 시 소급).

**Context**: SCOPE.md 현행 범위. Code Generation 미수행. NFR Design 스테이지는 이 단계 승인 후 필요 여부를 재판단(패턴 대부분 U0·U1 상속 예상).

---

## CONSTRUCTION — U3 NFR Requirements · 실장 확인 + 산출물 생성 (Step 5~6)
**Timestamp**: 2026-08-07T07:20:00Z
**User Input**: "ai랑 백엔드 확인해보고 그거를 우선시하고 나머지는 권장"

**AI Response**: Q1~Q6을 **실장 실측 → 실장 우선, 실장 근거 없는 항목만 권장안**으로 확정(U2 §0 규칙 1과 동형). 실측 대상: `ai/src/trippilot/{c1,c2,m7,domain}` · `backend/modules`·`app/src/main/resources/application.yml`·`build.gradle.kts` · `frontend/package.json`·`src/shared/map`.

**실측 결과**:
- **호출 상한 부재 확인** — ai에 rate-limit/throttle/quota 코드 0건(`budget`은 여행 예산 `BudgetLevel`이지 호출 비용 아님), backend에 bucket4j·resilience4j 등 rate-limit 의존 0건. → COST 요구를 **신규 도입**하되, 임의 쿨다운 상수(초안 10초) 대신 **진행 중 세션 재요청 거부**로 유도(생성 예산 day1 5s/전체 20s가 자연 쿨다운). 일일 회차 상한은 설정값 + "근거 없는 초기값(20회/일)" 라벨(BR-U2-15 승계).
- **AI 관측 4종 이미 실재** — `LlmCallRecord`(input/output **토큰**·latency·success·model_id·feature) · `FallbackEvent`(from_mode→to_mode·reason) · `GateDropEvent` · `SolverRunRecord`(solve_mode·elapsed_ms·violations_found·repaired). **토큰이 기록되므로 비용 관측은 AI 쪽이 이미 가능** → OBS는 승계, U3 신규는 **수동 편집률·재생성 요청률 2종**만. backend actuator는 `health,info`만 노출 중.
- **C1/C2 설정 승계** — `max_tokens=1024`·`temperature=0.0`·`timeout_sec=2.5` / `or_tools_limit_ms=3000`·`or_tools_min_ms=500`·`llm_stage_timeout_ms=2500`·`buffer_min=15`. U3가 별도 상한을 만들지 않음.
- **frontend 실측** — `@gorhom/bottom-sheet`·`gesture-handler`·`reanimated`·`netinfo`·`@sentry/react-native` **있음** / `@shopify/flash-list`·`async-storage` **없음** / 지도는 `react-native-maps`가 아니라 **`@/shared/map/KakaoMapView`(react-native-webview + 카카오 JS SDK)**.

**초안 권장안 1건 철회**: Q6 "델타 없음" → **델타 3건 실재**로 정정. 근거 = `KakaoMapViewProps`가 `{center, onMapMessage}`뿐이고 메시지도 `PIN_DROP`·`GEOCODE_OK`·`GEOCODE_FAIL` 3종이며, **`source.html`이 마운트 시점 center로 한 번만 조립돼 이후 center 변경에 반응하지 않는다**(TRIP-199 5-a 주석) → 밴드 h가 요구하는 **다중 번호 핀·동선 폴리라인·지도 스크러버(h32)·핀 탭** 미지원. 결정 = **라이브러리 교체가 아니라 기존 컴포넌트 확장**(벤더 교체는 U1 숙소 등록 `e05` 핀 지정까지 흔든다).

**산출물 2종** (`u3-ai-itinerary/nfr-requirements/`):
1. **nfr-requirements.md** — COST-U3-01~05 · PERF-U3-01~05 · OBS-U3-01~05 · DATA-U3-01~04 · OFFLINE-U3-01~04 · SEC-U3-01~03 + 재평가 트리거 3. 각 요구에 **"실장 / 근거" 열**을 두어 실측분과 권장분을 구분.
2. **tech-stack-decisions.md** — 상속 7행 + **U3 델타 3**(① KakaoMapView 확장 ② 영속 저장소 조건부 추가 ③ 가상화 리스트 미도입·트리거만) + **backend 델타 5**(rate-limit 의존 미도입 — `GenerationSession` 상태로 구현 / `visit_slot.placement_reason` 컬럼 / `ItineraryStatus` 역전이 / `itinerary_revision` 테이블 신설 / actuator 노출 범위) + **AI 델타 없음**.

**FD 중복 회피**: 지연 예산·조기 노출·침묵 실패 금지·INV-3·저장 대기·비차단 검증·재생성 스냅숏 **7건은 NFR 문서에 재서술하지 않고 BR-U3-* 참조로 처리**(계획서 Step 1 표).

**Context**: SCOPE.md 현행 범위. Code Generation 미수행. **승인 게이트 대기.** NFR Design 필요 여부는 승인 후 재판단(패턴 대부분 U0·U1 상속 예상).

---

## CONSTRUCTION — U3 NFR Requirements 승인 + NFR Design SKIP + U3 설계 단계 종료
**Timestamp**: 2026-08-07T07:45:00Z
**User Input**: "ㄱㄱ nfr design은 스킵으로 기록하고 u3 종료"

**AI Response**: (1) **U3 NFR Requirements 승인 완료** — 산출물 2종(`nfr-requirements.md`·`tech-stack-decisions.md`) 확정.

(2) **NFR Design — SKIPPED (사용자 명시 지시)**. 사유 = **신규 정보가 거의 없다.** ① 복원력·성능 패턴 대부분이 U0·U1에서 이미 확정돼 그대로 상속된다(서킷 브레이커 벤더별 분리 · 재시도 없음 · stale-if-error · 침묵 실패 금지 사슬 · 응답 예산 2계층). ② U3 고유 패턴(재생성 억제 = 진행 중 세션 거부 + UI 흡수 + 일일 회차 설정값, 지도 컴포넌트 확장, 리비전 정리 정책)은 **이미 `nfr-requirements.md`(COST-U3-01~05·DATA-U3-01~04)와 `tech-stack-decisions.md`(델타 1~3, backend 델타 5)에 배치까지 기술**됐다. ③ 논리 컴포넌트 배치도 U0·U1의 것을 그대로 쓰며 U3 신규는 `itinerary_revision` 테이블 하나뿐이라 별도 문서가 필요 없다. **재개 조건** = 재생성 억제·지도 확장이 실측에서 부족하다고 판명되거나 새 횡단 패턴이 필요해질 때.

(3) **Infrastructure Design — 해당 없음.** U0(2026-07-17)·U1(2026-07-23)과 동형 — 배포/클라우드 계획 부재로 결정의 근거·검증 수단이 없다(규칙상 CONDITIONAL "no infrastructure changes"). 재개 조건 = 배포/클라우드 진입 결정 시 별도 지시.

(4) **✅ U3 AI Itinerary Generation 설계 단계 종료 (2026-08-07)** — 산출물 = functional-design **4** + nfr-requirements **2** = **6종**.

**U3에서 남긴 후속 항목**(설계 밖 · 팀 개발/협의 대상):
- **디자인 협의**: G-U3-1(h25 동선 정리 배너가 재생성 전에 "3.2km→2.4km" 수치를 단언 — 산출 불가라 문구에서 수치 제거 필요)
- **backend 마이그레이션 3건**: `visit_slot.placement_reason`(explanations 영속 · U2 O-U2-2 승계) · `ItineraryStatus` 역전이 허용(BR-U3-29, 현재 PLANNED→CONFIRMED 단방향) · `itinerary_revision` 테이블 신설
- **frontend 델타 1건(필수)**: `KakaoMapView` 확장 — `markers[]`·`polyline[]`·center 갱신·`MARKER_TAP`
- **미결**: O-U3-1~4(배너 문구 · 리비전 보관·U5 이관 · explanations 영속 · h 밴드 결번 확인) · O-U2-3 잔여(`recalculate`는 U4) · O-SOLVER(운영)

**현재 CONSTRUCTION 진척**: U0 종료(8종) · U1 종료(8종) · **U2 종료(2종 — FD만, NFR은 소비자 없어 미실행)** · **U3 종료(6종)**. U4~U9는 사용자 지시 대기.

**Context**: SCOPE.md 현행 범위(설계 문서 단계) 준수. Code Generation·Build&Test는 전 유닛 범위 밖 — 코드는 팀이 각 패키지에서 직접 개발.

---

## Post-Design Correction — U1 frontend-components.md·business-rules.md 거점 배정 화면 5건 (TRIP-225 [기록] 반영)
**Timestamp**: 2026-08-07T20:55:00Z
**User Input**: TRIP-225 사이클 [설계] 3-a 맹점 훑기에서 사용자가 정본 반영 후보 4건을 전부 선택했다(승계 2건 포함 — 원 출처는 TRIP-224 사이클에서 선택됐으나 그 사이클의 [기록]이 "audit.md는 건드리지 마라"는 상충 지시로 미이행됐던 것). 5번째 항목(온램프 배너·차단 규칙 모순)은 게이트② 대화 중 사용자가 직접 발견해 추가됐다 — 승인 발화 "ㄱㄱ 그래도 중간에 숙소 없는 경우도 넘겨주고 나중에 숙소 추천해주는게 좋은거 같은데"(앞의 "ㄱㄱ"가 게이트② 승인, 뒷문장이 이 모순 관측 및 요구사항 변경 제안 — 이번 사이클 범위 밖이라 규칙 자체는 고치지 않고 관측만 기록).

**AI Response**: 승인 완료된 `u1-accommodation-trip/functional-design/frontend-components.md`·`business-rules.md`의 **드리프트 정정 + 구현 결정 소급 기록 + 정본 모순 관측**. 새 스토리·새 컴포넌트 계약(엔드포인트) 신설 0건 → 스테이지 진행 아님, `aidlc-state.md` 체크박스 변동 없음(2026-07-29T05:10:00Z A1 · 2026-07-29T22:35:00Z D1·D2 · 2026-07-31T11:45:00Z SEC-U1-05 · 2026-08-02T03:00:00Z·04:30:00Z · 2026-08-02T23:10:00Z · 2026-08-06T14:20:00Z 정정과 같은 성격의 여덟 번째 후속).

(1) **frontend-components.md §4 `BaseSectionList` — 구분자를 en dash로 정정**. `"1~2박 6/10-6/12"` → `"1–2박 6/10–6/12"`. 라이브 노드(`1861:2317`·`1861:2318`) 실측이 en dash를 쓴다.

(2) **frontend-components.md §4 — g02 empty 변형(`1708:1183`) 실제 구성 기록**. 이 문서는 g02의 default(`1707:1183`)만 기술했고 empty는 공백이었다. 제목 `숙소 없이 시작해도 돼요` + 주 CTA `숙소 없이 계속` + 보조 CTA `숙소 둘러보기`(→ `/stays`) 2버튼 구성.

(3) **frontend-components.md §4 — g02 거점 배정 화면 구현 결정 5건 소급 기록**(TRIP-209 선례 방식). 배정 날짜 출처(`SavedStay.checkIn`/`checkOut` 그대로, 별도 날짜 선택 UI 없음) · 계약 공백 플레이스홀더(사진·지역·거리·가격 4종, 회색 바) · 얼굴 5변형 중 loading·error·blocked 3종 신규 제작 · `변경 >` = DELETE로 해제만(시트 없음) · 미해결 날짜 앞 2개 고정 + `외 N일` 접기(막을지 판정 권위는 `blocked` 필드 하나). 전 5건에 "요구사항 근거가 아니라 구현 결정 — 다음 사이클이 요구사항 근거로 인용 금지" 라벨을 달았다.

(4) **frontend-components.md §7 — `resolveCoverage` 취소선 행 삭제**. TRIP-84 정정(2026-08-02T04:30:00Z)에서 취소선만 그어 뒀던 클라이언트 PBT 항목을 행째로 지웠다 — 남겨 두면 훑어보는 사람이 "클라이언트가 커버리지를 판정한다"로 오독할 위험이 있었다.

(5) **business-rules.md BR-U1-28 — 박 번호 산식 명문화**. `firstNight = (dateFrom − trip.startDate) + 1`, `lastNight = firstNight + nights − 1`. 누적 카운터가 아니라 **여행 시작일 고정 기준**이라 배정 사이에 빈 날짜가 있으면 번호가 건너뛴다.

(6) **⭐ business-rules.md — 정본 모순 관측 신설(규칙은 변경하지 않음)**. BR-U1-40(온램프 배너 — "일정을 다 짜면 동선 기준으로 딱 맞는 숙소를 추천")과 BR-U1-47(거점 0 → 차단 대상 아님) + BR-U1-44(부분 채움 → 차단)를 겹치면 **"3박 중 0박 잡은 사용자는 통과하고 3박 중 2박 잡은 사용자는 막힌다"** — 더 많이 진행한 사용자가 더 막힌다. 배너 약속과 차단 규칙이 방향이 반대다. **요구사항 변경이라 이 사이클에서 규칙 자체는 고치지 않았다** — BR-U1-40·44·47 세 행 모두 원문 그대로다. 후속 검토가 필요하다는 관측 문단만 BR-U1-47 뒤에 추가했다.

**미반영으로 남긴 것**: 없음 — 3-a 선택 4건 + 게이트 추가 1건, 총 5건 전부 반영했다.

**Context**: SCOPE.md 현행 범위(CONSTRUCTION 설계 문서 단계) 내 **기존 승인 산출물의 사후 정정**. 정정 실행 주체: TRIP-225 사이클 [기록](scribe) 단계. 실측 근거는 `_workspace/20260807-trip225-base-screen/01b_ouroboros_seed.md`(D1·D2·D3·D6·D16·D16-b)·`00_gates.md`(게이트② 절)·`03_implementer_notes.md`. 이 항목이 손댄 `aidlc/` 파일은 `construction/u1-accommodation-trip/functional-design/{frontend-components.md,business-rules.md}`와 이 `audit.md` append뿐이다 — 같은 시점 다른 세션이 진행 중인 U2·U3 관련 파일(`aidlc-state.md`·`construction/u2-itinerary-intelligence/`·`construction/u3-ai-itinerary/`·`construction/plans/u2-*.md`·`construction/plans/u3-*.md`)은 손대지 않았다.

---

## Post-Design Correction — U1 frontend-components.md·business-rules.md 거점 지정 전제 게이트 4건 (TRIP-226 [기록] 반영)
**Timestamp**: 2026-08-08T01:15:00Z
**User Input**: TRIP-226 사이클 [설계] 3-a 맹점 훑기에서 정본 반영 후보 A~E 5건을 제시했고, 사용자가 **A·B·C·D 4건을 선택**했다(게이트①-1 승인 시점엔 미수령이라 게이트② 재제시에서 수령 — `00_gates.md` "🔜 정본 반영 선택 — 수령 완료 (2026-08-07)"). E(e05 편집 모드 부재)는 지라 티켓(TRIP-192) 소관이라 이번 선택지에서 제외 — 개발로그 관측 + 후속 티켓 후보로만 남긴다.

**AI Response**: 승인 완료된 `u1-accommodation-trip/functional-design/frontend-components.md`·`business-rules.md`의 **testID 드리프트 정정 + 경계 명문화 + 계약 공백 관측 2건**. 새 스토리·새 컴포넌트 계약(엔드포인트) 신설 0건 → 스테이지 진행 아님, `aidlc-state.md` 체크박스 변동 없음(TRIP-225 [기록]의 여덟 번째 후속에 이은 아홉 번째).

(1) **frontend-components.md §6 — testID 드리프트 정정(A)**. 지라 티켓 문면의 `trip-base-blocked-{id}`는 실제로 쓰이지 않는다. 차단된 배정 후보 카드의 실물 testID는 `trip-base-assign-blocked-{id}`이고, `trip-base-blocked-*` 접두는 미해결 날짜 커버리지 안내행 3종(`-notice`·`-days`·`-more`)이 이미 점유한 이름 공간이다.

(2) **business-rules.md BR-U1-27 — 기간 경계 등호 포함 명문화(B)**. `dateFrom >= trip.startDate && dateTo <= trip.endDate`이면 기간 안(경계일 포함), 아니면 벗어남. ⚠️ 서버 쪽 정본(`backend/docs/design/openapi.yaml`)에는 이 경계가 명시돼 있지 않아 **미확인**임을 함께 적었다 — 클라이언트 판정만 확정, BE 교차 확인 필요.

(3) **business-rules.md BR-U1-56 뒤 — `error.code`·`fields[].reason` enum 부재 관측 신설(C, 규칙은 변경하지 않음, BE 티켓 후보)**. 계약에 오류 사유를 열거하는 스키마가 없어 클라이언트가 400/422/500을 상태 코드만으로 선판정한다(BR-U1-55 침묵 실패 금지와 긴장). enum을 발명하지 않고 관측만 기록했다.

(4) **business-rules.md BR-U1-56 뒤 — `SavedStay` 신선도 필드 부재 관측 신설(D, 규칙은 변경하지 않음, BE 티켓 후보)**. 계약(`GetSavedStaysResponse`)에 최신성 확인 근거 필드가 없어 US-TRIP-04의 "최신 정보 확인 불가" 예외 AC를 클라이언트가 원리적으로 구현할 수 없다. US-TRIP-04를 채우는 마지막 칸(TRIP-178·224·225·226)이 끝나도 이 예외 AC는 **영구 미충족**으로 남는다 — 스토리 종료 판정 시 명시할 것.

**미반영으로 남긴 것**: E(e05 편집 모드 부재) — 3-a에서 선택되지 않음, 지라 TRIP-192 후속 티켓 소관.

**Context**: SCOPE.md 현행 범위(CONSTRUCTION 설계 문서 단계) 내 **기존 승인 산출물의 사후 정정**. 정정 실행 주체: TRIP-226 사이클 [기록](scribe) 단계. 실측 근거는 `_workspace/20260807-trip226-base-gate/00_gates.md`(게이트①-1 §미수령·게이트② §정본 반영 선택)·`frontend/src/features/trip/ui/TripWizardStep2Screen.tsx:352,477,486,500`·`frontend/src/features/trip/model/baseGate.ts`(`isOutsideTripPeriod`). 이 항목이 손댄 `aidlc/` 파일은 `construction/u1-accommodation-trip/functional-design/{frontend-components.md,business-rules.md}`와 이 `audit.md` append뿐이다.

---

## Post-Design Correction — U3 functional-design 경로 표기 드리프트 2건 + VisitSlotDisplay 필드셋 불일치 재확인 (TRIP-294 [기록] 반영)
**Timestamp**: 2026-08-08T04:20:00Z
**User Input**: TRIP-294 사이클(`20260808-trip294-itinerary-codegen`) [설계] 3-a 맹점 훑기에서 정본 반영 후보 A~E 5건이 제시됐고, 사용자가 **B·C·D 3건을 선택**했다(A는 계약 공백이라 문서 정정이 아니라 백엔드 티켓 후보로 상신 대상으로 분류돼 선택지에서 제외, E는 이번 칸에 화면 표면이 0이라 라이브 Figma를 열지 않아 드리프트 여부를 판정하지 않음). D는 `frontend/docs/structure.md` 소관이라 별도로 반영했다 — 이 audit 항목은 아이디엘씨 소관인 B·C 2건만 다룬다.

**AI Response**: 승인 완료된 `u3-ai-itinerary` 설계 문서군의 **경로 표기 오류 정정(B) + 기존 미해소 항목 재확인(C, 문서 미수정)**. 새 스토리·새 컴포넌트 계약 신설 0건 → 스테이지 진행 아님, `aidlc-state.md` 체크박스 변동 없음.

(1) **`construction/plans/u3-ai-itinerary-functional-design-plan.md` — Step 1 표의 `POST /api/v1/trips/{tripId}/itinerary` → `POST /trips/{tripId}/itinerary`로 정정(B)**. `backend/docs/design/openapi.yaml`의 `servers` 레벨에 이미 `/api/v1` 프리픽스가 있고(`- url: https://api.trippilot.app/api/v1`), 개별 `paths`(`/trips/{tripId}/itinerary`, L649)에는 그 프리픽스가 없다 — 실측 확인. 근거: `backend/docs/design/openapi.yaml:10,649` 실측.

(2) **`construction/u3-ai-itinerary/functional-design/frontend-components.md` §2 `GenerationGate` — `GET /trips/{id}` → `GET /trips/{tripId}`로 정정(B)**. openapi 경로 파라미터 실제 이름과 대조. 근거: `backend/docs/design/openapi.yaml:650` 실측(`{ name: tripId, in: path, ... }`).

(3) **같은 문서 §6 `ConfirmCta` — `POST /confirm` → `POST /trips/{tripId}/itinerary/confirm`으로 정정(B)**. 축약 표기가 실제 라우트 전체 경로와 달라 혼동 소지. 근거: `backend/docs/design/openapi.yaml:677` 실측.

(4) **`VisitSlotDisplay` 필드셋 불일치 정정(C)**. plan 문서 **D-U3-7** 행의 스키마 스니펫(`VisitSlotDisplay{poiId, startAt, endAt, endsNextDay, distanceRange?, isFixed}`)이 `openapi.yaml`의 실제 슬롯 스키마와 **양방향으로 어긋났다** — 문서엔 있고 계약엔 없는 필드(`distanceRange`), 계약엔 있고 문서엔 없는 필드(`hasViolation`)가 각각 하나씩. 실제 REST 슬롯 6필드(`poiId·startAt·endAt·isFixed·endsNextDay·hasViolation`, 전부 required)로 **스니펫을 교체**하고 정정 사실·근거를 인라인 병기했다. **D-U3-7의 관측 자체(영업시간·휴관 경고 결여)는 여전히 미해소**이며, `hasViolation`이 불리언 하나뿐이라 위반 *사유*를 못 나른다는 점을 함께 명시했다. 근거: `backend/docs/design/openapi.yaml` 슬롯 스키마 ↔ `frontend/src/shared/api/generated/schemas/itineraryDaysItemSlotsItem.ts`(TRIP-294 재생성분) 대조 실측.

  ⚠️ **경위 기록**: 이 항목은 [기록](scribe)이 *"D-U3-7에 이미 나타나 있으므로 별도 정정 없이 재확인만"*으로 판단해 **한 차례 미반영으로 남겼던 것**을, 사이클 종료 대조(8단계)에서 오케스트레이터가 3-a 사용자 선택 목록과 대조해 발견하고 직접 반영했다. 사용자는 3-a에서 C를 **정정 대상으로 명시 선택**했으므로 재확인 격하는 선택 범위를 좁힌 것이었다.

**미반영으로 남긴 것**: A(`GenerationMode` 3종 vs 2종 계약 공백) — 문서 정정 대상이 아니라 백엔드 티켓 후보로 개발로그에만 상신, aidlc 파일 미변경. E(밴드 h 결번 리포 밴드 맵 기록 여부) — 이번 칸 화면 표면 0으로 판정 보류, aidlc·리포 밴드 맵 모두 미변경.

**Context**: SCOPE.md 현행 범위(CONSTRUCTION 설계 문서 단계) 내 **기존 승인 산출물의 사후 정정**. 정정 실행 주체: TRIP-294 사이클(`20260808-trip294-itinerary-codegen`) [기록](scribe) 단계. 실측 근거는 `_workspace/20260808-trip294-itinerary-codegen/01_spec-analyst_brief.md`(3-a 정본 반영 후보 A~E)·`backend/docs/design/openapi.yaml:10,649,650,677`. 이 항목이 손댄 `aidlc/` 파일은 `construction/plans/u3-ai-itinerary-functional-design-plan.md`·`construction/u3-ai-itinerary/functional-design/frontend-components.md`와 이 `audit.md` append뿐이다.

---

## CONSTRUCTION — U4 In-trip & Plan-B / Functional Design (Step 1~4: 컨텍스트·자산조사·밴드 i 대조·계획 수립)
**Timestamp**: 2026-08-08T07:45:00Z
**User Input**: "aidlc construction u4 진행하자 구현은 각자 할거고 문서 작성만 해서 진행"
**AI Response**: SCOPE.md 경계 확인(CONSTRUCTION 설계 문서 단계만, Code Generation·Build&Test 제외) 후 U4 Functional Design 착수. Step 1 유닛 컨텍스트(unit-of-work U4 = C9·C10·C11 / 스토리 16개 = US-PLANB-01~13 + US-ONTRIP-01~03) · Step 1b 기존 자산 조사 · Step 1c 라이브 Figma 밴드 `i` 대조 · Step 2~4 계획서 작성 완료. 계획서 = `aidlc-docs/construction/plans/u4-in-trip-planb-functional-design-plan.md`. 질문 **Q1~Q8** 상신, 답변 대기(승인 게이트 전 단계).

**Step 1b 실측 요지**: backend 모듈 10개 중 **planb-detection·itinerary-recalculation·weather-context 3모듈 전무**(U4 백엔드 통째 신규) / `change-log` 모듈 + `V2.11__change_log.sql` **선재** — `ChangeSource.PLAN_B`·`reason`·append-only(앱 롤 UPDATE/DELETE 회수)까지 이미 있어 US-PLANB-09 절반 구현됨 / `ScheduleAgentPort`는 **3메서드**(generate·validate·repair) — `recalculate` 없음(U2가 U4로 남긴 미개통 계약)이고 **U3가 확정한 `proposeSlotCandidates`도 코드 미반영**(설계-코드 드리프트, U4 Q1=A면 개통 시점이 U4로 앞당겨짐) / `ai/ports` 9종에 **날씨 포트 없음** / frontend **밴드 i 라우트 0**.

**Step 1c 밴드 i 관측**: 캔버스 `1228:1045` 행 `y=12485`, 프레임 **22개** = 화면 코드 19 + `i01` 변형 2 + 이름 없는 프레임 1(`2335:2231`, x=358). 결번 **i06·i11·i14**. 밴드 전체가 `· 통합` 접미사(상태 변형 합본 세대). 스크린샷 8장 시각 확인(`i01-변수감지`·`i03`·`i04`·`i09`·`i10`·`i13`·`i16`·`i18`). 드리프트 **D-U4-1~10** 도출 — 핵심 3건: (1) **대안 2~3개가 라이브에 없음**(i13은 단일 재계획안 + 슬롯별 `다른 후보 4`) (2) **재계획 지시 입력이 4단**(범위 3 + 사유 6 + 방향 지시어 7 + 자유 텍스트) — 스토리는 사유 1단 (3) **여행 중 화면에 U5(사진·메모·기록 탭) 혼재**. 정합 확인분(D-U4-8): i16 대안 0건 3옵션 · i18 영향 지표 3종 + 전후 지도 · 폴백 3화면 · **INV-3 준수(소요시간 표기 0건, 거리만)**.

**Context**: CONSTRUCTION / U4 In-trip & Plan-B / Functional Design Step 1~4 완료, Step 5(답변 수집) 대기. 이번 항목이 손댄 `aidlc/` 파일은 `construction/plans/u4-in-trip-planb-functional-design-plan.md` 신규 생성과 이 `audit.md` append뿐이다. `aidlc-state.md`는 스테이지 완료 시점에 갱신한다.

---

## CONSTRUCTION — U4 In-trip & Plan-B / Functional Design (Step 5~7: 답변 수집·디자인 반영 재관측·산출물 4종)
**Timestamp**: 2026-08-09T08:30:00Z
**User Input (1)**: "작성함 여행중 trippilot를 계속 띄우는 방식은 여기서 생각해봐야할거 같고 이렇게 갈 때 필요한 피그마 수정사항 말해주면 수정함"
**User Input (2)**: "피그마 수정함 확인 ㄱ"
**User Input (3, 계획서 `[Answer]:` 기입)**: Q1="A" · Q2="A" · Q3="항상 떠있게 하는 꼼수가 없나요?" · Q4="이것도 꼼수가 없나" · Q5="C" · Q6="AI는 ai 폴더를 전적으로 따른다 지금 develop 브랜치에 최신 상황을 따르는걸로" · Q7="A 실제 기능은 없는 버튼까지만" · Q8="C"
**User Input (4, 재확인 응답)**: Q3·Q4 통합 질문에 **"지오펜스 조합 (추천)"** 선택

**AI Response**: Q3·Q4는 답이 아니라 되물음이라 **기술 선택지를 실측 기반으로 제시**했다(`frontend/package.json`에 `expo-location ~19.0.8` 선재 확인 → 신규 의존성 0으로 가능한 것부터). 제시안: ① 지오펜싱 `startGeofencingAsync`(앱이 꺼져 있어도 OS가 깨움, 배터리 저부하, '항상 허용' 필요) ② Android 포그라운드 서비스 ③ iOS `UIBackgroundModes:location` ④ Live Activity(표시 전용) / **불가 판정**: `expo-background-fetch`는 iOS가 주기를 정해 트리거 감지에 부적합. 사용자가 **① 지오펜스 조합** 선택 → **DEC-U4-6·7**(클라 신호 수집 + 서버 판정, 연속 추적 없음).

**디자인 반영 사이클**: 답변에서 파생되는 피그마 수정 15건을 상신 → 사용자가 수정 → **밴드 `i` 재관측(27프레임, 스크린샷 10장)으로 전건 확인**. 수정 A 7건(`i09` 교통 삭제 · `i10` 내일까지 삭제 · `i03` 걸음 수 삭제 · `i01`·`i04` 재추정 시각 → 계획 시각 · `i13` 추천 강도 삭제 + 이동 수단 병기 · `i05` 혼잡도 삭제) · B 3변형 신설(`i01 기록 없음` · `i01 변수 감지(이동 지연)`·`(영업·휴무)` · `i10 범위 밖`) · **C 신규 화면 `i14 슬롯 후보 교체 (Plan-B)`** · D 무명 프레임 명명(`i01 되돌리기 토스트`). Q3·Q4 확정 후 추가 요청 4건(`c08` 항상-허용 변형 · `i03` 각주 · `l02` 민감도 행 · `l06` 상태 행)은 디자인 진행 중이며 설계는 이를 전제로 작성.

**Q6 실측 결과 — `recalculate` 신설 철회**: `ai/`(develop)에 `domain/trigger.py`의 **`TriggerKind{WEATHER,CLOSURE,DELAY,MANUAL}`·`ReplanScope{FULL_DAY,PARTIAL_SLOTS,NONE}`·`TriggerEvalResult`가 이미 실재**하고, `c2/facade.py`의 **`regenerate(problem, locked_slots, deadline_ms)`가 Plan-B warm-start 그 자체**임을 확인(locked를 `FixedBlock`으로 승격해 HC3 보호, `validate`가 보존 강제 → 위반 해 반환 불가). 따라서 새 솔버 개념을 만들지 않고 백엔드 포트를 ai 실장에 맞춰 **`replan`으로 개통**(DEC-U4-5). 함께 확인된 것: `ai/main.py`는 **`/health`만 응답하는 스텁**으로 `POST /ai/*` HTTP 표면이 아직 없음(**G-U4-3** — 개발 착수 전 선행 티켓 필요).

**산출물 4종** (`aidlc-docs/construction/u4-in-trip-planb/functional-design/`): `business-logic-model.md`(DEC-U4-1~11 · 트리거 판정 파이프라인 · 재계획 플로우 · `replan` 계약과 ai 매핑표 · 슬롯 후보 U3 계약 재사용 · 기준점 사다리 4단 · 폴백 표 · G-U4-1~8) · `domain-entities.md`(신설 6종 + 기존 재사용 5종 + INV-U4-01~09 + 이벤트 3 + 소유 경계표) · `business-rules.md`(**BR-U4-01~46** + PBT-U4-1~5 + O-U4-1~5) · `frontend-components.md`(라우트 12 · 컴포넌트 30여 · testID · PBT-U4-F1~F3).

**U2 사후 정정 2건**: `u2-itinerary-intelligence/functional-design/business-logic-model.md` §7 표의 `recalculate` 행을 **종결**로 바꾸고 **§7.2 신설**(정정 사유·`replan` 시그니처·이름 드리프트 G-U4-4 기록, `ScheduleAgentPort` **5메서드**) · 같은 유닛 `business-rules.md` O-U2-3 행의 "`recalculate` → U4 유지" 문구를 **종결**로 갱신. 새 스토리·새 컴포넌트 신설 0 → U2 스테이지 체크박스 변동 없음.

**Context**: CONSTRUCTION / U4 In-trip & Plan-B / Functional Design Step 5~7 완료, Step 8(승인 게이트) 대기. 이번 항목이 손댄 `aidlc/` 파일 = `construction/u4-in-trip-planb/functional-design/` 4종 신규 · `construction/plans/u4-in-trip-planb-functional-design-plan.md` 갱신 · `construction/u2-itinerary-intelligence/functional-design/{business-logic-model.md,business-rules.md}` 사후 정정 · 이 `audit.md` append. `aidlc-state.md`는 승인 후 갱신한다.

---

## Post-Design Correction — U3·U4 `frontend-components.md` 실제 층 배치 기준 재작성
**Timestamp**: 2026-08-09T09:30:00Z
**User Input**: "프론트컴포넌트 지금 frontend 폴더 아키텍처에 맞게 다시 u3도 같이 해줘"
**AI Response**: `frontend/` 실측 결과 **문서가 전제한 배치와 리포의 실제 배치가 어긋나 있었다.** `frontend/README.md`가 적은 feature 내부 관례(`screens/ components/ containers/ hooks/ store/ model/ lib/`)와 달리 실제는 **FSD 층**(`src/app` 얇은 라우트 → `src/pages/<slice>/ui/*Page.tsx` + 배럴 → `src/features/<d>/{model,ui}` → `src/shared`)이고, `containers/`는 TRIP-173에서 `pages/` 층으로 이주해 사라졌다(`frontend/docs/structure.md` 실측). 초판 두 문서는 라우트 표 + 평면 컴포넌트 표로만 적혀 있어 **어느 층에 무엇을 두는지가 없었다** — 그대로 개발에 들어가면 배치가 각자 달라진다.

**U3 `frontend-components.md` 재작성** (승인 완료 산출물의 사후 정정): §0 층 배치 규약(실재 선례에서 유도 — 라우트 5~9줄·배럴만 import·판정은 페이지에서 1회·구조 가드) · **§0.1 이미 구현된 것**(TRIP-295 `timeBandLabel.ts`·`slotKey.ts` / TRIP-296 `mustVisitList.ts`·`mustVisitTimeForm.ts`·`MustVisitPickerScreen.tsx`·`MustVisitTimeScreen.tsx`·`ItineraryGlyphs.tsx`·`pages/itinerary-mustvisit/` 3파일·라우트 2파일·`shared/api/isAlreadyRegistered.ts`·`__tests__/itineraryMustVisitStructure.test.ts` — 전부 ✅ 표기) · §1 라우트 15 · §2 pages 슬라이스 11 · §3 `features/itinerary/model` 파일 17(순수 9·훅 7·스토어 1) · §4 `features/itinerary/ui` 파일 18 · §5 shared 변경 3 · §6 구조 가드 5 · §8 testID(초판 유지) · §9 PBT를 **대상 파일에 결속**. 초판의 컴포넌트 책임·BR 참조·갭 반영은 전부 보존하고 **배치만 실재 관례로 옮겼다**.

**U4 `frontend-components.md` 재작성**(미승인 산출물, 같은 기준): **feature 2개로 분할** — `features/execution`(에픽 G, i01~i05·i08) · `features/planb`(에픽 F, i09·i10·i12~i22). features 간 직접 import 금지 규칙상 `i01`(execution) → `i10`(planb) 이동은 **라우팅**, 공유물은 `shared/`로 승격. pages 슬라이스 10 · `execution/model` 10 · `execution/ui` 10 · `planb/model` 13 · `planb/ui` 13 · **shared 승격 6건**(`KakaoMapView` 다중핀·폴리라인·점선 확장 / `shared/location`에 지오펜스 + '항상 허용' 승격 경로 — 위치 권한·수집 단일 소유가 그 디렉토리라 U4가 새 위치 코드를 만들지 않는다 / `distanceLabel` 승격 후보 / orval 태그 / 오프라인 큐) · **구조 가드 7**(시각 산술 0건 · 걸음 수 심볼 0건 · `TriggerKind` 정확히 4종 · `ReplanScope` 정확히 2종 · `useApplyReplan` 호출처 1곳 · 소요시간 표기 0건 · pages 재귀 스캔) · PBT-U4-F1~F3을 대상 파일에 결속.

**함께 기록한 실측 경고**: `trips/**`는 `(tabs)` 밖이라 `SplashGate`의 `Stack.Protected` guard에 안 걸려 **미인증 딥링크로 열린다**(`stays/`·`trips/new/**` 선례, `frontend/docs/structure.md` 경고). U4는 **알림 딥링크가 이 경로로 들어오므로** 두 문서 §1에 명시했다.

**Context**: CONSTRUCTION / U3(승인 완료 산출물의 사후 정정) · U4(Functional Design 승인 게이트 대기 중 산출물 갱신). 새 스토리·새 결정 신설 0 — **배치 기준만 실재로 정렬**했으므로 U3 스테이지 체크박스 변동 없음. 이번 항목이 손댄 `aidlc/` 파일은 `construction/u3-ai-itinerary/functional-design/frontend-components.md` · `construction/u4-in-trip-planb/functional-design/frontend-components.md`와 이 `audit.md` append뿐이다. 실측 근거 = `frontend/docs/structure.md`(층 규약·경고) · `frontend/src/` 디렉토리 전수 · `src/app/trips/[tripId]/itinerary/must-visits/index.tsx`(라우트 관례) · `src/features/{trip,itinerary}/{model,ui}/` 파일 목록 · `src/pages/*/` 13슬라이스 · `src/__tests__/` 가드 40개.

---

## CONSTRUCTION — U4 Functional Design 승인 + NFR Requirements 착수 (Step 1~4)
**Timestamp**: 2026-08-09T10:15:00Z
**User Input**: "승인, NFR Requirements 진행"
**AI Response**: U4 Functional Design **승인 기록** — `aidlc-state.md`에 U4 절 신설(FD [x] 승인 완료 2026-08-09 · 산출물 4종 · Q1~Q8 답변 · 밴드 `i` 대조와 디자인 반영 재관측 · U2 사후 정정 2건 · U3 `frontend-components.md` 사후 정정 기록). 이어서 **NFR Requirements 착수**.

Step 1 FD 분석 — **재서술 금지 대상 8건** 식별(무발화 BR-U4-05·INV-U4-01 / 감지 단계 억제 BR-U4-08·INV-U4-02 / 확정 전 무변경 BR-U4-28·32 / 시각 재추정 없음 BR-U4-34·35 / 연속 추적 없음 BR-U4-41 / 걸음 수 없음 / 수동 전환 폴백 BR-U4-43·45 / 기준점 사다리 BR-U4-19). Step 1b 상속 기반선 정리(부하·복원력·보안·관측·PBT + **호출 상한 형태는 U3 COST-U3-01 승계**).

**Step 1c 실장 확인 — 사용자 지시(U3 선례) 대로 실장 우선**. 주요 발견 5건:
(1) ⚠️ **자기 정정** — 이전 대화에서 지오펜스를 "신규 의존성 0"이라 했으나 실측 결과 **`expo-task-manager`가 없다**(`startGeofencingAsync`는 `TaskManager.defineTask` 필요) → **신규 의존성 1개**. 또한 `app.config.ts`의 `expo-location` 플러그인이 **`locationWhenInUsePermission` 하나만** 설정돼 있어 **plugin 확장 + EAS 재빌드**(OTA 불가)가 붙는다. 이 비용을 Q1로 사용자 재확인에 부침.
(2) `backend/V1.3__auth_location.sql`에 **위치 동의 3층**이 이미 있고 **`gps_recording_opt_in`(L3)** 가 실제 경로 기록의 동의 축이다 → U4는 **새 동의 축을 만들지 않는다**.
(3) 같은 마이그레이션의 `location_legal_log`는 **append-only + `event_type='COLLECTION'`** 을 요구 → 좌표마다 로그를 남기면 **점 수만큼 행 폭증** → 기록 단위를 Q3로 부침.
(4) `backend/app/.../AsyncConfig.kt`에 **`@EnableScheduling` + `StalePartialSweeper` 실재** → DEC-U4-6의 "트리거 평가 스케줄러 없음"은 유지하되 **`replan_session` 만료 정리는 기존 sweeper 패턴 재사용**(신규 인프라 0)으로 전제에 명시.
(5) `backend/gradle/libs.versions.toml`에 resilience4j·bucket4j·Redis·Caffeine **전부 없음** → 호출 상한은 라이브러리 없이 세션 상태로만(U3와 동형). U1이 결정한 Redis는 미도입 상태라 Q4에서 끌어올지 물음.

계획서 = `aidlc-docs/construction/plans/u4-in-trip-planb-nfr-requirements-plan.md`. 질문 **Q1~Q6** 상신(지오펜스 실비용 재확인 · 포그라운드 평가 주기 · 실제 경로 정밀도/보존/법정 로그 단위 · 날씨 조회 예산 · 알림 빈도 상한 수치 · 여행 중 오프라인 정책), 답변 대기.

**Context**: CONSTRUCTION / U4 / Functional Design 승인 완료 → NFR Requirements Step 1~4 완료, Step 5(답변 수집) 대기. 이번 항목이 손댄 `aidlc/` 파일 = `aidlc-docs/aidlc-state.md`(U4 절 신설) · `construction/plans/u4-in-trip-planb-nfr-requirements-plan.md`(신규) · 이 `audit.md` append.

---

## CONSTRUCTION — U4 NFR Requirements (Step 5~7: 답변·산출물 2종)
**Timestamp**: 2026-08-09T10:50:00Z
**User Input**: "ㄱㄱ"
**AI Response**: "ㄱㄱ"를 **Q1~Q6 추천안(A) 전부 채택**으로 해석하고 그 해석을 사용자에게 명시한 뒤 진행("다르면 알려주면 고친다"). 채택된 답: Q1=A(지오펜스 실비용 수용) · Q2=A(이벤트 기반, 주기 폴링 없음) · Q3=A(세션 단위 법정 로그 + 성긴 샘플링) · Q4=A(격자·발표시각 캐시, DB 테이블) · Q5=A(하루 상한 설정값, "근거 없는 초기값" 라벨) · Q6=A(오프라인 정책 그대로, 방문 체크만 큐잉).

**산출물 2종** (`aidlc-docs/construction/u4-in-trip-planb/nfr-requirements/`):
- `nfr-requirements.md` — **MOBILE-U4-01~07**(이 유닛에서 새로 생긴 축: 배터리·권한·네이티브 빌드) · PERF-U4-01~05 · COST-U4-01~06 · **LEGAL-U4-01~05** · DATA-U4-01~05 · OBS-U4-01~05 · OFFLINE-U4-01~05 · SEC-U4-01~04 + 재평가 트리거 6. FD 중복 8건은 머리말에서 참조로만 처리.
- `tech-stack-decisions.md` — 상속 11행 + U4 델타 6 + 미도입 결정 8 + 개발 중 처리 3.

**실장이 결정을 바꾼 항목 4건**:
(1) **자기 정정 확정** — FD 단계에서 "지오펜스 신규 의존성 0"이라 한 것을 `tech-stack-decisions.md` 델타 1에 **정정 기록**으로 남겼다. 실제로는 `expo-task-manager` 1개 + `app.config.ts` 플러그인 확장(`locationAlwaysAndWhenInUsePermission`·Android 백그라운드 플래그) + **EAS 재빌드**(OTA 불가). 사용자가 Q1=A로 이 비용을 수용.
(2) **위치 동의 축 신설 금지** — `V1.3` 실장의 3층 동의 중 **L3 `gps_recording_opt_in`이 이미 실제 경로 기록의 동의 축**이라 LEGAL-U4-01로 승계만 한다.
(3) **법정 로그 폭증 차단** — `location_legal_log`가 append-only + `COLLECTION` 이벤트를 요구하므로 좌표마다 남기면 하루 수천 행. LEGAL-U4-02로 **수집 구간 시작·종료 각 1건**으로 확정하고, `detail`에 원시 좌표 금지(스키마 주석 승계)를 LEGAL-U4-03으로 명문화.
(4) **스케줄링 신규 인프라 0** — `AsyncConfig.kt`의 `@EnableScheduling`·`StalePartialSweeper` 실재를 근거로 `replan_session` 정리를 기존 패턴 재사용(DATA-U4-05·델타 5). DEC-U4-6("트리거 평가 스케줄러 없음")과의 관계를 문서에 명시 — 평가는 클라 요청 응답으로, 스케줄러는 정리에만.

**함께 승격한 보안 항목**: SEC-U4-02 — 알림 딥링크가 `trips/**`로 들어오는데 그 경로는 `(tabs)` 밖이라 `Stack.Protected` guard에 안 걸린다(`frontend/docs/structure.md` 실측 경고). **서버 인가가 유일한 방어선**임을 NFR로 못박았다. SEC-U4-04 — 로컬 알림 본문에 좌표 금지(잠금화면은 인증 이전 표면).

**Context**: CONSTRUCTION / U4 / NFR Requirements Step 5~7 완료, Step 8(승인 게이트) 대기. 이번 항목이 손댄 `aidlc/` 파일 = `construction/u4-in-trip-planb/nfr-requirements/` 2종 신규 · `construction/plans/u4-in-trip-planb-nfr-requirements-plan.md` 체크박스 갱신 · 이 `audit.md` append. `aidlc-state.md`는 승인 후 갱신한다.

---

## CONSTRUCTION — U4 NFR Requirements 승인 + NFR Design (전 단계)
**Timestamp**: 2026-08-09T11:20:00Z
**User Input (1)**: "ㄱㄱ"
**User Input (2)**: "Q1 A Q2 A인데 두 곳으로?"
**AI Response**: (1) NFR Requirements **승인**으로 기록하고 `aidlc-state.md` 갱신. NFR Design 착수 — **얇게** 방침(상속 8영역 · NFR Requirements에 배치까지 적힌 7항 재서술 금지). 계획서 `plans/u4-in-trip-planb-nfr-design-plan.md`에 **질문 2건만** 상신.

(2) Q1=A(서킷 미도입) 채택. **Q2는 사용자가 A(1곳)를 고르면서 "두 곳으로?"라고 변형을 제안** → **A′(다음 2곳)로 확정**. 채택 근거를 명시적으로 답변: iOS 20 리전 상한 대비 비용 사실상 0이고, A의 유일한 약점(순서 건너뛰기 시 감지 누락)이 대부분 덮인다. 대가로 **인접 리전 중첩 시 중복 진입 이벤트**가 생길 수 있어 `(tripId, slotKey)` 선착 하나만 도착 확정하는 규칙을 P-MOBILE-U4-1에 신설. 이로써 **O-U4-1 종결**.

**Step 1c 실장 확인 — 문서-실장 드리프트 1건 발견**: U1 `nfr-design-patterns.md` P-RES-U1-1과 `logical-components.md`가 **Resilience4j 벤더별 서킷**을 전제하는데 `backend/gradle/libs.versions.toml`에 **라이브러리가 없다**. U4가 외부 벤더(기상청)를 하나 더 들이는 시점이라 정면으로 다뤘고, **Q1=A로 "지금 도입하지 않는다"** 결정. 근거 = 서킷이 막는 "장애 벤더에 매달려 자원 소진"이 **재시도 없음**(P-RES-U1-2)으로 이미 완화됐고, U4의 외부 실패는 전부 무발화 또는 수동 전환으로 끝나 사용자 경로가 막히지 않는다. 대체 = 짧은 타임아웃 + 벤더별 실패율 지표(OBS-U4-04). 대가(느린 실패 시 스레드 점유)와 재평가 조건도 문서에 명시.

**산출물 2종** (`aidlc-docs/construction/u4-in-trip-planb/nfr-design/`):
- `nfr-design-patterns.md` — **P-DET-U4-1**(신호 수집/판정 분리 — 클라는 임계를 모른다) · **P-DET-U4-2**(무발화 기본값, U0·U1 "침묵 실패 금지"와의 관계를 대상 구분으로 정리: *사용자가 요청한 동작*의 실패는 표면화, *요청하지 않은 선제 알림*은 근거 없으면 미생성) · P-DET-U4-3(억제 3축) · **P-RES-U4-1**(서킷 미도입) · **P-RES-U4-2**(날씨의 stale-if-error **역방향 예외** — 발화엔 만료분 금지, 표시엔 "확인 불가") · **P-MOBILE-U4-1**(지오펜스 슬라이딩 창 2 + 중복 진입 판정 + 강등 사슬) · P-CON-U4-1(세션 단일성 = 호출 상한이자 동시성 제어, 확정 시 낙관적 잠금) · P-PERF-U4-1~2 · P-DATA-U4-1~2 · P-OBS-U4-1(침묵의 근거를 관측으로 갚는다) + NFR 커버리지 + 미도입 6.
- `logical-components.md` — **LC-U4-1~9**(TriggerEvaluator · SuppressionStore · WeatherPort+KmaWeatherAdapter+Cache · ReplanSessionCoordinator · ReplanAgentAdapter · VisitCheckService · LocationTrailRecorder+LegalLogEmitter · **GeofenceRegistrar**(shared/location) · **SignalCollector**(features/execution)) + 기존 자산 수용 8 + 마이그레이션 6 + 미결 4(O-U4-1 종결 반영).

**U1 사후 정정 2건**: `u1-accommodation-trip/nfr-design/nfr-design-patterns.md` P-RES-U1-1 절 머리와 `logical-components.md` 서킷 행에 **"미실장 · U4에서 재확인(2026-08-09)"** 주석을 달아, 패턴이 문서로만 존재한다는 사실 + U4의 미도입 결정(P-RES-U4-1) + 재평가 조건을 연결했다. 새 결정 신설 0 — **사실 기록과 상호 참조만** 추가했으므로 U1 스테이지 체크박스 변동 없음.

**Context**: CONSTRUCTION / U4 / NFR Requirements 승인 완료 → NFR Design Step 1~6 완료, Step 7~8(완료 메시지·승인 게이트) 진행. 이번 항목이 손댄 `aidlc/` 파일 = `construction/plans/u4-in-trip-planb-nfr-design-plan.md`(신규) · `construction/u4-in-trip-planb/nfr-design/` 2종(신규) · `construction/u1-accommodation-trip/nfr-design/{nfr-design-patterns.md,logical-components.md}`(주석 2건) · `aidlc-docs/aidlc-state.md` · 이 `audit.md` append.

---

## CONSTRUCTION — U4 NFR Design 승인 + Infrastructure Design SKIP + U4 설계 단계 종료
**Timestamp**: 2026-08-09T11:45:00Z
**User Input**: "승인, U4 설계 단계 종료"
**AI Response**: NFR Design **승인**으로 기록하고, Infrastructure Design을 **SKIPPED**로 확정(U0·U1·U3와 동형 — 배포/클라우드 계획 부재로 클라우드 리소스 결정의 근거·검증 수단이 없음, 규칙상 CONDITIONAL "no infrastructure changes" 해당. 재개 조건 = 배포/클라우드 진입 결정 시 별도 지시). Code Generation은 SCOPE.md 현행 범위에 따라 **범위 제외**(팀이 각 패키지 디렉토리에서 직접 개발).

**✅ U4 설계 단계 종료 (2026-08-09)** — 산출물 **8종**: functional-design 4(`business-logic-model.md`·`domain-entities.md`·`business-rules.md`·`frontend-components.md`) + nfr-requirements 2 + nfr-design 2. SCOPE.md 처리 규칙 2("Infrastructure Design 승인 후 Code Generation으로 넘어가지 말고 STOP — 설계 문서 요약을 제시하고 팀 개발로 핸드오프")를 그대로 이행한다.

**이 유닛이 남긴 식별자**: DEC-U4-1~11 · INV-U4-01~09 · **BR-U4-01~46** · PBT-U4-1~5(서버)·F1~F3(클라) · G-U4-1~8 · O-U4-1(종결)~O-U4-5 · MOBILE/PERF/COST/LEGAL/DATA/OBS/OFFLINE/SEC-U4-* · P-*-U4 9종 · **LC-U4-1~9**.

**다른 유닛 문서에 남긴 사후 정정 5건**(전부 이 유닛 진행 중 실장 확인에서 유도):
1. U2 `business-logic-model.md` §7 `recalculate` 행 종결 + **§7.2 신설**(`replan` 개통, `ScheduleAgentPort` 5메서드)
2. U2 `business-rules.md` O-U2-3 문구 갱신
3. U3 `frontend-components.md` **실제 FSD 층 배치 기준 재작성**
4. U1 `nfr-design-patterns.md` P-RES-U1-1에 "미실장 · U4에서 재확인" 주석
5. U1 `logical-components.md` 서킷 행에 같은 주석

**핸드오프 목록(설계 밖)**: backend 3모듈 + 마이그레이션 6 + `ScheduleAgentPort.replan` + openapi 태그 2 / ai HTTP 표면(G-U4-3, 개발 착수 선행) + O-U4-5 / frontend `expo-task-manager` + plugin 확장 + **EAS 재빌드 1회** + `KakaoMapView` 점선 + `shared/location` 지오펜스 + feature 2개 신설 / 인셉션 정정 상신 2(G-U4-1·G-U4-4) / 기상청 API 키 발급 / 디자인 확인 2(G-U4-7·G-U4-8) / 미결 O-U4-2~5.

**Context**: CONSTRUCTION / U4 설계 단계 종료. 이번 항목이 손댄 `aidlc/` 파일 = `aidlc-docs/aidlc-state.md` · 이 `audit.md` append. 다음 유닛(U5~U9) 착수는 **사용자의 별도 지시** 대기(SCOPE.md 범위 제외 항목).

---

## Post-Design Correction — U3 frontend-components.md §8 testID 소급 기록 + 발명값 3건 명시 (TRIP-297 [기록] 반영)
**Timestamp**: 2026-08-10T00:00:00Z

**User Input**: TRIP-297 사이클 [설계] 3-a 맹점 훑기에서 사용자가 정본 반영 후보 4건 중 3건을 선택했다(오케스트레이터의 사이클 요약으로 [기록] 단계에 전달) — ① 티켓 본문 드리프트 5건은 Jira TRIP-297 코멘트로(aidlc 밖), ② testID 확정값 13종은 `frontend-components.md` §8 소급 기록, ③ 발명값 3건(성격 축 라벨 미구현·고정 블록 시각 절삭 `startAt.slice(0,5)`·폴링 2초·30회)은 정본에 발명값임을 명시 기록. 미선택 1건(`itineraryDraftTimeStructure.test.ts` 소스 스캔 표현 불가)은 관측만, 문서 미반영.

**AI Response**: TRIP-182·TRIP-207·TRIP-209 [기록]이 확립한 "[구현 결정 · TRIP-XXX, 날짜]" 소급 기록 방식을 그대로 따라 `frontend-components.md` §8 뒤에 두 문단 추가:

(1) **testID 13종 소급 기록** — `itinerary-draft-day-{n}`·`-slot-{slotKey}`·`-slot-no-{slotKey}`·`-slot-band-{slotKey}`·`-slot-badge-{slotKey}`·`-slot-fixed-{slotKey}`·`-slot-image-{slotKey}`·`-slot-tags-{slotKey}`·`-slot-name-{slotKey}`·`-stale-failed`·`-loading`·`-failed`·`-retry`. 원래 제안값(`-strength-{min|balanced|max}`·`-day-{n}`·`-slot-{slotKey}`)과 계열은 같으나 실제 확정 형태가 다르다 — 추천 강도 세그먼트는 이번 범위 밖이라 여전히 미확정. 근거: `_workspace/20260809-trip297-itinerary-draft/02a_test-design_spec.md` §3.1(게이트①-1 승인 테스트 동결 계약).

(2) **발명값 3건 명시** — 성격 축 라벨 미구현(시간 축만, 정본 매핑 부재) · 고정 블록 시각 절삭 `startAt.slice(0,5)`(표시 포맷 정본 부재) · 폴링 간격 2초·상한 30회(수치 정본 부재). 셋 다 "요구사항 근거가 아니라 구현 결정 — 다음 사이클이 요구사항 근거로 인용 금지" 라벨을 달았다(TRIP-209 5건 소급 기록과 같은 라벨링 방식). 근거: `_workspace/20260809-trip297-itinerary-draft/01b_ouroboros_seed.md`(D4·D5·"폴링 수치" 절).

미반영 1건(§6 `itineraryDraftTimeStructure.test.ts` 관측)도 §8 말미에 관측 사실로만 덧붙였다 — 문서의 결정 사항을 바꾸지 않음.

**Context**: SCOPE.md 현행 범위(CONSTRUCTION 설계 문서 단계) 내 **기존 승인 산출물의 사후 정정**. 정정 실행 주체: TRIP-297 사이클 [기록](scribe) 단계. 실측 근거는 `_workspace/20260809-trip297-itinerary-draft/00_gates.md`(정본 반영 선택 절)·`01b_ouroboros_seed.md`(D4·D5·폴링 수치)·`02a_test-design_spec.md`(§3.1·★13). 이번 항목이 손댄 `aidlc/` 파일 = `aidlc-docs/construction/u3-ai-itinerary/functional-design/frontend-components.md`(§8 뒤 2문단 추가) · 이 `audit.md` append. `aidlc-state.md`는 미변경(이 사이클은 Post-Inception Progress 대상 없음).

---

## Post-Design Correction — TRIP-339 (2026-08-10)

**Action**: Construction 단계 기존 승인 산출물 2건에 **구현 결정 소급 기록** append.

- `aidlc-docs/construction/u3-ai-itinerary/functional-design/frontend-components.md` — §8 뒤에 **h05·h11 공용 지도 시각 계약** 1문단 + 3항목 추가(핀 마커 형태·연결선 h11 전용·지도 고정 옵트인 범위). 이 문서가 h11 testID만 소급하고 지도 시각은 한 줄도 다루지 않았던 공백을 메운다.
- `aidlc-docs/construction/u3-ai-itinerary/functional-design/domain-entities.md` — §3 INV 표 뒤에 **INV-U3-02 인용 문장 차이** 1문단 추가. 정본 원문(`orderIndex` 0..n-1, 데이터 인덱스)과 TRIP-339 티켓 인용(화면 표시 번호 1..n)이 갈리는 지점을 명시하고, 지도 핀 번호가 후자이며 **좌표 없는 슬롯을 건너뛰어도 재번호하지 않는다**는 결정을 남긴다. INV-U3-02 원문 자체는 변경하지 않았다.

**둘 다 요구사항 근거가 아니라 구현 결정의 소급 기록이다** — 다음 사이클이 요구사항 근거로 인용하지 말 것을 각 문단에 명시했다(TRIP-297 선례와 같은 형식).

**Selection**: 사이클 [설계] 3-a에서 관측된 정본 공백·드리프트 **6건 중 사용자가 3건을 선택**했다. 위 두 건이 그중 `aidlc/` 소관이고, 세 번째(Figma 밴드 맵 `[보관]` 세대 규칙)는 하네스 파일(`frontend/.claude/skills/spec-perception/reference/figma-structure.md`) 소관이라 별도 장부(옵시디언 `TripPilot/하네스 변경이력.md`)에 기록했다. **미선택 3건은 `aidlc/`에 반영하지 않았다** — 개발로그에 관측으로만 남긴다(티켓 본문의 핀 색 서술이 Figma 실측과 반대인 점 · "assets 디렉토리가 없다"가 사실과 다른 점 포함).

**Context**: SCOPE.md 현행 범위(CONSTRUCTION 설계 문서 단계) 내 **기존 승인 산출물의 사후 정정**. 정정 실행 주체: TRIP-339 사이클 [기록](scribe) 단계. 실측 근거는 `_workspace/20260810-trip339-map-surface/01_spec-analyst_brief.md`(§3 Figma 실측치·§8 ④ 드리프트 목록) · `01b_ouroboros_seed.md`(3-a 사용자 확정 표) · `00_gates.md`(게이트①·①-2·② 원장) · `04b_smoke_1_PASS.md`(실기 대조로 h05 무선·h11 유선 확인). 이번 항목이 손댄 `aidlc/` 파일 = 위 두 문서 + 이 `audit.md` append. `aidlc-state.md`는 미변경(이 사이클은 Post-Inception Progress 대상 없음).

---

## Post-Design Correction — TRIP-298 (2026-08-11)

**Action**: Construction 단계 기존 승인 산출물 2건에 **구현 결정 소급 주석** append.

- `aidlc-docs/construction/u2-itinerary-intelligence/functional-design/business-rules.md` — BR-U2-05(`candidatesSummary` 신설) 절 뒤에 소급 주석 1문단 추가. BR-U2-05 원문은 `level: HIGH | MEDIUM | LOW` 열거를 확정하는데, 실제 구현 계약(`backend/docs/design/openapi.yaml:1183-1195`)은 `level: { type: string }`으로 열어 두고 "AI 어휘가 그대로 통과한다"고 명시한다 — 정반대다. 루트 CLAUDE.md 규칙상 구현 계약이 이긴다는 사실과, 프론트(`isCandidatesDemoted`)가 화이트리스트 비교로 이 드리프트에 이미 맞춰 짜여 있다는 사실을 원문 삭제 없이 추가만 했다.
- `aidlc-docs/construction/u3-ai-itinerary/functional-design/frontend-components.md` — §3(`draftState.ts`/`resolveDraftState()`)·§6(`itineraryDraftStructure.test.ts` 행)에 각각 소급 기록 추가. 실제 구현은 `draftView.ts`/`resolveDraftView()`(TRIP-297)이고, 문서는 옛 이름을 그대로 가정하고 있었다. TRIP-297·TRIP-339 선례와 같은 "[구현 결정 · TRIP-XXX, 날짜]" 소급 기록 형식을 따랐다.

**둘 다 요구사항 근거가 아니라 구현 결정(또는 계약 드리프트 사실)의 소급 기록이다** — 다음 사이클이 요구사항 근거로 인용하지 말 것을 각 문단에 명시했다.

**Selection**: 사이클 [설계] 3-a에서 관측된 정본 반영 후보 **4건 중 사용자가 4건 전부 선택**했다. 그중 위 2건만 `aidlc/` 소관(B)이고, 나머지 2건(BR 코드 오인용 — `placementReason`에 붙은 `BR-U2-04`가 실제로는 slotKey 키 규약이고 문구 제약은 `BR-U2-09`인 것 · h11 이유 표면 화면 정본 부재)은 **백엔드 파일·미착수 화면 정본이라 `aidlc/`에 쓰지 않고 Jira TRIP-298 코멘트로만 보고**했다.

**Context**: SCOPE.md 현행 범위(CONSTRUCTION 설계 문서 단계) 내 **기존 승인 산출물의 사후 정정**. 정정 실행 주체: TRIP-298 사이클 [기록](scribe) 단계. 실측 근거는 `_workspace/20260810-trip298-reason-surface/00_ticket.txt`(스코프 절) · `04_qa-verifier_report_1_PASS.md` §6(경계면 QA — `level` 계약 대조) · `03_implementer_notes.md` §1.2(화이트리스트 근거). 이번 항목이 손댄 `aidlc/` 파일 = 위 두 문서 + 이 `audit.md` append. `aidlc-state.md`는 미변경(이 사이클은 Post-Inception Progress 대상 없음).

---

## Post-Design Correction — U3 frontend-components.md h24 저장 시트 단일 갈래 + validate 훅 제거 (TRIP-302 슬라이스2 [기록] 반영)
**Timestamp**: 2026-08-12T08:15:00Z

**User Input**: TRIP-302(h24 일정 편집) 슬라이스2 사이클 [설계] 3-a에서 사용자가 정본 반영 후보 중 **"반영"을 채택**했다(오케스트레이터의 사이클 요약으로 [기록] 단계에 전달, `_workspace/20260812-trip302-save-flow/01b_ouroboros_seed.md` "확정 결정" 절에 채택 항목 원문 기재) — ① §4 `SaveConflictSheet.tsx`의 `[AI 자동 보정] / [그대로 저장]` 2갈래를 `[그대로 저장]` 단일 갈래로(티켓 결정 가) ② §3 `useValidateItinerary.ts` 별도 훅 서술 제거(재검증은 PUT에 접힘 — 별도 validate 호출 없음) ③ §2(line 73) `itinerary-edit ↔ useValidateItinerary()` 배선 서술 삭제. 세 항목 모두 이 파일(`aidlc/aidlc-docs/construction/u3-ai-itinerary/functional-design/frontend-components.md`) 소관으로 지정, 이 한 자리만 aidlc 쓰기 허용.

**AI Response**: TRIP-297·TRIP-339·TRIP-298 선례의 "[구현 결정 · TRIP-XXX, 날짜]" 소급 기록 방식을 따라 3건을 최소 수정으로 반영했다.

(1) **§2 line 73** — `itinerary-edit` 슬라이스 배선 셀을 `편집 스토어 ↔ useValidateItinerary() 배선`에서 `편집 스토어 ↔ PUT 저장(재검증은 PUT에 접힘 — [구현 결정 · TRIP-302, 2026-08-12])`로 교체. 서버가 전체 교체 PUT 적용과 동시에 재검증까지 수행하므로 편집 화면 쪽에 별도 즉시 검증 호출이 없다는 실제 배선을 반영.

(2) **§3** — `useValidateItinerary.ts | 훅 | 편집 재검증(비차단)` 행을 표에서 제거하고, 표 뒤에 소급 정정 블록을 추가: 이 절이 가정한 편집 중 실시간 검증 훅은 구현되지 않았다는 사실 + h24 저장 플로우(TRIP-302 슬라이스2)의 실제 재검증 경로(PUT 응답 자체가 재검증 결과)를 명시. **미반영 관측을 같은 블록에 병기**했다 — §2 line 71(`itinerary-manual`, h19~h21 미착수)이 여전히 같은 훅 이름을 참조하지만 이번 3-a 선택 범위 밖이라 손대지 않았고, 그 화면은 "추가마다 재검증"(증분)이라 h24의 "전체 교체 PUT"과 성격이 달라 같은 결정이 그대로 적용될지는 그 화면 착수 시 별도 재확인이 필요함을 남겼다.

(3) **§4** — `SaveConflictSheet.tsx | — | [AI 자동 보정] / [그대로 저장]` 행을 `[그대로 저장] 단일 갈래 — [AI 자동 보정] 갈래 제거([구현 결정 · TRIP-302, 2026-08-12], 티켓 결정 가 · BR-U3-14 repair 미충족)`로 교체하고, 시트 자체는 이 결정과 별개로 Figma h24에 프레임이 미설계라 TRIP-302에서는 구현하지 않았음(이연)을 같은 셀에 병기 — 두 사실(갈래 수 결정 vs 시트 존재 자체의 이연)이 서로 다른 근거임을 섞지 않았다.

**셋 다 요구사항 근거가 아니라 티켓 결정(가)의 소급 기록이다** — 다음 사이클이 이 세 문장을 요구사항 근거로 인용하지 말 것을 §3 정정 블록에 명시했다. §8 testID 목록(`-save-conflict`·`-save-repair`·`-save-asis`)은 3-a 선택 목록에 없어 **손대지 않았다**(시트 이연 자체가 아직 후속 티켓 대기 상태라 testID 확정 시점이 아님).

**Selection**: 사이클 [설계] 3-a에서 사용자가 **"반영" 항목만 선택**(목록에 다른 항목 없음 — 전량 반영). 관측만 남긴 항목 2건(SaveConflictSheet Figma 미설계 → 디자이너 h24 시트 프레임 요청 후속 티켓 후보, openapi PUT 409 에러코드 미열거 → BE 인지 필요)은 `aidlc/` 소관이 아니라(Figma·BE 정본 공백) 개발로그 관측으로만 남기고 이 파일에 쓰지 않았다.

**Context**: SCOPE.md 현행 범위(CONSTRUCTION 설계 문서 단계) 내 **기존 승인 산출물의 사후 정정**. 정정 실행 주체: TRIP-302 슬라이스2 사이클 [기록](scribe) 단계. 실측 근거는 `_workspace/20260812-trip302-save-flow/01_spec-analyst_brief.md`(§8 ④ 드리프트 관측 · "재검증은 PUT 안에 접혀 있다 — validate를 부르는 별도 훅/코드를 만들지 마라") · `01b_ouroboros_seed.md`("확정 결정" 절 · "정본 반영(사용자 채택)" 항목) · `03_implementer_notes.md`(핸들세이브 구현 확인). 이번 항목이 손댄 `aidlc/` 파일 = `construction/u3-ai-itinerary/functional-design/frontend-components.md`(§2 line 73 · §3 표+정정 블록 · §4 표, 3곳) + 이 `audit.md` append뿐(`git status aidlc/` 실측 1파일 일치). `aidlc-state.md`는 미변경(이 사이클은 Post-Inception Progress 대상 없음 — 코드 구현 소급 기록은 리포 devlog·구조 지도 소관, [기록] 별도 처리).

---

## Post-Design Correction — U3 business-rules.md · domain-entities.md 계약 공백 2건 관측 (TRIP-302 슬라이스3 [기록] 반영)
**Timestamp**: 2026-08-13T14:20:00Z

**User Input**: TRIP-302(h24 일정 편집) 슬라이스3(시각조정 시트만, 범위 좁힘 — 다른후보·장소추가·slot-candidates·지도·SaveConflictSheet 이연) 사이클 [설계] 3-a에서 사용자가 정본 반영 후보 **4건 중 4건 전부 선택**했다(오케스트레이터의 사이클 요약으로 [기록] 단계에 전달). 그중 아래 2건이 `aidlc/`(B, 스펙 정정) 소관으로 지정됐다 — ③ "장소추가" 슬라이스가 이연된 근거인 slot-candidates 계약 공백(Q3)을 `business-rules.md`에, ④ "다른 후보" 슬라이스가 이연된 근거인 필수 슬롯 필드 부재(Q2)를 `domain-entities.md`에 기록. 나머지 2건(① 진입점 파일이 `TimelineScreen`이 아니라 `ItineraryEditScreen.tsx`인 것 ② `slot-candidates` 후보 스키마와 GET 일정 slot 스키마 혼동)은 Jira 티켓 서술·개발로그 관측 소관이라 `aidlc/`에 쓰지 않았다.

**AI Response**: TRIP-297·TRIP-339·TRIP-298·TRIP-302 슬라이스2 선례의 "[구현 결정 · TRIP-XXX, 날짜]" 소급 기록 형식을 이번엔 **"[관측 · TRIP-XXX, 날짜]"**로 변형해 적용했다 — 앞의 네 선례는 전부 "실제로 이렇게 구현했다/짜기로 했다"는 **확정된 결정**의 소급 기록이었는데, 이번 2건은 확정된 결정이 아니라 **"이 계약에 빈 자리가 있어서 관련 슬라이스를 이연했다"는 갭 관측**이라 표현을 구분했다. 기존 BR/INV 번호·본문은 원문 그대로 두고 각 표 바로 뒤에 관측 블록만 추가했다(추가만, 삭제·수정 없음).

(1) **`business-rules.md`** — BR-U3-15("슬롯 추가 시 삽입 가능한 시간대만 후보로 제시") 행 뒤에 관측 블록 추가: 이 규칙이 요구하는 시간대 판정을 **누가 계산하는지가 계약에 없다** — INV-2(클라 시간 판정 금지)를 지키려면 서버 책임이어야 하는데 `POST /trips/{tripId}/itinerary/slot-candidates` 최소 계약(`backend/docs/design/openapi.yaml:1287`, `SlotCandidates.candidates[]` required `[poiId, distanceRange, rationale]`)은 시간대 필드를 반환하지 않는다. "장소추가" 슬라이스가 이 공백 위에서 필터링 주체를 정할 수 없어 이연됐다는 사실을 병기했다.

(2) **`domain-entities.md`** — §1.3 `VisitSlot` 필드 표 뒤(`duration 필드 없음` 문장 다음)에 관측 블록 추가: `isFixed`(시각 고정 여부)와 "필수 방문지인가"(`must_visit`, U1/C6 소유)는 동치가 아니다 — 시각 고정 없이 등록된 필수 방문지는 `isFixed=false`로 저장돼 다른후보 교체(BR-U3-23~26)를 막을 슬롯 레벨 근거가 없다. 실제 계약(`backend/docs/design/openapi.yaml:1379`, `slots[]` required 목록)에도 must-visit 플래그가 없음을 실측으로 확인했다. "다른 후보" 슬라이스가 `isFixed`를 근사값으로 쓸 수밖에 없어 이연됐다는 사실을 병기했다.

**둘 다 요구사항 근거가 아니라 관측(gap observation)이다** — 다음 사이클이 이 두 문단을 BR-U3-15의 확정된 산출 주체나 `isFixed`의 확정된 의미 확장으로 인용하지 말 것을 각 문단에 명시했다. 백엔드 인지가 필요한 계약 공백이라 U3 설계만으로는 해소되지 않는다 — 후속 착수(장소추가/다른 후보 슬라이스) 시 백엔드와 재확인이 선행돼야 한다.

**Selection**: 사이클 [설계] 3-a에서 사용자가 정본 반영 후보 **4건 중 4건 전부 선택**. 그중 `aidlc/` 소관(B)은 이 2건뿐이고, 나머지 2건(진입점 파일 오기 · 후보 vs GET slot 스키마 혼동)은 Jira 서술·개발로그 관측으로만 남기고 이 파일에 쓰지 않았다.

**Context**: SCOPE.md 현행 범위(CONSTRUCTION 설계 문서 단계) 내 **기존 승인 산출물의 사후 정정(관측 추가)**. 정정 실행 주체: TRIP-302 슬라이스3 사이클 [기록](scribe) 단계. 실측 근거는 `_workspace/20260813-trip302-edit-sheets/01b_ouroboros_seed.md`(스코프 절 · "다른후보=필수 게이팅(Q2)·교체후 표시(Q4) 근사 필요, 장소추가=계약 공백 3중(Q3)" · D1 "3-a 맹점 ①, 정본 반영 대상") · `backend/docs/design/openapi.yaml:1287`·`:1379`(slot-candidates·slots 스키마 직접 조회). 이번 항목이 손댄 `aidlc/` 파일 = `construction/u3-ai-itinerary/functional-design/business-rules.md`(BR-U3-15 뒤 관측 블록) · `construction/u3-ai-itinerary/functional-design/domain-entities.md`(§1.3 뒤 관측 블록) + 이 `audit.md` append, 총 3파일(`git status aidlc/` 실측 일치). `aidlc-state.md`는 미변경(이 사이클은 Post-Inception Progress 대상 없음 — 코드 구현 소급 기록은 리포 devlog·구조 지도 소관, [기록] 별도 처리).

---

## Post-Design Correction — U3 frontend-components.md 인라인 지도 모델 + 휴관칩 CONFIRMED null 계약 (TRIP-354 [기록] 반영)
**Timestamp**: 2026-08-14T02:35:00Z

**User Input**: TRIP-354(h25/h34 타임라인 Figma 풀디자인 정합) 사이클 [설계] 3-a에서 사용자가 "둘 다 반영"을 선택했다(오케스트레이터의 사이클 요약으로 [기록] 단계에 전달, `_workspace/20260813-trip354-timeline-full-design/01b_ouroboros_seed.md` "B. 정본 반영 선택" 절에 채택 항목 원문 기재) — ① **드리프트1**: 시간표/지도 세그먼트 토글 폐기(결정 D, 라이브 Figma h34가 지도를 상시 인라인으로 그림) → `frontend-components.md §1·§2·§4`를 인라인 모델로 갱신 ② **드리프트4**: 휴관칩 트리거(`openingHoursKnown===false`)가 계약상 CONFIRMED(h34)에서 항상 null이라 구조적으로 안 뜬다는 사실을 §에 명시. 관측만(반영 안 함) 2건 — 드리프트2(일자 총이동거리 계약 공백, 백엔드 계약이라 프론트 문서로 못 고침) · 드리프트3(category 매핑 공백) — 은 개발로그 관측으로만 남기고 이 파일에 쓰지 않았다.

**AI Response**: TRIP-297·339·298·302 선례의 "[구현 결정 · TRIP-XXX, 날짜]" 소급 기록 방식을 따라 4곳을 최소 수정 + 1개 블록 추가로 반영했다.

(1) **§1** — 라우트 경고 불릿 뒤에 1줄 추가: h25·h26 병기가 더는 세그먼트 토글이 아니라 단일 화면 상태임을 명시하고 §2·§4를 가리켰다.

(2) **§2 line 72** — `itinerary-plan` 배선 셀을 `→ TimelineScreen/MapScreen`에서 `→ TimelineScreen 단일(지도 세그먼트/MapScreen 폐기)`로 교체.

(3) **§3** — `openHoursWarning.ts` 행 뒤에 드리프트4 정정 블록 추가: 실제 트리거는 화면이 `slot.openingHoursKnown===false`를 직접 읽는 것이고, 그 값이 계약상 CONFIRMED에서 항상 null이라 h34(확정 읽기전용)에서는 휴관칩이 구조적으로 뜰 수 없다는 사실(PLANNED=h25에서만 뜬다)을 명시 — 다음 사이클이 h34 픽스처로 휴관칩 AC를 세우면 영영 안 떠서 잘못된 green이 나옴을 경고했다.

(4) **§4** — `TimelineScreen.tsx` 행을 h25·h26·h29~h34로 확장하고 인라인 글랜스+확대 오버레이 배선을 명시, `MapScreen.tsx` 행은 취소선 처리해 "폐기"로 표시(별도 파일이 아니라 `TimelineScreen.tsx` 안의 확대 오버레이로 흡수됨). 표 뒤에 "인라인 지도 모델" 정정 블록을 추가해 결정 D의 확정 동작(인라인 글랜스 `viewOnly=true` 상시 + "지도 크게 보기"가 여는 로컬 상태 `expanded` 오버레이, `viewOnly=false`)과 `PoiSlotCard`(peek)가 고아가 아니라는 점 · `itineraryMapSurfaceStructure.test.ts`(S2④·S8)가 두 `KakaoMapView` 호출부를 소스 태그로 잠근다는 점을 기록했다.

**넷 다 요구사항 근거가 아니라 구현 결정(또는 계약 사실)의 소급 기록이다** — 다음 사이클이 요구사항 근거로 인용하지 말 것을 각 블록에 명시했다.

**Selection**: 사이클 [설계] 3-a에서 관측된 정본 반영 후보 **4건 중 사용자가 2건(드리프트1·4)을 선택**했다. `aidlc/` 소관(B)은 이 2건뿐이고, 나머지 2건(드리프트2·3)은 관측만 남기고 이 파일에 쓰지 않았다.

**Context**: SCOPE.md 현행 범위(CONSTRUCTION 설계 문서 단계) 내 **기존 승인 산출물의 사후 정정**. 정정 실행 주체: TRIP-354 사이클 [기록](scribe) 단계. 실측 근거는 `_workspace/20260813-trip354-timeline-full-design/01b_ouroboros_seed.md`("A. 3-a 팀 결정" 절 결정 D·Q4·Q5 · "B. 정본 반영 선택" 절) · `00_gates.md`(게이트①·② 원장, "사이클 중 정정" 절의 Q5 정정 경위) · `03_implementer_notes.md` §1(왜 이 설계인가 — 재사용 근거). 이번 항목이 손댄 `aidlc/` 파일 = `construction/u3-ai-itinerary/functional-design/frontend-components.md`(§1·§2·§3·§4, 4곳) + 이 `audit.md` append, 총 2파일(`git status aidlc/` 실측 일치). `aidlc-state.md`는 미변경(이 사이클은 Post-Inception Progress 대상 없음 — 코드 구현 소급 기록은 리포 devlog·구조 지도 소관, [기록] 별도 처리).

---

## CONSTRUCTION — U5 Records & Reflection · Functional Design 착수 (Step 1~4)
**Timestamp**: 2026-08-22T05:06:43Z

**User Input** (원문, 시간순):
1. "aidlc로 u5u6 설계실체 만들려고하는데 어케함"
2. "그럼 내가 어떻게해야할지 단계별로 알려줘"
3. "이 세션에서 그대로 시작해도됨? Yes or No"
4. "기존 레포에 구현된거나 결정된거있으면 그거를 무조건 따르게할거야 ㅇㅋ?"
5. "그냥 시작해"

**AI Response**: SCOPE.md 현행 범위(CONSTRUCTION 설계 문서 단계 · 새 유닛 진입은 사용자 명시 지시 필요)를 확인하고, 입력 5가 요구하는 **U5 진입 명시 지시**로 판정해 착수했다. 유닛 순서는 U5 → U6(의존: U6 마이페이지 US-NOTIF-06~08이 U1·U5 리드). 범위 기본값은 **얇게**(FD 우선)로 잡고 계획서 Q9에서 확정하도록 부쳤다.

입력 4는 **실장 우선 원칙의 명시 지시**로 받아 계획서 §"실장 우선 순위"에 정본화했다 — 순위: (1) 리포 실물 (2) 패키지 계약 정본(openapi·README·conventions) (3) 라이브 Figma (4) 기존 aidlc 산출물 (5) 인셉션 문서. 인셉션이 실물과 충돌하면 **인셉션이 지고 정정 상신 대상으로만 기록**한다. 예외 1건을 명시했다 — 실물이 INV-1~4·법정로그 append-only·요구사항과 정면 충돌할 때는 버그일 수 있어 설계로 굳히지 않고 사용자에게 올린다.

Step 1(유닛 컨텍스트)·1b(기존 자산 실측)·1c(라이브 Figma 밴드 `j` 대조)를 수행하고 계획서를 `construction/plans/u5-records-reflection-functional-design-plan.md`에 저장, **Q1~Q9 `[Answer]:` 대기 상태로 정지**했다.

실측의 핵심 발견 3건:
- **U5는 그린필드가 아니다** — `visit_check`(V2.21) 테이블·코드 4파일·openapi `/trips/{tripId}/visits*` **5경로**가 이미 실재하고 **US-REC-01이 백엔드 계약까지 완료**돼 있다. 다만 코드 소유 모듈이 U4 `itinerary-recalculation`이라 정본(C12)과 다르다. V2.21 주석이 *"이 테이블은 U5 C12 Travel Archive 로 이관 예정이고, 확장은 U5 가 승계한다"*로 이관을 명시적으로 U5에 남겼다 → Q1.
- **C13(AI Reflection)의 AI 표면이 없다** — `ai/docs/openapi.json` 경로는 `/ai/v1/itinerary/{generate,validate,repair,alternatives,explanations}` **5종**뿐(루트 CLAUDE.md의 "경계 3종"은 낡은 값 — 실측 5종). 회고·요약·스타일 계열 진입점 부재 → Q2.
- **라이브 `j03`의 회고 본문이 통계 재조합**("오늘은 광안리와 미술관 등 4곳을 방문했어요. 12km를 이동했고 사진 6장을 남겼어요.")이라 **AI 정상 생성과 실패 폴백 기본 카드가 문자열 수준에서 구분되지 않는다**(D-U5-1) — Q2의 실질 근거.

밴드 `j` 관측: 행 `y=14190`, **17프레임 = 코드 7(j01~j07, 결번 없음) + 상태 변형 10**. `[보관]` 구세대 없음(단일 세대). 스크린샷 2장(`j01 default`·`j03 default`) 시각 확인, 나머지 15프레임은 노드 트리 이름 수준 매핑 — 시각 확인은 산출물 생성 단계에서 이어간다. 드리프트 **D-U5-1~10** 도출(정합 확인 1건 포함: 폴백 화면 5종이 전부 그려져 있고 소요시간 표기 0건 — ADR-0011·INV-3 준수).

**Context**: CONSTRUCTION 진입 — U5 Functional Design Step 1~4(`.aidlc-rule-details/construction/functional-design.md`). 이번 항목이 손댄 파일 = `construction/plans/u5-records-reflection-functional-design-plan.md`(신규) + 이 `audit.md` append, 총 2파일. `aidlc-state.md`는 **아직 미변경** — 스테이지 완료가 아니라 착수이므로 승인 게이트 통과 후 갱신한다.

---

## CONSTRUCTION — U5 Functional Design · 답변 수집 및 산출물 생성 (Step 5~7)
**Timestamp**: 2026-08-22T09:12:00Z

**User Input**: "Q2는AB병행, Q5=B 나머지는 A ㄱㄱ"
→ 해석: **Q1=A · Q2=A+B 병행 · Q3=A · Q4=A · Q5=B · Q6=A · Q7=A · Q8=A · Q9=A**

**AI Response**: Q2의 "AB 병행"은 모호할 수 있어 **리포 실물 패턴을 근거로 확정 해석**하고 그 해석을 사용자에게 명시 통지한 뒤 진행했다(별도 명확화 파일 생성 없음) — backend에 이미 `AI_SCHEDULE_MODE=fake|http` 모드 스위치 선례가 있으므로, 회고 생성도 **포트 1개 + 어댑터 2개**(`ReflectionGeneratorPort` ← `LlmGatewayReflectionAdapter`(A·기본) / `AiServiceReflectionAdapter`(B·계약만 명세, 개통 이연))로 두고 `AI_REFLECTION_MODE=rule|llm|http`로 가른다(DEC-U5-5). B를 지금 개통하면 `ai/`에 회고 표면이 없어 U4 G-U4-3와 같은 외부 블로커가 생긴다.

산출물 **4종**을 `construction/u5-records-reflection/functional-design/`에 생성했다:
- `business-logic-model.md` — 3계층 소유 지도 · **DEC-U5-1~13** · 이관 집행(§3) · 회고 3단 폴백 사슬(§5) · **이동 거리 계약 공백(§6)** · 이벤트 3 · 갭 **G-U5-1~10**
- `domain-entities.md` — 승계 1(`visit_check` 확장 없음) · 신설 5(`visit_photo_meta`·`visit_memo`·`reflection`·`trip_summary`·`style_analysis`, V2.28~V2.32 제안) · 재사용 6 · **INV-U5-01~09** · 이벤트표 · 소유 경계표
- `business-rules.md` — **BR-U5-01~52**(+08a) · **PBT-U5-1~5** · 미결 **O-U5-2~6**
- `frontend-components.md` — 라우트 7 · pages 7 슬라이스 · **feature 2분할**(`record`/`reflection`) · shared 변경 4 · 구조 가드 5 · testID 23 · **PBT-U5-F1~F4**

**사이클 중 자기 정정 2건**(둘 다 근거 재확인으로 뒤집힘):
1. **D-U5-3 철회** — 계획서 단계에서 노드 트리 이름만으로 "`j02`에 3종 구분·전후 장소가 없다"고 판정했으나, 스크린샷 실측에서 **계획｜실제｜변경 3탭 세그먼트 + 행별 라벨 배지 + `△△카페 → ◇◇실내카페` 전후 장소**가 모두 확인됐다. US-REC-04 요구를 충족하며 남은 미결은 3탭의 동작 축뿐이다(O-U5-3).
2. **G-U5-6 철회 · O-U5-1 종결** — `j05`의 "평균 체류 72분"을 BR-U4-37과의 정면 충돌로 올렸으나, U4 `domain-entities.md` **INV-U4-03**이 이미 *"INV-3은 예측 소요시간의 표시 금지이고 사후 실적은 U5 기록 소관"*으로 갈라 뒀다. BR-U4-37은 **U4 화면 한정 규칙**이다 → **DEC-U5-13 · BR-U5-08a**로 확정(누적 통계 평균은 표시, 개별 방문 체류는 계속 미노출). 프런트 가드 화이트리스트 지침도 함께 정정.

**U4 사후 정정 2건(승인 산출물 수정)**: `u4-in-trip-planb/functional-design/domain-entities.md`
- §3.1 `visit_check` 이관 예고 블록 뒤 — **이관 확정** + `ArchiveFacade.getCompletedSlots` 경유 + **`VisitChecked` 발행 주체 U4→U5 변경**을 소급 기록.
- §3.3 `actual_route_point` 각주 — "U5로 이관 예정"을 **취소선 처리하고 철회**(U4 소유 유지). 아울러 **이 테이블이 아직 실장되지 않았다는 실측**과, 그 결과 U5 stats가 `distanceSource: VISIT_LINE` 근사로 운용되다 실장 시 `ROUTE`로 승격한다는 사실을 병기.
- 둘 다 **요구사항 근거가 아니라 U5 설계 결정의 소급 기록**이다 — 다음 사이클이 요구사항 근거로 인용하지 않도록 각 블록에 날짜·출처(DEC 번호)를 명시했다.

**실측 제약(정직 표기)**: 라이브 Figma는 **5프레임만 스크린샷 확인**(`j01 default`·`j02`·`j03 default`·`j04`·`j05`). 나머지 12프레임은 **Figma MCP 호출 상한**(View seat)에 걸려 노드 트리 이름 수준 매핑에 머물렀다. 이 한계를 `frontend-components.md §10`에 명시하고, 프런트 티켓 착수 전 시각 확인을 선행 조건으로 남겼다 — 이번 사이클에 이름 기반 판정 1건이 실제로 뒤집혔기 때문이다.

**Context**: CONSTRUCTION — U5 Functional Design Step 5~7. 손댄 파일 = U5 산출물 4(신규) + U4 `domain-entities.md`(사후 정정) + 이 `audit.md`, 총 6파일. `aidlc-state.md`는 **승인 게이트 통과 후** 갱신한다.

---

## CONSTRUCTION — U5 Functional Design 승인 · NFR 스킵 · U5 설계 단계 종료
**Timestamp**: 2026-08-22T09:41:00Z

**User Input**: "승인, NFR 스킵 기록하고 U5 종료"

**AI Response**: Functional Design 승인으로 처리하고(Step 8 게이트 통과), 계획서 Q9=A와 이번 지시에 따라 **NFR Requirements·NFR Design을 SKIPPED로 기록**한 뒤 U5 설계 단계를 종료했다.

**스킵 사유(기록용)**:
- **NFR Requirements** — U0·U1·U3·U4 상속 + FD가 이미 배치까지 기술. 새 축으로 보이던 3건도 상속으로 덮인다: **사진 저장**은 로컬 참조·서버 메타만이라 스토리지 비용축이 서지 않고(DEC-U5-9), **오프라인 큐**는 기기 로컬이라 서버 인프라가 0이며(DEC-U5-10), **위치·EXIF**는 U4 LEGAL-U4-01~05와 V1.3 `gps_recording_opt_in`을 그대로 승계한다(INV-U5-04). 재개 조건 = `shared/photo` 신규 의존성이 EAS 재빌드를 요구하는 것으로 확인되거나 `ObjectStoragePort`(U7 공개 사진)가 개통될 때.
- **NFR Design** — 룰의 CONDITIONAL("NFR Requirements was skipped → skip") 미충족. 신규 논리 컴포넌트는 테이블 5종뿐이고 `domain-entities.md §7`이 이미 기술한다.
- **Infrastructure Design** — U0·U1·U3·U4와 동형(배포/클라우드 계획 부재).
- **Code Generation** — SCOPE.md 범위 제외(팀 직접 개발).

`aidlc-state.md`에 U5 블록을 추가했다 — 스테이지 체크박스 5종, 산출물 4종, 핵심 결정, **U4 사후 정정 2건**, **사이클 중 자기 정정 2건**(D-U5-3 · G-U5-6/O-U5-1), 후속 작업 목록(backend 모듈 2 신설·코드 이관·마이그레이션 5·openapi 확장 / ai 회고 표면 협의 / frontend 7화면·`shared/photo`·지도 확장·가드 5 / 선재 dbml 정합 / 인셉션 정정 상신 2 / U4 의존 1 / 디자인 확인 1 / **시각 미확인 12프레임**). 목록 끝줄은 `U5~U9 대기` → **`U6~U9 대기`** 로 갱신.

**U5 최종 산출물**: `construction/u5-records-reflection/functional-design/` **4종**(`business-logic-model.md` · `domain-entities.md` · `business-rules.md` · `frontend-components.md`).

**Context**: CONSTRUCTION — U5 Functional Design Step 8~9(승인 기록·상태 갱신) + NFR 2스테이지 SKIP 기록. 손댄 파일 = `aidlc-state.md` + 이 `audit.md`, 총 2파일. 다음 유닛(U6 Notification & Settings)은 SCOPE.md 규칙대로 **사용자 명시 지시 대기**.

---

## Post-Design Correction — U5 셀프 검수 (사용자 요청 "u5 셀프검수한번더")
**Timestamp**: 2026-08-22T10:24:00Z

**User Input**: "u5 셀프검수한번더 ㄱㄱ"

**AI Response**: 승인된 U5 산출물 4종을 리포 실물과 재대조하고 내부 정합(번호 연속성·상호참조·모순)을 점검했다. **결함 6건을 찾아 전부 정정**했다.

**실물과 어긋난 사실 2건(둘 다 존재하지 않는 이름을 썼다)**:
1. **`trip_base` 테이블은 없다** — V2.4의 실제 테이블은 `base_assignment` + `trip_base_day`다. `domain-entities.md` 2곳 + `business-logic-model.md` §4.3을 정정.
2. **`poi.activity_category` 컬럼은 없다** — V2.6은 컬럼 추가가 아니라 `poi_category_check` **CHECK 제약 교체**이고, 실제 컬럼은 `poi.category`(허용값 8종 `명소·맛집·카페·야경·자연·쇼핑·문화·액티비티`)다. `domain-entities.md` 재사용표 정정.

**내부 정합 3건**:
3. **상호참조 오류** — 오프라인 충돌 판정 기준을 `BR-U5-24`(오프라인 회고 규칙)로 가리켰다. 올바른 번호는 **`BR-U5-22`**. 2곳 정정.
4. **상호참조 오류** — 스타일 분석의 계정 단위 생애주기를 `INV-U5-07`(회고 stats)로 가리켰다. 올바른 번호는 **`INV-U5-08`**.
5. **PBT-U5-5 자기모순** — "어떤 회고 응답에도 duration 필드가 없다"로 썼는데 같은 사이클의 **DEC-U5-13이 `avgDwellMinutes` 노출을 확정**했다. 성질을 "**이동 소요시간**(travel duration) 금지 + `style_analysis.avgDwellMinutes` 단일 예외"로 좁혔다. 그대로 뒀으면 블로킹 게이트가 그린 화면을 막았을 것이다.

**스토리 커버리지 누락 1건(가장 큰 결함)**:
6. **US-REC-03(GPS 방문 기록)의 규칙이 통째로 없었다.** Q5=B로 `actual_route_point` 소유가 U4로 남으면서 **화면 동작 규칙까지 같이 빠졌다** — 소유가 U4라도 "동의 없으면 레이어 비활성", "OFF 전환 시 즉시 중단", "미실장 구간엔 방문점 연결선을 실제 동선으로 그리지 않는다"는 U5가 정해야 한다. `business-rules.md §9`를 신설해 **BR-U5-53~56**(US-REC-03 3건 + US-REC-11 재열람 1건)을 추가했다. 이 누락은 **14 스토리 전수 커버리지 표**(`business-logic-model.md §10` 신설)를 만들면서 드러났다 — 표 없이 규칙만 쓰면 "소유가 남에게 간 스토리"가 조용히 빠진다.

**추가 관측 1건**: **D-U5-11** — `j05`의 카테고리 막대가 `카페·자연·**미식**·기타`인데 `poi.category` 8종에 **`미식`은 없고 `맛집`이 있다**. 표시 매핑표가 필요하고 8종→4줄 집계 규칙도 미정 → **O-U5-7** 신설(U1 G-U1-10 동반유형 매핑과 같은 종류의 갭).

**확인만 하고 바꾸지 않은 것**: BR-U5-01~52 번호 **연속**(누락 0) · INV-U5-01~09 **연속** · `account`·`location_consent_state.gps_recording_opt_in`·`stay`(V2.26)·`visit_slot`(V2.7) 이름 **실재 확인** · `(tabs)/records.tsx`와 `app/records/style.tsx` 공존은 **리포에 같은 꼴 선례**(`(tabs)/explore.tsx` + `app/explore/places.tsx`)가 있어 유효 — 선례를 `frontend-components.md §1` 각주로 명시.

**Context**: 승인 완료된 U5 Functional Design 산출물의 **사후 정정**(SCOPE.md 현행 범위 내). 손댄 파일 = `u5-records-reflection/functional-design/` 3종(`business-logic-model.md`·`domain-entities.md`·`business-rules.md`) + `frontend-components.md` + 이 `audit.md`, 총 5파일. 스테이지 체크박스·승인 상태는 **변동 없다**(내용 정정이지 재승인 대상 아님). `aidlc-state.md`에 검수 결과 1줄을 병기한다.

---

## Post-Design Correction — U5 셀프 검수 2차 (사용자 요청 "셀프검수 한번더")
**Timestamp**: 2026-08-22T10:58:00Z

**User Input**: "셀프검수 한번더 ㄱㄱ"

**AI Response**: 1차 검수가 **문서 내부 정합·이름 대조**에 머물렀다고 보고, 2차는 **"설계가 전제한 코드 자산이 실제로 존재하는가"** 를 축으로 잡았다. 결함 **4건 추가 발견 · 전부 정정**. 이번 4건은 성격이 다르다 — 1차는 오타·오참조였고, 2차는 **결정의 근거가 사실이 아니었던 것**이다.

1. ★ **`LlmGatewayPort`가 backend에 없다(G-U5-11).** `grep -ril "llmgateway" backend/` = **0건**. backend의 LLM 관련 자산은 `ScheduleAgentWire`·`FakeScheduleAgent`·`HttpScheduleAgentAdapter`(= `ai/` **호출** 어댑터)뿐이고 LLM 게이트웨이 실체는 **`ai/` 패키지가 소유**한다. DEC-U5-5의 어댑터 ①을 "U2 자산 재사용"으로 쓴 것은 **틀렸다** — 실제로는 **LLM 벤더 직결 신규 구축**이고, 키·비용·프롬프트가 backend에 새로 생기며 "one external API = one owning module" 규칙상 **LLM 소유 모듈이 둘로 갈린다**. 정정: 어댑터 이름을 `VendorLlmReflectionAdapter`로 바꾸고, **기본값을 `rule`로 확정**했으며, `llm` vs `http` 선택을 **O-U5-6**으로 승격(정본 정합만 보면 `http`가 낫다는 판단 근거를 병기). 포트+어댑터 구조와 모드 스위치 **패턴** 자체는 `ScheduleAgentPort` 선례로 여전히 유효하다.
2. ★ **`ChangeLogFacade`에 조회 메서드가 없다(G-U5-12).** 실물은 **`append(command)` 단 하나**이고 읽기는 REST(`ChangeLogController.timeline` `@GetMapping`)로만 뚫려 있다. `ArchiveFacade.getRecords`가 "changelog를 조인한다"는 서술은 **경로가 없는 서술**이었다. 정정: 두 갈래(facade에 `findByTrip` 추가 / 화면이 REST 직접 호출)를 명시하고 **(a)를 기본**으로, **BR-U5-29가 성립하려면 이 확장이 선행**됨을 규칙에 각주로 박았다. U4도 쓰는 facade라 팀 확인 대상.
3. **`VisitChecked` 이벤트가 코드에 없다(G-U5-13).** `전체-API-서피스.md` 설계 문서에만 존재하고 backend 구현 0건. 따라서 "이관으로 **발행 주체가 U4→U5로 바뀐다**"는 서술은 미실장 이벤트에 대한 설계 서술이다 — **U5가 신설**하는 것으로 정정(`domain-entities.md` 이벤트표).
4. ★ **프런트 `features/record` → `features/execution` import는 금지돼 있다(G-U5-14).** ESLint `import/no-restricted-paths`가 "features/\* may not import another feature"를 강제하고 `src/__tests__/importBoundary.test.ts`가 그 규칙의 생존까지 잠근다. `actualDistance.ts`를 "재사용(이동 대상 아님)"으로 쓴 것은 **구조적으로 불가능**했다 — `accumulateDistanceKm`·`GeoPoint`의 **`shared/geo/` 승격**으로 정정. U4 자산을 옮기는 일이라 U4 프런트 티켓과 조율이 필요하다.

**추가 미결 1건**: **O-U5-8** — 사진 EXIF 좌표 저장을 `gps_recording_opt_in`(V1.3 L3)으로 게이팅하는 것이 **개인정보 목적 범위**에 맞는가. U4의 "위치 동의 축 신설 금지" 지시를 따라 같은 축을 재사용했으나(INV-U5-04), 그 동의는 *이동 중 GPS 수집*에 대한 것이고 사진 EXIF는 수집 경로가 다르다. 축 신설 대신 **동의 고지 문구에 사진 EXIF를 포함**하는 선택지를 병기했다.

**방법론 관찰(다음 유닛에 적용)**: 1차와 2차가 잡은 결함의 성격이 갈렸다 — 1차는 문서-문서 대조(오참조·자기모순·커버리지), 2차는 **문서-코드 대조("이 포트/파사드/이벤트가 실제로 있는가")**. FD 단계에서 **"설계가 이름으로 호출한 코드 자산"의 존재 확인을 체크리스트로 돌리면** 2차 결함 4건은 초안에서 걸렸다. `docs/conventions/anti-patterns.md` 후보.

**Context**: 승인 완료된 U5 산출물의 사후 정정 2차(SCOPE.md 현행 범위 내). 손댄 파일 = `business-logic-model.md`·`domain-entities.md`·`business-rules.md`·`frontend-components.md` + 이 `audit.md`, 총 5파일. 스테이지 승인 상태 **변동 없음**. `aidlc-state.md`에 2차 검수 1줄 병기.

---

## CONSTRUCTION — U6 Notification & Settings · Functional Design 착수 (Step 1~4)
**Timestamp**: 2026-08-23T01:20:00Z

**User Input**: "u6 착수 ㄱㄱ"

**AI Response**: SCOPE.md의 "새 유닛 진입은 사용자 명시 지시" 요건을 충족하는 지시로 판정하고 U6에 진입했다. 범위 기본값은 직전 합의대로 **얇게 + 알림 코어**로 잡고 Q2에서 확정하도록 부쳤다. 계획서를 `construction/plans/u6-notification-settings-functional-design-plan.md`에 저장하고 **Q1~Q9 대기 상태로 정지**했다.

**절차 보강(U5 2차 검수의 교훈 적용)**: U5에서 "설계가 이름으로 부른 코드 자산이 실제로는 없던" 결함이 4건 나왔으므로, U6는 **Step 1b에서 자산 존재를 grep으로 선행 검증**했다. 계획서 자산표의 '실재' 칸은 전부 실측이며 추정으로 적은 칸이 없다.

실측의 핵심 발견 4건:
- ★ **아웃박스 구현이 없다.** `outbox_event` 테이블은 V1.0에 실재하지만(`event_id` UNIQUE·`published_at`·`attempts`·미발행 부분 인덱스) **Kotlin 구현 0건**(`*Outbox*` 파일 0 · `Outbox` 심볼 0). 인셉션은 U6를 "전 유닛 이벤트를 구독하는 순수 구독자"로 정의했는데 **구독할 인프라가 없다.** U5의 `VisitChecked`·`ReflectionReady` 미실장(G-U5-13)도 같은 뿌리다 → **Q1**(U6가 디스패처를 떠안을지, 동기 호출로 시작할지, U0 보완 티켓으로 뺄지).
- **설정 백엔드는 이미 상당 부분 있다.** openapi `/me/*` **12경로** 실재(`/me/profile`·`/me/preferences`·`/me/location-consent`(+`/os-permission`)·`/me/deletion`·`/me/consents` 등) → US-NOTIF-09·10·11은 새 도메인 규칙이 거의 없다. **12 스토리가 "거의 다 된 것"과 "아무것도 없는 것"으로 정확히 갈린다.**
- **`expo-notifications`가 이미 설치·플러그인 등록돼 있다**(`package.json ~0.32.17` · `app.config.ts:38`), 사용처는 0. U4의 `expo-task-manager`(신규 설치 + EAS 재빌드 1회)와 **상황이 다르다** — 재빌드 없이 배선만으로 될 가능성이 있어 Q3에서 확인 대상으로 뒀다.
- **US-NOTIF-12(제휴 고지)는 U1에서 이미 구현됐다.** `features/stay/ui/OtaChoiceSheet.tsx`(Figma `1348:1538` · TRIP-457 · BR-U1-30)가 실재하고, 라이브 `l07`은 설정 화면이 아니라 **숙소 상세 위의 같은 시트**다(D-U6-8). U6 신규분은 "다시 보지 않기"의 저장·재활성화뿐 → Q7.

밴드 `l` 관측: 행 `y=18490`, **16프레임 = 코드 7(l01~l07·결번 없음) + 상태 변형 9**. 드리프트 **D-U6-1~9** 도출(정합 확인 4건 포함 — `l02` 하단 "모든 알림을 꺼도 보안·계정 알림은 알림함에 표시" 문구가 US-NOTIF-05 예외와 정확히 일치).

⚠️ **이번 사이클의 최대 취약점 — Figma 시각 확인 0프레임.** Figma MCP **호출 상한**(View seat Professional)이 U5 사이클에서 소진돼 스크린샷을 한 장도 못 떴다. 밴드 `l` 대조는 **전부 노드 트리 이름 수준 매핑**이며, U5에서 이름 기반 판정 1건(D-U5-3)이 스크린샷으로 뒤집힌 전례가 있으므로 **D-U6-1·2는 잠정**으로 표기하고 상한 해제 후 재확인을 계획에 명시했다.

**Context**: CONSTRUCTION 진입 — U6 Functional Design Step 1~4(`.aidlc-rule-details/construction/functional-design.md`). 손댄 파일 = 계획서 1(신규) + 이 `audit.md`, 총 2파일. `aidlc-state.md`는 승인 게이트 통과 후 갱신한다.

---

## Post-Design Correction — 로컬 와이어프레임 export 대조 (U5 정정 + U6 계획서 갱신)
**Timestamp**: 2026-08-24T02:40:00Z

**User Input**: "문서 폴더에 trippilot 짬통 폴더에 와이어프레임들 넣어놨거든? 너가 본거랑 같은지 비교 ㄱㄱ"

**AI Response**: `~/Documents/trippilot 짬통/TripPilot 와이어프레임 (1)/`(PNG **225장**)을 라이브 캔버스 파싱 결과(최상위 프레임 216)와 코드 단위로 대조했다. **113개 화면 코드 중 110개가 개수까지 일치**하고, 차이는 `c02`(-1)·`c09`(-1)뿐인데 그것도 `c09b-pref`가 export에서 **디렉토리로 빠진** 산출물 형식 차이지 드리프트가 아니다. **밴드 `j`(17)·`l`(16)은 완전 일치** — U5·U6 작업이 같은 세트 위에 있음을 확인했다.

이 export로 **Figma MCP 호출 상한을 우회**해, 그동안 못 본 프레임을 시각 확인했다(`l01`·`l02`·`l03`·`j01 sync-conflict`). 그 결과 **잠정 판정 2건이 뒤집히고 U5 규칙 1건이 폐기**됐다.

**U6 계획서 갱신(승인 전 문서 — 자유 수정)**:
- **D-U6-1 철회** — "`l01`에 종류 구분이 없다"는 틀렸다. 각 행이 아이콘 + `숙소 · 방금`·`Plan-B · 10분 전`·`일정 · 1시간 전`·`회고 · 어제`·`시스템 · 2일 전` 라벨을 단다. 미읽음 빨간 dot, Plan-B 행에 `대안 일정 보기 ›`(US-NOTIF-03 ✅). 일정 알림 본문 `다음 일정: ○○ · 14:30 · 840m` — **거리만·소요시간 없음**(INV-3 ✅).
- **D-U6-2 확정** — `l02`는 **7행 × 2채널(푸시·인앱) = 토글 14개**다(이름 파싱의 "14"는 행이 아니라 토글 수였다). 스토리 8종이 화면에선 7행이고 **커뮤니티 좋아요·댓글이 1행으로 병합**돼 있다. **기본값도 읽혔다** — `일정 시작 전`·`Plan-B 재계획`만 푸시 OFF·인앱 ON.
- **D-U6-10 신설** — `l01`에 `시스템` 종류가 실재하는데 `l02` 토글엔 없다. 하단 문구("모든 알림을 꺼도 보안·계정 알림은 알림함에 표시")의 실체이며, `NotificationKind`는 **8종(토글 가능 7 + `SYSTEM`)** 이라는 뜻이다.
- **D-U6-11 신설** ★ — `l03` 메뉴 6행 중 **3행이 U7(커뮤니티) 소관**(`내 일정 공개/공유 설정`·`내가 공유한 일정`·`숨긴 사용자 관리`). 1차 범위 밖인데 화면에 있다 → Q2 범위 결정에 직접 영향.
- **D-U6-12 신설** ★ — `l03` 스타일 카드의 **dot 게이지 3축(여유로움·미식취향·활동성)이 U5 `style_analysis`에 없다**. US-NOTIF-08 스토리 원문("밀도·반경")과도 축이 다르다.
- **D-U6-13 신설** — `l03` 상단 구성(프로필·취향 칩 3·여행 카운트 3구간·세그먼트·여행 카드 `숙소 미등록` 칩) 확인, US-NOTIF-07 ✅.
- **Q8 개정** — "커뮤니티 2종을 넣나"가 아니라 **"이미 활성 토글로 그려져 있는데 U7 없는 동안 어떻게 다루나"** 로 질문을 다시 세웠다. 선택지도 그에 맞게 교체(A=만들되 행 숨김·B=화면대로 노출·C=빼고 U7에서 확장).
- **U4 G-U4-6 미반영 확인** — "Plan-B 민감도(적게/보통/많이) UI를 `l02`에 신설"이 **실물에 없다.** `Plan-B 재계획` 행은 토글 2개뿐.

**U5 사후 정정(승인 산출물)**:
- **BR-U5-21 정정** — 충돌 해소 **단위가 방문(레코드)별**임을 명시. 화면 문구가 "항목마다 어느 버전을 유지할지 선택하세요"이고 카드가 방문마다 뜬다(`동기화 충돌 2건`), 적용은 `[선택한 버전으로 동기화]`로 일괄. 전역 일괄 선택으로 읽히던 초안을 고쳤다. **BR-U5-21a 신설**(2열 비교 항목 = 방문 시각·방문 상태·메모·사진 수, 버전 단위 라디오).
- ★ **BR-U5-23 폐기** — "사진 메타는 충돌 대상이 아니다(합집합 병합)"는 **화면과 정면으로 어긋난다.** `j01 sync-conflict`가 `사진 2장 (대기)` vs `사진 1장`을 버전 비교 항목으로 그린다. **BR-U5-23a**로 대체(선택 버전을 따르되 **버린 쪽의 로컬 자산은 지우지 않는다** — 기기 사진은 사용자 앨범 소유).
- **`style_analysis.trait_gauges` 신설**(`domain-entities.md`) — 3축 0~5. 산출식 미정이라 **O-U5-9**로 남겼다.

**방법론 관찰**: U5 1차 검수는 문서-문서, 2차는 문서-코드였고, 이번은 **문서-화면(시각)** 이다. 세 축이 각각 다른 종류의 결함을 잡았다 — 특히 BR-U5-23은 **문서상 완결적이고 코드와도 모순이 없었는데 화면과만 어긋났다.** 이름 기반 매핑으로는 절대 안 잡혔을 항목이다. 로컬 export가 있으면 Figma 호출 상한과 무관하게 전수 시각 확인이 가능하다는 것도 이번에 확인됐다.

**Context**: 손댄 파일 = `plans/u6-...-plan.md`(승인 전) · `u5-.../business-rules.md` · `u5-.../domain-entities.md` + 이 `audit.md`, 총 4파일. U5 스테이지 승인 상태 **변동 없음**. U6는 여전히 **Q1~Q9 답변 대기**.

---

## CONSTRUCTION — U6 Functional Design · 답변 수집 및 산출물 생성 (Step 5~7)
**Timestamp**: 2026-08-24T03:30:00Z

**User Input**: "전부 A로 ㄱㄱ" → **Q1~Q9 전부 A**

**AI Response**: 모호성 없어 명확화 파일 없이 진행했다. 산출물 생성 전 **로컬 export로 밴드 `l`을 추가 시각 확인**했다(`l05 default`·`l06 default`·`l02 permission-denied` 3장 추가 → 누적 **6/16**). 이 3장이 설계를 두 군데 바꿨다:

- **`l05` 실물**이 제휴 "다시 보기"를 **설정 화면의 계정 단위 토글**로 그린다 → 계획서 Q7 해설에서 권했던 **"기기 로컬 저장"을 철회**하고 **서버 저장으로 정정**했다(**DEC-U6-7a**). 설정에 있는 값이 기기마다 다르면 사용자 모델이 깨진다. 같은 화면에서 **`데이터 내보내기` 행이 실재하는데 `/me/*` 12경로에 대응 엔드포인트가 없다**는 것(G-U6-3)과, **취향 7행 중 `예산`이 `미설정`으로 그려져 U1 `G-U1-09`(예산 입력 화면 부재)의 해소 경로가 `l05`라는 것**(G-U6-6)도 확인했다.
- **`l06` 실물**은 위치 동의를 **토글 하나**로 그리는데 백엔드는 **3층**이다(`os_permission_mirror`·`legal_consent`·`gps_recording_opt_in`, `PUT`이 L2·L3를 받는다). **DEC-U6-11**로 "토글 하나가 L2·L3를 함께 움직이고 L1은 선결 조건"으로 확정했다 — 화면이 든 용도 3가지가 전부 L3 수집을 전제하고, L2만 켜고 L3를 끈 조합에 대응하는 UI가 없기 때문이다.
- **`l02 permission-denied`** 는 채널 판정 진리표 2행의 정본이다 — 푸시 컬럼 헤더가 `권한 필요` 칩으로 바뀌고 푸시 토글 전부 비활성, 하단 문구가 "푸시를 꺼도 인앱 알림은 알림함에 계속 누적됩니다"로 교체된다.

산출물 **4종**을 `construction/u6-notification-settings/functional-design/`에 생성했다:
- `business-logic-model.md` — **DEC-U6-1~11** · 전달 파이프라인(**인앱 적재가 푸시보다 먼저**) · 채널 판정 진리표 · catch-up · **시각 기반 알림은 이벤트가 아니다(DEC-U6-10 `notification_schedule`)** · 설정 배선표 · 갭 **G-U6-1~8** · 스토리 커버리지 12/12
- `domain-entities.md` — 신설 4(`notification`·`notification_toggle`·`push_token`·`notification_schedule`, V2.33~V2.36) + 재사용 8 + **INV-U6-01~09** + `NotificationKind` **8종** + 구독 이벤트표
- `business-rules.md` — **BR-U6-01~38**(번호 연속·중복 0 검증) · **PBT-U6-1~5** · 미결 **O-U6-1~6**
- `frontend-components.md` — 라우트 6 · pages 6 · feature 2분할(`notification`/`settings`) · `shared/push` 신설 · 구조 가드 5 · testID 18 · PBT-U6-F1~F3

**핵심 설계 결정**:
- **DEC-U6-1**: 아웃박스 디스패처를 U6가 설계하되 물리 배치는 **`backend/shared/`**(U6 모듈 아님 — U7도 쓴다). 테이블이 이미 폴링 퍼블리셔 모양(`ix_outbox_unpublished` · `attempts` · `event_id` UNIQUE)이라 스키마 재설계 불필요.
- **DEC-U6-10** ★: `TRIP_PRE`·`TRIP_DAY`·`SLOT_PRE` 셋은 **아무 일도 안 일어났는데 시각이 되어 발화**하므로 아웃박스로 못 만든다 → `notification_schedule` + 폴링 스케줄러. U4 `StalePartialSweeper` 선례라 신규 인프라 0.
- **INV-U6-02**(= BR-U6-13): **인앱함 적재가 푸시 발송보다 먼저이고 성공 여부와 무관** — "누락 0"의 유일한 근거.
- **INV-U6-01**: `notification.source_event_id` UNIQUE로 at-least-once 재시도가 **중복 알림이 되지 않게** DB가 보장.

**정직 표기**: 밴드 `l` **16 중 6 확인 / 10 미확인**. 특히 `l05 dialog`·`l06 dialog`는 **삭제 재확인·철회 재확인 다이얼로그**로 추정되고 **BR-U6-25·30의 문안 정본**이라 구현 착수 전 확인 필요를 `frontend-components.md §10`에 명시했다. export가 로컬에 있어 Figma 상한과 무관하게 가능하다.

**U6는 단독으로 완결되지 않는다**(G-U6-2): 구독할 이벤트 `StayRegistered`·`PlanBTriggered`·`ReflectionReady`·`VisitChecked`가 **전부 미실장**이다. U6는 구독 계약과 매핑을 정의하고 발행부는 각 유닛이 붙인다.

**Context**: CONSTRUCTION — U6 Functional Design Step 5~7. 손댄 파일 = U6 산출물 4(신규) + 이 `audit.md`, 총 5파일. `aidlc-state.md`는 **승인 게이트 통과 후** 갱신한다.

---

## CONSTRUCTION — U6 Functional Design 승인 · NFR Requirements 착수 (+ FD 오진 정정)
**Timestamp**: 2026-08-24T04:15:00Z

**User Input**: "일단 문서부터 해봐"

**AI Response**: 직전 완료 메시지의 승인 게이트에 대한 **승인 + 문서 트랙 계속**으로 해석해 U6 Functional Design을 승인 처리하고 `aidlc-state.md`에 U6 블록을 추가했다. 이어 **NFR Requirements Step 1~4**를 수행하고 계획서를 `plans/u6-notification-settings-nfr-requirements-plan.md`에 저장, **Q1~Q6 대기 상태로 정지**했다.

**★ NFR 착수 실측에서 FD 오진 2건을 발견해 산출물을 정정했다.** 원인은 하나다 — 내가 **`backend/shared/`를 뒤졌는데 그런 디렉토리가 없다**(실제 구조는 `backend/common/{core,security,test-support}`). 없는 경로를 grep하고 "0건"을 사실로 적었다. U5 2차 검수에서 잡았던 것과 **같은 종류의 실패를 반복**한 것이다.

정확한 지형(실측):
- `common/core/event/`에 **`DomainEvent`·`DomainEventPublisher`·`EventEnvelope` 계약 + `EventEnvelopePropertyTest`(PBT)** 실재
- `app/event/SpringDomainEventPublisher`(+테스트)로 **인프로세스 발행이 이미 배선**돼 있고, auth·itinerary-generation·saved-accommodation·itinerary-recalculation **4개 모듈이 발행자를 주입**받는다
- **실제 발행 중인 이벤트 5종**: `auth.AccountCreated` · `auth.AccountDeletionRequested` · `auth.AccountDeletionCancelled` · `itinerary.ItineraryGenerated` · `itinerary.ItineraryConfirmed`
- V1.0에 `outbox_event` **+ `shedlock`** 테이블 실재
- **없는 것은 아웃박스 릴레이 하나**다. `EventEnvelope.kt` 주석이 이미 예고한다: *"아웃박스 릴레이(@Scheduled + ShedLock)는 후속 — 여기선 계약 타입만 소유한다"*

정정 내용:
- **DEC-U6-1** 배치를 `backend/shared/` → **`backend/common/core`(기존 `event/` 패키지)** 로 수정.
- **DEC-U6-1a 신설** — 릴레이가 하는 일은 **인프로세스 발행을 at-least-once로 승격**하는 것임을 명시. 현재 `SpringDomainEventPublisher`는 같은 JVM·트랜잭션 맥락이라 "실패해도 본업이 살아야 하는" 알림 소비자에겐 부족하다.
- **§0.1 신설**(`business-logic-model.md`) — 조각별 실재/부재 표로 초안 오진을 드러내고 정정.
- **G-U6-1 재작성**("구현 0건" → "릴레이만 없음" + **ShedLock 라이브러리 의존성 추가 선행**), **G-U6-2 재작성**("이벤트 0" → "U6가 필요한 3종이 없음, auth 3·itinerary 2는 발행 중"), **G-U6-9 신설**(이벤트 이름 규약 `{module}.{EventName}`이 실장 정본 — 인셉션 정정 상신).
- `domain-entities.md` 구독 이벤트표를 실장 규약 기준으로 재작성하고, **`itinerary.*` 2종은 이미 발행 중이라 리마인드 스케줄 적재를 U3 코드 수정 없이 구독만으로 붙일 수 있다**는 점(= U6에서 가장 먼저 동작시킬 수 있는 경로)을 명시. 소유 경계표에 `shedlock` 행 추가.

**NFR Requirements 계획서**: 실측 9항목(스케줄러 패턴·`shedlock`·ShedLock 라이브러리 부재·actuator·**`micrometer-registry-otlp` 실재**·resilience4j 부재·`expo-notifications` 등록됨·`/me/marketing-consent`·`location_legal_log`) 기반으로 **Q1~Q6**을 세웠다 — 야간 조용시간(★ O-U6-4 승격) · 발송량 상한 · 릴레이 재시도 포기 기준 · 토큰/알림 보존 · 관측 지표 · 성능 예산. **예상 델타는 2개뿐**(ShedLock 라이브러리 · Expo Push 어댑터), 나머지는 상속·미도입.

**Context**: CONSTRUCTION — U6 FD Step 8~9(승인·상태 갱신) + NFR Requirements Step 1~4. 손댄 파일 = `aidlc-state.md` · `u6-.../business-logic-model.md` · `u6-.../domain-entities.md` · `plans/u6-...-nfr-requirements-plan.md`(신규) + 이 `audit.md`, 총 5파일.

---

## CONSTRUCTION — U6 NFR Requirements 산출물 생성 (Step 5~7)
**Timestamp**: 2026-08-24T05:05:00Z

**User Input**: "야간 조용시간 ㅈ까고 그냥 발송해 나머지는 A" → **Q1=B · Q2~Q6=A**

**AI Response**: Q1=B(야간 조용시간 미도입)를 그대로 반영하되, **성립 조건 하나를 규칙으로 박았다** — **LEGAL-U6-02: 이 경로로는 정보성(거래·서비스) 알림만 발송한다.** 광고·마케팅성은 `NotificationKind` 8종에 없고 추가하지 않으며, 마케팅 수신은 `/me/marketing-consent`(실재)를 쓰는 별도 경로다. **LEGAL-U6-03**으로 "LEGAL-U6-02가 LEGAL-U6-01의 성립 조건"임을 명시하고, **광고성 종류 추가 요구가 들어오면 조용시간 미도입 결정을 전면 재검토**하도록 재평가 트리거에 걸었다. 사용자 결정을 좁히지 않으면서 근거를 문서에 남기는 방식이다.

산출물 **2종**:
- `nfr-requirements.md` — **COST 5 · REL 6 · PERF 4 · DATA 5 · LEGAL 4 · OBS 4 · SEC 3 = 31 요구** + 상속 목록(재서술 0) + PBT는 FD의 5종을 그대로 게이트로 사용 + **재평가 트리거 6**
- `tech-stack-decisions.md` — 상속 8 · **U6 델타 2** · 프런트 신규 의존성 **0** · 미도입 6 · 백엔드 신규 자산 요약 · 개발 중 처리 3

**델타가 2개뿐인 이유(실측)**: `@Scheduled` 스케줄러 패턴 실재 · `spring-boot-starter-actuator`(`libs.versions.toml:20`)와 **`micrometer-registry-otlp`(:56) 실재**(관측 파이프라인 신규 구축 0, 카운터 4종만 얹음) · `shedlock` **테이블** 실재 · `expo-notifications` **설치 + `app.config.ts:38` 플러그인 등록 완료**.
- **델타 1 = ShedLock 라이브러리 추가** — 테이블은 V1.0부터 있는데 `libs.versions.toml`에 라이브러리 항목이 없다. **U0 스캐폴딩 부채의 잔여분**이며 릴레이 단일 실행(REL-U6-04)의 선결 조건이다.
- **델타 2 = `PushPort` + `ExpoPushAdapter`** — 인셉션의 포트 계약은 유지하고 어댑터만 Expo로. "one external API = one owning module = one adapter port" 규약 준수, 무료 티어 초과 시 `FcmAdapter` 교체가 포트 뒤에서 끝난다.
- **프런트 신규 의존성 0** — U4 `expo-task-manager`(신규 설치 + EAS 재빌드 1회)와 결정적으로 다른 점. 다만 "재빌드 불필요"를 단정하지 않고 **개발 빌드에서 권한·토큰 획득을 먼저 확인**하도록 적었다.

**새 축으로 인정한 것 4가지**(U0~U5 상속으로 안 덮이는 것): COST 발송량(기존 COST는 지도 쿼터·LLM 토큰뿐) · REL 내부 비동기 전달 실패(기존 복원력은 외부 포트 폴백 중심) · DATA 계정 단위 시계열 정리(기존은 여행 단위 파기) · **SEC 잠금화면 노출**(SEC-U6-01 — 푸시 본문이 잠금 상태에서 그대로 보이므로 숙소 주소 전체·이메일 금지, `l01` 실물 문안 수준이 상한). SEC-U6-02(로그아웃 시 기기 토큰 무효화 — 안 하면 **다음 사용자에게 이전 사용자 알림이 간다**)도 이 축에서 나왔다.

**개발 착수 순서 제안을 문서에 남겼다**: `itinerary.ItineraryGenerated`가 **이미 발행 중**이므로, ShedLock 추가 + 릴레이 첫 배선 후 이 이벤트를 구독해 리마인드 스케줄을 적재하면 **U3 코드 수정 없이 첫 경로가 열린다**. U5·U6 설계 전체의 전제를 실증하는 최소 작업이다.

**Context**: CONSTRUCTION — U6 NFR Requirements Step 5~7. 손댄 파일 = `u6-notification-settings/nfr-requirements/` 2종(신규) + 이 `audit.md`, 총 3파일. **승인 게이트 대기** — 승인 시 다음은 NFR Design 판단.

---

## CONSTRUCTION — U6 NFR Requirements 승인 · NFR Design SKIP · U6 종료 · 1차 유닛 전량 완료
**Timestamp**: 2026-08-24T05:40:00Z

**User Input**: "ㅇㅋ 일단 승인함"

**AI Response**: 직전 완료 메시지의 승인 게이트에 대한 승인으로 처리하고, 같은 메시지에서 권고했던 **NFR Design SKIP**까지 함께 적용해 U6 설계 단계를 종료했다(사용자가 "승인, NFR Design 스킵하고 U6 종료" 한 줄을 권고받은 직후 승인했으므로 그 범위로 해석). **다르게 의도했다면 되돌릴 수 있도록 이 해석을 사용자에게 명시 통지**했다.

**NFR Design SKIP 사유(기록용)**: U3·U5 선례와 동형이다. 패턴이 될 만한 것이 **이미 NFR Requirements 안에 배치까지 기술**됐다 — 릴레이 재시도(10회 지수 백오프 · `outbox_event.attempts` 사용) · ShedLock 단일 실행 · 발송량 상한 카운터 · **인앱 우선 적재**(INV-U6-02). 신규 논리 컴포넌트는 테이블 4종뿐이고 `domain-entities.md §5`가 이미 기술한다. **재개 조건** = 다중 인스턴스 운영 진입 시 REL-U6-04 락 동작 검증, 또는 WS/SSE 재검토 시.

`aidlc-state.md` 갱신:
- U6 블록의 NFR Requirements를 `[x] 승인 완료`로, NFR Design·Infrastructure를 `[~] SKIPPED`로, Code Generation을 `[~] 범위 제외`로 마감. **U6 산출물 = FD 4 + NFR-Req 2 = 6종**.
- **`Current Stage` 헤더를 갱신했다.** 2026-08-07 이후 "U2·U3 설계 종료"로 고정돼 있어 U4·U5·U6 종료가 반영되지 않은 **낡은 앵커**였다(세션 재개의 기준점이라 방치하면 다음 세션이 잘못된 지점에서 출발한다). 새 값 = **U6 설계 종료 · 1차 핵심 여정 U0~U6 설계 문서 전량 완료 · 남은 유닛은 후속 게이트 U7~U9뿐이므로 AI-DLC 문서 트랙 사실상 종료** + 유닛별 종료일 일람.

**1차 핵심 여정 완료 집계**: U0 8 · U1 8 · U2 2 · U3 6 · U4 8 · U5 4 · U6 6 = **설계 문서 44종**(계획서 별도). 스토리 기준으로는 핵심 98개 중 U0~U6 배정분 전량이 화면·규칙·엔티티로 매핑됐다.

**개발 최우선 항목을 상태 파일에 명시**: **아웃박스 릴레이 배선** — ① `libs.versions.toml`에 ShedLock 추가(테이블은 V1.0부터 존재) ② `common/core/event`에 `@Scheduled`+ShedLock 릴레이 ③ **이미 발행 중인 `itinerary.ItineraryGenerated` 구독**으로 리마인드 스케줄 적재 → **U3 코드 수정 0으로 첫 경로 개통**. 이 작업이 U5·U6 설계의 핵심 가정(at-least-once · 멱등 · 단일 실행)을 한 번에 실증한다.

**Context**: CONSTRUCTION — U6 NFR Requirements Step 8~9 + NFR Design SKIP 기록 + 유닛 종료. 손댄 파일 = `aidlc-state.md` + 이 `audit.md`, 총 2파일. **다음 유닛(U7~U9)은 후속 게이트로 1차 범위 밖** — 진입하려면 SCOPE.md 개정과 사용자 명시 지시가 필요하다.
