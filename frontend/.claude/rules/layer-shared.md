---
paths:
  - "src/shared/**"
---
# `src/shared/` — 도메인을 모르는 공용 층

- **shared는 features·도메인을 모른다** — 두 feature가 같은 것을 써야 하는데 features 간 import가 금지돼 있을 때(각 feature 구조 가드·린트) 유일한 공유 자리가 shared 승격이다. shared 직계에 도메인명 디렉토리를 두지 않는다(도메인 컴포넌트는 `widgets`로).
- `shared/ui/**`는 `@/features`·zustand·URL·raw hex 0을 지킨다(층 방향만 ESLint zone이 강제, 나머지는 TRIP-1145에서 스캔 삭제). 순수 로직 파일은 형제 비-ui 폴더에 둔다. `*Glyphs.tsx`의 raw hex는 SVG stroke/fill이 className을 못 받는 리포 관례.

| 파일 | 역할 |
|---|---|
| `src/shared/api/index.ts` | axios 인스턴스·인터셉터·토큰 갱신·손수 작성 서버 호출(orval 필터 밖 경로). `authedClient`가 온보딩·`fetchBootstrap`을 인증 경로로 보낸다. `SERVER_ERROR_CODE_TRANSLATIONS`는 서버 실코드→프론트 계약 코드 번역표(승인 테스트가 이 표를 겨냥하지 않아 미검증). `normalizeSocialError`는 서버 `fields`를 `NormalizedApiError`에 실어 나른다. `patchConsent`는 `PATCH /me/consents/{termsType}` — **termsType은 URL에만, body는 `{action, termsVersion}`**(`ConsentInput`을 재사용하면 body에 termsType 잉여가 실려 계약 위반). |
| `src/shared/api/mutator.ts` | orval 생성 클라이언트가 쓰는 `customInstance` — `authedClient`를 얹고 `paramsSerializer: { indexes: null }`로 배열 쿼리를 브래킷 없이 직렬화(`amenity=A&amenity=B`, Spring `List<String>` 계약), `response.data`만 반환. 오류 정규화는 안 거친다. |
| `src/shared/api/tokenManager.ts` | 동기 in-memory 액세스토큰 홀더(인터셉터가 동기로 읽는다, SecureStore와 공존). `subscribeAccessToken`은 값이 실제로 바뀔 때만 통지 |
| `src/shared/api/isAlreadyRegistered.ts` | 409(이미 등록됨) 판정. `features/save-place/model/savedPlaces.ts`에는 인라인 409 판정이 따로 남아 있어 판정이 두 벌이다 |
| `src/shared/api/isNotFound.ts` | `isNotFound(error)` — 네트워크 오류(응답 없음)는 `false`(모르면 "아니다"로 접는 fail-closed). `retryUnlessNotFound`는 react-query `retry`에 넣는 함수(3회, 404만 즉시 포기) — 같은 쿼리 키의 다른 관찰자가 먼저 요청을 시작하면 그쪽 retry가 이기므로 전역(`app/_layout.tsx`)과 페이지가 같은 함수를 참조한다. |
| `src/shared/api/visitConflict.ts` | `resolveVisitConflict(error)` — 409 `error.code`를 openapi 리터럴(`VISIT_CONFLICT`·`VISIT_ALREADY_RECORDED`)로 분류. `features/edit-itinerary/model/slotSwapError.ts`와 구조만 같다(features 간 import 금지라 재사용 불가). 딥 임포트 `@/shared/api/visitConflict`(배럴 미경유) |
| `src/shared/api/visitConflict.test.ts` | 409 code를 발명하지 않고 openapi 리터럴을 직접 넣어 매핑을 계약값에 못박는다 |
| `src/shared/api/generationInProgress.ts` | `resolveGenerationInProgress(error)` — 생성 POST 409 `GENERATION_IN_PROGRESS`+`activeTripId` 판정. 생성 mutation 타입은 `void\|ErrorResponse`라고 적지만 **런타임은 항상 AxiosError**라 `isAxiosError` 통과 뒤 `response.data.error`만 읽는다. `cancelActiveGeneration`은 404·409·500·네트워크 실패를 전부 `true`로 접는다(사용자에게 취소 실패 안내 없음, 심판 없음). |
| `src/shared/storage/index.ts` | expo-secure-store 토큰 저장소. `hasStoredToken`은 **accessToken 존재만** 판정한다(refreshToken만 없는 부분 저장도 true) — "두 토큰 다"로 좁히면 콜드스타트 폴백이 HOME→LOGIN으로 뒤집히는데, 이 함수를 실제로 도는 테스트가 없어 회귀해도 green이다. |
| `src/shared/storage/idSet.ts` | 도메인 무관 문자열 id 집합 저장(`readIdSet`·`writeIdSet`, JSON 파싱 실패는 throw). **배럴에서 재수출하지 않는다** — 여러 테스트가 `jest.mock('@/shared/storage', …)`로 배럴을 통째로 교체하므로 딥 경로 `@/shared/storage/idSet`으로만 import. 웹 폴백 없음 |
| `src/shared/storage/stringValue.ts` | **(TRIP-1122 신규)** 키 하나에 문자열 하나(`readStringValue`→`string\|null`·`writeStringValue`) — JSON으로 감싸지 않고 그대로 저장하며 jest-expo 자동 목의 `undefined`도 `null`로 접는다. 실패(reject)는 호출부 몫(삼킬지 정한다). `idSet`과 같은 이유로 **배럴 재수출 금지 — 딥 경로 `@/shared/storage/stringValue`**. 웹 폴백 없음. 첫 소비처 `MyTripsListPage`(키 `itinerary.myTrips.sort`). |
| `src/shared/version/compareVersion.ts` | 버전 비교(강제 업데이트 판정) |
| `src/shared/date/formatKoreanDate.ts` | `formatKoreanDate(isoDate): "M월 D일 요일"`. `features/execution/**`의 `new Date`류 금지(BR-U4-34)를 피해 날짜 파싱을 execution 밖에 둔 자리. 에포크 일수(UTC 정수) 산술만 써 TZ-safe. 배럴 없이 직접 import |
| `src/shared/location/LocationPreprompt.tsx` | 위치 권한 프리프롬프트 — 전체화면(레이더 히어로) `default` / 카드형 `permission-denied` 2상태. `expo-location`을 import하지 않는다(구조적으로 OS 다이얼로그를 못 부름) |
| `src/shared/location/LocationGlyphs.tsx` | 위치 화면 인라인 SVG 글리프. 색은 `locationColors.ts` 상수 경유(`shared/location/**`은 raw-hex 가드 대상) |
| `src/shared/location/lib/locationColors.ts` | 위치 글리프 색 상수(raw hex 분리) — 토큰 색과 **수동 동기화** 필요 |
| `src/shared/location/geofence.ts` | 지오펜스 리전 조립·진입→`ArriveRequest{source:AUTO_GEOFENCE}` 순수 매핑·등록/해제 계약. **실 네이티브 발화는 미배선** — `registerGeofences`가 `armed:false` 정직한 degrade 스텁을 반환(expo-task-manager·background 권한·네이티브 리빌드 선행) |
| `src/shared/location/readDevicePosition.ts` | 실측 좌표 리더 — 권한 조회(request 아님) → `getLastKnownPositionAsync({maxAge:300_000})` → 없으면 `getCurrentPositionAsync({mayShowUserSettingsDialog:false})`, 전체 5초 `Promise.race`, 모든 실패는 `null`(reject 경로 없음). iOS는 대화상자 억제 옵션을 무시한다 |
| `src/shared/push/permissions.ts` | `getPushPermission()` — 조회 전용. 로컬 `UNDETERMINED`는 서버 `osPermission`의 `NOT_DETERMINED`와 **어휘가 다르다** — 서버로 보낼 때는 반드시 `register.ts`의 `toServerOsPermission`을 거친다(TS는 `GRANTED`·`DENIED`가 우연히 겹치는 것을 못 잡는다) |
| `src/shared/push/register.ts` | 푸시 토큰 등록·해제(`registerPushToken`·`unregisterDeviceToken`·`toServerOsPermission`·`isDeviceNotRegistered`) + 모듈 보관 `storedToken`(POST 성공 뒤에만 채움)과 `promptAndRegisterPush`·`registerPushIfGranted`·`unregisterStoredPushToken`(3초 상한, 실패 삼킴). 소비처는 전부 `void` fire-and-forget |
| `src/shared/push/request.ts` | `requestPushPermission()` — (안드로이드) 채널 3종 생성이 **끝난 뒤** 권한이 `UNDETERMINED`일 때만 OS 요청 1회. 채널 ID는 서버 `ExpoPushAdapter`의 `interruptionLevel` 문자열과 글자까지 맞춘다(`passive`/`active`/`time-sensitive`) |
| `src/shared/push/index.ts` | 푸시 배럴. **권한 루틴(`promptAndRegisterPush` 등)은 반드시 이 배럴로 import한다** — 페이지 테스트의 목이 배럴 경로에 걸려 있어 딥 import는 목을 우회한다. **단 `PushPreprompt`는 배럴에 없고 딥 경로로 가져온다**(TRIP-1108 — 테스트가 배럴을 통째로 목으로 바꿔 카드를 배럴에서 가져오면 `undefined`) |
| `src/shared/push/PushPreprompt.tsx` | 온보딩 푸시 사전 안내 카드(TRIP-1108) — props는 `onProceed`·`onDefer` 둘뿐, 권한 루틴·`expo-notifications`를 import하지 않는다(구조적으로 OS 창을 못 부름). 버튼 라벨은 `계속`·`나중에 하기` — 렌더 텍스트에 "허용"을 쓰지 않는다(심사 문구 규칙). 머리 바·하단 바·버튼 className은 `LocationPreprompt` default와 글자까지 같다(두 화면이 연달아 나와 튀지 않게, 테스트가 `===` 비교) |
| `src/shared/push/PushGlyphs.tsx` | `PushBellHero` — 위치 레이더와 같은 틀(동심원 3개)에 벨. 동심원 선 색·투명도는 위치 값을 그대로 쓴 **추정값**(Figma 에셋 404) |
| `src/shared/push/lib/pushColors.ts` | 푸시 글리프 색 상수(raw hex 분리) — 토큰 색과 **수동 동기화** 필요 |
| `src/shared/date/formatRelativeTime.ts` | `formatRelativeTime(iso, now)` — 경과 시각("방금·N분 전·어제·N일 전"). INV-3 소요시간과 무관 |
| `src/shared/date/monthGrid.ts` | 월 그리드 순수 산술(`daysInMonth`·`firstWeekdayOfMonth`·`shiftMonth`·`isDateInRange`·`buildMonthGrid` — 7의 배수, 4~6주 가변). stay·trip·record가 공유하는 유일한 정의(재구현 금지). 에포크 일수 산술로 TZ-safe, `firstWeekdayOfMonth`는 음수 나머지를 흡수한다 |
| `src/shared/date/monthGrid.test.ts` | 윤년·연 경계·양끝 포함·월/일요일 시작 패딩 표 전수 |
| `src/shared/photo/index.ts` | `pickPhotoAsset()`·`resolvePhotoUri()` — TRIP-1070부터 실장(`expo-image-picker`/`expo-media-library` 두 네이티브 모듈의 **유일한 입구**, `recordPhotoBinaryGuard.test.ts`가 소스 스캔 census로 잠금 — 다른 파일이 이 모듈을 직접 import하면 red). `pickPhotoAsset`은 권한→앨범→`PhotoPickResult`(판별 유니온 `kind`: picked·canceled·denied·no-asset-id·failed, 전체 try/catch)까지 한 함수로 접는다. picked는 촬영시각 ISO 문자열 + 좌표는 있을 때만 키 생성 + `getInstallId()` 결과를 함께 담는다. `resolvePhotoUri`는 권한 재요청 없이 `getAssetInfoAsync` → `info?.localUri ?? null`로 접는다(jest-expo 자동 목이 미해결 호출에 `undefined`를 주는 형제 테스트 대비 방어) |
| `src/shared/storage/installId.ts` | `getInstallId()` — SecureStore에 있으면 그 값, 없으면 `randomUUID()`로 만들어 같은 키에 저장. 동시 최초 호출에 id가 여러 개 생기지 않도록 **완성값이 아니라 진행 중 Promise 하나**를 메모이즈한다(`pending ??= (async () => …)()`), 실패하면 `pending = null`로 되돌려 다음 호출이 재시도하게 한다(단 이 재시도 자체를 심판하는 테스트는 없다 — 03b 참고-2). 배럴 재수출 없이 딥 경로로만 import |
| `src/shared/ui/HeartGlyphs.tsx` | 하트 채움/외곽 인라인 SVG — place 카드와 stay 검색 카드가 공유. `features/stay/ui/StayGlyphs.tsx`에 22-viewBox 하트 사본이 따로 남아 있다 |
| `src/shared/ui/HeartButton.tsx` | 32 흰 원 담기 버튼(신규, TRIP-1049) — `saved`·`pending`·**`onPress`**(옛 `onToggle` 표기는 낡았다)·testID 3종(root/filled/outline), `HeartGlyphs`를 감싼다. 위치(`absolute right-sm top-sm` 등)는 소비처 className, 버튼 자체는 32 원·18 하트·`disabled={pending}`·`accessibilityLabel="담기"`(담긴 상태에서도 "담기"로 읽힘, 03b 참고-2)만 고정. **`entities/stay/ui/StaySearchCard.tsx`의 로컬 `SaveButton`·`entities/place/ui/PlaceGridCard.tsx` 인라인 하트와 API가 완전히 같은 3번째 사본**이다 — `entities/place`가 `entities/stay`를 형제 import 못 해 여기 신설 외엔 길이 없었다(드라이브바이 금지로 기존 둘은 안 옮김, 새 티켓 후보). | **튐(TRIP-1125)**: 이 하트를 **누른 뒤** 안 담김→담김으로 바뀌는 순간만 글리프가 1회 튄다(누름 1회=튐 자격 1개, 첫 `saved` 변화가 소비). 저장 목록 늦은 도착·처음부터 담김·동작 줄이기는 안 튄다. 튐 크기·박자는 발명값(6-b). 게스트 누름→로그인→담아 둔 장소 도착 시 튈 수 있음은 실기 미확인(03b R3).
| `src/shared/ui/Skeleton.tsx` | 로딩 자리 회색 상자(TRIP-1125) — 투명도 1↔0.45, 800ms `Animated.loop`. `testID`·`className`·`style`을 **한 노드**에 얹는다(자식 복제 금지 — 소비처 테스트가 testID 개수를 센다). 동작 줄이기면 불투명 정지. 로딩 자리 15파일 44곳이 쓴다 — **실패·빈 얼굴에는 얹지 않는다**(INV-4 — 기계 강제 없음). `ProfileCard` 이름 자리 막대는 일부러 안 바꿨다(null이 '없음'도 뜻해 영원한 '불러오는 중'이 될 수 있음). |
| `src/shared/motion/reduceMotion.ts` | `startUnlessReduceMotion(animation, onReduce?)` — 기기 '동작 줄이기'를 **부를 때마다 새로 묻고**(캐시 없음) 켜졌으면 `onReduce`, 아니면 `animation.start()`. 반환 함수가 정리(`stop`). 답이 늦게 오는 사이 떠나면 시작 안 함(`active` 깃발). 설정을 켜고 끄는 순간의 실시간 반영은 범위 밖(마운트 때 1회 확인). 확인이 reject되면 아무것도 안 불린다 — 진행 바는 빈 트랙(03b R2, 실기 거의 불가). `GeneratingScreen.useStepPulse`는 아직 자체 확인 방식(두 벌). |
| `src/shared/ui/StateNotice.tsx` | `empty`·`filter-zero`·`error` 공용 안내 블록(props로 완전 파라미터화). **이 파일 전용 ESLint `no-restricted-imports` 블록**(`eslint.config.js`)이 `useState`/`useReducer`·`expo-router`·`@tanstack/react-query`·`axios`를 막는다 — 로컬 상태는 호출부 몫 |
| `src/shared/ui/CollageEmptyState.tsx` | 콜라주 빈 상태(신규, TRIP-1050) — 사진 3장 회색 자리 겹침 + 하트 원 + 제목·본문 + 아이콘 CTA. 틀(pt96·320×170·제목 20·본문 13/21·CTA 52 r12 pl22 pr24·그림자 3벌)은 고정, 문구·`ctaIcon`·testID·`onPressCta`는 props. 파생 testID `{testID}-art`·`-photo-0/1/2`·`-heart`. 소비처 d02 `SavedPlaceListScreen`·e04 `SavedStayListScreen`. **`StateNotice`(원형 배지 72·제목 16·가운데 정렬)와 다른 두 번째 빈 상태 부품** — 저장 목록 empty는 이쪽. d02 `RegionEmptyBlock`·`MustVisitPickScreen`에 옛 230·rotate 콜라주 사본이 남아 있다(TRIP-1042 범위). StateNotice 전용 순수성 린트가 안 걸린다 |
| `src/shared/ui/WheelPicker.tsx` | 값-컬럼 휠 피커(`ScrollView`+`snapToInterval`). 라벨·testID는 소비처가 함수로 주입. **선택은 스크롤이 멈추면 확정**(`onMomentumScrollEnd` → `Math.round(y/WHEEL_CELL_HEIGHT)` clamp → `onSelect` 1회, 보이는 값=저장될 값). 중앙 정렬은 `contentOffset` prop에 의존하며 **prop이 바뀔 때마다 그 위치로 스크롤한다**. ⚠️ iOS에서 관성 없이 손을 떼면 `onMomentumScrollEnd`가 안 올 수 있고, 관성 중 탭 전환 시 늦은 정지 이벤트가 엉뚱한 탭에 확정될 수 있다. 스냅·관성은 jest 원리적 사각 — 실기만 그물 |
| `src/shared/ui/Toggle.tsx` | 켜짐·꺼짐·잠김 공용 스위치. **`accessibilityLabel`은 필수 prop**(빈 문자열은 tsc·jest 둘 다 못 막는다). 루트에 `accessibilityRole="switch"`·`accessibilityState`와 **real `disabled`** — `accessibilityState`는 표시일 뿐이라 `toBeDisabled()` 단언에는 press 후 콜백 0회 단언을 짝지어야 한다. 트랙 색은 `disabled`를 `checked`보다 먼저 본다 |
| `src/shared/ui/Toast.tsx` | 성공 피드백 토스트(`showToast`·`hideToast`·`ToastHost`·`TOAST_VISIBLE_MS`), `useSyncExternalStore` 모듈 싱글턴. **한 테스트 파일 안에서 앞 테스트의 토스트가 다음 테스트로 샌다** — 소비 테스트는 최상위(describe 밖) `afterEach` 리셋 + "저장 전 토스트 없음" 앵커를 짝지어야 한다. 네이티브 모달 위에서는 가려질 수 있다(미실측) |
| `src/shared/ui/ToastGlyphs.tsx` | 토스트 체크 글리프 — `pages/itinerary-list/ui/GenerationDoneBarGlyphs.tsx`의 `DoneCheckGlyph`와 path가 같은 사본(shared는 pages를 import 못 한다) |
| `src/shared/ui/SegmentedControl.tsx` | 연결형 세그먼트 컨트롤(단일 컨테이너 + 선택 셀만 흰 알약). testID `option.testID ?? segmented-${key}`, `disabled` 셀은 press 무발화. feature-local 유사 세그먼트 사본은 통합하지 않았다 |
| `src/shared/ui/BottomTabBar.tsx` | 순수 뷰 탭바 — 네비게이션을 모른다(`activeKey`·`onPressTab`), testID `shell-tabbar-*`. `expo-blur` BlurView 프로스티드 알약(네이티브 모듈 — prebuild+재빌드 필요). **오버레이는 루트 `absolute bottom-0`이 스스로 진다**(`(tabs)/_layout.tsx`의 `tabBarStyle`은 커스텀 렌더프롭에 무효) — 씬은 안 줄고 탭바가 바닥을 덮는다. 루트 `pointerEvents="box-none"`(투명 밴드가 하단 터치를 흡수하지 않게). 오버레이 회귀는 6-b 실기 전용 |

