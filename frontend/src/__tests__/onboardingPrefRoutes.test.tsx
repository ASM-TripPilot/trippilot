import { render, screen } from '@testing-library/react-native';

import { usePreferenceStore } from '@/features/onboarding/model/preferenceStore';
import OnboardingLayout from '@/app/(onboarding)/_layout';
import Pref1Route from '@/app/(onboarding)/pref1';
import Pref2Route from '@/app/(onboarding)/pref2';

/**
 * AC3 · FW1 — 취향 라우트가 (onboarding) 가드에 걷어차이지 않고, 라우트 래퍼가 실제
 * 컨테이너를 그린다.
 *
 * 무엇을 보장하나:
 *  (1) 지금은 FW1(useOnboardingProgress 하드코딩 {false,false}) 때문에 레이아웃이 이미
 *      스택을 그린다 — 이 테스트는 **후속에서 FW1을 실배선할 때** 취향 라우트가 가드에
 *      막히면 곧바로 빨개지도록 심어 두는 회귀 가드다(7-1 · 선제 green).
 *  (2) pref1.tsx·pref2.tsx가 얇은 래퍼로 실제 컨테이너를 렌더한다는 것을 **런타임**으로
 *      증명한다(6-1은 소스 문자열 검사, 이건 실제 렌더 — 상호 보완, 7-2).
 *
 * *(개념)* expo-router 목을 두 겹으로 합쳐 쓴다: Redirect/Stack 마커(레이아웃 관찰용,
 * 동결 onboardingEntryGuard와 같은 모듈)와 useRouter(컨테이너용)를 **한 팩토리**에 담는다
 * — 이 파일이 레이아웃(7-1)과 라우트 렌더(7-2) 두 관심사를 함께 다루기 때문이다(§7-10의
 * "한 파일에 섞지 않는다" 원칙은 관찰 관심사가 하나일 때의 기본값이고, 이 파일처럼 두
 * 관심사를 한 파일에 묶기로 한 이상 팩토리를 합치는 것이 유일한 방법이다 — 각 it은
 * 자신에게 필요한 쪽만 골라 쓴다).
 *
 * 3동작: 준비(목·스토어) → 실행(렌더) → 단언(스택/리다이렉트 또는 컨테이너 루트 표시).
 */

jest.mock('expo-router', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const redirectMock = require('@/test-support/expoRouterRedirectMock');
  const replace = jest.fn();
  const push = jest.fn();
  const back = jest.fn();
  return {
    __esModule: true,
    ...redirectMock,
    useRouter: () => ({ replace, push, back }),
    router: { replace, push, back },
  };
});

// TRIP-471로 PrefStep2Page가 `usePutMePreferences()`(react-query useMutation)를 물게 되면서,
// QueryClientProvider 없이 pref2 래퍼를 렌더하는 이 테스트가 `No QueryClient set`으로 크래시한다.
// 완료 시 fire-and-forget PUT 하나뿐(렌더 중 mutate 미호출)이라, 무해 스텁으로 훅만 끊는다
// (layer-test.md: tabsShell의 useGetTrips 스텁과 동일 계열, 라우트 렌더 관심사와 무관).
jest.mock('@/shared/api/generated/preferences/preferences', () => ({
  usePutMePreferences: () => ({ mutate: jest.fn() }),
}));

beforeEach(() => {
  usePreferenceStore.getState().reset();
});

describe('(onboarding)/_layout — 취향 라우트가 가드에 걷어차이지 않는다 (AC3 · FW1 · 7-1 · 선제 green)', () => {
  it('지금(FW1 하드코딩 {false,false})은 레이아웃이 리다이렉트 없이 스택을 그린다', () => {
    // 실행 — useOnboardingProgress를 목 없이 실물 그대로 둔 채(하드코딩 {false,false})
    // 온보딩 레이아웃을 렌더한다.
    render(<OnboardingLayout />);

    // 단언(긍정) — 자식 스택이 그려진다.
    expect(screen.getByTestId('onboarding-stack')).toBeOnTheScreen();
    // 단언(부정) — 어떤 Redirect도 없다. 후속에서 FW1을 실배선했을 때 취향 라우트가
    // 가드에 막히면 이 단언이 먼저 빨개진다(회귀 가드).
    expect(screen.queryByTestId('redirect-href')).toBeNull();
  });
});

describe('취향 라우트 래퍼 — 실제 컨테이너 렌더 (AC3 · 7-2)', () => {
  it('pref1.tsx·pref2.tsx의 기본 export가 각각 실제 컨테이너를 그린다', () => {
    // 실행 — 1/2 라우트 렌더.
    const { unmount } = render(<Pref1Route />);
    // 단언 — 컨테이너가 실제로 그려졌다는 증거로 화면 루트 testID를 본다(6-1과 달리
    // 런타임 증명).
    expect(screen.getByTestId('onboarding-pref1-root')).toBeOnTheScreen();
    unmount();

    // 실행 — 2/2 라우트 렌더.
    render(<Pref2Route />);
    // 단언.
    expect(screen.getByTestId('onboarding-pref2-root')).toBeOnTheScreen();
  });
});
