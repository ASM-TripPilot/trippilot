import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { AppState } from 'react-native';

import { server } from '@/mocks/server';
import { guardPress, resetPressGuard } from '@/shared/lib/pressGuard';
import { LocationPage } from './LocationPage';

/**
 * AC-3 · 4 · 5 · 6 · 7 · 8 — c08 위치 프리프롬프트 **배선** 통합테스트 (TRIP-459).
 *
 * 무엇을 보장하나: 화면(LocationPreprompt, 동결)을 재사용해
 *  (1) default 로 렌더하고 Figma 온보딩 목적 문구를 주입한다(AC-3),
 *  (2) "허용" 을 누르면 OS 권한 요청이 **딱 1회** 발화되고 granted 면 다음 단계로 넘어간다(AC-4),
 *  (3) OS 가 denied 로 답하면 denied 프레임으로 **전환**하되 "계속" 으로 다음 단계에 도달한다(AC-5),
 *  (4) "나중에 하기" 출구가 없다 — 안내 뒤엔 항상 OS 창이다(AC-6 · 5.1.1(iv)),
 *  (5) denied 에서 "위치 설정 열기" 는 앱 설정을 연다(AC-7),
 *  (6) c08 은 서버 진행 플래그를 **만들지 않는다** — 전 플로우에 서버 호출 0(AC-8).
 *  다음 단계는 TRIP-1108 부터 취향 1/2(pref1)가 아니라 **푸시 알림 안내 카드(push)** 다
 *  (온보딩 location → push → pref1). 즉시 넘어가는 버튼(거부 프레임 계속)은 연타해도 1회다(R6).
 *
 * ⚠️ 방향 주의: 동결 LocationPreprompt.test.tsx 는 컴포넌트가 OS 를 **안 부르는** 것을 잰다.
 *    여기(배선 층)는 정반대 — 페이지가 OS 를 **부르는** 것을 관찰한다. 같은 expo-location 목,
 *    반대 기대다.
 *
 * 3동작 뼈대: 준비(권한 목 분기 + render) → 실행(버튼 press) → 단언(요청 횟수 / 라우팅 / 전환).
 */

// OS 권한 seam — expo-location 을 통째로 가짜로 바꿔 "페이지가 이걸 부르는가/몇 번" 을 관찰한다.
// jest 는 팩토리 밖 변수를 `mock*` 이름일 때만 허용하므로 지연 래퍼로 참조한다(동결 테스트와 동형).
const mockRequestForeground = jest.fn();
const mockGetForeground = jest.fn();
jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: (...args: unknown[]) =>
    mockRequestForeground(...args),
  getForegroundPermissionsAsync: (...args: unknown[]) =>
    mockGetForeground(...args),
}));

// 앱 설정 열기 seam — 리포 관례상 expo-linking(RN Linking 아님, nextNav·stayOutbound 선례).
const mockOpenSettings = jest.fn();
jest.mock('expo-linking', () => ({
  openSettings: (...args: unknown[]) => mockOpenSettings(...args),
}));

// 라우터 — replace/push/back 을 팩토리 클로저에 두고 router 로 함께 내보내 참조를 고정한다
// (NicknamePage.integration.test.tsx 선례). useRouter() 는 매번 같은 replace 를 돌려준다.
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

/** c08 이 주입해야 하는 Figma 온보딩 목적 문구(브리프 §화면·IO · 4975:3306). 프리뷰의
 * placeholder "내 주변 숙소 탐색" 이 아니라 **화면 정본 문구**여야 한다. toHaveTextContent 는
 * 문자열이면 완전 일치이므로(RNTL matches exact:true 기본), 이 상수 전체가 곧 계약이다. */
// TRIP-717: Figma 4975:3306 2줄 고정 개행 반영(같은 어구, 중간에 \n). toHaveTextContent 는
// 공백을 정규화하므로 \n 유무와 무관하게 매치하지만, 앱 문자열과 자구를 일치시켜 계약을 명시한다.
const ONBOARDING_PURPOSE =
  '내 주변을 알면 더 잘 맞는 곳을 추천하고\n길 안내도 막힘없이 이어져요';
