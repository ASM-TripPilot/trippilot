# 리포 함정 (지금 작업하려면)

리포를 읽어도·테스트를 돌려도·그래프를 봐도 **알 수 없는 것만** 적는다. **밟기 전에 읽는다.**
이 파일은 `paths` 없는 무조건 규칙이라 메인·서브에이전트에 시작 시 로드된다(그래서 짧게 유지한다).

**경로별 함정은 `traps-*.md`로 쪼갰다**(path-scoped 자동 로드 — 해당 경로 파일을 만질 때만 첨부된다). 여기엔 **폴더에 안 매인 전역 함정만** 남긴다. 경로별: `traps-onboarding-auth.md`·`traps-home.md`·`traps-stay.md`·`traps-itinerary.md`·`traps-execution.md`·`traps-trip.md`·`traps-explore.md`·`traps-shell.md`·`traps-record.md`·`traps-reflection.md`·`traps-map.md`·`traps-glyphs.md`·`traps-draglist.md`.

**여기 적지 않는 것**: 미해결 부채·후속 티켓·"다음 사이클 후보"는 옵시디언 **문제로그** 소관(닫히면 사라질 것). 파일 목록·export·스텁은 `structure.md`(+`--check`) 소관. 테스트가 red로 잡는 것도 아니다. 남는 것은 **부정 사실·지금 어디까지·기계 강제 없는 계약**뿐.

## 전역 불변식 (itinerary·execution 관통)

- **INV-3: 소요시간 비표시, 거리만.** DTO·화면 어디에도 `duration` 필드를 두지 않는다.

## 글리프 · 심판 사정거리

- **raw hex 스캔은 `*Glyphs.tsx` 제외** (SVG `stroke`/`fill`은 className을 못 받는 리포 전체 관례). AC-7 스텁 잠금의 `cardFingerprint`는 testID·className·텍스트만 굳히고 **`fill` 변화는 안 본다** — 저장 하트를 `StayGlyphs.tsx`로 옮겨 `useState` 토글을 걸면 5개 심판이 전부 green인 채로 "저장됐다는 거짓말"이 통과한다.

## 지도 (`shared/map`)

- **지도는 네이버 네이티브 SDK다(`@mj-studio/react-native-naver-map`, TRIP-861 로 카카오 WebView 에서 전환)** → 네이티브 모듈이라 코드만 머지하고 재빌드를 안 하면 기존 dev build 엔 지도가 없다(`pnpm expo prebuild` → `pnpm expo run:ios`, `LANG=en_US.UTF-8` 필요). Client ID 는 `EXPO_PUBLIC_NAVER_MAP_CLIENT_ID`(NCP Maps 앱 등록, **로그인용 `EXPO_PUBLIC_NAVER_CLIENT_ID` 와 다른 키**) — iOS Bundle ID·Android Package Name 이 `com.trippilot.travel` 과 글자 단위로 일치해야 타일이 뜬다. **Client ID 부재·번들 불일치는 조용히 실패한다**(회색 빈 지도, 콜백 없음) — 그래서 `MapView` 는 env 키 부재를 `map-failure` 표면으로 드러낸다(INV-4). Android 는 config plugin 이 maven 저장소를 안 넣으므로 `app.config.ts` 의 `expo-build-properties`(`extraMavenRepos`)가 있어야 SDK 를 받는다.
- **지도 위 `absolute` 오버레이 터치 흡수는 네이버 네이티브에선 구조적으로 없을 것으로 보이나 6-b 미검증** → 네이티브 뷰는 RN 터치 파이프라인 안에 있어 카카오 WebView 처럼 형제/자식 Pressable 터치를 흡수하지 않을 것으로 기대되나(그래서 `CenterPinPicker` 는 핀을 `pointerEvents="none"` 자식 오버레이로 얹는다), **사람 재빌드 6-b 전까지는 실측 확인 불가**다. **`liveMapStructure.test.ts`(옛 `LiveMapScreen.tsx` 전용 가드)는 TRIP-746으로 그 화면째 삭제됐다** — "삭제 후보"였던 게 아니라 대상 소멸로 폐지. i01의 지도는 이제 `MapSheetShell`(셸이 `<MapView>`를 소유, 오버레이는 셸 안 정적 배치)이라 이 가드가 지키던 축은 사정거리 밖이고, 새 화면이 지도 위에 별도 `absolute` 오버레이를 얹으면 여전히 무방비다.

## 바텀시트 (`@gorhom/bottom-sheet`) · 오버레이 다이얼로그

