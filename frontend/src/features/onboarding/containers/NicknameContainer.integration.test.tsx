import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

import { server } from '@/mocks/server';
import {
  resetOnboardingScenario,
  setOnboardingScenario,
} from '@/test-support/onboardingScenarios';
import { NicknameContainer } from './NicknameContainer';

/**
 * AC B1 · B2 · B5 · B7 · B8 · B9 — 닉네임 설정 배선 통합테스트.
 *
 * 무엇을 보장하나: (1) 진입하자마자 서버가 준 **중복 없는 후보**가 기본값으로 채워지고,
 * (2) 한 글자도 고치지 않아도 통과하며, (3) 저장은 `PATCH → complete` **순서**로만 일어나고,
 * (4) 저장이 실패하면 완료 처리를 **부르지 않는다**.
 *
 * 권한 경계: 중복·금칙어는 서버가 판정한다. 이 스위트는 그 판정을 MSW 시나리오로 주입할 뿐,
 * 클라이언트에 같은 규칙이 있는지는 검사하지 않는다(구조 가드는 onboardingStructure.test.ts).
 *
 * 3동작: 준비(시나리오 set + 렌더) → 실행(칩/다음 탭) → 단언(입력값 / 요청 순서 / 오류).
 */

jest.mock('@/shared/storage', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest
    .fn()
    .mockResolvedValue({ accessToken: 'tok', refreshToken: 'ref' }),
  hasStoredToken: jest.fn().mockResolvedValue(true),
}));

jest.mock('expo-router', () => {
  const replace = jest.fn();
  const push = jest.fn();
  return {
    __esModule: true,
    useRouter: () => ({ replace, push, back: jest.fn() }),
    router: { replace, push, back: jest.fn() },
  };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const routerMock = require('expo-router').router as {
  replace: jest.Mock;
  push: jest.Mock;
};

/**
 * handlers.ts 가 내려주는 후보 3개. **칩은 이 순서 그대로** 그려진다는 것이 계약이다
 * (프리필 = suggestions[0], 칩 i = suggestions[i]) — 인덱스가 흔들리면 원탭 적용이 엉뚱해진다.
 */
const SUGGESTIONS = ['여행자1234', '노을수집가', '골목탐험가'];

/** MSW 가 실제로 받은 요청을 순서대로 쌓는다 — B8 의 "순서" 단언에 쓴다. */
const requestLog: string[] = [];

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  server.events.on('request:start', ({ request }) => {
    requestLog.push(`${request.method} ${new URL(request.url).pathname}`);
  });
});

beforeEach(() => {
  setOnboardingScenario('onboarding-happy');
  requestLog.length = 0;
  routerMock.replace.mockClear();
  routerMock.push.mockClear();
});

afterEach(() => {
  server.resetHandlers();
  resetOnboardingScenario();
});

afterAll(() => {
  server.events.removeAllListeners();
  server.close();
});

/** 후보가 도착해 입력란이 채워질 때까지 기다린다. */
async function renderPrefilled() {
  render(<NicknameContainer />);
  await waitFor(() =>
    expect(screen.getByTestId('onboarding-nickname-input')).toHaveDisplayValue(
      SUGGESTIONS[0]
    )
  );
}

describe('NicknameContainer — 기본값 프리필 (AC B1 · BR-U0-16)', () => {
  it('진입하면 서버가 준 중복 없는 후보가 입력란에 기본값으로 채워진다', async () => {
    render(<NicknameContainer />);

    await waitFor(() =>
      expect(
        screen.getByTestId('onboarding-nickname-input')
      ).toHaveDisplayValue(SUGGESTIONS[0])
    );
    expect(requestLog).toContain('POST /api/v1/nickname/suggestions');
  });
});

