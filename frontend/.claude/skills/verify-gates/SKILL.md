---
name: verify-gates
description: "TripPilot frontend 검증 게이트 실행 순서와 명령. '검증 돌려', '린트/타입체크/테스트 실행', '포맷 맞춰', '커밋해줘', '커밋 전 확인' 등 코드 검증·커밋이 필요한 모든 시점에 반드시 사용하라. 구현·리팩토링 직후에는 요청이 없어도 실행 대상이며, 커밋 요청 시에는 이 게이트를 통과시킨 뒤 커밋한다."
---

# Verify Gates

## 0. 사전 점검 (어떤 npx 명령보다 먼저)

다음이 하나라도 없으면 **npx를 실행하지 말고** 즉시 "실행 불가" 판정 + 필요한 설정 목록을 보고한다:

- `frontend/package.json` + `node_modules/` (의존성 설치 상태)
- 검사별 설정: prettier 설정, eslint 설정(`eslint.config.js`), `tsconfig.json`, jest 설정(package.json `jest` 필드 또는 `jest.config.*`, Expo면 `jest-expo` preset)

이유: 비대화형 환경의 npx는 미설치 패키지를 자동 설치·실행하므로 "도구 없음"이 검사 FAIL로 위장해 잘못된 수정 루프를 유발한다. **실행 불가는 PASS도 FAIL도 아니다 — 수정 루프로 보내지 마라.** 단, 두 가지 예외:
- **부재한 것이 이번 사이클의 AC 자체면**(스캐폴딩 사이클의 jest 설정처럼 구현 산출물인 경우) 실행 불가가 아니라 **FAIL**로 판정해 수정 루프로 보낸다 — 환경 전제의 부재와 구현 미완을 구분하라.
- **게이트① 시점에 존재했던 설정이 검증 시점에 사라졌으면**(00_gates.md의 환경 지문과 대조) 실행 불가가 아니라 **FAIL + 변조 에스컬레이션** — 도구를 부수는 것으로 FAIL을 판정 불능으로 세탁하는 경로를 막는다.
이 사전 점검은 qa-verifier만이 아니라 **게이트① 제시 전 오케스트레이터의 red 실행에도 선행**한다 — 설정 부재로 인한 전멸(SyntaxError 등)은 red가 아니라 "미실행 — 사유"로 기록해야 소급 확인이 발동한다.

## 순서 (고정 — 코드를 바꾸는 것 먼저, 그다음 싼 것부터)

**`frontend/package.json`의 스크립트가 정본이다.** 패키지 매니저는 pnpm(npm 혼용 금지). 현재 정의된 것:

```
1. pnpm format   # prettier --write .   (.prettierignore가 web/·.claude/·*.md 제외)
2. pnpm lint     # eslint .
3. pnpm tsc      # tsc --noEmit
4. pnpm test     # test:node + test:integration 순차 — 반드시 둘 다
```

- **`pnpm test`를 쪼개 부르지 마라.** 이 리포는 jest 설정이 둘이다(`jest.config.js` node 버킷 + `jest.integration.config.js` MSW 버킷). `pnpm test:node`만 돌리면 통합 테스트가 **0건 실행되고도 green으로 보인다.**
- 스크립트 이름을 추측하지 말고 `package.json`을 실제로 확인한다 — 위 목록도 스냅샷이다.

스크립트가 없는 패키지에서의 폴백:

1. 포매터: `npx prettier --write <소스 디렉토리>` — 존재하는 소스 디렉토리만 지정(`.prettierignore` 부재 시 정본 문서·하네스 파일까지 재포맷해 게이트② 승인 diff를 오염시킨다)
2. 린트: `npx eslint . --max-warnings 0`
3. 타입체크: `npx -p typescript tsc --noEmit` — `npx tsc` 단독 금지(타입스크립트가 아닌 동명의 스쿼팅 패키지로 해석될 수 있다)
4. 테스트: `npx jest` — Expo 프로젝트는 `jest-expo` preset 필수(없으면 사전 점검에서 실행 불가 판정)

