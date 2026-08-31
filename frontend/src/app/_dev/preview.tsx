import type { ReactElement } from 'react';
import { useState } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  SocialLoginScreen,
  type SocialLoginScreenProps,
} from '@/features/auth/ui/SocialLoginScreen';
import { SplashScreen } from '@/features/auth/ui/SplashScreen';
import {
  HOME_COLLECTING_PROPS,
  HOME_DEFAULT_PROPS,
  HOME_EMPTY_PROPS,
  HOME_LOADING_PROPS,
  HOME_NO_TRIP_PROPS,
  HOME_PLANNING_PROPS,
  HOME_POST_TRIP_PROPS,
  HOME_UPCOMING_PROPS,
} from '@/features/home/model/homeFixtures';
import {
  PREVIEW_PLACES,
  PREVIEW_REGIONS,
  PREVIEW_SAVED_PLACES,
  PREVIEW_SAVED_POI_IDS,
} from '@/features/explore/model/exploreFixtures';
import type { PlaceDetailView } from '@/features/execution/model/placeDetailView';
import type { ProjectedSlot } from '@/features/execution/model/slotProgress';
import { WeatherCloudGlyph } from '@/features/execution/ui/ExecutionGlyphs';
import { LiveItineraryScreen } from '@/features/execution/ui/LiveItineraryScreen';
import { PlaceDetailScreen } from '@/features/execution/ui/PlaceDetailScreen';
import { TriggerBanner } from '@/features/execution/ui/TriggerBanner';
import { TriggerChip } from '@/features/execution/ui/TriggerChip';
import { ConflictSheet } from '@/features/record/ui/ConflictSheet';
import { MemoInline } from '@/features/record/ui/MemoInline';
import { PhotoThumbStrip } from '@/features/record/ui/PhotoThumbStrip';
import { SyncBadge } from '@/features/record/ui/SyncBadge';
import { TripRecordsScreen } from '@/features/record/ui/TripRecordsScreen';
import { VisitTimeSheet } from '@/features/record/ui/VisitTimeSheet';
import { SHARE_FORMATS } from '@/features/reflection/model/shareCard';
import { DailyReflectionScreen } from '@/features/reflection/ui/DailyReflectionScreen';
import { ShareCardScreen } from '@/features/reflection/ui/ShareCardScreen';
import { TripSummaryScreen } from '@/features/reflection/ui/TripSummaryScreen';
import { PlaceExploreScreen } from '@/features/explore/ui/PlaceExploreScreen';
import { RegionPickerScreen } from '@/features/explore/ui/RegionPickerScreen';
import { SavedPlaceListScreen } from '@/features/explore/ui/SavedPlaceListScreen';
import {
  ExploreLandingScreen,
  type StayCardVM,
} from '@/features/explore/ui/ExploreLandingScreen';
import { HomeScreen } from '@/features/home/ui/HomeScreen';
import {
  buildDraftPins,
  formatDraftDayHeader,
} from '@/features/itinerary/model/draftView';
import { type PlanDayTab } from '@/features/itinerary/model/planState';
import type { MustVisitListItem } from '@/features/itinerary/model/mustVisitList';
import {
  startTimeOptions,
  tripDayChips,
} from '@/features/itinerary/model/mustVisitTimeForm';
import {
  DraftScreen,
  type DraftScreenProps,
} from '@/features/itinerary/ui/DraftScreen';
import { GeneratingScreen } from '@/features/itinerary/ui/GeneratingScreen';
import { ItineraryEditScreen } from '@/features/itinerary/ui/ItineraryEditScreen';
import { ManualPlanScreen } from '@/features/itinerary/ui/ManualPlanScreen';
import { MustVisitPickerScreen } from '@/features/itinerary/ui/MustVisitPickerScreen';
import { MustVisitTimeScreen } from '@/features/itinerary/ui/MustVisitTimeScreen';
import { OptionSwapScreen } from '@/features/itinerary/ui/OptionSwapScreen';
import { PlaceAddScreen } from '@/features/itinerary/ui/PlaceAddScreen';
import { SlotCandidatePanel } from '@/features/itinerary/ui/SlotCandidatePanel';
import { SlotTimeSheet } from '@/features/itinerary/ui/SlotTimeSheet';
import { MethodPickerScreen } from '@/features/itinerary/ui/MethodPickerScreen';
import {
  MyTripCard,
  type MyTripCardVM,
} from '@/features/itinerary/ui/MyTripCard';
import { MyTripsListScreen } from '@/features/itinerary/ui/MyTripsListScreen';
import { TimelineScreen } from '@/features/itinerary/ui/TimelineScreen';
import { ZeroCandidateScreen } from '@/features/itinerary/ui/ZeroCandidateScreen';
import {
  NotificationInboxScreen,
  type NotificationSection,
} from '@/features/notification/ui/NotificationInboxScreen';
import {
  NotificationSettingsScreen,
  type ToggleValueMap,
} from '@/features/notification/ui/NotificationSettingsScreen';
import { buildSettingsSections } from '@/features/settings/model/settingsSections';
import { DeleteAccountDialog } from '@/features/settings/ui/DeleteAccountDialog';
import { LocationConsentScreen } from '@/features/settings/ui/LocationConsentScreen';
import type { StyleCardVM } from '@/features/settings/model/styleCardModel';
import { MyPageScreen } from '@/features/settings/ui/MyPageScreen';
import { PersonalizationScreen } from '@/features/settings/ui/PersonalizationScreen';
import {
  MyStaysScreen,
  type MyStayRowVM,
} from '@/features/settings/ui/MyStaysScreen';
import { StyleSummaryCard } from '@/features/settings/ui/StyleSummaryCard';
import { RevokeConfirmDialog } from '@/features/settings/ui/RevokeConfirmDialog';
import { SettingsScreen } from '@/features/settings/ui/SettingsScreen';
import { TripCard, type TripCardVM } from '@/features/settings/ui/TripCard';
import { triggerWatchlist } from '@/features/planb/model/triggerWatchlist';
import { ManualEditScreen } from '@/features/planb/ui/ManualEditScreen';
import { ReplanRequestSheet } from '@/features/planb/ui/ReplanRequestSheet';
import { ReplanAppliedScreen } from '@/features/planb/ui/ReplanAppliedScreen';
import { ReplanDraftScreen } from '@/features/planb/ui/ReplanDraftScreen';
import { ReplanSolvingScreen } from '@/features/planb/ui/ReplanSolvingScreen';
import { NoAlternativeScreen } from '@/features/planb/ui/NoAlternativeScreen';
import type { ReplanSlotVM } from '@/features/planb/ui/ReplanSlotRow';
import { SlotCandidateSheet } from '@/features/planb/ui/SlotCandidateSheet';
import { TriggerWatchlistScreen } from '@/features/planb/ui/TriggerWatchlistScreen';
import { NicknameScreen } from '@/features/onboarding/ui/NicknameScreen';
import {
  StayRegisterScreen,
  type StayRegisterScreenProps,
} from '@/features/stay/ui/StayRegisterScreen';
import { StaySearchScreen } from '@/features/stay/ui/StaySearchScreen';
import { StayDetailScreen } from '@/features/stay/ui/StayDetailScreen';
import {
  SavedStayListScreen,
  type SavedStayCardVM,
} from '@/features/stay/ui/SavedStayListScreen';
import { OtaChoiceSheet } from '@/features/stay/ui/OtaChoiceSheet';
import { StayPriceSheet } from '@/features/stay/ui/StayPriceSheet';
import {
  TripWizardStep1Screen,
  type TripWizardStep1ScreenProps,
} from '@/features/trip/ui/TripWizardStep1Screen';
import { PrefOverrideSheet } from '@/pages/trip-new-step1/ui/PrefOverrideSheet';
import { LiveLocationPage } from '@/pages/live-location';
import {
  TripWizardStep2Screen,
  type TripWizardStep2ScreenProps,
} from '@/features/trip/ui/TripWizardStep2Screen';
import { PrefStep1Screen } from '@/features/onboarding/ui/PrefStep1Screen';
import { PrefStep2Screen } from '@/features/onboarding/ui/PrefStep2Screen';
import { TermsScreen } from '@/features/onboarding/ui/TermsScreen';
import type { PreferenceSelection } from '@/features/settings/model/preferenceDraft';
import { PreferencesEditView } from '@/features/settings/ui/PreferencesEditView';
import type {
  ItineraryDaysItem,
  ItineraryDaysItemSlotsItem,
  SlotCandidatesCandidatesItem,
  StayItem,
  Trigger,
} from '@/shared/api/generated/schemas';
import { PersonalizationInfoReason } from '@/shared/api/generated/schemas';
import { ManualTimeSheet, reorderKeepingFixed } from '@/shared/itinerary-edit';
import { LocationPreprompt } from '@/shared/location/LocationPreprompt';
import { revokeImpact } from '@/shared/location/revokeImpact';
import { KakaoMapView, type MapPin } from '@/shared/map';
import { BottomTabBar, type ShellTabKey } from '@/shared/ui/BottomTabBar';

/**
 * expo-router 의 `useLocalSearchParams` 를 모듈 로드 시점에 딱 한 번 안전하게 구해온다.
 *
 * 왜 최상단 `import { useLocalSearchParams } from 'expo-router'` 를 안 쓰는가: expo-router
 * 패키지 진입점(build/index.js)은 `Stack`/`Tabs` 레이아웃도 함께 즉시 require 하는데, 그 경로가
 * `@react-navigation/native` 의 ESM 전용 빌드(lib/module, package.json `"type":"module"`)를
 * 끌고 온다. 이 리포의 node 버킷은 `--experimental-vm-modules` 로 도는데, 그 아래에서 CJS
 * `require()` 로 "type":"module" 패키지를 불러오면 Node 가 `ERR_REQUIRE_ESM` 을 던진다 —
 * 정적 import 로 쓰면 이 throw 가 모듈 로드 자체를 깨뜨려 잡을 수 없다.
 * 동결 devPreview.test.tsx 는 expo-router 를 목 없이 렌더하므로 이 경로를 그대로 밟는다.
 *
 * 그래서 require 를 함수 호출로 명시적으로 늦춰 try/catch 로 감싼다 — 이건 **모듈 로드
 * 시점**(컴포넌트 렌더 밖)에서 딱 한 번만 실행되므로 Hooks 규칙(매 렌더 동일 순서)과
 * 무관하다: 컴포넌트 안에서는 아래 변수를 **항상** 호출하기만 한다.
 *  - 목이 있으면(딥링크 테스트) require 가 목 객체를 돌려주므로 실제 훅을 그대로 쓴다.
 *  - 목이 없고 실패하면(동결 devPreview.test) 파라미터 없음과 동일한 더미로 폴백한다
 *    — 크래시 없이 splash 로 떨어지는 함정 #3 계약의 근거.
 */
let useDevPreviewSearchParams: () => { state?: string | string[] };
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  useDevPreviewSearchParams = require('expo-router').useLocalSearchParams;
} catch {
  useDevPreviewSearchParams = () => ({});
}

/**
 * dev 전용 정적 프리뷰 — 눈으로 확인해야 하는 7개 시각 상태를 한 화면에서 전환해 본다.
 * 진입은 딥링크뿐이다: `trippilot://_dev/preview` (앱 UI 에는 이 화면으로 가는 링크가 없다).
 *
 * "정적"의 뜻: 화면 컴포넌트에 상태값을 손으로 넣어 그린다 — 서버·목 서버·네트워크 계층을
 * 하나도 거치지 않는다. 그래서 백엔드가 없어도, 목이 없어도 에러·충돌·연령 화면을 볼 수 있다.
 * 이것이 성립하는 이유는 `screens/` 가 props 만 받는 프레젠테이션이기 때문이다
 * (frontend/README.md L54). 네트워크를 타는 것은 컨테이너·훅이고, 프리뷰는 그것을 건너뛴다.
 *
 * 제약: `@/shared/api`·컨테이너·훅을 값으로 import 하면 안 된다 — 그 순간 프리뷰가
 * 네트워크 계층을 그래프로 끌고 온다(devPreview.test.tsx 의 지뢰 목이 즉시 터진다).
 */

// 프리뷰는 보기 전용이라 화면이 요구하는 콜백을 전부 빈 함수로 채운다.
const noop = () => {};

// d01 탐색 랜딩 숙소 레인 카드(라우트가 formatPrice·stayKey 로 만드는 뷰모델의 프리뷰 값).
// 가격 미확인 카드를 한 장 섞어 formatPrice 두 갈래를 눈으로 확인한다(BR-U1-12/14).
const EXPLORE_STAY_CARDS: StayCardVM[] = [
  {
    key: 'yanolja:1',
    name: '해운대 오션 호텔',
    region: '부산',
    priceText: '145,000원~',
  },
  {
    key: 'agoda:2',
    name: '광안리 뷰 호텔',
    region: '부산',
    priceText: '가격 미확인',
  },
  {
    key: 'yanolja:3',
    name: '서면 시티 호텔',
    region: '부산',
    priceText: '98,000원~',
  },
];

// e02 저장 하트(TRIP-417) — jest 는 하트의 분홍 채움 색을 못 본다(repo-trap: 글리프 fill 무심판,
// AC-V1). 이 진입점이 채움/빈/대기 세 상태를 한 화면에서 눈으로 확인하는 유일한 자리다.
const STAY_SEARCH_PREVIEW_ITEMS: StayItem[] = [
  {
    externalSource: 'NAVER',
    externalId: 's1',
    name: '해운대 그랜드 호텔',
    lat: 35.1587,
    lng: 129.1604,
    region: '해운대',
    amenities: ['ocean'],
    stayType: 'HOTEL',
    price: { amount: 145000, currency: 'KRW' },
  },
  {
    externalSource: 'NAVER',
    externalId: 's2',
    name: '서면 시티 호텔',
    lat: 35.1577,
    lng: 129.0594,
    region: '서면',
    amenities: ['wifi'],
    stayType: 'HOTEL',
    price: { amount: 98000, currency: 'KRW' },
  },
  {
    externalSource: 'AGODA',
    externalId: 's3',
    name: '광안리 오션뷰',
    lat: 35.1531,
    lng: 129.1186,
    region: '광안리',
    amenities: ['ocean'],
    stayType: 'PENSION',
    price: null,
  },
];

// e03 상세(TRIP-457) — 편의시설 4칩·미니맵 자리·CTA 2종·제휴 고지를 눈으로 확인한다(jest 는
// 픽셀·레이아웃을 못 본다, 6-b 실기 몫). 가격 미확인·notFound·시트 얼굴은 아래 프리뷰 키가
// 유일한 열람처(실 라우트로는 백엔드/딥링크 없이 못 본다).
const STAY_DETAIL_PREVIEW_ITEM: StayItem = {
  externalSource: 'NAVER',
  externalId: 'd1',
  name: '해운대 오션 스위트',
  lat: 35.1587,
  lng: 129.1604,
  region: '부산 해운대구 우동',
  amenities: ['주차', '조식', '와이파이', '오션뷰'],
  stayType: 'HOTEL',
  price: { amount: 145000, currency: 'KRW' },
};

// 가볼 곳 가로 레인(TRIP-470) — 프리뷰에서 레인을 눈으로 보기 위한 표본 카드. `as const` 밖에
// 둬야 cards 가 readonly 튜플로 굳지 않는다(placeLane.cards 는 PlaceCardVM[] 요구).
const EXPLORE_LANDING_PLACE_LANE = {
  error: false,
  cards: [
    { poiId: 'p1', name: '감천문화마을', region: '사하구' },
    { poiId: 'p2', name: '광안리 해변', region: '수영구' },
    { poiId: 'p3', name: '해운대 블루라인', region: '해운대구' },
  ],
  onRetry: noop,
  onPressCard: noop,
};

const EXPLORE_LANDING_BASE = {
  heading: {
    title: '무엇을 둘러볼까요?',
    subtitle: '숙소·장소·여행자 일정을 둘러보고 담아요',
  },
  onPressSearch: noop,
  onPressPlaces: noop,
  placeLane: EXPLORE_LANDING_PLACE_LANE,
} as const;

const VIEW_ONLY_HANDLERS = {
  onSignIn: noop,
  onConflictContinue: noop,
  onConflictCancel: noop,
  onAgeConfirm: noop,
  onAgeCancel: noop,
};

// 로그인 화면의 조건부 UI 5개는 전부 이 세 값의 파생이다 → 값을 넣으면 그 상태가 그대로 나온다.
type LoginState = Pick<
  SocialLoginScreenProps,
  'phase' | 'errorCode' | 'conflictProvider'
>;

interface PreviewState {
  key: string;
  label: string;
  // null 이면 로그인 화면이 아니라 스플래시를 그린다.
  login: LoginState | null;
  // 로그인/스플래시가 아닌 화면(온보딩 등)은 여기서 직접 그린다.
  render?: () => ReactElement;
}

// 온보딩 약관 3행 — 필수 3종(BR-U0-10, TRIP-366). 버전은 서버가 주는 값을 흉내낸 대표값.
const TERMS_ITEMS = [
  {
    termsType: 'TERMS_OF_SERVICE',
    version: '1.4',
    label: '서비스 이용약관',
    required: true,
    checked: false,
  },
  {
    termsType: 'PRIVACY_POLICY',
    version: '2.1',
    label: '개인정보 수집·이용',
    required: true,
    checked: false,
  },
  {
    termsType: 'LOCATION_TERMS',
    version: '1.1',
    label: '위치기반서비스',
    required: true,
    checked: false,
  },
];

/**
 * g02 거점 숙소 2/2 default 의 대표값(TRIP-225) — Figma `1707:1183` 실측을 그대로 옮겼다.
 * 다른 변형은 이걸 스프레드하고 갈리는 prop 만 덮어쓴다.
 *
 * 왜 프리뷰가 필요한가: 실화면 딥링크로는 **`notrip` 얼굴밖에 볼 수 없다.** 나머지 넷은
 * `tripId`가 있어야 하는데 그건 g01 제출(`POST /trips`)이 만들고, 백엔드 없이는 안 생긴다.
 *
 * ⚠️ 후보 카드의 사진·지역·거리·가격 자리는 회색으로 보인다 — `SavedStay` 계약에 그 필드가
 * 없어서다(01b D2). 구현 실패가 아니다.
 */
/** g02 보완 시트(TRIP-226)의 대표값 — 좌표 미확정이라 지도 섹션이 그려지는 갈래다. */
const FIX_SHEET_BASE: NonNullable<TripWizardStep2ScreenProps['fixSheet']> = {
  savedStayId: 'stay-2',
  stayName: '광안리 뷰 호텔',
  center: { lat: 35.1587, lng: 129.1604 },
  coordConfirmed: false,
  pinDropped: false,
  mapUnavailable: false,
  dayOptions: [
    { date: '2026-06-10', label: '6/10' },
    { date: '2026-06-11', label: '6/11' },
    { date: '2026-06-12', label: '6/12' },
    { date: '2026-06-13', label: '6/13' },
  ],
  checkIn: null,
  checkOut: null,
  saveDisabled: true,
  saveBlockedReason: '날짜를 모두 선택해 주세요',
  saving: false,
  onPinDrop: noop,
  onConfirmCoord: noop,
  onPickDay: noop,
  onSave: noop,
  onRetrySave: noop,
  onClose: noop,
};

/** h05 목록 3항목 — Figma 실측 데이터 그대로. `imageUrl` 이 전부 `null` 인 것은 다른 프리뷰
 * 픽스처와 같은 이유다(서버 시드가 사진을 안 준다 — `exploreFixtures` 머리말). */
const MUST_VISIT_PREVIEW_ITEMS: MustVisitListItem[] = [
  {
    mustVisitId: 'mv-a',
    sourcePoiId: 'poi-a',
    name: '부산시립미술관',
    imageUrl: null,
    type: 'FIXED',
    fixedDate: '2026-06-11',
    fixedStart: '13:00',
  },
  {
    mustVisitId: 'mv-b',
    sourcePoiId: 'poi-b',
    name: '해운대 블루라인파크',
    imageUrl: null,
    type: 'ANYTIME',
  },
  {
    mustVisitId: 'mv-c',
    sourcePoiId: 'poi-c',
    name: '감천문화마을',
    imageUrl: null,
    type: 'ANYTIME',
  },
];

/** h05 지도 핀 3개 — Figma `1875:1083` 이 그린 부산 3지점. 배선에서는
 * `buildMustVisitPins` 가 담은 장소 좌표로 만드는 값이라, 여기서는 그 결과 모양만 흉내 낸다. */
const MUST_VISIT_PREVIEW_PINS: MapPin[] = [
  { number: 1, lat: 35.1379, lng: 129.0596 },
  { number: 2, lat: 35.1587, lng: 129.1604 },
  { number: 3, lat: 35.163, lng: 129.0104 },
];

