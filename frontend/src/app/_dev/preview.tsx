import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  SocialLoginScreen,
  type SocialLoginScreenProps,
} from '@/features/auth/screens/SocialLoginScreen';
import { SplashScreen } from '@/features/auth/screens/SplashScreen';

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
}

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
];

export default function DevPreviewScreen() {
  const [activeKey, setActiveKey] = useState(PREVIEW_STATES[0].key);
  const active =
    PREVIEW_STATES.find((state) => state.key === activeKey) ??
    PREVIEW_STATES[0];

  return (
    <View testID="dev-preview-root" className="flex-1 bg-white">
      {/*
       * 이 앱에는 SafeAreaProvider 가 없다(_layout.tsx 는 GestureHandlerRootView + SplashGate 뿐).
       * 그래서 컨텍스트를 읽는 useSafeAreaInsets() 는 0 을 돌려줄 수 있다 — 대신 인셋을
       * 네이티브 쪽에서 직접 재어 패딩으로 넣는 SafeAreaView 를 쓴다(프로바이더 불필요).
       * edges 를 top 으로 좁혀, 아래쪽 여백은 화면 컴포넌트 자신의 몫으로 남긴다.
       */}
      <SafeAreaView edges={['top']}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          // ScrollView 의 기본 스타일은 flexGrow:1 이라, 세로 부모 안에서 아래 화면 영역과
          // 남은 높이를 나눠 갖는다(토글 줄이 화면 40% 를 먹은 원인). 0 으로 눌러
          // 높이를 내용물 크기로 되돌린다.
          style={{ flexGrow: 0 }}
          // 교차축(세로) 기본값이 stretch 라 알약이 줄 높이만큼 늘어난다 → 가운데 정렬로 고정.
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

      <View className="flex-1">
        {active.login ? (
          <SocialLoginScreen {...active.login} {...VIEW_ONLY_HANDLERS} />
        ) : (
          <SplashScreen />
        )}
      </View>
    </View>
  );
}