### `src/shared/map/` — 네이버 네이티브 지도 래퍼

**화면이 아니다** — 지도 렌더 표면. `@mj-studio/react-native-naver-map` 래핑, 공급자 중립 이름 `MapView`라 공급자를 바꿔도 소비처는 무변경이다. 네이티브 뷰라 RN 터치 파이프라인 안에 있다(오버레이 터치 무흡수는 실기 미검증 — `repo-traps.md` 지도 절). 렌더 함정(커스텀 마커 `collapsable={false}`·번호는 SVG)은 `traps-map.md`.

| 파일 | 역할 |
|---|---|
| `src/shared/map/MapView.tsx` | 공급자 중립 `MapView` + `MapCenter`·`MapPin`·`MapPinState`·`MapPinKind`·`MapViewProps` 타입의 집(prop 목록의 정본은 `MapViewProps`). 계약: `center`는 **제어형 `camera`**로 memo(`initialCamera`는 마운트 후 안 바뀌어 재중심 회귀를 냈다) · `onPinTap(index)`은 **배열 index**(핀 번호 아님) · `viewOnly`는 제스처 4종을 개별로 끈다 · `maxLevel`은 네이버 `minZoom`(축 반대, jest는 전달만 본다) · 경로선은 `visited`(+무-kind) 핀만 잇는다. 키(`EXPO_PUBLIC_NAVER_MAP_CLIENT_ID`) 부재면 `map-failure` 표면(INV-4). duration 필드 0(INV-3). 훅은 조기 반환 위에 둔다. region 우선순위는 `fitPins` > `radiusCircle` > 고정 camera(둘 다 없으면 zoom 14 camera). **`onLayout`에서 같은 region을 `ref.animateRegionTo`(easing:'None')로 한 번 더 맞춘다** — 네이버 SDK가 레이아웃 확정 전 임시 프레임으로 먼저 맞추고 같은 값 재전달은 무시하기 때문(TRIP-1043, `traps-map.md`). jest 가짜 지도는 `onLayout`을 발화하지 않아 이 재맞춤은 jest 무심판. 점선 원·축척·핀 래스터는 prop-기록형 목만 잠그고 실렌더는 실기 전용 |
| `src/shared/map/fitRegion.ts` | `buildFitRegion(pins, padding)`(핀 전체를 담는 영역, 기존) · `buildCircleRegion(center, radiusM)`(원 남서/북동 끝을 위도 1도≈111,320m + 경도 `cos(위도)` 보정으로 계산, 여백 1.4배 — TRIP-1043 신규). 둘 다 순수 함수, `MapView.tsx`의 region 우선순위가 소비. |
| `src/shared/map/CenterPinPicker.tsx` | 중앙 고정 핀 좌표 선택기 — center를 **마운트 1회 포획**(제어형 camera 되먹임이 pan을 되돌리는 것 방지)하고, 핀은 `pointerEvents="none"` 자식 오버레이. `onCameraIdle`→`onPick({lat,lng})` |
| `src/shared/map/MapView.test.tsx` | 실 `MapView` + `__mocks__/@mj-studio/react-native-naver-map.tsx`(prop-기록형 목)를 태우는 코어 테스트. 핀 번호·현재위치 라벨은 SVG Text라 `toHaveTextContent`가 아니라 `UNSAFE_queryAllByProps({content})`로 본다. done 체크 색은 래퍼 `<Svg>` 선언값만 읽는 사각이 있다(안쪽 `Path` stroke는 못 봄) |
| `src/shared/map/MapView.fitRadius.test.tsx` | `radiusCircle` region 우선순위(반경 3종이 영역 안에 들어옴·반경 커지면 폭 증가·원 없으면 camera 그대로) — 오케 선작성 심판(TRIP-1043 수정 루프 1). `onLayout` 재맞춤 자체는 목이 이벤트를 안 불러 무심판. |
| `src/shared/map/index.ts` | 배럴 — `MapView`·타입들·`CenterPinPicker` |

