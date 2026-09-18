# AI-DLC State Tracking — TripPilot

## Project Information
- **Project Name**: TripPilot (B2C 여행 슈퍼앱, 외부 OTA 예약 연동)
- **Project Type**: Greenfield
- **Start Date**: 2026-07-11T07:45:03Z
- **Current Phase**: CONSTRUCTION — **설계 문서 단계만** (2026-07-17 사용자 명시 지시로 진입, docs/SCOPE.md 개정)
- **Current Stage**: **U6 설계 종료 (2026-08-24) — 1차 핵심 여정 유닛 U0~U6 설계 문서 전량 완료.** 남은 유닛은 후속 게이트 U7~U9(1차 범위 밖)뿐이라 **AI-DLC 문서 트랙은 사실상 종료**다. 다음 = 팀 개발(최우선 = 아웃박스 릴레이 배선) 또는 사용자 지시. 유닛별 종료: U0 07-17 · U1 07-23 · U2·U3 08-07 · U4 08-09 · U5 08-22 · U6 08-24
- **Execution Scope**: 유닛별 설계 문서(Functional/NFR Requirements/NFR Design/Infrastructure Design)까지만. **Code Generation·Build and Test 제외** — 코드는 팀이 각 패키지 디렉토리(`backend/`·`frontend/`·`ai/`)에서 직접 개발. 기획 참조는 `aidlc-docs/inception/` (planning/은 2026-07-17 제거).

## Workspace State (2026-07-17 동기화 — 인셉션 종료 후 팀 개발 현황 반영)
- **Existing Code**: Yes — 인셉션 종료 후 AI-DLC 워크플로 밖에서 팀 개발 진행 중 (하단 Post-Inception Progress)
- **Programming Languages**: Kotlin(backend) · TypeScript(frontend — 아키텍처 확정, 코드 스캐폴드 예정) · Python(ai — 예정)
- **Build System**: Gradle 멀티모듈(backend) · pnpm + Expo(frontend, 예정)
- **Project Structure**: trippilot 모노레포 — `backend/` · `frontend/` · `ai/` · `aidlc/`(본 워크스페이스) · `docs/`
- **Reverse Engineering Needed**: No
- **Workspace Root**: /Users/taehyeonpark/Desktop/dev/trippilot/aidlc (모노레포 하위로 이관)

## Canonical Inputs
- **기능 정본**: `docs/PRD/` (16개 문서, 120 유저스토리 + 17 모듈 + 17 ADR)
- **UI/UX 정본**: `docs/design/wireframes.md` (Figma, fileKey `1MTF3dtptIrbg8gld5IdO2`, 192 프레임)
- **충돌 원칙**: 기능·데이터·규칙 → PRD 우선 / 화면·컴포넌트·상태·인터랙션 → Figma 우선 / 모순 시 갭 기록 후 질문.

## Code Location Rules
- **Application Code**: Workspace root (NEVER in aidlc-docs/) — CONSTRUCTION 단계에서만, 이번 범위 밖
- **Documentation**: aidlc-docs/ only
- **Structure patterns**: See code-generation.md Critical Rules

## Extension Configuration
| Extension | Enabled | Mode | Decided At |
|---|---|---|---|
| security-baseline | Yes | Full (all rules blocking) | Requirements Analysis (2026-07-11) |
| resiliency-baseline | Yes | Full (directional best practices) | Requirements Analysis (2026-07-11) |
| property-based-testing | Yes | Partial (PBT-02·03·07·08·09만 blocking; 순수 함수·직렬화 왕복 중심) | Requirements Analysis (2026-07-11) |

## Key User Directives (override PRD where stated)
- **AI 솔버 전략 — 단계적/진화형 교체 확정 (2026-07-12, 2026-07-11 지시를 정제/대체, 2026-07-12 재확정)**: "하이브리드"는 **런타임 이중 엔진이 아니라 단계적 교체(마이그레이션) 전략**을 뜻함. **Phase 1 = 결정론적 AI 솔버(OPTW/TOPTW, ADR-0009 계승)로 구현·출시** (초기 출시 엔진, 솔버가 실현가능성 소유). **향후 = 솔버 산출물 품질이 부적절('별로')하면 일정 엔진을 AWS Bedrock AgentCore 에이전트로 교체** (프로젝트 수준 결정, 런타임 요청별 폴백 아님). 교체 범위 = **옵션 B**(엔진 교체 + 기존 PRD 강제 규칙 일부[생성시각 노출 금지·이동 소요시간 미표시 등] 재검토/완화). **실현가능성(등록 숙소=출발점 앵커·영업시간·이동시간·필수 방문지·시각 충돌 없음)은 항상 결정론적 컴포넌트가 소유** — Phase 1은 솔버, 교체 후엔 에이전트가 호출하는 결정론적 검증/최적화 도구(Q2=A). 사용자 노출 시각 = 항상 검증값(환각 금지). 불변식 두 단계 공통 유지. 어시스턴트(모듈 16)·공동편집(모듈 17)의 '솔버' 참조 = 현행 일정 엔진. '별로' 판정 기준(교체 트리거)은 Application Design/운영에서 정의(Open O-SOLVER). 이번 구현 범위는 Phase 1(결정론적 솔버).
- **Requirements 결정**: Q4=핵심 여정 1차 유닛 + 어시스턴트/커뮤니티/공동편집 후속 분리 게이트 / Q5=모바일(iOS+Android)+클라우드 백엔드·국내·한국어 / Q6=정량 NFR 목표를 가정으로 포함 / Q7=인셉션에서 Figma 대표 화면 갭 점검.
- **복원력(Resiliency) 결정 (2026-07-12, 후속 질문)**: Q3=E(단일 리전 + 다중 AZ로 충분, 리전 간 DR 불필요 — RTO/RPO는 AZ 이중화에 의존) / Q4=A(단일 리전·다중 AZ 토폴로지) / Q5=A(**기존 조직 변경관리 프로세스 사용 — Jira · Slack · Git**; 신규 프로세스 발명 금지, 산출물을 이 도구체계에 정합) / Q6=B(공식 장애대응 프로세스 없음 → **경량 장애대응 + COE/포스트모템을 AI가 제안**해 채택). RESILIENCY-04(CI/CD·롤백·배포)·RESILIENCY-14(복원력 테스트)는 CONSTRUCTION NFR Design으로 이연(이번 범위 밖).

