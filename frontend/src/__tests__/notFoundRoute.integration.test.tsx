import { Stack, Tabs } from 'expo-router';
import { Text } from 'react-native';
import {
  act,
  fireEvent,
  renderRouter,
  screen,
} from 'expo-router/testing-library';

import { SPLASH_MIN_VISIBLE_MS, SplashGate } from '@/app/routing/SplashGate';
import { useBootstrapGate, type BootstrapDestination } from '@/features/auth';
import {
  publishGateDestination,
  resetGateDestination,
} from '@/features/auth/model/gateDestination';
import NotFoundRoute from '@routes/+not-found';

/**
 * TRIP-935 · 없는 경로 화면의 [홈으로]가 **실제 라우터에서** 게이트가 연 화면에 닿는다(Maestro M-08).
 *
 * 왜 실물 라우터인가: 버그는 "어떤 문자열로 replace 하나"가 아니라 "그 문자열을 라우터가 어디로 푸나"에 있었다.
 * `'/'` 는 `(onboarding)/index` 와 `(tabs)/index` 둘에 걸리고 라우터는 가드를 모른 채 `(onboarding)` 으로
 * 풀어서, 그 그룹이 닫힌 HOME 상태에선 replace 가 조용히 버려졌다. 라우터 목(`notFoundRoute.test`)으로는
 * 이것이 안 보인다.
 *
 * *(개념)* `renderRouter` — expo-router 가 주는 테스트용 앱. 경로 → 화면 표를 넘기면 실제 라우터가 돈다.
 *   루트 `_layout` 에 실제 `SplashGate` 를 꽂아 가드 표(Stack.Protected)는 앱과 같은 것을 쓴다.
 *   그룹 화면들은 testID 만 가진 가짜다.
 *
 * 3동작: 준비 = 게이트 목적지 + 없는 경로로 앱 열기 → 실행 = [홈으로] → 단언 = 그 목적지의 화면이 보인다.
 *
 * 통합 버킷 이유: 실물 expo-router 는 node 버킷(`--experimental-vm-modules`)에서 로드가 실패한다.
 */

jest.mock('@/features/auth/model/useBootstrapGate', () => ({
  __esModule: true,
  BOOTSTRAP_TIMEOUT_MS: 3000,
  useBootstrapGate: jest.fn(),
}));
// 계정 경계 정리·푸시 재등록은 SplashGate 의 다른 테스트가 본다 — 여기선 끈다.
jest.mock('@/app/model/useAccountBoundaryReset', () => ({
  useAccountBoundaryReset: jest.fn(),
}));
jest.mock('@/shared/push', () => ({ registerPushIfGranted: jest.fn() }));

const mockUseBootstrapGate = useBootstrapGate as jest.MockedFunction<
  typeof useBootstrapGate
>;

function stub(testID: string) {
  return function Stub() {
    return <Text testID={testID}>{testID}</Text>;
  };
}

// 키 순서 = 앱 파일 순서(require.context, 사전순). 순서가 판정에 걸린다: 지금 화면과 그룹이 안 겹치면
// '/' 처럼 여러 라우트에 똑같이 맞는 경로는 앞 키가 이긴다 — (tabs) 를 앞에 두면 옛 버그가 안 보인다.
const ROUTES = {
  _layout: SplashGate,
  '(auth)/_layout': () => <Stack />,
  '(auth)/login': stub('login-root'),
  '(onboarding)/_layout': () => <Stack />,
  '(onboarding)/index': stub('onboarding-root'),
  '(tabs)/_layout': () => <Tabs />,
  '(tabs)/index': stub('home-root'),
  '+not-found': NotFoundRoute,
  'force-update': stub('force-update-root'),
  reconsent: stub('reconsent-root'),
  'trips/[tripId]/planb/index': stub('planb-root'),
};

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  mockUseBootstrapGate.mockReset();
  resetGateDestination();
  jest.useRealTimers();
});

describe('🔴 TRIP-935 M-08 · [홈으로]는 게이트가 연 화면에 닿는다', () => {
  it.each<[BootstrapDestination, string]>([
    ['HOME', 'home-root'],
    ['ONBOARDING', 'onboarding-root'],
    ['LOGIN', 'login-root'],
    ['RECONSENT', 'reconsent-root'],
    ['FORCE_UPDATE', 'force-update-root'],
  ])('목적지 %s → [홈으로] → %s', (destination, landing) => {
    // 준비 — 게이트가 destination 을 열었고, 없는 경로로 앱이 열렸다.
    mockUseBootstrapGate.mockReturnValue({
      phase: 'resolved',
      destination,
      isProvisional: false,
    });
    publishGateDestination(destination);
    renderRouter(ROUTES, { initialUrl: '/zz-none' });
    act(() => {
      jest.advanceTimersByTime(SPLASH_MIN_VISIBLE_MS);
    });
    expect(screen.getByTestId('not-found-home')).toBeOnTheScreen();

    // 실행
    fireEvent.press(screen.getByTestId('not-found-home'));

    // 단언 — 목적지 화면이 보이고 없는 경로 화면은 사라졌다.
    expect(screen.getByTestId(landing)).toBeOnTheScreen();
    expect(screen.queryByTestId('not-found-home')).toBeNull();
  });
});
