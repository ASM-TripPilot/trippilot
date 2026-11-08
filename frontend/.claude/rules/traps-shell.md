---
paths:
  - "app/**"
  - "src/shared/ui/**"
---
이 파일은 repo-traps.md에서 경로별로 쪼갠 함정이다 — 해당 경로 만질 때만 로드된다.

## 라우팅 · 셸

- **미인증 딥링크 노출** → `stays/`·`stays/register`·`trips/new/**`는 전부 `(tabs)` 밖의 파일시스템 라우트라 `SplashGate`의 `Stack.Protected` guard 어디에도 안 걸린다 — 미인증에서도 딥링크로 열린다(API가 401을 주므로 데이터 노출은 없다). 새 라우트를 이 그룹들 밖에 추가할 때 guard 안에 넣을지는 아무도 안 물어본다 — 고치려면 라우트 위치 자체를 바꾸는 결정이 선행돼야 한다.
- **탭바는 네비게이션도 SafeArea도 모르는 순수 뷰 계약이다** → 그래서 홈 인디케이터 bottom inset을 합산하지 않는다. 고치려면 이 계약을 바꾸는 결정이 선행돼야 한다.
- **탭 라우트를 렌더하는 테스트는 조회 훅의 전역 목에 기댄다** → 5탭은 전부 실화면이라, `render(<XxxRoute/>)`가 QueryClient 없이도 도는 것은 기존 전역 목(`useGetTrips` 빈 목록 스텁)이 있어서다. 탭 라우트가 새 조회 훅을 물게 되면 그 훅의 목을 새로 걸어야 크래시하지 않는다(재사용 우선). `shell-tab-placeholder-*` 참조는 `tabsMyRoute.test.tsx`·`tabsRecordsRoute.test.tsx`의 사후 부재 확인용뿐이다.
- **컨테이너/뷰가 한 파일에 있으면 프리뷰가 컨테이너의 import 사슬을 전이 로드한다** → `preview.tsx`가 화면의 순수 뷰만 태우려 해도, 뷰를 컨테이너 파일(`XxxScreen.tsx`)에서 가져오면 그 파일 최상단의 컨테이너 전용 import(`usePreferences` 등 `@/shared/api`로 이어지는 훅)가 모듈 평가 시점에 함께 실행돼 프리뷰 스모크(`devPreviewReleaseGate.test.tsx`)의 "프리뷰는 네트워크 계층을 로드하면 안 된다" 지뢰 목이 로드 시점에 throw한다(개념 [[모듈 로드 크래시 연쇄]]). 새로 컨테이너+순수뷰 분리 화면을 프리뷰에 심을 때는 뷰를 처음부터 별 파일(`XxxView.tsx`, api import 0)로 두고 프리뷰가 그 파일에서만 import한다.
- **프리뷰가 이미 열린 상태에서 다른 `state` 딥링크를 `openurl`해도 화면이 안 바뀐다** → 같은 라우트라 라우터가 새 URL을 무시한다(에러 없음 — 이전 키 화면이 그대로 떠 있어 "이 키가 렌더됐다"로 오인한다, TRIP-1147 04b 실측). 키마다 `terminate`+`launch` 재기동 뒤 진입한다(verify-gates 자동 육안 게이트의 캡처 절차가 그렇게 한다).
- **탭 바와 허브·기록 바는 좌우 여백·알약 패딩·유리·라벨만 같은 정의를 읽고, 높이·아랫변은 여전히 따로 정해진다** → TRIP-1739 부터 좌우 30·알약 안 패딩 10/2·칸 간격 3·아이콘 27 은 셋 다 `src/shared/ui/navBarLayout.ts` 의 `NAV_BAR_*`, 유리는 `GlassSurface`, 라벨은 `NavBarLabel` 이다(그 전엔 탭 바가 리터럴 사본이라 잇는 코드가 없었다 — TRIP-1522 사이클 3). 둘 다 안전영역을 더하지 않는다. 그러나 **높이는 방식이 다르다** — 탭 바 칸은 패딩+내용으로 자라고(큰 글자, TRIP-1642) 허브·기록 칸은 `NAV_BAR_CELL_HEIGHT` 54 고정이라, 탭 바 쪽 `py-[6px]`·`min-h-[96px]`·`pt-[26px]` 을 바꾸면 허브 바와 조용히 어긋난다(이 셋은 `TAB_BAR_*` 짝이라 className 리터럴이고 허브 테스트는 못 본다). 아랫변도 일부러 안 같다 — 탭 바 pill 은 코드 계산상 높이 62·아랫변 8, 허브 바는 Figma 값 58·12(윗변은 둘 다 70). 허브가 `none` 으로 서는 순간 시작 5칸이 홈 탭 바와 겹치는 장면에서 4pt 가장자리가 비칠 수 있다(사이클 3 실측은 1~2pt·육안 이상 없음, 사이클 4 의 `none` 전환 장면은 실측 안 함).
- **허브 라우트 `none`(전환 없음)은 `SplashGate` 의 선언 한 줄뿐이고 jest 는 이 선언을 보지 않는다** → 선언을 잠그던 SG-HUB1~3 은 2026-11-01 jest 축소로 지웠다(README 판정 4 — 통과형 `Stack` 목 위 prop 단언). 선언 회귀와 실제 전환 없음·iOS 스와이프 뒤로(길이 0 이라 모션 없이 나감)·지도 첫 렌더 빈 화면 번쩍임은 6-b 전용이다. 사이클 3 의 `fade` 는 영상의 4단계 모프가 아니어서 사이클 4 가 `none` 으로 바꿨다. 이 선언은 허브로 들어가는 모든 경로와 뒤로(pop)에 걸린다. `animation: 'none'` 은 허브 말고 도우미(`assistant/index`, TRIP-1554 — transparentModal 유지, 열림·닫힘 모두 즉시)에도 있다 — 더해 바를 화면 안에 그리는 push 화면 6곳(`BAR_SCREEN_ROUTES`, TRIP-1584)까지 8곳뿐이다(선언을 잠그는 jest 없음 — 실화면 QA·기능 지도 `bar-screen-no-slide`·`launch-guide-no-swipe`)(iOS 가장자리 스와이프 뒤로는 `none` 에서도 손가락을 따라 동작함 — 6-b 실측. 그래서 회고 j03·요약 j04 만 `gestureEnabled: false`(`NO_SWIPE_ROUTES`, TRIP-1600)를 더 준다 — 이 둘의 스와이프 차단과 "`none`+`false` 를 같이 줘도 죽는가"는 jest 가 못 보고(6-b 전용·미검증), 안드로이드 하드웨어 뒤로는 제스처가 아니라 그대로 pop 이라 두 플랫폼의 복귀 도착지가 다르다)(화면 파일 안 `setOptions`·`<Stack.Screen options>` 덮어쓰기는 jest 사각, 현재 0건). 앱 전체 `screenOptions` 나 `planb` 선언에 `animation` 이 새면 다른 화면 전환이 바뀐다(잠그는 jest 없음 — 실화면 QA).
- **투명 모달(도우미 시트) 위에 `push` 한 화면은 native-stack 이 모달로 승격해 아래에서 올라오는 카드로 뜬다** → `assistant` 가 루트의 투명 모달이라 그 뒤에 쌓이는 상세 라우트(7곳 모두 `(tabs)` 밖 루트)는 `getModalRoutesKeys` 로 modal 이 된다(TRIP-1565 6-b 실측). 그 상세 라우트에 `presentation: 'card'` 를 선언하면 승격이 막혀 상세가 시트 **밑에** 깔릴 수 있다 — 도우미에서 push 하는 라우트의 presentation 은 건드리지 마라. 상세의 탭바 등 `dismissTo` 로 나가면 시트까지 함께 걷힌다(수용). jest 는 라우터를 stub 해 이 모양·승격을 못 본다(6-b 전용).
- **`BottomTabBar` 의 `ghost` 는 투명도 0 이 아니라 0.02 다** → iOS 는 alpha<0.01 뷰에 터치를 주지 않아 0 이면 모프 중 탭 칸이 안 눌린다. jest 는 터치 통과를 못 보고(`tabsShell` 은 navigate 호출까지만), 배선(`ghost={exit !== null}`)은 리포 규칙(style 값 단언 금지)으로 단언도 못 넣어 지워도 green 이다(TRIP-1831 6-a 1차 lint FAIL 실측). 실기기 터치는 미확인 — 실화면 QA 몫.

## 서버 POI 사진 (`PoiPhoto`)

- **ESLint 게이트(`POI_PHOTO_GATE`, TRIP-1740)는 `<PlacePhoto imageUrl=…>`·`<Image source={{uri}}>` 직접 사용만 막는다 — 아래 우회는 에러 없이 통과해 관광공사 3유형 사진을 잘라 그린다** → `<PlacePhoto {...props}>` 스프레드 · `<Image source={변수}>`(`StayRecommendCard` 가 이미 이 모양으로 숙소 사진을 그린다) · 별칭 `import { Image as ExpoImage }` · `ImageBackground` · `app/_dev/**` · `.ts` 파일. 이용 조건(공공누리 3유형 변경금지·출처 표시)이라 새 서버 POI 사진 출구는 반드시 `shared/ui/PoiPhoto` 로 그리고(`imageLicense` 필수), 예외 주석(`eslint-disable-next-line no-restricted-syntax -- 사유`)은 그 줄의 다른 금지(버튼 role 등)까지 같이 끈다. `eslint.config.js` 주석에는 이 사정거리 목록이 없다(03b R1).