const PREF1_ROUTE = '/(onboarding)/pref1';
/** TRIP-1108 — 위치 카드 다음 단계. 모든 출구(granted·나중에·거부 계속)가 여기로 간다. */
const PUSH_ROUTE = '/(onboarding)/push';
/** 연타 판정용으로 멈춰 둘 시각(값은 의미 없다 — 흐르지 않는 것이 요점). */
const FROZEN_NOW = 1_790_000_000_000;

/** requestForegroundPermissionsAsync 응답(LocationPermissionResponse 부분집합). status·granted 를
 * 일관되게 채워 구현이 어느 필드를 읽어도 통과하게 한다. */
const GRANTED = {
  status: 'granted',
  granted: true,
  canAskAgain: true,
} as const;
const DENIED = {
  status: 'denied',
  granted: false,
  canAskAgain: false,
} as const;

/** c08 이 서버로 무엇이든 보내면 여기 쌓인다 — AC-8("진행 플래그 미생성") 트립와이어. */
const requestLog: string[] = [];

/**
 * TRIP-1427 — 앱 활성화(AppState) 구독을 붙잡는 장치. RN jest 목의 `addEventListener` 는 구독 객체만 돌려주고
 * 핸들러를 절대 부르지 않는다 — 그래서 스파이로 핸들러를 모아 두고 테스트가 직접 상태를 보낸다(useSeoulToday.test 선례).
 * `remove()` 된 구독에는 보내지 않는다(진짜 RN 과 같다).
 */
type AppStateSub = { handler: (next: string) => void; removed: boolean };
let appStateSubs: AppStateSub[] = [];
let appStateSpy: jest.SpyInstance | undefined;

/** 살아 있는 'change' 구독에 상태를 차례로 보낸다. 목의 currentState 는 문자열이 아니라
 * 'active' 하나만 보내면 "직전 상태" 를 보는 구현이 못 알아챈다 — 실제 흐름(나감 → 돌아옴)대로 보낸다. */
function emitAppState(...states: string[]) {
  act(() => {
    for (const next of states) {
      appStateSubs
        .filter((sub) => !sub.removed)
        .forEach((sub) => sub.handler(next));
    }
  });
}

/** 목 Promise 의 후속 처리(조회 결과 → 상태·이동)를 흘린다. 멈춘 시계 아래에서도 쓸 수 있다(waitFor 와 달리 타이머 불필요). */
async function flushAsync() {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {});
  }
}

/** 기다리던 일이 끝내 안 오면 테스트 상한(5초)보다 먼저 단언 메시지로 실패하게 한다. */
const RED_WAIT = 3000;

/** 밖에서 끝낼 수 있는 Promise — "조회가 아직 진행 중"인 순간을 테스트가 붙잡는다. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  server.events.on('request:start', ({ request }) => {
    requestLog.push(`${request.method} ${new URL(request.url).pathname}`);
  });
});

beforeEach(() => {
  // 연타 가드 창(400ms)은 모듈 싱글턴 — 앞 케이스의 누름이 다음 케이스의 첫 누름을 먹지 않게 닫는다.
  resetPressGuard();
  mockRequestForeground.mockReset();
  mockGetForeground.mockReset();
  // 마운트 denied 감지(Q2-②)를 구현이 하든 말든 무해하도록 기본은 미결정 상태로 답한다.
  mockGetForeground.mockResolvedValue({
    status: 'undetermined',
    granted: false,
    canAskAgain: true,
  });
  mockOpenSettings.mockReset();
  mockOpenSettings.mockResolvedValue(undefined);
  routerMock.replace.mockClear();
  routerMock.push.mockClear();
  requestLog.length = 0;
  appStateSubs = [];
  appStateSpy = jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((type, handler) => {
      const sub: AppStateSub = {
        handler: handler as (next: string) => void,
        removed: type !== 'change',
      };
      appStateSubs.push(sub);
      return {
        remove: () => {
          sub.removed = true;
        },
      };
    });
});

afterEach(() => {
  server.resetHandlers();
  resetPressGuard();
  appStateSpy?.mockRestore();
});

afterAll(() => {
  server.events.removeAllListeners();
  server.close();
});

/** 허용 → OS 가 denied 응답 → denied 프레임 전환까지 몰아간다(Q2-i 경로). */
async function reachDenied() {
  mockRequestForeground.mockResolvedValue(DENIED);
  render(<LocationPage />);
  fireEvent.press(screen.getByTestId('onboarding-location-allow'));
  await waitFor(() =>
    expect(screen.getByTestId('onboarding-location-continue')).toBeOnTheScreen()
  );
  // 사람은 OS 창에 답하느라 400ms 이상 쓴다 — 주 버튼을 가드로 감쌌든 아니든 이후 누름은 창 밖이다.
  resetPressGuard();
}

