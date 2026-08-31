# 리포 함정 (지금 작업하려면)

리포를 읽어도·테스트를 돌려도·그래프를 봐도 **알 수 없는 것만** 적는다. **밟기 전에 읽는다.**
이 파일은 `paths` 없는 무조건 규칙이라 메인·서브에이전트에 시작 시 로드된다(그래서 짧게 유지한다).

**경로별 함정은 `traps-*.md`로 쪼갰다**(path-scoped 자동 로드 — 해당 경로 파일을 만질 때만 첨부된다). 여기엔 **폴더에 안 매인 전역 함정만** 남긴다. 경로별: `traps-onboarding-auth.md`·`traps-home.md`·`traps-stay.md`·`traps-itinerary.md`·`traps-execution.md`·`traps-trip.md`·`traps-explore.md`·`traps-shell.md`.

**여기 적지 않는 것**: 미해결 부채·후속 티켓·"다음 사이클 후보"는 옵시디언 **문제로그** 소관(닫히면 사라질 것). 파일 목록·export·스텁은 `structure.md`(+`--check`) 소관. 테스트가 red로 잡는 것도 아니다. 남는 것은 **부정 사실·지금 어디까지·기계 강제 없는 계약**뿐.

## 전역 불변식 (itinerary·execution 관통)

- **INV-3: 소요시간 비표시, 거리만.** DTO·화면 어디에도 `duration` 필드를 두지 않는다.

## 글리프 · 심판 사정거리

- **raw hex 스캔은 `*Glyphs.tsx` 제외** (SVG `stroke`/`fill`은 className을 못 받는 리포 전체 관례). AC-7 스텁 잠금의 `cardFingerprint`는 testID·className·텍스트만 굳히고 **`fill` 변화는 안 본다** — 저장 하트를 `StayGlyphs.tsx`로 옮겨 `useState` 토글을 걸면 5개 심판이 전부 green인 채로 "저장됐다는 거짓말"이 통과한다.
- **`LocationOffGlyph`가 두 벌이다** → `shared/location/LocationGlyphs.tsx`와 `features/itinerary/ui/ItineraryGlyphs.tsx`에 같은 이름·같은 그림이 각각 있고 색만 다르다(공용=`mutedSoft` 고정, h35=`primary`). grep하면 두 벌이 나오고 정본을 코드만으로는 알 수 없다.

## 지도 (`shared/map`)