### `src/shared/api/generated/` — orval 생성물

`pnpm codegen`이 `orval.config.ts`의 `filters.tags` 목록(정본은 그 파일)만 읽어 `backend/docs/design/openapi.yaml`에서 생성한다. 파일 목록은 `docs/structure.generated.md`(기계 생성) 소관이라 여기 적지 않는다. **사람이 손댄 줄 0이 원칙** — 재생성하면 통째로 덮이고, `pnpm codegen`은 prettier를 안 거치므로 **codegen → `prettier --write` 순서를 고정**한다(안 하면 순수 포맷 diff가 크게 난다). orval은 **태그 단위로만** 필터링해 오퍼레이션 하나만 고를 수 없다 — 소비자 없는 오퍼레이션·스키마가 딸려오는 것이 정상이다. openapi에 `operationId`가 없어 이름은 method+path(`postTrips` 등)다.

| 파일 | 역할 |
|---|---|
| `src/shared/api/generated/schemas/slotCandidates.ts` | **손수 1줄 예외** — `degraded: boolean`을 codegen 대신 수동 추가했다(당시 재생성이 무관 드리프트를 대량으로 끌고 와서). 다음 codegen이 이 줄을 덮거나 openapi와 어긋나면 여기서 잡힌다. `radiusMUsed`는 AI가 자동 확대했을 수 있어 **그대로 표시**하는 게 계약 |
| `src/shared/api/generated/schemas/itineraryGenerationMode.ts` | 응답 enum `FULLY_AI\|CO_PLAN\|MANUAL`. 요청 쪽 enum(`generateItineraryRequestGenerationMode.ts`)과 파일이 갈라져 한쪽만 늘어도 tsc가 안 깨진다 — 값 목록 불일치를 잡는 심판이 없다 |
| `src/shared/api/generated/schemas/itinerarySnapshot.ts` · `src/shared/api/generated/schemas/itinerarySnapshotDaysItem.ts` · `src/shared/api/generated/schemas/itinerarySnapshotDaysItemSlotsItem.ts` | change-log 스냅숏 — ⚠️ 슬롯 모양이 응답(`ItineraryDaysItemSlotsItem`)·요청과 달라 리포에 슬롯 모양이 셋이다. 이름이 비슷해 자동완성 오선택 위험 |
| `src/shared/api/generated/schemas/itineraryCandidatesSummary.ts` | `level`이 enum이 아니라 **string**(판정 소유자가 AI) — `switch`에 tsc가 침묵한다. 필드 자체가 `T\|null\|undefined` 삼중 옵셔널 |
| `src/shared/api/generated/schemas/companionType.ts` | `'혼자'\|'친구'\|'연인'\|'가족'` — **`'커플'` 없음**(온보딩 축과 다른 목록, BR-U1-39) |
| `src/shared/api/generated/schemas/poiCategory.ts` | 7종. Figma 칩·카드 라벨과 어긋나면 **enum이 정본** |
| `src/shared/api/generated/schemas/trip.ts` | `preferenceSnapshot`이 **응답에는 required** — 채우는 주인은 서버, 클라이언트는 요청에 싣지 않는다(`buildCreateTripRequest`가 걷어낸다) |
| `src/shared/bootstrap/bootstrapReeval.ts` | 온보딩 완료 → 부트스트랩 재평가 pub/sub 신호(값 없는 순수 이벤트) |