## 판정 규칙

- 어느 검사든 실패 → 즉시 중단, 실패 로그 원문과 함께 보고. 다음 검사로 넘어가지 않는다(뒤 검사 결과는 무의미).
- 수정 루프: 실패 → 수정 → **1번부터 전체 재실행**(수정이 앞 검사를 깨뜨릴 수 있다).
- 리포트는 `04_qa-verifier_report_{n}_{PASS|FAIL}.md`로 차수+판정을 파일명에 붙여 **누적 저장**(덮어쓰기 금지). 채번은 파일 개수가 아니라 **기존 최대 n + 1** (번호 구멍이 있어도 충돌하지 않는다).
- 검증을 마칠 때마다 **판정·차수·시각을 00_gates.md에 append**한다 — 카운터의 정본은 원장이다. 리포트 파일 수 < 원장 검증 항목 수면 리포트 삭제로 간주하고 에스컬레이션한다.
- 에스컬레이션: **같은 검사 3회 연속 FAIL 또는 사이클 누적 FAIL 리포트 5개**(원장 기준 — PASS 리포트는 세지 않는다) → 사용자 에스컬레이션 + 문제로그 기록. 실패 검사가 번갈아 나와도 누적 상한에 걸린다.
- 에스컬레이션 보고는 게이트 제시 규칙의 축소판을 따른다(`<리포 루트>/frontend/.claude/skills/trippilot-dev-cycle/reference/gate-protocol.md`의 `## 게이트 노트` → `### 4계층 구조`): 본문은 **서술형 실패 요약**(무엇이 몇 회 실패 → 원인 가설 → 사용자가 고를 선택지 2~3개), 로그 원문은 첨부/문제로그로. 학습 중인 사용자에게 로그 덤프는 판단 지원이 아니다.

## 심판 보호 + 경계면 QA (검사 4 통과 후)

- **원장은 규약 경로로 스스로 해석한다**: `<리포 루트>/_workspace/{cycle-id}/00_gates.md` — 오케스트레이터가 전달한 경로를 신뢰하지 말고 규약 경로를 직접 연다(사본 스왑 방지).
- **변경 파일 목록 자체 도출**: `git status`/`git diff --name-only`로 실제 변경 집합을 스스로 도출하고, 게이트② 승인 목록·implementer 신고 목록과 대조 — **목록에 없는 변경 파일 발견 = FAIL**. 특히 테스트 인프라(jest 설정·setup·`__mocks__/`·공유 픽스처·tsconfig)의 미신고 변경은 즉시 에스컬레이션(테스트 파일을 안 건드리고 테스트를 죽이는 표준 경로다). `git status <리포 루트>/aidlc` 변경 여부도 함께 확인한다(리포 루트는 `git rev-parse --show-toplevel` — cwd 상대경로는 실행 위치에 따라 조용히 빈 결과를 낸다).
- **게이트① 무결성**: `00_gates.md`의 승인 테스트 파일 해시(포맷 후 상태로 박제됨 — `<리포 루트>/frontend/.claude/skills/trippilot-dev-cycle/reference/gate-protocol.md`의 `### 해시 규약`)와 현재 파일의 `shasum`을 대조. 포매터는 멱등이므로 재포맷으로 인한 차이는 존재하지 않아야 한다 — 다르면 검사 결과와 무관하게 **FAIL + 즉시 에스컬레이션**(심판 변조).
- **게이트② 무결성 (필수 리포트 항목)**: 게이트② 승인 해시 ↔ 현재 구현 파일 대조 결과와 현재 해시를 04 리포트에 기록한다. 불일치면 판정을 **"PASS(재제시 필요)"**로 명시 반환 — 이 대조는 오케스트레이터가 아니라 qa-verifier의 산출 의무다.
- **red 소급 확인 (사이클당 1회 · 2026-07-21 조건부화)**:
  - **1차 검증(n=1)에서는 반드시 수행한다.** red 로그 유무와 무관 — 로그는 붙여넣기 텍스트라 위조 검증이 불가능하므로 존재가 면제 사유가 되지 않는다.
  - **2차 이후는 구현 파일 해시가 1차와 같으면 건너뛰고** `red 소급 — n=1 결과 승계(구현 해시 불변)`를 04에 기재한다. 해시가 다르면 다시 수행한다.
  - **왜 줄였나**: `git stash push/pop`은 **작업트리를 건드리는 파괴적 연산**이다(절차 첫 줄이 잔류 stash 확인인 이유가 그것이다). 코드가 안 바뀐 재검증에서 반복하면 위험만 늘고 새로 잡는 건 없다 — 12사이클 검증 15회 중 4회가 재검증이었다.
  - **신규 테스트 유무로 범위를 좁히지 않는다** — 리팩토링 사이클이야말로 *구현을 옮겼는데 테스트가 옛 경로 목만 보고 green*이 될 수 있는 지점이라 이 검사가 가장 필요하다.
  - 절차: `git stash list`로 잔류 stash 확인(있으면 중단·보고) → **게이트② 승인 목록의 구현 파일만** 선택 대피(`git stash push -- <구현 파일 경로들>` — 테스트·설정 제외) → 테스트 실행으로 red 확인 → 복원. 대피 전후 `git status` 출력을 리포트에 첨부. **전부 green이면 vacuous 테스트 의심 FAIL**. 예외: 테스트 러너 자체가 이번 사이클 산출물이면(스캐폴딩) stash 방식이 성립하지 않는다 — 대신 **승인 테스트의 단언 1개를 일시 반전시켜 FAIL을 관찰(테스트 생존 증명) 후 원상 복원**하고 그 로그를 첨부한다.