describe('LocationPage — default 렌더 + 목적 주입 (AC-3)', () => {
  it('default 상태로 c08 을 렌더하고 Figma 온보딩 목적 문구를 주입한다', () => {
    render(<LocationPage />);

    expect(screen.getByTestId('onboarding-location-root')).toBeOnTheScreen();
    // 완전 일치 — placeholder "내 주변 숙소 탐색" 이 아니라 화면 정본 문구여야 한다.
    expect(screen.getByTestId('onboarding-location-purpose')).toHaveTextContent(
      ONBOARDING_PURPOSE
    );
    expect(screen.getByTestId('onboarding-location-allow')).toBeOnTheScreen();
    expect(screen.queryByTestId('onboarding-location-later')).toBeNull();
  });
});

describe('LocationPage — 허용 → OS 권한 요청 (AC-4)', () => {
  it('주 버튼 "계속" 을 누르면 OS 권한 요청이 1회 발화되고 granted 면 푸시 카드로 replace 한다', async () => {
    mockRequestForeground.mockResolvedValue(GRANTED);
    render(<LocationPage />);

    fireEvent.press(screen.getByTestId('onboarding-location-allow'));

    await waitFor(() => expect(mockRequestForeground).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(routerMock.replace).toHaveBeenCalledWith(PUSH_ROUTE)
    );
  });
});

describe('LocationPage — 건너뛰기 없음 (AC-6 · 5.1.1(iv))', () => {
  it('"나중에 하기" 가 없고, 마운트만으로는 OS 권한 요청이 나가지 않는다(누른 뒤에만)', () => {
    render(<LocationPage />);

    expect(screen.queryByTestId('onboarding-location-later')).toBeNull();
    expect(screen.getByTestId('onboarding-location-allow')).toBeOnTheScreen();
    expect(mockRequestForeground).not.toHaveBeenCalled();
    expect(routerMock.replace).not.toHaveBeenCalled();
  });
});

describe('LocationPage — 거부해도 온보딩 무중단 (AC-5 · BR-U0-30)', () => {
  it('허용 후 OS 가 denied 로 응답하면 denied 프레임으로 전환한다', async () => {
    await reachDenied();

    // 진짜 전환 — denied 전용 수단이 뜨고 default 의 허용 버튼은 사라진다.
    expect(
      screen.getByTestId('onboarding-location-settings')
    ).toBeOnTheScreen();
    expect(screen.queryByTestId('onboarding-location-allow')).toBeNull();
  });

  it('denied 프레임에서 "계속" 을 누르면 푸시 카드로 도달한다(거부가 온보딩을 막지 않는다)', async () => {
    await reachDenied();

    fireEvent.press(screen.getByTestId('onboarding-location-continue'));

    await waitFor(() =>
      expect(routerMock.replace).toHaveBeenCalledWith(PUSH_ROUTE)
    );
  });
});

describe('LocationPage — 설정 열기 (AC-7)', () => {
  it('denied 프레임에서 "위치 설정 열기" 를 누르면 앱 설정을 연다', async () => {
    await reachDenied();

    fireEvent.press(screen.getByTestId('onboarding-location-settings'));

    expect(mockOpenSettings).toHaveBeenCalledTimes(1);
  });
});

// TRIP-717: 안내 줄 닫기(×)·1회성 숨김(onDismissNotice/noticeDismissed)은 Figma 정본에 없어
// 폐기했다 — denied 안내는 카드로 항상 떠 있다(닫기 없음). 관련 dismiss 테스트는 삭제한다.

describe('LocationPage — 서버 진행 플래그 미생성 (AC-8)', () => {
  it('허용→granted→푸시 카드 전 플로우 동안 서버로 아무 요청도 보내지 않는다', async () => {
    mockRequestForeground.mockResolvedValue(GRANTED);
    render(<LocationPage />);

    fireEvent.press(screen.getByTestId('onboarding-location-allow'));
    await waitFor(() =>
      expect(routerMock.replace).toHaveBeenCalledWith(PUSH_ROUTE)
    );

    // c08 은 전이 화면이라 진행 플래그를 만들지 않는다(resolveOnboardingStep 은 terms/nickname/done
    // 만 판정). 여기에 onboarding/complete 류가 새로 생기면 requestLog 가 잡는다.
    expect(requestLog).toEqual([]);
  });
});

