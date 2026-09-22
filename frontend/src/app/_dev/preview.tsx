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
  HOME_DEFAULT_PROPS,
  HOME_LOADING_PROPS,
  HOME_PLANNING_PROPS,
  HOME_POST_TRIP_PROPS,
  HOME_TRAVELING_PROPS,
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
import { MemoInline } from '@/features/record/ui/MemoInline';
import { PhotoThumbStrip } from '@/features/record/ui/PhotoThumbStrip';
import { RecordsCalendarScreen } from '@/features/record/ui/RecordsCalendarScreen';
import { TripRecordsScreen } from '@/features/record/ui/TripRecordsScreen';
import { VisitRecordCard } from '@/features/record/ui/VisitRecordCard';
import { VisitTimeSheet } from '@/features/record/ui/VisitTimeSheet';
import { SHARE_FORMATS } from '@/features/reflection/model/shareCard';
import { DailyReflectionScreen } from '@/features/reflection/ui/DailyReflectionScreen';
import { ShareCardScreen } from '@/features/reflection/ui/ShareCardScreen';
import { TravelStyleScreen } from '@/features/reflection/ui/TravelStyleScreen';
import { TripSummaryScreen } from '@/features/reflection/ui/TripSummaryScreen';
import { DestinationDetailScreen } from '@/features/explore/ui/DestinationDetailScreen';
import { MustVisitPickScreen } from '@/features/explore/ui/MustVisitPickScreen';
import { PlaceDetailScreen as ExplorePlaceDetailScreen } from '@/features/explore/ui/PlaceDetailScreen';
import { PlaceExploreScreen } from '@/features/explore/ui/PlaceExploreScreen';
import { RegionPickerScreen } from '@/features/explore/ui/RegionPickerScreen';
import { SavedPlaceListScreen } from '@/features/explore/ui/SavedPlaceListScreen';
import {
  ExploreLandingScreen,
  type StayCardVM,
} from '@/features/explore/ui/ExploreLandingScreen';
import { HomeScreen } from '@/features/home/ui/HomeScreen';
import { MAGAZINE_DEFAULT_PROPS } from '@/features/home/model/magazineFixtures';
import { MagazineScreen } from '@/features/home/ui/MagazineScreen';
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
import { MustVisitPickerScreen } from '@/features/itinerary/ui/MustVisitPickerScreen';
import { MustVisitTimeScreen } from '@/features/itinerary/ui/MustVisitTimeScreen';
import { OptionSwapScreen } from '@/features/itinerary/ui/OptionSwapScreen';
import {
  PlaceAddHeader,
  PlaceAddRow,
} from '@/features/itinerary/ui/PlaceAddScreen';
import { SlotCandidatePanel } from '@/features/itinerary/ui/SlotCandidatePanel';
import { GenerationDoneBar } from '@/widgets/generation-done-bar/ui/GenerationDoneBar';
import { DistanceConnector } from '@/widgets/map-sheet-shell/ui/DistanceConnector';
import { GenerationProgressCard } from '@/widgets/map-sheet-shell/ui/GenerationProgressCard';
import { MapSheetShell } from '@/widgets/map-sheet-shell/ui/MapSheetShell';
import { SheetHeader } from '@/widgets/map-sheet-shell/ui/SheetHeader';
import { SlotStopCard } from '@/entities/itinerary-slot/ui/SlotStopCard';
import { buildSlotKey } from '@/entities/itinerary-slot/lib/slotKey';
import { TimeSheet } from '@/widgets/time-sheet/ui/TimeSheet';
import { MethodPickerScreen } from '@/features/itinerary/ui/MethodPickerScreen';
import {
  MyTripCard,
  type MyTripCardVM,
} from '@/features/itinerary/ui/MyTripCard';
import { MyTripsListScreen } from '@/features/itinerary/ui/MyTripsListScreen';
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
import { ManualEditScreen } from '@/pages/planb-manual/ui/ManualEditScreen';
import { ReplanRequestSheet } from '@/features/planb/ui/ReplanRequestSheet';
import { ReplanAppliedScreen } from '@/features/planb/ui/ReplanAppliedScreen';
import { ReplanDraftScreen } from '@/features/planb/ui/ReplanDraftScreen';
import { ReplanSolvingScreen } from '@/features/planb/ui/ReplanSolvingScreen';
import { NoAlternativeScreen } from '@/features/planb/ui/NoAlternativeScreen';
import type { ReplanSlotVM } from '@/entities/itinerary-slot/model';
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
import { StayFilterSheet } from '@/features/stay/ui/StayFilterSheet';
import {
  TripWizardStep1Screen,
  type TripWizardStep1ScreenProps,
} from '@/features/trip/ui/TripWizardStep1Screen';
import { CompanionEditSheet } from '@/features/trip/ui/CompanionEditSheet';
import { DestinationEditSheet } from '@/features/trip/ui/DestinationEditSheet';
import { PeriodEditSheet } from '@/features/trip/ui/PeriodEditSheet';
import { StaySelectSheet } from '@/features/trip/ui/StaySelectSheet';
import { LiveLocationPage } from '@/pages/live-location';
import { ConfirmedBanner } from '@/pages/itinerary-plan/ui/ConfirmedBanner';
import { NoBaseNoticeCard } from '@/pages/itinerary-plan/ui/NoBaseNoticeCard';
import { EditorView } from '@/pages/itinerary-edit/ui/EditorView';
import { BudgetEditSheet } from '@/pages/trip-new-step1/ui/BudgetEditSheet';
import { PrefOverrideSheet } from '@/pages/trip-new-step1/ui/PrefOverrideSheet';
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
import { buildMonthGrid } from '@/shared/date/monthGrid';
import { reorderKeepingFixed } from '@/widgets/itinerary-edit';
import { LocationPreprompt } from '@/shared/location/LocationPreprompt';
import { revokeImpact } from '@/shared/location/revokeImpact';
import { MapView, type MapPin } from '@/shared/map';
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
    price: { amount: 210000, currency: 'KRW' },
  },
  {
    externalSource: 'NAVER',
    externalId: 's4',
    name: '남포동 스테이',
    lat: 35.0977,
    lng: 129.0305,
    region: '남포동',
    amenities: ['wifi'],
    stayType: 'HOTEL',
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
// 장소 가로 레인(TRIP-470) — 프리뷰 표본 카드. TRIP-703 으로 Figma d01(1672:1183) 정합상 5장.
// `imageUrl` 미지정(=회색 자리, INV-1 — 실사진 소싱은 6-b·후속). `as const` 밖에 둬야 cards 가
// readonly 튜플로 안 굳는다(placeLane.cards 는 PlaceCardVM[] 요구).
const EXPLORE_LANDING_PLACE_LANE = {
  error: false,
  cards: [
    { poiId: 'p1', name: '감천문화마을', region: '사하구' },
    { poiId: 'p2', name: '광안리 해변', region: '수영구' },
    { poiId: 'p3', name: '전포 카페거리', region: '부산진구' },
    { poiId: 'p4', name: '자갈치시장', region: '중구' },
    { poiId: 'p5', name: '해운대 블루라인', region: '해운대구' },
  ],
  onRetry: noop,
  onPressCard: noop,
};

const EXPLORE_LANDING_BASE = {
  heading: {
    title: '무엇을 둘러볼까요?',
    subtitle: '숙소·장소를 둘러보고 담아요',
  },
  onPressSearch: noop,
  onPressPlaces: noop,
  onPressCreateTrip: noop,
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

// Figma 밴드 분류(first-cut 9) + 프레임·코드 둘 다 없는 발명 화면용 '기타'(TRIP-641).
// 파트 2 네비가 이 값으로 166개 상태를 그룹핑한다 — figma-structure.md 밴드 표가 근거.
type Band = 'a' | 'c' | 'd' | 'e' | 'g' | 'h' | 'i' | 'j' | 'l' | '기타';

interface PreviewState {
  key: string;
  label: string;
  // 이 상태가 속한 Figma 밴드(그룹핑 축). 166개 엔트리 전부 명시(파생 아님 — 위치 불규칙로 취약).
  band: Band;
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

// TRIP-710 d06 프리뷰 히어로 — 로컬 라이선스 에셋 재사용(assets/home/hero-view.jpg, CREDITS.md 有).
// DRAFT_PREVIEW_PHOTOS 와 같은 패턴: jest 는 .uri 가 undefined 라 회색 자리, 실기만 사진(INV-1 안전).
const PLACE_DETAIL_PREVIEW_IMAGE: string | null =
  Image.resolveAssetSource?.(require('@/assets/home/hero-view.jpg'))?.uri ??
  null;

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

/**
 * TRIP-783 · h08 지도+시트 셸 접힘 프리뷰(Figma `4221:2448`) — 광안리 해변·황령산 전망대·
 * 부산시립미술관(필수)·웨이브온 카페 4슬롯 + 시각 칩. 미술관은 `imageUrl:null` 이라 카테고리
 * 플레이스홀더도 함께 보인다. 사진은 DRAFT 픽스처 재사용(require 자산 → jest 는 null, 실기만 썸네일
 * — preview.tsx 에 http 리터럴 0 유지). 셸이 `<MapView>` 를 소유하므로 여기선 지도 태그를 안 쓴다.
 */
const H08_PREVIEW_SLOTS: ItineraryDaysItemSlotsItem[] = [
  {
    poiId: 'h08-gwangalli',
    startAt: '10:00:00',
    endAt: '11:00:00',
    isFixed: false,
    endsNextDay: false,
    hasViolation: false,
    nameKo: '광안리 해변',
    category: '자연',
    tags: ['바다', '산책'],
    imageUrl: DRAFT_PREVIEW_PHOTOS[0],
    lat: 35.1532,
    lng: 129.1188,
  },
  {
    poiId: 'h08-hwangnyeong',
    startAt: '11:30:00',
    endAt: '12:10:00',
    isFixed: false,
    endsNextDay: false,
    hasViolation: false,
    nameKo: '황령산 전망대',
    category: '자연',
    tags: ['전망', '야경'],
    imageUrl: DRAFT_PREVIEW_PHOTOS[1],
    lat: 35.1372,
    lng: 129.1005,
  },
  {
    poiId: 'h08-museum',
    startAt: '13:00:00',
    endAt: '14:30:00',
    isFixed: false,
    endsNextDay: false,
    hasViolation: false,
    nameKo: '부산시립미술관',
    category: '문화',
    tags: ['전시', '실내'],
    imageUrl: null,
    lat: 35.1697,
    lng: 129.1339,
  },
  {
    poiId: 'h08-waveon',
    startAt: '15:30:00',
    endAt: '16:30:00',
    isFixed: false,
    endsNextDay: false,
    hasViolation: false,
    nameKo: '웨이브온 카페',
    category: '카페',
    tags: ['카페', '오션뷰'],
    imageUrl: DRAFT_PREVIEW_PHOTOS[2],
    lat: 35.1889,
    lng: 129.2088,
  },
];

// 시각 칩 문구(en-dash `–`). 초안도 검증 시각 표시(3-a 결정) — 카드는 받은 문자열만 그린다.
const H08_PREVIEW_TIME_LABELS = [
  '10:00–11:00',
  '11:30–12:10',
  '13:00–14:30',
  '15:30–16:30',
];

// 카드 사이 커넥터 3개(Figma 4221:2448): leg1 광안리→황령산 차량 2.1km, leg2 0.8km·leg3 0.6km 도보.
// 합 3.5km = 시트 헤더 `4곳 · 3.5km`(내부 일치). leg1 차량/leg2·3 도보라 두 이동수단 글리프도 함께 보인다.
const H08_PREVIEW_CONNECTORS = ['차량 · 2.1km', '0.8km', '0.6km'];

const H08_PREVIEW_DATE = '2026-06-10';

// h11 같이 결과(CoPick 완료, TRIP-796) — 비고정 4 + 고정 숙소 1(21:00). 고정 슬롯은 단일 시각·부제·
// 고정 배지, 비고정은 시각 범위 칩만(다른 후보 링크 없음). meta 는 비고정 4 → `4/4 골랐어요`.
const H11_COPICK_PREVIEW_SLOTS: ItineraryDaysItemSlotsItem[] = [
  {
    poiId: 'copick-gwangalli',
    startAt: '10:00:00',
    endAt: '11:00:00',
    isFixed: false,
    endsNextDay: false,
    hasViolation: false,
    nameKo: '광안리 해변',
    category: '자연',
    tags: ['바다', '산책'],
    imageUrl: DRAFT_PREVIEW_PHOTOS[0],
    distanceRange: null,
    lat: 35.1532,
    lng: 129.1188,
  },
  {
    poiId: 'copick-hwangnyeong',
    startAt: '11:30:00',
    endAt: '12:10:00',
    isFixed: false,
    endsNextDay: false,
    hasViolation: false,
    nameKo: '황령산 전망대',
    category: '자연',
    tags: ['전망', '야경'],
    imageUrl: DRAFT_PREVIEW_PHOTOS[1],
    distanceRange: '차량 · 2.1km',
    lat: 35.1372,
    lng: 129.1005,
  },
  {
    poiId: 'copick-museum',
    startAt: '13:00:00',
    endAt: '14:30:00',
    isFixed: false,
    endsNextDay: false,
    hasViolation: false,
    nameKo: '부산시립미술관',
    category: '문화',
    tags: ['전시', '실내'],
    imageUrl: null,
    distanceRange: '0.8km',
    lat: 35.1697,
    lng: 129.1339,
  },
  {
    poiId: 'copick-waveon',
    startAt: '15:30:00',
    endAt: '16:30:00',
    isFixed: false,
    endsNextDay: false,
    hasViolation: false,
    nameKo: '웨이브온 카페',
    category: '카페',
    tags: ['카페', '오션뷰'],
    imageUrl: DRAFT_PREVIEW_PHOTOS[2],
    distanceRange: '0.6km',
    lat: 35.1889,
    lng: 129.2088,
  },
  {
    poiId: 'copick-hotel',
    startAt: '21:00:00',
    endAt: '21:00:00',
    isFixed: true,
    endsNextDay: false,
    hasViolation: false,
    nameKo: '해운대 그랜드 호텔',
    category: '숙소',
    tags: [],
    imageUrl: null,
    distanceRange: '0.6km',
    lat: 35.163,
    lng: 129.16,
  },
];

const H11_COPICK_PREVIEW_DATE = '2026-06-10';

// h14 완성 일정(PLANNED, TRIP-799) 지도+시트 셸 프리뷰 — 페이지(ItineraryPlanPage)는 react-query·
// 라우터가 필요해 프리뷰에서 직접 못 쓰므로, 페이지의 셸 조립을 축소해 4얼굴(default·거리계산중·지도
// 폴백·거점없음)을 데이터 입력만 달리해 그린다(h11-copick-complete 선례). 슬롯은 h11 결과 픽스처를
// 재사용한다(default 에 사진 없는 슬롯 1개 포함 — copick-museum·hotel imageUrl null).
const H14_PLAN_PREVIEW_DATE = H11_COPICK_PREVIEW_DATE;
const H14_PLAN_PENDING_SLOTS: ItineraryDaysItemSlotsItem[] =
  H11_COPICK_PREVIEW_SLOTS.map((slot) => ({ ...slot, distanceRange: null }));
const H14_PLAN_NO_BASE_SLOTS = H11_COPICK_PREVIEW_SLOTS.slice(0, 4);

// 지도 폴백 바(TRIP-799 D5) — 지도 스트립 자리에 얹는 한 줄 안내 + [다시 시도] pill. 페이지는 실
// 런타임 감지(MapView onLoadFailed)를 아직 배선하지 않아(맹점②, 03 follow-up) 이 프리뷰가 폴백 얼굴을
// 보는 유일한 자리다 — 강제 주입한다.
const H14_MAP_FALLBACK: ReactElement = (
  <View className="flex-1 bg-surface-soft px-lg pt-[72px]">
    <View className="flex-row items-center justify-between gap-sm rounded-card border border-hairline bg-canvas px-md py-sm">
      <Text className="flex-1 font-noto text-caption text-muted">
        ⊘ 지도를 불러올 수 없어요 · 일정은 아래 목록에서 볼 수 있어요
      </Text>
      <Pressable className="rounded-pill border border-hairline-strong bg-canvas px-md py-[6px]">
        <Text className="font-noto-bold text-caption font-bold text-ink">
          ↻ 다시 시도
        </Text>
      </Pressable>
    </View>
  </View>
);

function renderH14PlanSheet(options: {
  slots: ItineraryDaysItemSlotsItem[];
  meta: string;
  mapFallback?: ReactElement;
  noBase?: boolean;
}): ReactElement {
  const { slots, meta, mapFallback, noBase } = options;
  return (
    <MapSheetShell
      center={{ lat: 35.1532, lng: 129.1188 }}
      pins={buildDraftPins(slots)}
      days={[
        { label: '1일차' },
        { label: '2일차' },
        { label: '3일차' },
        { label: '4일차' },
      ]}
      selectedDayIndex={0}
      onSelectDay={noop}
      onBack={noop}
      mapFallback={mapFallback}
      header={
        <SheetHeader
          title="부산 여행"
          dayLabel="1일차"
          dateLabel="6월 10일(수)"
          meta={meta}
        />
      }
      cta={[{ label: '일정 저장하기', variant: 'primary', onPress: noop }]}
    >
      <View className="gap-md px-lg pb-2xl pt-xs">
        {slots.flatMap((slot, index) => {
          const timeLabel = slot.isFixed
            ? slot.startAt.slice(0, 5)
            : `${slot.startAt.slice(0, 5)}–${slot.endAt.slice(0, 5)}`;
          const items: ReactElement[] = [
            <SlotStopCard
              key={`card-${slot.poiId}`}
              slot={slot}
              date={H14_PLAN_PREVIEW_DATE}
              index={index}
              timeLabel={timeLabel}
              fixed={slot.isFixed}
              subtitle={slot.isFixed ? '저녁 · 숙소 · 변경 불가' : undefined}
            />,
          ];
          if (index < slots.length - 1) {
            const nextSlot = slots[index + 1];
            items.push(
              <DistanceConnector
                key={`conn-${slot.poiId}`}
                slotKey={buildSlotKey(H14_PLAN_PREVIEW_DATE, slot.poiId)}
                distanceRange={nextSlot.distanceRange}
              />
            );
          }
          return items;
        })}
        {noBase ? <NoBaseNoticeCard onPress={noop} /> : null}
      </View>
    </MapSheetShell>
  );
}

/**
 * g02 거점 숙소 2/4 default 의 대표값(TRIP-672, Figma `3657:2068` 재작성) — 박별(1박=1행) 거점
 * 카드. 배선(`nightlyBaseCards`)이 낼 값과 같은 모양으로, 앞 두 밤은 배정된 숙소명, 마지막 밤은
 * 미배정(→ 화면이 "숙소 미정"으로 그린다). 다른 변형은 이걸 스프레드하고 갈리는 prop 만 덮는다.
 *
 * 왜 프리뷰가 필요한가: 실화면 딥링크로는 **`notrip` 얼굴밖에 볼 수 없다.** 나머지 셋은
 * `tripId`가 있어야 하는데 그건 g01 제출(`POST /trips`)이 만들고, 백엔드 없이는 안 생긴다.
 */
const TRIP_BASE_SCREEN: TripWizardStep2ScreenProps = {
  variant: 'default',
  // TRIP-740 AC-D2 — 3박 전부 배정 + 썸네일/위치로 채워 Figma `3657:2068`(단일 카드 + 썸네일 +
  // 위치·거리 줄)과 육안 대조가 되게 한다. imageUrl 은 위 `DRAFT_PREVIEW_PHOTOS`(로컬 에셋 resolve
  // URI, jest 스텁에선 null) 재사용 — 신규 사진 소싱 0. 프로덕션은 계약 공백이라 이 값들이 늘
  // undefined 라 실앱은 "현행 2줄"로 뜬다(정직한 degrade, BE 후속 TRIP-823까지) — 함정 ★7.
  cards: [
    {
      nightNumber: 1,
      dateLabel: '6/10(수)',
      region: '부산',
      stayName: '해운대 오션 호텔',
      imageUrl: DRAFT_PREVIEW_PHOTOS[0],
      locationLabel: '해운대',
    },
    {
      nightNumber: 2,
      dateLabel: '6/11(목)',
      region: '부산',
      stayName: '광안리 뷰 호텔',
      imageUrl: DRAFT_PREVIEW_PHOTOS[1],
      locationLabel: '광안리',
    },
    {
      nightNumber: 3,
      dateLabel: '6/12(금)',
      region: '경주',
      stayName: '경주 한옥스테이 봄',
      imageUrl: DRAFT_PREVIEW_PHOTOS[2],
      locationLabel: '경주 황남동',
    },
  ],
  onPressCard: noop,
  onGenerate: noop,
  onNoStayStart: noop,
  onBrowseStays: noop,
  onBack: noop,
  onRetryAll: noop,
  onRestart: noop,
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
/** g01 신 default(TRIP-665, Figma `3742:2068`) — 온보딩 반영이 다 채워진 요약 5행 완성형 문자열
 * (페이지 `tripSummary` 셀렉터가 낼 실제 값과 같은 형태 · en dash·미들닷 그대로). 요일은 실제
 * 달력값 (수)(토)다. 스트립은 키마다 `mustVisits` 만 갈아 끼운다. */
const TRIP_WIZARD_BASE: TripWizardStep1ScreenProps = {
  summaryDestinations: { main: '부산', sub: '2박 · 경주 1박' },
  summaryPeriod: { main: '6월 10일(수) – 13일(토)', sub: '3박 4일' },
  summaryCompanion: { main: '친구 2명' },
  summaryPreferences: { main: '미식 · 전시 · 야경', onboarding: true },
  summaryBudget: { main: '120만원', sub: '1인 총액 · 중간' },
  onPressSummaryDestination: noop,
  onPressSummaryPeriod: noop,
  onPressSummaryCompanion: noop,
  onPressSummaryPreference: noop,
  onPressSummaryBudget: noop,
  mustVisits: [],
  onPressMore: noop,
  onPressSeeAll: noop,
  canProceed: true,
  onNext: noop,
  onBack: noop,
};

/** 꼭 갈 곳 스트립 시드(`MustVisitSeedItem[]`) — g01 default(Figma `3742:2068`)가 그린 6장의
 * 이름·구를 그대로 옮긴 것이다. 헤더 "7"은 카드 6장과 어긋난 Figma 쪽 오류라 7번째를 지어내지
 * 않는다(INV-1, 발명 금지 — TRIP-811 Figma 동기 대상). `imageUrl` 은 번들 사진
 * `DRAFT_PREVIEW_PHOTOS`(draft-preview 1/2/3)를 1,2,3,1,2,3 으로 순환 배선한다 — 로컬 에셋이라
 * 외부 URL 발명이 아니다(740·741 동일 선례, 새 소싱·CREDITS 갱신 0). jest 에선 에셋 스텁의
 * `.uri` 가 `undefined` 라 사진 없는 카드가 되고 실기에서만 뜬다(6-b 육안). `region` 은 이름 아래
 * 지역선(TRIP-685 6-b 대조용). 순수 데이터 테스트가 이름·구를 직접 읽어 `export` 한다(PREVIEW_STATES 선례). */
export const MUST_VISIT_THUMBNAILS = [
  {
    sourcePoiId: 'poi-1',
    name: '감천문화마을',
    imageUrl: DRAFT_PREVIEW_PHOTOS[0],
    region: '사하구',
  },
  {
    sourcePoiId: 'poi-2',
    name: '광안리 해변',
    imageUrl: DRAFT_PREVIEW_PHOTOS[1],
    region: '수영구',
  },
  {
    sourcePoiId: 'poi-3',
    name: '전포 카페거리',
    imageUrl: DRAFT_PREVIEW_PHOTOS[2],
    region: '부산진구',
  },
  {
    sourcePoiId: 'poi-4',
    name: '해운대 해변',
    imageUrl: DRAFT_PREVIEW_PHOTOS[0],
    region: '해운대구',
  },
  {
    sourcePoiId: 'poi-5',
    name: '해동용궁사',
    imageUrl: DRAFT_PREVIEW_PHOTOS[1],
    region: '기장군',
  },
  {
    sourcePoiId: 'poi-6',
    name: '자갈치 시장',
    imageUrl: DRAFT_PREVIEW_PHOTOS[2],
    region: '중구',
  },
];

/**
 * h12 편집기(EditorView, TRIP-797) 프리뷰 픽스처 — 슬롯 4개가 오전/저녁/점심 시간대·고정·위반·자정
 * 넘김을 한 벌로 덮는다(옛 h24 ItineraryEditScreen 은 TRIP-797 로 h12 편집기로 수렴). 2일자라
 * 일차 칩(AC-4)도 함께 대조된다.
 */
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

// 내 여행 목록(h05/h06, TRIP-788) 카드 VM 4종 — 완성(사진 픽스처)·생성중(resume 없음)·초안(resume)·
// 미도착(배지 degrade). 순수 카드라 픽스처를 얹어 네 얼굴을 한 화면에서 본다(컨테이너·react-query 없이).
// 완성 상태문은 Figma 정합(TRIP-788)으로 '추천안이 준비됐어요'(구 '확정 장소 N곳' 대체), imageUrl 은
// DRAFT_PREVIEW_PHOTOS(로컬 에셋 resolve — jest 는 .uri undefined 라 회색, 실기만 사진).
const MY_TRIPS_PREVIEW_VMS: MyTripCardVM[] = [
  {
    tripId: 'demo-done',
    title: '서귀포시 여행',
    metaLine: '6월 10일 ~ 13일 · 3박 4일 · 2명',
    badge: 'done',
    extra: '추천안이 준비됐어요',
    imageUrl: DRAFT_PREVIEW_PHOTOS[0],
  },
  {
    tripId: 'demo-generating',
    title: '제주 여행',
    metaLine: '9월 5일 ~ 7일 · 2박 3일 · 2명',
    badge: 'draft',
    extra: 'AI가 일정을 짜는 중',
    resume: false,
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
 * e05 숙소 등록(TRIP-730 세대 병합) — 3탭 셸 + default 확정 콘텐츠. 네 얼굴을 파생 규칙
 * (`coordConfirmed`·`candidates`·`searchStatus`)로 가른다(새 flow 필드 없음). 15개 콜백은
 * 전부 noop 이라 아래 `STAY_REGISTER_HANDLERS` 한 벌로 스프레드한다.
 *
 * 왜 프리뷰가 필요한가: jest 는 세그먼트 흰 알약·라디오 채움·침대/체크/달력/↻ 글리프·지도
 * 타일·선택 카드 픽셀을 원리적으로 못 본다(02a §5 ★2~★4) — 이 4키가 6-b 육안의 유일한 그물이다.
 */
const STAY_REGISTER_CANDIDATE_A = {
  name: '해운대 그랜드 호텔',
  address: '부산 해운대구 우동 1407',
  lat: 35.1587,
  lng: 129.1604,
};
const STAY_REGISTER_CANDIDATE_B = {
  name: '해운대 그랜드 레지던스',
  address: '부산 해운대구 중동 1124',
  lat: 35.1601,
  lng: 129.1652,
};

const STAY_REGISTER_BASE_FLOW: StayRegisterScreenProps['flow'] = {
  activeTab: 'mapsearch',
  query: '해운대',
  name: '',
  searchStatus: 'success',
  candidates: [STAY_REGISTER_CANDIDATE_A],
  selectedCandidate: STAY_REGISTER_CANDIDATE_A,
  coordSource: 'MAP_SEARCH',
  pinAddressStatus: 'idle',
  coordConfirmed: false,
  mapSheetState: 'closed',
  checkIn: null,
  checkOut: null,
  dateSheetOpen: false,
  submitStatus: 'idle',
};

/** multi-candidate(Figma 1354) — 후보 2건, 첫 건 선택, 좌표 미확정. 라디오 리스트 + "등록하기". */
const STAY_REGISTER_MULTI_CANDIDATE_FLOW: StayRegisterScreenProps['flow'] = {
  ...STAY_REGISTER_BASE_FLOW,
  candidates: [STAY_REGISTER_CANDIDATE_A, STAY_REGISTER_CANDIDATE_B],
  selectedCandidate: STAY_REGISTER_CANDIDATE_A,
};

/** default(Figma 1703) — 좌표 확정 + 날짜 선택 완료. 확정 카드 + 요일 날짜 필드 + "✓ 이 숙소 등록". */
const STAY_REGISTER_DEFAULT_FLOW: StayRegisterScreenProps['flow'] = {
  ...STAY_REGISTER_BASE_FLOW,
  coordConfirmed: true,
  checkIn: '2026-06-10',
  checkOut: '2026-06-12',
};

/** multi(Figma 1358) — 단일 후보 선택, 좌표 미확정. coordnotice(민트 ⓘ) + disabled CTA. */
const STAY_REGISTER_MULTI_FLOW: StayRegisterScreenProps['flow'] = {
  ...STAY_REGISTER_BASE_FLOW,
};

/** error-mapapi(Figma 1359) — 지도 검색 실패. 배너(⚠·↻) → 핀 지정(h48) → 숙소명 → disabled CTA. */
const STAY_REGISTER_ERROR_FLOW: StayRegisterScreenProps['flow'] = {
  ...STAY_REGISTER_BASE_FLOW,
  searchStatus: 'error',
  candidates: [],
  selectedCandidate: null,
  coordConfirmed: false,
};

/** e05 화면의 콜백 15종은 프리뷰에서 전부 무동작 — 한 벌로 스프레드한다. */
const STAY_REGISTER_HANDLERS = {
  onBack: noop,
  onSelectTab: noop,
  onChangeQuery: noop,
  onChangeName: noop,
  onSubmitQuery: noop,
  onRetrySearch: noop,
  onSelectCandidate: noop,
  onPickCoord: noop,
  onOpenMapSheet: noop,
  onConfirmCoord: noop,
  onCloseMapSheet: noop,
  onOpenDateSheet: noop,
  onPickDate: noop,
  onCloseDateSheet: noop,
  onSubmit: noop,
};

/** e05 핀 지정 탭(TRIP-724 복원, Figma 4520:2413) — 핀 탭 진입·핀 찍기 전. 코드 `PinPanel`은
 * 730에서 유지됐고 프리뷰 키만 이번에 복원한다(19키 재산정). 픽셀 정합은 이후 티켓(존재+렌더까지). */
const STAY_REGISTER_PIN_FLOW: StayRegisterScreenProps['flow'] = {
  ...STAY_REGISTER_BASE_FLOW,
  activeTab: 'pin',
  query: '',
  searchStatus: 'idle',
  candidates: [],
  selectedCandidate: null,
  coordSource: 'PIN',
  coordConfirmed: false,
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

// e04 저장한 숙소(TRIP-461 → TRIP-729 Figma 정합) — 사진은 계약 공백이라 회색 자리, 거점 배지·
// 지역줄·2톤 가격은 계약 공백이라 실앱에선 안 뜬다(degrade). 그 Figma 풀샷을 눈으로 보는 유일한
// 자리라 여기서만 픽스처로 채운다(ss-1 은 거점 배지 포함). 날짜라벨은 e04 에서 뗐다(F-10).
const SAVED_STAY_PREVIEW_CARDS: SavedStayCardVM[] = [
  {
    savedStayId: 'ss-1',
    name: '해운대 오션 호텔',
    isBase: true,
    region: '해운대',
    priceLabel: '145,000원~',
  },
  {
    savedStayId: 'ss-2',
    name: '광안리 뷰 호텔',
    region: '광안리',
    priceLabel: '98,000원~',
  },
  {
    savedStayId: 'ss-3',
    name: '감천 게스트하우스',
    region: '감천',
    priceLabel: '62,000원~',
  },
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

// map-default(TRIP-745) — 핀 3상태를 한 지도에서 대조하는 픽스처. done 둘·current 하나·upcoming
// 둘로 번호 뜀(①②③④⑤ 는 모두 좌표가 있어 연속). 좌표는 서울 도심 ~1.5km 안.
const MAP_STATE_PREVIEW_PINS: MapPin[] = [
  { number: 1, lat: 37.5698, lng: 126.9762, state: 'done' },
  { number: 2, lat: 37.5674, lng: 126.98, state: 'done' },
  { number: 3, lat: 37.566, lng: 126.9772, state: 'current' },
  { number: 4, lat: 37.5642, lng: 126.9818, state: 'upcoming' },
  { number: 5, lat: 37.5615, lng: 126.9847, state: 'upcoming' },
];

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
        <TimeSheet
          testIDPrefix="planb-manual-time"
          labels={{ start: '도착', end: '출발' }}
          title="시각 입력"
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

// AC-6 데이터 무결성 테스트(devPreviewBandNav)가 이 배열을 순수 데이터로 import 한다 → named export.
export const PREVIEW_STATES: PreviewState[] = [
  { key: 'splash', band: 'c', label: 'c01 · 기본', login: null },
  {
    key: 'login-idle',
    band: 'c',
    label: 'c02 · 기본',
    login: { phase: 'idle', errorCode: null, conflictProvider: null },
  },
  {
    key: 'login-cancelled',
    band: 'c',
    label: 'c02 · 취소',
    login: { phase: 'cancelled', errorCode: null, conflictProvider: null },
  },
  {
    key: 'login-error-banner',
    band: 'c',
    label: 'c02 · 에러',
    login: {
      phase: 'error',
      errorCode: 'SOCIAL_AUTH_FAILED',
      conflictProvider: null,
    },
  },
  {
    key: 'login-conflict-sheet',
    band: 'c',
    label: 'c02 · 이메일 충돌',
    login: {
      phase: 'error',
      errorCode: 'SOCIAL_EMAIL_CONFLICT',
      conflictProvider: 'kakao',
    },
  },
  {
    key: 'login-age-sheet',
    band: 'c',
    label: 'c02 · 연령 확인',
    login: { phase: 'needs-age', errorCode: null, conflictProvider: null },
  },
  {
    key: 'login-age-restriction',
    band: 'c',
    label: 'c02 · 연령 미달',
    login: { phase: 'error', errorCode: 'AGE_NOT_MET', conflictProvider: null },
  },
  // ── 온보딩 (TRIP-162) — 순수 프레젠테이션 화면을 값으로 그린다 ──
  {
    key: 'onboarding-terms-default',
    band: 'c',
    label: 'c06 · 기본',
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
    key: 'onboarding-nickname-default',
    band: 'c',
    label: 'c07 · 기본',
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
  // 취향 1/2·2/2(TRIP-163) — 컨테이너 없이 화면 컴포넌트를 직접, 빈 선택 상태로 그린다
  // (인터뷰5 — 가드 우회가 아니라 기존 9키와 같은 "정적 프레젠테이션" 패턴 그대로).
  {
    key: 'pref1',
    band: 'c',
    label: 'c09 · 기본',
    login: null,
    render: () => (
      <PrefStep1Screen
        selectedStyles={['rest', 'gourmet']}
        selectedPace="balanced"
        onToggleStyle={noop}
        onTogglePace={noop}
        onNext={noop}
        onSkipAll={noop}
      />
    ),
  },
  {
    key: 'pref2',
    band: 'c',
    label: 'c09b · 기본',
    login: null,
    render: () => (
      // TRIP-719 픽스처 — Figma 1774:2258 선택 상태(예산 중간·동행 친구·음식 2종·이동 대중교통).
      // 값 도메인은 서버 enum 유지(G3)라 slug 는 코드 계약값(friends·korean·japanese·transit).
      <PrefStep2Screen
        selectedBudget="mid"
        selectedCompanions={['friends']}
        selectedActivities={null}
        selectedFoods={['korean', 'japanese']}
        selectedTransports={['transit']}
        onToggleBudget={noop}
        onToggleCompanion={noop}
        onToggleActivity={noop}
        onToggleFood={noop}
        onToggleTransport={noop}
        onDone={noop}
        onSkipAll={noop}
      />
    ),
  },
  {
    // l05 취향 전체 수정(TRIP-610) — 화면이 자족 컨테이너(GET/PUT)라 QueryClient 없는 이 프리뷰에선
    // 순수 뷰(PreferencesEditView)에 선택 픽스처를 얹어 태운다(pref1/pref2 정적 패턴과 동형).
    key: 'settings-preferences',
    band: 'l',
    label: 'l05 · 취향 수정 기본',
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
    band: 'l',
    label: 'l05 · 취향 수정 미설정+400',
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
    band: 'c',
    label: 'c08 · 기본',
    login: null,
    render: () => (
      // c08 이 온보딩 체인에서 실제로 주입하는 Figma 목적 문구(TRIP-459) — 프리뷰도 정본과 맞춘다.
      // TRIP-717: Figma 1296:1208 2줄 고정 개행(\n) 반영.
      <LocationPreprompt
        purposeContext={
          '내 주변을 알면 더 잘 맞는 곳을 추천하고\n길 안내도 막힘없이 이어져요'
        }
        state="default"
        onProceed={noop}
        onDefer={noop}
        onOpenSettings={noop}
      />
    ),
  },
  {
    key: 'onboarding-location-denied',
    band: 'c',
    label: 'c08 · 권한 거부',
    login: null,
    render: () => (
      // TRIP-717: 거부 안내는 Figma 1297:1208 카드형(hairline 테두리 + 청록 아이콘 + 15 ink),
      // 닫기 × 없음(onDismissNotice/noticeDismissed 폐기). -denied-dismissed 키는 함께 삭제됨.
      <LocationPreprompt
        purposeContext="내 주변 숙소 탐색"
        state="permission-denied"
        onProceed={noop}
        onDefer={noop}
        onOpenSettings={noop}
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
    // TRIP-707: 숙소 지역 선택은 e 밴드(e00)로 이관 — d 밴드는 여행지 선택(d03)만 남긴다.
    key: 'stay-region-default',
    band: 'e',
    label: 'e00 · 숙소 지역 선택 default',
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
    // TRIP-707: `stay-region-trip` → `region-picker-default` 개명(d03 여행지 선택 default).
    key: 'region-picker-default',
    band: 'd',
    label: 'd03 · 여행지 선택 default',
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
  // e05 숙소 등록 default(TRIP-730, Figma 1703) — 좌표 확정 + 날짜 선택 완료. 확정 카드(분홍 침대)·
  // 요일 날짜 필드("6.10 (수) – 6.12 (금)" + "2박" + 달력/⌄)·"✓ 이 숙소 등록"을 눈으로 대조.
  {
    key: 'stay-register-default',
    band: 'e',
    label: 'e05 · 등록 default',
    login: null,
    render: () => (
      <StayRegisterScreen
        flow={STAY_REGISTER_DEFAULT_FLOW}
        today="2026-06-01"
        {...STAY_REGISTER_HANDLERS}
      />
    ),
  },
  // e05 숙소 등록 multi-candidate(TRIP-730, Figma 1354) — 후보 2건·첫 선택·좌표 미확정. 라디오 원·
  // 선택 행 흰 배경·"📍 지도 ›" 링크·"등록하기"를 눈으로 대조(개명 stay-register-confirmed→여기).
  {
    key: 'stay-register-multi-candidate',
    band: 'e',
    label: 'e05 · 등록 다중 후보',
    login: null,
    render: () => (
      <StayRegisterScreen
        flow={STAY_REGISTER_MULTI_CANDIDATE_FLOW}
        today="2026-06-01"
        {...STAY_REGISTER_HANDLERS}
      />
    ),
  },
  // e05 숙소 등록 multi(TRIP-730, Figma 1358) — 단일 후보 선택·좌표 미확정. coordnotice(흰 배경·
  // 민트 ⓘ)·"지도에서 위치 확인"·disabled CTA 를 눈으로 대조.
  {
    key: 'stay-register-multi',
    band: 'e',
    label: 'e05 · 등록 multi',
    login: null,
    render: () => (
      <StayRegisterScreen
        flow={STAY_REGISTER_MULTI_FLOW}
        today="2026-06-01"
        {...STAY_REGISTER_HANDLERS}
      />
    ),
  },
  // e05 숙소 등록 error-mapapi(TRIP-730, Figma 1359) — 지도 검색 실패. 배너(⚠·↻)→핀 지정(h48)→
  // 숙소명→disabled CTA 블록 순서를 눈으로 대조. 지도·검색 없음.
  {
    key: 'stay-register-error-mapapi',
    band: 'e',
    label: 'e05 · 등록 지도 실패',
    login: null,
    render: () => (
      <StayRegisterScreen
        flow={STAY_REGISTER_ERROR_FLOW}
        today="2026-06-01"
        {...STAY_REGISTER_HANDLERS}
      />
    ),
  },
  // e05 숙소 등록 핀 지정(TRIP-724 복원, Figma 4520:2413) — 핀 탭·핀 찍기 전 세 표면을 한 화면에서
  // 대조하는 자리(실화면 딥링크로는 핀 세션 상태를 안정적으로 못 봄). 730이 키만 지웠고 PinPanel 코드는
  // 유지 — 19키 재산정으로 복원. 픽셀 정합은 이후 티켓(존재+렌더까지, 6-b/TRIP-831).
  {
    key: 'stay-register-pin',
    band: 'e',
    label: 'e05 · 등록 핀 지정',
    login: null,
    render: () => (
      <StayRegisterScreen
        flow={STAY_REGISTER_PIN_FLOW}
        today="2026-06-01"
        {...STAY_REGISTER_HANDLERS}
      />
    ),
  },
  // e05 숙소 등록 달력 범위(TRIP-724 복원, Figma 4520:2349) — 날짜 시트 열림·범위 하이라이트·여행 기간
  // 상하한을 눈으로 보는 자리. CalendarSheet 코드는 730에서 유지, 프리뷰 키만 복원. 6-b/TRIP-831 몫.
  {
    key: 'stay-register-calendar',
    band: 'e',
    label: 'e05 · 등록 달력 범위',
    login: null,
    render: () => (
      <StayRegisterScreen
        flow={{ ...STAY_REGISTER_DEFAULT_FLOW, dateSheetOpen: true }}
        today="2026-06-01"
        minDate="2026-06-08"
        maxDate="2026-06-20"
        {...STAY_REGISTER_HANDLERS}
      />
    ),
  },
  // e02 검색 결과 기본(TRIP-725) — 검색바(돋보기·"지역·숙소 이름 검색")·카드 4장(2톤 가격 3 +
  // "가격 미확인" 1, 3번째 저장=흰 원 위 분홍 하트)·2단 원형 FAB(흰 하트·분홍 ＋)를 한 화면에.
  // jest 는 SVG 색·좌표·2톤 베이스라인을 못 봐 이 진입점이 눈으로 확인하는 유일한 자리다.
  {
    key: 'stay-search-default',
    band: 'e',
    label: 'e02 · 검색 결과',
    login: null,
    render: () => (
      <StaySearchScreen
        region="부산"
        items={STAY_SEARCH_PREVIEW_ITEMS}
        nameQuery=""
        onChangeNameQuery={noop}
        savedKeys={['AGODA:s3']}
        onToggleSave={noop}
        onPressSaved={noop}
        onPressRegister={noop}
      />
    ),
  },
  // e02 상태 5종(TRIP-726) — loading·empty·filter-zero·partial-failure·error 를 눈으로 대조.
  // 상태 프레임은 검색바를 안 그린다(Figma 정합) → `onChangeNameQuery` 미지정. jest 는 스켈레톤
  // 방향·카드 그림자·disabled 룩·배너 딤·FAB 오버랩을 못 봐 이 5키가 유일한 육안 확인 자리(6-b/831).
  {
    key: 'stay-search-loading',
    band: 'e',
    label: 'e02 · 검색 결과 loading',
    login: null,
    render: () => (
      <StaySearchScreen
        region="부산"
        items={[]}
        state={{ kind: 'loading' }}
        onPressBack={noop}
        onPressTab={noop}
        onPressFilter={noop}
        onPressSaved={noop}
        onPressRegister={noop}
      />
    ),
  },
  {
    // activeFilterCount=2 로 '필터 완화' 활성(Figma 는 둘 다 활성) — 0 이면 disabled 는 6-b/831 몫.
    key: 'stay-search-empty',
    band: 'e',
    label: 'e02 · 검색 결과 empty',
    login: null,
    render: () => (
      <StaySearchScreen
        region="부산"
        items={[]}
        state={{ kind: 'empty', degraded: false }}
        activeFilterCount={2}
        onPressChangeRegion={noop}
        onRelaxFilters={noop}
        onPressBack={noop}
        onPressTab={noop}
        onPressFilter={noop}
        onPressSaved={noop}
        onPressRegister={noop}
      />
    ),
  },
  {
    key: 'stay-search-filter-zero',
    band: 'e',
    label: 'e02 · 검색 결과 filter-zero',
    login: null,
    render: () => (
      <StaySearchScreen
        region="부산"
        items={[]}
        state={{
          kind: 'filter-zero',
          reasons: ['amenity:조식'],
          degraded: false,
        }}
        activeFilterCount={1}
        onRelaxFilters={noop}
        onClearCulpritFilter={noop}
        onPressBack={noop}
        onPressTab={noop}
        onPressFilter={noop}
        onPressSaved={noop}
        onPressRegister={noop}
      />
    ),
  },
  {
    // 배너 + 카드(결측가 muted 1장 포함, s4 price:null) 재확인(E-2). savedKeys 로 1장 찬 하트.
    key: 'stay-search-partial-failure',
    band: 'e',
    label: 'e02 · 검색 결과 partial-failure',
    login: null,
    render: () => (
      <StaySearchScreen
        region="부산"
        items={STAY_SEARCH_PREVIEW_ITEMS}
        state={{ kind: 'results', degraded: true }}
        savedKeys={['AGODA:s3']}
        onRetry={noop}
        onToggleSave={noop}
        onPressCard={noop}
        onPressBack={noop}
        onPressTab={noop}
        onPressFilter={noop}
        onPressSaved={noop}
        onPressRegister={noop}
      />
    ),
  },
  {
    key: 'stay-search-error',
    band: 'e',
    label: 'e02 · 검색 결과 error',
    login: null,
    render: () => (
      <StaySearchScreen
        region="부산"
        items={[]}
        state={{ kind: 'error' }}
        onRetry={noop}
        onPressBack={noop}
        onPressTab={noop}
        onPressFilter={noop}
        onPressSaved={noop}
        onPressRegister={noop}
      />
    ),
  },
  // e03 숙소 상세(TRIP-457·727) — 몰입 화면(탭바 없음). default 는 편의시설 4칩·2톤 가격·실 미니맵·
  // CTA 2종. Figma default=저장됨이라 saved:true(하트 채움, TRIP-727 프리뷰 병합 — 구 -saved 키 흡수).
  {
    key: 'stay-detail-default',
    band: 'e',
    label: 'e03 · 상세 기본',
    login: null,
    render: () => (
      <StayDetailScreen
        item={STAY_DETAIL_PREVIEW_ITEM}
        saved={true}
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
    band: 'e',
    label: 'e03 · 상세 불러오기 실패',
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
  // 제휴 고지 시트(BR-U1-30) — book press 시 뜨는 시트. 상세 화면(saved) 배경 위에 시트를 얹어
  // 실제 화면처럼 합성한다(딤은 gorhom BottomSheetBackdrop 이 진다 — 수동 스크림 래퍼 없음).
  // gorhom 이라 실 슬라이드·딤 전면 커버는 실기 몫.
  {
    key: 'stay-detail-affiliate-sheet',
    band: 'e',
    label: 'e03 · 제휴 고지 시트',
    login: null,
    render: () => (
      <View className="flex-1">
        <StayDetailScreen
          item={STAY_DETAIL_PREVIEW_ITEM}
          saved={true}
          onToggleSave={noop}
          onPressBook={noop}
          onPressAddToTrip={noop}
          onPressBack={noop}
        />
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
    band: 'e',
    label: 'e02 · 가격대 필터 시트',
    login: null,
    render: () => (
      <View className="flex-1 justify-end bg-scrim/40">
        <StayPriceSheet selected="all" onSelect={noop} onClose={noop} />
      </View>
    ),
  },
  // e02 필터 시트(TRIP-724 신규, Figma 4509:2288) — 편의시설·숙소 유형 토글 칩. "필터 ⚙" 칩이 여는
  // 유일한 UI(19키 재산정으로 신설). StayFilterSheet 코드는 실재 — 프리뷰 키만 신규. 픽셀 6-b/831 몫.
  {
    key: 'stay-filter-sheet',
    band: 'e',
    label: 'e02 · 필터 시트',
    login: null,
    render: () => (
      <View className="flex-1 justify-end bg-scrim/40">
        <StayFilterSheet
          amenities={[
            { value: '조식', selected: true },
            { value: '주차', selected: false },
            { value: '와이파이', selected: false },
            { value: '수영장', selected: false },
          ]}
          stayTypes={[
            { value: '호텔', selected: false },
            { value: '게스트하우스', selected: false },
          ]}
          onToggleAmenity={noop}
          onToggleStayType={noop}
          onApply={noop}
          onClose={noop}
        />
      </View>
    ),
  },
  // ── 홈 대시보드(TRIP-170) — 프레젠테이션 전용, 고정 픽스처로 그린다(TRIP-701로 2키 삭제) ──
  {
    key: 'home-default',
    band: 'a',
    label: 'a01 · 기본',
    login: null,
    render: () => withShellTabBar(<HomeScreen {...HOME_DEFAULT_PROPS} />),
  },
  {
    key: 'home-loading',
    band: 'a',
    label: 'a01 · 로딩',
    login: null,
    render: () => withShellTabBar(<HomeScreen {...HOME_LOADING_PROPS} />),
  },
  // ── 홈 여행 단계 얼굴 2종(TRIP-317; collecting·upcoming은 TRIP-701 제거) — 실기 판정 전용 진입점 ──
  {
    key: 'home-planning',
    band: 'a',
    label: 'a01 · 계획 중',
    login: null,
    render: () => withShellTabBar(<HomeScreen {...HOME_PLANNING_PROPS} />),
  },
  {
    key: 'home-traveling',
    band: 'a',
    label: 'a01 · 여행 중',
    login: null,
    render: () => withShellTabBar(<HomeScreen {...HOME_TRAVELING_PROPS} />),
  },
  {
    key: 'home-post-trip',
    band: 'a',
    label: 'a01 · 여행 후',
    login: null,
    render: () => withShellTabBar(<HomeScreen {...HOME_POST_TRIP_PROPS} />),
  },
  // ── 홈 담은 곳 메뉴 배지 3얼굴(TRIP-695) — 육안 대조: 무배지 · 7/3 · 99+/24. savedMenuOpen 은
  //    prop 이라 프리뷰가 강제 true 로 연다. 배지 지름·흰 테두리·flush 위치는 6-b 육안 전용. ──
  {
    key: 'home-saved-menu',
    band: 'a',
    label: 'a01 · 담은 곳 메뉴(무배지)',
    login: null,
    render: () =>
      withShellTabBar(
        <HomeScreen
          {...HOME_DEFAULT_PROPS}
          savedMenuOpen
          savedPlacesCount={0}
          savedStaysCount={0}
          onToggleSavedMenu={noop}
          onPressSavedPlaces={noop}
          onPressSavedStays={noop}
        />
      ),
  },
  {
    key: 'home-saved-menu-badge',
    band: 'a',
    label: 'a01 · 담은 곳 배지(7/3)',
    login: null,
    render: () =>
      withShellTabBar(
        <HomeScreen
          {...HOME_DEFAULT_PROPS}
          savedMenuOpen
          savedPlacesCount={7}
          savedStaysCount={3}
          onToggleSavedMenu={noop}
          onPressSavedPlaces={noop}
          onPressSavedStays={noop}
        />
      ),
  },
  {
    key: 'home-saved-menu-badge-99',
    band: 'a',
    label: 'a01 · 담은 곳 배지(99+/24)',
    login: null,
    render: () =>
      withShellTabBar(
        <HomeScreen
          {...HOME_DEFAULT_PROPS}
          savedMenuOpen
          savedPlacesCount={100}
          savedStaysCount={24}
          onToggleSavedMenu={noop}
          onPressSavedPlaces={noop}
          onPressSavedStays={noop}
        />
      ),
  },
  // ── a02 매거진 목록(TRIP-700) — 홈에서 push 로 진입하는 별 화면. 순수 뷰라 콜백 없이 렌더
  //    (프리뷰는 시각 대조 전용, 칩 토글·항법은 실앱/컨테이너 몫). withShellTabBar 는 Figma 탭바
  //    문맥 재현(실앱은 (tabs) 밖이라 탭바 없음 — 01b Q1). 매서너리 불균등·핑크 알약은 6-b 육안. ──
  {
    key: 'magazine-default',
    band: 'a',
    label: 'a02 · 여행지 둘러보기',
    login: null,
    render: () =>
      withShellTabBar(<MagazineScreen {...MAGAZINE_DEFAULT_PROPS} />),
  },
  // 지도 계층 선행(TRIP-197 D9) — 층 C(실기) 진입점. 키/로드 실패 분기는 렌더 안 해봐야
  // 알 수 없어 여기서는 해피패스 1키만 둔다(env 키는 빌드 시 번들에 인라인되므로 preview가
  // 런타임에 비울 수 없다 — 실패 분기는 MapView.test.tsx가, C-2는 .env를 실제로 비우고
  // 재기동해 확인한다).
  {
    key: 'map-default',
    band: '기타',
    label: '기타 · 지도(map-default)',
    login: null,
    // TRIP-745 — 핀 3상태(done 흰 체크·current 분홍 번호·upcoming 회색 번호)·현재위치 점/링/라벨·
    // 빨강 경로선을 한 지도에서 6-b 육안 대조하는 자리(jest 는 물방울 모양·색·번호를 못 본다).
    // 좌표는 서울 도심 ~1.5km 안(한 화면). 실지도는 env 키가 있는 실기 빌드에서만 뜬다.
    render: () => (
      <MapView
        center={{ lat: 37.5665, lng: 126.978 }}
        pins={MAP_STATE_PREVIEW_PINS}
        currentLocation={{ lat: 37.5662, lng: 126.9785 }}
      />
    ),
  },
  {
    key: 'records-default',
    band: 'j',
    label: 'j01 · 방문 기록 기본',
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
        // TRIP-768 j 밴드 마커족 — visited 사진 2(1→2 선), planned 점선 2, stay 침대 1. 사진은 인라인
        // 로컬 require(번들 number source) — DRAFT_PREVIEW_PHOTOS(해석된 URI) 재사용 금지(마커 래스터가
        // async URL 로 흔들림, seed 결정 2). 실 좌표·URL 배선은 TRIP-634 밖이라 여기 픽스처로만 본다.
        mapPins={[
          {
            number: 1,
            lat: 35.1532,
            lng: 129.1187,
            kind: 'visited',
            imageUrl: require('@/assets/itinerary/draft-preview-1.jpg'),
          },
          {
            number: 2,
            lat: 35.1555,
            lng: 129.1216,
            kind: 'visited',
            imageUrl: require('@/assets/itinerary/draft-preview-2.jpg'),
          },
          { number: 3, lat: 35.156, lng: 129.1174, kind: 'planned' },
          { number: 4, lat: 35.1538, lng: 129.115, kind: 'planned' },
          { number: 5, lat: 35.1518, lng: 129.1226, kind: 'stay' },
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
            completedAt: '2026-08-21T16:20:00',
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
        // TRIP-759 — 완료 방문 카드(r1·r2)에 사진/메모 슬롯을 얹어 default 얼굴에서 육안 대조한다
        // (실 훅 대신 정적 픽스처: 네이티브 피커 미설치라 uri=null placeholder 셀 — 실 썸네일·간격은
        // 6-b 몫). 미완료 카드(r3·r4)는 undefined → 화면이 정적 스캐폴딩으로 폴백한다. 광안리 2장·
        // 미술관 1장. 카드 사진 셀은 placeholder 라 로컬 require 는 지도 마커족(mapPins)만 쓴다.
        renderCard={(card) =>
          card.completedAt != null ? (
            <VisitRecordCard
              card={card}
              onPressComplete={noop}
              onPressSkip={noop}
              photoSlot={
                <PhotoThumbStrip
                  photos={
                    card.visitCheckId === 'r1'
                      ? [
                          {
                            visitPhotoMetaId: 'r1-a',
                            availability: 'available',
                            uri: null,
                          },
                          {
                            visitPhotoMetaId: 'r1-b',
                            availability: 'available',
                            uri: null,
                          },
                        ]
                      : [
                          {
                            visitPhotoMetaId: 'r2-a',
                            availability: 'available',
                            uri: null,
                          },
                        ]
                  }
                  onPressAdd={noop}
                />
              }
              memoSlot={<MemoInline onSubmit={noop} />}
            />
          ) : undefined
        }
        onPressComplete={noop}
        onPressSkip={noop}
        onPressSpontaneous={noop}
        onPressBack={noop}
        onPressTab={noop}
      />
    ),
  },
  // j01 방문 기록 error 얼굴(TRIP-760) — 사진 업로드 실패 표면. default 와 안내문만 다르고(상태별 의도
  // →noticeCopy 분기), 광안리 카드에 upload-failed 셀(⚠ "업로드 실패") + 풀폭 [↻ 다시 시도] 버튼 +
  // "메모와 방문 체크는 저장되었어요"를 얹었다. ⚠ 생김새·surface-strong 톤·↻ 코랄은 jest 사각(6-b 육안).
  {
    key: 'records-error',
    band: 'j',
    label: 'j01 · 방문 기록 업로드 실패',
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
        noticeCopy="오늘 방문한 곳 — 핀은 방문 완료, 빈 핀은 예정"
        mapCenter={{ lat: 35.1532, lng: 129.1187 }}
        mapPins={[
          {
            number: 1,
            lat: 35.1532,
            lng: 129.1187,
            kind: 'visited',
            imageUrl: require('@/assets/itinerary/draft-preview-1.jpg'),
          },
          { number: 2, lat: 35.156, lng: 129.1174, kind: 'planned' },
          { number: 3, lat: 35.1518, lng: 129.1226, kind: 'stay' },
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
        ]}
        // 광안리 카드: 성공 사진 1(placeholder) + 업로드 실패 셀 1 + 카드-레벨 재시도 버튼.
        renderCard={(card) => (
          <VisitRecordCard
            card={card}
            onPressComplete={noop}
            onPressSkip={noop}
            photoSlot={
              <PhotoThumbStrip
                photos={[
                  {
                    visitPhotoMetaId: 'r1-a',
                    availability: 'available',
                    uri: null,
                  },
                  {
                    visitPhotoMetaId: 'r1-b',
                    availability: 'upload-failed',
                    uri: null,
                  },
                ]}
                onPressAdd={noop}
              />
            }
            memoSlot={<MemoInline onSubmit={noop} />}
            uploadRetry={{ onPress: noop }}
          />
        )}
        onPressComplete={noop}
        onPressSkip={noop}
        onPressSpontaneous={noop}
        onPressBack={noop}
        onPressTab={noop}
      />
    ),
  },
  // j01 방문 기록 manual-checkin 얼굴(TRIP-761) — 위치 권한 부재 모드. default 위에 (1) GPS 미동의 배너,
  // (2) 지도 ⊘ "GPS 자동기록 꺼짐" 배지, (3) manual 안내문(법 문구 "(좌표 자동기록 비활성)"), (4) UPCOMING
  // ○○ 카페 카드의 코랄 "방문 체크" pill 을 얹었다. `manualCheckin` prop 직접 주입(권한 조회 없이) — 실 권한
  // 플로우는 시뮬레이터(6-b) 몫. 배너 dashed 보더·⊘ 벡터·코랄 톤·폰트 미세치는 jest 사각(6-b 육안).
  {
    key: 'records-manual-checkin',
    band: 'j',
    label: 'j01 · 방문 기록 수동 체크인',
    login: null,
    render: () => (
      <TripRecordsScreen
        manualCheckin
        noticeCopy="수동 체크인 · 방문한 곳을 직접 선택해 기록하세요 (좌표 자동기록 비활성)"
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
          {
            number: 1,
            lat: 35.1532,
            lng: 129.1187,
            kind: 'visited',
            imageUrl: require('@/assets/itinerary/draft-preview-1.jpg'),
          },
          {
            number: 2,
            lat: 35.1555,
            lng: 129.1216,
            kind: 'visited',
            imageUrl: require('@/assets/itinerary/draft-preview-2.jpg'),
          },
          { number: 3, lat: 35.156, lng: 129.1174, kind: 'planned' },
          { number: 4, lat: 35.1538, lng: 129.115, kind: 'planned' },
          { number: 5, lat: 35.1518, lng: 129.1226, kind: 'stay' },
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
            completedAt: '2026-08-21T16:20:00',
            skippedAt: null,
            arrivedLabel: '15:40',
          },
          {
            // UPCOMING(세 timestamp null) — 수동 체크인 모드에서 "방문 체크" pill 이 붙는 카드.
            visitCheckId: 'r3',
            slotKey: '2026-08-21#p3',
            poiId: 'p3',
            nameKo: '○○ 카페',
            arrivedAt: null,
            completedAt: null,
            skippedAt: null,
            arrivedLabel: null,
          },
        ]}
        // 완료 카드(r1·r2)만 사진/메모 슬롯을 얹고, UPCOMING r3 은 undefined → 화면이 정적 스캐폴딩
        // 폴백으로 그리되 manualCheckin·onPressManualCheck 를 함께 받아 pill 을 surface 한다.
        renderCard={(card) =>
          card.completedAt != null ? (
            <VisitRecordCard
              card={card}
              onPressComplete={noop}
              onPressSkip={noop}
              photoSlot={
                <PhotoThumbStrip
                  photos={[
                    {
                      visitPhotoMetaId: `${card.visitCheckId}-a`,
                      availability: 'available',
                      uri: null,
                    },
                  ]}
                  onPressAdd={noop}
                />
              }
              memoSlot={<MemoInline onSubmit={noop} />}
            />
          ) : undefined
        }
        onPressManualCheck={noop}
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
    band: 'j',
    label: 'j01 · 방문 시각 시트',
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
    band: 'j',
    label: 'j01 · 방문 시각 시트 도착없음',
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
  // j03 오늘의 회고 4얼굴(TRIP-571) — 순수 뷰(`DailyReflectionScreen`)를 격리 렌더한다(`@/shared/api`
  // 값 import 0 이라 프리뷰 지뢰 목 통과). jest 는 testID·행동만 잠그고 4상태 레이아웃·코랄 토큰·
  // 플레이스홀더 카드·error 재시도 카드·편집 입력은 픽셀이라 6-b/육안 몫 — 자율/야간이라 6-b SKIP,
  // 이 4키가 유일한 육안 대조 자리. `editableText` 를 주면 편집 진입(헤더 "편집"/CTA "직접 회고 작성")
  // → 입력(상한 4000)·저장/취소를 실기로 눌러 본다.
  {
    key: 'reflection-default',
    band: 'j',
    label: 'j03 · 회고 기본',
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
    band: 'j',
    label: 'j03 · 회고 데이터 부족',
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
    band: 'j',
    label: 'j03 · 회고 빈 상태',
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
    band: 'j',
    label: 'j03 · 회고 실패',
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
    band: 'j',
    label: 'j04 · 요약 지도',
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
    band: 'j',
    label: 'j04 · 요약 방문목록',
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
    band: 'j',
    label: 'j04 · 요약 공유 비활성',
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
    band: 'j',
    label: 'j06 · 공유 카드 사진',
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
    band: 'j',
    label: 'j06 · 공유 카드 사진없음',
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
  // j05 여행 스타일 3키(TRIP-573) — 순수 뷰(`TravelStyleScreen`)를 격리 렌더한다(`@/shared/api` 값
  // import 0 이라 프리뷰 지뢰 목 통과 — 컨테이너 `TravelStylePage` 는 별 파일이라 import 사슬 전이
  // 로드 없음). 지도는 좌표 계약 공백이라 늘 placeholder degrade(가짜 지도 금지). 코랄 막대·StatTile
  // 카드·진행 게이지·미리보기 칩·EvidenceLink press "준비 중" degrade 는 픽셀·상호작용이라 6-b/육안 몫
  // — 자율/야간이라 6-b SKIP, 이 3키가 유일한 육안 대조 자리(정식·avgDwell null degrade·임시 3얼굴).
  {
    key: 'travel-style-official',
    band: 'j',
    label: 'j05 · 스타일 정식',
    login: null,
    render: () => (
      <TravelStyleScreen
        face="official"
        progress={{ current: 14, required: 10 }}
        analysis={{
          descriptors: ['#바다', '#미식'],
          traitGauges: { easygoing: 4, foodAffinity: 4, activeness: 3 },
          categoryBreakdown: [
            { category: '카페', ratio: 0.4, isOther: false },
            { category: '자연', ratio: 0.25, isOther: false },
            { category: '맛집', ratio: 0.2, isOther: false },
            { category: '상위3밖', ratio: 0.15, isOther: true },
          ],
          avgPlacesPerDay: 4,
          avgRadiusKm: 1.2,
          avgDwellMinutes: 72,
          sampleTripCount: 3,
          updatedAt: '2026-06-13T09:00:00Z',
        }}
        preview={null}
        onBack={noop}
      />
    ),
  },
  {
    // 엣지 — avgDwellMinutes:null → 평균 체류 타일이 사라진다(0 으로 안 채움, BR-U5-08a degrade).
    key: 'travel-style-no-dwell',
    band: 'j',
    label: 'j05 · 스타일 체류 미측정',
    login: null,
    render: () => (
      <TravelStyleScreen
        face="official"
        progress={{ current: 11, required: 10 }}
        analysis={{
          descriptors: ['#느긋'],
          traitGauges: { easygoing: 5, foodAffinity: 2, activeness: 2 },
          categoryBreakdown: [
            { category: '자연', ratio: 0.55, isOther: false },
            { category: '카페', ratio: 0.3, isOther: false },
            { category: '상위3밖', ratio: 0.15, isOther: true },
          ],
          avgPlacesPerDay: 3,
          avgRadiusKm: 0.8,
          avgDwellMinutes: null,
          sampleTripCount: 2,
          updatedAt: '2026-06-13T09:00:00Z',
        }}
        preview={null}
        onBack={noop}
      />
    ),
  },
  {
    // 임시 — official:false. 진행 게이지 + "정식 아님" + 온보딩 취향 미리보기 칩(Figma 목업엔 없으나 BR 우선).
    key: 'travel-style-insufficient',
    band: 'j',
    label: 'j05 · 스타일 임시',
    login: null,
    render: () => (
      <TravelStyleScreen
        face="insufficient"
        progress={{ current: 6, required: 10 }}
        analysis={null}
        preview={{ descriptors: ['느긋한 여행', '바다 선호', '미식 탐험'] }}
        onBack={noop}
      />
    ),
  },
  // 탐색 2키(TRIP-221·223) — **results 얼굴 전용**이다. 실화면 딥링크로는 볼 수 없다:
  // 백엔드가 401 이면 d04 는 항상 error, 세션이 없으면 d02 는 항상 게스트 안내로 떨어진다.
  // 나머지 얼굴(loading·empty·filter-zero·error·게스트)은 실화면에서 그대로 재현되므로
  // 여기 키를 늘리지 않는다.
  {
    // TRIP-708: `places-results` → `places-default` 개명(Figma 1692:1183 default).
    key: 'places-default',
    band: 'd',
    label: 'd04 · 장소 탐색 default',
    login: null,
    // TRIP-708 완료 조건: d04 는 (tabs) 밖 라우트라 복제 탭바가 프리뷰에도 보여야 한다. 탭바는
    // page 소유(화면 순수성)라 순수 화면만 태우면 안 보이므로, magazine 선례처럼 withShellTabBar
    // 로 감싸 셸 탭바(탐색 활성)를 얹는다(실 라우트는 PlaceExplorePage 가 동일 탭바를 그린다).
    render: () =>
      withShellTabBar(
        <PlaceExploreScreen
          places={PREVIEW_PLACES}
          savedPoiIds={PREVIEW_SAVED_POI_IDS}
          selectedCategory={null}
          searchText=""
          onSelectCategory={noop}
          onChangeSearchText={noop}
          onToggleSave={noop}
          onPressCreateTrip={noop}
          onPressSavedPlaces={noop}
          onPressFilter={noop}
        />,
        'explore'
      ),
  },
  {
    // TRIP-705: `saved-places-results` → `saved-places-default` 개명. Figma 1693:1183 default 6행.
    key: 'saved-places-default',
    band: 'd',
    label: 'd02 · 담은 장소 default',
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
  {
    // TRIP-705: Figma 3614:2032 loading — 6행 스켈레톤 + 앱바 서브텍스트 + 회색 disabled CTA.
    key: 'saved-places-loading',
    band: 'd',
    label: 'd02 · 담은 장소 loading',
    login: null,
    render: () => (
      <SavedPlaceListScreen
        savedPlaces={[]}
        state={{ kind: 'loading' }}
        onPressRemove={noop}
        onPressCreateTrip={noop}
        onPressBrowse={noop}
      />
    ),
  },
  // TRIP-711 — `saved-places-released`(해제 빈 하트 엣지) 프리뷰 키 삭제(G5, 화면 코드는 유지).
  // TRIP-649 — 담은 장소 empty 얼굴. 결과 픽스처를 0곳으로(savedPlaces=[]) + 얼굴 판정 state를
  // empty 로 주입(얼굴은 배열 길이가 아니라 state.kind 로 갈린다). 삽화·"둘러보기" CTA 육안 자리.
  {
    key: 'saved-places-empty',
    band: 'd',
    label: 'd02 · 담은 장소 empty',
    login: null,
    render: () => (
      <SavedPlaceListScreen
        savedPlaces={[]}
        state={{ kind: 'empty' }}
        onPressRemove={noop}
        onPressCreateTrip={noop}
        onPressBrowse={noop}
      />
    ),
  },
  // TRIP-706 — d02 select 모드 4얼굴(Figma 2437:1500·1666·1616·1639). props-only 직접 렌더.
  // 체크 채움/빈 글리프·92px 에러 원·콜라주 벡터·순번 배지 원은 jest 사각이라 이 4키가 6-b 육안 자리.
  {
    key: 'saved-places-select',
    band: 'd',
    label: 'd02 · 꼭 갈 곳 고르기 default',
    login: null,
    render: () => (
      <MustVisitPickScreen
        state={{ kind: 'results' }}
        savedPlaces={PREVIEW_SAVED_PLACES}
        selectedPoiIds={['p-1', 'p-2', 'p-3']}
        onToggleSelect={noop}
        onComplete={noop}
        onPressAddMore={noop}
        onRetry={noop}
        onPressBrowse={noop}
        onBack={noop}
      />
    ),
  },
  {
    key: 'saved-places-select-loading',
    band: 'd',
    label: 'd02 · 꼭 갈 곳 고르기 loading',
    login: null,
    render: () => (
      <MustVisitPickScreen
        state={{ kind: 'loading' }}
        savedPlaces={[]}
        selectedPoiIds={[]}
        onToggleSelect={noop}
        onComplete={noop}
        onPressAddMore={noop}
        onRetry={noop}
        onPressBrowse={noop}
        onBack={noop}
      />
    ),
  },
  {
    key: 'saved-places-select-empty',
    band: 'd',
    label: 'd02 · 꼭 갈 곳 고르기 empty',
    login: null,
    render: () => (
      <MustVisitPickScreen
        state={{ kind: 'empty' }}
        savedPlaces={[]}
        selectedPoiIds={[]}
        onToggleSelect={noop}
        onComplete={noop}
        onPressAddMore={noop}
        onRetry={noop}
        onPressBrowse={noop}
        onBack={noop}
      />
    ),
  },
  {
    key: 'saved-places-select-error',
    band: 'd',
    label: 'd02 · 꼭 갈 곳 고르기 error',
    login: null,
    render: () => (
      <MustVisitPickScreen
        state={{ kind: 'error' }}
        savedPlaces={[]}
        selectedPoiIds={[]}
        onToggleSelect={noop}
        onComplete={noop}
        onPressAddMore={noop}
        onRetry={noop}
        onPressBrowse={noop}
        onBack={noop}
      />
    ),
  },
  // d01 탐색 랜딩(TRIP-201) — 3얼굴: 담은 곳 CTA / 담은 곳 0 안내 / 숙소 레인 실패 재시도.
  {
    key: 'explore-landing-default',
    band: 'd',
    label: 'd01 · 랜딩 default',
    login: null,
    // d01 은 (tabs)/explore 라 실앱에서 셸 탭바(탐색 활성)가 뜬다 — 프리뷰도 실화면과 똑같이
    // withShellTabBar('explore')로 얹는다(home 프리뷰 선례). TRIP-703 default(1672:1183)는
    // 담은 곳 메뉴 접힘(open:false).
    render: () =>
      withShellTabBar(
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
            savedCount: 3,
            onToggle: noop,
            onPressSavedPlaces: noop,
            onPressSavedStays: noop,
          }}
        />,
        'explore'
      ),
  },
  {
    // TRIP-704: Figma loading(3612:2006) — 숙소 2·장소 3 스켈레톤, FAB·폴백 없음. 헤딩·검색·
    // 섹션 제목은 실텍스트. stayLane·savedMenu 값은 isLoading 이 가려 실제로 안 그려진다.
    key: 'explore-landing-loading',
    band: 'd',
    label: 'd01 · 랜딩 loading',
    login: null,
    // d01 로딩도 실앱 탐색 탭이라 셸 탭바(탐색 활성)가 뜬다 — 프리뷰도 똑같이 얹는다.
    render: () =>
      withShellTabBar(
        <ExploreLandingScreen
          {...EXPLORE_LANDING_BASE}
          isLoading
          stayLane={{ error: false, cards: [], onRetry: noop, onSeeAll: noop }}
          savedMenu={{
            open: false,
            savedCount: 0,
            onToggle: noop,
            onPressSavedPlaces: noop,
            onPressSavedStays: noop,
          }}
        />,
        'explore'
      ),
  },
  {
    // TRIP-709 — d05 목적지 상세 default(Figma 2176:2336). 세그 all 활성·숙소 담김 1건
    // (savedKeys 첫 카드)·FAB 2단(하트+＋)이 한 화면에 보이게. 화면이 자체 BottomTabBar 를
    // 그리므로 withShellTabBar 로 감싸지 않는다(props-only 직접 렌더). 세그 활성 흰칩·하트 분홍·
    // FAB 위치·검색바 › 는 jest 사각이라 이 키가 6-b 육안 대조 자리.
    key: 'destination-detail-default',
    band: 'd',
    label: 'd05 · 통합 검색 결과 default',
    login: null,
    render: () => (
      <DestinationDetailScreen
        regionName="부산"
        onPressSearch={noop}
        stayLane={{
          error: false,
          cards: EXPLORE_STAY_CARDS,
          onRetry: noop,
          onSeeAll: noop,
          onPressCard: noop,
          savedKeys: ['yanolja:1'],
          pendingKeys: [],
          onToggleSave: noop,
          saveError: false,
          onDismissSaveError: noop,
        }}
        placeLane={{
          error: false,
          cards: EXPLORE_LANDING_PLACE_LANE.cards,
          onRetry: noop,
          onSeeAll: noop,
          onPressCard: noop,
        }}
        onPressTab={noop}
        onPressCreateTrip={noop}
        savedMenu={{
          open: false,
          savedCount: 3,
          onToggle: noop,
          onPressSavedPlaces: noop,
          onPressSavedStays: noop,
        }}
      />
    ),
  },
  {
    // TRIP-710 — d06 장소 상세 default(Figma 1907:1083). props-only 순수 뷰라 직접 렌더한다.
    // category 는 PoiCategory enum('문화') — Figma 라벨 '미술관'·'전시'는 계약 밖(tsc 거부). 부제
    // 앞 흰 핀·미니맵 단일 핀 지도(viewOnly)·데이터 없는 4구획 부재가 jest 사각이라 이 키가 6-b
    // 육안 대조 자리(미니맵 타일은 네이티브 재빌드 후에만 뜸). 히어로는 로컬 에셋 재사용(회색↔사진).
    key: 'place-detail-default',
    band: 'd',
    label: 'd06 · 장소 상세 default',
    login: null,
    render: () => (
      <ExplorePlaceDetailScreen
        place={{
          poiId: 'busan-moca',
          nameKo: '부산시립미술관',
          category: '문화',
          lat: 35.1689,
          lng: 129.1355,
          region: '부산 해운대구',
          openingHours: '10:00~18:00 (월 휴관)',
          imageUrl: PLACE_DETAIL_PREVIEW_IMAGE,
          tags: ['미술', '실내', '취향매칭', '비와도좋음'],
          savedCount: 128,
          dataStatus: 'ACTIVE',
        }}
        saved={false}
      />
    ),
  },
  // TRIP-711 — `explore-landing-empty-bridge`·`explore-landing-stay-error` 프리뷰 키 삭제
  // (G5, 화면 코드는 유지 — 담은 곳 0 브리지·숙소 레인 실패는 회선 조절로 실화면 재현).
  // g01 신 default(TRIP-665·TRIP-732, Figma `3742:2068`) — 꼭 갈 곳 시드 얼굴. 요약 5행은
  // 두 키 다 채워진 2톤 객체(`TRIP_WIZARD_BASE`)이고, 스트립의 `mustVisits` 를 Figma 6장으로 채운다.
  // jest 는 요약 sub caption 회색·온보딩 스파클/분홍·카드 그림자·스트립 카드 픽셀·진행바 색을 못
  // 보므로 이 키가 3742:2068 육안 대조 자리다(TRIP-732 로 `-seeded`→`-default` 개명, AC-11).
  // 자리표시·조회 실패·담은 곳 0곳 얼굴은 회선을 늦추면 실화면에서 재현되므로 여기 키를 늘리지 않는다
  // (TRIP-742 로 `-no-saved` 프리뷰 키 삭제 — 화면 코드는 유지).
  {
    key: 'trip-new-step1-default',
    band: 'g',
    label: 'g01 · 여행 만들기 default',
    login: null,
    render: () => (
      <TripWizardStep1Screen
        {...TRIP_WIZARD_BASE}
        mustVisits={MUST_VISIT_THUMBNAILS}
      />
    ),
  },
  // g01 empty·loading 두 상태 얼굴(TRIP-671, Figma empty `3652:2068`·loading `3712:2068`). empty 는
  // fresh 진입(여행지·기간 null → 신 카피/빈 줄, 동행·취향·예산은 프리필 채움, [다음] 비활성),
  // loading 은 `isLoading=true`(요약 5행·꼭 갈 곳 스켈레톤 + 로딩 부제 + [다음] 비활성). jest 는 회색바
  // 색·크기·"어디로 갈까요?" 진한 톤을 못 봐 이 두 키가 3652:2068·3712:2068 육안 대조 자리다.
  {
    key: 'trip-new-step1-empty',
    band: 'g',
    label: 'g01 · 여행 만들기 empty',
    login: null,
    render: () => (
      <TripWizardStep1Screen
        {...TRIP_WIZARD_BASE}
        summaryDestinations={null}
        summaryPeriod={null}
        // empty 얼굴(Figma `3652:2068`) — 동행·취향은 프리필로 채워지고, 예산은 금액 없이 프리필
        // tier 만 있는 **tier-only**(TRIP-732: main=tier, sub="1인 총액 · 온보딩").
        summaryCompanion={{ main: '혼자 1명' }}
        summaryPreferences={{ main: '휴양 · 미식', onboarding: true }}
        summaryBudget={{ main: '중간', sub: '1인 총액 · 온보딩' }}
        mustVisits={[]}
        canProceed={false}
      />
    ),
  },
  {
    key: 'trip-new-step1-loading',
    band: 'g',
    label: 'g01 · 여행 만들기 loading',
    login: null,
    render: () => <TripWizardStep1Screen {...TRIP_WIZARD_BASE} isLoading />,
  },
  // g01 저장 실패 배너(TRIP-734, Figma saveFail·v2 = `3754:5401`) — 제출 실패 얼굴. submitError 트리거
  // 하나만 얹어 흰 배경+헤어라인 배너·빨간 경고 아이콘(#FF385C)·[다시 시도] 텍스트 링크를 육안 대조하는
  // 자리다(아이콘 색·흰 배경·정렬·높이는 jest 사각 — className 토큰까지만 심판, 02a ★A). submitError 는
  // 이제 트리거라 여기 문자열 내용은 화면에 안 뜬다(단일 줄 "저장하지 못했어요"만).
  {
    key: 'trip-new-step1-save-error',
    band: 'g',
    label: 'g01 · 여행 만들기 save-error',
    login: null,
    render: () => (
      <TripWizardStep1Screen
        {...TRIP_WIZARD_BASE}
        mustVisits={MUST_VISIT_THUMBNAILS}
        submitError="네트워크를 확인하고 다시 시도해주세요"
        onRetrySubmit={noop}
      />
    ),
  },
  // g01 여행지 편집 시트(TRIP-666, Figma `3626:2070`) — 시트 열린 상태. `DestinationEditSheet`은
  // props-only 순수 뷰(스토어·라우터 미참조)라 컨테이너 import 사슬 함정 없이 그대로 태운다.
  // jest 는 스테퍼 원·점선 추가 버튼·시트 딤/개폐를 못 봐(바텀시트 통과형 목) 이 키가 유일한
  // 6-b 육안 대조 자리다. seq 1=부산 2박, seq 2=경주 1박(경주는 nights 1이라 − 가 비활성).
  {
    key: 'trip-new-step1-destination-sheet',
    band: 'g',
    label: 'g01 · 여행지 편집 시트',
    login: null,
    render: () => (
      <DestinationEditSheet
        destinations={[
          { seq: 1, region: '부산', nights: 2 },
          { seq: 2, region: '경주', nights: 1 },
        ]}
        onChangeNights={noop}
        onRemove={noop}
        onAddCity={noop}
        onApply={noop}
        onClose={noop}
        mustVisitCount={7}
      />
    ),
  },
  // g01 기간 편집 시트(TRIP-667, Figma `3627:2068`) — 완성 범위(6/10~6/13) 열린 상태. `PeriodEditSheet`은
  // props-only 순수 뷰(스토어·라우터·시계 미참조)라 컨테이너 import 사슬 함정 없이 그대로 태운다. jest 는
  // 시작/종료 분홍 원·사이 연장 배경·요일 색·시트 딤/개폐를 못 봐(바텀시트 통과형 목) 이 키가 유일한
  // 6-b 육안 대조 자리다. today=6/1 이라 과거 셀 없음, prev 는 6월이 today 달이라 비활성.
  {
    key: 'trip-new-step1-period-sheet',
    band: 'g',
    label: 'g01 · 기간 편집 시트',
    login: null,
    render: () => (
      <PeriodEditSheet
        today="2026-06-01"
        month="2026-06"
        range={{ start: '2026-06-10', end: '2026-06-13' }}
        onPickDate={noop}
        onPrevMonth={noop}
        onNextMonth={noop}
        onApply={noop}
        onClose={noop}
      />
    ),
  },
  // g01 동행 편집 시트(TRIP-668, Figma `3642:2068`) — 친구 선택·인원 2명 열린 상태.
  // `CompanionEditSheet`은 props-only 순수 뷰(스토어·라우터 미참조)라 컨테이너 import 사슬 함정
  // 없이 그대로 태운다. jest 는 칩 활성 분홍 배경·글리프 흰색·스테퍼 원·시트 딤/개폐를 못 봐
  // (바텀시트 통과형 목) 이 키가 유일한 6-b 육안 대조 자리다. 혼자를 골랐을 때의 스테퍼 회색·
  // 값 1명 고정은 배선(TripNewStep1Page)이 지는 값 고정이라 이 정적 프리뷰로는 안 보인다.
  {
    key: 'trip-new-step1-companion-sheet',
    band: 'g',
    label: 'g01 · 동행 편집 시트',
    login: null,
    render: () => (
      <CompanionEditSheet
        party={2}
        companionType="친구"
        onChangeParty={noop}
        onSelectCompanion={noop}
        onApply={noop}
        onClose={noop}
      />
    ),
  },
  // g01 취향 편집 시트(TRIP-669, Figma `3644:2068`) — 미식·문화예술·관광 선택된 열린 상태(TRIP-738
  // 픽스처). `PrefOverrideSheet`은 props-only 순수 뷰(스토어·라우터 미참조)라 컨테이너 import 사슬
  // 함정 없이 그대로 태운다. jest 는 칩 활성 분홍 배경·글리프 색·안내문·시트 딤/개폐를 못 봐(바텀시트
  // 통과형 목) 이 키가 유일한 6-b 육안 대조 자리다. 활성 칩 아이콘이 흰색(on-primary)인지도 여기서만 보인다.
  {
    key: 'trip-new-step1-pref-sheet',
    band: 'g',
    label: 'g01 · 취향 편집 시트',
    login: null,
    render: () => (
      <PrefOverrideSheet
        selected={['미식', '문화예술', '관광']}
        onToggle={noop}
        onApply={noop}
        onClose={noop}
      />
    ),
  },
  // g01 예산 편집 시트(TRIP-670, Figma `3647:2068`) — 중간 tier 선택·₩1,200,000 열린 상태.
  // `BudgetEditSheet`은 props-only 순수 뷰(스토어·라우터 미참조)라 컨테이너 import 사슬 함정 없이
  // 그대로 태운다. jest 는 활성 칩 분홍 배경·흰 글자·₩/원 정렬·안내 range·시트 딤/개폐를 못 봐
  // (바텀시트 통과형 목) 이 키가 유일한 6-b 육안 대조 자리다.
  {
    key: 'trip-new-step1-budget-sheet',
    band: 'g',
    label: 'g01 · 예산 편집 시트',
    login: null,
    render: () => (
      <BudgetEditSheet
        amountText="1,200,000"
        tier="중간"
        onChangeAmount={noop}
        onSelectTier={noop}
        onApply={noop}
        onClose={noop}
      />
    ),
  },
  // g02 얼굴(TRIP-672 재작성). 화면이 완성된 카드 뷰모델만 받는 프레젠테이션이라 배선 없이
  // props 만 갈아 끼우면 얼굴이 그대로 나온다 — 실기로 얼굴을 보려면 여기가 정본이다
  // (`docs/structure.md` 경고: "엣지 케이스 화면을 눈으로 보려면 목을 만들지 말고 여기에 상태를
  // 추가한다"). 조회 실패(`variant="error"`)·여행 없음(`variant="notrip"`)·배정 0(옵션 A) 얼굴은
  // TRIP-742 로 프리뷰 키(`-error`·`-notrip`·`-no-stay`)를 삭제했다 — INV-4 폴백을 그리는 화면
  // 코드(`TripWizardStep2Screen` 의 variant)는 유지하고 프리뷰 배선만 지운다(키 삭제 ≠ 기능 삭제).
  {
    key: 'trip-new-step2-default',
    band: 'g',
    label: 'g02 · 거점 숙소 default',
    login: null,
    render: () => <TripWizardStep2Screen {...TRIP_BASE_SCREEN} />,
  },
  {
    key: 'trip-new-step2-loading',
    band: 'g',
    label: 'g02 · 거점 숙소 loading',
    login: null,
    render: () => (
      <TripWizardStep2Screen
        {...TRIP_BASE_SCREEN}
        variant="loading"
        cards={[]}
      />
    ),
  },
  // g02 empty 얼굴(TRIP-674, Figma `3665:2068`) — 저장 숙소 0. 박별 미정 행(메타+chevron, 숙소명 없음)
  // + "저장한 숙소가 없어요…" 부제 + "숙소 없이 계속"/"숙소 둘러보기" CTA. 부제 색(muted)·행 크롬은 jest
  // 사각이라 이 키가 유일한 6-b 육안 대조 자리(-loading 신 스켈레톤도 같이 여기서 눈으로 본다).
  {
    key: 'trip-new-step2-empty',
    band: 'g',
    label: 'g02 · 거점 숙소 empty',
    login: null,
    render: () => (
      <TripWizardStep2Screen
        {...TRIP_BASE_SCREEN}
        variant="empty"
        cards={[
          { nightNumber: 1, dateLabel: '6/10(수)', region: '부산' },
          { nightNumber: 2, dateLabel: '6/11(목)', region: '부산' },
          { nightNumber: 3, dateLabel: '6/12(금)', region: '경주' },
        ]}
      />
    ),
  },
  // g02 숙소 선택 시트(TRIP-673 S9 → TRIP-741 후보 카드 Figma 정합, `3669:2068`) — 광안리 선택 상태.
  // 3후보 전부 사진(draft-preview 재사용)·동네·거리·가격·날짜를 채워 Figma 육안 동일(rich 필드는
  // StaySelectCandidate optional — SavedStay 계약엔 없어 실데이터는 미렌더, 프리뷰만 채운다 INV-1).
  // 감천은 날짜 없음 후보(→"날짜 없음" 서브라인). jest 는 딤·실개폐·사진 실렌더·선택 테두리 분홍
  // 1.5px·체크 분홍을 못 봐(바텀시트 통과형 목·svg 정수화) 이 키가 유일한 6-b 육안 대조 자리다.
  {
    key: 'trip-new-step2-staysheet',
    band: 'g',
    label: 'g02 · 숙소 선택 시트',
    login: null,
    render: () => (
      <StaySelectSheet
        title="2박 · 부산"
        dateLabel="6/11(목)"
        candidates={[
          {
            savedStayId: 'stay-gwangalli',
            name: '광안리 뷰 호텔',
            coordConfirmed: true,
            checkIn: '2026-06-11',
            checkOut: '2026-06-12',
            registerRoute: 'MAP_SEARCH',
            createdAt: '2026-08-01T00:00:00Z',
            updatedAt: '2026-08-01T00:00:00Z',
            imageUrl: DRAFT_PREVIEW_PHOTOS[0] ?? undefined,
            region: '광안리',
            priceLabel: '165,000원~',
          },
          {
            savedStayId: 'stay-haeundae',
            name: '해운대 오션 호텔',
            coordConfirmed: true,
            checkIn: '2026-06-10',
            checkOut: '2026-06-12',
            registerRoute: 'MAP_SEARCH',
            createdAt: '2026-08-01T00:00:00Z',
            updatedAt: '2026-08-01T00:00:00Z',
            imageUrl: DRAFT_PREVIEW_PHOTOS[1] ?? undefined,
            region: '해운대',
            priceLabel: '190,000원~',
          },
          {
            savedStayId: 'stay-gamcheon',
            name: '감천 게스트하우스',
            coordConfirmed: false,
            checkIn: null,
            checkOut: null,
            registerRoute: 'MAP_SEARCH',
            createdAt: '2026-08-01T00:00:00Z',
            updatedAt: '2026-08-01T00:00:00Z',
            imageUrl: DRAFT_PREVIEW_PHOTOS[2] ?? undefined,
            region: '감천',
            priceLabel: '92,000원~',
          },
        ]}
        selectedSavedStayId="stay-gwangalli"
        onSelect={noop}
        onBrowse={noop}
        onAssign={noop}
        onClose={noop}
      />
    ),
  },
  // h02 꼭 갈 곳 (TRIP-785) — Figma 대조용 격리 렌더. default→loading→error 순으로 삽입해
  // (안정 정렬 = 배열 위치) devPreviewBandSort EXPECTED_H 의 h02 3키 순서를 맞춘다.
  {
    key: 'h02-mustvisit-default',
    band: 'h',
    label: 'h02 · 꼭 갈 곳',
    login: null,
    render: () => (
      <MustVisitPickerScreen
        view={{
          kind: 'listed',
          // 사진 있는 픽스처로 대조한다 — jest 스텁은 `.uri` 가 undefined 라 회색이지만,
          // 실기에선 로컬 에셋이 뜬다(`DRAFT_PREVIEW_PHOTOS` 관례, INV-1 안전).
          items: MUST_VISIT_PREVIEW_ITEMS.map((item, index) => ({
            ...item,
            imageUrl: DRAFT_PREVIEW_PHOTOS[index] ?? null,
          })),
          staleFailed: false,
        }}
        pins={MUST_VISIT_PREVIEW_PINS}
      />
    ),
  },
  {
    key: 'h02-mustvisit-loading',
    band: 'h',
    label: 'h02 · 꼭 갈 곳 loading',
    login: null,
    render: () => <MustVisitPickerScreen view={{ kind: 'loading' }} />,
  },
  {
    key: 'h02-mustvisit-error',
    band: 'h',
    label: 'h02 · 꼭 갈 곳 error',
    login: null,
    render: () => <MustVisitPickerScreen view={{ kind: 'failed' }} />,
  },
  {
    key: 'h03-mustvisit-time-default',
    band: 'h',
    label: 'h03 · 방문 시각 지정 default',
    login: null,
    render: () => (
      <MustVisitTimeScreen
        sourcePoiId="poi-a"
        placeName="부산시립미술관"
        region="부산 부산진구"
        imageUrl={DRAFT_PREVIEW_PHOTOS[0]}
        dayChips={tripDayChips({
          startDate: '2026-06-10',
          endDate: '2026-06-13',
        })}
        startOptions={startTimeOptions()}
        form={{
          fixed: true,
          fixedDate: '2026-06-10',
          fixedStart: '13:00',
          dwellKey: 'NORMAL',
        }}
        blockReason={null}
      />
    ),
  },
  {
    key: 'h03-mustvisit-time-off',
    band: 'h',
    label: 'h03 · 방문 시각 지정 off',
    login: null,
    render: () => (
      <MustVisitTimeScreen
        sourcePoiId="poi-a"
        placeName="부산시립미술관"
        region="부산 부산진구"
        imageUrl={DRAFT_PREVIEW_PHOTOS[0]}
        dayChips={tripDayChips({
          startDate: '2026-06-10',
          endDate: '2026-06-13',
        })}
        startOptions={startTimeOptions()}
        form={{
          fixed: false,
          fixedDate: '2026-06-10',
          fixedStart: '13:00',
          dwellKey: 'NORMAL',
        }}
        blockReason={null}
      />
    ),
  },
  {
    key: 'h03-mustvisit-time-error',
    band: 'h',
    label: 'h03 · 방문 시각 지정 error',
    login: null,
    render: () => (
      <MustVisitTimeScreen
        sourcePoiId="poi-a"
        placeName="부산시립미술관"
        region="부산 부산진구"
        imageUrl={DRAFT_PREVIEW_PHOTOS[0]}
        dayChips={tripDayChips({
          startDate: '2026-06-10',
          endDate: '2026-06-13',
        })}
        startOptions={startTimeOptions()}
        form={{
          fixed: true,
          fixedDate: '2026-06-10',
          fixedStart: '13:00',
          dwellKey: 'NORMAL',
        }}
        blockReason={null}
        errorText="저장하지 못했어요"
        onRetry={noop}
      />
    ),
  },
  // h08 지도+시트 셸 접힘(TRIP-783) — Figma `4221:2448` 대조용. 셸(전면 지도+2스냅 시트+오버레이+
  // CTA) 부품을 h08 default 4슬롯으로 조립한다. 2스냅 실개폐·딤은 통과형 목 사각이라 index=0(peek)
  // 얼굴만 고정된다 — 6-b 실기가 유일한 개폐 그물. 지도 태그는 셸이 소유하므로 여기엔 없다.
  {
    key: 'h08-draft-collapsed',
    band: 'h',
    label: 'h08 · 지도+시트 셸 접힘',
    login: null,
    render: () => (
      <MapSheetShell
        center={{ lat: 35.1532, lng: 129.1188 }}
        pins={buildDraftPins(H08_PREVIEW_SLOTS)}
        days={[
          { label: '1일차' },
          { label: '2일차' },
          { label: '3일차' },
          { label: '4일차' },
        ]}
        selectedDayIndex={0}
        onSelectDay={noop}
        onBack={noop}
        header={
          <SheetHeader
            title="AI 추천안"
            dayLabel="1일차"
            dateLabel="6월 10일(수)"
            meta="4곳 · 3.5km"
          />
        }
        cta={[
          { label: '다시 짜기', variant: 'outline', onPress: noop },
          { label: '확정하기', variant: 'primary', onPress: noop },
        ]}
      >
        <View className="gap-md px-lg pb-2xl pt-xs">
          {H08_PREVIEW_SLOTS.flatMap((slot, index) => {
            const items = [
              <SlotStopCard
                key={`card-${slot.poiId}`}
                slot={slot}
                date={H08_PREVIEW_DATE}
                index={index}
                timeLabel={H08_PREVIEW_TIME_LABELS[index]}
                required={index === 2}
                onPressName={noop}
                onPressAlt={noop}
              />,
            ];
            if (index < H08_PREVIEW_CONNECTORS.length) {
              items.push(
                <DistanceConnector
                  key={`conn-${slot.poiId}`}
                  slotKey={buildSlotKey(H08_PREVIEW_DATE, slot.poiId)}
                  distanceRange={H08_PREVIEW_CONNECTORS[index]}
                />
              );
            }
            return items;
          })}
        </View>
      </MapSheetShell>
    ),
  },
  // h08 지도+시트 셸 펼침(TRIP-792) — Figma `4224:2448` 대조용. 접힘 조립을 그대로 복제하고
  // `initialIndex={1}` 만 더해 시트가 상단 스냅까지 열린 얼굴을 낸다(2스냅 실개폐는 통과형 목
  // 사각이라 6-b 실기가 유일한 개폐 그물). 배열에서 collapsed 바로 뒤에 둬 안정 정렬이
  // collapsed→expanded 순서를 내게 한다(devPreviewBandSort EXPECTED_H).
  {
    key: 'h08-draft-expanded',
    band: 'h',
    label: 'h08 · 지도+시트 셸 펼침',
    login: null,
    render: () => (
      <MapSheetShell
        center={{ lat: 35.1532, lng: 129.1188 }}
        pins={buildDraftPins(H08_PREVIEW_SLOTS)}
        initialIndex={1}
        days={[
          { label: '1일차' },
          { label: '2일차' },
          { label: '3일차' },
          { label: '4일차' },
        ]}
        selectedDayIndex={0}
        onSelectDay={noop}
        onBack={noop}
        header={
          <SheetHeader
            title="AI 추천안"
            dayLabel="1일차"
            dateLabel="6월 10일(수)"
            meta="4곳 · 3.5km"
          />
        }
        cta={[
          { label: '다시 짜기', variant: 'outline', onPress: noop },
          { label: '확정하기', variant: 'primary', onPress: noop },
        ]}
      >
        <View className="gap-md px-lg pb-2xl pt-xs">
          {H08_PREVIEW_SLOTS.flatMap((slot, index) => {
            const items = [
              <SlotStopCard
                key={`card-${slot.poiId}`}
                slot={slot}
                date={H08_PREVIEW_DATE}
                index={index}
                timeLabel={H08_PREVIEW_TIME_LABELS[index]}
                required={index === 2}
                onPressName={noop}
                onPressAlt={noop}
              />,
            ];
            if (index < H08_PREVIEW_CONNECTORS.length) {
              items.push(
                <DistanceConnector
                  key={`conn-${slot.poiId}`}
                  slotKey={buildSlotKey(H08_PREVIEW_DATE, slot.poiId)}
                  distanceRange={H08_PREVIEW_CONNECTORS[index]}
                />
              );
            }
            return items;
          })}
        </View>
      </MapSheetShell>
    ),
  },
  {
    // h07 부분 결과(TRIP-790) — 옛 h10 DraftScreen 인라인 게이지를 공용 지도+시트 셸 얼굴로 개명·
    // 재작성. 진행 카드가 day-chip 자리를 대체(overlay)하고, peek 시트에 도착한 1일차 슬롯을 얹는다.
    // 게이지 3셀(day1 완성/day2 생성 중/day3 대기)은 3일 여행에서 도출되나 프리뷰는 표시값을 직접
    // 세운다(실 도출은 DraftPage + buildGenerationGauge, A8-1b 가 심판). CTA 없음(생성 중 · D9).
    key: 'h07-generating-partial',
    band: 'h',
    label: 'h07 · 부분 결과',
    login: null,
    render: () => (
      <MapSheetShell
        center={{ lat: 35.1532, lng: 129.1188 }}
        pins={buildDraftPins(H08_PREVIEW_SLOTS)}
        overlay={
          <GenerationProgressCard
            cells={[
              { status: 'done', label: '1일차 완성' },
              { status: 'active', label: '2일차 생성 중' },
              { status: 'waiting', label: '3일차 대기' },
            ]}
            onBack={noop}
          />
        }
        header={
          // 제목에 날짜를 합쳐 한 leaf 로(진행 카드 게이지 done 라벨 "1일차 완성" 과 겹치지 않게 —
          // DraftPage 실배선과 같은 구조, A8-1b/A8-1e 근거). 프리뷰는 Figma 형식 "(수)" 로 세운다.
          <SheetHeader
            title="1일차 완성 · 6월 10일(수)"
            dayLabel=""
            dateLabel=""
            meta="4곳 · 3.5km"
          />
        }
      >
        <View className="gap-md px-lg pb-2xl pt-xs">
          {H08_PREVIEW_SLOTS.flatMap((slot, index) => {
            const items = [
              <SlotStopCard
                key={`card-${slot.poiId}`}
                slot={slot}
                date={H08_PREVIEW_DATE}
                index={index}
                timeLabel={H08_PREVIEW_TIME_LABELS[index]}
                onPressAlt={noop}
              />,
            ];
            if (index < H08_PREVIEW_CONNECTORS.length) {
              items.push(
                <DistanceConnector
                  key={`conn-${slot.poiId}`}
                  slotKey={buildSlotKey(H08_PREVIEW_DATE, slot.poiId)}
                  distanceRange={H08_PREVIEW_CONNECTORS[index]}
                />
              );
            }
            return items;
          })}
        </View>
      </MapSheetShell>
    ),
  },
  // h11 같이 결과(CoPick 완료, TRIP-796) — Figma `4257:2148` 대조용. 공용 지도+시트 셸에 CoPick 5슬롯
  // (비고정 4 + 고정 숙소 1)을 얹는다. 고정 숙소는 단일 시각 `21:00`+부제+고정 배지, 비고정은 시각
  // 범위 칩만(다른 후보 링크 없음 · h08 과 차이). meta 는 비고정 4 → `4/4 골랐어요`. 배열에서 fallback
  // 3키 **직전**(h11 그룹 첫 자리)에 둬 안정 정렬이 copick→fallback 순서를 내게 한다(devPreviewBandSort
  // EXPECTED_H · 02a ★13). 2스냅 실개폐·딤은 통과형 목 사각이라 6-b 실기가 유일한 개폐 그물.
  {
    key: 'h11-copick-complete',
    band: 'h',
    label: 'h11 · 같이 결과 CoPick 완료',
    login: null,
    render: () => (
      <MapSheetShell
        center={{ lat: 35.1532, lng: 129.1188 }}
        pins={buildDraftPins(H11_COPICK_PREVIEW_SLOTS)}
        days={[
          { label: '1일차' },
          { label: '2일차' },
          { label: '3일차' },
          { label: '4일차' },
        ]}
        selectedDayIndex={0}
        onSelectDay={noop}
        onBack={noop}
        header={
          <SheetHeader
            title="부산 여행"
            dayLabel="1일차"
            dateLabel="6월 10일(수)"
            meta="4/4 골랐어요"
          />
        }
        cta={[{ label: '확정하기', variant: 'primary', onPress: noop }]}
      >
        <View className="gap-md px-lg pb-2xl pt-xs">
          {H11_COPICK_PREVIEW_SLOTS.flatMap((slot, index) => {
            const timeLabel = slot.isFixed
              ? slot.startAt.slice(0, 5)
              : `${slot.startAt.slice(0, 5)}–${slot.endAt.slice(0, 5)}`;
            const items = [
              <SlotStopCard
                key={`card-${slot.poiId}`}
                slot={slot}
                date={H11_COPICK_PREVIEW_DATE}
                index={index}
                timeLabel={timeLabel}
                required={index === 2}
                fixed={slot.isFixed}
                subtitle={slot.isFixed ? '저녁 · 숙소 · 변경 불가' : undefined}
              />,
            ];
            if (index < H11_COPICK_PREVIEW_SLOTS.length - 1) {
              const nextSlot = H11_COPICK_PREVIEW_SLOTS[index + 1];
              items.push(
                <DistanceConnector
                  key={`conn-${slot.poiId}`}
                  slotKey={buildSlotKey(H11_COPICK_PREVIEW_DATE, slot.poiId)}
                  distanceRange={nextSlot.distanceRange}
                />
              );
            }
            return items;
          })}
        </View>
      </MapSheetShell>
    ),
  },
  // TRIP-304 폴백·강등 배너 3종 — 심각도 삼분(MINIMAL > LOW > DETERMINISTIC). 실화면 딥링크로는
  // 아직 못 본다(서버가 solveMode/isFallback/요약 신호를 안 준다). 목록은 그대로고 배너 한 줄만
  // 곁에 붙으며, MINIMAL 만 배너 안에 [다시 시도]를 갖는다.
  {
    key: 'itinerary-draft-fallback-deterministic',
    band: 'h',
    label: 'h11 · 폴백 기본 모드',
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
    band: 'h',
    label: 'h11 · 폴백 최소 일정',
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
    band: 'h',
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
    band: 'h',
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
  // h01 시작 방법(TRIP-303 → TRIP-784) — props 만 받는 프레젠테이션이라 배선 없이 얼굴이 그대로
  // 나온다. 세 방식 콜백이 필수라(TRIP-784 soon 폴백 소멸) 프리뷰도 세 콜백을 다 넘긴다. 생성
  // 선행조건(거점 커버리지·겹침) 게이트는 h01 에 없다 — 그 판단은 여행 생성 2/2(g02)가 소유한다.
  {
    key: 'h01-method',
    band: 'h',
    label: 'h01 · 시작 방법',
    login: null,
    render: () => (
      <MethodPickerScreen
        onBack={noop}
        onPressFullAi={noop}
        onPressManual={noop}
        onPressCoPick={noop}
      />
    ),
  },
  // h09 생성 중(TRIP-305) — props 만 받는 프레젠테이션이라 배선 없이 얼굴이 그대로 나온다. 진행
  // 표면은 비결정형(RN Animated)이고 3단계는 균일 진행 중(⚑C, 완료 날조 없음)이다. 실화면 딥링크로는
  // 잠깐만 스치는 얼굴이라(성공 즉시 draft 로 replace) 여기가 이 화면을 오래 보는 유일한 자리다.
  {
    key: 'h07-generating-loading',
    band: 'h',
    label: 'h07 · 생성 중 loading',
    login: null,
    render: () => (
      <GeneratingScreen
        onBackground={noop}
        onRetry={noop}
        pins={MUST_VISIT_PREVIEW_PINS}
        center={{ lat: 35.1532, lng: 129.1188 }}
      />
    ),
  },
  // h07 생성 실패 프리뷰 키(itinerary-generating-failed)는 TRIP-789로 삭제 — 실패 표면·핸들링
  // 코드(GeneratingScreen failed/onRetry·GeneratingPage isError→failed)는 그대로 유지되고,
  // 폴백 전용 화면(TRIP-791)이 이 얼굴을 흡수한다(부모 결정 G: 코드 유지·키만 삭제).
  // h14 완성 일정(PLANNED, TRIP-799) — 옛 h25 TimelineScreen PLANNED 프리뷰 4키를 지도+시트 셸 4얼굴로
  // 교체(D7). PLANNED 는 이제 셸이라 실화면 딥링크로도 이 얼굴을 보려면 백엔드 응답이 필요해, 여기가
  // 4얼굴을 정적으로 대조하는 자리다. 4얼굴은 별 화면이 아니라 같은 셸의 데이터 분기다.
  // 배열 삽입 순서(default→distance-pending→map-fallback→no-base)가 devPreviewBandSort EXPECTED_H 의
  // h14 안정 정렬 순서를 정한다(같은 h14 코드라 배열 위치=정렬 위치, 02a ★14).
  {
    key: 'h14-plan-default',
    band: 'h',
    label: 'h14 · 완성 일정 default',
    login: null,
    render: () =>
      renderH14PlanSheet({
        slots: H11_COPICK_PREVIEW_SLOTS,
        meta: '4곳 · 4.1km',
      }),
  },
  {
    key: 'h14-plan-distance-pending',
    band: 'h',
    label: 'h14 · 완성 일정 거리계산중',
    login: null,
    render: () =>
      renderH14PlanSheet({
        slots: H14_PLAN_PENDING_SLOTS,
        meta: '4곳',
      }),
  },
  {
    key: 'h14-plan-map-fallback',
    band: 'h',
    label: 'h14 · 완성 일정 지도폴백',
    login: null,
    render: () =>
      renderH14PlanSheet({
        slots: H11_COPICK_PREVIEW_SLOTS,
        meta: '4곳 · 4.1km',
        mapFallback: H14_MAP_FALLBACK,
      }),
  },
  {
    key: 'h14-plan-no-base',
    band: 'h',
    label: 'h14 · 완성 일정 거점없음',
    login: null,
    render: () =>
      renderH14PlanSheet({
        slots: H14_PLAN_NO_BASE_SLOTS,
        meta: '4곳 · 3.5km',
        noBase: true,
      }),
  },
  // 내 여행 목록 · h05/h06(TRIP-788) — 배열 순서 background→done-bar→loading→empty(안정 정렬 =
  // devPreviewBandSort EXPECTED_H 위치). background 는 완성(사진)·생성중·초안·미도착 4카드 + "최신순"
  // 라벨, done-bar 는 그 목록 위에 완료 도킹 배너를 얹는다. 배지 pill·resume 오버레이·사진 자리·배너
  // 절대배치·체크 색은 jest 사각(6-b 전용).
  {
    key: 'h05-my-trips-background',
    band: 'h',
    label: 'h05 · 내 여행 목록',
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
    key: 'h05-my-trips-done-bar',
    band: 'h',
    label: 'h05 · 완료 도킹 배너',
    login: null,
    render: () => (
      <View style={{ flex: 1 }}>
        <MyTripsListScreen
          mode="list"
          onPressCreateTrip={noop}
          cards={MY_TRIPS_PREVIEW_VMS.map((vm) => (
            <MyTripCard key={vm.tripId} vm={vm} onPress={noop} />
          ))}
        />
        <GenerationDoneBar tripName="서귀포시 여행" onPressView={noop} />
      </View>
    ),
  },
  {
    key: 'h06-my-trips-loading',
    band: 'h',
    label: 'h06 · 내 여행 스켈레톤',
    login: null,
    render: () => <MyTripsListScreen mode="loading" onPressCreateTrip={noop} />,
  },
  {
    key: 'h06-my-trips-empty',
    band: 'h',
    label: 'h06 · 내 여행 empty',
    login: null,
    render: () => <MyTripsListScreen mode="empty" onPressCreateTrip={noop} />,
  },
  // l03 마이페이지 · l03(TRIP-604) — 프로필 카드·세그먼트·예정 카드·지난 여행(회고 chevron)·설정
  // 행을 한 화면에서 Figma l03 default(1602:2388)와 대조한다. 예정 2건 + 종료 2건(회고 진입 chevron).
  {
    key: 'my-page-default',
    band: 'l',
    label: 'l03 · 예정+지난 여행',
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
    band: 'l',
    label: 'l03 · 예정 0·종료 0',
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
    band: 'l',
    label: 'l03 · 스타일 카드 미달',
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
    band: 'l',
    label: 'l04 · 등록 숙소 3행',
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
    band: 'l',
    label: 'l04 · 등록 숙소 0건',
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
    band: 'l',
    label: 'l02 · 알림 설정 기본',
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
    band: 'l',
    label: 'l02 · 알림 설정 권한 거부',
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
  {
    key: 'h04-time-adjust-sheet',
    band: 'h',
    label: 'h04 · 시각 조정 시트',
    login: null,
    render: () => (
      <View className="flex-1">
        <TimeSheet
          mode="h04"
          testIDPrefix="itinerary-edit-time"
          labels={{ start: '시작', end: '종료' }}
          startAt="13:00:00"
          endAt="14:30:00"
          placeSummary={{
            imageUrl: DRAFT_PREVIEW_PHOTOS[0],
            name: '부산시립미술관',
            badgeLabel: '필수',
            region: '부산 부산진구',
          }}
          onApply={noop}
          onCancel={noop}
        />
      </View>
    ),
  },
  // h16 확정 일정(TRIP-801) — CONFIRMED 지도+시트 셸(옛 h34 TimelineScreen 읽기전용을 대체). 페이지
  // (ItineraryPlanPage)는 react-query·라우터가 필요해 프리뷰에서 직접 못 쓰므로 셸 조립을 축소해
  // 그린다(h14 선례). 확정 얼굴의 신규 3요소(지도 위 성공 배너·이름 옆 휴관 경고·[일정 수정]·[공유하기]
  // 2버튼)를 한 화면에서 육안 대조한다. 슬롯은 h11 결과 픽스처를 재사용한다.
  {
    key: 'h16-plan-confirmed',
    band: 'h',
    label: 'h16 · 확정 일정',
    login: null,
    render: () => (
      <MapSheetShell
        center={{ lat: 35.1532, lng: 129.1188 }}
        pins={buildDraftPins(H11_COPICK_PREVIEW_SLOTS)}
        days={[
          { label: '1일차' },
          { label: '2일차' },
          { label: '3일차' },
          { label: '4일차' },
        ]}
        selectedDayIndex={0}
        onSelectDay={noop}
        onBack={noop}
        mapCard={<ConfirmedBanner />}
        header={
          <SheetHeader
            title="부산 여행"
            dayLabel="1일차"
            dateLabel="6월 10일(수)"
            meta="확정됨 · 4곳 · 4.1km"
          />
        }
        cta={[
          { label: '일정 수정', variant: 'outline', onPress: noop },
          { label: '공유하기', variant: 'primary', onPress: noop },
        ]}
      >
        <View className="gap-md px-lg pb-2xl pt-xs">
          {H11_COPICK_PREVIEW_SLOTS.flatMap((slot, index) => {
            const timeLabel = slot.isFixed
              ? slot.startAt.slice(0, 5)
              : `${slot.startAt.slice(0, 5)}–${slot.endAt.slice(0, 5)}`;
            const items: ReactElement[] = [
              <SlotStopCard
                key={`card-${slot.poiId}`}
                slot={slot}
                date={H14_PLAN_PREVIEW_DATE}
                index={index}
                timeLabel={timeLabel}
                fixed={slot.isFixed}
                subtitle={slot.isFixed ? '저녁 · 숙소 · 변경 불가' : undefined}
                // 휴관 경고 표면 육안 대조용 — 비고정 한 슬롯에 얹는다(실 페이지는 openingHoursKnown
                // === false 서버 신호로 켠다).
                warning={index === 1 ? '휴관일 확인' : undefined}
              />,
            ];
            if (index < H11_COPICK_PREVIEW_SLOTS.length - 1) {
              const nextSlot = H11_COPICK_PREVIEW_SLOTS[index + 1];
              items.push(
                <DistanceConnector
                  key={`conn-${slot.poiId}`}
                  slotKey={buildSlotKey(H14_PLAN_PREVIEW_DATE, slot.poiId)}
                  distanceRange={nextSlot.distanceRange}
                />
              );
            }
            return items;
          })}
        </View>
      </MapSheetShell>
    ),
  },
  // h12 슬롯 교체(TRIP-335→483) — 바텀시트를 슬롯 카드 아래 **인라인 확장 패널**로 이관했다. candidates
  // 는 아직 이름·사진 미확보(BE 후속)라 카드가 "이름 준비 중" 플레이스홀더 + 회색 사진 자리로 뜬다.
  // 실화면 딥링크로는 볼 수 없다(생성 POST 가 만드는 tripId + slot-candidates 응답이 백엔드 없이는
  // 안 생긴다). 인라인 패널이라 오버레이 없이 스크롤 흐름 안에서 그리고, 헤더에 시간대(오후)를 얹는다.
  {
    key: 'slot-candidate-panel',
    band: 'h',
    label: 'h12 · 다른 후보 인라인 패널',
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
    band: 'h',
    label: 'h12 · 다른 후보 교체 중',
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
    band: 'h',
    label: 'h12 · 다른 후보 강등 고지',
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
    band: 'h',
    label: 'h12 · 다른 후보 0건',
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
    band: 'h',
    label: 'h12 · 다른 후보 실패',
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
  // h12 편집기 통일(TRIP-797) — 지도+2스냅 시트 위 슬롯 카드 편집. 순수 뷰 EditorView 를 preview 가
  // 직접 태운다(컨테이너 api 사슬 없음, TRIP-610 회피). 빈/채움/드래그 세 정적 얼굴을 대조한다.
  // 실제 드래그·시트 개폐·딤은 통과형 목이 못 봄(6-b 실기 전용).
  {
    key: 'h12-editor-empty',
    band: 'h',
    label: 'h12 · 편집기 빈 일정',
    login: null,
    render: () => (
      <EditorView
        center={{ lat: 35.1532, lng: 129.1188 }}
        days={[TIMELINE_PREVIEW_DAYS[0]]}
        slots={[]}
        activeDayIndex={0}
        activeDate={TIMELINE_PREVIEW_DAYS[0].date}
        onSelectDay={noop}
        onBack={noop}
        onPressTimeChip={noop}
        onPressAddPlace={noop}
        onPressAddBetween={noop}
        onSave={noop}
      />
    ),
  },
  {
    key: 'h12-editor-filled',
    band: 'h',
    label: 'h12 · 편집기 슬롯 채움',
    login: null,
    render: () => (
      <EditorView
        center={{ lat: 35.1532, lng: 129.1188 }}
        days={TIMELINE_PREVIEW_DAYS}
        slots={TIMELINE_PREVIEW_SLOTS}
        activeDayIndex={0}
        activeDate={TIMELINE_PREVIEW_DAYS[0].date}
        onSelectDay={noop}
        onBack={noop}
        onPressTimeChip={noop}
        onPressAddPlace={noop}
        onPressAddBetween={noop}
        onSave={noop}
      />
    ),
  },
  {
    key: 'h12-editor-dragging',
    band: 'h',
    label: 'h12 · 편집기 드래그 삭제',
    login: null,
    render: () => (
      <EditorView
        center={{ lat: 35.1532, lng: 129.1188 }}
        days={TIMELINE_PREVIEW_DAYS}
        slots={TIMELINE_PREVIEW_SLOTS}
        activeDayIndex={0}
        activeDate={TIMELINE_PREVIEW_DAYS[0].date}
        onSelectDay={noop}
        onBack={noop}
        onPressTimeChip={noop}
        onPressAddPlace={noop}
        onPressAddBetween={noop}
        onSave={noop}
        isDragging
      />
    ),
  },
  {
    key: 'option-swap',
    band: 'h',
    label: 'h18 · 옵션 교체 화면',
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
    band: 'h',
    label: 'h18 · 옵션 교체 선택 후 실패',
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
    band: 'h',
    label: 'h18 · 옵션 교체 0건',
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
  // h13 장소 추가(TRIP-798, 구 h20) — 묶음 C 시트화. 전면 지도 위 peek 시트(MapSheetShell)의 list 슬롯에
  // 후보(PlaceAddRow)를 얹고, 검색바+칩(PlaceAddHeader)은 리스트 헤더(children)로, "장소 추가 · N일차"는
  // header 로 조립한다(페이지 PlaceAddPage 와 같은 형태, 단 조회 훅 대신 픽스처 — 프리뷰는 api import 0).
  // 실화면 딥링크로는 빈 일정 생성 POST 를 백엔드가 만들어야 도달하므로(401 이면 못 봄) 여기가 눈 확인
  // 자리다. 거리줄은 픽스처로만 렌더한다(실 GET 엔 거리 필드 없음 — 6-b 육안). 2스냅 실개폐·핀 위치는 실기.
  {
    key: 'h13-place-add',
    band: 'h',
    label: 'h13 · 장소 추가',
    login: null,
    render: () => (
      <MapSheetShell
        center={{ lat: 35.1532, lng: 129.1188 }}
        pins={buildDraftPins(H11_COPICK_PREVIEW_SLOTS)}
        onBack={noop}
        header={
          <Text className="px-lg pb-xs pt-sm font-noto-bold text-[18px] font-bold text-ink">
            장소 추가 · 1일차
          </Text>
        }
        list={{
          data: PREVIEW_PLACES,
          renderItem: ({ item }) => (
            <PlaceAddRow
              place={item}
              added={item.poiId === PREVIEW_PLACES[0].poiId}
              distanceLine={
                item.poiId === 'p-1'
                  ? '③에서 1.1km'
                  : item.poiId === 'p-4'
                    ? '숙소에서 800m'
                    : undefined
              }
              onPressAdd={noop}
            />
          ),
          keyExtractor: (place) => place.poiId,
          testID: 'itinerary-place-list',
        }}
      >
        <PlaceAddHeader
          searchText=""
          selectedCategory={null}
          onChangeSearchText={noop}
          onSelectCategory={noop}
        />
      </MapSheetShell>
    ),
  },
  // i05 현재 장소 상세(TRIP-398) — props-only 화면. jest 는 픽셀·레이아웃을 못 봐 이 자리가
  // 유일하게 눈으로 보는 곳. 결측 얼굴은 model 결측 스위치를 켠 뷰를 그대로 얹는다.
  {
    key: 'live-place-default',
    band: 'i',
    label: 'i05 · 현재 장소 상세',
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
    band: 'i',
    label: 'i05 · 현재 장소 상세 결측',
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
    band: 'i',
    label: 'i01 · 여행 중 일정 방문 체크',
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
    band: 'i',
    label: 'i08 · 트리거 칩+배너',
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
    band: 'e',
    label: 'e04 · 저장한 숙소 목록',
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
    band: 'e',
    label: 'e04 · 저장한 숙소 빈 상태',
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
    band: 'i',
    label: 'i10 · 재계획 요청 수동',
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
    band: 'i',
    label: 'i10 · 재계획 요청 감지 배너',
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
    band: 'i',
    label: 'i10 · 재계획 요청 범위 밖',
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
    band: 'i',
    label: 'i12 · 재계획 로딩',
    login: null,
    render: () => <ReplanSolvingScreen onBackground={noop} onCancel={noop} />,
  },
  // ── i14 슬롯 후보 시트(TRIP-440) — 순수 인라인 패널 3얼굴(후보·강등 고지·빈 목록). slackLabel
  //    은 slackTime.ts(model) 산출 형태를 그대로 주입한다(ui 소스엔 숫자 리터럴 0) ──
  {
    key: 'planb-candidates',
    band: 'i',
    label: 'i14 · 슬롯 후보 3장',
    login: null,
    render: () => (
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <ScrollView contentContainerClassName="gap-md p-lg">
          <SlotCandidateSheet
            candidates={SLOT_CANDIDATES_PREVIEW}
            slackLabel="여유 1시간 20분"
          />
        </ScrollView>
      </SafeAreaView>
    ),
  },
  {
    key: 'planb-candidates-degraded',
    band: 'i',
    label: 'i14 · 슬롯 후보 강등',
    login: null,
    render: () => (
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <ScrollView contentContainerClassName="gap-md p-lg">
          <SlotCandidateSheet
            candidates={SLOT_CANDIDATES_PREVIEW}
            slackLabel="여유 40분"
            degraded
          />
        </ScrollView>
      </SafeAreaView>
    ),
  },
  {
    key: 'planb-candidates-empty',
    band: 'i',
    label: 'i14 · 슬롯 후보 0건',
    login: null,
    render: () => (
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <ScrollView contentContainerClassName="gap-md p-lg">
          <SlotCandidateSheet candidates={[]} slackLabel="여유 1시간 20분" />
        </ScrollView>
      </SafeAreaView>
    ),
  },
  // ── i13 재계획안(TRIP-563) — 순수 화면 2얼굴. 채운 슬롯(배지 5종·후보·고정)과 빈 슬롯 degrade
  //    (헤더 근거·이월 안내만). 지도 center 는 골격 플레이스홀더, 일차 스위치·사진·번호는 draft 계약
  //    공백이라 없다 — 슬롯 배지·거리 메타·우측 어포던스·CTA 배치를 육안 대조하는 자리(실 지도·시트
  //    열림은 6-b). draft 실슬롯 바인딩은 BE 후속 ──
  {
    key: 'planb-replan-draft',
    band: 'i',
    label: 'i13 · 재계획안 채운 슬롯',
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
    band: 'i',
    label: 'i13 · 재계획안 빈 슬롯',
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
    band: 'i',
    label: 'i16 · 대안 없음',
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
    band: 'i',
    label: 'i19 · 반영 완료',
    login: null,
    render: () => <ReplanAppliedScreen onBack={noop} onContinue={noop} />,
  },
  // ── i20·i21 위치 수동 입력·권한 거부 폴백(TRIP-442) — 한 컴포넌트를 state prop 으로 두 얼굴.
  //    지도 롱프레스 실동작·"이 위치로 계속" 핸드오프·핀 오버레이·Figma 픽셀은 jest 사각이라 이
  //    두 키가 육안 대조 자리다(i20 `1790:3495`·i21 `1790:3549`). 자체 조회 없는 프리젠테이션이라
  //    QueryClient 없이 렌더된다 ──
  {
    key: 'live-location-manual',
    band: 'i',
    label: 'i20 · 수동 위치 입력',
    login: null,
    render: () => <LiveLocationPage tripId="preview-trip" state="manual" />,
  },
  {
    key: 'live-location-denied',
    band: 'i',
    label: 'i21 · 위치 권한 거부',
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
    band: 'i',
    label: 'i15 · 일정 편집 정상',
    login: null,
    render: () => <ManualEditPreview />,
  },
  {
    key: 'planb-manual-fallback',
    band: 'i',
    label: 'i22 · 일정 직접 수정 폴백',
    login: null,
    render: () => <ManualEditPreview variant="error" />,
  },
  {
    key: 'planb-manual-violation',
    band: 'i',
    label: 'i22 · 폴백 위반 배지',
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
    band: 'i',
    label: 'i09 · 감지된 변화 발화',
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
    band: 'i',
    label: 'i09 · 감지된 변화 정상',
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
    band: 'l',
    label: 'l05 · 설정 기본',
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
    band: 'l',
    label: 'l05 · 내보내기 잘림',
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
    band: 'l',
    label: 'l05 · 내보내기 실패',
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
    band: 'l',
    label: 'l05 · 삭제 유예',
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
    band: 'l',
    label: 'l05 · 삭제 다이얼로그',
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
    band: 'l',
    label: 'l06 · 위치 동의 ON',
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
    band: 'l',
    label: 'l06 · 위치 동의 거부',
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
    band: 'l',
    label: 'l06 · 철회 다이얼로그',
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
    band: 'l',
    label: 'l05 · 개인화 반영중',
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
    band: 'l',
    label: 'l05 · 개인화 미동의',
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
    band: 'l',
    label: 'l05 · 개인화 기록부족',
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
    band: 'l',
    label: 'l01 · 알림함 기본',
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
    band: 'l',
    label: 'l01 · 알림함 빈 상태',
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
  // j07 기록 탭 허브 2키(TRIP-575) — 순수 뷰(`RecordsCalendarScreen`)를 격리 렌더한다(`@/shared/api`·
  // `@/features/*` 값 import 0 이라 프리뷰 지뢰 목 통과). `-default`는 커스텀 월 그리드·코랄 pill 마킹
  // (연속 구간 양 끝 둥글림)·legend·지난 여행 카드(제목·기간·박수만, 사진·통계 없음 — Q2 degrade)를,
  // `-empty`는 저장 여행 0건 안내 + 새 여행 버튼을 한 화면에서 육안 대조한다. 코랄 pill 색·정렬 픽셀은
  // jest 사각이라 이 키가 유일한 육안 그물(자율 세션이라 6-b 미실행 — 다음 세션 확인 대상).
  {
    key: 'records-calendar-default',
    band: 'j',
    label: 'j07 · 캘린더 마킹',
    login: null,
    render: () => (
      <RecordsCalendarScreen
        monthLabel="2026년 6월"
        grid={buildMonthGrid('2026-06')}
        markedDays={[
          '2026-06-10',
          '2026-06-11',
          '2026-06-12',
          '2026-06-20',
          '2026-06-21',
        ]}
        monthLegends={[
          {
            tripId: 't-busan',
            title: '부산 여행',
            dateRangeLabel: '2026.6.10–6.12',
            nightsLabel: '2박 3일',
          },
        ]}
        pastTrips={[
          {
            tripId: 't-jeju',
            title: '제주 여행',
            dateRangeLabel: '2026.5.1–5.3',
            nightsLabel: '2박 3일',
          },
          {
            tripId: 't-gangneung',
            title: '강릉 여행',
            dateRangeLabel: '2026.4.18–4.20',
            nightsLabel: '2박 3일',
          },
          {
            tripId: 't-weekend',
            title: '주말 나들이',
            dateRangeLabel: null,
            nightsLabel: null,
          },
        ]}
        isEmpty={false}
        onPressPrevMonth={noop}
        onPressNextMonth={noop}
        onSelectTrip={noop}
        onPressCreateTrip={noop}
      />
    ),
  },
  {
    key: 'records-calendar-empty',
    band: 'j',
    label: 'j07 · 캘린더 빈 상태',
    login: null,
    render: () => (
      <RecordsCalendarScreen
        monthLabel="2026년 6월"
        grid={[]}
        markedDays={[]}
        pastTrips={[]}
        isEmpty
        onPressPrevMonth={noop}
        onPressNextMonth={noop}
        onSelectTrip={noop}
        onPressCreateTrip={noop}
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

// first-cut 9밴드 고정 순서(figma-structure.md) — 밴드 버튼 줄이 이 순서대로 선다. '기타'는
// 해당 상태가 있을 때만 뒤에 붙인다(map-default 하나뿐이지만 하드코딩 대신 데이터에서 파생).
const FIRST_CUT_BANDS: Band[] = ['a', 'c', 'd', 'e', 'g', 'h', 'i', 'j', 'l'];

// 해석된 상태 키의 밴드를 돌려준다 — AC-3 초기 selectedBand 는 이 결과 위에 얹힌다.
// resolveInitialStateKey 가 늘 존재하는 키(또는 splash)를 주므로 find 는 항상 잡히지만,
// 타입상 undefined 가능이라 '기타' 로 방어한다(도달 불가 경로).
function bandOfKey(key: string): Band {
  return PREVIEW_STATES.find((state) => state.key === key)?.band ?? '기타';
}

// 밴드 그룹 안 정렬 키 — 라벨의 ' · ' 앞 코드 토큰(예 'h11'). 166코드가 전부 2자리 zero-pad라
// 사전순 문자열 비교가 곧 번호순이다(숫자 파싱 불필요). 파일 국소 헬퍼(export 안 함).
const codeOf = (state: PreviewState): string => state.label.split(' · ')[0];

// 코드 토큰만 1차 키로 비교한다 — 같은 코드의 여러 얼굴은 sort 가 안정(ES2019+/Hermes)이라
// 배열 삽입 순서가 그대로 보존된다(라벨 전체로 비교하면 얼굴명이 2차 키로 새어 의미 순서가 깨진다).
const byBandCode = (a: PreviewState, b: PreviewState): number => {
  const ca = codeOf(a);
  const cb = codeOf(b);
  return ca < cb ? -1 : ca > cb ? 1 : 0;
};

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
  // 밴드 초기 선택 = 초기 활성 상태의 밴드(딥링크면 그 화면의 밴드가 자동 선택된다, AC-3).
  // activeKey 와 같은 지연 초기화자(최초 마운트 1회) 위에 얹는다 — 딥링크 1회성 계약 그대로.
  const [selectedBand, setSelectedBand] = useState<Band>(() =>
    bandOfKey(resolveInitialStateKey(rawState))
  );
  // '기타' 밴드 상태가 하나라도 있을 때만 버튼 줄 끝에 '기타' 를 붙인다(데이터에서 파생).
  const bandButtons: Band[] = PREVIEW_STATES.some(
    (state) => state.band === '기타'
  )
    ? [...FIRST_CUT_BANDS, '기타']
    : FIRST_CUT_BANDS;

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
        {/*
         * 1단 — 밴드 버튼 줄(first-cut 9 + '기타'). 누르면 그 밴드 그룹만 펼친다(setSelectedBand).
         */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          // flexGrow:0 으로 바 높이를 내용물 크기로 고정(세로로 늘어나지 않게).
          style={{ flexGrow: 0 }}
          contentContainerStyle={{ gap: 8, padding: 12, alignItems: 'center' }}
        >
          {bandButtons.map((band) => {
            const selected = band === selectedBand;
            return (
              <Pressable
                key={band}
                testID={`dev-preview-band-${band}`}
                onPress={() => setSelectedBand(band)}
                className={`rounded-lg px-3 py-2 ${
                  selected ? 'bg-blue-600' : 'bg-gray-700'
                }`}
              >
                <Text className="text-xs font-bold text-white">{band}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
        {/*
         * 2단 — 밴드별 칩 그룹. ★ show-not-mount: 모든 칩은 항상 트리에 남고, 비선택 밴드
         * 그룹만 인라인 style 로 시각적으로 접는다({width:0,height:0,overflow:'hidden'}).
         * display:'none'·조건부 언마운트 금지 — RNTL v13 은 display:'none' 만 쿼리에서 제외하고
         * width/height/overflow 는 findable 로 남기므로, 접힌 밴드 칩도 동결 7스위트의
         * getByTestId/press 가 그대로 통과한다(AC-4). 그룹 래퍼는 className 없는 plain View 라
         * props.style 이 내가 넣은 인라인 값 그대로(NativeWind 무오염) → toHaveStyle 로 관찰된다.
         */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ flexGrow: 0 }}
          contentContainerStyle={{ gap: 8, padding: 12, alignItems: 'center' }}
        >
          {bandButtons.map((band) => (
            <View
              key={band}
              testID={`dev-preview-band-group-${band}`}
              style={
                band === selectedBand
                  ? undefined
                  : { width: 0, height: 0, overflow: 'hidden' }
              }
            >
              <View
                style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}
              >
                {PREVIEW_STATES.filter((state) => state.band === band)
                  .sort(byBandCode)
                  .map((state) => {
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
                        <Text className="text-xs text-white">
                          {state.label}
                        </Text>
                      </Pressable>
                    );
                  })}
              </View>
            </View>
          ))}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
