# AI-DLC State Tracking — TripPilot

## Project Information
- **Project Name**: TripPilot (B2C 여행 슈퍼앱, 외부 OTA 예약 연동)
- **Project Type**: Greenfield
- **Start Date**: 2026-07-11T07:45:03Z
- **Current Phase**: INCEPTION
- **Current Stage**: Requirements Analysis (Comprehensive)
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
| property-based-testing | Yes | Partial (순수 함수·직렬화 왕복만) | Requirements Analysis (2026-07-11) |

## Key User Directives (override PRD where stated)
- **AI 솔버 재설계 (2026-07-11)**: AI 일정 솔버는 PRD의 결정론적 OPTW/TOPTW 하이브리드(ADR-0008/0009 솔버 메커니즘, 모듈 8·9·10 알고리즘 내부)를 **버리고 AWS Bedrock AgentCore 기반의 현대적 에이전트 방식으로 새로 설계**한다. 사용자 가치 불변식(등록 숙소=출발점 앵커, 영업시간·이동시간 실현가능성, 필수 방문지, 취향 반영)은 유지하되 실현 메커니즘을 에이전트+도구로 재정의. 어시스턴트(모듈 16)·공동편집(모듈 17)이 참조하는 '솔버' 개념도 이 에이전트로 치환. 상세는 Application Design/CONSTRUCTION 확정.
- **Requirements 결정**: Q4=핵심 여정 1차 유닛 + 어시스턴트/커뮤니티/공동편집 후속 분리 게이트 / Q5=모바일(iOS+Android)+클라우드 백엔드·국내·한국어 / Q6=정량 NFR 목표를 가정으로 포함 / Q7=인셉션에서 Figma 대표 화면 갭 점검.

## Stage Progress

### INCEPTION Phase
- [x] Workspace Detection — Greenfield 확정 (2026-07-11)
- [ ] Requirements Analysis (Comprehensive) — IN PROGRESS
- [ ] User Stories
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