## Stage Progress

### INCEPTION Phase

> **개정 이력**: **2026-07-23 — 사후 개정 1회 실시**(사용자 명시 승인, `workflow-changes.md` §4 Low-impact modify). U1 Functional Design의 라이브 Figma 대조에서 검출된 드리프트를 인셉션에 반영: `stories.md`(가격 표기 최저가 스냅숏 · US-SHELL-03 여행자 일정 1차 자리만 · **US-EXPL-01~04 신설** · US-TRIP-06 커버리지 차단형) · `requirements.md`(FR-STAY-03 등록 2→3경로) · `components.md`·`unit-of-work.md`·`unit-of-work-dependency.md`·`unit-of-work-story-map.md`(**C7 Place Data를 U3→U1 이관**, 스토리 119→**123**, 핵심 94→**98**, U1 21→**25**). 스테이지 승인 상태는 유지(재실행 아님).
- [x] Workspace Detection — Greenfield 확정 (2026-07-11)
- [x] Requirements Analysis (Comprehensive) — 승인 완료 (2026-07-12)
- [x] User Stories — 승인 완료 (2026-07-12) · 산출물: docs/PRD/PRD-lean.md · user-stories/stories.md(94 상세 + J·K·L 헤더) · personas.md(4종) · 사진 저장 모델 결정 반영
- [x] Workflow Planning — 승인 완료 (2026-07-12) · execution-plan.md
- [x] Application Design — 승인 완료 (2026-07-12) · application-design/ 5종 · AI/솔버 계약 심화
- [x] Units Generation — 승인 완료 (2026-07-13) · unit-of-work(.md/-dependency/-story-map) · U0~U9
- [x] **STOP** — ✋ Inception 종료 (2026-07-13). 전체 요약 제시 완료. CONSTRUCTION 자동 진입 금지 — 별도 사용자 지시 필요.

### Execution Plan Summary (Workflow Planning)
- **이번 실행 남은 단계**: Application Design(EXECUTE) → Units Generation(EXECUTE) → STOP.
- **범위 밖(자동 진입 안 함)**: CONSTRUCTION 전체(Functional/NFR/Infra Design·Code Gen·Build&Test) + Operations. RESILIENCY-04·14 질의는 CONSTRUCTION NFR 단계로 이연.

### CONSTRUCTION Phase (설계 문서 단계만 — Code Generation 제외, 2026-07-17 범위 개정)
- **U0 Foundation** (워킹 스켈레톤·인증·온보딩·보안/PBT 스캐폴딩)
  - [x] Functional Design — 승인 완료 (2026-07-17) · 산출물 4종 + BR-U0-01~30 + 갭 G-1~G-4
  - [x] NFR Requirements — 승인 완료 (2026-07-17) · 산출물 2종: nfr-requirements.md(35 요구: SCALE 3·PERF 4·UX 5·AVAIL 3·SEC 10·RES 4·OBS 3·LEGAL 3 + PBT 매핑 6) · tech-stack-decisions.md(기존 확정 기록 + U0 델타 6)
  - [x] NFR Design — 승인 완료 (2026-07-17) · 산출물 2종: nfr-design-patterns.md(패턴 24종 + NFR 커버리지 + 미도입 결정·재평가 트리거 5종 + 복원력 테스트 RT-1~10) · logical-components.md(U0 신규 C-1~C-7 + 횡단 캐시 + 기존 자산 수용 5 + 프론트 논리 요소 5). **이연분 RESILIENCY-04·14 본 단계에서 해소**
  - [~] Infrastructure Design — **SKIPPED** (2026-07-17 사용자 지시: "지금 개발에서는 서버에 안 올리고 로컬 작업만") · 사유 = 배포 계획 부재로 클라우드 리소스 결정의 근거·검증 수단 없음(규칙상 CONDITIONAL "no infrastructure changes" 해당). 재개 조건 = 배포/클라우드 진입 결정 시 사용자 별도 지시
  - [~] Code Generation — **범위 제외** (팀이 각 패키지 디렉토리에서 직접 개발)
  - ✅ **U0 설계 단계 종료** (2026-07-17) — 산출물 = functional-design 4 + nfr-requirements 2 + nfr-design 2 = 8종