describe('🔴 TRIP-1108 R6 · 즉시 넘어가는 버튼은 연타해도 1회', () => {
  // 시계를 멈춘다 — 두 누름 사이가 400ms 창 안이라는 것을 실시간에 맡기지 않는다.
  // (reachDenied 의 waitFor 가 끝난 뒤에 멈춘다 — waitFor 앞에서 멈추면 실패 시 무한 대기.)
  function freezeClock(): jest.SpyInstance {
    return jest.spyOn(Date, 'now').mockReturnValue(FROZEN_NOW);
  }

  it('denied 프레임 "계속"을 빠르게 두 번 눌러도 푸시 카드로의 replace 는 1회', async () => {
    await reachDenied();
    const clock = freezeClock();
    try {
      fireEvent.press(screen.getByTestId('onboarding-location-continue'));
      fireEvent.press(screen.getByTestId('onboarding-location-continue'));

      expect(routerMock.replace).toHaveBeenCalledTimes(1);
      expect(routerMock.replace).toHaveBeenCalledWith(PUSH_ROUTE);
    } finally {
      clock.mockRestore();
    }
  });
});

// TRIP-1427 — 마운트 조회(재진입 시 "다시 물을 수 없게" 거부된 상태 감지)는 지금까지 무심판이었다(traps-onboarding-auth).
// 재조회를 더하면서 같은 조회 조건을 건드리므로 두 갈래 심판을 함께 세운다(AC-R2).
describe('LocationPage — 마운트 권한 감지 (AC-R2)', () => {
  it('M1 이미 "다시 묻지 않음"으로 거부돼 있으면 누르지 않아도 곧장 거부 프레임이다', async () => {
    // 준비
    mockGetForeground.mockResolvedValue(DENIED);

    // 실행
    render(<LocationPage />);

    // 단언
    expect(
      await screen.findByTestId('onboarding-location-continue')
    ).toBeOnTheScreen();
    expect(screen.queryByTestId('onboarding-location-allow')).toBeNull();
    expect(mockRequestForeground).toHaveBeenCalledTimes(0);
    expect(routerMock.replace).toHaveBeenCalledTimes(0);
  });

  it.each([
    [
      '거부됐지만 다시 물을 수 있음(안드로이드)',
      { status: 'denied', granted: false, canAskAgain: true },
    ],
    ['이미 허용됨', GRANTED],
  ])(
    'M2 마운트 조회가 "%s"이면 default 를 유지한다',
    async (_label, answer) => {
      // 준비
      mockGetForeground.mockResolvedValue(answer);

      // 실행 — 조회가 끝날 때까지 흘린다(결과가 오기 전에 단언하면 아무 구현이나 통과한다)
      render(<LocationPage />);
      await waitFor(() => expect(mockGetForeground).toHaveBeenCalledTimes(1));
      await flushAsync();

      // 단언
      expect(screen.getByTestId('onboarding-location-allow')).toBeOnTheScreen();
      expect(screen.queryByTestId('onboarding-location-continue')).toBeNull();
      expect(mockRequestForeground).toHaveBeenCalledTimes(0);
      expect(routerMock.replace).toHaveBeenCalledTimes(0);
    }
  );
});

/**
 * TRIP-1427 (Q-018 · 결정 1=A) — 거부 프레임에서 설정 앱으로 나가 위치를 켜고 돌아오면(AppState active) 권한을 **조회만**
 * 다시 하고, 허용됐으면 곧장 푸시 안내로 넘어간다. 여전히 거부면 그대로 둔다(request 0 — BR-U0-30 개정).
 * 재조회는 거부 프레임에서만 한다(Q1) — default 에선 OS 창이 닫히며 생기는 active 가 허용 이동과 겹친다.
 */