- **`react-native-webview`는 네이티브 모듈** → 코드만 머지하고 재빌드를 안 하면 기존 dev build엔 웹뷰가 없다(`pnpm expo prebuild` → `pnpm expo run:ios`). 카카오 콘솔은 지도 JS SDK가 보는 명부가 `[앱 키]→JavaScript 키→JavaScript SDK 도메인`이고, `[플랫폼]→웹 도메인`은 공유용 — 두 자리를 헷갈리기 쉽다.
- **지도 제스처 차단(`viewOnly`)은 실기로만 확인된다 — 자동 심판이 없다** → `draggable`·`disableDoubleClickZoom`·`setZoomable`을 지우거나 오타로 바꿔도 jest 전수가 green이다(가짜 SDK가 `Proxy`라 무슨 이름이든 받아 기록만 함). 실명 여부·실제 차단은 시뮬레이터에서 손으로 확인.
- **`KakaoMapView`(WebView) 위 `absolute` 오버레이는 터치를 먹는다** → WebView가 자기 위에 얹힌 형제/자식 Pressable의 터치를 흡수해 안 눌린다(TRIP-397 결함#2 실측 — `LiveMapScreen`의 계획\|실제 토글이 이렇게 막혔다). 인터랙티브 요소는 지도의 **형제 노드**로 배치해야 한다. `liveMapStructure.test.ts`가 `LiveMapScreen.tsx` 한 파일만 잠근다 — 다른 화면이 `KakaoMapView` 위에 새 오버레이를 얹으면 이 가드 사정거리 밖이라 jest가 못 잡는다.

## 바텀시트 (`@gorhom/bottom-sheet`)

- **딤 전면 커버·시트 실제 열림은 자동 심판이 없다** → `__mocks__/@gorhom/bottom-sheet.tsx`는 `BottomSheet`를 어떤 prop을 줘도 children을 무조건 렌더하는 통과 컴포넌트로 대체한다. 딤의 `bg-scrim/40` 색 토큰은 렌더 트리에 className으로 남아 잡히지만, 실제로 화면을 덮는 `absolute inset-0`(위치)와 시트의 실제 열림/닫힘(`snapPoints`·gorhom 런타임)은 jest가 원리적으로 못 본다 — 지도 제스처 차단(viewOnly)과 같은 함정 계열. 이 목을 공유하는 화면(로그인 시트 3종·`SlotTimeSheet`·`TripBaseFixSheet`·`PinDetailSheet`·`MustVisitTimeScreen`·`TripDateSheet`) 전부 해당, 실기 스모크가 유일한 그물.
- **`TripBaseFixSheet`는 인터랙티브 지도를 바텀시트 안에 넣은 유일 사례라 제스처 prop 회귀가 조용히 재발할 수 있다** (TRIP-455) → 같은 통과형 목이라 `enableContentPanningGesture={false}`를 주든 안 주든 렌더 결과가 동일하다(jest가 이 prop의 유무를 원리적으로 구분 못 함). 이 prop이 "이 위치로 확인" 무반응의 **진짜 원인 수정**(콘텐츠 pan 제스처가 WebView 롱프레스를 삼키는 것을 막음)인데, 지우면 51/51 그대로 green이라 아무 심판도 못 잡는다(code-critic 경고-1 실측). 이 파일을 다시 만질 때 이 줄을 실수로 지우지 않았는지는 6-b 실기(`trip-new-step2-fixsheet-map` 프리뷰, 롱프레스→핀)로만 확인된다. **두 번째 사례(TRIP-599, 2026-08-28)**: h07 `MustVisitTimeScreen`이 인터랙티브 스크롤러(`shared/ui/WheelPicker`)를 시트에 넣었다 — 같은 `enableContentPanningGesture={false}` 회귀는 jest 사각, 6-b 실기(`itinerary-mustvisit-time-default` 프리뷰, 휠 드래그→시트 딸림 여부)로만 확인된다.

## 오버레이 다이얼로그 (조건부 렌더 `absolute`, 라이브러리 없음)

- **딤·중앙정렬·실제 열림은 jest 원리적 사각** — `@gorhom/bottom-sheet` 목 계열과 증상은 같으나 원인이 다르다(목이 아니라 조건부 렌더 자체의 한계). `RevokeConfirmDialog`·`DeleteAccountDialog`·`LocationConsentScreen`·`BaseToggleDialog`(전부 `features/settings/ui`, 리포 Modal 선례 0)가 이 패턴을 공유한다 — 로컬 `useState`로 열고 조건부로 `absolute inset-0` 오버레이를 렌더할 뿐이라, 자동 심판이 굳히는 것은 **testID 트리 존재 + 확정 전 콜백/mutate 0회**까지다. 실제 화면이 덮이는지·중앙 정렬인지·터치가 차단되는지는 6-b 실기 전용(TRIP-605 실측, `04b_smoke_1_SKIP`). 새 확인/삭제류 다이얼로그를 이 패턴으로 또 만들면 같은 사각이 반복된다.

## 드래그 리스트 (`react-native-draggable-flatlist`)

- **목이 두 사각을 함께 가진다** → (1) `__mocks__/react-native-draggable-flatlist.tsx`의 헤더 주석이 "`jest.mock('react-native-draggable-flatlist')`로 명시 호출해야 활성화된다"고 적었으나 실측은 반대다 — node_modules 수동 목이라 명시 호출 없이 **자동 적용**되고, `ManualEditScreen.test.tsx`(6/6)는 `jest.mock` 호출 0회로도 green이다(TRIP-577 `03b_code-critic_findings` 참고-1). 이 주석을 믿고 "어느 테스트가 이 목으로 보호되는지"를 판단하면 오판한다. (2) 목의 `drag`는 no-op이라 손잡이를 실제로 롱프레스해 끌리는지·순서가 실제로 바뀌는지는 jest가 원리적으로 못 본다(지도 `viewOnly`·바텀시트 실제 열림과 동형 — 통과형 목 계열). `onDragEnd` 직접 발화(테스트가 `list.props.onDragEnd({data})` 호출)로 배선은 잠기지만, 실제 제스처는 6-b 실기(`planb-manual-normal`/`-fallback` 프리뷰, 롱프레스→끌기)로만 확인된다.

## features 경계

- **`features` 간 import 금지에 기계 강제가 없는 feature가 있다** → `eslint.config.js`의 `FEATURES` 배열이 `['onboarding','home']`뿐이라 `itinerary`·`trip`·`explore`·`settings`·`notification`·`record`·`reflection`는 여전히 zone 검사 밖이다. `settings`는 `settingsBoundary.test.ts`(TRIP-605), `notification`은 `notificationStructure.test.ts`(TRIP-576), `record`는 `recordsStructure.test.ts`(TRIP-565, G2 — 특히 `execution`의 동명 `useVisitCheck` import를 막는 유일한 그물), `reflection`은 `reflectionStructure.test.ts`(TRIP-571, G2 — record↔reflection 상호 import를 막는 유일한 그물)로 각각 소스 스캔이 유일한 그물이다. 관례(조합은 `pages` 전담)로 지켜질 뿐, eslint `FEATURES` 배열 자체는 어느 쪽도 등재 안 돼 어겨도 lint는 안 걸린다.

## 작업 관례

- **엣지 케이스 화면을 눈으로 보려면** 목을 만들지 말고 `src/app/_dev/preview.tsx`에 상태를 추가한다.
- **컨테이너/뷰가 한 파일에 있으면 프리뷰가 컨테이너의 import 사슬을 전이 로드한다** → `preview.tsx`가 화면의 순수 뷰만 태우려 해도, 뷰를 컨테이너 파일(`XxxScreen.tsx`)에서 가져오면 그 파일 최상단의 컨테이너 전용 import(`usePreferences` 등 `@/shared/api`로 이어지는 훅)가 모듈 평가 시점에 함께 실행돼 `devPreviewMap.test.tsx` 류의 "프리뷰는 네트워크 계층을 로드하면 안 된다" 목이 로드 시점에 throw한다(TRIP-610 실측 — 개념 [[모듈 로드 크래시 연쇄]] §TRIP-610). 새로 컨테이너+순수뷰 분리 화면을 프리뷰에 심을 때는 뷰를 처음부터 별 파일(`XxxView.tsx`, api import 0)로 두고 프리뷰가 그 파일에서만 import한다.
- **화면 비주얼**은 `figma-screen-impl` 스킬 절차를 따른다(밴드 맵은 `spec-perception/reference/figma-structure.md`).

## 유지

scribe가 [기록]에서 새 함정을 여기(전역이면 이 파일, 경로별이면 해당 `traps-*.md`) 추가한다(structure.md 아님). **전역 항목이 12건을 넘으면** 위 「여기 적지 않는 것」 배제가 새는 것이므로 초과분이 무엇인지 개발로그에 적는다. *유지 판정: 경로별 쪼개기는 실측 완료(path-scoped `traps-*.md`가 서브에이전트에 매칭 경로로 자동 첨부됨)로 이 파일이 실제로 함정 회피에 인용된 건수 0이면 structure.md 절로 되돌린다.*