- **U1 Accommodation & Trip Setup** (앵커 — C3 숙소탐색 · C4 등록숙소 · C5 제휴링크 · C6 여행생성 / 21 스토리)
  - [x] Functional Design — **승인 완료 (2026-07-23)** · 산출물 4종(business-logic-model · domain-entities · business-rules **BR-U1-01~56** · frontend-components) + 결정 DEC-1~13 + 불변식 INV-U1-01~19 + 갭 G-U1-01~13(01~06은 인셉션 반영 완료) · 질문 Q1~Q14 + 명확화 CQ1~CQ4
  - [x] NFR Requirements — **승인 완료 (2026-07-23)** · 산출물 2종: nfr-requirements.md(SCALE·PERF·UX·DATA·AVAIL/RES·SEC·LEGAL·COST·OBS + PBT 3종 blocking + 재평가 트리거 3) · tech-stack-decisions.md(상속 + U1 델타 6 + **Q8=B Redis 도입 기준선 변경** + Infra 이연 5)
  - [x] NFR Design — **승인 완료 (2026-07-23)** · 산출물 2종: nfr-design-patterns.md(P-RES/SCALE/PERF/SEC/COST/DATA/OBS-U1 + 커버리지 + 미도입·재평가 5) · logical-components.md(**LC-U1-1~8** + 기존 자산 수용 6[Redis만 신규] + 프론트 논리 5 + PBT 게이트 배치)
  - [~] Infrastructure Design — **SKIPPED** (2026-07-23 사용자 지시: "U0처럼 스킵") · 사유 = U0와 동형(배포/클라우드 계획 부재 → 리소스 결정의 근거·검증 수단 없음, CONDITIONAL "no infrastructure changes"). 재개 조건 = 배포/클라우드 진입 결정 시 별도 지시
  - [~] Code Generation — **범위 제외** (팀이 각 패키지 디렉토리에서 직접 개발)
  - ✅ **U1 설계 단계 종료 (2026-07-23)** — 산출물 = functional-design 4 + nfr-requirements 2 + nfr-design 2 = **8종**
- **U2 Itinerary Intelligence / Solver** (엔진 유닛 — 사용자 대면 스토리 0 / `SolverPort`·`FeasibilityValidator`·`PreferenceScoringPort`·`TravelEstimatePort`)
  - [x] Functional Design — **승인 완료 (2026-08-07)** · 계획 `plans/u2-itinerary-intelligence-functional-design-plan.md`(Q1=A·Q2=A·Q3=A·Q4=B·Q5=A·Q6=A·Q7=C·Q8=A) · 산출물 **2종**(Q1=A 경계 접합 문서): `business-logic-model.md`(경계 계약 정본·불변식 집행점·갭 G-U2-01~09) + `business-rules.md`(BR-U2-01~16 드리프트 결정표·O-SOLVER 관측·PBT 경계 3종·미결 O-U2-1~3)
  - ⚠️ **Step 1 발견 — U2는 그린필드가 아님**: 실질이 `ai/src/trippilot/`(c1·c2·ports)에 **구현 완료**, `ai/aidlc-docs/`에 **별도 AI-DLC 워크스페이스와 자체 U2 FD가 이미 존재**(유닛 번호 체계 상이: aidlc U2 ≈ ai u1-domain-ports + u2-solver + u4-c1-gateway + agent-foundation). 경계 포트 `backend/.../ScheduleAgentPort.kt` 실재(TRIP-228). 드리프트 감사 = `ai/docs/backend-ai-정합성-점검.md`(P1~P8·N1~N6, 잔여 TRIP-280·281·282). → **산출물 성격(접합 문서 vs 풀세트 vs 스킵)을 Q1로 사용자 결정에 부침**
  - [~] Code Generation — **범위 제외** (팀이 각 패키지 디렉토리에서 직접 개발 — 2026-08-07 사용자 재확인)
- **U3 AI Itinerary Generation** (C8 · US-SCHED-01~12 · 12 스토리)
  - [x] Functional Design — **승인 완료 (2026-08-07)** · 계획 `plans/u3-ai-itinerary-functional-design-plan.md`(Q1=A·Q2=B·Q3=A·Q4=A·Q5=A·Q6=A·Q7=A·Q8=A·Q9=A) · 라이브 Figma 밴드 h **33프레임 대조** → 드리프트 D-U3-1~14
  - 산출물 **4종**: `business-logic-model.md`(DEC-U3-1~9·F-U3-1~7·`proposeSlotCandidates` 계약·갭 G-U3-1~7) · `domain-entities.md`(신설 `ItineraryRevision`·`GenerationSession`·INV-U3-01~08) · `business-rules.md`(**BR-U3-01~34**·PBT-U3-1~5·미결 O-U3-1~4) · `frontend-components.md`(라우트 15·컴포넌트 33·testID)
  - 상황: backend 골격 실재(컨트롤러 4엔드포인트·서비스 4·도메인 3·테스트 8·V2.7·V2.8) / **frontend `(tabs)/itinerary.tsx` 빈 셸** → 프런트 설계가 본체
  - [x] NFR Requirements — **승인 완료 (2026-08-07)** · 계획 `plans/u3-ai-itinerary-nfr-requirements-plan.md` · **얇게 방침**(U0·U1 상속 + FD에 이미 들어간 NFR성 규칙 7건 재서술 금지) · **실장 우선**(사용자 지시로 `ai/`·`backend/`·`frontend/` 실측 후 결정)
  - 산출물 **2종**: `nfr-requirements.md`(COST 5·PERF 5·OBS 5·DATA 4·OFFLINE 4·SEC 3 + 재평가 트리거 3) · `tech-stack-decisions.md`(상속 + **U3 델타 3** + backend 델타 5 + AI 델타 없음)
  - 실측 핵심: **호출 상한 부재 확인**(ai·backend 모두) → 진행 중 세션 거부로 유도 · **AI 관측 4종 이미 실재**(토큰 기록 포함) → 승계, U3는 행동 지표 2종만 · **`KakaoMapView`가 다중 핀·폴리라인·center 갱신 미지원** → 초안 "델타 없음" 철회, **확장 필요**로 정정
  - ⚠️ **U2 사후 정정 발생(2026-08-07)**: Q5=A로 `proposeSlotCandidates` **개통 확정** → U2 `business-logic-model` §7.1 신설 + `business-rules` **O-U2-3 종결**. `ScheduleAgentPort`는 **4메서드**(generate·validate·repair·proposeSlotCandidates). `recalculate`는 U4 유지(U3는 DEC-U3-2로 `generate` 재호출 사용). U2 스테이지 체크박스 변동 없음
  - [~] NFR Design — **SKIPPED** (2026-08-07 사용자 명시 지시: "nfr design은 스킵으로 기록하고 u3 종료") · 사유 = 신규 정보 부재. 복원력·성능 패턴은 U0·U1 상속(서킷 분리·재시도 없음·stale-if-error·침묵 실패 사슬·응답 예산 2계층), U3 고유(재생성 억제·지도 확장·리비전 정리)는 이미 `nfr-requirements.md`·`tech-stack-decisions.md`에 배치까지 기술됨. 논리 컴포넌트 신규는 `itinerary_revision` 하나. **재개 조건** = 실측에서 부족 판명 또는 새 횡단 패턴 필요 시
  - [~] Infrastructure Design — **해당 없음** (U0·U1과 동형 — 배포/클라우드 계획 부재)
  - [~] Code Generation — **범위 제외** (팀 직접 개발)
  - ✅ **U3 설계 단계 종료 (2026-08-07)** — 산출물 = functional-design 4 + nfr-requirements 2 = **6종**
  - 후속(설계 밖): 디자인 협의 G-U3-1(배너 수치) · backend 마이그레이션 3(`visit_slot.placement_reason` · `ItineraryStatus` 역전이 · `itinerary_revision` 신설) · frontend `KakaoMapView` 확장(필수) · 미결 O-U3-1~4
