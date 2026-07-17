---
name: tdd-workflow
description: "TripPilot TDD 규칙. 테스트 작성, 테스트부터 뽑기, AC를 테스트로 변환, red-green-refactor 진행 시 반드시 사용하라. '테스트부터 만들어', 'TDD로 해', '테스트 케이스 뽑아', '테스트 검토' 요청 포함."
---

# TDD Workflow

## 사이클

red(실패 테스트) → 🧑 사용자 검토 ① → green(최소 구현) → 🧑 사용자 검토 ② → verify-gates → refactor → **re-green(재검증 필수)**

리팩토링 후 재검증을 생략하면 리팩토링이 무검증 변경이 된다 — 반드시 verify-gates를 다시 통과시킨다.

## AC ↔ 테스트 매핑

모든 테스트 산출물에 매핑 표를 포함한다:

| AC | 근거 코드 | 테스트 | 상태 |
|---|---|---|---|
| 저장 시 목록에 즉시 반영 | US-E2-03 | `saves.test.tsx > "adds to list"` | red |

- 매핑 없는 테스트, 커버 안 된 AC가 남으면 게이트 ①을 통과할 수 없다.
- 근거 코드는 브리프(01) 또는 승인된 Seed(01b)에서 가져온다. 두 문서에 없는 AC를 임의로 추가하거나 추적 코드를 날조하지 않는다.

## 테스트 작성 규칙

- 프레임워크: `jest-expo` preset + Jest + React Native Testing Library (스캐폴딩 시 이 조합으로 설치 — jest-expo 없이는 node_modules/react-native의 미변환 구문 때문에 전 테스트가 SyntaxError로 죽는다)
- 동작을 테스트하라, 구현을 테스트하지 마라 — 내부 상태·private 접근 단언 금지. 구현 테스트는 리팩토링 단계에서 가짜 실패를 만든다.
- 서버 응답 모킹은 `backend/docs/design/openapi.yaml` 계약 기준 — 임의 shape 발명 금지
- 클라이언트 검증 테스트는 UX 동작(에러 표시)까지만 — 룰 판정의 권위는 서버
- duration 필드가 등장하는 테스트 작성 금지(INV-3)

## 게이트 ① 제출 체크리스트

- [ ] 모든 테스트가 red 상태임을 실행으로 확인(환경 부재 시 "미실행" 명시 + 필요 설정 기록 — 이 면제를 쓰면 [검증] 단계에서 qa-verifier가 red를 소급 확인한다)
- [ ] AC↔테스트 매핑 표 완성(빈칸 없음)
- [ ] 프로덕션 코드 변경 없음(컴파일용 타입/인터페이스 선언 제외)
- [ ] 테스트 이름만 읽어도 무엇을 보장하는지 알 수 있음

승인 시 테스트 파일 해시와 red 로그가 `00_gates.md`에 기록된다 — 이후 테스트 파일 변경은 qa-verifier 해시 대조에서 FAIL이 난다.

## 사이클 밖 단독 호출 시

trippilot-dev-cycle을 거치지 않고 이 스킬만 발동한 경우(브리프·Seed 없음):
- 대상 요구와 근거를 사용자에게 확인하고, 매핑 표의 근거 코드에 "없음(단독 작업)"을 표기한다 — 추적 코드를 날조하지 마라.
- 작업 후 obsidian-second-brain으로 기록을 남긴다.
- 규모가 있는 코드 변경이면 trippilot-dev-cycle로의 승격을 사용자에게 제안한다.
