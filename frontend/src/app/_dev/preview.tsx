import type { ReactElement } from 'react';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  SocialLoginScreen,
  type SocialLoginScreenProps,
} from '@/features/auth/screens/SocialLoginScreen';
import { SplashScreen } from '@/features/auth/screens/SplashScreen';
import { NicknameScreen } from '@/features/onboarding/screens/NicknameScreen';
import { TermsScreen } from '@/features/onboarding/screens/TermsScreen';
import { LocationPreprompt } from '@/shared/location/LocationPreprompt';

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

const PREVIEW_STATES: PreviewState[] = [
  { key: 'splash', label: '스플래시', login: null },
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
];

// 탭 자동화가 불가한 환경에서 특정 상태를 스크린샷하려면 이 값을 바꿔 저장한 뒤
// 딥링크로 프리뷰를 다시 열어 리마운트한다(초기 상태로 이 키가 뜬다). 평소값은 'splash'.
const INITIAL_STATE_KEY = 'splash';

export default function DevPreviewScreen() {
  const initialKey =
    PREVIEW_STATES.find((state) => state.key === INITIAL_STATE_KEY)?.key ??
    PREVIEW_STATES[0].key;
  const [activeKey, setActiveKey] = useState(initialKey);
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
