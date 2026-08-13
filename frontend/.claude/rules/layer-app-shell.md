---
paths:
  - "src/app-shell/**"
---
# `src/app-shell/` — 루트 셸 (TRIP-173 신설)


Expo Router가 `src/app`을 이미 점유해 비표준 이름을 썼다(01b Seed 확정) — `src/app` **밖**에 있다.

| 파일 | 역할 |
|---|---|
| `src/app-shell/ui/SplashGate.tsx` | 부트스트랩 결과에 따라 라우팅 결정(구 `features/auth/containers/SplashGate.tsx`). 향후 `QueryClientProvider` 등 앱 전역 프로바이더가 여기 모일 자리 |
| `src/app-shell/index.ts` | 배럴 — `SplashGate` 재수출. `src/app/_layout.tsx`가 이 배럴을 경유(딥 임포트 0건, code-critic E5 확인) |