- **구조 지도 대조**: `node <리포 루트>/frontend/.claude/skills/trippilot-dev-cycle/scripts/structure-index.cjs --check` — `docs/structure.md`의 행 ↔ 실제 파일. 이번 사이클이 파일을 추가·삭제·이동했는데 지도가 안 따라왔으면 여기서 잡힌다. **불일치는 FAIL이 아니라 리포트에 기재 + [기록]의 scribe 작업 목록으로 넘긴다**(지도는 [기록] 산출물이라 검증 시점엔 아직 안 고쳐졌을 수 있다). 단 [기록] 이후 재검증에서도 불일치면 FAIL.
- `backend/docs/design/openapi.yaml` 응답 스키마 ↔ 프론트 타입/훅 shape 교차 비교.
- INV-3 점검: duration 단일 키워드가 아니라 시간 표시 계열을 grep한다 — `duration|minutes?|\bmin\b|eta|소요` (DTO·타입) + 화면 코드의 시간 단위 표시 문자열(`"분"`, `"min"`). 명칭 변경·파생 계산 표시를 잡기 위함이다.
- 불일치는 FAIL로 취급하고 리포트에 양쪽 정의를 병기한다(권위는 서버 계약).

## 실기 스모크 (조건부 · 2026-07-21 신설)

**왜 있나**: jest는 픽셀·레이아웃·Metro/Hermes·딥링크를 **원리적으로 못 본다.** 그리고 12사이클에서 발견된 **유일한 실제 동작 결함**이 정확히 그 층에서 나왔다 — `20260720-trip161-mock-seam`은 jest 121 green · 해시 12/12 일치 · 타입 0 · 린트 0을 **전부 통과한 뒤** 시뮬레이터에서 레드박스가 떴고(`Property 'MessageEvent' doesn't exist`), 목이 안 걸려 `localhost:8080` 커넥션이 20회 나갔다. 위 검사 4개는 그걸 볼 방법이 없다.

### 발동 조건 — diff로 기계 판정

**하나라도 걸리면 실행한다.** 실제 사고가 난 지점만 골랐다.