- **U4 In-trip & Plan-B** (C9 Plan-B Detection · C10 Itinerary Recalculation · C11 Weather & Context · US-PLANB-01~13 + US-ONTRIP-01~03 · 16 스토리)
  - [x] Functional Design — **승인 완료 (2026-08-09)** · 계획 `plans/u4-in-trip-planb-functional-design-plan.md`(Q1=A·Q2=A·**Q3·Q4=지오펜스 조합**·Q5=C·Q6=ai 폴더(develop) 정본·Q7=A·Q8=C) · 라이브 Figma 밴드 `i` **22프레임 대조** → 드리프트 D-U4-1~10 → **디자인 수정 15건 요청·반영·재관측(27프레임) 확인**
  - 산출물 **4종**: `business-logic-model.md`(DEC-U4-1~11 · 트리거 판정 파이프라인 · 재계획 플로우 · **`replan` 계약과 ai 매핑표** · 기준점 사다리 4단 · 폴백 표 · 갭 G-U4-1~8) · `domain-entities.md`(신설 6종 + 기존 재사용 5종 + INV-U4-01~09 + 이벤트 3 + 소유 경계표) · `business-rules.md`(**BR-U4-01~46** · PBT-U4-1~5 · 미결 O-U4-1~5) · `frontend-components.md`(**2026-08-09 재작성** — 리포 실제 FSD 층 배치 기준: 라우트 12 · pages 슬라이스 10 · `features/execution`·`features/planb` 분할 · shared 승격 6 · 구조 가드 7)
  - 상황: backend **U4 3모듈 전무**(통째 신규) / `change-log` 모듈 + V2.11 선재로 **US-PLANB-09 절반 구현됨** / frontend 밴드 `i` 라우트 0 → **프런트가 본체**(U3와 동형)
  - ⚠️ **U2 사후 정정 2건(2026-08-09)**: DEC-U4-5로 **`recalculate` 신설 철회** — `ai/`(develop) 실측에서 `HybridSolverFacade.regenerate(problem, locked_slots)`가 이미 Plan-B warm-start임이 확인돼(locked를 `FixedBlock`으로 승격→HC3 보호, `validate`가 보존 강제) 백엔드 포트를 ai 실장에 맞춰 **`replan`으로 개통**. U2 `business-logic-model` §7 행 종결 + **§7.2 신설**, `business-rules` O-U2-3 갱신. **`ScheduleAgentPort`는 5메서드**
  - ⚠️ **U3 사후 정정(2026-08-09)**: `frontend-components.md`를 **리포 실제 층 배치 기준으로 재작성** — README가 적은 `screens/containers/hooks/store`는 TRIP-173에서 `pages/` 층으로 이주해 사라졌다. TRIP-295·296 구현분 반영. 스테이지 체크박스 변동 없음
  - [x] NFR Requirements — **승인 완료 (2026-08-09)** · 계획 `plans/u4-in-trip-planb-nfr-requirements-plan.md` · **얇게 방침**(U0·U1·U3 상속 + FD 중복 8건 참조만) · **실장 우선** · 답변 Q1~Q6=A
    - 산출물 **2종**: `nfr-requirements.md`(**MOBILE-U4-01~07** 신규 축 · PERF 5 · COST 6 · **LEGAL 5** · DATA 5 · OBS 5 · OFFLINE 5 · SEC 4 + 재평가 6) · `tech-stack-decisions.md`(상속 11 + **델타 6** + 미도입 8 + 개발 중 처리 3)
    - 실장이 바꾼 결정 4: **지오펜스 실비용 정정**(`expo-task-manager` 1개 + plugin 확장 + **EAS 재빌드** — FD 단계 "신규 의존성 0" 자기 정정) · **위치 동의 축 신설 금지**(V1.3 L3 `gps_recording_opt_in` 승계) · **법정 로그 구간 단위**(append-only + `COLLECTION` 이라 좌표마다 남기면 폭증) · **스케줄링 신규 인프라 0**(`StalePartialSweeper` 재사용)
  - [x] NFR Design — **승인 완료 (2026-08-09)** · 계획 `plans/u4-in-trip-planb-nfr-design-plan.md` · **Q1=A**(서킷 미도입) · **Q2=A′**(지오펜스 슬라이딩 창 **2곳** — 사용자 제안, O-U4-1 종결)
    - 산출물 **2종**: `nfr-design-patterns.md`(P-DET-U4-1~3 · **P-RES-U4-1 서킷 미도입** · P-RES-U4-2 stale 역방향 예외 · **P-MOBILE-U4-1 지오펜스 창 2 + 중복 진입 판정 + 강등 사슬** · P-CON-U4-1 세션 단일성 · P-PERF-U4-1~2 · P-DATA-U4-1~2 · P-OBS-U4-1) · `logical-components.md`(**LC-U4-1~9** + 기존 자산 수용 8 + 마이그레이션 6 + 미결 4)
    - ⚠️ **U1 사후 정정 2건**: `nfr-design-patterns.md` P-RES-U1-1 · `logical-components.md` 서킷 행에 **"미실장 · U4에서 재확인(2026-08-09)"** 주석 — `libs.versions.toml`에 resilience4j가 없어 패턴이 문서로만 존재함을 명시하고 U4의 미도입 결정·재평가 조건을 연결
  - [~] Infrastructure Design — **SKIPPED** (2026-08-09 사용자 승인 "U4 설계 단계 종료") · 사유 = U0·U1·U3와 동형(배포/클라우드 계획 부재 → 리소스 결정의 근거·검증 수단 없음, CONDITIONAL "no infrastructure changes"). 재개 조건 = 배포/클라우드 진입 결정 시 별도 지시
  - [~] Code Generation — **범위 제외** (팀이 각 패키지 디렉토리에서 직접 개발)
  - ✅ **U4 설계 단계 종료 (2026-08-09)** — 산출물 = functional-design 4 + nfr-requirements 2 + nfr-design 2 = **8종**
  - 후속(설계 밖): **backend** 3모듈 신설(planb-detection·itinerary-recalculation·weather-context) + 마이그레이션 6(V2.14~) + `ScheduleAgentPort.replan` + openapi `planb`·`execution` 태그 / **ai** HTTP 표면 부재 해소(G-U4-3, 개발 착수 선행) + 지시어 해석 규약(O-U4-5) / **frontend** `expo-task-manager` + `expo-location` plugin 확장 + **EAS 재빌드 1회** · `KakaoMapView` 점선 레이어 · `shared/location` 지오펜스 · `features/execution`·`features/planb` 신설 / **인셉션 정정 상신 2**(G-U4-1 `proposeAlternatives` 2~3개 → 단일 초안 · G-U4-4 `recalculate` → `replan`) / **콘솔** 기상청 공공데이터포털 API 키 / **디자인 확인 2**(G-U4-7 완료 슬롯 사진·메모 진입점 · G-U4-8 `i13`·`i14` 1일차 칩) / 미결 O-U4-2~5