/**
 * h11 AI 추천안 초안(TRIP-297)의 하루 — 승인 테스트(`DraftScreen.test.tsx`)가 쓰는 슬롯 4개와
 * **같은 모양**이다. 두 곳이 갈리면 "테스트에서 본 것"과 "눈으로 본 것"이 달라진다.
 * 테스트 파일에서 import 하지 않고 값을 여기 다시 둔다 — 테스트는 프로덕션 그래프에
 * 들어가면 안 된다(`MUST_VISIT_THUMBNAILS` 처럼 파일 상단 상수로 두는 이 파일의 관례).
 *
 * 한 벌이 동시에 덮는 것: 시간대 4종(오전·점심·오후·저녁) · 고정/비고정 · 좌표 유무 ·
 * null 필드. 2번 슬롯은 이름·사진·태그·좌표를 **전부 안 주는** 슬롯이라 그 자리가 어떻게
 * 비는지(AC-7)와 지도 핀이 ①③④ 로 건너뛰는 것(AC-13)을 한 화면에서 같이 볼 수 있다.
 *
 * ⚠️ TRIP-339 로 판단이 바뀐 자리 — 예전에는 `imageUrl` 이 전부 `null` 이었고 그 머리말은
 * "78px 썸네일이 빠져 보이는 것은 구현 실패가 아니다"라고 적혀 있었다. 그러나 프리뷰의 쓸모는
 * **Figma 와 눈으로 대조하는 것**이라, 사진 칸이 통째로 빈 화면은 대조를 할 수 없게 만든다.
 * 이제 1·3·4번 슬롯이 로컬 에셋에서 푼 URI 를 받는다. 2번 슬롯은 그대로 `null` 이라
 * **사진이 없는 카드가 어떻게 그려지는지**도 같은 화면에서 계속 볼 수 있다.
 * 클라가 외부 URL 을 지어내지 않는다는 INV-1 은 그대로다 — 값의 출처가 리포 안 파일이다.
 *
 * ⚠️ 좌표도 TRIP-339 에서 좁혔다(옛 최장 41km → 2.0km). Figma h11 지도는 가로 358px 에
 * 1km ≈ 52px 축척이라 한 화면이 약 6.9km 인데, 41km 짜리 핀 묶음은 그 6배로 벌어져 축척이
 * 아예 다른 그림이 됐다. 3·4번은 서로 241m 라 화면에서 겹쳐 보이기까지 했다. 셋을 실제
 * 관광지인 성산일출봉 둘레(0.9~2.0km)로 모았다 — **카페·숙소 이름과 실제 위치는 맞지 않는다**
 * (이 픽스처의 이름은 원래 가상이고, 여기서 재는 것은 축척과 배치다).
 */
const DRAFT_PREVIEW_DATE = '2026-06-10';

/**
 * 프리뷰 카드 썸네일 3장. 파일 출처·라이선스는 `src/assets/itinerary/CREDITS.md`.
 *
 * > **개념 — `require` + `Image.resolveAssetSource`**: React Native 에서 로컬 이미지는 URL 이
 * > 아니라 `require('...jpg')` 로 번들에 싣는다. 그 결과는 번들러가 매긴 **에셋 참조**이지
 * > 문자열이 아니라서, `<Image source={{ uri }} />` 처럼 문자열 URI 를 받는 자리에 넣으려면
 * > `Image.resolveAssetSource(...).uri` 로 한 번 풀어야 한다.
 *
 * jest 에서는 에셋이 스텁으로 바뀌어 `.uri` 가 `undefined` 다 — 그래서 `?? null` 로 받아
 * 계약(`imageUrl: string | null`)에 맞춰 떨어뜨린다. 테스트에서는 사진 없는 카드가 되고
 * 실기에서만 썸네일이 뜬다. 실제 사진이 뜨는지는 6-b 실기 확인 몫이다.
 */
const DRAFT_PREVIEW_PHOTOS: (string | null)[] = [
  require('@/assets/itinerary/draft-preview-1.jpg'),
  require('@/assets/itinerary/draft-preview-2.jpg'),
  require('@/assets/itinerary/draft-preview-3.jpg'),
].map((source) => Image.resolveAssetSource?.(source)?.uri ?? null); // 웹에는 이 API 가 없다(네이티브 전용) — 옵셔널 호출로 웹은 null(사진 없는 카드)

const DRAFT_PREVIEW_SLOTS: ItineraryDaysItemSlotsItem[] = [
  {
    poiId: 'poi-a',
    startAt: '09:30:00',
    endAt: '11:00:00',
    isFixed: false,
    endsNextDay: false,
    hasViolation: false,
    nameKo: '성산일출봉',
    imageUrl: DRAFT_PREVIEW_PHOTOS[0],
    tags: ['바다', '포토'],
    distanceRange: '약 1.2km · 도보 추정',
    lat: 33.458,
    lng: 126.942,
  },
  {
    poiId: 'poi-b',
    startAt: '12:30:00',
    endAt: '13:30:00',
    isFixed: false,
    endsNextDay: false,
    hasViolation: false,
    nameKo: null,
    imageUrl: null,
    tags: [],
    lat: null,
    lng: null,
  },
  {
    poiId: 'poi-c',
    startAt: '15:00:00',
    endAt: '16:30:00',
    isFixed: false,
    endsNextDay: false,
    hasViolation: false,
    nameKo: '카페 그레이',
    imageUrl: DRAFT_PREVIEW_PHOTOS[1],
    tags: ['카페'],
    lat: 33.4664,
    lng: 126.9276,
  },
  {
    poiId: 'poi-d',
    startAt: '21:00:00',
    endAt: '22:00:00',
    isFixed: true,
    endsNextDay: false,
    hasViolation: false,
    nameKo: '제주 신라스테이',
    imageUrl: DRAFT_PREVIEW_PHOTOS[2],
    tags: [],
    lat: 33.4741,
    lng: 126.9316,
  },
];

const DRAFT_PREVIEW_DAYS: ItineraryDaysItem[] = [
  { date: DRAFT_PREVIEW_DATE, slots: DRAFT_PREVIEW_SLOTS },
];

/** 좌표가 하나도 없는 날 — 핀이 0개라 **지도 블록이 통째로 빠지고 레이아웃이 위로 당겨진다.**
 * 03 §3.1-3 의 자기 신고 자리이고 Figma 와 갈리는 지점이라, 눈으로 판단할 상태로 세운다. */
const DRAFT_PREVIEW_DAYS_NO_COORDS: ItineraryDaysItem[] = [
  {
    date: DRAFT_PREVIEW_DATE,
    slots: DRAFT_PREVIEW_SLOTS.map((slot) => ({
      ...slot,
      lat: null,
      lng: null,
    })),
  },
];

const DRAFT_PREVIEW_BASE: DraftScreenProps = {
  view: { kind: 'listed', days: DRAFT_PREVIEW_DAYS, staleFailed: false },
  // 여행은 3일인데 첫날만 도착한 상태(2단계 생성 중) — 2·3일차 탭이 비활성으로 보인다.
  tabs: [
    { date: DRAFT_PREVIEW_DATE, dayNumber: 1, hasData: true },
    { date: '2026-06-11', dayNumber: 2, hasData: false },
    { date: '2026-06-12', dayNumber: 3, hasData: false },
  ],
  selectedDate: DRAFT_PREVIEW_DATE,
  // 배선이 쓰는 판정 함수를 그대로 부른다 — 손으로 적으면 프리뷰와 실기가 갈린다.
  pins: buildDraftPins(DRAFT_PREVIEW_SLOTS),
  dayHeader: formatDraftDayHeader(DRAFT_PREVIEW_DATE),
  canRetry: true,
  onSelectDay: noop,
  onRetry: noop,
  onBack: noop,
  onComplete: noop,
};

const TRIP_BASE_SCREEN: TripWizardStep2ScreenProps = {
  variant: 'default',
  subtitle: '6월 10일–13일',
  sections: [
    {
      baseAssignmentId: 'ba-1',
      nightLabel: '1–2박',
      dateLabel: '6/10–6/12',
      stayName: '해운대 오션 호텔',
      changePending: false,
    },
    {
      baseAssignmentId: 'ba-2',
      nightLabel: '3박',
      dateLabel: '6/12–6/13',
      stayName: '경주 한옥스테이 봄',
      changePending: false,
    },
  ],
  candidates: [
    {
      savedStayId: 'stay-1',
      name: '해운대 오션 호텔',
      isBase: true,
      assignedLabel: '1–2박에 지정됨',
      assignPending: false,
    },
    {
      savedStayId: 'stay-2',
      name: '광안리 뷰 호텔',
      isBase: false,
      assignPending: false,
    },
    // 날짜를 안 넣고 저장한 숙소 — 등록 화면의 체크인/아웃이 `(선택)`이라 실제로 생긴다(D4).
    {
      savedStayId: 'stay-3',
      name: '감천 게스트하우스',
      isBase: false,
      assignPending: false,
      blockedReason: '날짜가 없어 지정할 수 없어요',
    },
    {
      savedStayId: 'stay-4',
      name: '경주 한옥스테이 봄',
      isBase: true,
      assignedLabel: '3박에 지정됨',
      assignPending: false,
      errorText: '지정하지 못했어요',
    },
  ],
  generateDisabled: false,
  coverageFailed: false,
  onBack: noop,
  onAssign: noop,
  onRetryAssign: noop,
  onChange: noop,
  onRetryChange: noop,
  onGenerate: noop,
  onNoStayStart: noop,
  onExploreStays: noop,
  onRetryAll: noop,
  onRestart: noop,
  onRetryCoverage: noop,
};

/**
 * g01 여행 만들기 1/2 — '꼭 갈 곳' 시드 섹션(TRIP-209)을 Figma와 눈으로 대조하기 위한 두 얼굴.
 *
 * 왜 프리뷰가 필요한가: 실화면 딥링크로는 **시드 얼굴을 볼 수 없다.** 백엔드가 401이면 담은
 * 목록이 늘 비어 0곳 얼굴로만 떨어진다(d04·d02 프리뷰가 있는 것과 같은 이유).
 *
 * ⚠️ 썸네일 사진은 회색 자리로 보인다 — `imageUrl`이 프로덕션에서 전부 `null`이고 클라가
 * 외부 URL을 지어내는 것은 INV-1이 막는다(`exploreFixtures.ts` 머리말과 같은 사정).
 * 구현 실패가 아니다.
 */
/** 취향 override 시트(TRIP-484) 선택지 표본 — 온보딩 스타일 7종(slug→한국어)과 같은 목록. */
const PREF_OVERRIDE_OPTIONS = [
  { slug: 'rest', label: '휴양' },
  { slug: 'gourmet', label: '미식' },
  { slug: 'nature', label: '자연' },
  { slug: 'art', label: '문화예술' },
  { slug: 'activity', label: '액티비티' },
  { slug: 'sightseeing', label: '관광' },
  { slug: 'shopping', label: '쇼핑' },
];

const TRIP_WIZARD_BASE: TripWizardStep1ScreenProps = {
  destinations: [{ seq: 1, region: '부산', nights: 3 }],
  startDate: '2026-06-10',
  endDate: '2026-06-13',
  presetCode: '3n4d',
  party: 2,
  companionType: '친구',
  preferenceChips: ['감성 골목', '야경'],
  // 위저드 화면 계약은 `{code, name}[]`이다(서버 `Region`이 아니라) — 페이지 `wizardRegions`와
  // 같은 어댑트(selectable 만 남기고 regionCode→code)로 프리뷰 표본을 맞춘다.
  regions: PREVIEW_REGIONS.filter((region) => region.selectable !== false).map(
    (region) => ({ code: region.regionCode, name: region.name })
  ),
  canProceed: true,
  onBack: noop,
  onAddDestination: noop,
  onRemoveDestination: noop,
  onSelectPreset: noop,
  onPressPeriod: noop,
  onChangeParty: noop,
  onSelectCompanion: noop,
  onChangePreference: noop,
  onNext: noop,
};

/** Figma `1737:1083` 실측과 같은 구성 — 썸네일 3장 + `+2`(외 2곳) + 점선 `더 담기`. */
const MUST_VISIT_THUMBNAILS = [
  { sourcePoiId: 'poi-1', name: '감천문화마을', imageUrl: null },
  { sourcePoiId: 'poi-2', name: '광안리해수욕장', imageUrl: null },
  { sourcePoiId: 'poi-3', name: '전포카페거리', imageUrl: null },
];

/**
 * h25 완성 일정(TimelineScreen) 프리뷰 픽스처 — 피어 세션(frontend-82 "지라 TRIP-299 진행")이
 * 제공한 h25 칩을 옮긴 것이다(크로스티켓 조율: TRIP-299 프리뷰 칩 누락 보완, [기록]에 출처 명시).
 * h34 확정 프리뷰가 같은 데이터에 `status=CONFIRMED` 만 얹어 두 얼굴을 한 자리에서 대조한다.
 * 슬롯 4개가 오전/저녁/점심 시간대·고정·위반·자정 넘김을 한 벌로 덮는다.
 */
const TIMELINE_PREVIEW_HEADER = {
  title: '부산 여행',
  nightsLabel: '3박 4일',
  totalPlaces: 5,
};
const TIMELINE_PREVIEW_DAYS: PlanDayTab[] = [
  { dayIndex: 1, date: '2026-06-10', count: 4 },
  { dayIndex: 2, date: '2026-06-11', count: 1 },
];
const TIMELINE_PREVIEW_SLOTS: ItineraryDaysItemSlotsItem[] = [
  {
    poiId: 'poi-a',
    startAt: '09:30:00',
    endAt: '11:00:00',
    isFixed: false,
    endsNextDay: false,
    hasViolation: false,
    tags: [],
  },
  {
    poiId: 'poi-b',
    startAt: '21:00:00',
    endAt: '22:00:00',
    isFixed: true,
    endsNextDay: false,
    hasViolation: false,
    tags: [],
  },
  {
    poiId: 'poi-c',
    startAt: '13:00:00',
    endAt: '14:00:00',
    isFixed: false,
    endsNextDay: false,
    hasViolation: true,
    violationReason: '영업 종료 후 도착',
    tags: [],
  },
  {
    poiId: 'poi-d',
    startAt: '22:30:00',
    endAt: '06:00:00',
    isFixed: false,
    endsNextDay: true,
    hasViolation: false,
    tags: [],
  },
];

/**
 * 완성 일정 · **풀 표면**(TRIP-354) 프리뷰 픽스처 — 세그먼트 토글이 없어졌고(결정 D) 지도가 상시
 * 인라인이라, 이 픽스처 하나가 인라인 글랜스 지도 + 풀카드(사진·이름·영업시간·태그) + 구간행(거리 +
 * [길찾기]) + 날짜헤더 "이동 X"(legDistance 합산) + 휴관칩을 한 화면에서 보여준다. "지도 크게 보기"
 * 를 누르면 h26 확대 오버레이(제스처 지도 + peekstrip + 핀 상세)가 열린다.
 * 위 h25 픽스처는 좌표·POI 표면이 비어(null 반쪽 엣지) 사진·이름 없는 카드로 대비된다.
 * 부산 실좌표 3지점 + **좌표 부재 슬롯 1개**(자갈치)를 섞어, 핀이 ①②④ 로 건너뛰고 카드엔 "지도
 * 미표시" 배지·영업시간 "미확인"·휴관칩(openingHoursKnown false)이 한 자리에서 같이 보인다.
 * 사진은 초안 프리뷰 썸네일 재사용(`DRAFT_PREVIEW_PHOTOS`).
 * ⚠️ 지도 폴백(h31)은 이 픽스처로 못 띄운다 — 폴백은 확대 오버레이의 KakaoMapView 실제 로드
 * 실패(onLoadFailed)로만 켜지고 강제할 prop 이 없다. 카카오 JS 키가 있으면 지도가 뜨고, 없으면 폴백.
 */
const TIMELINE_MAP_PREVIEW_SLOTS: ItineraryDaysItemSlotsItem[] = [
  {
    poiId: 'poi-a',
    startAt: '09:30:00',
    endAt: '11:00:00',
    isFixed: false,
    endsNextDay: false,
    hasViolation: false,
    tags: ['바다', '야경'],
    lat: 35.1532,
    lng: 129.1187,
    nameKo: '광안리 해변',
    category: '해변',
    openingHours: '24시간 개방',
    distanceRange: null,
    imageUrl: DRAFT_PREVIEW_PHOTOS[0],
  },
  {
    poiId: 'poi-b',
    startAt: '12:00:00',
    endAt: '13:30:00',
    isFixed: false,
    endsNextDay: false,
    hasViolation: false,
    tags: ['문화'],
    lat: 35.0966,
    lng: 129.0107,
    nameKo: '감천문화마을',
    category: '명소',
    openingHours: '09:00–18:00 영업',
    distanceRange: '약 3.1km · 차량 추정',
    imageUrl: DRAFT_PREVIEW_PHOTOS[1],
  },
  {
    poiId: 'poi-c',
    startAt: '14:30:00',
    endAt: '16:00:00',
    isFixed: false,
    endsNextDay: false,
    hasViolation: false,
    tags: [],
    lat: null,
    lng: null,
    nameKo: '자갈치시장',
    category: '시장',
    openingHours: null,
    openingHoursKnown: false,
    distanceRange: null,
    imageUrl: null,
  },
  {
    poiId: 'poi-d',
    startAt: '18:30:00',
    endAt: '20:00:00',
    isFixed: true,
    endsNextDay: false,
    hasViolation: false,
    tags: [],
    lat: 35.1587,
    lng: 129.1604,
    nameKo: '해운대 포차거리',
    category: '활동',
    openingHours: '17:00–02:00 영업',
    distanceRange: '약 1.2km · 도보 추정',
    imageUrl: DRAFT_PREVIEW_PHOTOS[2],
  },
];

/**
 * TRIP-465 · 사진 없는 슬롯의 **카테고리 플레이스홀더** 프리뷰 픽스처 — 8종(명소·맛집·카페·야경·
 * 자연·쇼핑·문화 + 폴백)을 한 화면에 세워 틴트·아이콘 정합을 Figma 노드 2989:1731 과 눈으로 대조한다.
 * 전부 `imageUrl:null` 이라 사진 자리에 플레이스홀더가 뜬다(사진 있는 카드는 위 `itinerary-map`
 * 픽스처가 담당 — 상호 배타). 폴백은 매핑 밖 카테고리("액티비티")로 유도한다.
 */
const TIMELINE_PLACEHOLDER_PREVIEW_SLOTS: ItineraryDaysItemSlotsItem[] = [
  '명소',
  '맛집',
  '카페',
  '야경',
  '자연',
  '쇼핑',
  '문화',
  '액티비티',
].map((category, index) => ({
  poiId: `poi-ph-${index}`,
  startAt: `${String(9 + index).padStart(2, '0')}:00:00`,
  endAt: `${String(10 + index).padStart(2, '0')}:00:00`,
  isFixed: false,
  endsNextDay: false,
  hasViolation: false,
  tags: [category],
  lat: 35.16,
  lng: 129.16,
  nameKo: `${category} 장소`,
  category,
  openingHours: '09:00–18:00 영업',
  distanceRange: index === 0 ? null : '약 1.2km · 도보 추정',
  imageUrl: null,
}));

// 내 여행 목록(h37, TRIP-468) 카드 VM 3종 — 완성·작성중·미도착(배지 degrade). 순수 카드라
// 픽스처를 얹어 세 얼굴을 한 화면에서 본다(컨테이너·react-query 없이).
const MY_TRIPS_PREVIEW_VMS: MyTripCardVM[] = [
  {
    tripId: 'demo-done',
    title: '서귀포시 여행',
    metaLine: '6월 10일 ~ 13일 · 3박 4일 · 2명',
    badge: 'done',
    extra: '확정 장소 12곳',
  },
  {
    tripId: 'demo-draft',
    title: '부산 여행',
    metaLine: '7월 2일 ~ 4일 · 2박 3일 · 4명',
    badge: 'draft',
    extra: '추천안 준비 중',
  },
  {
    tripId: 'demo-load',
    title: '경주 여행',
    metaLine: '8월 1일 ~ 2일 · 1박 2일 · 1명',
    badge: null,
    extra: null,
  },
];

// l03 마이페이지 · l03(TRIP-604) — 예정 카드(D-배지)와 지난 여행 카드(회고 chevron)의 두 얼굴을
// 한 화면에서 대조하는 픽스처. 화면은 무상태라 VM + noop 한 벌로 충분(TripCardContainer 의 조회
// 조립은 안 태움 — 배지 pill 위치·세그먼트 활성 그림자·아바타 원은 jest 사각, 6-b 육안 몫).
const MY_PAGE_UPCOMING_VMS: TripCardVM[] = [
  {
    tripId: 'busan',
    destinationLabel: '부산',
    dateRange: '6.10~6.12',
    basesLabel: '숙소 1',
    daysLabel: '일정 3일',
    dBadge: 'D-12',
    isEnded: false,
  },
  {
    tripId: 'jeju',
    destinationLabel: '제주',
    dateRange: '7.1~7.4',
    basesLabel: '숙소 미등록',
    daysLabel: null,
    dBadge: 'D-30',
    isEnded: false,
  },
  // bases 미도착(로딩·조회 실패) 엣지(TRIP-620 [604]) — basesLabel null 이라 숙소 칩 자체가 생략된다
  // ('숙소 미등록'을 지어내지 않음). daysLabel 도 null 이라 기간 칩 하나만 뜨는 얼굴을 눈으로 대조.
  {
    tripId: 'sokcho',
    destinationLabel: '속초',
    dateRange: '8.5~8.7',
    basesLabel: null,
    daysLabel: null,
    dBadge: 'D-60',
    isEnded: false,
  },
];