- **딤 전면 커버·시트 실제 열림은 자동 심판이 없다** → `__mocks__/@gorhom/bottom-sheet.tsx`는 `BottomSheet`를 어떤 prop을 줘도 children을 무조건 렌더하는 통과 컴포넌트로 대체한다. 딤의 `bg-scrim/40` 색 토큰은 렌더 트리에 className으로 남아 잡히지만, 실제로 화면을 덮는 `absolute inset-0`(위치)와 시트의 실제 열림/닫힘(`snapPoints`·gorhom 런타임)은 jest가 원리적으로 못 본다 — 지도 제스처 차단(viewOnly)과 같은 함정 계열. 이 목을 공유하는 화면 전부 해당(`grep -rl "@gorhom/bottom-sheet" src`로 확인 — 로그인 시트·`widgets/time-sheet`·`MapSheetShell`·`MustVisitTimeScreen` 등 여러 층에 퍼져 있다), 실기 스모크가 유일한 그물(`TripBaseFixSheet`·`TripDateSheet`는 TRIP-675로 파일째 삭제됨 — 아래 항목 참고). **라이브러리 없는 오버레이 다이얼로그(조건부 렌더 `absolute`)도 딤·중앙정렬·실제 열림이 jest 원리적 사각이다** — 증상은 같으나 원인이 다르다(목이 아니라 조건부 렌더 자체의 한계). `RevokeConfirmDialog`·`DeleteAccountDialog`·`LocationConsentScreen`·`BaseToggleDialog`(전부 `features/settings/ui`, 리포 Modal 선례 0)가 이 패턴을 공유한다 — 로컬 `useState`로 열고 조건부로 `absolute inset-0` 오버레이를 렌더할 뿐이라, 자동 심판이 굳히는 것은 **testID 트리 존재 + 확정 전 콜백/mutate 0회**까지다. 실제 화면이 덮이는지·중앙 정렬인지·터치가 차단되는지는 6-b 실기 전용(TRIP-605 실측, `04b_smoke_1_SKIP`). 새 확인/삭제류 다이얼로그를 이 패턴으로 또 만들면 같은 사각이 반복된다. **지금 어디까지(TRIP-984)**: `__mocks__/@gorhom/bottom-sheet.tsx`는 이제 `BottomSheetTextInput`을 별 타입 `forwardRef`로 export한다(옛날엔 없었다) — 입력칸을 이걸로 바꾸면 `UNSAFE_getByType`으로 "플레인 `TextInput`으로 되돌림" 회귀를 잡을 수 있다(재수출이 아니라 별 타입이라 가능하다). 단 이건 "그 부품을 썼는가"만 잠그고, 키보드가 시트를 실제로 밀어 올리는지·본문 탭으로 실제로 내려가는지는 여전히 이 항목의 사각이다. `keyboardBehavior="interactive"`는 `@gorhom/bottom-sheet` 기본값이라 이 prop을 적어도 렌더 결과는 안 바뀐다(03b 실측).
- **인터랙티브 자식(지도·휠 스크롤러)을 바텀시트 안에 넣으면 제스처 prop 회귀가 조용히 재발할 수 있다** → 같은 통과형 목이라 `enableContentPanningGesture={false}`를 주든 안 주든 렌더 결과가 동일하다(jest가 이 prop의 유무를 원리적으로 구분 못 함). 첫 사례는 `TripBaseFixSheet`(TRIP-455, 인터랙티브 지도)였으나 g02 재작성(S8)으로 배선을 잃고 TRIP-675로 파일째 삭제됨(옛 사례는 역사적 기록으로만 남는다). **현재 살아있는 사례(TRIP-599, 2026-08-28)**: h07 `MustVisitTimeScreen`이 인터랙티브 스크롤러(`shared/ui/WheelPicker`)를 시트에 넣었다 — 같은 `enableContentPanningGesture={false}` 회귀는 jest 사각, 6-b 실기(`itinerary-mustvisit-time-default` 프리뷰, 휠 드래그→시트 딸림 여부)로만 확인된다. 이 prop이 "이 위치로 확인" 무반응류의 **진짜 원인 수정**(콘텐츠 pan 제스처가 자식의 제스처를 삼키는 것을 막음)인데 지워도 jest 전수가 green이라 아무 심판도 못 잡는다(code-critic 경고-1 실측 선례).

## 테두리 (`border-hairline`)

