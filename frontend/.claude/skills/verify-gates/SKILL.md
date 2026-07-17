---
name: verify-gates
description: "TripPilot frontend 검증 게이트 실행 순서와 명령. '검증 돌려', '린트/타입체크/테스트 실행', '포맷 맞춰', '커밋해줘', '커밋 전 확인' 등 코드 검증·커밋이 필요한 모든 시점에 반드시 사용하라. 구현·리팩토링 직후에는 요청이 없어도 실행 대상이며, 커밋 요청 시에는 이 게이트를 통과시킨 뒤 커밋한다."
---

# Verify Gates

## 0. 사전 점검 (어떤 npx 명령보다 먼저)

다음이 하나라도 없으면 **npx를 실행하지 말고** 즉시 "실행 불가" 판정 + 필요한 설정 목록을 보고한다:

- `frontend/package.json` + `node_modules/` (의존성 설치 상태)
- 게이트별 설정: prettier 설정, eslint 설정(`eslint.config.js`), `tsconfig.json`, jest 설정(package.json `jest` 필드 또는 `jest.config.*`, Expo면 `jest-expo` preset)

이유: 비대화형 환경의 npx는 미설치 패키지를 자동 설치·실행하므로 "도구 없음"이 게이트 FAIL로 위장해 잘못된 수정 루프를 유발한다. **실행 불가는 PASS도 FAIL도 아니다 — 수정 루프로 보내지 마라.**

## 순서 (고정 — 코드를 바꾸는 것 먼저, 그다음 싼 것부터)

`frontend/package.json`에 스크립트가 정의되면 그것이 정본(`npm run format` / `lint` / `typecheck` / `test`). 없으면:

1. 포매터: `npx prettier --write <소스 디렉토리>` — **존재하는 소스 디렉토리(src/, app/, components/ 등)만 지정**. `.prettierignore`가 정비되기 전까지 `--write .` 금지 — docs/ 정본 문서·web/·`.claude/` 하네스 파일까지 재포맷해 게이트② 승인 diff를 오염시킨다.
2. 린트: `npx eslint . --max-warnings 0`
3. 타입체크: `npx -p typescript tsc --noEmit` — `npx tsc` 단독 금지(타입스크립트가 아닌 동명의 스쿼팅 패키지로 해석될 수 있다)
4. 테스트: `npx jest` — Expo 프로젝트는 `jest-expo` preset 필수(없으면 사전 점검에서 실행 불가 판정)

## 판정 규칙

- 어느 게이트든 실패 → 즉시 중단, 실패 로그 원문과 함께 보고. 다음 게이트로 넘어가지 않는다(뒤 게이트 결과는 무의미).
- 수정 루프: 실패 → 수정 → **1번부터 전체 재실행**(수정이 앞 게이트를 깨뜨릴 수 있다).
- 리포트는 `04_qa-verifier_report_{n}.md`로 차수를 붙여 **누적 저장**(덮어쓰기 금지 — n이 실패 카운터를 겸해 세션 재개 후에도 유지된다).
- 에스컬레이션: **같은 게이트 3회 연속 실패 또는 사이클 누적 FAIL 5회(차수 n 기준)** → 사용자 에스컬레이션 + 에러로그 기록. 실패 게이트가 번갈아 나와도 누적 상한에 걸린다.

## 심판 보호 + 경계면 QA (게이트 4 통과 후)

- **게이트① 무결성**: `00_gates.md`의 승인 테스트 파일 해시와 현재 파일의 `shasum`을 대조 — 다르면 게이트 결과와 무관하게 **FAIL + 즉시 에스컬레이션**(심판 변조).
- **red 소급 확인**: 00_gates.md에 red 로그가 없으면(미실행 면제 사용) 구현 변경분을 임시 대피(`git stash -u`)한 상태로 테스트를 실행해 승인 테스트가 red였음을 확인하고 복원한다. 로그를 리포트에 첨부하고, **전부 green이면 vacuous 테스트 의심 FAIL**.
- `backend/docs/design/openapi.yaml` 응답 스키마 ↔ 프론트 타입/훅 shape 교차 비교.
- INV-3 점검: 프론트 DTO/화면 코드에 duration 필드 존재 여부 grep.
- 불일치는 FAIL로 취급하고 리포트에 양쪽 정의를 병기한다(권위는 서버 계약).

## 빌트인 verify 스킬과의 관계

verify-gates는 정적 검사 + 테스트 게이트(커밋 전 필수), 빌트인 verify는 앱을 실제 구동해 변경을 관찰하는 보완 단계다. "커밋해줘" 요청에는 verify-gates가 먼저다. 같은 요청에 둘을 중복 실행하지 않는다.