describe('LocationPage — 설정에서 돌아오면 다시 조회 (AC-L1 · AC-L1b · AC-L2 · AC-L2b)', () => {
  /** 마운트 감지로 거부 프레임에 들어간다(재진입 사용자 경로). */
  async function reachDeniedOnMount() {
    mockGetForeground.mockResolvedValue(DENIED);
    render(<LocationPage />);
    await screen.findByTestId('onboarding-location-continue');
  }

  it.each([
    ['OS 창에서 거부한 직후', reachDenied, 1],
    ['재진입 시 마운트 감지', reachDeniedOnMount, 0],
  ])(
    'R1 [%s] 설정에서 허용하고 돌아오면 다시 조회해 푸시 안내로 1회 넘어가고, 권한 요청은 더 하지 않는다',
    async (_label, enterDenied, requestsOnEntry) => {
      // 준비 — 거부 프레임, 그 사이 설정 앱에서 허용됨
      await enterDenied();
      mockGetForeground.mockResolvedValue(GRANTED);
      const getCalls = mockGetForeground.mock.calls.length;
      expect(routerMock.replace).toHaveBeenCalledTimes(0);

      // 실행 — 설정 앱으로 나갔다가 돌아온다
      emitAppState('background', 'active');

      // 단언
      await waitFor(
        () => expect(routerMock.replace).toHaveBeenCalledWith(PUSH_ROUTE),
        { timeout: RED_WAIT }
      );
      await flushAsync();
      expect(routerMock.replace.mock.calls).toEqual([[PUSH_ROUTE]]);
      expect(mockGetForeground.mock.calls.length).toBeGreaterThan(getCalls);
      expect(mockRequestForeground).toHaveBeenCalledTimes(requestsOnEntry);
    }
  );

  it.each([
    [
      '다시 물을 수 없는 거부',
      () => mockGetForeground.mockResolvedValue(DENIED),
    ],
    [
      '다시 물을 수 있는 거부',
      () =>
        mockGetForeground.mockResolvedValue({
          status: 'denied',
          granted: false,
          canAskAgain: true,
        }),
    ],
    [
      '미결정',
      () =>
        mockGetForeground.mockResolvedValue({
          status: 'undetermined',
          granted: false,
          canAskAgain: true,
        }),
    ],
    [
      '조회 실패(throw)',
      () => mockGetForeground.mockRejectedValue(new Error('permission api')),
    ],
  ])(
    'R2 돌아왔는데 [%s]이면 거부 프레임 그대로이고 권한 요청도 이동도 없다 — [계속]은 살아 있다',
    async (_label, answerAfterReturn) => {
      // 준비
      await reachDenied();
      answerAfterReturn();
      const getCalls = mockGetForeground.mock.calls.length;

      // 실행
      emitAppState('background', 'active');

      // 단언 — 다시 조회는 했다(아무것도 안 하는 구현이 통과하지 않게)
      await waitFor(
        () => expect(mockGetForeground).toHaveBeenCalledTimes(getCalls + 1),
        { timeout: RED_WAIT }
      );
      await flushAsync();
      // 단언 — 화면은 그대로, OS 창은 다시 띄우지 않는다
      expect(routerMock.replace).toHaveBeenCalledTimes(0);
      expect(mockRequestForeground).toHaveBeenCalledTimes(1);
      expect(
        screen.getByTestId('onboarding-location-continue')
      ).toBeOnTheScreen();
      expect(screen.queryByTestId('onboarding-location-allow')).toBeNull();

      // 무회귀 — 거부는 온보딩을 막지 않는다(INV-4): [계속]으로 넘어간다
      fireEvent.press(screen.getByTestId('onboarding-location-continue'));
      expect(routerMock.replace).toHaveBeenCalledTimes(1);
      expect(routerMock.replace).toHaveBeenCalledWith(PUSH_ROUTE);
    }
  );

  it('R3 활성화 신호가 연달아 두 번 와도 푸시 안내로는 1회만 넘어간다', async () => {
    // 준비
    await reachDenied();
    mockGetForeground.mockResolvedValue(GRANTED);

    // 실행 — iOS 는 active 가 겹쳐 올 수 있다
    emitAppState('background', 'active', 'active');

    // 단언
    await waitFor(
      () => expect(routerMock.replace).toHaveBeenCalledWith(PUSH_ROUTE),
      { timeout: RED_WAIT }
    );
    await flushAsync();
    expect(routerMock.replace).toHaveBeenCalledTimes(1);
  });

  it('R4 다시 조회하는 사이 [계속]을 누르고, 조회 결과(허용)가 뒤에 와도 푸시 안내로는 1회만 넘어간다', async () => {
    // 준비 — 조회를 진행 중으로 붙잡아 둔다
    await reachDenied();
    const query = deferred<typeof GRANTED>();
    mockGetForeground.mockReturnValue(query.promise);
    const getCalls = mockGetForeground.mock.calls.length;
    // 비동기 대기는 끝났다 — 연타 가드 창을 실시간에 맡기지 않도록 시계를 멈춘다
    const clock = jest.spyOn(Date, 'now').mockReturnValue(FROZEN_NOW);

    try {
      // 실행 ① — 돌아옴(조회 시작, 아직 결과 없음)
      emitAppState('background', 'active');
      expect(mockGetForeground).toHaveBeenCalledTimes(getCalls + 1);
      expect(routerMock.replace).toHaveBeenCalledTimes(0);

      // 실행 ② — 그 사이 [계속] 탭, 그 뒤 조회 결과 도착
      fireEvent.press(screen.getByTestId('onboarding-location-continue'));
      expect(routerMock.replace).toHaveBeenCalledTimes(1);
      query.resolve(GRANTED);
      await flushAsync();

      // 단언
      expect(routerMock.replace).toHaveBeenCalledTimes(1);
      expect(routerMock.replace).toHaveBeenLastCalledWith(PUSH_ROUTE);
    } finally {
      clock.mockRestore();
    }
  });

  it('R5 조회 결과가 화면을 떠난 뒤에 도착하면 이동하지 않는다', async () => {
    // 준비
    await reachDenied();
    const query = deferred<typeof GRANTED>();
    mockGetForeground.mockReturnValue(query.promise);
    const getCalls = mockGetForeground.mock.calls.length;
    emitAppState('background', 'active');
    expect(mockGetForeground).toHaveBeenCalledTimes(getCalls + 1);

    // 실행 — 화면이 사라진 뒤 결과가 온다
    screen.unmount();
    query.resolve(GRANTED);
    await flushAsync();

    // 단언
    expect(routerMock.replace).toHaveBeenCalledTimes(0);
  });

  it('R6 default 프레임에서는 활성화 신호가 와도 넘어가지 않고 권한도 묻지 않는다', async () => {
    // 준비 — default(미결정) 로 뜬 뒤 마운트 조회가 끝났다
    render(<LocationPage />);
    await waitFor(() => expect(mockGetForeground).toHaveBeenCalledTimes(1));
    await flushAsync();
    mockGetForeground.mockResolvedValue(GRANTED);

    // 실행
    emitAppState('background', 'active');
    await flushAsync();

    // 단언
    expect(routerMock.replace).toHaveBeenCalledTimes(0);
    expect(mockRequestForeground).toHaveBeenCalledTimes(0);
    expect(screen.getByTestId('onboarding-location-allow')).toBeOnTheScreen();
  });

  it('R7 OS 권한 창이 닫히며 생긴 활성화 신호가 허용 이동과 겹쳐도 푸시 안내로는 1회만 넘어간다', async () => {
    // 준비 — OS 창이 떠 있는 상태(요청 진행 중)
    const request = deferred<typeof GRANTED>();
    mockRequestForeground.mockReturnValue(request.promise);
    render(<LocationPage />);
    await waitFor(() => expect(mockGetForeground).toHaveBeenCalledTimes(1));
    fireEvent.press(screen.getByTestId('onboarding-location-allow'));
    mockGetForeground.mockResolvedValue(GRANTED);

    // 실행 — 창이 닫히며 inactive → active, 그리고 요청 결과(허용) 도착
    emitAppState('inactive', 'active');
    await flushAsync();
    request.resolve(GRANTED);

    // 단언
    await waitFor(
      () => expect(routerMock.replace).toHaveBeenCalledWith(PUSH_ROUTE),
      { timeout: RED_WAIT }
    );
    await flushAsync();
    expect(routerMock.replace).toHaveBeenCalledTimes(1);
  });
});

