# AI-DLC State Tracking — TripPilot

## Project Information
- **Project Name**: TripPilot (B2C 여행 슈퍼앱, 외부 OTA 예약 연동)
- **Project Type**: Greenfield
- **Start Date**: 2026-07-11T07:45:03Z
- **Current Phase**: INCEPTION
- **Current Stage**: User Stories (Part 2 — Generated, 승인 대기)
- **Execution Scope**: INCEPTION 단계까지만 (docs/SCOPE.md). Units Generation 승인 후 STOP — CONSTRUCTION 자동 진입 금지.

## Workspace State
- **Existing Code**: No
- **Programming Languages**: (none — greenfield)
- **Build System**: (none)
- **Project Structure**: Empty (greenfield)
- **Reverse Engineering Needed**: No
- **Workspace Root**: /Users/taehyeonpark/Desktop/dev/aidlc

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
- [ ] User Stories — Part 2 생성 완료, 승인 대기 (GATE) · 산출물: docs/PRD/PRD-lean.md · user-stories/stories.md(94 상세 + J·K·L 헤더) · personas.md(4종)
- [ ] Workflow Planning
- [ ] Application Design
- [ ] Units Generation
- [ ] **STOP** (Inception 종료 — 사용자 지시 대기)

### CONSTRUCTION Phase
- (범위 밖 — SCOPE.md에 따라 자동 진입하지 않음)

## Skipped Stages
- Reverse Engineering — SKIPPED (그린필드, 기존 코드 없음)

## Notes
- 초기 출시: 국내(대한민국) 한정. 국내 지도 API(카카오/네이버/TMap) 우선.
- 법적 선결: 위치기반서비스사업 신고(위치정보법 제9조) — 출시 선결과제.
