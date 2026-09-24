---
paths:
  - "src/app/**"
  - "src/shared/ui/**"
---
이 파일은 repo-traps.md에서 경로별로 쪼갠 함정이다 — 해당 경로 만질 때만 로드된다.

## 라우팅 · 셸

- **미인증 딥링크 노출** → `stays/`·`stays/register`·`trips/new/**`는 전부 `(tabs)` 밖의 파일시스템 라우트라 `SplashGate`의 `Stack.Protected` guard 어디에도 안 걸린다 — 미인증에서도 딥링크로 열린다(API가 401을 주므로 데이터 노출은 없다). 새 라우트를 이 그룹들 밖에 추가할 때 guard 안에 넣을지는 아무도 안 물어본다 — 고치려면 라우트 위치 자체를 바꾸는 결정이 선행돼야 한다.
- **탭바는 네비게이션도 SafeArea도 모르는 순수 뷰 계약이다** → 그래서 홈 인디케이터 bottom inset을 합산하지 않는다. 고치려면 이 계약을 바꾸는 결정이 선행돼야 한다.
- **탭 셸 자리표시자(`shell-tab-placeholder-*`) 교체는 test-designer가 `tabsShell.test.tsx`의 해당 describe를 직접 갈아야 한다 — 기계가 자동 갱신해 주지 않는다** → `my`(TRIP-604)·`records`(TRIP-575) 두 탭이 이미 이 경로를 거쳤다(explore·itinerary는 더 앞서 승격 — `records`가 마지막으로 남았던 껍데기라 이제 5탭 전부 실화면, `shell-tab-placeholder-*` 잔존 참조는 `tabsMyRoute.test.tsx`·`tabsRecordsRoute.test.tsx`의 사후 부재 확인용뿐). 새 탭이 준비 중 셸을 실화면으로 승격할 때 이 describe를 안 바꾸면 placeholder testID 부재로 계속 red다 — 뮤테이션 실측(§5, "지금 상태(placeholder 유지)에서 새 단언이 red인가")으로 새 계약이 실제로 무는지 증명하는 것이 정본 절차. **QueryClient 부재 크래시**: 셸 교체로 새 조회 훅(`useGetTrips` 등)을 물게 되면 `render(<XxxRoute/>)`가 QueryClient 없이 크래시할 수 있다 — `my`·`home`·`records` 전부 **기존 전역 목**(TRIP-371의 `useGetTrips` 빈 목록 스텁)이 이미 있어 신규 목 없이 빈 얼굴로 안전 렌더됐다(재사용 우선, 새 훅이면 새 목 필요).
- **컨테이너/뷰가 한 파일에 있으면 프리뷰가 컨테이너의 import 사슬을 전이 로드한다** → `preview.tsx`가 화면의 순수 뷰만 태우려 해도, 뷰를 컨테이너 파일(`XxxScreen.tsx`)에서 가져오면 그 파일 최상단의 컨테이너 전용 import(`usePreferences` 등 `@/shared/api`로 이어지는 훅)가 모듈 평가 시점에 함께 실행돼 `devPreviewMap.test.tsx` 류의 "프리뷰는 네트워크 계층을 로드하면 안 된다" 목이 로드 시점에 throw한다(TRIP-610 실측 — 개념 [[모듈 로드 크래시 연쇄]] §TRIP-610). 새로 컨테이너+순수뷰 분리 화면을 프리뷰에 심을 때는 뷰를 처음부터 별 파일(`XxxView.tsx`, api import 0)로 두고 프리뷰가 그 파일에서만 import한다.
