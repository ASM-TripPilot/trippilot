import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

import { server } from '@/mocks/server';
import { LocationPage } from './LocationPage';

/**
 * AC-3 · 4 · 5 · 6 · 7 · 8 — c08 위치 프리프롬프트 **배선** 통합테스트 (TRIP-459).
 *
 * 무엇을 보장하나: 화면(LocationPreprompt, 동결)을 재사용해
 *  (1) default 로 렌더하고 Figma 온보딩 목적 문구를 주입한다(AC-3),
 *  (2) "허용" 을 누르면 OS 권한 요청이 **딱 1회** 발화되고 granted 면 pref1 로 넘어간다(AC-4),
 *  (3) OS 가 denied 로 답하면 denied 프레임으로 **전환**하되 "계속" 으로 pref1 에 도달한다(AC-5),
 *  (4) "나중에 하기" 는 OS 를 **안 부르고** pref1 로 진행한다(AC-6),
 *  (5) denied 에서 "위치 설정 열기" 는 앱 설정을 연다(AC-7),
 *  (6) c08 은 서버 진행 플래그를 **만들지 않는다** — 전 플로우에 서버 호출 0(AC-8).
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
const ONBOARDING_PURPOSE =
  '내 주변을 알면 더 잘 맞는 곳을 추천하고 길 안내도 막힘없이 이어져요';
const PREF1_ROUTE = '/(onboarding)/pref1';

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

afterEach(() => server.resetHandlers());

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
    expect(screen.getByTestId('onboarding-location-later')).toBeOnTheScreen();
  });
});

describe('LocationPage — 허용 → OS 권한 요청 (AC-4)', () => {
  it('"위치 사용 허용" 을 누르면 OS 권한 요청이 1회 발화되고 granted 면 pref1 로 replace 한다', async () => {
    mockRequestForeground.mockResolvedValue(GRANTED);
    render(<LocationPage />);

    fireEvent.press(screen.getByTestId('onboarding-location-allow'));

    await waitFor(() => expect(mockRequestForeground).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(routerMock.replace).toHaveBeenCalledWith(PREF1_ROUTE)
    );
  });
});

describe('LocationPage — 나중에 하기 (AC-6)', () => {
  it('"나중에 하기" 를 누르면 OS 권한 요청 없이 pref1 로 진행한다', async () => {
    render(<LocationPage />);

    fireEvent.press(screen.getByTestId('onboarding-location-later'));

    await waitFor(() =>
      expect(routerMock.replace).toHaveBeenCalledWith(PREF1_ROUTE)
    );
    // 나중에는 OS 다이얼로그를 띄우지 않는다 — 프리프롬프트의 존재 이유(발화 시점 사용자 선택).
    expect(mockRequestForeground).not.toHaveBeenCalled();
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

  it('denied 프레임에서 "계속" 을 누르면 pref1 로 도달한다(거부가 온보딩을 막지 않는다)', async () => {
    await reachDenied();

    fireEvent.press(screen.getByTestId('onboarding-location-continue'));

    await waitFor(() =>
      expect(routerMock.replace).toHaveBeenCalledWith(PREF1_ROUTE)
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

describe('LocationPage — 서버 진행 플래그 미생성 (AC-8)', () => {
  it('허용→granted→pref1 전 플로우 동안 서버로 아무 요청도 보내지 않는다', async () => {
    mockRequestForeground.mockResolvedValue(GRANTED);
    render(<LocationPage />);

    fireEvent.press(screen.getByTestId('onboarding-location-allow'));
    await waitFor(() =>
      expect(routerMock.replace).toHaveBeenCalledWith(PREF1_ROUTE)
    );

    // c08 은 전이 화면이라 진행 플래그를 만들지 않는다(resolveOnboardingStep 은 terms/nickname/done
    // 만 판정). 여기에 onboarding/complete 류가 새로 생기면 requestLog 가 잡는다.
    expect(requestLog).toEqual([]);
  });
});
