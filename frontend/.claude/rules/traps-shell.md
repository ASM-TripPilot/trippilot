---
paths:
  - "src/app/**"
  - "src/shared/ui/**"
---
이 파일은 repo-traps.md에서 경로별로 쪼갠 함정이다 — 해당 경로 만질 때만 로드된다.

## 라우팅 · 셸

- **미인증 딥링크 노출** → `stays/`·`stays/register`·`trips/new/**`는 전부 `(tabs)` 밖의 파일시스템 라우트라 `SplashGate`의 `Stack.Protected` guard 어디에도 안 걸린다 — 미인증에서도 딥링크로 열린다(API가 401을 주므로 데이터 노출은 없다). 새 라우트를 이 그룹들 밖에 추가할 때 guard 안에 넣을지는 아무도 안 물어본다 — 고치려면 라우트 위치 자체를 바꾸는 결정이 선행돼야 한다.
- **탭바는 네비게이션도 SafeArea도 모르는 순수 뷰 계약이다** → 그래서 홈 인디케이터 bottom inset을 합산하지 않는다. 고치려면 이 계약을 바꾸는 결정이 선행돼야 한다.
- **탭 라우트를 렌더하는 테스트는 조회 훅의 전역 목에 기댄다** → 5탭은 전부 실화면이라, `render(<XxxRoute/>)`가 QueryClient 없이도 도는 것은 기존 전역 목(`useGetTrips` 빈 목록 스텁)이 있어서다. 탭 라우트가 새 조회 훅을 물게 되면 그 훅의 목을 새로 걸어야 크래시하지 않는다(재사용 우선). `shell-tab-placeholder-*` 참조는 `tabsMyRoute.test.tsx`·`tabsRecordsRoute.test.tsx`의 사후 부재 확인용뿐이다.
- **컨테이너/뷰가 한 파일에 있으면 프리뷰가 컨테이너의 import 사슬을 전이 로드한다** → `preview.tsx`가 화면의 순수 뷰만 태우려 해도, 뷰를 컨테이너 파일(`XxxScreen.tsx`)에서 가져오면 그 파일 최상단의 컨테이너 전용 import(`usePreferences` 등 `@/shared/api`로 이어지는 훅)가 모듈 평가 시점에 함께 실행돼 프리뷰 스모크(`devPreviewReleaseGate.test.tsx`)의 "프리뷰는 네트워크 계층을 로드하면 안 된다" 지뢰 목이 로드 시점에 throw한다(개념 [[모듈 로드 크래시 연쇄]]). 새로 컨테이너+순수뷰 분리 화면을 프리뷰에 심을 때는 뷰를 처음부터 별 파일(`XxxView.tsx`, api import 0)로 두고 프리뷰가 그 파일에서만 import한다.
- **프리뷰가 이미 열린 상태에서 다른 `state` 딥링크를 `openurl`해도 화면이 안 바뀐다** → 같은 라우트라 라우터가 새 URL을 무시한다(에러 없음 — 이전 키 화면이 그대로 떠 있어 "이 키가 렌더됐다"로 오인한다, TRIP-1147 04b 실측). 키마다 `terminate`+`launch` 재기동 뒤 진입한다(`scripts/dev-preview-capture.sh`는 이미 그렇게 한다).