/**
 * TRIP-1601 — 기존 계정 HOME 진입 전 권한 안내가 같은 카드를 **다른 목적지로** 재사용한다(`onNext` prop).
 *
 * 무엇을 보장하나: `onNext` 가 주어지면 카드를 빠져나가는 **세 경로 전부**가 `router.replace` 가 아니라 `onNext` 를 1회 부른다 —
 *  (1) 허용 → OS 가 granted  (2) 거부 프레임의 [계속]  (3) 설정 앱에서 허용하고 돌아와 재조회가 granted.
 * 왜 세 경로를 따로 보나: 하나라도 하드코딩된 `'/(onboarding)/push'` 가 남으면 HOME 계정에겐 그 그룹이 잠겨 있어
 * 이동이 **에러 없이 무시**되고(TRIP-1597 과 같은 병) 그 경로의 [계속]만 조용히 무반응이 된다.
 * 무회귀(`onNext` 생략 → 현행 푸시 카드로 replace)는 위의 기존 케이스들이 수정 없이 지킨다(AC5).
 * 연타 창: 이동 직전에 열려 있어야 한다 — 마지막 카드 [계속] 자리에 홈 탭 바(또는 다음 카드 버튼)가 온다(X3 와 같은 사고).
 */
describe('🔴 TRIP-1601 · onNext 가 주어지면 세 이동 경로가 모두 onNext 를 쓴다', () => {
  const onNext = jest.fn();
  let clock: jest.SpyInstance;

  beforeEach(() => {
    onNext.mockClear();
    // 시계를 멈춘다 — 연타 창이 열려 있음을 실시간에 맡기지 않는다.
    clock = jest.spyOn(Date, 'now').mockReturnValue(FROZEN_NOW);
  });
  afterEach(() => clock.mockRestore());

  /** "탭 바 자리의 다음 버튼" — 창이 열려 있으면 이 가드 버튼은 눌려도 무시된다. */
  function expectPressWindowOpen() {
    const nextButton = jest.fn();
    guardPress(nextButton)();
    expect(nextButton).not.toHaveBeenCalled();
  }

  it('N1 허용 → granted: onNext 1회, router.replace 0회, 이동 직전에 연타 창이 열린다', async () => {
    // 준비
    mockRequestForeground.mockResolvedValue(GRANTED);
    render(<LocationPage onNext={onNext} />);

    // 실행
    fireEvent.press(screen.getByTestId('onboarding-location-allow'));

    // 단언
    await waitFor(() => expect(onNext).toHaveBeenCalledTimes(1), {
      timeout: RED_WAIT,
    });
    await flushAsync();
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(routerMock.replace).not.toHaveBeenCalled();
    expectPressWindowOpen();
  });

  it('N2 거부 프레임의 [계속]: onNext 1회(연타해도 1회), router.replace 0회', async () => {
    // 준비 — 허용 → OS 거부 → 거부 프레임
    mockRequestForeground.mockResolvedValue(DENIED);
    render(<LocationPage onNext={onNext} />);
    fireEvent.press(screen.getByTestId('onboarding-location-allow'));
    await screen.findByTestId('onboarding-location-continue');
    resetPressGuard();

    // 실행 — 빠르게 두 번
    fireEvent.press(screen.getByTestId('onboarding-location-continue'));
    fireEvent.press(screen.getByTestId('onboarding-location-continue'));

    // 단언
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(routerMock.replace).not.toHaveBeenCalled();
  });

  it('N3 거부 프레임에서 설정 앱에서 허용하고 돌아오면: onNext 1회(신호가 겹쳐도 1회), router.replace 0회', async () => {
    // 준비 — 거부 프레임, 그 사이 설정 앱에서 허용됨
    mockRequestForeground.mockResolvedValue(DENIED);
    render(<LocationPage onNext={onNext} />);
    fireEvent.press(screen.getByTestId('onboarding-location-allow'));
    await screen.findByTestId('onboarding-location-continue');
    resetPressGuard();
    mockGetForeground.mockResolvedValue(GRANTED);

    // 실행 — 설정 앱으로 나갔다가 돌아온다(활성 신호가 두 번 온다)
    emitAppState('background', 'active', 'active');

    // 단언
    await waitFor(() => expect(onNext).toHaveBeenCalledTimes(1), {
      timeout: RED_WAIT,
    });
    await flushAsync();
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(routerMock.replace).not.toHaveBeenCalled();
    expect(mockRequestForeground).toHaveBeenCalledTimes(1);
  });
});