### `src/shared/ui/pref/`·`src/shared/pref/` — 취향 타일·선택 로직

온보딩과 설정(l05 편집)이 공유한다(features 간 직접 import 금지라 shared 승격).

| 파일 | 역할 |
|---|---|
| `src/shared/ui/pref/PrefTile.tsx` | id-agnostic 순수 타일 — `testID`·`selected`·`onPress`·`Icon`(슬롯) + 라벨 |
| `src/shared/ui/pref/PrefChip.tsx` | 아이콘 없는 칩형 변형 |
| `src/shared/pref/preferenceSelection.ts` | `toggleMulti`/`toggleSingle` — 전부 해제 시 `[]`가 아니라 `null` 복귀(US-ONB-14). `shared/ui`가 아니라 `shared/pref`인 이유: 순수 로직은 `shared/ui`(화면 부품)에 두지 않는다 |

### `src/shared/time/` — 시간 경과 플래그

| 파일 | 역할 |
|---|---|
| `src/shared/time/useElapsedFlag.ts` | `useElapsedFlag(active, ms, restartKey?)` — `active`가 `ms` 동안 이어지면 true, 꺼지면 즉시 false(`active && elapsed`로 꺼진 그 렌더부터 보장), `restartKey`가 바뀌면 0부터 다시 잰다. 요청을 끊지 않는 "오래 걸린다" 플래그일 뿐. **타이머를 쓰는 shared 파일이다** — 지금 소비처는 `SlotCandidatePanelContainer` 1개 |
| `src/shared/time/useElapsedFlag.test.ts` | 경계·꺼진 렌더 false·`restartKey` 리셋 |

### `src/shared/press/` — 연타 관통 공용 가드

| 파일 | 역할 |
|---|---|
| `src/shared/press/pressGuard.ts` | `guardPress(fn)`(모듈 전역 400ms 창이 열려 있으면 무시) · `openPressGuardWindow()`(서버 응답으로 표면이 바뀌는 순간 창만 연다) · `resetPressGuard()`(테스트 전용). 훅이 아니고 `setTimeout` 대신 `Date.now()` 비교(pages 층 타이머 금지 + 테스트가 `Date.now`를 멈춰 판정 고정). **음수 경과(시계 역행)는 창 밖**으로 처리 — 없으면 가드 걸린 버튼이 전부 먹통이 된다. 전역 창이라 스택 아래 화면의 재오픈이 앞 화면 버튼을 1회 먹일 수 있다 |
| `src/shared/press/pressGuard.test.ts` | 경계 399/400ms·무시된 누름 비연장·인자 전달·리셋·시계 역행 |

**소비처** 명부 검사는 없다(TRIP-1145에서 스캔 삭제).