const MY_PAGE_ENDED_VMS: TripCardVM[] = [
  {
    tripId: 'jeju-past',
    destinationLabel: '제주',
    dateRange: '5.1~5.3',
    basesLabel: '숙소 2',
    daysLabel: '일정 3일',
    dBadge: null,
    isEnded: true,
  },
  {
    tripId: 'gangneung-past',
    destinationLabel: '강릉',
    dateRange: '4.18~4.20',
    basesLabel: '숙소 1',
    daysLabel: '일정 3일',
    dBadge: null,
    isEnded: true,
  },
];

// l04 등록 숙소 3행 — 등록됨(연결 여행)·미등록·좌표 미확정(토글 disabled). 화면이 순수 프레젠테이션이라
// 완성 VM 한 벌이면 세 표면을 다 본다(location 은 계약 공백이라 빈 값 — 화면이 줄을 안 그린다).
const MY_STAYS_PREVIEW_ROWS: MyStayRowVM[] = [
  {
    savedStayId: 'stay-assigned',
    name: '해운대 오션뷰',
    location: '',
    dateRangeLabel: '6.10 ~ 6.13',
    sourceLabel: 'OTA 예약',
    memoLabel: null,
    linkedTripLabel: '연결 여행 · 부산 여행',
    baseState: 'assigned',
    canAssignBase: true,
    tripId: 'busan-trip',
    baseAssignmentId: 'ba-1',
  },
  {
    savedStayId: 'stay-unassigned',
    name: '남포동 게스트하우스',
    location: '',
    dateRangeLabel: null,
    sourceLabel: '앱 저장',
    memoLabel: '예약번호 미입력',
    linkedTripLabel: '연결된 여행 없음',
    baseState: 'unassigned',
    canAssignBase: true,
    tripId: null,
    baseAssignmentId: null,
  },
  {
    savedStayId: 'stay-nocoord',
    name: '좌표 미확정 숙소',
    location: '',
    dateRangeLabel: null,
    sourceLabel: '앱 저장',
    memoLabel: null,
    linkedTripLabel: '연결된 여행 없음',
    baseState: 'unassigned',
    canAssignBase: false,
    tripId: null,
    baseAssignmentId: null,
  },
];

// l02 알림 설정(TRIP-607) — 6종 기본값(SLOT_PRE·PLAN_B 는 푸시 OFF·인앱 ON, 나머지 5종 둘 다 ON).
// default·permission-denied 두 얼굴이 이 한 벌을 공유한다(권한 게이트는 pushColumnAvailable 로 가름).
const NOTIF_PREVIEW_VALUES: ToggleValueMap = {
  STAY: { pushEnabled: true, inAppEnabled: true },
  TRIP_PRE: { pushEnabled: true, inAppEnabled: true },
  TRIP_DAY: { pushEnabled: true, inAppEnabled: true },
  SLOT_PRE: { pushEnabled: false, inAppEnabled: true },
  PLAN_B: { pushEnabled: false, inAppEnabled: true },
  REFLECTION: { pushEnabled: true, inAppEnabled: true },
};

// l03 스타일 요약 카드(TRIP-606) — 정식(칩+3축 dot 게이지+메타+상세 진입)·미달(안내 한 줄) 두 얼굴.
// dot 채움 색·빈 dot 토큰·칩 알약은 jest 사각(글리프 fill 함정)이라 이 키가 육안 대조 자리다.
// 정식 얼굴은 아래 my-page-default 프리뷰에 얹어 프로필↔세그먼트 사이 배치까지 함께 본다.
const STYLE_CARD_OFFICIAL_VM: Extract<StyleCardVM, { kind: 'official' }> = {
  kind: 'official',
  descriptors: ['#바다', '#미식', '#느긋'],
  gauges: [
    { label: '여유로움', value: 4 },
    { label: '미식 취향', value: 4 },
    { label: '활동성', value: 3 },
  ],
  sampleTripCount: 6,
  updatedAt: '2026-08-28T09:00:00Z',
};

// 탭 화면 프리뷰에 셸 탭바를 얹어 실제 앱처럼 보이게 한다(TRIP-201 오버레이 확인용).
// BottomTabBar 루트가 absolute bottom-0라 콘텐츠 위에 떠서 겹친다 — 프리뷰에서도 오버레이
// 모양이 그대로 재현된다. onPressTab은 프리뷰라 no-op(네비게이션 없음).
function withShellTabBar(
  screen: ReactElement,
  activeKey: ShellTabKey = 'home'
): ReactElement {
  return (
    <View className="flex-1">
      {screen}
      <BottomTabBar activeKey={activeKey} onPressTab={() => {}} />
    </View>
  );
}

/**
 * e05 숙소 등록(TRIP-369) — 세 표면 수정(컴팩트 앱바 · 핀 조작 안내 · 세그먼트 줄바꿈 해소)을
 * 한 화면에서 눈으로 대조하기 위한 얼굴. **핀 지정 탭 · 핀 찍기 전**(`pinAddressStatus:'idle'`)
 * 으로 세우면 셋이 모두 보인다: 상단 컴팩트 앱바(뒤로가기 글리프 + 컴팩트 타이틀) · 3탭
 * 세그먼트(가운데 "링크 붙여넣기" + "준비 중" 캡션, 잘림·높이 어긋남 없음) · 지도 아래
 * "지도를 길게 눌러 위치를 지정하세요" 안내.
 *
 * 왜 프리뷰가 필요한가: 실화면 딥링크로는 이 상태(핀 세션)를 안정적으로 못 본다 — 핀은
 * 지도 롱프레스로만 들어오고 백엔드 역지오코딩을 거친다. 화면은 무상태 프레젠테이션이라
 * `flow`만 넣으면 그대로 그려진다.
 */
const STAY_REGISTER_PREVIEW_FLOW: StayRegisterScreenProps['flow'] = {
  activeTab: 'pin',
  query: '',
  name: '',
  searchStatus: 'idle',
  candidates: [],
  selectedCandidate: null,
  coordSource: 'PIN',
  pinAddressStatus: 'idle',
  coordConfirmed: false,
  mapSheetState: 'closed',
  checkIn: null,
  checkOut: null,
  dateSheetOpen: false,
  submitStatus: 'idle',
};

/** e05 지도검색 후보를 고른 뒤의 확정 얼굴(TRIP-600) — 좌표를 가진 후보를 선택하면
 * `coordConfirmed:true`가 되어 "지도에서 위치를 확인해 주세요" 안내가 사라지고 등록이 열린다.
 * jest는 안내 소멸을 testID로, POST 본문의 `coordConfirmed`를 값으로 잠그지만, 지도 미리보기와
 * 선택적 "지도에서 위치 확인" 버튼 존치는 실기로만 본다(6-b) — 이 얼굴이 그 자리다. */
const STAY_REGISTER_CONFIRMED_FLOW: StayRegisterScreenProps['flow'] = {
  ...STAY_REGISTER_PREVIEW_FLOW,
  activeTab: 'mapsearch',
  searchStatus: 'success',
  candidates: [
    {
      name: '해운대 그랜드 호텔',
      address: '부산 해운대구 우동 1407',
      lat: 35.1587,
      lng: 129.1604,
    },
  ],
  selectedCandidate: {
    name: '해운대 그랜드 호텔',
    address: '부산 해운대구 우동 1407',
    lat: 35.1587,
    lng: 129.1604,
  },
  coordSource: 'MAP_SEARCH',
  coordConfirmed: true,
};

// h12·h18 슬롯 교체 후보(TRIP-335) — 서버 응답 3필드만(poiId·distanceRange·rationale). 이름·사진은
// 아직 안 실려(BE 후속) 카드가 플레이스홀더로 뜨는 미확보 표기를 눈으로 대조하는 자리다.
const SLOT_CANDIDATES_PREVIEW: SlotCandidatesCandidatesItem[] = [
  { poiId: 'poi-a', distanceRange: '560m', rationale: '취향에 가장 잘 맞아요' },
  {
    poiId: 'poi-b',
    distanceRange: '1.1km',
    rationale: '여유로운 페이스, 머무르기 좋아요',
  },
  {
    poiId: 'poi-c',
    distanceRange: '1.8km',
    rationale: '자연과 예술, 조금 멀어요',
  },
];

// i13 재계획안 슬롯(TRIP-563) — 배지 5종(방문함·진행중·변경됨·null·고정)·후보 어포던스·고정 pill 을
// 한 화면에서 대조하는 주입 VM. 실 슬롯 데이터(사진·번호·시간대)는 draft 계약 공백이라 VM 에 없다 —
// 배지·거리 메타·우측 어포던스만 그리는 골격을 눈으로 확인하는 자리(실 슬롯 바인딩은 BE 후속).
const REPLAN_DRAFT_PREVIEW_SLOTS: ReplanSlotVM[] = [
  {
    slotKey: 's1',
    badgeKind: 'visited',
    placeName: '감천문화마을',
    metaText: '09:30–10:50 · 사진 2장',
    candidateCount: 0,
    isFixed: false,
  },
  {
    slotKey: 's2',
    badgeKind: 'inProgress',
    placeName: '부산시립미술관',
    metaText: '13:00 도착 · 관람 중',
    candidateCount: 0,
    isFixed: false,
  },
  {
    slotKey: 's3',
    badgeKind: 'changed',
    placeName: 'F1963',
    metaText: '#실내 · 도보 1.3km',
    candidateCount: 4,
    isFixed: false,
  },
  {
    slotKey: 's4',
    badgeKind: null,
    placeName: '보수동 책방골목',
    metaText: '도보 0.6km',
    candidateCount: 2,
    isFixed: false,
  },
  {
    slotKey: 's5',
    badgeKind: 'fixed',
    placeName: '해운대 OO호텔',
    metaText: '20:00 도착 · 변경 불가',
    candidateCount: 0,
    isFixed: true,
  },
];

// e04 저장한 숙소(TRIP-461) — 카드 사진·지역·거리·가격은 계약 무라 회색 자리 + 이름·(있으면)
// 날짜만 그린다(brief §화면·IO). 실화면 딥링크로는 백엔드 401 이면 게스트 얼굴로만 떨어져
// results·empty 두 얼굴을 여기서 눈으로 대조한다(d04·d02 프리뷰 2키와 같은 사정).
const SAVED_STAY_PREVIEW_CARDS: SavedStayCardVM[] = [
  { savedStayId: 'ss-1', name: '해운대 오션 호텔', dateLabel: '6.10~6.13' },
  { savedStayId: 'ss-2', name: '광안리 뷰 호텔' },
  { savedStayId: 'ss-3', name: '감천 게스트하우스', dateLabel: '6.13~6.15' },
];

// i05 현재 장소 상세(TRIP-398) — Figma 대조용 완성 뷰. 결측 얼굴은 이 위에 상태만 얹는다.
const LIVE_PLACE_PREVIEW_VIEW: PlaceDetailView = {
  name: '광안리 해수욕장',
  category: '해변',
  tags: ['해변', '포토스팟', '야경', '이동선근처'],
  imageUrl: null,
  openingHours: '09:00~22:00 (상시 개방)',
  openingHoursMissing: false,
  hoursCaption: null,
  location: '미확인',
  slackLabel: '여유 있음 · 다음 부산시립미술관',
  arrival: '14:20 도착',
  lat: 35.15,
  lng: 129.11,
};

// i01 방문 체크(TRIP-396) — 한 타임라인에 done·active·upcoming 세 카드 상태를 동시에 세워
// [방문 완료](활성)·상태줄 "방문 중"·수동 [도착]·완료 컴팩트를 6-b 실기/육안으로 대조하는 자리.
// jest 는 픽셀·플렉스 폭을 못 봐(★ layer-features-execution) 이 키가 유일한 눈으로 보는 곳.
const LIVE_ITINERARY_PREVIEW_SLOTS: ProjectedSlot[] = [
  {
    state: 'done',
    slot: {
      poiId: 'poi-done',
      startAt: '09:30:00',
      endAt: '10:50:00',
      isFixed: false,
      endsNextDay: false,
      hasViolation: false,
      nameKo: '감천문화마을',
      distanceRange: null,
      openingHours: '09:00 - 18:00',
      tags: [],
    },
  },
  {
    state: 'active',
    slot: {
      poiId: 'poi-active',
      startAt: '13:00:00',
      endAt: '14:30:00',
      isFixed: false,
      endsNextDay: false,
      hasViolation: false,
      nameKo: '부산시립미술관',
      distanceRange: null,
      openingHours: '10:00 - 18:00',
      tags: [],
    },
  },
  {
    state: 'upcoming',
    slot: {
      poiId: 'poi-upcoming',
      startAt: '15:00:00',
      endAt: '16:30:00',
      isFixed: false,
      endsNextDay: false,
      hasViolation: false,
      nameKo: '전포 카페거리',
      distanceRange: '약 1.2km · 도보 추정',
      openingHours: '11:00 - 22:00',
      tags: [],
    },
  },
];

// i15·i22 수동 편집(TRIP-443) — A(비고정)·H(숙소 체크인 isFixed)·C(비고정, lockedSlotKeys) 3슬롯.
// aViolation 을 켜면 A 에 위반 배지가 뜬다(mode 무관 공통 축).
const MANUAL_EDIT_PREVIEW_DATE = '2026-06-11';
function manualEditPreviewDays(aViolation: boolean): ItineraryDaysItem[] {
  return [
    {
      date: MANUAL_EDIT_PREVIEW_DATE,
      slots: [
        {
          poiId: 'poi-a',
          startAt: '13:00:00',
          endAt: '14:30:00',
          isFixed: false,
          endsNextDay: false,
          hasViolation: aViolation,
          violationReason: aViolation ? '숙소 체크인과 충돌' : null,
          nameKo: '부산시립미술관',
          tags: ['전시', '실내'],
        },
        {
          poiId: 'poi-cafe',
          startAt: '15:00:00',
          endAt: '16:00:00',
          isFixed: false,
          endsNextDay: false,
          hasViolation: false,
          nameKo: '전포 카페거리',
          tags: ['카페'],
        },
        {
          poiId: 'poi-hotel',
          startAt: '17:30:00',
          endAt: '17:30:00',
          isFixed: true,
          endsNextDay: false,
          hasViolation: false,
          nameKo: '해운대 OO호텔 체크인',
          tags: [],
        },
      ],
    },
  ];
}
const MANUAL_EDIT_PREVIEW_LOCKED = [`${MANUAL_EDIT_PREVIEW_DATE}#poi-cafe`];

// i15·i22 상호작용 프리뷰(TRIP-577) — PlanbManualPage 는 react-query·라우터·서버 시드가 필요해
// QueryClient 없는 이 프리뷰에서 못 쓴다. 그래서 최소 상태(days·timeConfirmed)만 얹어 재정렬(AC-1)·
// 시각 반영(AC-3)을 눈으로 확인한다(6-b 육안 그물 — 페이지의 handleReorder/handleApplyTime 축소판).
function ManualEditPreview({ variant }: { variant?: 'error' }): ReactElement {
  const [days, setDays] = useState<ItineraryDaysItem[]>(() =>
    manualEditPreviewDays(false)
  );
  const [timeConfirmed, setTimeConfirmed] = useState<string[]>([]);
  const [editingSlotKey, setEditingSlotKey] = useState<string | null>(null);
  const activeDate = days[0]?.date ?? '';

  const editingSlot =
    editingSlotKey === null
      ? undefined
      : days
          .flatMap((day) =>
            day.slots.map((slot) => ({
              key: `${day.date}#${slot.poiId}`,
              slot,
            }))
          )
          .find((entry) => entry.key === editingSlotKey)?.slot;

  return (
    <>
      <ManualEditScreen
        variant={variant}
        days={days}
        lockedSlotKeys={MANUAL_EDIT_PREVIEW_LOCKED}
        timeConfirmedSlotKeys={timeConfirmed}
        onBack={noop}
        onSave={noop}
        onReorder={(data) =>
          setDays((prev) =>
            prev.map((day) =>
              day.date === activeDate
                ? { ...day, slots: reorderKeepingFixed(day.slots, data) }
                : day
            )
          )
        }
        onDeleteSlot={noop}
        onEditSlotTime={(slotKey) => setEditingSlotKey(slotKey)}
        onPressHistory={noop}
        onPressAddPlace={noop}
      />
      {editingSlot === undefined ? null : (
        <ManualTimeSheet
          startAt={editingSlot.startAt}
          endAt={editingSlot.endAt}
          onApply={(patch) => {
            setDays((prev) =>
              prev.map((day) => ({
                ...day,
                slots: day.slots.map((slot) =>
                  `${day.date}#${slot.poiId}` === editingSlotKey
                    ? { ...slot, ...patch }
                    : slot
                ),
              }))
            );
            if (editingSlotKey !== null) {
              setTimeConfirmed((prev) =>
                prev.includes(editingSlotKey) ? prev : [...prev, editingSlotKey]
              );
            }
            setEditingSlotKey(null);
          }}
          onCancel={() => setEditingSlotKey(null)}
        />
      )}
    </>
  );
}

// i09 감지된 변화(TRIP-562) 발화 얼굴 프리뷰 — 날씨 1건 발화. 정상 얼굴은 빈 배열을 사영한다.
const TRIGGER_WATCHLIST_PREVIEW_FIRED: Trigger[] = [
  {
    triggerId: 'preview-weather',
    kind: 'WEATHER',
    affectedDate: '2026-08-20',
    slotKey: null,
    reason: '비 예보 70%',
    scope: 'PARTIAL_SLOTS',
    detectedAt: '2026-08-20T09:00:00Z',
  },
];

// l05 취향 수정 프리뷰 픽스처 — 한국어 계약값 그대로(GET View 를 initialSelection 태운 뒤의 모양).
const SETTINGS_PREF_PREVIEW_SELECTION: PreferenceSelection = {
  styles: ['휴양', '미식'],
  activities: null,
  transportModes: ['대중교통'],
  foodTastes: ['한식'],
  pace: '균형있게',
  companionTypes: ['커플'],
  petFlag: true,
  budgetTier: '중간',
};
const SETTINGS_PREF_PREVIEW_EMPTY: PreferenceSelection = {
  styles: null,
  activities: null,
  transportModes: null,
  foodTastes: null,
  pace: null,
  companionTypes: null,
  petFlag: false,
  budgetTier: null,
};

// l01 알림함(TRIP-576) — Figma 1598:2389 의 5행(오늘 3·이전 2). 화면은 VM 만 받는 순수 뷰라
// 픽스처 한 벌로 default 를, 빈 sections + isEmpty 로 empty 를 낸다(엣지 상태 포함).
const NOTIFICATION_INBOX_PREVIEW_SECTIONS: NotificationSection[] = [
  {
    key: 'today',
    label: '오늘',
    rows: [
      {
        id: 'n1',
        icon: 'home',
        title: '○○호텔이 등록되었어요',
        body: '',
        meta: '숙소 · 방금',
        unread: true,
        route: null,
        inlineActionLabel: null,
      },
      {
        id: 'n2',
        icon: 'swap',
        title: "비 예보 — '○○공원' 일정이 영향받아요",
        body: '',
        meta: 'Plan-B · 10분 전',
        unread: true,
        route: '/trips/t1/planb',
        inlineActionLabel: '대안 일정 보기 ›',
      },
      {
        id: 'n3',
        icon: 'list',
        title: '다음 일정: ○○ · 14:30 · 840m',
        body: '',
        meta: '일정 · 1시간 전',
        unread: false,
        route: null,
        inlineActionLabel: null,
      },
    ],
  },
  {
    key: 'earlier',
    label: '이전',
    rows: [
      {
        id: 'n4',
        icon: 'document',
        title: '여행 기록이 정리되었습니다',
        body: '',
        meta: '회고 · 어제',
        unread: false,
        route: '/trips/t1/records/reflection/2026-08-29',
        inlineActionLabel: null,
      },
      {
        id: 'n5',
        icon: 'sun',
        title: '새 기기에서 로그인되었습니다',
        body: '',
        meta: '시스템 · 2일 전',
        unread: false,
        route: null,
        inlineActionLabel: null,
      },
    ],
  },
];

