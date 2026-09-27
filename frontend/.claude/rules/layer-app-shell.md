---
paths:
  - "src/app-shell/**"
---
# `src/app-shell/` — 루트 셸


Expo Router가 `src/app`을 점유해 비표준 이름을 썼다 — `src/app` **밖**에 있다.

| 파일 | 역할 |
|---|---|
| `src/app-shell/ui/SplashGate.tsx` | 부트스트랩 결과로 라우팅을 결정한다. 가드 밖에서 `trips/[tripId]/planb/index`를 `transparentModal`로 무조건 등록해 i04 재계획 시트가 허브를 언마운트하지 않고 겹쳐 뜬다 — 선언은 jest(`SplashGate.planbModal.test.tsx`)가 보지만 실제 겹침은 6-b 실기 전용. 푸시 등록은 `destination === 'HOME'`으로 **값이 바뀔 때만** 재실행되고 계정 상태(`DELETION_PENDING` 등)는 판정에 안 들어간다 |
| `src/app-shell/index.ts` | 배럴 — `SplashGate` 재수출. `src/app/_layout.tsx`가 이 배럴을 경유한다 |
