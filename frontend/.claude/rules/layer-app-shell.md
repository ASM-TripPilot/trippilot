---
paths:
  - "src/app-shell/**"
---
# `src/app-shell/` — 루트 셸 (TRIP-173 신설)


Expo Router가 `src/app`을 이미 점유해 비표준 이름을 썼다(01b Seed 확정) — `src/app` **밖**에 있다.

| 파일 | 역할 |
|---|---|
| `src/app-shell/ui/SplashGate.tsx` | 부트스트랩 결과에 따라 라우팅 결정(구 `features/auth/containers/SplashGate.tsx`). 향후 `QueryClientProvider` 등 앱 전역 프로바이더가 여기 모일 자리. **TRIP-750 추가**: 가드 로직 밖에 `<Stack.Screen name="trips/[tripId]/planb/index" options={{ presentation: 'transparentModal' }} />`를 무조건 등록 — `planb/index` 라우트(i04 재계획 요청)가 뒤 화면을 언마운트하지 않고 허브 위에 스크림+시트로 겹쳐 뜨게 한다(딥링크·푸시 착지 유지, D1). 선언까지는 jest가 목 `Stack.Screen`의 props로 확인하지만(`SplashGate.planbModal.test.tsx`), 실제 겹침·스크림 아래 허브 잔존은 6-b 실기 전용(`traps-figma.md`·`repo-traps.md` 바텀시트 절과 동형 사각) |
| `src/app-shell/index.ts` | 배럴 — `SplashGate` 재수출. `src/app/_layout.tsx`가 이 배럴을 경유(딥 임포트 0건, code-critic E5 확인) |
