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
  PREVIEW_SAVED_PLACES,
  PREVIEW_SAVED_POI_IDS,
} from '@/features/explore/model/exploreFixtures';
import { REGIONS } from '@/features/explore/model/regions';
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
import {
  formatConfirmedDateRange,
  type PlanDayTab,
} from '@/features/itinerary/model/planState';
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
import { MustVisitPickerScreen } from '@/features/itinerary/ui/MustVisitPickerScreen';
import { MustVisitTimeScreen } from '@/features/itinerary/ui/MustVisitTimeScreen';
import { SlotTimeSheet } from '@/features/itinerary/ui/SlotTimeSheet';
import { MethodPickerScreen } from '@/features/itinerary/ui/MethodPickerScreen';
import { TimelineScreen } from '@/features/itinerary/ui/TimelineScreen';
import { ZeroCandidateScreen } from '@/features/itinerary/ui/ZeroCandidateScreen';
import { NicknameScreen } from '@/features/onboarding/ui/NicknameScreen';
import {
  StayRegisterScreen,
  type StayRegisterScreenProps,
} from '@/features/stay/ui/StayRegisterScreen';
import {
  TripWizardStep1Screen,
  type TripWizardStep1ScreenProps,
} from '@/features/trip/ui/TripWizardStep1Screen';
import {
  TripWizardStep2Screen,
  type TripWizardStep2ScreenProps,
} from '@/features/trip/ui/TripWizardStep2Screen';
import { PrefStep1Screen } from '@/features/onboarding/ui/PrefStep1Screen';
import { PrefStep2Screen } from '@/features/onboarding/ui/PrefStep2Screen';
import { TermsScreen } from '@/features/onboarding/ui/TermsScreen';
import type {
  ItineraryDaysItem,
  ItineraryDaysItemSlotsItem,
} from '@/shared/api/generated/schemas';
import { LocationPreprompt } from '@/shared/location/LocationPreprompt';
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

const EXPLORE_LANDING_BASE = {
  heading: {
    title: '무엇을 둘러볼까요?',
    subtitle: '숙소·장소·여행자 일정을 둘러보고 담아요',
  },
  onSubmitSearch: noop,
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
].map((source) => Image.resolveAssetSource(source)?.uri ?? null);

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
const TRIP_WIZARD_BASE: TripWizardStep1ScreenProps = {
  destinations: [{ seq: 1, region: '부산', nights: 3 }],
  startDate: '2026-06-10',
  endDate: '2026-06-13',
  presetCode: '3n4d',
  party: 2,
  companionType: '친구',
  preferenceChips: ['감성 골목', '야경'],
  regions: REGIONS,
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
        selectedFoods={null}
        selectedTransports={null}
        onToggleBudget={noop}
        onToggleCompanion={noop}
        onToggleFood={noop}
        onToggleTransport={noop}
        onBack={noop}
        onDone={noop}
        onSkipAll={noop}
      />
    ),
  },
  {
    key: 'onboarding-location-default',
    label: '위치 · 프리프롬프트',
    login: null,
    render: () => (
      <LocationPreprompt
        purposeContext="내 주변 숙소 탐색"
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
  {
    key: 'stay-region-default',
    label: '지역 선택 · 숙소',
    login: null,
    render: () => (
      <RegionPickerScreen
        purpose="stay"
        query=""
        regions={REGIONS}
        nearby={{ kind: 'idle' }}
        onChangeQuery={noop}
        onSelectRegion={noop}
        onSelectNearby={noop}
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
        regions={REGIONS}
        nearby={{ kind: 'idle' }}
        onChangeQuery={noop}
        onSelectRegion={noop}
        onSelectNearby={noop}
        onBack={noop}
      />
    ),
  },
  {
    key: 'stay-nearby-denied',
    label: '내 주변 · 등록숙소 대체',
    login: null,
    render: () => (
      <RegionPickerScreen
        purpose="stay"
        query=""
        regions={REGIONS}
        nearby={{ kind: 'fallback' }}
        onChangeQuery={noop}
        onSelectRegion={noop}
        onSelectNearby={noop}
        onBack={noop}
      />
    ),
  },
  {
    key: 'stay-nearby-no-fallback',
    label: '내 주변 · 대체 불가',
    login: null,
    render: () => (
      <RegionPickerScreen
        purpose="stay"
        query=""
        regions={REGIONS}
        nearby={{ kind: 'unavailable', reason: 'denied-no-fallback' }}
        onChangeQuery={noop}
        onSelectRegion={noop}
        onSelectNearby={noop}
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
        bridge={{ savedCount: 3, onPressCreateTrip: noop }}
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
        bridge={{ savedCount: 0, onPressCreateTrip: noop }}
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
        bridge={{ savedCount: 2, onPressCreateTrip: noop }}
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
  // h34 확정 읽기전용(TRIP-300) — 같은 데이터에 status=CONFIRMED 를 얹은 확정 얼굴. 확정 배너·
  // appbar `확정 일정`·하단 비활성 2버튼을 Figma h34 와 눈으로 대조한다. 부제는 실기와 같은 조립
  // 함수(formatConfirmedDateRange)로 만든다 — 손으로 적으면 프리뷰와 실기가 갈린다.
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
        confirmedSubtitle={`${formatConfirmedDateRange(
          '2026-06-10',
          '2026-06-13'
        )} · 부산 여행 · 5곳`}
        onSelectDay={noop}
        onBack={noop}
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
