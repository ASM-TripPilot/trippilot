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