| 조건 | 실제 사고 |
|---|---|
| `package.json` 의존성 변경 | `expo-auth-session` 3종 추가 (real-oauth) |
| `src/app/**` 변경 | 라우팅·진입 분기 (온보딩 가드·SplashGate) |
| `metro.config.js` · `babel.config.js` · `app.config.ts` | 번들러 설정 |
| `src/mocks/**` · `__mocks__/**` · `src/test-support/**` | 목 경계 (mock-seam) |
| diff에 `import(` 추가·변경 | 동적 import — Metro가 원형을 남기지만 jest는 그 원형을 못 돌린다 |

걸리는 게 없으면 건너뛰고 04에 "스모크 미해당"을 적는다.

### 0. 사전 점검 — 없으면 "실행 불가"(FAIL 아님)

```bash
xcrun simctl list devices booted | grep -q Booted        # 시뮬레이터 부팅 상태
xcrun simctl listapps booted | grep -q com.trippilot.app # dev build 설치 상태
```

§0 사전 점검과 같은 정신이다 — **환경 부재는 실행 불가이지 FAIL이 아니다.** 사용자에게 보고하고, 이 상태로 [기록]에 가면 **"실기 미검증"을 강제 명기**한다.

### 절차

```bash
# 1. 깨끗한 재기동 (launch가 PID를 반환하면 프로세스는 떴다)
xcrun simctl terminate booted com.trippilot.app 2>/dev/null
xcrun simctl launch booted com.trippilot.app

# 2. 이번 사이클이 만진 화면으로 진입 (프리뷰 딥링크는 동작 확인됨)
xcrun simctl openurl booted trippilot://_dev/preview

# 3. 캡처 → Read 도구로 실제로 눈으로 본다 (레드박스는 로그보다 화면이 확실하다)
xcrun simctl io booted screenshot <스크래치패드>/smoke-{n}.png

# 4. 예상 밖 네트워크 — mock-seam을 잡은 바로 그 검사
xcrun simctl spawn booted log show --last 2m --style compact \
  --predicate 'subsystem == "com.apple.network"' | grep -i "localhost:8080\|CFNetwork"
```

### 판정 4항목 — 하나라도 실패면 FAIL → implementer 수정 루프

1. 프로세스 부팅 (`launch`가 PID 반환)
2. **레드박스 없음** — 스크린샷을 Read로 열어 확인. "로그에 없으니 없겠지"로 넘기지 마라
3. 예상 밖 네트워크 0건 (목 ON인데 실서버로 나가는 등)
4. 대상 화면 도달

### 한계 — 넘겨짚지 마라

- **탭·스와이프 자동화는 이 환경에서 불가**(접근성 권한 부재). 스모크는 **진입까지**만 본다. 상호작용 확인은 사용자 몫이고, 그 사실을 04b에 적는다.
- 스모크 PASS ≠ 비주얼 정합. 픽셀 충실도는 `figma-screen-impl` 5단계(스크린샷 대조)의 몫이다.

### 산출

`_workspace/{cycle-id}/04b_smoke_{n}_{PASS|FAIL|SKIP|실행불가}.md` — 04와 같은 채번 규칙(기존 최대 n+1), 덮어쓰기 금지. 판정을 00_gates.md에 append한다.

## 사이클 밖 단독 호출 시

사이클 워크스페이스(`_workspace/{cycle-id}/`)가 없는 호출("커밋 전 확인" 등)에서는 04 리포트 파일을 만들지 않는다 — 결과는 채팅 보고로 대신하고, 심판 보호 항목 중 원장 의존 검사(해시 대조·red 소급)는 해당 없음으로 건너뛴다.

## 빌트인 `run` 스킬과의 관계

verify-gates는 정적 검사 + 테스트(커밋 전 필수), 빌트인 `run`은 앱을 실제 구동해 변경을 눈으로 확인하는 보완 단계다. "커밋해줘" 요청에는 verify-gates가 먼저다. 같은 요청에 둘을 중복 실행하지 않는다.
