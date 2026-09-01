# AI-DLC State Tracking

## Project Information
- **Project Type**: Brownfield (설계 문서 + 가동 중인 소스 코드)
- **Start Date**: 2026-07-12T00:00:00Z
- **Current Stage**: CONSTRUCTION (INCEPTION 은 2026-07-12 완료). 유닛별 진행 상태는 `../claude.md` §Current Status

## Workspace State
- **Existing Code**: Yes (워크스페이스 루트 `src/trippilot/` — FastAPI 서비스 가동 중)
- **Existing Design Documents**: Yes (ai-architecture.md, ai-implementation-design.md, ai-data-design.md, ai-prompt-design.md, ai-testing-guide.md, ai-adr.md)
- **Programming Languages**: Python
- **Build System**: uv (워크스페이스 루트 `pyproject.toml` — `build-backend = "uv_build"` · `uv.lock`)
- **Project Structure**: Multi-component AI Service (C1 LLM Gateway + C2 Solver Engine + M7 Place Data)
- **Workspace Root**: 모노레포 `ai/` (종전 값 `/Users/juna/dev/TripPilot_AI` 는 모노레포 이관 전 단독 리포 경로)

## Code Location Rules
- **Application Code**: Workspace root (NEVER in aidlc-docs/)
- **Documentation**: aidlc-docs/ only
- **Design Artifacts**: aidlc-docs/inception/design-artifacts/ (ai-*.md 구조화)

## Extension Configuration
| Extension | Enabled | Decided At |
|---|---|---|
| Security Baseline | Yes (NFR-3 보안 요구사항 반영) | Requirements Analysis |
| Resiliency Baseline | Yes (NFR-2 복원력 요구사항 반영) | Requirements Analysis |
| Property-Based Testing | Yes (NFR-4 PBT 12+ 속성 필수) | Requirements Analysis |

## Execution Plan Summary
- **Total Stages to Execute**: 8 (Application Design, Units Generation, Functional Design, NFR Requirements, Code Generation x6, Build and Test)
- **Stages to Skip**: NFR Design (설계 문서에 패턴 이미 정의), Infrastructure Design (AI Engineer 범위 밖, 출시 직전 결정)
- **Proposed Units**: 6 (Domain&Ports, C2 Solver, M7 PlaceData, C1 Gateway, Orchestration&API, Extended Features)
- **Estimated Duration**: 22~31일 (1인 AI Engineer)

## Stage Progress
### INCEPTION PHASE
- [x] Workspace Detection - Completed on 2026-07-12T00:00:00Z
- [x] Reverse Engineering - Completed on 2026-07-12T00:05:00Z
- [x] Requirements Analysis - Completed on 2026-07-12T00:10:00Z
- [ ] User Stories - SKIP (내부 AI 서비스, 사용자 직접 상호작용 없음)
- [x] Workflow Planning - Completed on 2026-07-12T00:15:00Z
- [x] Application Design - Completed on 2026-07-12T00:20:00Z
- [x] Units Generation - Completed on 2026-07-12T00:25:00Z

### CONSTRUCTION PHASE (per-unit)
- [x] Functional Design - EXECUTE (per-unit) — `construction/<unit>/functional-design/`. 유닛 목록은 여기 적지 말고 그 디렉토리를 볼 것 (U5 Orchestration&API 는 FD 없이 코드로 진행됐다)
- [ ] NFR Requirements - EXECUTE
- [ ] NFR Design - SKIP
- [ ] Infrastructure Design - SKIP
- [x] Code Generation - EXECUTE (per-unit) — 코드는 워크스페이스 루트 `src/trippilot/` 에 있다 (위 Code Location Rules)
- [x] Build and Test - EXECUTE — `.github/workflows/ai-ci.yml` 이 상시 게이트 (실행 앱 스키마 == 커밋된 `docs/openapi.json`, 외부 API 실 호출 0)

### OPERATIONS PHASE
- [ ] Operations - PLACEHOLDER

## Current Status
- **Lifecycle Phase**: CONSTRUCTION
- **Current Stage / Next Stage 는 이 파일에서 관리하지 않는다** — 유닛별 진행 상태 정본은 `../claude.md` §Current Status 와 `construction/<unit>/functional-design/` 실물이다. 2026-08-03 U4 머지 이후 이 파일 갱신이 끊겨 스테일이 됐기 때문이다(종전 표기: "U4 C1 LLM Gateway — FD 작성 완료, 승인 대기" / "Next Stage: U4 코드 생성 (승인 후)" — U4 는 이미 머지됐고 이후 U5·U6 까지 나갔다).
- **Status** (아래 U1~U3 은 2026-07~08 시점 기록으로 남긴다 — 현재 상태가 아니다):
  - U1 완료 (2026-07-23): 도메인 12모듈·Port 7종·Fake 9종·PBT 52 green, 4대 불변식 타입 강제, CI 테스트 게이트. PR #25 리뷰 대기 (develop), Jira TRIP-164 In Review.
  - U2 코어 완료 (2026-07-29): 벤치마크 게이트 통과(미결 #3 종결 — OR-Tools 확정), c2 8모듈(체인·HC·OR-Tools·LLM2차·repair·폴백·scorer), 76 tests green. PBT가 중복 고정블록 실버그 검출·수정. 잔여 경미 3건(oracle 대조·품질미달 트리거·2-opt)은 광택 백로그. Jira TRIP-165 In Review.
  - U3 코어 완료 (2026-07-29): FD 3종 + m7 4모듈(6단계 필터·자모 fuzzy 해소·TTL 캐시 래퍼), 테스트 91 green (POOL-P1~4·RES-P1/P2·CACHE-P1/P2). 가격 캐싱 금지 구조+테스트 이중 강제.
