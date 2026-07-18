# 2026-07-18 · 20260718-token-mirroring (경량 사이클)

Figma TripPilot 변수 컬렉션(38토큰 + 텍스트 스타일 8종)을 `tailwind.config.js` `theme.extend`에 같은 이름·같은 값으로 미러링. 목적 = 코드가 Figma와 같은 토큰 언어를 쓰게 하는 정본 단일화(오늘 DS 구축의 후속).

## 변경 파일

- `frontend/tailwind.config.js` (수정) — theme.extend 채움: colors 25 · borderRadius 6 · spacing 7 · fontSize 8(튜플). 헤더 주석에 "Figma 변수 변경 시 config+테스트 동시 갱신" 규칙 명시.
- `frontend/src/__tests__/design-tokens.test.ts` (신규) — 이중 전사 대조(Figma 덤프를 기대 매니페스트와 config에 독립 전사 후 `toEqual` 전수 비교), AC-1~5.

## 결정

- 네이밍 Figma 1:1 (`color/primary` → `colors.primary`).
- lineHeight px 반올림 (RN unitless 미지원, `Math.round`, 예 14×145%=20.3→20). Figma %가 정본, px는 파생값.
- spacing은 extend(추가)로 기본 `p-4` 스케일 보존 + `p-lg` 병행 (점진 이행).
- fontFamily 제외 (Noto Sans KR 미설치 — U0 A조각, 침묵 폴백 방지).
- PBT 미적용 (고정 열거값 = 입력 공간 0, 상수 대조가 맞음).

## 게이트·검증

- 통합 게이트①②(경량 분기) 승인. 승인 해시: 테스트 `a9f034…ff40` · config `bcd7d1…05a8`.
- 검증 n=1 FAIL → n=2 PASS. FAIL 사유는 코드가 아니라 미신고 변경 1건(사이클 외 INV-3 정합 스윕의 미커밋 잔류분 `docs/와이어프레임-화면-IO정리.md`) — 원장 "변경집합 신고 정오" 절로 출처 영속 후 PASS.
- n=2: format/lint/tsc/test 전부 PASS(jest 3 suites / 11 tests), 게이트①② 해시 대조 일치, red 소급 유효(n=1 원용), 경계면 QA(aidlc 오염 0) PASS.

## 후속

- 커밋 A(토큰 미러 2파일) / B(INV-3 정합 잔류분) 분리 유지 — `git add -A` 편승 금지.
- 미러 사용 규율·Figma→코드 자동 동기화는 후속 사이클.

## 옵시디언 상세

- `TripPilot/개발로그/2026-07-18 20260718-token-mirroring.md`
- 에러로그: `TripPilot/에러로그/2026-07-18 검증1 변경집합 신고 누락.md`