- **U5 Records & Reflection** (C12 Travel Archive · C13 AI Reflection/Summary · US-REC-01~14 · 14 스토리)
  - [x] Functional Design — **승인 완료 (2026-08-22)** · 계획 `plans/u5-records-reflection-functional-design-plan.md`(**Q1=A · Q2=A+B 병행 · Q3=A · Q4=A · Q5=B · Q6=A · Q7=A · Q8=A · Q9=A**) · 라이브 Figma 밴드 `j` **17프레임**(코드 7·결번 없음) 대조 → 드리프트 D-U5-1~10
  - 산출물 **4종**: `business-logic-model.md`(**DEC-U5-1~13**·3계층 소유 지도·이관 집행·회고 3단 폴백·이동거리 계약 공백·갭 G-U5-1~10) · `domain-entities.md`(승계 1 + **신설 5**(V2.28~V2.32 제안) + 재사용 6 + **INV-U5-01~09**) · `business-rules.md`(**BR-U5-01~52**+08a · PBT-U5-1~5 · 미결 O-U5-2~6) · `frontend-components.md`(라우트 7 · pages 7 · **feature 2분할** `record`/`reflection` · 구조 가드 5 · PBT-U5-F1~F4)
  - 상황: **U3·U4와 달리 그린필드가 아니다** — `visit_check`(V2.21)+코드 4파일+openapi `/trips/{tripId}/visits*` **5경로** 실재로 **US-REC-01은 백엔드 계약까지 완료**. V2.21 주석이 U5에 이관을 명시 지시(사진·메모 컬럼을 일부러 미생성) / frontend `(tabs)/records.tsx` **28줄 셸**, 밴드 `j` 라우트 0 → **프런트가 본체**(U3·U4와 동형)
  - 핵심 결정: **`archive`·`reflection` 2모듈 신설** · `visit_check` **코드만 이관**(테이블·openapi 불변, `VisitChecked` 발행 주체 U4→U5) · 회고 **포트 1+어댑터 2**(`AI_REFLECTION_MODE=rule\|llm\|http`, `ai/` 표면 부재로 http 개통 이연) · 응답에 **`source: AI\|RULE\|BASIC` 항상 적재**(D-U5-1 — 화면상 AI와 폴백이 구분 안 됨) · `status` enum 미생성(timestamp 파생)
  - ⚠️ **U4 사후 정정 2건(2026-08-22)**: `u4/domain-entities.md` §3.1 = `visit_check` **이관 확정**(U4는 `ArchiveFacade.getCompletedSlots`로 잠금 판정 입력을 읽는다) · §3.3 = `actual_route_point` **이관 철회, U4 소유 유지**(Q5=B) + **미실장 사실 병기**. G-U4-5가 예고한 "U5 일괄 승계"가 **둘로 갈렸다**
  - ⚠️ **사이클 중 자기 정정 2건**: **D-U5-3 철회**(노드 이름만으로 "`j02`에 3종 구분·전후 장소 없음" 판정 → 스크린샷에서 3탭 세그·라벨 배지·`△△카페→◇◇실내카페` 전부 확인) · **G-U5-6 철회·O-U5-1 종결**(`j05` "평균 체류 72분"을 BR-U4-37 충돌로 올렸으나 **INV-U4-03**이 이미 "사후 실적은 U5 소관"으로 분리 → DEC-U5-13·BR-U5-08a로 확정)
  - [~] NFR Requirements — **SKIPPED** (2026-08-22 사용자 승인 "NFR 스킵 기록하고 U5 종료" · 계획서 Q9=A) · 사유 = U0·U1·U3·U4 상속 + FD가 이미 배치까지 기술. 신규 축으로 보이는 3건도 상속으로 덮인다 — **사진 저장**(로컬 참조·서버 메타만이라 스토리지 비용축 없음, DEC-U5-9) · **오프라인 큐**(기기 로컬, 서버 인프라 0) · **위치/EXIF**(U4 LEGAL-U4-01~05·V1.3 `gps_recording_opt_in` 승계). **재개 조건** = `shared/photo` 신규 의존성이 EAS 재빌드를 요구하는 것으로 확인되거나, `ObjectStoragePort`(U7 공개 사진)가 개통될 때
  - [~] NFR Design — **SKIPPED** (같은 승인) · 사유 = NFR Requirements 스킵에 따른 CONDITIONAL 미충족(룰: "NFR Requirements was skipped → skip"). 논리 컴포넌트 신규는 테이블 5종뿐이고 `domain-entities.md §7`이 이미 기술
  - [~] Infrastructure Design — **SKIPPED** (U0·U1·U3·U4와 동형 — 배포/클라우드 계획 부재)
  - [~] Code Generation — **범위 제외** (팀이 각 패키지 디렉토리에서 직접 개발)
  - ✅ **U5 설계 단계 종료 (2026-08-22)** — 산출물 = functional-design **4종**
  - 🔍 **셀프 검수 2차 (2026-08-22)** — 축을 **문서-코드 대조**로 바꿔 결함 **4건 추가**: **`LlmGatewayPort` backend 부재**(G-U5-11 — DEC-U5-5의 "U2 자산 재사용" 근거가 사실이 아니었다 → 어댑터 ①은 **벤더 직결 신규 구축**, 기본값 `rule` 확정, `llm` vs `http`는 **O-U5-6** 승격) · **`ChangeLogFacade`에 조회 메서드 없음**(G-U5-12 — `append` 하나뿐, BR-U5-29 성립에 facade 확장 선행) · **`VisitChecked` 이벤트 미실장**(G-U5-13 — "발행 주체 변경"이 아니라 U5 **신설**) · **프런트 feature 간 import 금지**(G-U5-14 — `actualDistance.ts` "재사용" 불가, `shared/geo/` 승격 필요, U4 티켓 조율). 미결 **O-U5-8** 신설(사진 EXIF를 `gps_recording_opt_in`으로 게이팅하는 것이 목적 범위에 맞는가)
  - 🔍 **셀프 검수 1회 (2026-08-22, 사용자 요청)** — 결함 **6건 정정**: 실물 부재 이름 2(`trip_base`→`base_assignment`·`trip_base_day` / `poi.activity_category`→`poi.category` 8종 CHECK) · 상호참조 오류 2(BR-U5-24→22 · INV-U5-07→08) · **PBT-U5-5 자기모순**(DEC-U5-13의 `avgDwellMinutes` 노출과 충돌 → "이동 소요시간 금지 + 단일 예외"로 범위 정정) · **US-REC-03 규칙 통째 누락**(Q5=B로 소유가 U4로 가며 화면 규칙까지 빠짐 → `business-rules.md §9` **BR-U5-53~56** 신설). 검출 수단 = **14 스토리 전수 커버리지 표**(`business-logic-model.md §10` 신설, 미커버 0). 추가 관측 **D-U5-11**(`j05` `미식` ↔ `poi.category` `맛집` 라벨 불일치 → **O-U5-7**)
  - 후속(설계 밖): **backend** `archive`·`reflection` 2모듈 신설 + `visit_check` 코드 이관(4파일+테스트 3) + 마이그레이션 5(V2.28~V2.32, 머지 시점 재배정) + openapi 확장(`/visits/{id}/photos`·`/memo`·`/reflections`·`/summary`·`/style`) + `ReflectionGeneratorPort`+어댑터 2 / **ai** 회고 표면 3종 협의(G-U5-4, 개통 이연) / **frontend** 밴드 `j` 7화면 신규 + `shared/photo` 신설(**신규 의존성·EAS 재빌드 확인 필요**) + `KakaoMapView` 레이어 3종 확장 + 구조 가드 5 / **선재 문서 정합**(G-U5-3: `전체-최소-스키마.dbml`의 `visit_record`·`photo.storage_key`·`gps_track.steps`가 실장·INV와 어긋남) / **인셉션 정정 상신 2**(G-U5-1 C12 "3계층 소유"→열람 책임 · G-U5-7 US-REC-10 개인화 소비 계약) / **U4 의존**(G-U5-5: `actual_route_point` 실장 전까지 이동거리 `VISIT_LINE` 근사) / **디자인 확인**(G-U5-9 `j02` 3탭 동작 축) / **시각 미확인 12프레임**(Figma MCP 호출 상한 — 프런트 착수 전 선행) / 미결 O-U5-2~6
