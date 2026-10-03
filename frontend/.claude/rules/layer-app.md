---
paths:
  - "src/app/**"
---
# `src/app/` — FSD app 층(루트 셸)


앱 전체에 한 번만 까는 것 — 전역 프로바이더·부팅 라우팅 게이트·전역 스타일. 슬라이스 없이 세그먼트(`entrypoint`·`routing`·`model`·`styles`)로만 나눈다. Expo Router 라우트 폴더는 루트 `app/`(별개, `layer-routes.md`)이다 — 이름이 같아도 다른 폴더다(TRIP-1161, 옛 `src/app-shell/`).

- **`ui/`·`providers/` 세그먼트 이름은 `pnpm fsd`(Steiger)가 error로 막는다** — `fsd/no-ui-in-app`·`fsd/segments-by-purpose`(`providers`는 "무엇"이라 금지). 그래서 SplashGate는 `routing/`, 프로바이더는 `entrypoint/`에 있다.
- **여기 파일은 라우트로 등록되지 않는다 — `app.config.ts`의 expo-router `root: './app'`이 있을 때만이다.** Expo CLI는 `src/app`이 있으면 무조건 그것을 라우트 루트로 고른다 — 옵션이 빠지면 이 층의 파일(테스트 포함)이 화면이 되고 번들이 깨진다(TRIP-1161 실측). tsc·lint는 이걸 못 보고, `releaseBuildConfig.test.ts`가 `root` 값만 단언한다(번들 라우트 목록은 CI에 없다).

| 파일 | 역할 |
|---|---|
| `src/app/entrypoint/AppProviders.tsx` | 전역 프로바이더 — 폰트 로드 게이팅(결판 전 `null`)·네이티브 스플래시(`preventAutoHideAsync`는 **모듈 최상위** — 지연 import·컴포넌트 안으로 옮기면 jest가 못 잡는 깜빡임)·`GestureHandlerRootView`·`SafeAreaProvider`·`QueryClientProvider`(children=`SplashGate` 바깥)·`ToastHost`(Stack 바깥). 전역 쿼리 retry는 `retryUnlessNotFound` |
| `src/app/routing/SplashGate.tsx` | 부트스트랩 결과로 라우팅을 결정한다. 가드 밖에서 `trips/[tripId]/planb/index`를 `transparentModal`로 무조건 등록해 i04 재계획 시트가 허브를 언마운트하지 않고 겹쳐 뜬다 — 선언은 jest(`SplashGate.planbModal.test.tsx`)가 보지만 실제 겹침은 6-b 실기 전용. 푸시 등록은 `destination === 'HOME'`으로 **값이 바뀔 때만** 재실행되고 계정 상태(`DELETION_PENDING` 등)는 판정에 안 들어간다 |
| `src/app/model/useAccountBoundaryReset.ts` | 게이트 목적지가 비LOGIN→LOGIN으로 **전이한 커밋 뒤**(직전 커밋에 스택을 그렸을 때만) `canDismiss()`면 `dismissAll()` → `replace('/login')` → `queryClient.clear()` → 취향 스토어 `reset()` 순으로 이전 계정 잔존 화면·캐시를 비운다. `Stack.Protected`는 가드 안 화면만 치워서 가드 밖 `trips/…`가 남기 때문이다. 순서를 뒤집으면 `dismissAll`이 방금 넣은 로그인까지 걷는다. 상태가 아니라 ref 직전 값의 **전이**로 판정한다(깃발이면 두 번째 로그아웃이 안 돈다). `SettingsPage.runLogout`의 clear·reset·replace와 이중이다(유지). **실제 스택 모양·이중 replace 깜빡임·`canDismiss`가 가드 반영 전 스택을 읽어 [(tabs), settings] 로그아웃에서 POP_TO_TOP 미처리 dev 경고를 낼 가능성·중첩 스택(trips/new) 잔존은 jest(라우터 목) 사각 — 6-b 실기 전용**. 이 훅을 SplashGate 밖에서 돌리면 기존 SplashGate 테스트 3종이 Provider·router 목이 없어 깨져 목(`jest.mock`)으로 끈다 |
| `src/app/index.ts` | 배럴 — `AppProviders`·`SplashGate` 재수출. 루트 레이아웃 `app/_layout.tsx`가 이 배럴을 경유한다. 목(`jest.mock`)은 배럴이 아니라 정의 모듈(`@/app/routing/SplashGate`)을 겨눈다 |
