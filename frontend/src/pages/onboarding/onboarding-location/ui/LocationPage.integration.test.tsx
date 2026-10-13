import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

import { server } from '@/mocks/server';
import { resetPressGuard } from '@/shared/lib/pressGuard';
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

/** c08 이 주입해야 하는 Figma 온보딩 목적 문구(브리프 §화면·IO · 1296:1208). 프리뷰의
 * placeholder "내 주변 숙소 탐색" 이 아니라 **화면 정본 문구**여야 한다. toHaveTextContent 는
 * 문자열이면 완전 일치이므로(RNTL matches exact:true 기본), 이 상수 전체가 곧 계약이다. */
// TRIP-717: Figma 1296:1208 2줄 고정 개행 반영(같은 어구, 중간에 \n). toHaveTextContent 는
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
});

afterEach(() => {
  server.resetHandlers();
  resetPressGuard();
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
