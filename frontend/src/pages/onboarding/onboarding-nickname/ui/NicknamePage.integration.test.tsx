import {
  act,
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
import { NicknamePage } from './NicknamePage';

/**
 * AC B1 · B2 · B5 · B7 · B8 · B9 — 닉네임 설정 배선 통합테스트.
 *
 * 무엇을 보장하나: (1) 진입하자마자 서버가 준 **중복 없는 후보**가 기본값으로 채워지고,
 * (2) 한 글자도 고치지 않아도 통과하며, (3) 저장(PATCH)만 하고 온보딩 완료는 **부르지 않는다**
 * — 완료는 취향 단계의 출구로 옮겨졌다(TRIP-1421 AC1), (4) 저장이 실패하면 다음 화면으로 가지 않는다.
 *
 * 권한 경계: 중복·금칙어는 서버가 판정한다. 이 스위트는 그 판정을 MSW 시나리오로 주입할 뿐,
 * 클라이언트에 같은 규칙이 있는지는 검사하지 않는다(그 구조 가드 onboardingStructure 는 TRIP-1145 로 지웠다).
 *
 * 3동작: 준비(시나리오 set + 렌더) → 실행(칩/다음 탭) → 단언(입력값 / 요청 순서 / 오류).
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/shared/storage', () => require('@/test-support/storageMock'));

jest.mock('expo-router', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@/test-support/expoRouterMock').createExpoRouterMock({
    useRouter: ['push', 'replace', 'back'],
    router: ['push', 'replace', 'back'],
  })
);

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
  render(<NicknamePage />);
  await waitFor(() =>
    expect(screen.getByTestId('onboarding-nickname-input')).toHaveDisplayValue(
      SUGGESTIONS[0]
    )
  );
}

describe('NicknamePage — 기본값 프리필 (AC B1 · BR-U0-16)', () => {
  it('진입하면 서버가 준 중복 없는 후보가 입력란에 기본값으로 채워진다', async () => {
    render(<NicknamePage />);

    await waitFor(() =>
      expect(
        screen.getByTestId('onboarding-nickname-input')
      ).toHaveDisplayValue(SUGGESTIONS[0])
    );
    expect(requestLog).toContain('POST /api/v1/nickname/suggestions');
  });
});

describe('NicknamePage — 수정 없이 통과 (AC B2 · B8 · TRIP-1421 AC1)', () => {
  it('한 글자도 고치지 않고 다음을 누르면 그대로 저장되고, 온보딩 완료는 부르지 않는다', async () => {
    // 준비 — 후보가 프리필된 화면.
    await renderPrefilled();

    // 실행 — 다음 탭.
    fireEvent.press(screen.getByTestId('onboarding-nickname-next'));

    // 앵커 — 저장 흐름이 끝까지 돌아 c08 로 넘어갔다(아래 "0회"가 공허하지 않게).
    await waitFor(() =>
      expect(routerMock.replace).toHaveBeenCalledWith('/(onboarding)/location')
    );
    // 단언 — 클라 형식 검증을 통과했더라도 서버 저장은 한다(판정 정본은 서버).
    expect(requestLog).toContain('PATCH /api/v1/me/profile/nickname');
    // 단언 — 완료는 취향 단계 몫이다(TRIP-1421 결정 ①). 여기서 부르면 취향 전에 끝난 계정이 된다.
    expect(requestLog).not.toContain('POST /api/v1/onboarding/complete');
  });

  it('저장되면 위치 프리프롬프트(c08)로 한 번만 이동한다(TRIP-459 — 체인에 c08 삽입)', async () => {
    await renderPrefilled();

    fireEvent.press(screen.getByTestId('onboarding-nickname-next'));

    // AC-1 — nickname 저장 성공 시 목적지는 c08(위치). c08 이 pref1 앞에 끼어든다.
    await waitFor(() =>
      expect(routerMock.replace).toHaveBeenCalledWith('/(onboarding)/location')
    );
    expect(routerMock.replace.mock.calls).toEqual([['/(onboarding)/location']]);
  });
});

describe('NicknamePage — 서버 중복 판정과 원탭 적용 (AC B5 · B7)', () => {
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

describe('NicknamePage — 금칙어 판정 표시 (AC B6 · BR-U0-17)', () => {
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

/**
 * TRIP-1427 (Q-013) — return 키가 [다음]과 같은 저장 체인의 두 번째 입구가 된다. 입구가 둘이면 겹쳐 누를 수 있으므로
 * 진행 중 잠금을 건다(TRIP-1305 선례). 잠금은 같은 틱에 읽혀야 한다 — 아래 "같은 틱"은 `act` 하나 안에서 부른
 * `fireEvent` 두 번이다. `fireEvent` 는 저마다 `act` 로 감싸 끝날 때 다시 그리므로, 바깥 `act` 로 묶어야 두 번째 누름이
 * 아직 다시 그려지기 전의 같은 화면을 누른다(SettingsPage.hookMock 선례). 실패하면 풀리고(UX-03 재시도), 성공하면 화면을 떠날 때까지 유지한다(Q5).
 */
describe('NicknamePage — return 제출·제출 잠금 (AC-N1 · AC-N2 · AC-N3 · AC-N3b)', () => {
  const CHECK = 'POST /api/v1/nickname/check';
  const PATCH = 'PATCH /api/v1/me/profile/nickname';
  const LOCATION_ROUTE = '/(onboarding)/location';
  /** 기다리던 일이 끝내 안 오면 테스트 상한(5초)보다 먼저 단언 메시지로 실패하게 한다. */
  const RED_WAIT = 3000;

  function countOf(entry: string): number {
    return requestLog.filter((line) => line === entry).length;
  }

  /** 늦게 오는 두 번째 체인까지 도착하도록 실제 시간을 조금 흘린다 — "1회" 단언 전에 반드시 부른다. */
  async function settleNetwork() {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
    });
  }

  it('I1 형식이 맞는 값에서 return 키를 누르면 [다음]과 같은 저장이 1회 돌고 위치 안내로 넘어간다', async () => {
    // 준비
    await renderPrefilled();
    expect(routerMock.replace).toHaveBeenCalledTimes(0);

    // 실행
    fireEvent(screen.getByTestId('onboarding-nickname-input'), 'submitEditing');

    // 단언
    await waitFor(
      () => expect(routerMock.replace).toHaveBeenCalledWith(LOCATION_ROUTE),
      { timeout: RED_WAIT }
    );
    await settleNetwork();
    expect(routerMock.replace.mock.calls).toEqual([[LOCATION_ROUTE]]);
    expect(countOf(CHECK)).toBe(1);
    expect(countOf(PATCH)).toBe(1);
    expect(requestLog).not.toContain('POST /api/v1/onboarding/complete');
  });

  it('I2 1자(형식 미달)에서 return 키를 누르면 저장 요청이 0회이고 화면에 머문다', async () => {
    // 준비
    await renderPrefilled();
    fireEvent.changeText(screen.getByTestId('onboarding-nickname-input'), '가');
    // 앵커 — 형식 오류가 떠 있다(1자가 실제로 들어갔다).
    expect(screen.getByTestId('onboarding-nickname-error')).toBeOnTheScreen();

    // 실행
    fireEvent(screen.getByTestId('onboarding-nickname-input'), 'submitEditing');

    // 단언
    await settleNetwork();
    expect(countOf(CHECK)).toBe(0);
    expect(countOf(PATCH)).toBe(0);
    expect(routerMock.replace).toHaveBeenCalledTimes(0);
    expect(screen.getByTestId('onboarding-nickname-root')).toBeOnTheScreen();
  });

  it('I3 return 과 [다음]을 같은 틱에 눌러도 check·PATCH·replace 는 각 1회다', async () => {
    // 준비
    await renderPrefilled();
    expect(countOf(CHECK)).toBe(0);

    // 실행 — 같은 틱(act 하나 안 — 사이에 다시 그리기가 없다)
    act(() => {
      fireEvent(
        screen.getByTestId('onboarding-nickname-input'),
        'submitEditing'
      );
      fireEvent.press(screen.getByTestId('onboarding-nickname-next'));
    });

    // 단언
    await waitFor(
      () => expect(routerMock.replace).toHaveBeenCalledWith(LOCATION_ROUTE),
      { timeout: RED_WAIT }
    );
    await settleNetwork();
    expect(countOf(CHECK)).toBe(1);
    expect(countOf(PATCH)).toBe(1);
    expect(routerMock.replace).toHaveBeenCalledTimes(1);
  });

  it('I4 [다음]을 같은 틱에 두 번 눌러도 check·PATCH·replace 는 각 1회다', async () => {
    // 준비
    await renderPrefilled();
    expect(countOf(CHECK)).toBe(0);

    // 실행 — 같은 틱 연타(act 하나 안)
    act(() => {
      fireEvent.press(screen.getByTestId('onboarding-nickname-next'));
      fireEvent.press(screen.getByTestId('onboarding-nickname-next'));
    });

    // 단언
    await waitFor(
      () => expect(routerMock.replace).toHaveBeenCalledWith(LOCATION_ROUTE),
      { timeout: RED_WAIT }
    );
    await settleNetwork();
    expect(countOf(CHECK)).toBe(1);
    expect(countOf(PATCH)).toBe(1);
    expect(routerMock.replace).toHaveBeenCalledTimes(1);
  });

  it('I5 저장에 성공한 뒤(화면 전환 중) [다음]을 다시 눌러도 다시 저장하지 않는다', async () => {
    // 준비 — 한 번 저장 성공
    await renderPrefilled();
    fireEvent.press(screen.getByTestId('onboarding-nickname-next'));
    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledTimes(1));
    await settleNetwork();
    expect(countOf(CHECK)).toBe(1);

    // 실행 — 아직 화면이 남아 있는 동안 한 번 더
    fireEvent.press(screen.getByTestId('onboarding-nickname-next'));

    // 단언
    await settleNetwork();
    expect(countOf(CHECK)).toBe(1);
    expect(countOf(PATCH)).toBe(1);
    expect(routerMock.replace).toHaveBeenCalledTimes(1);
  });

  it('I6 저장(PATCH)이 실패한 뒤에는 잠금이 풀려 다시 누르면 다시 저장된다', async () => {
    // 준비 — 첫 저장 실패
    setOnboardingScenario('onboarding-nickname-save-failed');
    await renderPrefilled();
    fireEvent.press(screen.getByTestId('onboarding-nickname-next'));
    await waitFor(() =>
      expect(screen.getByTestId('onboarding-nickname-error')).toBeOnTheScreen()
    );
    expect(countOf(PATCH)).toBe(1);
    expect(routerMock.replace).toHaveBeenCalledTimes(0);

    // 실행 — 서버가 회복된 뒤 다시 누른다
    setOnboardingScenario('onboarding-happy');
    fireEvent.press(screen.getByTestId('onboarding-nickname-next'));

    // 단언
    await waitFor(
      () => expect(routerMock.replace).toHaveBeenCalledWith(LOCATION_ROUTE),
      { timeout: RED_WAIT }
    );
    await settleNetwork();
    expect(countOf(CHECK)).toBe(2);
    expect(countOf(PATCH)).toBe(2);
    expect(routerMock.replace).toHaveBeenCalledTimes(1);
  });

  it('I7 중복으로 거절된 뒤 후보 칩을 고르고 return 키를 누르면 다시 저장되어 넘어간다', async () => {
    // 준비 — 첫 확인에서 중복 거절 → 칩으로 다른 후보 적용
    setOnboardingScenario('onboarding-nickname-taken');
    await renderPrefilled();
    fireEvent.press(screen.getByTestId('onboarding-nickname-next'));
    await waitFor(() =>
      expect(screen.getByTestId('onboarding-nickname-error')).toBeOnTheScreen()
    );
    fireEvent.press(screen.getByTestId('onboarding-nickname-suggest-1'));
    await waitFor(() =>
      expect(
        screen.getByTestId('onboarding-nickname-input')
      ).toHaveDisplayValue(SUGGESTIONS[1])
    );
    expect(countOf(CHECK)).toBe(1);

    // 실행 — return 키로 재시도
    setOnboardingScenario('onboarding-happy');
    fireEvent(screen.getByTestId('onboarding-nickname-input'), 'submitEditing');

    // 단언
    await waitFor(
      () => expect(routerMock.replace).toHaveBeenCalledWith(LOCATION_ROUTE),
      { timeout: RED_WAIT }
    );
    await settleNetwork();
    expect(countOf(CHECK)).toBe(2);
    expect(countOf(PATCH)).toBe(1);
    expect(routerMock.replace).toHaveBeenCalledTimes(1);
  });
});

describe('NicknamePage — 저장 실패 (AC B9 · INV-4)', () => {
  it('닉네임 저장이 실패하면 완료 처리를 호출하지 않고 오류를 표시한다', async () => {
    setOnboardingScenario('onboarding-nickname-save-failed');
    await renderPrefilled();

    fireEvent.press(screen.getByTestId('onboarding-nickname-next'));

    await waitFor(() =>
      expect(screen.getByTestId('onboarding-nickname-error')).toBeOnTheScreen()
    );
    // 저장이 안 됐는데 온보딩을 완료로 찍으면 닉네임 없는 계정이 홈으로 나간다.
    expect(requestLog).not.toContain('POST /api/v1/onboarding/complete');
    expect(routerMock.replace).not.toHaveBeenCalled();
  });
});
