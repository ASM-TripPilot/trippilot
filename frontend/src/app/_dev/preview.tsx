import type { ReactElement } from 'react';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  SocialLoginScreen,
  type SocialLoginScreenProps,
} from '@/features/auth/ui/SocialLoginScreen';
import { SplashScreen } from '@/features/auth/ui/SplashScreen';
import {
  HOME_DEFAULT_PROPS,
  HOME_EMPTY_PROPS,
  HOME_LOADING_PROPS,
  HOME_NO_TRIP_PROPS,
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
import { HomeScreen } from '@/features/home/ui/HomeScreen';
import { NicknameScreen } from '@/features/onboarding/ui/NicknameScreen';
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
import { LocationPreprompt } from '@/shared/location/LocationPreprompt';
import { KakaoMapView } from '@/shared/map';

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

// 온보딩 약관 3행 — 필수 2종(D1) + 마케팅 선택. 버전은 서버가 주는 값을 흉내낸 대표값.
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
    label: '개인정보 처리방침',
    required: true,
    checked: false,
  },
  {
    termsType: 'MARKETING',
    version: '1.2',
    label: '마케팅 정보 수신',
    required: false,
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
  // ── 홈 대시보드 4상태(TRIP-170) — 프레젠테이션 전용, 고정 픽스처로 그린다 ──
  {
    key: 'home-default',
    label: '홈 · 기본',
    login: null,
    render: () => <HomeScreen {...HOME_DEFAULT_PROPS} />,
  },
  {
    key: 'home-no-trip',
    label: '홈 · 첫 사용자',
    login: null,
    render: () => <HomeScreen {...HOME_NO_TRIP_PROPS} />,
  },
  {
    key: 'home-empty',
    label: '홈 · 취향 부족',
    login: null,
    render: () => <HomeScreen {...HOME_EMPTY_PROPS} />,
  },
  {
    key: 'home-loading',
    label: '홈 · 로딩',
    login: null,
    render: () => <HomeScreen {...HOME_LOADING_PROPS} />,
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
