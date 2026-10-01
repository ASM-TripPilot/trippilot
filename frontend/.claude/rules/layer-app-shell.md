---
paths:
  - "src/app-shell/**"
---
# `src/app-shell/` — 루트 셸


Expo Router가 `src/app`을 점유해 비표준 이름을 썼다 — `src/app` **밖**에 있다.

| 파일 | 역할 |
|---|---|
| `src/app-shell/ui/SplashGate.tsx` | 부트스트랩 결과로 라우팅을 결정한다. 가드 밖에서 `trips/[tripId]/planb/index`를 `transparentModal`로 무조건 등록해 i04 재계획 시트가 허브를 언마운트하지 않고 겹쳐 뜬다 — 선언은 jest(`SplashGate.planbModal.test.tsx`)가 보지만 실제 겹침은 6-b 실기 전용. 푸시 등록은 `destination === 'HOME'`으로 **값이 바뀔 때만** 재실행되고 계정 상태(`DELETION_PENDING` 등)는 판정에 안 들어간다 |
| `src/app-shell/model/useAccountBoundaryReset.ts` | 게이트 목적지가 비LOGIN→LOGIN으로 **전이한 커밋 뒤**(직전 커밋에 스택을 그렸을 때만) `canDismiss()`면 `dismissAll()` → `replace('/login')` → `queryClient.clear()` → 취향 스토어 `reset()` 순으로 이전 계정 잔존 화면·캐시를 비운다. `Stack.Protected`는 가드 안 화면만 치워서 가드 밖 `trips/…`가 남기 때문이다. 순서를 뒤집으면 `dismissAll`이 방금 넣은 로그인까지 걷는다. 상태가 아니라 ref 직전 값의 **전이**로 판정한다(깃발이면 두 번째 로그아웃이 안 돈다). `SettingsPage.runLogout`의 clear·reset·replace와 이중이다(유지). **실제 스택 모양·이중 replace 깜빡임·`canDismiss`가 가드 반영 전 스택을 읽어 [(tabs), settings] 로그아웃에서 POP_TO_TOP 미처리 dev 경고를 낼 가능성·중첩 스택(trips/new) 잔존은 jest(라우터 목) 사각 — 6-b 실기 전용**. 이 훅을 SplashGate 밖에서 돌리면 기존 SplashGate 테스트 3종이 Provider·router 목이 없어 깨져 목(`jest.mock`)으로 끈다 |
| `src/app-shell/index.ts` | 배럴 — `SplashGate` 재수출. `src/app/_layout.tsx`가 이 배럴을 경유한다 |
