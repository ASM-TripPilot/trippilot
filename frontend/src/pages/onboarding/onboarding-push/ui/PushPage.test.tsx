import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { resetPressGuard } from '@/shared/lib/pressGuard';
import {
  getPushPermission,
  promptAndRegisterPush,
  registerPushIfGranted,
  requestPushPermission,
} from '@/shared/push';

import { PushPage } from './PushPage';

/**
 * TRIP-1108 · 온보딩 location → **push** → pref1 — 푸시 사전 안내 카드 **배선**.
 *
 * 무엇을 보장하나:
 *  - 카드에 도착한 것만으로는 권한을 조회하지도 묻지도 않는다(카드가 먼저, OS 창은 누른 뒤).
 *  - `계속` → 권한 루틴(`promptAndRegisterPush`)을 1회 부르고 **결과를 기다리지 않고** 취향 1/2 로 replace.
 *  - `나중에 하기` → 묻지 않고 취향 1/2 로 replace.
 *  - 연타해도 루틴·이동은 1회다(guardPress).
 *
 * 왜 목인가: 여기서 보는 것은 "누른 뒤 루틴을 불렀나 / 어디로 갔나"뿐이다. 루틴 안(요청 게이트·토큰 등록)은
 *  `shared/push/wiring.test.ts` 가 잰다. 카드는 목하지 않는다 — 배럴(`@/shared/push`)을 통째로 바꿔
 *  끼우므로, 카드를 배럴에서 가져오면 여기서 `undefined` 가 되어 렌더가 죽는다(카드는 딥 경로로 import).
 *
 * 3동작 뼈대: 준비(루틴 목 모양) → 실행(render + press) → 단언(루틴 횟수 · replace 인자·횟수).
 */

// TRIP-1157: 배럴이 PushPreprompt 도 재수출한다 — 통째로 갈아끼우면 화면 컴포넌트가 지워지므로 실물을 펼친 뒤 권한 함수만 덮는다.
jest.mock('@/shared/push', () => ({
  ...jest.requireActual('@/shared/push'),
  promptAndRegisterPush: jest.fn(() => Promise.resolve()),
  requestPushPermission: jest.fn(() => Promise.resolve('UNDETERMINED')),
  getPushPermission: jest.fn(() => Promise.resolve('UNDETERMINED')),
  registerPushIfGranted: jest.fn(() => Promise.resolve()),
}));