- **U6 Notification & Settings** (C14 Notification + 설정/마이페이지 리드 · US-NOTIF-01~12 · 12 스토리)
  - [x] Functional Design — **승인 완료 (2026-08-24)** · 계획 `plans/u6-notification-settings-functional-design-plan.md`(**Q1~Q9 전부 A**) · 라이브 Figma 밴드 `l` 16프레임 대조 → 드리프트 D-U6-1~13
  - 산출물 **4종**: `business-logic-model.md`(**DEC-U6-1~11**·전달 파이프라인·채널 판정 진리표·catch-up·설정 배선표·갭 **G-U6-1~9**·커버리지 12/12) · `domain-entities.md`(신설 4 V2.33~36 + 재사용 9 + **INV-U6-01~09** + `NotificationKind` 8종) · `business-rules.md`(**BR-U6-01~38**·PBT-U6-1~5·미결 O-U6-1~6) · `frontend-components.md`(라우트 6·pages 6·feature 2분할·`shared/push`·가드 5)
  - 핵심 결정: **아웃박스 릴레이를 U6가 설계**(배치는 `common/core/event`) · **시각 기반 알림은 이벤트가 아니다**(`notification_schedule` + 폴링, DEC-U6-10) · **인앱 적재가 푸시보다 먼저·성공여부 무관**(INV-U6-02 = "누락 0"의 유일한 근거) · `source_event_id` UNIQUE로 at-least-once 멱등 · 푸시는 **Expo Push Service**(프런트 신규 의존성 0 — `expo-notifications` 이미 등록됨)
  - ⚠️ **생성 중 자기 정정 2건**: **`l05`·`l06` 시각 확인**으로 제휴 "다시 보기" 저장을 기기 로컬→**서버**로 정정(DEC-U6-7a) · 위치 동의 **화면 1토글 ↔ 백엔드 3층** 대응 확정(DEC-U6-11) / **NFR 착수 실측에서 FD 오진 정정**: 초안의 "아웃박스 구현 0건·이벤트 0"은 **`backend/shared`(존재하지 않는 경로)를 뒤진 결과**였다. 실제는 `backend/common/core/event`에 계약·`EventEnvelope`·PBT, `app/event`에 `SpringDomainEventPublisher`, V1.0에 `outbox_event`+**`shedlock`**이 실재하고 **이벤트 5종이 이미 발행 중**(`auth.*` 3 · `itinerary.*` 2). **없는 것은 릴레이 하나**(G-U6-1 재작성 · G-U6-9 신설 — 이름 규약 `{module}.{EventName}`이 정본)
  - [x] NFR Requirements — **승인 완료 (2026-08-24)** · 계획 `plans/u6-notification-settings-nfr-requirements-plan.md`(**Q1=B · Q2~Q6=A**) · U5와 달리 스킵하지 않았다 — 푸시 개통으로 새 축 4개(COST 발송량 · REL 내부 비동기 전달 · DATA 계정 단위 시계열 · **SEC 잠금화면 노출**)가 실재
    - 산출물 **2종**: `nfr-requirements.md`(COST 5·REL 6·PERF 4·DATA 5·**LEGAL 4**·OBS 4·SEC 3 = **31 요구** + 재평가 6, PBT는 FD의 5종 그대로) · `tech-stack-decisions.md`(상속 8 + **델타 2** + 미도입 6 + 프런트 신규 의존성 **0**)
    - **Q1=B(야간 조용시간 미도입)의 성립 조건을 규칙화**: **LEGAL-U6-02** 이 경로는 **정보성 알림만**(광고성은 `NotificationKind`에 없고 추가 금지 — 마케팅은 `/me/marketing-consent` 별도 경로) · **LEGAL-U6-03** 그것이 조용시간 미도입의 근거이므로 **광고성 종류 추가 요구 시 전면 재검토**(재평가 트리거)
    - 실측이 델타를 2개로 줄였다: **ShedLock 라이브러리 추가**(테이블은 V1.0부터 있는데 `libs.versions.toml`에 라이브러리 없음 — U0 부채 잔여분) · **`PushPort`+`ExpoPushAdapter`**. 관측은 `actuator`+**`micrometer-registry-otlp` 실재**로 카운터 4종만, 스케줄러는 `@Scheduled` 재사용(U4 승계), 프런트는 `expo-notifications` 등록 완료로 **신규 의존성 0**
  - [~] NFR Design — **SKIPPED** (2026-08-24 사용자 승인) · 사유 = U3·U5 선례와 동형. 패턴이 될 것이 **이미 요구 안에 배치까지 들어갔다**(릴레이 재시도 10회 백오프·ShedLock 단일 실행·상한 카운터·인앱 우선 적재), 신규 논리 컴포넌트는 테이블 4종뿐이라 `domain-entities.md §5`가 이미 기술. **재개 조건** = 다중 인스턴스 운영 진입(REL-U6-04 락 검증) 또는 WS/SSE 재검토 시
  - [~] Infrastructure Design — **SKIPPED** (U0~U5와 동형 — 배포/클라우드 계획 부재)
  - [~] Code Generation — **범위 제외** (팀이 각 패키지 디렉토리에서 직접 개발)
  - ✅ **U6 설계 단계 종료 (2026-08-24)** — 산출물 = functional-design 4 + nfr-requirements 2 = **6종**
  - 🎯 **1차 핵심 여정(U0~U6) 설계 문서 전량 완료** — 총 **44종**(U0 8 · U1 8 · U2 2 · U3 6 · U4 8 · U5 4 · U6 6 + 계획서 별도). 개발 최우선 = **아웃박스 릴레이 배선**(ShedLock 추가 → `common/core/event` 릴레이 → `itinerary.ItineraryGenerated` 구독으로 U3 코드 수정 없이 첫 경로 개통)
  - 후속(설계 밖): **backend** `notification` 모듈 + 마이그레이션 4(V2.33~36) + **아웃박스 릴레이**(`@Scheduled`+ShedLock, **라이브러리 의존성 추가 필요** — 테이블만 선재) + 이벤트 3종 발행부(U1 숙소·U4 Plan-B·U5 회고) + `ExpoPushAdapter` + **데이터 내보내기 엔드포인트 신설**(G-U6-3) / **frontend** 밴드 `l` 6화면 + `shared/push` 배선(신규 의존성 0) / **디자인 확인 3**(G-U6-4 Plan-B 민감도 — U4 G-U4-6 미반영 · G-U6-5 `SLOT_PRE` 간격 · `l05`·`l06` dialog 문안) / **U1 연결**(G-U6-6 `l05`가 `G-U1-09` 예산 입력 경로) / **인셉션 정정 상신**(G-U6-9 이벤트 이름 규약) / 미결 O-U6-1~6
