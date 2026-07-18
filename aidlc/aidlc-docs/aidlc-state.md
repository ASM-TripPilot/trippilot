# AI-DLC State Tracking — TripPilot

## Project Information
- **Project Name**: TripPilot (B2C 여행 슈퍼앱, 외부 OTA 예약 연동)
- **Project Type**: Greenfield
- **Start Date**: 2026-07-11T07:45:03Z
- **Current Phase**: CONSTRUCTION — **설계 문서 단계만** (2026-07-17 사용자 명시 지시로 진입, docs/SCOPE.md 개정)
- **Current Stage**: U0 Foundation — Functional Design 진행 중
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
- U1~U9 — 유닛별 사용자 지시 대기

## Open Items (U0 — 설계 문서 없이 개발 중 처리)
- **소셜 IdP 4종 콘솔 설정**: 앱 등록·키 발급(Apple p8·카카오/네이버 네이티브 키)·리다이렉트 URI(로컬/디바이스) — U0 인증 개발의 선결 블로커. Infrastructure Design SKIP으로 문서화 생략, 개발 중 각자 처리(사용자 승인 2026-07-17)
- **로컬 시크릿 주입 규약**: `.env` 등 — 커밋 금지(SEC 규약)만 유지. 클라우드 전환 시 시크릿 매니저 제품 선정과 함께 Infrastructure Design에서 확정
- **배포 의존 항목 이연**: RT-8(롤링 무중단)·RT-9(롤백 리허설 — 최초 프로덕션 배포 전 필수)·RT-10(AZ 게임데이) · 클라우드 토폴로지(다중 AZ·LB·APM·알림 라우팅)
- **G-1 (Functional Design)**: openapi `SocialLoginRequest`에 `grantType: AUTH_CODE|SDK_TOKEN` 추가 개정 — 백엔드 협의 필요

## Skipped Stages
- Reverse Engineering — SKIPPED (그린필드, 기존 코드 없음)

## Post-Inception Progress (AI-DLC 워크플로 밖 팀 개발 — 기록용, 스테이지 진행 아님)
- **backend**: 모듈러 모놀리스 Gradle 골격(TRIP-145) · 로컬 통합 스택 docker-compose + GHCR CI(TRIP-146) · DB 스키마 Flyway V1.0~V1.6 + 기준 데이터 시드(TRIP-147) — main 머지 완료
- **frontend**: 아키텍처 정본 확정(TRIP-160, 2026-07-17) — 스택(Expo·Expo Router·TanStack Query+Zustand·NativeWind·orval·pnpm 등)·`src/` 구조(features 10 + shared 6)·import 경계·테스트 전략. 정본 = `frontend/README.md`. 코드 스캐폴드 미착수
- **CI**: `.github/workflows/{backend-ci, frontend-ci, ai-ci}.yml`
- **참조 기준(팀 결정 2026-07-17)**: 후속 개발의 기획 참조는 `aidlc-docs/inception/` 산출물 기준. 각 패키지 아키텍처 정본은 해당 패키지 소유(`frontend/README.md`, `backend/docs/design/`)

## Notes
- 초기 출시: 국내(대한민국) 한정. 국내 지도 API(카카오/네이버/TMap) 우선.
- 법적 선결: 위치기반서비스사업 신고(위치정보법 제9조) — 출시 선결과제.