jest.mock('expo-router', () => {
  const replace = jest.fn();
  const push = jest.fn();
  const back = jest.fn();
  return {
    __esModule: true,
    useRouter: () => ({ replace, push, back }),
    router: { replace, push, back },
  };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const routerMock = require('expo-router').router as {
  replace: jest.Mock;
  push: jest.Mock;
  back: jest.Mock;
};

const mockPrompt = promptAndRegisterPush as jest.Mock;
const PREF1_ROUTE = '/(onboarding)/pref1';

/** 가드 판정용으로 멈춰 둘 시각(값은 의미 없다 — 흐르지 않는 것이 요점). */
const FROZEN_NOW = 1_790_000_000_000;

// 연타 가드의 400ms 창은 모듈 하나에 하나다 — 앞 케이스의 누름이 새지 않게 파일 최상위에서 닫는다.
beforeEach(() => {
  resetPressGuard();
  jest.clearAllMocks();
  mockPrompt.mockImplementation(() => Promise.resolve());
});
afterEach(() => resetPressGuard());

describe('🔴 TRIP-1108 AC-2 · 도착만으로는 묻지 않는다', () => {
  it('W1 카드가 보이고, 푸시 함수(조회·요청·루틴·등록)는 하나도 불리지 않으며 이동도 없다', () => {
    // 실행
    render(<PushPage />);

    // 단언 — 카드가 먼저 보인다
    expect(screen.getByTestId('onboarding-push-root')).toBeOnTheScreen();
    expect(screen.getByTestId('onboarding-push-hero')).toBeOnTheScreen();
    expect(screen.getByTestId('onboarding-push-purpose')).toBeOnTheScreen();
    // 단언 — OS 창은 누른 뒤에만(마운트에서 권한 조회도 하지 않는다, R3)
    expect(mockPrompt).toHaveBeenCalledTimes(0);
    expect(requestPushPermission).toHaveBeenCalledTimes(0);
    expect(getPushPermission).toHaveBeenCalledTimes(0);
    expect(registerPushIfGranted).toHaveBeenCalledTimes(0);
    expect(routerMock.replace).toHaveBeenCalledTimes(0);
  });
});

describe('🔴 TRIP-1108 AC-3 · 계속 → 루틴 1회 + 취향 1/2', () => {
  it('W2 "계속"을 누르는 그 순간 루틴 1회를 부르고 pref1 로 replace 한다(페이지가 직접 요청하지 않는다)', () => {
    render(<PushPage />);
    // 실행 전 앵커 — 아직 아무 데도 안 갔다.
    expect(routerMock.replace).toHaveBeenCalledTimes(0);

    fireEvent.press(screen.getByTestId('onboarding-push-allow'));

    // 동기 단언 — waitFor 없이. 누른 틱에 이동해야 한다.
    expect(mockPrompt).toHaveBeenCalledTimes(1);
    expect(routerMock.replace).toHaveBeenCalledTimes(1);
    expect(routerMock.replace).toHaveBeenCalledWith(PREF1_ROUTE);
    expect(requestPushPermission).toHaveBeenCalledTimes(0);
  });

  it('W3 루틴이 영원히 끝나지 않아도(OS 창 앞에서 망설임) pref1 로의 replace 는 1회 불린다(R2 — 기다리지 않는다)', async () => {
    // 준비 — 끝나지 않는 루틴. reject 는 주지 않는다(루틴은 reject 하지 않는 것이 계약).
    mockPrompt.mockImplementation(() => new Promise(() => {}));
    render(<PushPage />);

    fireEvent.press(screen.getByTestId('onboarding-push-allow'));
    // 마이크로태스크를 흘린다 — 기다리는 구현이라면 여기서도 replace 에 못 닿는다.
    await act(async () => {});

    expect(mockPrompt).toHaveBeenCalledTimes(1);
    expect(routerMock.replace).toHaveBeenCalledTimes(1);
    expect(routerMock.replace).toHaveBeenCalledWith(PREF1_ROUTE);
  });
});

describe('🔴 TRIP-1108 AC-4 · 나중에 하기 → 묻지 않고 취향 1/2', () => {
  it('W4 "나중에 하기"를 누르면 루틴·요청 0회, pref1 로 replace 1회', () => {
    render(<PushPage />);

    fireEvent.press(screen.getByTestId('onboarding-push-later'));

    expect(mockPrompt).toHaveBeenCalledTimes(0);
    expect(requestPushPermission).toHaveBeenCalledTimes(0);
    expect(routerMock.replace).toHaveBeenCalledTimes(1);
    expect(routerMock.replace).toHaveBeenCalledWith(PREF1_ROUTE);
  });
});

describe('🔴 TRIP-1108 AC-5 · 연타는 1회로', () => {
  // 시계를 멈춘다 — 두 누름 사이가 400ms 창 안이라는 것을 실시간에 맡기지 않는다.
  let clock: jest.SpyInstance;
  beforeEach(() => {
    clock = jest.spyOn(Date, 'now').mockReturnValue(FROZEN_NOW);
  });
  afterEach(() => clock.mockRestore());

  it('W5 "계속"을 빠르게 두 번 눌러도 루틴 1회 · replace 1회', () => {
    render(<PushPage />);

    fireEvent.press(screen.getByTestId('onboarding-push-allow'));
    fireEvent.press(screen.getByTestId('onboarding-push-allow'));

    expect(mockPrompt).toHaveBeenCalledTimes(1);
    expect(routerMock.replace).toHaveBeenCalledTimes(1);
  });

  it('W6 "나중에 하기"를 빠르게 두 번 눌러도 replace 1회(R6)', () => {
    render(<PushPage />);

    fireEvent.press(screen.getByTestId('onboarding-push-later'));
    fireEvent.press(screen.getByTestId('onboarding-push-later'));

    expect(routerMock.replace).toHaveBeenCalledTimes(1);
    expect(mockPrompt).toHaveBeenCalledTimes(0);
  });
});