const PREVIEW_STATES: PreviewState[] = [
  { key: 'splash', label: '스플래시', login: null },
  {
    key: 'splash-loading',
    label: '스플래시 · 로딩',
    login: null,
    render: () => <SplashScreen loading />,
  },
  {
    key: 'login-idle',
    label: '로그인 · 평상시',
    login: { phase: 'idle', errorCode: null, conflictProvider: null },
  },
  {
    key: 'login-cancelled',
    label: '로그인 취소',
    login: { phase: 'cancelled', errorCode: null, conflictProvider: null },
  },
  {
    key: 'login-error-banner',
    label: '에러 배너',
    login: {
      phase: 'error',
      errorCode: 'SOCIAL_AUTH_FAILED',
      conflictProvider: null,
    },
  },
  {
    key: 'login-conflict-sheet',
    label: '이메일 충돌 시트',
    login: {
      phase: 'error',
      errorCode: 'SOCIAL_EMAIL_CONFLICT',
      conflictProvider: 'kakao',
    },
  },
  {
    key: 'login-age-sheet',
    label: '연령 확인 시트',
    login: { phase: 'needs-age', errorCode: null, conflictProvider: null },
  },
  {
    key: 'login-age-restriction',
    label: '연령 미달 안내',
    login: { phase: 'error', errorCode: 'AGE_NOT_MET', conflictProvider: null },
  },
  // ── 온보딩 (TRIP-162) — 순수 프레젠테이션 화면을 값으로 그린다 ──
  {
    key: 'onboarding-terms-default',
    label: '약관 · 기본',
    login: null,
    render: () => (
      <TermsScreen
        items={TERMS_ITEMS}
        allChecked={false}
        canProceed={false}
        missingRequiredLabels={['서비스 이용약관', '개인정보 처리방침']}
        errorMessage={null}
        onToggle={noop}
        onToggleAll={noop}
        onNext={noop}
        onRetry={noop}
      />
    ),
  },
  {
    key: 'onboarding-terms-agreed',
    label: '약관 · 동의완료',
    login: null,
    render: () => (
      <TermsScreen
        items={TERMS_ITEMS.map((item) => ({ ...item, checked: true }))}
        allChecked
        canProceed
        missingRequiredLabels={[]}
        errorMessage={null}
        onToggle={noop}
        onToggleAll={noop}
        onNext={noop}
        onRetry={noop}
      />
    ),
  },
  {
    key: 'onboarding-nickname-default',
    label: '닉네임 · 기본',
    login: null,
    render: () => (
      <NicknameScreen
        value="여행하는너구리"
        canProceed
        errorReason={null}
        suggestions={[]}
        onChange={noop}
        onRegenerate={noop}
        onSelectSuggestion={noop}
        onNext={noop}
        // Figma c07 default 프레임은 자동생성 프리필이 그대로 있는 긍정 상태를 보여준다
        // (Seed 확정 4 — 서버 근거가 값 그대로일 때만 참, 프리뷰는 정적이라 항상 true).
        availabilityConfirmed
      />
    ),
  },
  {
    key: 'onboarding-nickname-taken',
    label: '닉네임 · 중복오류',
    login: null,
    render: () => (
      <NicknameScreen
        value="길동"
        canProceed={false}
        errorReason="TAKEN"
        suggestions={['길동123', '여행하는길동', '길동_2']}
        onChange={noop}
        onRegenerate={noop}
        onSelectSuggestion={noop}
        onNext={noop}
      />
    ),
  },
  // 취향 1/2·2/2(TRIP-163) — 컨테이너 없이 화면 컴포넌트를 직접, 빈 선택 상태로 그린다
  // (인터뷰5 — 가드 우회가 아니라 기존 9키와 같은 "정적 프레젠테이션" 패턴 그대로).
  {
    key: 'pref1',
    label: '취향 1/2 · 기본',
    login: null,
    render: () => (
      <PrefStep1Screen
        selectedStyles={null}
        selectedPace={null}
        onToggleStyle={noop}
        onTogglePace={noop}
        onNext={noop}
        onSkipAll={noop}
      />
    ),
  },
  {
    key: 'pref2',
    label: '취향 2/2 · 기본',
    login: null,
    render: () => (
      <PrefStep2Screen
        selectedBudget={null}
        selectedCompanions={null}
        selectedActivities={null}
        selectedFoods={null}
        selectedTransports={null}
        onToggleBudget={noop}
        onToggleCompanion={noop}
        onToggleActivity={noop}
        onToggleFood={noop}
        onToggleTransport={noop}
        onBack={noop}
        onDone={noop}
        onSkipAll={noop}
      />
    ),
  },
  {
    // l05 취향 전체 수정(TRIP-610) — 화면이 자족 컨테이너(GET/PUT)라 QueryClient 없는 이 프리뷰에선
    // 순수 뷰(PreferencesEditView)에 선택 픽스처를 얹어 태운다(pref1/pref2 정적 패턴과 동형).
    key: 'settings-preferences',
    label: 'l05 취향 수정 · 기본',
    login: null,
    render: () => (
      <PreferencesEditView
        selection={SETTINGS_PREF_PREVIEW_SELECTION}
        saveError={false}
        onToggle={noop}
        onTogglePet={noop}
        onSave={noop}
        onBack={noop}
      />
    ),
  },
  {
    // 엣지: 미설정(전 축 null) + 400 저장 실패 인라인 오류(INV-4) 동시 얼굴.
    key: 'settings-preferences-error',
    label: 'l05 취향 수정 · 미설정+400',
    login: null,
    render: () => (
      <PreferencesEditView
        selection={SETTINGS_PREF_PREVIEW_EMPTY}
        saveError
        onToggle={noop}
        onTogglePet={noop}
        onSave={noop}
        onBack={noop}
      />
    ),
  },
  {
    key: 'onboarding-location-default',
    label: '위치 · 프리프롬프트',
    login: null,
    render: () => (
      // c08 이 온보딩 체인에서 실제로 주입하는 Figma 목적 문구(TRIP-459) — 프리뷰도 정본과 맞춘다.
      <LocationPreprompt
        purposeContext="내 주변을 알면 더 잘 맞는 곳을 추천하고 길 안내도 막힘없이 이어져요"
        state="default"
        onProceed={noop}
        onDefer={noop}
        onOpenSettings={noop}
      />
    ),
  },
  {
    key: 'onboarding-location-denied',
    label: '위치 · 거부',
    login: null,
    render: () => (
      // onDismissNotice 를 주면 안내 줄에 닫기(×)가 그려진다(TRIP-592). 프리뷰는 정적이라
      // 실제로 숨겨지진 않지만 × 버튼 자체를 눈으로 확인할 수 있다.
      <LocationPreprompt
        purposeContext="내 주변 숙소 탐색"
        state="permission-denied"
        onProceed={noop}
        onDefer={noop}
        onOpenSettings={noop}
        onDismissNotice={noop}
      />
    ),
  },
  {
    key: 'onboarding-location-denied-dismissed',
    label: '위치 · 거부(안내 닫힘)',
    login: null,
    render: () => (
      // 1회성 닫기 후 상태 — 안내 줄이 사라지고 denied 프레임(계속·설정)만 남는다(TRIP-592).
      <LocationPreprompt
        purposeContext="내 주변 숙소 탐색"
        state="permission-denied"
        onProceed={noop}
        onDefer={noop}
        onOpenSettings={noop}
        noticeDismissed
      />
    ),
  },
  // ── e00·d1b 지역 선택 4키(TRIP-183) — 컨테이너 없이 화면에 props를 직접 넣는다 ──
  // ⚠️ 프리뷰는 정적이라 **실제 OS 권한 다이얼로그는 뜨지 않는다.** 여기서 보는 것은
  //    "권한이 거부됐을 때 화면이 어떻게 생겼나"까지고, 다이얼로그 자체는 실제 라우트
  //    (`/explore/region`)에서 '내 주변'을 눌러야 확인된다. 둘은 다른 확인이다.
  // ⚠️ TRIP-597 드릴다운 2단(시/도 상세)은 **화면 로컬 state**라 정적 prop으로 못 연다 — 이
  //    프리뷰에서 시/도 행(인천·서울·강원·충북 등)을 **직접 눌러** 상세로 들어가 확인한다
  //    (엣지 표본은 `PREVIEW_REGIONS` 주석 참조: 인천 happy path·강원 sido=null·충북 묶음).
  {
    key: 'stay-region-default',
    label: '지역 선택 · 숙소',
    login: null,
    render: () => (
      <RegionPickerScreen
        purpose="stay"
        query=""
        regions={PREVIEW_REGIONS}
        isLoading={false}
        isError={false}
        onChangeQuery={noop}
        onSelectRegion={noop}
        onRetry={noop}
        onBack={noop}
      />
    ),
  },
  {
    key: 'stay-region-trip',
    label: '지역 선택 · 여행지',
    login: null,
    render: () => (
      // BR-U1-07 확인용 — 같은 컴포넌트에서 카피만 바뀌고 '내 주변'이 사라진다
      <RegionPickerScreen
        purpose="trip"
        query=""
        regions={PREVIEW_REGIONS}
        isLoading={false}
        isError={false}
        onChangeQuery={noop}
        onSelectRegion={noop}
        onRetry={noop}
        onBack={noop}
      />
    ),
  },
  // e05 숙소 등록(TRIP-369) — 세 표면 수정을 한 화면에서 대조(핀 탭·핀 찍기 전).
  {
    key: 'stay-register-pin',
    label: '숙소 등록 · 핀 지정',
    login: null,
    render: () => (
      <StayRegisterScreen
        flow={STAY_REGISTER_PREVIEW_FLOW}
        today="2026-06-15"
        onBack={noop}
        onSelectTab={noop}
        onChangeQuery={noop}
        onChangeName={noop}
        onSubmitQuery={noop}
        onRetrySearch={noop}
        onSelectCandidate={noop}
        onPinMessage={noop}
        onOpenMapSheet={noop}
        onConfirmCoord={noop}
        onCloseMapSheet={noop}
        onOpenDateSheet={noop}
        onPickDate={noop}
        onCloseDateSheet={noop}
        onSubmit={noop}
      />
    ),
  },
  // e05 숙소 등록 달력(TRIP-390) — 선택 피드백·범위 하이라이트·여행 기간 상·하한을 눈으로 보는
  // 자리. jest는 바텀시트 실개폐·셀 하이라이트 픽셀을 못 본다(repo-traps 바텀시트 통과 목, AC-8)
  // — 이 화면이 그 셋을 실기로 확인하는 유일한 자리다. 체크인 17·체크아웃 19가 끝점(bg-primary),
  // 18이 범위(bg-primary-pale)로 그려지고, 여행 기간 밖(16 이전·22 이후)은 회색 disabled다.
  {
    key: 'stay-register-calendar',
    label: '숙소 등록 · 달력 범위',
    login: null,
    render: () => (
      <StayRegisterScreen
        flow={{
          ...STAY_REGISTER_PREVIEW_FLOW,
          activeTab: 'mapsearch',
          checkIn: '2026-06-17',
          checkOut: '2026-06-19',
          dateSheetOpen: true,
        }}
        today="2026-06-15"
        minDate="2026-06-16"
        maxDate="2026-06-22"
        onBack={noop}
        onSelectTab={noop}
        onChangeQuery={noop}
        onChangeName={noop}
        onSubmitQuery={noop}
        onRetrySearch={noop}
        onSelectCandidate={noop}
        onPinMessage={noop}
        onOpenMapSheet={noop}
        onConfirmCoord={noop}
        onCloseMapSheet={noop}
        onOpenDateSheet={noop}
        onPickDate={noop}
        onCloseDateSheet={noop}
        onSubmit={noop}
      />
    ),
  },
  // e05 숙소 등록(TRIP-600) — 좌표 있는 후보를 고른 뒤의 확정 얼굴. "지도에서 위치를 확인해
  // 주세요" 안내가 사라지고 등록이 열리는 것(선택만으로)을 눈으로 대조한다. jest는 안내 소멸을
  // testID로 잡지만, 지도 미리보기·선택적 "지도에서 위치 확인" 버튼 존치는 실기로만 본다.
  {
    key: 'stay-register-confirmed',
    label: '숙소 등록 · 후보 확정',
    login: null,
    render: () => (
      <StayRegisterScreen
        flow={STAY_REGISTER_CONFIRMED_FLOW}
        today="2026-06-15"
        onBack={noop}
        onSelectTab={noop}
        onChangeQuery={noop}
        onChangeName={noop}
        onSubmitQuery={noop}
        onRetrySearch={noop}
        onSelectCandidate={noop}
        onPinMessage={noop}
        onOpenMapSheet={noop}
        onConfirmCoord={noop}
        onCloseMapSheet={noop}
        onOpenDateSheet={noop}
        onPickDate={noop}
        onCloseDateSheet={noop}
        onSubmit={noop}
      />
    ),
  },
  // e02 저장 하트(TRIP-417) — s1 은 담김(찬 하트 분홍), s2 는 대기(disabled), s3 은 빈 하트.
  // jest 는 색을 못 봐(AC-V1) 이 진입점이 분홍 채움을 눈으로 확인하는 유일한 자리다.
  {
    key: 'stay-search-saved',
    label: '숙소 검색 · 저장 하트',
    login: null,
    render: () => (
      <StaySearchScreen
        region="부산"
        items={STAY_SEARCH_PREVIEW_ITEMS}
        savedKeys={['NAVER:s1']}
        pendingKeys={['NAVER:s2']}
        onToggleSave={noop}
      />
    ),
  },
  // e03 숙소 상세(TRIP-457) — 몰입 화면(탭바 없음). default 는 편의시설 4칩·가격·미니맵·CTA 2종.
  {
    key: 'stay-detail-default',
    label: '숙소 상세 · 기본(e03)',
    login: null,
    render: () => (
      <StayDetailScreen
        item={STAY_DETAIL_PREVIEW_ITEM}
        saved={false}
        onToggleSave={noop}
        onPressBook={noop}
        onPressAddToTrip={noop}
        onPressBack={noop}
      />
    ),
  },
  // 담김(찬 하트 분홍) + "일정에 추가" 안내 표시 + 편의시설 결측("미확인") 엣지를 한 화면에.
  {
    key: 'stay-detail-saved',
    label: '숙소 상세 · 담김+안내+편의시설 결측',
    login: null,
    render: () => (
      <StayDetailScreen
        item={{ ...STAY_DETAIL_PREVIEW_ITEM, amenities: [] }}
        saved={true}
        addedNotice={true}
        onToggleSave={noop}
        onPressBook={noop}
        onPressAddToTrip={noop}
        onPressBack={noop}
      />
    ),
  },
  // 파싱 실패/부재 얼굴(INV-4) — item=null.
  {
    key: 'stay-detail-notfound',
    label: '숙소 상세 · 불러오기 실패(notFound)',
    login: null,
    render: () => (
      <StayDetailScreen
        item={null}
        saved={false}
        onToggleSave={noop}
        onPressBook={noop}
        onPressAddToTrip={noop}
      />
    ),
  },
  // 제휴 고지 시트(BR-U1-30) — book press 시 뜨는 시트. gorhom 이라 실 슬라이드는 실기 몫.
  {
    key: 'stay-ota-sheet',
    label: '제휴 고지 시트 · e03(TRIP-457)',
    login: null,
    render: () => (
      <View className="flex-1 justify-end bg-scrim/40">
        <OtaChoiceSheet
          item={STAY_DETAIL_PREVIEW_ITEM}
          onCancel={noop}
          onConfirm={noop}
        />
      </View>
    ),
  },
  // e02 가격대 필터 시트(TRIP-457) — 프리셋 버킷 4개 라디오.
  {
    key: 'stay-price-sheet',
    label: '가격대 필터 시트 · e02(TRIP-457)',
    login: null,
    render: () => (
      <View className="flex-1 justify-end bg-scrim/40">
        <StayPriceSheet selected="all" onSelect={noop} onClose={noop} />
      </View>
    ),
  },
  // ── 홈 대시보드 4상태(TRIP-170) — 프레젠테이션 전용, 고정 픽스처로 그린다 ──
  {
    key: 'home-default',
    label: '홈 · 기본',
    login: null,
    render: () => withShellTabBar(<HomeScreen {...HOME_DEFAULT_PROPS} />),
  },
  {
    key: 'home-no-trip',
    label: '홈 · 첫 사용자',
    login: null,
    render: () => withShellTabBar(<HomeScreen {...HOME_NO_TRIP_PROPS} />),
  },
  {
    key: 'home-empty',
    label: '홈 · 취향 부족',
    login: null,
    render: () => withShellTabBar(<HomeScreen {...HOME_EMPTY_PROPS} />),
  },
  {
    key: 'home-loading',
    label: '홈 · 로딩',
    login: null,
    render: () => withShellTabBar(<HomeScreen {...HOME_LOADING_PROPS} />),
  },
  // ── 홈 여행 단계 얼굴 4종(TRIP-317) — 실기 판정 전용 진입점 ──
  {
    key: 'home-collecting',
    label: '홈 · 담는 중',
    login: null,
    render: () => withShellTabBar(<HomeScreen {...HOME_COLLECTING_PROPS} />),
  },
  {
    key: 'home-planning',
    label: '홈 · 계획 중',
    login: null,
    render: () => withShellTabBar(<HomeScreen {...HOME_PLANNING_PROPS} />),
  },
  {
    key: 'home-upcoming',
    label: '홈 · 출발 전',
    login: null,
    render: () => withShellTabBar(<HomeScreen {...HOME_UPCOMING_PROPS} />),
  },
  {
    key: 'home-post-trip',
    label: '홈 · 여행 후',
    login: null,
    render: () => withShellTabBar(<HomeScreen {...HOME_POST_TRIP_PROPS} />),
  },
  // 지도 계층 선행(TRIP-197 D9) — 층 C(실기) 진입점. 키/로드 실패 분기는 렌더 안 해봐야
  // 알 수 없어 여기서는 해피패스 1키만 둔다(env 키는 빌드 시 번들에 인라인되므로 preview가
  // 런타임에 비울 수 없다 — 실패 분기는 KakaoMapView.test.tsx가, C-2는 .env를 실제로 비우고
  // 재기동해 확인한다).
  {
    key: 'map-default',
    label: '지도 · 기본',
    login: null,
    render: () => <KakaoMapView center={{ lat: 37.5665, lng: 126.978 }} />,
  },
  {
    key: 'records-default',
    label: 'j01 방문 기록 · default',
    login: null,
    render: () => (
      <TripRecordsScreen
        dayTabs={[
          { day: '2026-08-20', label: 'Day1' },
          { day: '2026-08-21', label: 'Day2' },
          { day: '2026-08-22', label: 'Day3' },
        ]}
        activeDay="2026-08-21"
        onSelectDay={noop}
        attribution={{ stayName: '해운대 그랜드 호텔', dayLabel: '2일차' }}
        mapCenter={{ lat: 35.1532, lng: 129.1187 }}
        mapPins={[
          { number: 1, lat: 35.1532, lng: 129.1187 },
          { number: 2, lat: 35.1264, lng: 129.0403 },
        ]}
        cards={[
          {
            visitCheckId: 'r1',
            slotKey: '2026-08-21#p1',
            poiId: 'p1',
            nameKo: '광안리 해변',
            arrivedAt: '2026-08-21T14:20:00',
            completedAt: '2026-08-21T15:20:00',
            skippedAt: null,
            arrivedLabel: '14:20',
          },
          {
            visitCheckId: 'r2',
            slotKey: '2026-08-21#p2',
            poiId: 'p2',
            nameKo: '부산시립미술관',
            arrivedAt: '2026-08-21T15:40:00',
            completedAt: null,
            skippedAt: null,
            arrivedLabel: '15:40',
          },
          {
            visitCheckId: 'r3',
            slotKey: '2026-08-21#p3',
            poiId: 'p3',
            nameKo: '○○ 카페',
            arrivedAt: null,
            completedAt: null,
            skippedAt: null,
            arrivedLabel: null,
          },
          {
            visitCheckId: 'r4',
            slotKey: '2026-08-21#p4',
            poiId: 'p4',
            nameKo: '건너뛴 전망대',
            arrivedAt: '2026-08-21T16:10:00',
            completedAt: null,
            skippedAt: '2026-08-21T16:12:00',
            arrivedLabel: '16:10',
          },
        ]}
        onPressComplete={noop}
        onPressSkip={noop}
        onPressSpontaneous={noop}
        onPressBack={noop}
        onPressTab={noop}
      />
    ),
  },
  // j01 방문 기록 · 숙소 없는 날(당일치기·이동일, TRIP-569) — 귀속 헤더가 `-stay` 가 아니라
  // `-date`(날짜만)로 갈리는 엣지. 헤더 testID 분기를 육안 대조하는 자리(jest 는 testID 존재만,
  // 실제 배치는 6-b 실기).
  {
    key: 'records-attribution-dateonly',
    label: 'j01 방문 기록 · 숙소 없는 날(날짜만 귀속)',
    login: null,
    render: () => (
      <TripRecordsScreen
        dayTabs={[
          { day: '2026-08-20', label: 'Day1' },
          { day: '2026-08-21', label: 'Day2' },
        ]}
        activeDay="2026-08-21"
        onSelectDay={noop}
        attribution={{ stayName: null, dayLabel: '2일차' }}
        mapCenter={{ lat: 37.5665, lng: 126.978 }}
        mapPins={[]}
        cards={[
          {
            visitCheckId: 'd1',
            slotKey: '2026-08-21#p1',
            poiId: 'p1',
            nameKo: '경복궁',
            arrivedAt: '2026-08-21T10:10:00',
            completedAt: '2026-08-21T11:20:00',
            skippedAt: null,
            arrivedLabel: '10:10',
          },
        ]}
        onPressComplete={noop}
        onPressSkip={noop}
        onPressSpontaneous={noop}
        onPressBack={noop}
        onPressTab={noop}
      />
    ),
  },
  // j01 방문 시각 수정 시트(TRIP-613) — 셀-press 시각 편집. 통과형 목이라 정적 프리뷰도 실제 열림/
  // 딤은 못 본다(6-b 실기 전용) — 셀 트리·도착/완료 컬럼·저장/취소 레이아웃 육안 대조 자리.
  {
    key: 'records-visit-time-sheet',
    label: 'j01 방문 시각 수정 시트 · 도착·완료',
    login: null,
    render: () => (
      <View className="flex-1">
        <VisitTimeSheet
          visitCheckId="r1"
          arrivedAt="2026-08-21T14:20:00"
          completedAt="2026-08-21T15:20:00"
          now="2026-08-21T20:00:00"
          onSave={noop}
          onCancel={noop}
        />
      </View>
    ),
  },
  {
    // 엣지 — 도착 없는 방문: 완료 컬럼이 비활성(opacity-40 + accessibilityState.disabled).
    key: 'records-visit-time-sheet-no-arrival',
    label: 'j01 방문 시각 수정 시트 · 도착 없음(완료 비활성)',
    login: null,
    render: () => (
      <View className="flex-1">
        <VisitTimeSheet
          visitCheckId="r3"
          arrivedAt={null}
          completedAt={null}
          now="2026-08-21T20:00:00"
          onSave={noop}
          onCancel={noop}
        />
      </View>
    ),
  },
  // j01 오프라인 동기화 배지(TRIP-568) — 4상태를 3표기(대기/완료/충돌)로 접는 배지의 색·모양을
  // 한 화면에서 육안 대조하는 자리(pill 색·글자 톤은 jest 사각 — repo-traps 글리프 함정 계열).
  {
    key: 'records-sync-badge',
    label: 'j01 동기화 배지 · 4상태',
    login: null,
    render: () => (
      <View className="flex-1 gap-md bg-canvas px-lg pt-[80px]">
        {(['LOCAL', 'PENDING', 'SYNCED', 'CONFLICT'] as const).map((status) => (
          <View key={status} className="flex-row items-center gap-md">
            <Text className="w-[80px] text-label text-muted-soft">
              {status}
            </Text>
            <SyncBadge status={status} />
          </View>
        ))}
      </View>
    ),
  },
  // j01 동기화 충돌 해소(TRIP-568) — 전체화면 조건부 렌더 뷰(바텀시트 아님). 방문 2건을 카드 2장
  // 으로 그려 2열 라디오·미선택 시작·적용 비활성/활성을 실기로 눌러 본다. card1=시각 축, card2=
  // 상태 축(Figma 카드별 3필드). 선택 상태는 accessibilityState 로 잠기고 색은 무심판이라 이 키가
  // 채움/테두리 강조를 눈으로 대조하는 유일한 자리(자율 세션 — 6-b 실기는 다음 세션 몫).
  {
    key: 'records-conflict',
    label: 'j01 동기화 충돌 해소 · 2건',
    login: null,
    render: () => (
      <ConflictSheet
        conflicts={[
          {
            visitCheckId: 'v1',
            nameKo: '광안리 해변',
            rows: [
              { label: '방문 시각', local: '14:20 체크', server: '14:05 체크' },
              { label: '메모', local: '노을 최고', server: '-' },
              { label: '사진', local: '2장(대기)', server: '1장' },
            ],
          },
          {
            visitCheckId: 'v2',
            nameKo: '부산시립미술관',
            rows: [
              { label: '방문 상태', local: '방문 완료', server: '방문 안 함' },
              { label: '메모', local: '-', server: '-' },
              { label: '사진', local: '0장', server: '0장' },
            ],
          },
        ]}
        onApply={noop}
      />
    ),
  },
  // j01 사진·메모 첨부(TRIP-566) — PhotoThumbStrip 상태별 셀(available/other-device/unavailable)과 `+`
  // 추가 타일, MemoInline(낙관값·placeholder) 두 벌을 한 화면에서 육안 대조한다. 순수 뷰(`@/shared/api`
  // 값 import 0)라 프리뷰 지뢰 목 통과. ★네이티브 피커 미설치라 available 셀은 uri:null placeholder(실
  // 썸네일·간격·EXIF 는 이 세션 검증 불가, 후속 티켓·6-b 몫). 상태 셀·문구는 jest 가 잠그고, 픽셀은 여기.
  {
    key: 'records-photo-memo',
    label: 'j01 사진·메모 첨부 · 상태별',
    login: null,
    render: () => (
      <View className="flex-1 gap-md bg-canvas px-lg pt-[80px]">
        <PhotoThumbStrip
          photos={[
            { visitPhotoMetaId: 'ph-a', availability: 'available', uri: null },
            {
              visitPhotoMetaId: 'ph-b',
              availability: 'other-device',
              uri: null,
            },
            {
              visitPhotoMetaId: 'ph-c',
              availability: 'unavailable',
              uri: null,
            },
          ]}
          onPressAdd={noop}
        />
        <MemoInline text="바람이 좋았고 노을이 근사했다" onSubmit={noop} />
        <MemoInline onSubmit={noop} />
      </View>
    ),
  },
  // j03 오늘의 회고 4얼굴(TRIP-571) — 순수 뷰(`DailyReflectionScreen`)를 격리 렌더한다(`@/shared/api`
  // 값 import 0 이라 프리뷰 지뢰 목 통과). jest 는 testID·행동만 잠그고 4상태 레이아웃·코랄 토큰·
  // 플레이스홀더 카드·error 재시도 카드·편집 입력은 픽셀이라 6-b/육안 몫 — 자율/야간이라 6-b SKIP,
  // 이 4키가 유일한 육안 대조 자리. `editableText` 를 주면 편집 진입(헤더 "편집"/CTA "직접 회고 작성")
  // → 입력(상한 4000)·저장/취소를 실기로 눌러 본다.
  {
    key: 'reflection-default',
    label: 'j03 오늘의 회고 · default',
    login: null,
    render: () => (
      <DailyReflectionScreen
        face="default"
        narrative="오늘은 광안리와 미술관 등 4곳을 방문했어요. 12km를 이동했고 사진 6장을 남겼어요."
        editableText="오늘은 광안리와 미술관 등 4곳을 방문했어요. 12km를 이동했고 사진 6장을 남겼어요."
        stats={{
          visitCount: 4,
          distanceKm: 12,
          distanceSource: 'VISIT_LINE',
          photoCount: 6,
        }}
        distanceDash={false}
        mapNotice={null}
        hidePhotoGrid={false}
        photos={[
          { uri: 'file://p1.jpg' },
          { uri: 'file://p2.jpg' },
          { uri: 'file://p3.jpg' },
        ]}
        changeSummary="이날 휴무로 1곳을 변경했어요"
        mapCenter={{ lat: 35.1532, lng: 129.1187 }}
        mapPins={[
          { number: 1, lat: 35.1532, lng: 129.1187 },
          { number: 2, lat: 35.1264, lng: 129.0403 },
        ]}
        onEnterEdit={noop}
        onConfirm={noop}
        onSaveEdit={noop}
      />
    ),
  },
  {
    // 부분 데이터 — 방문<2(거리 "—" + 지도 자리 사유) · 사진 0장("사진 없음" 자리). BR-U5-34 실증.
    key: 'reflection-data-insufficient',
    label: 'j03 오늘의 회고 · 데이터 부족',
    login: null,
    render: () => (
      <DailyReflectionScreen
        face="data-insufficient"
        narrative="메모를 기반으로 오늘 기록을 정리했어요. 위치·사진 정보가 부족해 일부 항목은 제외했어요."
        editableText="메모를 기반으로 오늘 기록을 정리했어요."
        stats={{
          visitCount: 2,
          distanceKm: 0,
          distanceSource: 'VISIT_LINE',
          photoCount: 0,
        }}
        distanceDash
        mapNotice="위치 기록 없음 · GPS 미동으로 지도를 만들 수 없어요"
        hidePhotoGrid
        photos={[]}
        onEnterEdit={noop}
        onConfirm={noop}
        onSaveEdit={noop}
      />
    ),
  },
  {
    // empty — 기록 없음: 빈 원 일러스트 + CTA "직접 회고 작성"(누르면 편집 입력이 열린다).
    key: 'reflection-empty',
    label: 'j03 오늘의 회고 · empty',
    login: null,
    render: () => (
      <DailyReflectionScreen
        face="empty"
        narrative="방문 0곳 · 이동 0km · 사진 0장의 하루였어요."
        editableText=""
        stats={{
          visitCount: 0,
          distanceKm: 0,
          distanceSource: 'VISIT_LINE',
          photoCount: 0,
        }}
        distanceDash
        mapNotice={null}
        hidePhotoGrid
        photos={[]}
        onEnterEdit={noop}
        onConfirm={noop}
        onSaveEdit={noop}
      />
    ),
  },
  {
    // error — 회고 조회 실패: stats 는 채움(BASIC 카드, INV-U5-07) + 에러 카드(다시 시도) + CTA.
    key: 'reflection-error',
    label: 'j03 오늘의 회고 · error',
    login: null,
    render: () => (
      <DailyReflectionScreen
        face="error"
        narrative="방문 4곳 · 이동 12km · 사진 6장의 하루였어요."
        editableText=""
        stats={{
          visitCount: 4,
          distanceKm: 12,
          distanceSource: 'VISIT_LINE',
          photoCount: 6,
        }}
        distanceDash={false}
        mapNotice={null}
        hidePhotoGrid
        photos={[]}
        onEnterEdit={noop}
        onConfirm={noop}
        onSaveEdit={noop}
      />
    ),
  },
  // j04 여행 요약 3키(TRIP-572) — 순수 뷰(`TripSummaryScreen`)를 격리 렌더한다(`@/shared/api` 값
  // import 0 이라 프리뷰 지뢰 목 통과, 컨테이너를 별 파일로 분리해 import 사슬 전이 로드 없음).
  // jest 는 testID·행동만 잠그고 stats 3셀·지도 히어로·날짜카드·방문목록 레이아웃·코랄 토큰·공유
  // 비활성 톤은 픽셀이라 6-b/육안 몫 — 자율/야간이라 6-b SKIP, 이 3키가 유일한 육안 대조 자리.
  {
    // default(MAP) — stats 3셀 + 지도 히어로(좌표 주입) + 날짜카드 3장. 실화면은 좌표 계약 부재라 늘
    // map-pending 으로 접히므로(share-off 키 참고) MAP 히어로 자체는 이 키가 유일한 대조 자리.
    key: 'trip-summary-map',
    label: 'j04 여행 요약 · default(MAP)',
    login: null,
    render: () => (
      <TripSummaryScreen
        stats={{ totalVisits: 12, distanceText: '38km', totalPhotos: 24 }}
        distanceSourceLabel="근사"
        view="MAP"
        mapCenter={{ lat: 35.1531, lng: 129.1187 }}
        mapPins={[
          { number: 1, lat: 35.1531, lng: 129.1187 },
          { number: 2, lat: 35.1264, lng: 129.0403 },
          { number: 3, lat: 35.1587, lng: 129.1604 },
        ]}
        dayCards={[
          {
            key: '2026-06-11',
            dateLabel: '6월 11일 목요일',
            countLabel: 'Day1 · 5곳',
            subtitle: '광안리 해변→감천문화마을',
          },
          {
            key: '2026-06-12',
            dateLabel: '6월 12일 금요일',
            countLabel: 'Day2 · 4곳',
            subtitle: '해운대 해변→전포 카페거리',
          },
          {
            key: '2026-06-13',
            dateLabel: '6월 13일 토요일',
            countLabel: 'Day3 · 3곳',
            subtitle: '감천문화마을',
          },
        ]}
        orderedVisits={[]}
        shareEnabled
        onShare={noop}
        onBack={noop}
      />
    ),
  },
  {
    // 위치 전무(VISIT_LIST) — 거리 셀 "—" + 지도 대신 순서 방문 목록(BR-U5-39). 날짜카드 없음.
    key: 'trip-summary-visit-list',
    label: 'j04 여행 요약 · 위치 전무(방문 목록)',
    login: null,
    render: () => (
      <TripSummaryScreen
        stats={{ totalVisits: 12, distanceText: '—', totalPhotos: 24 }}
        distanceSourceLabel="근사"
        view="VISIT_LIST"
        dayCards={[]}
        orderedVisits={[
          { order: 1, dayLabel: 'Day1', place: '광안리 해변' },
          { order: 2, dayLabel: 'Day1', place: '감천문화마을' },
          { order: 3, dayLabel: 'Day2', place: '해운대 해변' },
          { order: 4, dayLabel: 'Day3', place: '전포 카페거리' },
        ]}
        shareEnabled
        onShare={noop}
        onBack={noop}
      />
    ),
  },
  {
    // 엣지 — 공유 비활성(ready:false → shareEnabled:false) + 좌표 미주입 → map-pending 자리표시.
    // 두 엣지(비활성 공유 · 지도 준비 중)를 한 화면에서 대조한다(실화면 MAP 의 실제 런타임 얼굴).
    key: 'trip-summary-share-off',
    label: 'j04 여행 요약 · 공유 비활성·지도 준비 중',
    login: null,
    render: () => (
      <TripSummaryScreen
        stats={{ totalVisits: 12, distanceText: '38km', totalPhotos: 24 }}
        distanceSourceLabel="근사"
        view="MAP"
        dayCards={[
          {
            key: '2026-06-11',
            dateLabel: '6월 11일 목요일',
            countLabel: 'Day1 · 5곳',
            subtitle: '광안리 해변→감천문화마을',
          },
        ]}
        orderedVisits={[]}
        shareEnabled={false}
        onShare={noop}
        onBack={noop}
      />
    ),
  },
  // j06 공유 카드 2키(TRIP-574) — 순수 뷰(`ShareCardScreen`)를 격리 렌더한다(`@/shared/api` 값 import 0
  // 이라 프리뷰 지뢰 목 통과 — 컨테이너 `ShareCardPage` 는 별 파일이라 import 사슬 전이 로드 없음).
  // 라이브 지도·view-shot 미설치라 카드는 지도 없이 동선 목록·워터마크·하단 그라디언트로 degrade 조립.
  // 저장/공유 press 는 armed:false → "준비 중" 안내만(가짜 성공 금지). 포맷 전환(aspect)·워터마크·그라디언트
  // 오버레이 정렬·no-photo 안내 레이아웃은 픽셀이라 6-b/육안 몫 — 자율/야간이라 6-b SKIP, 이 2키가 유일한
  // 육안 대조 자리(포맷 세그를 눌러 9:16→1:1→4:5 종횡비가 바뀌는 것도 여기서 확인).
  {
    key: 'share-card-default',
    label: 'j06 공유 카드 · default(사진 있음)',
    login: null,
    render: () => (
      <ShareCardScreen
        card={{
          title: '부산 여행',
          periodText: '6월 10일 수요일 ~ 6월 12일 금요일',
          regionText: '부산 · 경주',
          statsCells: {
            totalVisits: 12,
            distanceText: '38km',
            totalPhotos: 24,
          },
          distanceSourceLabel: '근사',
          orderedVisits: [
            { order: 1, dayLabel: 'Day1', place: '광안리 해변' },
            { order: 2, dayLabel: 'Day1', place: '감천문화마을' },
            { order: 3, dayLabel: 'Day2', place: '해운대 해변' },
            { order: 4, dayLabel: 'Day2', place: '전포 카페거리' },
          ],
          mode: 'default',
          watermark: 'TripPilot',
          aspectRatio: 9 / 16,
        }}
        formats={SHARE_FORMATS}
        caption="광안리에서 보낸 사흘, 그리고 경주의 밤"
        hashtagText="#부산여행 #광안리 #감천문화마을"
        onBack={noop}
      />
    ),
  },
  {
    key: 'share-card-no-photo',
    label: 'j06 공유 카드 · no-photo(사진 없음)',
    login: null,
    render: () => (
      <ShareCardScreen
        card={{
          title: '경주 여행',
          periodText: '6월 1일 월요일 ~ 6월 3일 수요일',
          regionText: '경주',
          statsCells: { totalVisits: 9, distanceText: '22km', totalPhotos: 0 },
          distanceSourceLabel: '근사',
          orderedVisits: [
            { order: 1, dayLabel: 'Day1', place: '불국사' },
            { order: 2, dayLabel: 'Day1', place: '석굴암' },
            { order: 3, dayLabel: 'Day2', place: '첨성대' },
          ],
          mode: 'no-photo',
          watermark: 'TripPilot',
          aspectRatio: 9 / 16,
        }}
        formats={SHARE_FORMATS}
        caption="사진은 없지만 동선만으로도 충분한 사흘"
        hashtagText="#경주여행 #불국사"
        onBack={noop}
      />
    ),
  },
  // 탐색 2키(TRIP-221·223) — **results 얼굴 전용**이다. 실화면 딥링크로는 볼 수 없다:
  // 백엔드가 401 이면 d04 는 항상 error, 세션이 없으면 d02 는 항상 게스트 안내로 떨어진다.
  // 나머지 얼굴(loading·empty·filter-zero·error·게스트)은 실화면에서 그대로 재현되므로
  // 여기 키를 늘리지 않는다.
  {
    key: 'places-results',
    label: '장소 탐색 · 결과',
    login: null,
    render: () => (
      <PlaceExploreScreen
        places={PREVIEW_PLACES}
        savedPoiIds={PREVIEW_SAVED_POI_IDS}
        selectedCategory={null}
        searchText=""
        onSelectCategory={noop}
        onChangeSearchText={noop}
        onToggleSave={noop}
        onPressCreateTrip={noop}
      />
    ),
  },
  {
    key: 'saved-places-results',
    label: '담은 장소 · 결과',
    login: null,
    render: () => (
      <SavedPlaceListScreen
        savedPlaces={PREVIEW_SAVED_PLACES}
        onPressRemove={noop}
        onPressCreateTrip={noop}
        onPressBrowse={noop}
      />
    ),
  },
  // TRIP-394 — 해제(빈 하트) 엣지 상태. sp-1(p-2)·sp-3(p-7)만 released 로 빈 하트가 되고,
  // 나머지는 찬 하트로 남는다(같은 목록에서 빈/찬을 대조). jest 는 색을 못 봐 실기 전용 자리.
  {
    key: 'saved-places-released',
    label: '담은 장소 · 해제(빈 하트)',
    login: null,
    render: () => (
      <SavedPlaceListScreen
        savedPlaces={PREVIEW_SAVED_PLACES}
        releasedPoiIds={['p-2', 'p-7']}
        onPressRemove={noop}
        onPressRestore={noop}
        onPressCreateTrip={noop}
        onPressBrowse={noop}
      />
    ),
  },
  // d01 탐색 랜딩(TRIP-201) — 3얼굴: 담은 곳 CTA / 담은 곳 0 안내 / 숙소 레인 실패 재시도.
  {
    key: 'explore-landing-default',
    label: '탐색 랜딩 · 담은 곳 CTA',
    login: null,
    render: () => (
      <ExploreLandingScreen
        {...EXPLORE_LANDING_BASE}
        stayLane={{
          error: false,
          cards: EXPLORE_STAY_CARDS,
          onRetry: noop,
          onSeeAll: noop,
        }}
        savedMenu={{
          open: true,
          savedCount: 3,
          onToggle: noop,
          onPressSavedPlaces: noop,
          onPressSavedStays: noop,
        }}
      />
    ),
  },
  {
    key: 'explore-landing-empty-bridge',
    label: '탐색 랜딩 · 담은 곳 0',
    login: null,
    render: () => (
      <ExploreLandingScreen
        {...EXPLORE_LANDING_BASE}
        stayLane={{
          error: false,
          cards: EXPLORE_STAY_CARDS,
          onRetry: noop,
          onSeeAll: noop,
        }}
        savedMenu={{
          open: false,
          savedCount: 0,
          onToggle: noop,
          onPressSavedPlaces: noop,
          onPressSavedStays: noop,
        }}
      />
    ),
  },
  {
    key: 'explore-landing-stay-error',
    label: '탐색 랜딩 · 숙소 레인 실패',
    login: null,
    render: () => (
      <ExploreLandingScreen
        {...EXPLORE_LANDING_BASE}
        stayLane={{ error: true, cards: [], onRetry: noop, onSeeAll: noop }}
        savedMenu={{
          open: false,
          savedCount: 2,
          onToggle: noop,
          onPressSavedPlaces: noop,
          onPressSavedStays: noop,
        }}
      />
    ),
  },
  // g01 '꼭 갈 곳' 2키(TRIP-209) — 시드 얼굴과 0곳 얼굴. 나머지 두 얼굴(자리표시·조회 실패)은
  // 회선을 늦추거나 끊으면 실화면에서 그대로 재현되므로 여기 키를 늘리지 않는다.
  {
    key: 'trip-new-step1-seeded',
    label: '여행 만들기 1/2 · 꼭 갈 곳',
    login: null,
    render: () => (
      <TripWizardStep1Screen
        {...TRIP_WIZARD_BASE}
        savedPlaceCount={5}
        mustVisitSection={{
          kind: 'seeded',
          thumbnails: MUST_VISIT_THUMBNAILS,
          overflowCount: 2,
        }}
        onRemoveMustVisit={noop}
        onPressMoreMustVisits={noop}
      />
    ),
  },
  {
    key: 'trip-new-step1-no-saved',
    label: '여행 만들기 1/2 · 담은 곳 0',
    login: null,
    render: () => (
      <TripWizardStep1Screen
        {...TRIP_WIZARD_BASE}
        mustVisitSection={{ kind: 'empty' }}
        onPressMoreMustVisits={noop}
      />
    ),
  },
  // 여행지 시트 검색 불일치 얼굴(TRIP-387) — jest는 픽셀·레이아웃을 못 보므로 "0개 + 없어요"
  // 배치를 눈으로 대조하는 유일한 자리다. `[도시 추가]`를 눌러 시트를 연 뒤 확인한다(시트 열림은
  // 화면 로컬 state라 정적 prop으로는 못 연다). `sheetRegions:[]`(불일치 결과) + 검색어가 함께
  // 있어야 문구가 뜬다 — 빈 검색어면 전체가 보인다.
  {
    key: 'trip-new-step1-search-empty',
    label: '여행 만들기 1/2 · 지역 검색 불일치',
    login: null,
    render: () => (
      <TripWizardStep1Screen
        {...TRIP_WIZARD_BASE}
        sheetRegions={[]}
        destinationQuery="없는지역"
        onChangeDestinationQuery={noop}
      />
    ),
  },
  // 출발일 선택 시트 열림(TRIP-389) — 달력이 단일 선택으로 바뀐 자리다. jest는 바텀시트 실개폐·
  // 단일 셀 하이라이트 픽셀을 못 보므로(repo-traps 바텀시트 통과 목) 이 화면을 눈으로 보는 유일한
  // 자리다. base가 출발일(2026-06-10)을 이미 들어 그 셀이 선택돼 열리고 확정이 활성이다.
  {
    key: 'trip-new-step1-datesheet',
    label: '여행 만들기 1/2 · 출발일 시트',
    login: null,
    render: () => (
      <TripWizardStep1Screen
        {...TRIP_WIZARD_BASE}
        dateSheetOpen
        baseDate="2026-06-10"
        onCloseDateSheet={noop}
        onConfirmDates={noop}
      />
    ),
  },
  // 취향 '바꾸기' 시트 열림(TRIP-484) — Figma 프레임 부재라 발명 레이아웃이다. jest는 바텀시트
  // 실개폐를 못 보므로(통과 목) 시트 문구·칩 선택 하이라이트를 눈으로 보는 유일한 자리다.
  // '미식'을 선택 상태로 열어 선택/비선택 칩을 한 화면에서 대조한다.
  {
    key: 'trip-new-step1-prefsheet',
    label: '여행 만들기 1/2 · 취향 바꾸기 시트',
    login: null,
    render: () => (
      <TripWizardStep1Screen
        {...TRIP_WIZARD_BASE}
        prefSheet={
          <PrefOverrideSheet
            options={PREF_OVERRIDE_OPTIONS}
            selected={['미식']}
            onToggle={noop}
            onConfirm={noop}
            onClose={noop}
          />
        }
      />
    ),
  },
  // g02 5변형(TRIP-225). 화면이 완성된 문자열·불리언만 받는 프레젠테이션이라, 배선 없이
  // props 만 갈아 끼우면 다섯 얼굴이 그대로 나온다 — 실기로 얼굴을 보려면 여기가 정본이다
  // (`docs/structure.md` 경고: "엣지 케이스 화면을 눈으로 보려면 목을 만들지 말고 여기에
  // 상태를 추가한다"). blocked 는 default 에 unresolved + generateDisabled 만 얹은 것이다.
  {
    key: 'trip-new-step2-default',
    label: '거점 숙소 2/2 · 기본',
    login: null,
    render: () => <TripWizardStep2Screen {...TRIP_BASE_SCREEN} />,
  },
  {
    key: 'trip-new-step2-blocked',
    label: '거점 숙소 2/2 · 차단',
    login: null,
    render: () => (
      <TripWizardStep2Screen
        {...TRIP_BASE_SCREEN}
        generateDisabled
        unresolved={{
          items: [
            { date: '2026-06-11', label: '6/11' },
            { date: '2026-06-13', label: '6/13' },
          ],
          overflowCount: 1,
        }}
      />
    ),
  },
  {
    key: 'trip-new-step2-coverage-failed',
    label: '거점 숙소 2/2 · 커버리지 실패',
    login: null,
    render: () => (
      <TripWizardStep2Screen
        {...TRIP_BASE_SCREEN}
        generateDisabled
        coverageFailed
      />
    ),
  },
  // g02 전제 게이트 4변형(TRIP-226). 카드 표면 하나 + 시트 3갈래다. 시트도 화면과 같은
  // 순수 프레젠테이션(`useState` 0건)이라 여기서 props 만 갈아 끼우면 얼굴이 그대로 나온다.
  // ⚠️ 지도 갈래는 `EXPO_PUBLIC_KAKAO_MAP_JS_KEY` 가 있어야 WebView 가 뜬다 — 키가 없으면
  // 아래 `mapfail` 과 같은 화면이 된다(그 판정이 실기에서 맞는지 보는 것이 이 상태의 목적).
  {
    key: 'trip-new-step2-gate',
    label: '거점 숙소 2/2 · 전제 게이트',
    login: null,
    render: () => (
      <TripWizardStep2Screen
        {...TRIP_BASE_SCREEN}
        // 구간을 비워 후보 카드를 화면 위로 올린다 — 이 상태가 보여 줄 것은 카드 표면
        // 넷(사유·보완 진입·기간 밖 경고·확장 질의)이고, 구간은 default 상태가 이미 보여 준다.
        sections={[]}
        candidates={[
          {
            savedStayId: 'stay-2',
            name: '광안리 뷰 호텔',
            isBase: false,
            assignPending: false,
            blockedReason: '지도에서 위치를 확인해 주세요',
            fixLabel: '지도에서 위치 확인',
          },
          {
            savedStayId: 'stay-3',
            name: '감천 게스트하우스',
            isBase: false,
            assignPending: false,
            blockedReason: '날짜가 없어 지정할 수 없어요',
            fixLabel: '날짜 입력하기',
          },
          {
            savedStayId: 'stay-5',
            name: '제주 게스트하우스',
            isBase: false,
            assignPending: false,
            outOfPeriodNote: '여행 기간을 벗어나요',
          },
          {
            savedStayId: 'stay-6',
            name: '서귀포 오션뷰 펜션',
            isBase: false,
            assignPending: false,
            outOfPeriodNote: '여행 기간을 벗어나요',
            extendPrompt: '여행 기간을 늘려서 지정할까요?',
          },
        ]}
        onFix={noop}
        onExtendConfirm={noop}
        onExtendCancel={noop}
      />
    ),
  },
  {
    key: 'trip-new-step2-fixsheet-map',
    label: '거점 숙소 2/2 · 보완 시트(지도)',
    login: null,
    render: () => (
      <TripWizardStep2Screen
        {...TRIP_BASE_SCREEN}
        fixSheet={{ ...FIX_SHEET_BASE }}
      />
    ),
  },
  {
    key: 'trip-new-step2-fixsheet-mapfail',
    label: '거점 숙소 2/2 · 보완 시트(지도 불가)',
    login: null,
    render: () => (
      <TripWizardStep2Screen
        {...TRIP_BASE_SCREEN}
        fixSheet={{ ...FIX_SHEET_BASE, mapUnavailable: true }}
      />
    ),
  },
  {
    key: 'trip-new-step2-fixsheet-error',
    label: '거점 숙소 2/2 · 보완 시트(저장 실패)',
    login: null,
    render: () => (
      <TripWizardStep2Screen
        {...TRIP_BASE_SCREEN}
        fixSheet={{
          ...FIX_SHEET_BASE,
          coordConfirmed: true,
          checkIn: '2026-06-11',
          checkOut: '2026-06-13',
          saveDisabled: false,
          errorText: '저장하지 못했어요',
        }}
      />
    ),
  },
  {
    key: 'trip-new-step2-loading',
    label: '거점 숙소 2/2 · 로딩',
    login: null,
    render: () => (
      <TripWizardStep2Screen
        {...TRIP_BASE_SCREEN}
        variant="loading"
        sections={[]}
        candidates={[]}
        generateDisabled
      />
    ),
  },
  {
    key: 'trip-new-step2-empty',
    label: '거점 숙소 2/2 · 저장 숙소 0',
    login: null,
    render: () => (
      <TripWizardStep2Screen
        {...TRIP_BASE_SCREEN}
        variant="empty"
        sections={[]}
        candidates={[]}
      />
    ),
  },
  {
    key: 'trip-new-step2-error',
    label: '거점 숙소 2/2 · 조회 실패',
    login: null,
    render: () => (
      <TripWizardStep2Screen
        {...TRIP_BASE_SCREEN}
        variant="error"
        sections={[]}
        candidates={[]}
        generateDisabled
      />
    ),
  },
  {
    key: 'trip-new-step2-notrip',
    label: '거점 숙소 2/2 · 여행 없음',
    login: null,
    render: () => (
      <TripWizardStep2Screen
        {...TRIP_BASE_SCREEN}
        variant="notrip"
        sections={[]}
        candidates={[]}
        generateDisabled
      />
    ),
  },
  // h05·h07 필수 방문지 (TRIP-296) — Figma 대조용 격리 렌더.
  {
    key: 'itinerary-mustvisit-default',
    label: '필수 방문지 h05',
    login: null,
    render: () => (
      <MustVisitPickerScreen
        view={{
          kind: 'listed',
          items: MUST_VISIT_PREVIEW_ITEMS,
          staleFailed: false,
        }}
        pins={MUST_VISIT_PREVIEW_PINS}
        // 배선이 h09 부재로 항상 넘기는 값(TRIP-326) — 비활성 CTA·건너뛰기가 실기에서
        // 활성과 구별되는지는 눈으로만 볼 수 있다(문제로그 2026-08-08).
        proceedBlockedReason="다음 단계는 아직 준비 중이에요"
      />
    ),
  },
  {
    key: 'itinerary-mustvisit-time-default',
    label: '방문 시각 지정 h07',
    login: null,
    render: () => (
      <MustVisitTimeScreen
        sourcePoiId="poi-a"
        placeName="부산시립미술관"
        region="부산 부산진구"
        imageUrl={null}
        dayChips={tripDayChips({
          startDate: '2026-06-10',
          endDate: '2026-06-12',
        })}
        startOptions={startTimeOptions()}
        form={{
          fixed: true,
          fixedDate: '2026-06-11',
          fixedStart: '13:00',
          dwellKey: 'NORMAL',
        }}
        blockReason={null}
      />
    ),
  },
  // h11 AI 추천안 초안 5상태(TRIP-297) — Figma `1870:1083` 대조용 격리 렌더.
  // 화면이 props 만 받는 프레젠테이션이라 배선 없이 얼굴이 그대로 나온다
  // (`docs/structure.md` 경고: "엣지 케이스 화면을 눈으로 보려면 목을 만들지 말고 여기에
  // 상태를 추가한다"). 실화면 딥링크로는 이 얼굴들을 볼 수 없다 — 생성 POST 가 만드는
  // `tripId` 와 서버의 2단계 생성 응답이 있어야 하는데 백엔드 없이는 안 생긴다.
  {
    key: 'itinerary-draft-default',
    label: '추천안 초안 h11',
    login: null,
    render: () => <DraftScreen {...DRAFT_PREVIEW_BASE} />,
  },
  {
    // h10 "만드는 중"(TRIP-337) — 같은 픽스처에 generating 만 얹는다. 게이지 3상태(day1 완성 /
    // day2 생성 중 / day3 대기)와 스켈레톤은 tabs 에서 도출돼 손으로 적을 값이 없다.
    key: 'itinerary-draft-generating',
    label: 'h10 · 만드는 중',
    login: null,
    render: () => (
      <DraftScreen
        {...DRAFT_PREVIEW_BASE}
        view={{
          kind: 'listed',
          days: DRAFT_PREVIEW_DAYS,
          staleFailed: false,
          generating: true,
        }}
      />
    ),
  },
  {
    key: 'itinerary-draft-stale-failed',
    label: 'h11 · 부분 실패',
    login: null,
    render: () => (
      <DraftScreen
        {...DRAFT_PREVIEW_BASE}
        view={{ kind: 'listed', days: DRAFT_PREVIEW_DAYS, staleFailed: true }}
      />
    ),
  },
  {
    key: 'itinerary-draft-loading',
    label: 'h11 · 로딩',
    login: null,
    render: () => (
      <DraftScreen
        {...DRAFT_PREVIEW_BASE}
        view={{ kind: 'loading' }}
        pins={[]}
      />
    ),
  },
  {
    key: 'itinerary-draft-empty',
    label: 'h11 · 빈 화면',
    login: null,
    render: () => (
      <DraftScreen {...DRAFT_PREVIEW_BASE} view={{ kind: 'empty' }} pins={[]} />
    ),
  },
  {
    key: 'itinerary-draft-nopins',
    label: 'h11 · 좌표 없는 날',
    login: null,
    render: () => (
      <DraftScreen
        {...DRAFT_PREVIEW_BASE}
        view={{
          kind: 'listed',
          days: DRAFT_PREVIEW_DAYS_NO_COORDS,
          staleFailed: false,
        }}
        pins={buildDraftPins(DRAFT_PREVIEW_DAYS_NO_COORDS[0].slots)}
      />
    ),
  },
  // TRIP-304 폴백·강등 배너 3종 — 심각도 삼분(MINIMAL > LOW > DETERMINISTIC). 실화면 딥링크로는
  // 아직 못 본다(서버가 solveMode/isFallback/요약 신호를 안 준다). 목록은 그대로고 배너 한 줄만
  // 곁에 붙으며, MINIMAL 만 배너 안에 [다시 시도]를 갖는다.
  {
    key: 'itinerary-draft-fallback-deterministic',
    label: 'h11 · 폴백(기본 모드)',
    login: null,
    render: () => (
      <DraftScreen
        {...DRAFT_PREVIEW_BASE}
        fallbackNotice={{ kind: 'deterministic' }}
      />
    ),
  },
  {
    key: 'itinerary-draft-fallback-minimal',
    label: 'h11 · 폴백(최소 일정)',
    login: null,
    render: () => (
      <DraftScreen
        {...DRAFT_PREVIEW_BASE}
        fallbackNotice={{ kind: 'minimal' }}
      />
    ),
  },
  {
    key: 'itinerary-draft-fallback-demoted',
    label: 'h11 · 후보 강등',
    login: null,
    render: () => (
      <DraftScreen
        {...DRAFT_PREVIEW_BASE}
        fallbackNotice={{ kind: 'demoted' }}
      />
    ),
  },
  // h35 후보 0건(TRIP-298) — Figma `1906:1083` 대조용. 실화면 딥링크로는 이 얼굴을 볼 수
  // 없다: 서버가 `candidatesSummary` 를 아직 안 준다(TRIP-306 미착수). 칩 문구는 Figma 목업
  // 값 그대로이고, 실기에서는 **서버가 준 문자열이 그대로** 들어온다(01b D8).
  {
    key: 'itinerary-draft-zero',
    label: 'h35 · 후보 0건',
    login: null,
    render: () => (
      <ZeroCandidateScreen
        shortfallCategories={['1일 예산 5만원', '700m 이내', '비건·24시간']}
        onBack={noop}
        onReduceMustVisits={noop}
      />
    ),
  },
  // h04 시작 방법(TRIP-303) — props 만 받는 프레젠테이션이라 배선 없이 얼굴이 그대로 나온다.
  // 생성 선행조건(거점 커버리지·겹침) 게이트는 h04 에 없다 — 그 판단은 여행 생성 2/2(g02)가 소유한다.
  {
    key: 'itinerary-method',
    label: 'h04 · 시작 방법',
    login: null,
    render: () => <MethodPickerScreen onBack={noop} onPressFullAi={noop} />,
  },
  // h04 재생성 확인(TRIP-504) — 기존 일정이 있을 때 copick 이 곧장 진행하지 않고 뜨는 인라인 확인.
  // 실화면에선 조회로 판정해 켜지는 얼굴이라, 여기서 상태만 얹어(`showRegenerateConfirm`) 육안 대조한다.
  {
    key: 'itinerary-method-regenerate',
    label: 'h04 · 재생성 확인',
    login: null,
    render: () => (
      <MethodPickerScreen
        onBack={noop}
        onPressFullAi={noop}
        onPressCoPick={noop}
        onPressManual={noop}
        showRegenerateConfirm
        onRegenerateContinue={noop}
        onRegenerateCancel={noop}
      />
    ),
  },
  // h09 생성 중(TRIP-305) — props 만 받는 프레젠테이션이라 배선 없이 얼굴이 그대로 나온다. 진행
  // 표면은 비결정형(RN Animated)이고 3단계는 균일 진행 중(⚑C, 완료 날조 없음)이다. 실화면 딥링크로는
  // 잠깐만 스치는 얼굴이라(성공 즉시 draft 로 replace) 여기가 이 화면을 오래 보는 유일한 자리다.
  {
    key: 'itinerary-generating',
    label: 'h09 · 생성 중',
    login: null,
    render: () => (
      <GeneratingScreen onCancel={noop} onBackground={noop} onRetry={noop} />
    ),
  },
  // h09 생성 실패(AC-6·INV-4) — POST 오류 시 침묵하지 않고 실패 표면 + [다시 시도]를 낸다.
  {
    key: 'itinerary-generating-failed',
    label: 'h09 · 생성 실패',
    login: null,
    render: () => (
      <GeneratingScreen
        onCancel={noop}
        onBackground={noop}
        onRetry={noop}
        failed
      />
    ),
  },
  // h25 완성 일정(TRIP-299) — 피어가 제공한 프리뷰 칩. 실화면 딥링크로는 볼 수 없다(생성 POST 가
  // 만드는 tripId + 완성 일정 응답이 백엔드 없이는 안 생긴다). 화면이 props 만 받는 프레젠테이션이라
  // 배선 없이 얼굴이 그대로 나온다.
  {
    key: 'itinerary-timeline',
    label: '완성 일정 · 시간표(h25)',
    login: null,
    render: () => (
      <TimelineScreen
        header={TIMELINE_PREVIEW_HEADER}
        days={TIMELINE_PREVIEW_DAYS}
        slots={TIMELINE_PREVIEW_SLOTS}
        activeDayIndex={0}
        status="PLANNED"
        onSelectDay={noop}
        onBack={noop}
        onConfirm={noop}
        onEdit={noop}
      />
    ),
  },
  {
    // 확정 예방 잠금(TRIP-337 · AC-4) — PARTIAL 이면 확정 CTA 가 회색 disabled + 사유 병기.
    key: 'itinerary-timeline-confirm-locked',
    label: '완성 일정 · 확정 잠김(h25 PARTIAL)',
    login: null,
    render: () => (
      <TimelineScreen
        header={TIMELINE_PREVIEW_HEADER}
        days={TIMELINE_PREVIEW_DAYS}
        slots={TIMELINE_PREVIEW_SLOTS}
        activeDayIndex={0}
        status="PLANNED"
        confirmLocked
        onSelectDay={noop}
        onBack={noop}
        onConfirm={noop}
      />
    ),
  },
  // 완성 일정 · 풀 표면(TRIP-354) — 인라인 글랜스 지도 + 풀카드(사진·이름·영업시간·태그) + 구간행 +
  // 날짜헤더 "이동 X" + 휴관칩을 한 화면에서 본다. "지도 크게 보기"로 h26 확대 오버레이를 연다.
  // 좌표 부재 슬롯(자갈치)이 섞여 핀 결번 ①②④ + "지도 미표시" 배지도 한 화면에서 확인된다.
  {
    key: 'itinerary-map',
    label: '완성 일정 · 풀카드+인라인지도(h25/h34)',
    login: null,
    render: () => (
      <TimelineScreen
        header={TIMELINE_PREVIEW_HEADER}
        days={TIMELINE_PREVIEW_DAYS}
        slots={TIMELINE_MAP_PREVIEW_SLOTS}
        activeDayIndex={0}
        status="PLANNED"
        onSelectDay={noop}
        onBack={noop}
        onConfirm={noop}
      />
    ),
  },
  // 사진 없는 슬롯의 카테고리 플레이스홀더(TRIP-465) — 8종 틴트·아이콘을 한 화면에서 Figma 2989:1731
  // 과 대조한다(전부 imageUrl null). 픽셀·아이콘 fill 은 jest 사각이라 이 프리뷰가 유일한 육안 그물.
  {
    key: 'itinerary-timeline-placeholder',
    label: '완성 일정 · 사진 없는 카테고리 플레이스홀더(h25)',
    login: null,
    render: () => (
      <TimelineScreen
        header={{ title: '부산 여행', nightsLabel: '3박 4일', totalPlaces: 8 }}
        days={[
          {
            dayIndex: 1,
            date: '2026-06-10',
            count: TIMELINE_PLACEHOLDER_PREVIEW_SLOTS.length,
          },
        ]}
        slots={TIMELINE_PLACEHOLDER_PREVIEW_SLOTS}
        activeDayIndex={0}
        status="PLANNED"
        onSelectDay={noop}
        onBack={noop}
        onConfirm={noop}
      />
    ),
  },
  // 내 여행 목록 · h37(TRIP-468) — 완성(success 배지+"확정 장소 N곳")·작성중(primary 배지+resume
  // CTA)·미도착(배지·부가정보 부재 degrade) 세 카드 + 사진 플레이스홀더·"최신순" 라벨을 한 화면에서
  // Figma h37 2971:1656 과 대조한다. 배지 pill·resume 오버레이·사진 자리는 jest 사각(6-b 전용).
  {
    key: 'my-trips-list',
    label: '내 여행 목록 · 완성/작성중/미도착(h37)',
    login: null,
    render: () => (
      <MyTripsListScreen
        mode="list"
        onPressCreateTrip={noop}
        cards={MY_TRIPS_PREVIEW_VMS.map((vm) => (
          <MyTripCard key={vm.tripId} vm={vm} onPress={noop} />
        ))}
      />
    ),
  },
  {
    key: 'my-trips-empty',
    label: '내 여행 목록 · empty(h37)',
    login: null,
    render: () => <MyTripsListScreen mode="empty" onPressCreateTrip={noop} />,
  },
  {
    key: 'my-trips-loading',
    label: '내 여행 목록 · 스켈레톤 2장(h37)',
    login: null,
    render: () => <MyTripsListScreen mode="loading" onPressCreateTrip={noop} />,
  },
  // l03 마이페이지 · l03(TRIP-604) — 프로필 카드·세그먼트·예정 카드·지난 여행(회고 chevron)·설정
  // 행을 한 화면에서 Figma l03 default(1602:2388)와 대조한다. 예정 2건 + 종료 2건(회고 진입 chevron).
  {
    key: 'my-page-default',
    label: '마이페이지 · 예정+지난 여행(l03)',
    login: null,
    render: () => (
      <MyPageScreen
        nickname="여행자123"
        email="trippilot@email.com"
        counts={{ upcoming: 3, active: 0, ended: 2 }}
        active="upcoming"
        onChangeSegment={noop}
        styleCard={<StyleSummaryCard vm={STYLE_CARD_OFFICIAL_VM} />}
        cards={MY_PAGE_UPCOMING_VMS.map((vm) => (
          <TripCard key={vm.tripId} vm={vm} onPressReflection={noop} />
        ))}
        activeEmpty={false}
        onPressCreateTrip={noop}
        showPast
        pastCards={MY_PAGE_ENDED_VMS.map((vm) => (
          <TripCard key={vm.tripId} vm={vm} onPressReflection={noop} />
        ))}
        pastEmpty={false}
      />
    ),
  },
  // l03 마이페이지 · 종료 0건 엣지(AC-5) — 예정 빈 상태(새 여행 CTA) + "아직 종료된 여행이 없습니다"
  // (회고 진입 어포던스 0). Figma empty(1603:2414)의 CTA·지난 여행 영역을 대조하되, 사진 썸네일은
  // 계약에 필드가 없어 그리지 않는다(드리프트 ① 해소).
  {
    key: 'my-page-empty',
    label: '마이페이지 · 예정 0·종료 0 엣지(l03)',
    login: null,
    render: () => (
      <MyPageScreen
        nickname="여행자123"
        email="trippilot@email.com"
        counts={{ upcoming: 0, active: 0, ended: 0 }}
        active="upcoming"
        onChangeSegment={noop}
        cards={null}
        activeEmpty
        onPressCreateTrip={noop}
        showPast
        pastCards={null}
        pastEmpty
      />
    ),
  },
  // l03 스타일 요약 카드 · 미달 얼굴(TRIP-606) — 누적 방문 <10곳이면 게이지·칩 없이 안내 한 줄만
  // (INV-U5-09). 실화면 딥링크로는 백엔드 없이 이 얼굴을 못 보므로 카드를 단독으로 세워 대조한다.
  {
    key: 'my-style-card-insufficient',
    label: '스타일 카드 · 미달(<10곳) 안내(l03)',
    login: null,
    render: () => (
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <View className="flex-1 bg-canvas p-lg">
          <StyleSummaryCard vm={{ kind: 'insufficient', current: 4 }} />
        </View>
      </SafeAreaView>
    ),
  },
  // l04 등록 숙소·예약 기록(TRIP-605) — 등록됨(채움 pill + "출발점 변경 ›")·미등록(점선 "출발점 지정")·
  // 좌표 미확정(토글 disabled) 세 행을 한 화면에서 Figma l04 default(1604:2440)와 대조한다. "출발점
  // 변경/지정" 을 누르면 BaseToggleDialog(딤+중앙 카드)가 뜨는 것도 여기서 실제로 조작해 본다.
  {
    key: 'my-stays-default',
    label: '등록 숙소·예약 기록 · 3행(l04)',
    login: null,
    render: () => (
      <MyStaysScreen
        rows={MY_STAYS_PREVIEW_ROWS}
        isEmpty={false}
        onConfirmBaseToggle={noop}
        onPressExplore={noop}
        onPressBack={noop}
      />
    ),
  },
  // l04 empty(1605:2440) — 숙소 0건 안내(침대 일러스트 + "숙소 탐색" CTA → /stays). US-NOTIF-06 예외.
  {
    key: 'my-stays-empty',
    label: '등록 숙소 0건 · 탐색(l04)',
    login: null,
    render: () => (
      <MyStaysScreen
        rows={[]}
        isEmpty
        onConfirmBaseToggle={noop}
        onPressExplore={noop}
        onPressBack={noop}
      />
    ),
  },
  // l02 알림 설정 default(1600:2388) — 6행×2열(COMMUNITY 숨김)·상단 정보 배너·하단 SYSTEM 줄. 토글
  // 빨강/회색·thumb 위치·정보 배너 틴트는 jest 사각이라 이 키가 육안 대조 자리다.
  {
    key: 'l02-notification-default',
    label: '알림 설정 · 6행 default(l02)',
    login: null,
    render: () => (
      <NotificationSettingsScreen
        values={NOTIF_PREVIEW_VALUES}
        pushColumnAvailable
        onToggle={noop}
        onOpenSettings={noop}
        onPressBack={noop}
      />
    ),
  },
  // l02 permission-denied(1601:2388) — 상단 대시 배너+[설정 이동]·열 헤더 "권한 필요" 칩·푸시 열
  // 전부 회색 비활성·인앱은 정상·하단 푸시-누적 줄. 대시·칩·dimmed 는 6-b 실기 확인.
  {
    key: 'l02-notification-denied',
    label: '알림 설정 · OS 권한 거부(l02)',
    login: null,
    render: () => (
      <NotificationSettingsScreen
        values={NOTIF_PREVIEW_VALUES}
        pushColumnAvailable={false}
        onToggle={noop}
        onOpenSettings={noop}
        onPressBack={noop}
      />
    ),
  },
  // h24 일정 편집(TRIP-302) — 시각칩·삭제·"다른 후보" 어포던스가 있는 편집 화면. 시각칩을 누르면
  // 아래 '시각 조정 시트' 가 열린다(프리뷰에선 둘을 각각 독립 진입으로 본다). 고정 슬롯(poi-b)은
  // 시각칩에 onPress 가 안 붙어 조정이 안 열리는 것도 여기서 확인한다.
  {
    key: 'itinerary-edit',
    label: '일정 편집 · h24(TRIP-302)',
    login: null,
    render: () => (
      <ItineraryEditScreen
        days={TIMELINE_PREVIEW_DAYS}
        slots={TIMELINE_PREVIEW_SLOTS}
        activeDayIndex={0}
        onSelectDay={noop}
        onBack={noop}
        onDeleteSlot={noop}
        onReorder={noop}
        onEditSlotTime={noop}
        onSave={noop}
      />
    ),
  },
  {
    key: 'itinerary-edit-time-sheet',
    label: '시각 조정 시트 · h24(TRIP-302)',
    login: null,
    render: () => (
      <View className="flex-1">
        <SlotTimeSheet
          startAt="10:15:00"
          endAt="11:45:00"
          onApply={noop}
          onCancel={noop}
        />
      </View>
    ),
  },
  // h34 확정 읽기전용(TRIP-505 정리) — 같은 데이터에 status=CONFIRMED 를 얹은 확정 얼굴. 배너·
  // 하단 비활성 2버튼·부제 조립은 제거됐고, 그 자리에 `itinerary-confirmed-note` 안내 한 줄이
  // 뜬다(appbar `확정 일정`·공유 아이콘은 유지). 안내·공유 어중간한 상태를 눈으로 대조하는 자리.
  {
    key: 'itinerary-confirmed',
    label: '확정 일정 · 읽기전용(h34)',
    login: null,
    render: () => (
      <TimelineScreen
        header={TIMELINE_PREVIEW_HEADER}
        days={TIMELINE_PREVIEW_DAYS}
        slots={TIMELINE_PREVIEW_SLOTS}
        activeDayIndex={0}
        status="CONFIRMED"
        onSelectDay={noop}
        onBack={noop}
      />
    ),
  },
  // h12 슬롯 교체(TRIP-335→483) — 바텀시트를 슬롯 카드 아래 **인라인 확장 패널**로 이관했다. candidates
  // 는 아직 이름·사진 미확보(BE 후속)라 카드가 "이름 준비 중" 플레이스홀더 + 회색 사진 자리로 뜬다.
  // 실화면 딥링크로는 볼 수 없다(생성 POST 가 만드는 tripId + slot-candidates 응답이 백엔드 없이는
  // 안 생긴다). 인라인 패널이라 오버레이 없이 스크롤 흐름 안에서 그리고, 헤더에 시간대(오후)를 얹는다.
  {
    key: 'slot-candidate-panel',
    label: '다른 후보로 바꾸기 · 인라인 패널(h12)',
    login: null,
    render: () => (
      <ScrollView contentContainerClassName="gap-md p-lg">
        <SlotCandidatePanel
          candidates={SLOT_CANDIDATES_PREVIEW}
          currentPoiId="poi-current"
          currentName="부산시립미술관"
          timeBand="오후"
          isPending={false}
          onSelectCandidate={noop}
          onClose={noop}
        />
      </ScrollView>
    ),
  },
  {
    key: 'slot-candidate-panel-pending',
    label: '다른 후보로 바꾸기 · 교체 중(h12)',
    login: null,
    render: () => (
      <ScrollView contentContainerClassName="gap-md p-lg">
        <SlotCandidatePanel
          candidates={SLOT_CANDIDATES_PREVIEW}
          currentPoiId="poi-current"
          currentName="부산시립미술관"
          timeBand="오후"
          isPending
          onSelectCandidate={noop}
          onClose={noop}
        />
      </ScrollView>
    ),
  },
  {
    key: 'slot-candidate-panel-degraded',
    label: '다른 후보로 바꾸기 · 강등 고지(h12)',
    login: null,
    render: () => (
      <ScrollView contentContainerClassName="gap-md p-lg">
        <SlotCandidatePanel
          candidates={SLOT_CANDIDATES_PREVIEW}
          currentPoiId="poi-current"
          currentName="부산시립미술관"
          timeBand="오후"
          isPending={false}
          degraded
          onSelectCandidate={noop}
          onClose={noop}
        />
      </ScrollView>
    ),
  },
  {
    key: 'slot-candidate-panel-empty',
    label: '다른 후보로 바꾸기 · 0건(h12)',
    login: null,
    render: () => (
      <ScrollView contentContainerClassName="gap-md p-lg">
        <SlotCandidatePanel
          candidates={[]}
          currentPoiId="poi-current"
          currentName="부산시립미술관"
          timeBand="오후"
          isPending={false}
          onSelectCandidate={noop}
          onClose={noop}
        />
      </ScrollView>
    ),
  },
  {
    key: 'slot-candidate-panel-error',
    label: '다른 후보로 바꾸기 · 실패(h12)',
    login: null,
    render: () => (
      <ScrollView contentContainerClassName="gap-md p-lg">
        <SlotCandidatePanel
          candidates={SLOT_CANDIDATES_PREVIEW}
          currentPoiId="poi-current"
          currentName="부산시립미술관"
          timeBand="오후"
          isPending={false}
          errorMessage="확정된 일정이라 지금은 바꿀 수 없어요"
          onSelectCandidate={noop}
          onClose={noop}
        />
      </ScrollView>
    ),
  },
  {
    key: 'option-swap',
    label: '옵션 교체 · 화면(h18)',
    login: null,
    render: () => (
      <OptionSwapScreen
        candidates={SLOT_CANDIDATES_PREVIEW}
        currentPoiId="poi-current"
        currentName="부산시립미술관"
        selectedPoiId={null}
        onSelectRadio={noop}
        onConfirm={noop}
        isPending={false}
        onBack={noop}
      />
    ),
  },
  {
    key: 'option-swap-selected',
    label: '옵션 교체 · 선택 후 실패(h18)',
    login: null,
    render: () => (
      <OptionSwapScreen
        candidates={SLOT_CANDIDATES_PREVIEW}
        currentPoiId="poi-current"
        currentName="부산시립미술관"
        selectedPoiId="poi-b"
        onSelectRadio={noop}
        onConfirm={noop}
        isPending={false}
        errorMessage="잠시 후 다시 시도해 주세요"
        onBack={noop}
      />
    ),
  },
  {
    key: 'option-swap-empty',
    label: '옵션 교체 · 0건(h18)',
    login: null,
    render: () => (
      <OptionSwapScreen
        candidates={[]}
        currentPoiId="poi-current"
        currentName="부산시립미술관"
        selectedPoiId={null}
        onSelectRadio={noop}
        onConfirm={noop}
        isPending={false}
        onBack={noop}
      />
    ),
  },
  // h19·h20 직접 짜기(MANUAL, TRIP-338) — 화면은 props-only 라 배선 없이 상태만 넣어 그린다.
  // 실화면 딥링크로는 빈 일정 생성 POST 를 백엔드가 만들어야 도달하므로(401 이면 못 봄) 여기가 눈
  // 확인 자리다(6-b 실기 스모크 진입점). 빈 상태·슬롯 채움+위반·검색을 세 얼굴로 대조한다.
  {
    key: 'manual-empty',
    label: '직접 짜기 · 빈 일정(h19)',
    login: null,
    render: () => (
      <ManualPlanScreen
        days={[{ date: '2026-06-10', slots: [] }]}
        contextChips={['09:00 출발', '숙소 기준']}
        onBack={noop}
        onPressSearchAdd={noop}
        onPressAddBand={noop}
      />
    ),
  },
  {
    key: 'manual-filled',
    label: '직접 짜기 · 슬롯 채움+위반(h19)',
    login: null,
    render: () => (
      <ManualPlanScreen
        days={[
          {
            date: '2026-06-10',
            slots: [
              {
                poiId: 'poi-a',
                startAt: '10:00:00',
                endAt: '11:30:00',
                isFixed: false,
                endsNextDay: false,
                hasViolation: false,
                nameKo: '광안리 해변',
                tags: [],
              },
              {
                poiId: 'poi-b',
                startAt: '13:00:00',
                endAt: '14:00:00',
                isFixed: false,
                endsNextDay: false,
                hasViolation: true,
                violationReason: '점심시간과 겹쳐요',
                nameKo: '자갈치 시장',
                tags: [],
              },
              {
                poiId: 'poi-c',
                startAt: '19:00:00',
                endAt: '20:00:00',
                isFixed: true,
                endsNextDay: false,
                hasViolation: false,
                nameKo: '해운대 포차거리',
                tags: [],
              },
            ],
          },
        ]}
        contextChips={['09:00 출발', '숙소 기준']}
        onBack={noop}
        onPressSearchAdd={noop}
      />
    ),
  },
  {
    key: 'place-add',
    label: '장소 추가·검색(h20)',
    login: null,
    render: () => (
      <PlaceAddScreen
        places={PREVIEW_PLACES}
        searchText=""
        selectedCategory={null}
        addedPoiIds={PREVIEW_PLACES.slice(0, 1).map((place) => place.poiId)}
        onChangeSearchText={noop}
        onSelectCategory={noop}
        onPressAdd={noop}
        onPressDone={noop}
        onBack={noop}
        onPressViewPlan={noop}
      />
    ),
  },
  {
    key: 'place-add-notready',
    label: '장소 추가·일정 미도착(h20)',
    login: null,
    render: () => (
      <PlaceAddScreen
        places={PREVIEW_PLACES}
        searchText=""
        selectedCategory={null}
        addedPoiIds={[]}
        notReady
        onChangeSearchText={noop}
        onSelectCategory={noop}
        onPressAdd={noop}
        onPressDone={noop}
        onBack={noop}
        onPressViewPlan={noop}
      />
    ),
  },
  // i05 현재 장소 상세(TRIP-398) — props-only 화면. jest 는 픽셀·레이아웃을 못 봐 이 자리가
  // 유일하게 눈으로 보는 곳. 결측 얼굴은 model 결측 스위치를 켠 뷰를 그대로 얹는다.
  {
    key: 'live-place-default',
    label: '현재 장소 상세 i05',
    login: null,
    render: () => (
      <PlaceDetailScreen
        view={LIVE_PLACE_PREVIEW_VIEW}
        onPressItinerary={noop}
      />
    ),
  },
  {
    key: 'live-place-unknown',
    label: '현재 장소 상세 i05 · 결측(미확인·확인 필요)',
    login: null,
    render: () => (
      <PlaceDetailScreen
        view={{
          ...LIVE_PLACE_PREVIEW_VIEW,
          name: '미확인',
          openingHours: '미확인',
          openingHoursMissing: true,
          hoursCaption: '확인 필요',
          slackLabel: '미확인',
        }}
        onPressItinerary={noop}
      />
    ),
  },
  // i01 여행 중 일정(TRIP-396) — done·active·upcoming 세 카드 상태를 한 타임라인에서.
  {
    key: 'live-itinerary',
    label: '여행 중 일정 i01 · 방문 체크',
    login: null,
    render: () => (
      <LiveItineraryScreen
        days={[
          { date: '2026-08-20', slots: [] },
          { date: '2026-08-21', slots: [] },
        ]}
        activeDayIndex={0}
        slots={LIVE_ITINERARY_PREVIEW_SLOTS}
        segment="itinerary"
        onSelectDay={noop}
        onSelectSegment={noop}
        toggle="plan"
        onToggle={noop}
        actualRoute={{
          enabled: false,
          reason: '위치 권한을 켜면 기록돼요',
          distanceKm: 0,
        }}
        tripTitle="부산 여행"
        subtitle="8월 20일 목요일 · 오늘 일정"
        onPressTab={noop}
        onPressComplete={noop}
        onManualArrive={noop}
      />
    ),
  },
  // i08 트리거 칩(상단 상주) + i01 변수감지 배너(활성 슬롯 안)(TRIP-561) — 발화 중 얼굴. jest 는
  // 칩 상단 위치·rose 톤·아이콘·배너 슬롯 내부 정렬을 못 봐(6-b), 이 키가 유일한 육안 대조 자리다.
  // 칩·배너는 순수 프레젠테이션이라 페이지가 조립할 문구·아이콘·콜백을 여기서 직접 얹는다.
  {
    key: 'live-itinerary-trigger',
    label: '여행 중 일정 i01 · 트리거 칩+배너(발화)',
    login: null,
    render: () => (
      <LiveItineraryScreen
        days={[
          { date: '2026-08-20', slots: [] },
          { date: '2026-08-21', slots: [] },
        ]}
        activeDayIndex={0}
        slots={LIVE_ITINERARY_PREVIEW_SLOTS}
        segment="itinerary"
        onSelectDay={noop}
        onSelectSegment={noop}
        toggle="plan"
        onToggle={noop}
        actualRoute={{
          enabled: false,
          reason: '위치 권한을 켜면 기록돼요',
          distanceKm: 0,
        }}
        tripTitle="부산 여행"
        subtitle="8월 20일 목요일 · 오늘 일정"
        onPressTab={noop}
        onPressComplete={noop}
        onManualArrive={noop}
        triggerChip={
          <TriggerChip
            title="비 예보"
            subtitle="탭하여 대안 보기"
            icon={<WeatherCloudGlyph size={24} />}
            onPressAlternative={noop}
            onDismiss={noop}
          />
        }
        renderSlotBanner={(slotKey) =>
          slotKey === '2026-08-20#poi-active' ? (
            <TriggerBanner text="비 예보 · 17시 이후 비 — 실내로 바꾸거나 시간을 당길 수 있어요" />
          ) : null
        }
      />
    ),
  },
  // e04 저장한 숙소(TRIP-461) — results·empty 두 얼굴. jest 는 픽셀·레이아웃을 못 봐(6-b) 이
  // 자리가 카드 그림자·거점 지정 하단 버튼·empty 콜라주·돋보기 CTA 를 눈으로 대조하는 곳이다.
  {
    key: 'saved-stays-default',
    label: '저장한 숙소 e04 · 목록',
    login: null,
    render: () => (
      <SavedStayListScreen
        savedStays={SAVED_STAY_PREVIEW_CARDS}
        face="results"
        onPressCard={noop}
        onPressRegister={noop}
        onBack={noop}
      />
    ),
  },
  {
    key: 'saved-stays-empty',
    label: '저장한 숙소 e04 · 빈 상태',
    login: null,
    render: () => (
      <SavedStayListScreen
        savedStays={[]}
        face="empty"
        onPressBrowse={noop}
        onBack={noop}
      />
    ),
  },
  // ── i10 재계획 요청 시트(TRIP-439) — 순수 시트를 props 로 직접 그린다. 바텀시트 실제 열림/딤은
  //    정적 프리뷰에서도 못 보므로(통과형 목과 같은 원리) 여기서 보는 것은 칩·CTA·안내 레이아웃까지다 ──
  {
    key: 'planb-request',
    label: 'i10 재계획 요청 · 수동 진입',
    login: null,
    render: () => (
      <View className="flex-1">
        <ReplanRequestSheet
          scope="PARTIAL_SLOTS"
          selectedReasons={['WEATHER']}
          selectedDirectives={['RELAX']}
          freeText=""
          onSelectScope={noop}
          onToggleReason={noop}
          onToggleDirective={noop}
          onChangeFreeText={noop}
          onSubmit={noop}
          onManual={noop}
        />
      </View>
    ),
  },
  {
    key: 'planb-request-detected',
    label: 'i10 재계획 요청 · 감지 배너(자동 진입)',
    login: null,
    render: () => (
      <View className="flex-1">
        <ReplanRequestSheet
          scope="FULL_DAY"
          selectedReasons={[]}
          selectedDirectives={[]}
          freeText=""
          onSelectScope={noop}
          onToggleReason={noop}
          onToggleDirective={noop}
          onChangeFreeText={noop}
          onSubmit={noop}
          onManual={noop}
          trigger={{ title: '비 예보 감지' }}
          onSuppress={noop}
        />
      </View>
    ),
  },
  {
    key: 'planb-request-out-of-scope',
    label: 'i10 재계획 요청 · 범위 밖(표시만·제출잠금)',
    login: null,
    render: () => (
      <View className="flex-1">
        <ReplanRequestSheet
          scope="PARTIAL_SLOTS"
          selectedReasons={[]}
          selectedDirectives={[]}
          freeText="파리로 바꿔줘"
          onSelectScope={noop}
          onToggleReason={noop}
          onToggleDirective={noop}
          onChangeFreeText={noop}
          onSubmit={noop}
          onManual={noop}
          outOfScope
        />
      </View>
    ),
  },
  // ── i12 재계획 로딩(TRIP-440) — 순수 화면. 진행바 흐름·체크리스트 아이콘 3상태는 정지
  //    스크린샷 한계라 여기서 보는 것은 레이아웃·라벨·안심 노트·CTA 2개까지다 ──
  {
    key: 'planb-solving',
    label: 'i12 재계획 로딩 · 진행·백그라운드·취소',
    login: null,
    render: () => <ReplanSolvingScreen onBackground={noop} onCancel={noop} />,
  },
  // ── i14 슬롯 후보 시트(TRIP-440) — 순수 인라인 패널 3얼굴(후보·강등 고지·빈 목록). slackLabel
  //    은 slackTime.ts(model) 산출 형태를 그대로 주입한다(ui 소스엔 숫자 리터럴 0) ──
  {
    key: 'planb-candidates',
    label: 'i14 슬롯 후보 · 3장',
    login: null,
    render: () => (
      <ScrollView contentContainerClassName="gap-md p-lg">
        <SlotCandidateSheet
          candidates={SLOT_CANDIDATES_PREVIEW}
          slackLabel="여유 1시간 20분"
        />
      </ScrollView>
    ),
  },
  {
    key: 'planb-candidates-degraded',
    label: 'i14 슬롯 후보 · 강등 고지(가까운 순)',
    login: null,
    render: () => (
      <ScrollView contentContainerClassName="gap-md p-lg">
        <SlotCandidateSheet
          candidates={SLOT_CANDIDATES_PREVIEW}
          slackLabel="여유 40분"
          degraded
        />
      </ScrollView>
    ),
  },
  {
    key: 'planb-candidates-empty',
    label: 'i14 슬롯 후보 · 0건(반경·컨셉 제안)',
    login: null,
    render: () => (
      <ScrollView contentContainerClassName="gap-md p-lg">
        <SlotCandidateSheet candidates={[]} slackLabel="여유 1시간 20분" />
      </ScrollView>
    ),
  },
  // ── i13 재계획안(TRIP-563) — 순수 화면 2얼굴. 채운 슬롯(배지 5종·후보·고정)과 빈 슬롯 degrade
  //    (헤더 근거·이월 안내만). 지도 center 는 골격 플레이스홀더, 일차 스위치·사진·번호는 draft 계약
  //    공백이라 없다 — 슬롯 배지·거리 메타·우측 어포던스·CTA 배치를 육안 대조하는 자리(실 지도·시트
  //    열림은 6-b). draft 실슬롯 바인딩은 BE 후속 ──
  {
    key: 'planb-replan-draft',
    label: 'i13 재계획안 · 채운 슬롯(배지 5종·후보·고정)',
    login: null,
    render: () => (
      <ReplanDraftScreen
        reasons={['비 예보를 반영해 오후 일정을 다시 짰어요']}
        excludedPoiIds={['x1', 'x2']}
        slots={REPLAN_DRAFT_PREVIEW_SLOTS}
        onManualEdit={noop}
        onApply={noop}
        onPressCandidates={noop}
      />
    ),
  },
  {
    key: 'planb-replan-draft-empty',
    label: 'i13 재계획안 · 빈 슬롯 degrade(헤더·이월만)',
    login: null,
    render: () => (
      <ReplanDraftScreen
        reasons={['비 예보를 반영해 오후 일정을 다시 짰어요']}
        excludedPoiIds={['x1', 'x2']}
        slots={[]}
        onManualEdit={noop}
        onApply={noop}
        onPressCandidates={noop}
      />
    ),
  },
  // ── i16 대안 없음(TRIP-563) — 지도·경고 삼각·문구·3버튼. 3버튼 모두 enabled, onSkip·onRestMode 는
  //    no-op 자리표시(페이지가 실배선 결정). 실 지도·버튼 정렬은 6-b ──
  {
    key: 'planb-noalt',
    label: 'i16 대안 없음 · 3버튼·경고',
    login: null,
    render: () => (
      <NoAlternativeScreen
        skipCount={1}
        onSkip={noop}
        onRestMode={noop}
        onManualEdit={noop}
      />
    ),
  },
  // ── i19 반영 완료(TRIP-441) — buildable 서브셋(헤더·체크·문구·CTA). 체크 원 크기·primary bg·
  //    정렬은 jest 사각이라 이 키가 육안 대조 자리다(지표·전후 배지·되돌리기는 draft 부재로 없음) ──
  {
    key: 'planb-applied',
    label: 'i19 반영 완료 · 체크·여행 계속하기',
    login: null,
    render: () => <ReplanAppliedScreen onBack={noop} onContinue={noop} />,
  },
  // ── i20·i21 위치 수동 입력·권한 거부 폴백(TRIP-442) — 한 컴포넌트를 state prop 으로 두 얼굴.
  //    지도 롱프레스 실동작·"이 위치로 계속" 핸드오프·핀 오버레이·Figma 픽셀은 jest 사각이라 이
  //    두 키가 육안 대조 자리다(i20 `1790:3495`·i21 `1790:3549`). 자체 조회 없는 프리젠테이션이라
  //    QueryClient 없이 렌더된다 ──
  {
    key: 'live-location-manual',
    label: 'i20 수동 위치 입력 · 측위 불가',
    login: null,
    render: () => <LiveLocationPage tripId="preview-trip" state="manual" />,
  },
  {
    key: 'live-location-denied',
    label: 'i21 위치 권한 거부 · 등록 숙소 프리시드',
    login: null,
    render: () => (
      <LiveLocationPage tripId="preview-trip" state="permission-denied" />
    ),
  },
  // ── i15·i22 수동 편집(TRIP-443·TRIP-577) — 한 래퍼(ManualEditPreview)를 variant 로 두 얼굴.
  //    TRIP-577 로 상호작용 배선: 드래그 핸들 길게눌러 재정렬(AC-1)·[시각 입력] 시트→시각 반영(AC-3)이
  //    이 프리뷰에서 실제로 동작한다(6-b 육안 그물 복원). 시트 실제 열림·드래그 제스처·점선 지도 픽셀은
  //    여전히 jest 사각(바텀시트·draggable 통과형 목)이라 이 키들이 육안 대조 자리다(i15 `2284:2106`·
  //    i22 `1790:3612`). 자체 조회 없는 프리젠테이션이라 QueryClient 없이 렌더된다 ──
  {
    key: 'planb-manual-normal',
    label: 'i15 일정 편집 · 정상([직접 고르기])',
    login: null,
    render: () => <ManualEditPreview />,
  },
  {
    key: 'planb-manual-fallback',
    label: 'i22 일정 직접 수정 · 폴백(외부 API 오류)',
    login: null,
    render: () => <ManualEditPreview variant="error" />,
  },
  {
    key: 'planb-manual-violation',
    label: 'i22 폴백 · 숙소 고정 충돌 위반 배지',
    login: null,
    render: () => (
      <ManualEditScreen
        variant="error"
        days={manualEditPreviewDays(true)}
        lockedSlotKeys={MANUAL_EDIT_PREVIEW_LOCKED}
        onBack={noop}
        onSave={noop}
        onDeleteSlot={noop}
        onEditSlotTime={noop}
        onPressAddPlace={noop}
      />
    ),
  },
  // ── i09 감지된 변화(TRIP-562) — 발화(날씨 활성)·정상(발화 없음) 두 얼굴. 순수 프레젠테이션이라
  //    사영 결과(triggerWatchlist)를 직접 주입한다(페이지·QueryClient 없이). 배너 primary 테두리·활성
  //    배지 rose·감시 행 아이콘·구분선 픽셀·진입 FAB 는 jest 사각이라 이 두 키가 육안 대조 자리다
  //    (i09 `1790:2869`). 자율 세션이라 6-b 미실행이면 다음 세션 확인 대상 ──
  {
    key: 'planb-triggers-active',
    label: 'i09 감지된 변화 · 발화(날씨 활성)',
    login: null,
    render: () => {
      const { activeBanner, rows } = triggerWatchlist(
        TRIGGER_WATCHLIST_PREVIEW_FIRED
      );
      return (
        <TriggerWatchlistScreen
          activeBanner={activeBanner}
          rows={rows}
          onPressAlternative={noop}
          onPressManual={noop}
          onBack={noop}
        />
      );
    },
  },
  {
    key: 'planb-triggers-normal',
    label: 'i09 감지된 변화 · 정상(발화 없음)',
    login: null,
    render: () => {
      const { activeBanner, rows } = triggerWatchlist([]);
      return (
        <TriggerWatchlistScreen
          activeBanner={activeBanner}
          rows={rows}
          onPressAlternative={noop}
          onPressManual={noop}
          onBack={noop}
        />
      );
    },
  },
  // l05 설정(TRIP-608) — 실화면 딥링크로는 미인증 리다이렉트/백엔드 부재로 온전히 못 본다. jest 가
  // 못 보는 것(6그룹 카드 레이아웃·리딩 아이콘 12종·"준비 중" 비활성·위험/동의 pill)을 여기서 눈으로.
  {
    key: 'settings-default',
    label: 'l05 설정 · 기본(active)',
    login: null,
    render: () => (
      <SettingsScreen
        groups={buildSettingsSections({
          nickname: '여행자123',
          email: 'trippilot@email.com',
        })}
        deletionState="active"
        currentNickname="여행자123"
        onPressBack={noop}
        onSubmitNickname={noop}
        onPressExport={noop}
        onPressDeleteAccount={noop}
        onPressCancelDeletion={noop}
      />
    ),
  },
  // 내보내기 잘림 고지(INV-4) — 상한에 걸려 잘린 몫을 조용히 삼키지 않고 표면화하는 자리.
  {
    key: 'settings-export-truncated',
    label: 'l05 설정 · 내보내기 잘림 고지',
    login: null,
    render: () => (
      <SettingsScreen
        groups={buildSettingsSections({
          nickname: '여행자123',
          email: null,
        })}
        deletionState="active"
        currentNickname="여행자123"
        truncatedLabel="일부 항목이 잘렸어요: photos, memos"
        onPressBack={noop}
        onSubmitNickname={noop}
        onPressExport={noop}
        onPressDeleteAccount={noop}
        onPressCancelDeletion={noop}
      />
    ),
  },
  // 내보내기 조회 실패 안내(TRIP-620 [608], INV-4) — refetch 가 data 미도착이면 조용히 삼키지 않고
  // 인라인 오류를 띄운다(잘림 고지와 별개 자리, 실패라 Share 핸드오프 없음).
  {
    key: 'settings-export-error',
    label: 'l05 설정 · 내보내기 조회 실패',
    login: null,
    render: () => (
      <SettingsScreen
        groups={buildSettingsSections({
          nickname: '여행자123',
          email: null,
        })}
        deletionState="active"
        currentNickname="여행자123"
        exportError="내보내기 정보를 불러오지 못했어요. 다시 시도해 주세요."
        onPressBack={noop}
        onSubmitNickname={noop}
        onPressExport={noop}
        onPressDeleteAccount={noop}
        onPressCancelDeletion={noop}
      />
    ),
  },
  // DELETION_PENDING 배너 — 위험 영역 행이 유예 배너로 바뀌고 purgeAt + [삭제 철회]가 뜬다.
  {
    key: 'settings-pending',
    label: 'l05 설정 · 삭제 유예(pending)',
    login: null,
    render: () => (
      <SettingsScreen
        groups={buildSettingsSections({
          nickname: '여행자123',
          email: 'trippilot@email.com',
        })}
        deletionState="pending"
        purgeAt="2026-09-13T00:00:00Z"
        currentNickname="여행자123"
        onPressBack={noop}
        onSubmitNickname={noop}
        onPressExport={noop}
        onPressDeleteAccount={noop}
        onPressCancelDeletion={noop}
      />
    ),
  },
  // 2단 삭제 다이얼로그 — 딤 전면 커버·2단 전이는 jest 원리적 사각(리포 Modal 선례 0). 여기서
  // [계속]을 눌러 1단(scope 전체 고지)→2단(최종) 전이를 실기로 확인한다.
  {
    key: 'settings-delete-dialog',
    label: 'l05 설정 · 삭제 다이얼로그(2단)',
    login: null,
    render: () => (
      <View style={StyleSheet.absoluteFill} className="bg-canvas-alt">
        <DeleteAccountDialog onCancel={noop} onConfirmDeletion={noop} />
      </View>
    ),
  },
  // l06 위치정보 동의 — 동의 ON default. 용도 3항목·계속 배너 육안 대조(글리프 SVG·틴트는 jest 사각).
  {
    key: 'l06-location-consent-default',
    label: 'l06 위치정보 동의 · 동의 ON',
    login: null,
    render: () => (
      <LocationConsentScreen
        consentOn
        disabled={false}
        impact={revokeImpact()}
        onGrant={noop}
        onRevokeConfirmed={noop}
        onOpenSettings={noop}
        onPressBack={noop}
      />
    ),
  },
  // l06 permission-denied — 토글 회색 비활성·부제 "사용 불가"·[설정 이동] 배너·전체 dimmed.
  {
    key: 'l06-location-consent-denied',
    label: 'l06 위치정보 동의 · OS 권한 거부',
    login: null,
    render: () => (
      <LocationConsentScreen
        consentOn={false}
        disabled
        impact={revokeImpact()}
        onGrant={noop}
        onRevokeConfirmed={noop}
        onOpenSettings={noop}
        onPressBack={noop}
      />
    ),
  },
  // l06 철회 재확인 다이얼로그 — 딤 전면 커버·모달 실제 열림은 jest 사각(608 동형). 중단3·계속2 구조화
  // 리스트(Q1 확정, Figma 산문 축약과 다름)를 실기로 확인한다.
  {
    key: 'l06-location-revoke-dialog',
    label: 'l06 위치정보 동의 · 철회 다이얼로그',
    login: null,
    render: () => (
      <View style={StyleSheet.absoluteFill} className="bg-canvas-alt">
        <RevokeConfirmDialog
          impact={revokeImpact()}
          onCancel={noop}
          onConfirm={noop}
        />
      </View>
    ),
  },
  // l05 개인화 — reason 3얼굴. 토글 상태·안내 문구·반영 목록이 reason 에서 함께 갈린다(다이얼로그 없이
  // 즉시 토글, 01b Q3). APPLIED = 토글 ON + 목록(문구 없음).
  {
    key: 'l05-personalization-applied',
    label: 'l05 개인화 · 반영 중(APPLIED)',
    login: null,
    render: () => (
      <PersonalizationScreen
        consentOn
        reason={PersonalizationInfoReason.APPLIED}
        sharedItems={[
          { item: '맛집 방문 기록', purpose: '다음 여행 맛집 추천' },
          { item: '야경 스팟 저장', purpose: '저녁 일정 배치' },
        ]}
        onToggle={noop}
        onPressBack={noop}
      />
    ),
  },
  // CONSENT_MISSING = 토글 OFF + "동의하면…" 안내 + 빈 목록.
  {
    key: 'l05-personalization-consent-missing',
    label: 'l05 개인화 · 미동의',
    login: null,
    render: () => (
      <PersonalizationScreen
        consentOn={false}
        reason={PersonalizationInfoReason.CONSENT_MISSING}
        sharedItems={[]}
        onToggle={noop}
        onPressBack={noop}
      />
    ),
  },
  // ★함정 얼굴: NOT_ENOUGH_RECORDS = 이미 동의(토글 ON 유지) + "기록이 더 쌓이면…", "동의하면…" 없음.
  {
    key: 'l05-personalization-not-enough',
    label: 'l05 개인화 · 기록 부족(동의 유지)',
    login: null,
    render: () => (
      <PersonalizationScreen
        consentOn
        reason={PersonalizationInfoReason.NOT_ENOUGH_RECORDS}
        sharedItems={[]}
        onToggle={noop}
        onPressBack={noop}
      />
    ),
  },
  // l01 알림함 — 기본(오늘 3·이전 2, 미읽음 dot·PLAN_B 인라인 링크). 딤·글리프 픽셀은 6-b 실기 몫.
  {
    key: 'notification-inbox-default',
    label: 'l01 알림함 · 기본',
    login: null,
    render: () => (
      <NotificationInboxScreen
        sections={NOTIFICATION_INBOX_PREVIEW_SECTIONS}
        isEmpty={false}
        onNavigate={noop}
        onPressBack={noop}
      />
    ),
  },
  // l01 알림함 — 엣지: 빈 알림함(StateNotice 대시 종 아이콘).
  {
    key: 'notification-inbox-empty',
    label: 'l01 알림함 · 빈 상태',
    login: null,
    render: () => (
      <NotificationInboxScreen
        sections={[]}
        isEmpty
        onNavigate={noop}
        onPressBack={noop}
      />
    ),
  },
];