- U7~U9 — 유닛별 사용자 지시 대기

## Open Items (U0 — 설계 문서 없이 개발 중 처리)
- **소셜 IdP 4종 콘솔 설정**: 앱 등록·키 발급(Apple p8·카카오/네이버 네이티브 키)·리다이렉트 URI(로컬/디바이스) — U0 인증 개발의 선결 블로커. Infrastructure Design SKIP으로 문서화 생략, 개발 중 각자 처리(사용자 승인 2026-07-17)
- **로컬 시크릿 주입 규약**: `.env` 등 — 커밋 금지(SEC 규약)만 유지. 클라우드 전환 시 시크릿 매니저 제품 선정과 함께 Infrastructure Design에서 확정
- **배포 의존 항목 이연**: RT-8(롤링 무중단)·RT-9(롤백 리허설 — 최초 프로덕션 배포 전 필수)·RT-10(AZ 게임데이) · 클라우드 토폴로지(다중 AZ·LB·APM·알림 라우팅)
- **G-1 (Functional Design)**: openapi `SocialLoginRequest`에 `grantType: AUTH_CODE|SDK_TOKEN` 추가 개정 — 백엔드 협의 필요

### U1 (설계 문서 없이 개발 중 처리 — 2026-07-23)
- **로컬 스택에 Redis 컨테이너 추가**: Q8=B(Redis 도입) 결정으로 리포 루트 `docker-compose.yml`에 Redis 추가 필요(TRIP-146 스택 확장). 운영 토폴로지는 배포 진입 시 Infra Design
- **카카오 개발자 콘솔 설정**: 지도 SDK + 로컬(장소) 검색 API 키 발급·앱 등록·플랫폼 등록 — U1 탐색·등록 개발 선결 블로커(U0 소셜 IdP 콘솔 설정과 동류)
- **선재 backend 설계 문서 정합(G-U1-\* 파생)**: `backend/docs/design/전체-최소-스키마.dbml`·`전체-API-서피스.md`를 U1 설계와 맞추는 작업 — 특히 **I-7 위시리스트 제외 철회**(FR-STAY-01 위반), 가격 스냅숏 컬럼, `trip_destination` 신설, 등록 3경로. 팀 협의(선재 문서는 backend 패키지 소유)
- **G-U1-09 예산 입력 화면 부재**: 라이브 Figma g01·g02에 예산 필드 없음 — 데이터·API엔 유지, 입력은 온보딩 취향 예산 상속. 예산 UI 신설 여부는 디자인 확인 필요
- **G-U1-10 동반 유형 매핑**: 온보딩 `커플` ↔ 여행 생성 `연인`, `부모님` 미노출 — 프론트 매핑 확정 필요
- **배포 의존(U1)**: 외부 포트 실어댑터 전환 시 벤더 계약·쿼터·과금 방어(COST-U1-01 재평가) · POI 초기 적재 파이프라인(TourAPI 등) · 지도 쿼터 하드 상한(정식 출시 전 재평가)