- **`border-hairline`은 색(#EDEDED)과 NativeWind 프리셋 두께(hairlineWidth)를 동시에 의미한다** → 한쪽 변만 의도해 `border-t border-hairline`·`border-b border-hairline`을 써도 프리셋이 네 변 두께를 함께 건드리는 리포 전역 관례라, 카드처럼 `overflow-hidden`/radius 없는 조상에 얹으면 둥근 모서리 밖으로 반대 변·옆 변의 선이 각지게 삐져나올 수 있다(TRIP-774 04b n=1 FAIL 실측 — 카드 하단 두 모서리). 한 변짜리 구분선이 필요하면 `border`가 아니라 `h-px bg-hairline`/`w-px bg-hairline` 막대 View로 그린다. `grep -rn "border-hairline" src`(125파일)가 사정거리 — 전역 수정(프리셋 무력화·색 토큰 개명)은 모든 화면 픽셀에 영향을 주므로 스윕은 별도 티켓.

## features 경계

- **층 방향 린트는 전 feature를 강제하지만 전방(app→features)은 아직 안 막는다** → `eslint.config.js`의 층 zone이 `src/features` 디렉토리를 읽어 13개 feature 전부에 형제 feature·상위 층(widgets·pages·app) import를 error로 잡는다(TRIP-804 — 구 `FEATURES=['onboarding','home']` 2개 시절의 "소스 스캔이 유일한 그물" 서술은 낡았다. `settingsBoundary`·`notificationStructure`·`recordsStructure` G2·`reflectionStructure` G2 등 feature별 소스 스캔은 **이중 그물**로 공존 — 사정거리가 다르다: 린트는 해석되는 import 그래프, 스캔은 문자열). 남은 사각은 **app·app-shell이 features를 직접 import하는 전방 방향**(실측 110건이라 미도입, 후속 티켓) — `src/app/**`에서 features를 무는 것은 여전히 lint가 침묵한다. 테스트 파일 여러 곳의 "FEATURES 배열이 onboarding·home뿐" 주석도 낡은 채로 남아 있다(단언 무영향).

## 작업 관례

- **엣지 케이스 화면을 눈으로 보려면** 목을 만들지 말고 `src/app/_dev/preview.tsx`에 상태를 추가한다(뷰를 컨테이너와 같은 파일에 두면 프리뷰가 네트워크 계층을 전이 로드한다 — `traps-shell.md`).
- **화면 비주얼**은 `figma-screen-impl` 스킬 절차를 따른다(밴드 맵은 `spec-perception/reference/figma-structure.md`).
- **여러 워크트리를 동시에 열어 두면 Metro(8081)가 다른 워크트리 코드를 서빙 중일 수 있다** → 포트는 워크트리별로 안 갈린다. 캡처·6-b 전에 그 포트를 물고 있는 프로세스의 작업 디렉토리를 확인하고, 이번 브랜치가 아니면 끄고 이 워크트리에서 새로 띄운다(안 그러면 다른 브랜치 화면이 이 사이클 결과로 찍힌다 — TRIP-751 04b 직전 실측). **같은 워크트리에서도 `pkill -f "expo start"`가 옛 Metro를 못 죽일 수 있다** → 새 Metro가 "Port 8081 is running … Skipping dev server"로 조용히 종료하고, CI 모드(watch 꺼짐)로 뜬 옛 Metro가 편집 전 번들을 계속 서빙해 캡처가 무효가 된다(에러 없이 성공한 것처럼 보인다 — TRIP-918 04b 실측, 2회 무효 캡처). `lsof -ti :8081 -sTCP:LISTEN | xargs kill`로 포트를 직접 비우고 새로 띄운다.
- **커밋 안 된 변경을 되돌릴 때 `git checkout`·`git stash`·`git reset --hard` 금지 — `cp` 사본 복원 또는 Edit 역치환을 쓴다** (모든 자리 공통: 오케·test-designer·implementer·code-critic·qa-verifier). `git checkout <path>`는 지정 경로의 **커밋 안 된 다른 편집까지 함께 날린다** — 뮤테이션 원복·구조 대조·부분 복원 어디서든 진행 중 작업이 소실된다. 뮤테이션 심기 전에 그 파일을 `cp`로 떠 두고 그 사본으로 되돌린다(실측 7건·마지막 qa-verifier, 상세는 하네스 변경이력).

## 유지

scribe가 [기록]에서 새 함정을 여기(전역이면 이 파일, 경로별이면 해당 `traps-*.md`) 추가한다(structure.md 아님). **전역 항목이 12건을 넘으면** 위 「여기 적지 않는 것」 배제가 새는 것이므로 초과분이 무엇인지 개발로그에 적는다. *유지 판정: 경로별 쪼개기는 실측 완료(path-scoped `traps-*.md`가 서브에이전트에 매칭 경로로 자동 첨부됨)로 이 파일이 실제로 함정 회피에 인용된 건수 0이면 structure.md 절로 되돌린다.*