// 딥링크에 state 쿼리가 없거나 알 수 없는 값이면 이 키로 결정론적으로 폴백한다(INV-4 정신).
// 소스를 고쳐 조준하던 옛 수동 플로우(주석 기록)는 이제 딥링크가 대신한다.
const INITIAL_STATE_KEY = 'splash';

const PREVIEW_STATE_KEYS = new Set(PREVIEW_STATES.map((state) => state.key));

// 딥링크(`?state=X`)로 받은 값을 초기 상태 키로 해석한다. 문자열이 아니거나(배열·undefined)
// 목록에 없는 키면 전부 splash 로 떨어진다 — "부분적으로 해석"하지 않는 게 결정론이다.
function resolveInitialStateKey(
  rawState: string | string[] | undefined
): string {
  if (typeof rawState !== 'string' || !PREVIEW_STATE_KEYS.has(rawState)) {
    return INITIAL_STATE_KEY;
  }
  return rawState;
}

export default function DevPreviewScreen() {
  // useLocalSearchParams: expo-router 훅 — 현재 화면 URL 의 쿼리 문자열을 객체로 돌려준다.
  // 라우터 컨텍스트가 없어도(동결 devPreview.test) 빈 객체를 돌려주도록 expo-router 가
  // 보장한다 — 그래서 목 없이 렌더해도 크래시 없이 기존 초기 상태(splash)로 떨어진다.
  const { state: rawState } = useDevPreviewSearchParams();
  // 지연 초기화자(() => ...)는 최초 렌더에서 딱 한 번만 실행된다 — 그래서 딥링크는
  // "초기 상태"만 정하고, 이후 rawState 가 바뀌어도(사실상 안 바뀌지만) activeKey 를
  // 다시 덮어쓰지 않는다. 토글은 setActiveKey 로 계속 동작한다.
  const [activeKey, setActiveKey] = useState(() =>
    resolveInitialStateKey(rawState)
  );
  const active =
    PREVIEW_STATES.find((state) => state.key === activeKey) ??
    PREVIEW_STATES[0];

  return (
    <View testID="dev-preview-root" className="flex-1 bg-white">
      {/*
       * 화면을 루트 전체 높이로 먼저 그린다 — 토글 바가 세로로 밀지 않도록.
       * 그려지는 화면은 실기와 같은 "원래 위치"(전체 높이)를 갖는다.
       */}
      <View className="flex-1">
        {active.render ? (
          active.render()
        ) : active.login ? (
          <SocialLoginScreen {...active.login} {...VIEW_ONLY_HANDLERS} />
        ) : (
          <SplashScreen />
        )}
      </View>

      {/*
       * 토글 바는 화면 위에 뜨는 오버레이(absolute)다 — 화면을 아래로 밀지 않는다.
       * SafeAreaView(top)로 상태바/노치를 피한다(이제 앱에 SafeAreaProvider 가 있다).
       * pointerEvents='box-none' 이라 바 밖(투명 영역)의 탭은 아래 화면으로 통과한다.
       */}
      <SafeAreaView
        edges={['top']}
        pointerEvents="box-none"
        style={StyleSheet.absoluteFill}
        className="justify-start"
      >
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          // flexGrow:0 으로 바 높이를 내용물 크기로 고정(세로로 늘어나지 않게).
          style={{ flexGrow: 0 }}
          contentContainerStyle={{ gap: 8, padding: 12, alignItems: 'center' }}
        >
          {PREVIEW_STATES.map((state) => {
            const selected = state.key === active.key;
            return (
              <Pressable
                key={state.key}
                testID={`dev-preview-state-${state.key}`}
                onPress={() => setActiveKey(state.key)}
                className={`rounded-lg px-3 py-2 ${
                  selected ? 'bg-blue-600' : 'bg-gray-700'
                }`}
              >
                <Text className="text-xs text-white">{state.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