## Skipped Stages
- Reverse Engineering — SKIPPED (그린필드, 기존 코드 없음)

## Post-Inception Progress (AI-DLC 워크플로 밖 팀 개발 — 기록용, 스테이지 진행 아님)
- **backend**: 모듈러 모놀리스 Gradle 골격(TRIP-145) · 로컬 통합 스택 docker-compose + GHCR CI(TRIP-146) · DB 스키마 Flyway V1.0~V1.6 + 기준 데이터 시드(TRIP-147) — main 머지 완료
- **frontend**: 아키텍처 정본 확정(TRIP-160, 2026-07-17) — 정본 = `frontend/README.md`. 이후 스캐폴드·세로 슬라이스 진행: TRIP-160 Expo 스캐폴드+5탭 셸 · TRIP-161 앱시작 분기+소셜 로그인 · TRIP-162 약관·닉네임·위치+실 OAuth · TRIP-163 취향 2페이지 (main 머지) · TRIP-170 홈 대시보드+탭바 진행 중
- **U0 구현 현황 점검 (2026-07-22)**: backend = U0 범위 사실상 완료(openapi 20경로 매핑 전부 존재, `./gradlew test`는 미실행 — 녹색 미검증) / frontend ≈85%(TRIP-170 진행 중, HomeScreen 3 red) · **U0 설계 대비 프론트 미착수 4건**: 삭제유예 복구화면(BR-U0-24) · 로그아웃 클라 흐름(BR-U0-09) · 마이탭 닉네임·취향 수정(BR-U0-18) · age 별도화면이 로그인화면에 흡수(설계 이탈). 이 4건은 U1 설계와 병렬로 프론트 티켓 처리(사용자 결정)
- **CI**: `.github/workflows/{backend-ci, frontend-ci, ai-ci}.yml`
- **참조 기준(팀 결정 2026-07-17)**: 후속 개발의 기획 참조는 `aidlc-docs/inception/` 산출물 기준. 각 패키지 아키텍처 정본은 해당 패키지 소유(`frontend/README.md`, `backend/docs/design/`)

## Notes
- 초기 출시: 국내(대한민국) 한정. 국내 지도 API(카카오/네이버/TMap) 우선.
- 법적 선결: 위치기반서비스사업 신고(위치정보법 제9조) — 출시 선결과제.