describe('NicknameContainer — 수정 없이 통과 (AC B2 · B8)', () => {
  it('한 글자도 고치지 않고 다음을 누르면 그대로 저장되고 완료 처리까지 이어진다', async () => {
    await renderPrefilled();

    fireEvent.press(screen.getByTestId('onboarding-nickname-next'));

    await waitFor(() =>
      expect(requestLog).toContain('POST /api/v1/onboarding/complete')
    );

    const patchIndex = requestLog.indexOf('PATCH /api/v1/me/profile/nickname');
    const completeIndex = requestLog.indexOf(
      'POST /api/v1/onboarding/complete'
    );

    // 클라 형식 검증을 통과했더라도 서버 저장을 건너뛰면 안 된다(판정 정본은 서버).
    expect(patchIndex).toBeGreaterThanOrEqual(0);
    // D3 — 완료 처리는 닉네임 저장이 **성공한 뒤**에만 온다.
    expect(completeIndex).toBeGreaterThan(patchIndex);
  });

  it('완료되면 게이트("/")로 복귀해 부트스트랩이 다음 목적지를 재판정한다', async () => {
    await renderPrefilled();

    fireEvent.press(screen.getByTestId('onboarding-nickname-next'));

    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledWith('/'));
  });
});

describe('NicknameContainer — 서버 중복 판정과 원탭 적용 (AC B5 · B7)', () => {
  it('서버가 중복으로 응답하면 인라인 오류와 대체 후보 칩이 표시된다 (B5)', async () => {
    setOnboardingScenario('onboarding-nickname-taken');
    await renderPrefilled();

    fireEvent.press(screen.getByTestId('onboarding-nickname-next'));

    await waitFor(() =>
      expect(screen.getByTestId('onboarding-nickname-error')).toBeOnTheScreen()
    );
    expect(
      screen.getByTestId('onboarding-nickname-suggest-1')
    ).toBeOnTheScreen();
    // 저장에 실패했으므로 완료 처리로 넘어가면 안 된다.
    expect(requestLog).not.toContain('POST /api/v1/onboarding/complete');
  });

  it('후보 칩을 탭하면 그 값이 즉시 입력란에 반영되고 오류가 해제된다 (B7)', async () => {
    setOnboardingScenario('onboarding-nickname-taken');
    await renderPrefilled();

    fireEvent.press(screen.getByTestId('onboarding-nickname-next'));
    await waitFor(() =>
      expect(screen.getByTestId('onboarding-nickname-error')).toBeOnTheScreen()
    );

    fireEvent.press(screen.getByTestId('onboarding-nickname-suggest-1'));

    // 원탭 적용 — 다시 입력할 필요 없이 값이 바뀐다.
    await waitFor(() =>
      expect(
        screen.getByTestId('onboarding-nickname-input')
      ).toHaveDisplayValue(SUGGESTIONS[1])
    );
    expect(screen.queryByTestId('onboarding-nickname-error')).toBeNull();
  });
});

describe('NicknameContainer — 금칙어 판정 표시 (AC B6 · BR-U0-17)', () => {
  it('서버가 금칙어로 응답하면 인라인 오류와 대체 후보 칩이 표시된다', async () => {
    setOnboardingScenario('onboarding-nickname-banned');
    await renderPrefilled();

    fireEvent.press(screen.getByTestId('onboarding-nickname-next'));

    await waitFor(() =>
      expect(screen.getByTestId('onboarding-nickname-error')).toBeOnTheScreen()
    );
    expect(
      screen.getByTestId('onboarding-nickname-suggest-0')
    ).toBeOnTheScreen();
  });
});

describe('NicknameContainer — 저장 실패 (AC B9 · INV-4)', () => {
  it('닉네임 저장이 실패하면 완료 처리를 호출하지 않고 오류를 표시한다', async () => {
    setOnboardingScenario('onboarding-nickname-save-failed');
    await renderPrefilled();

    fireEvent.press(screen.getByTestId('onboarding-nickname-next'));

    await waitFor(() =>
      expect(screen.getByTestId('onboarding-nickname-error')).toBeOnTheScreen()
    );
    // 저장이 안 됐는데 온보딩을 완료로 찍으면 닉네임 없는 계정이 홈으로 나간다.
    expect(requestLog).not.toContain('POST /api/v1/onboarding/complete');
    expect(routerMock.replace).not.toHaveBeenCalledWith('/');
  });
});
