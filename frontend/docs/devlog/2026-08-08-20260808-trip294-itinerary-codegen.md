# 2026-08-08 20260808-trip294-itinerary-codegen

> 축약본. 상세(결정 이유·예상과 달랐던 것·게이트 §0·리뷰 실적·이해부채 6건)는 옵시디언 `TripPilot/개발로그/2026-08-08 20260808-trip294-itinerary-codegen.md`.

## 대상

TRIP-294 [FE] 일정 계약 codegen 확장 — itinerary 4오퍼레이션(`GET/POST/PUT /trips/{tripId}/itinerary` · `POST .../confirm`). 브랜치 `feature/TRIP-295-FE-timeband-slotkey`(이 사이클은 294), 기준 커밋 `ba67db3`. 규모 기본. 손코드 2줄(`package.json` codegen 스크립트 · `orval.config.ts` 주석) + orval 생성물 신규 11 · 변경 2.

## 게이트

- 게이트①-1 승인 · 게이트②-1 승인
- [검증] 6-a PASS(`04_qa-verifier_report_1_PASS.md`) — 포매터·린트·tsc·테스트 4개 전부 통과, 게이트①·② 해시 무손상, red 소급 확인, aidlc 무변경
- 실기 스모크 SKIP(미해당 — 런타임 미실행 코드, 소비자 0)

## 정본 반영

3-a 제시 5(A~E) / 선택 3(B·C·D). D → `frontend/docs/structure.md`(심볼명 5개 정정 + itinerary 11파일 행 추가 + 56→67). B·C → `aidlc/aidlc-docs/construction/{plans/u3-ai-itinerary-functional-design-plan.md, u3-ai-itinerary/functional-design/frontend-components.md}` 경로 표기 정정 + `aidlc/aidlc-docs/audit.md` Post-Design Correction append. A(GenerationMode 계약 공백)는 BE 티켓 후보로만 상신, 미반영.

## 구조 지도

`structure-index.cjs --check` OK(259행↔259파일 일치). 경고 절 12건(상한 이내).

## 이해부채·문제로그

이해부채 6건 신규 등재(누적 47건 미상환). 문제로그 2건 — frozen-66 목록 브랜치 시점 낡음, INV-3 수호 주석 탐지기 함정.

## 다음에 이어서 할 일

code-critic 지적 5건(경고2·참고3) 전부 이월(게이트① 동결 테스트를 열어야 함 — 처방: CI `pnpm codegen && git diff --exit-code`). A(BE 티켓 후보) 상신 필요. 밴드 h 착수 시 실기 스모크 최초 발동.
