import * as Notifications from 'expo-notifications';
import { http, HttpResponse } from 'msw';
import { AppState } from 'react-native';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

import { server } from '@/mocks/server';
import type {
  NotificationToggle,
  RegisterPushTokenRequest,
} from '@/shared/api/index.schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';
import { BASE } from '@/test-support/apiBase';
import { routerSpies } from '@/test-support/expoRouterMock';
import { primeExpoToken, primeOsPermission } from '@/test-support/pushOsFake';
import { createGcZeroWrapper, settle } from '@/test-support/queryRender';

import { NotificationSettingsPage } from './NotificationSettingsPage';

/**
 * l02 알림 설정 — 페이지 배선(서버 토글 × 기기 OS 권한) 통합 테스트(TRIP-1442).
 *
 * 무엇을 보장하나:
 *  - 권한을 읽는 동안에는 푸시가 꺼짐·잠김이고 권한 거부 표면(배너·"권한 필요"·푸시-누적 문구)이 번쩍이지 않는다.
 *  - 한 번도 묻지 않은 권한(UNDETERMINED)이면 배너를 눌렀을 때 설정 앱이 아니라 OS 권한 창이 1회 뜨고, 답으로 다시
 *    판정한다. 허용이면 기기 토큰을 서버에 등록한다. 이미 거부면 배너는 설정 앱을 연다.
 *  - 설정 앱에 다녀와 앱이 다시 앞으로 오면(AppState active) 권한을 **조회만** 다시 해 푸시 열이 바뀐다.
 *    거부→허용으로 바뀐 순간 토큰을 1회 등록한다.
 *
 * 관찰은 함수 이름이 아니라 바깥에서 보이는 일로 한다 — OS 권한 요청 = `requestPermissionsAsync` 호출 수,
 * 설정 앱 = `openSettings` 호출 수, 토큰 등록 = 서버가 받은 `POST /me/push-tokens`.
 * OS 권한 창·설정 앱 왕복 자체는 jest 가 못 본다(6-b 실기 몫).
 */

// 등록 중복 생략 기억(TRIP-1348)이 테스트 사이에 이어지면 다음 테스트의 POST 가 조용히 사라진다 — 늘 "기억 없음".
jest.mock('@/shared/storage', () => ({
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  ...require('@/test-support/storageMock'),
  PUSH_REGISTERED_KEY: 'pushTokenRegistered',
  readStringValue: async () => null,
  writeStringValue: async () => undefined,
}));

const mockOpenSettings = jest.fn();
jest.mock('expo-linking', () => ({
  openSettings: (...args: unknown[]) => mockOpenSettings(...args),
}));

jest.mock('expo-router', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@/test-support/expoRouterMock').createExpoRouterMock({
    useRouter: ['push', 'replace', 'back'],
  })
);

// 통합 버킷의 기다림 상한(5초, integrationSetup)과 테스트 상한이 같으면 기다리던 화면이 끝내 안 올 때 "시간 초과"만
// 남고 무엇을 못 찾았는지가 사라진다 — 테스트 상한을 넉넉히 둬 기다림의 실패 메시지가 먼저 나오게 한다.
jest.setTimeout(15_000);

const PUSH_STAY = 'notification-settings-toggle-push-STAY';
const PUSH_SLOT_PRE = 'notification-settings-toggle-push-SLOT_PRE';
const INAPP_STAY = 'notification-settings-toggle-inapp-STAY';
const BANNER_ID = 'notification-settings-permission-banner';
const DENIED_BOTTOM_COPY = '푸시를 꺼도 인앱 알림은 알림함에 계속 쌓여요';
const VISIBLE_KINDS = [
  'STAY',
  'TRIP_PRE',
  'TRIP_DAY',
  'SLOT_PRE',
  'PLAN_B',
  'REFLECTION',
] as const;

/** 서버 7종(BR-U6-18 기본값 — SLOT_PRE·PLAN_B 만 푸시 OFF). */
const SERVER_ITEMS: NotificationToggle[] = [
  { kind: 'STAY', pushEnabled: true, inAppEnabled: true },
  { kind: 'TRIP_PRE', pushEnabled: true, inAppEnabled: true },
  { kind: 'TRIP_DAY', pushEnabled: true, inAppEnabled: true },
  { kind: 'SLOT_PRE', pushEnabled: false, inAppEnabled: true },
  { kind: 'PLAN_B', pushEnabled: false, inAppEnabled: true },
  { kind: 'REFLECTION', pushEnabled: true, inAppEnabled: true },
  { kind: 'COMMUNITY', pushEnabled: true, inAppEnabled: true },
];

const getPermissionsMock = Notifications.getPermissionsAsync as jest.Mock;
const requestPermissionsMock =
  Notifications.requestPermissionsAsync as jest.Mock;

let postedTokens: RegisterPushTokenRequest[] = [];

/**
 * 앱 활성화(AppState) 구독을 붙잡는 장치(LocationPage.integration TRIP-1427 선례). RN jest 목의 `addEventListener` 는
 * 핸들러를 절대 부르지 않아 스파이로 모아 두고 테스트가 직접 상태를 보낸다. `remove()` 된 구독에는 보내지 않는다.
 */
type AppStateSub = { handler: (next: string) => void; removed: boolean };
let appStateSubs: AppStateSub[] = [];
let appStateSpy: jest.SpyInstance | undefined;

function emitAppState(...states: string[]) {
  act(() => {
    for (const next of states) {
      appStateSubs
        .filter((sub) => !sub.removed)
        .forEach((sub) => sub.handler(next));
    }
  });
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

// 파일 최상위 — 전역 목의 호출 기록·구현은 파일 안에서 공유되므로 모든 테스트 앞에서 지운다.
beforeEach(() => {
  setAccessToken('a');
  postedTokens = [];
  getPermissionsMock.mockClear();
  requestPermissionsMock.mockClear();
  (Notifications.getExpoPushTokenAsync as jest.Mock).mockReset();
  primeOsPermission(Notifications, 'denied');
  mockOpenSettings.mockReset();
  mockOpenSettings.mockResolvedValue(undefined);
  server.use(
    http.get(`${BASE}/me/notification-settings`, () =>
      HttpResponse.json({ items: SERVER_ITEMS })
    ),
    http.post(`${BASE}/me/push-tokens`, async ({ request }) => {
      postedTokens.push((await request.json()) as RegisterPushTokenRequest);
      return HttpResponse.json({
        platform: 'IOS',
        osPermission: 'GRANTED',
        deliverable: true,
      });
    })
  );
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
  clearAccessToken();
  appStateSpy?.mockRestore();
});

afterAll(() => server.close());

function renderPage() {
  return render(<NotificationSettingsPage />, {
    wrapper: createGcZeroWrapper(),
  });
}

/** 서버 값이 도착할 때까지 — 도착 전엔 빈 값(전부 꺼짐)이라 "푸시 꺼짐"만으로는 구분이 안 된다. */
async function waitForServerValues() {
  await waitFor(() => expect(screen.getByTestId(INAPP_STAY)).toBeChecked());
}

describe('NotificationSettingsPage · 권한이 정해진 채로 들어옴', () => {
  it('OS 권한이 허용이면 6종 푸시 스위치가 서버 값대로 켜지고 조작 가능하며 권한 배너가 없다', async () => {
    primeOsPermission(Notifications, 'granted');

    renderPage();
    await waitForServerValues();

    await waitFor(() => expect(screen.getByTestId(PUSH_STAY)).toBeChecked());
    VISIBLE_KINDS.forEach((kind) => {
      expect(
        screen.getByTestId(`notification-settings-toggle-push-${kind}`)
      ).not.toBeDisabled();
    });
    expect(screen.getByTestId(PUSH_SLOT_PRE)).not.toBeChecked();
    expect(screen.getByText('푸시')).toBeOnTheScreen();
    expect(screen.queryByTestId(BANNER_ID)).toBeNull();
  });

  it('OS 권한이 거부면 배너를 눌렀을 때 설정 앱이 1회 열리고 OS 권한 창은 뜨지 않는다', async () => {
    primeOsPermission(Notifications, 'denied');

    renderPage();
    await waitForServerValues();
    await waitFor(() =>
      expect(screen.getByTestId(BANNER_ID)).toBeOnTheScreen()
    );
    expect(screen.getByText('권한 필요')).toBeOnTheScreen();
    expect(screen.getByTestId(PUSH_STAY)).not.toBeChecked();
    expect(screen.getByTestId(PUSH_STAY)).toBeDisabled();
    expect(mockOpenSettings).not.toHaveBeenCalled(); // 누르기 전 앵커

    fireEvent.press(screen.getByTestId(BANNER_ID));
    await settle();

    expect(mockOpenSettings).toHaveBeenCalledTimes(1);
    expect(requestPermissionsMock).not.toHaveBeenCalled();
  });
});

describe('NotificationSettingsPage · 권한을 읽는 동안', () => {
  it('OS 권한 조회가 끝나기 전엔 푸시가 꺼짐·잠김이고 권한 거부 표면이 번쩍이지 않는다', async () => {
    // 조회를 테스트가 끝낼 때까지 붙잡는다.
    let finishLookup!: (value: unknown) => void;
    const pending = new Promise((resolve) => {
      finishLookup = resolve;
    });
    getPermissionsMock.mockImplementation(() => pending);

    renderPage();
    await waitForServerValues();

    // 서버는 STAY 푸시 켜짐이지만 권한을 아직 모른다.
    expect(screen.getByTestId(PUSH_STAY)).not.toBeChecked();
    expect(screen.getByTestId(PUSH_STAY)).toBeDisabled();
    expect(screen.queryByTestId(BANNER_ID)).toBeNull();
    expect(screen.queryByText('권한 필요')).toBeNull();
    expect(screen.queryByText(DENIED_BOTTOM_COPY)).toBeNull();

    await act(async () => {
      finishLookup({
        status: 'granted',
        granted: true,
        canAskAgain: false,
        expires: 'never',
      });
    });

    await waitFor(() => expect(screen.getByTestId(PUSH_STAY)).toBeChecked());
    expect(screen.getByTestId(PUSH_STAY)).not.toBeDisabled();
  });
});

describe('NotificationSettingsPage · 한 번도 묻지 않은 권한 (결정 1=B)', () => {
  it('배너를 누르면 OS 권한 창이 1회 뜨고, 허용하면 푸시가 켜지고 기기 토큰이 1회 등록된다', async () => {
    primeOsPermission(Notifications, 'undetermined', 'granted');
    primeExpoToken(Notifications, 'ExponentPushToken[first-ask]');

    renderPage();
    await waitForServerValues();
    // 거부 얼굴을 그대로 쓴다(Q1) — 배너가 보이고 푸시는 꺼짐.
    await waitFor(() =>
      expect(screen.getByTestId(BANNER_ID)).toBeOnTheScreen()
    );
    expect(screen.getByTestId(PUSH_STAY)).not.toBeChecked();
    expect(requestPermissionsMock).not.toHaveBeenCalled(); // 누르기 전 앵커

    fireEvent.press(screen.getByTestId(BANNER_ID));

    await waitFor(() => expect(screen.getByTestId(PUSH_STAY)).toBeChecked());
    expect(screen.getByTestId(PUSH_STAY)).not.toBeDisabled();
    expect(screen.queryByTestId(BANNER_ID)).toBeNull();
    await settle();
    expect(requestPermissionsMock).toHaveBeenCalledTimes(1);
    expect(mockOpenSettings).not.toHaveBeenCalled();
    expect(postedTokens).toHaveLength(1);
    expect(postedTokens[0]).toMatchObject({
      token: 'ExponentPushToken[first-ask]',
      osPermission: 'GRANTED',
    });
  });

  it('OS 권한 창에서 거부하면 푸시는 꺼진 채 남고, 다시 누르면 그때는 설정 앱이 열린다', async () => {
    primeOsPermission(Notifications, 'undetermined', 'denied');

    renderPage();
    await waitForServerValues();
    await waitFor(() =>
      expect(screen.getByTestId(BANNER_ID)).toBeOnTheScreen()
    );

    fireEvent.press(screen.getByTestId(BANNER_ID));
    await settle();

    expect(requestPermissionsMock).toHaveBeenCalledTimes(1);
    expect(mockOpenSettings).not.toHaveBeenCalled();
    expect(screen.getByTestId(BANNER_ID)).toBeOnTheScreen();
    expect(screen.getByTestId(PUSH_STAY)).not.toBeChecked();
    expect(screen.getByTestId(PUSH_STAY)).toBeDisabled();

    // 답으로 다시 판정했으면 이제는 "거부" — 같은 배너가 설정 앱을 연다.
    fireEvent.press(screen.getByTestId(BANNER_ID));
    await settle();

    expect(mockOpenSettings).toHaveBeenCalledTimes(1);
    expect(requestPermissionsMock).toHaveBeenCalledTimes(1);
    expect(postedTokens).toHaveLength(0);
  });
});

describe('NotificationSettingsPage · 설정 앱에 다녀옴 (결정 2 · AppState active)', () => {
  it('거부로 그려진 뒤 설정에서 허용하고 돌아오면 푸시가 켜지고 토큰이 1회 등록된다 (권한 창은 다시 안 뜬다)', async () => {
    primeOsPermission(Notifications, 'denied');

    renderPage();
    await waitForServerValues();
    await waitFor(() =>
      expect(screen.getByTestId(BANNER_ID)).toBeOnTheScreen()
    );
    expect(screen.getByTestId(PUSH_STAY)).not.toBeChecked(); // 돌아오기 전 앵커

    // 설정 앱에서 알림을 켰다.
    primeOsPermission(Notifications, 'granted');
    primeExpoToken(Notifications, 'ExponentPushToken[round-trip]');
    emitAppState('background', 'active');

    await waitFor(() => expect(screen.getByTestId(PUSH_STAY)).toBeChecked());
    expect(screen.getByTestId(PUSH_STAY)).not.toBeDisabled();
    expect(screen.queryByTestId(BANNER_ID)).toBeNull();
    await settle();
    expect(postedTokens).toHaveLength(1);
    expect(postedTokens[0]).toMatchObject({
      token: 'ExponentPushToken[round-trip]',
      osPermission: 'GRANTED',
    });
    expect(requestPermissionsMock).not.toHaveBeenCalled();
  });

  it('한 번도 묻지 않은 채로 앱이 앞으로 와도 OS 권한 창을 띄우지 않는다 (다시 읽기는 조회만)', async () => {
    // 이미 답한 권한에는 요청 함수도 창을 안 띄운다 — "요청을 얹었나"는 아직 안 물은 상태에서만 드러난다.
    primeOsPermission(Notifications, 'undetermined', 'granted');

    renderPage();
    await waitForServerValues();
    await waitFor(() =>
      expect(screen.getByTestId(BANNER_ID)).toBeOnTheScreen()
    );
    const lookupsBefore = getPermissionsMock.mock.calls.length;

    emitAppState('background', 'active');
    await settle();

    expect(getPermissionsMock.mock.calls.length).toBeGreaterThan(lookupsBefore); // 앵커 — 다시 읽기는 했다
    expect(requestPermissionsMock).not.toHaveBeenCalled();
    expect(screen.getByTestId(BANNER_ID)).toBeOnTheScreen();
    expect(screen.getByTestId(PUSH_STAY)).not.toBeChecked();
  });

  it('허용으로 그려진 뒤 설정에서 끄고 돌아오면 푸시가 꺼짐·잠김이 되고 권한 배너가 뜬다', async () => {
    primeOsPermission(Notifications, 'granted');

    renderPage();
    await waitForServerValues();
    await waitFor(() => expect(screen.getByTestId(PUSH_STAY)).toBeChecked()); // 앵커

    primeOsPermission(Notifications, 'denied');
    emitAppState('background', 'active');

    await waitFor(() =>
      expect(screen.getByTestId(PUSH_STAY)).not.toBeChecked()
    );
    expect(screen.getByTestId(PUSH_STAY)).toBeDisabled();
    expect(screen.getByTestId(BANNER_ID)).toBeOnTheScreen();
  });

  it('화면을 떠난 뒤에는 앱이 앞으로 와도 권한을 다시 읽지 않는다 (구독 해제)', async () => {
    primeOsPermission(Notifications, 'denied');

    const { unmount } = renderPage();
    await waitForServerValues();
    await waitFor(() =>
      expect(screen.getByTestId(BANNER_ID)).toBeOnTheScreen()
    );

    unmount();
    const lookupsBefore = getPermissionsMock.mock.calls.length;
    emitAppState('background', 'active');
    await settle();

    expect(getPermissionsMock.mock.calls.length).toBe(lookupsBefore);
  });
});

// B안(2026-11-01) — 옛 `NotificationSettingsScreen.test.tsx`(뷰 단위)가 보던 화면 동작을 서버 응답·OS 권한만 바꿔
// 이 페이지 위에서 본다. 6종 행·스위치 이름·COMMUNITY·SYSTEM 미렌더·권한별 문구·토글 PATCH 바디·뒤로.
describe('NotificationSettingsPage · 화면 동작 (옛 뷰 단위 흡수)', () => {
  const TOP_COPY = '변경한 알림 설정은 다음 알림부터 바로 반영돼요';
  const BOTTOM_COPY = '모든 알림을 꺼도 보안·계정 관련 알림은 알림함에 보여요';
  const DENIED_TOP_COPY = '기기 설정에서 알림 권한을 허용하세요';
  const pushId = (kind: string) => `notification-settings-toggle-push-${kind}`;
  const inAppId = (kind: string) =>
    `notification-settings-toggle-inapp-${kind}`;

  let patches: { kind: string; body: unknown }[] = [];
  beforeEach(() => {
    patches = [];
    server.use(
      http.patch(
        `${BASE}/me/notification-settings/:kind`,
        async ({ request, params }) => {
          patches.push({
            kind: String(params.kind),
            body: await request.json(),
          });
          return HttpResponse.json({
            kind: params.kind,
            pushEnabled: true,
            inAppEnabled: true,
          });
        }
      )
    );
  });

  it('권한 허용이면 6종 행마다 "{라벨} 푸시/인앱" 스위치가 있고 COMMUNITY·SYSTEM 은 없으며, 허용 얼굴 문구만 보인다', async () => {
    primeOsPermission(Notifications, 'granted');
    server.use(
      http.get(`${BASE}/me/notification-settings`, () =>
        HttpResponse.json({
          items: [
            ...SERVER_ITEMS.map((item) =>
              item.kind === 'SLOT_PRE' || item.kind === 'TRIP_PRE'
                ? { ...item, inAppEnabled: false }
                : item
            ),
            { kind: 'SYSTEM', pushEnabled: true, inAppEnabled: true },
          ],
        })
      )
    );

    renderPage();
    await waitFor(() => expect(screen.getByTestId(PUSH_STAY)).toBeChecked());

    VISIBLE_KINDS.forEach((kind) => {
      expect(screen.getByTestId(pushId(kind))).toBeOnTheScreen();
      expect(screen.getByTestId(inAppId(kind))).not.toBeDisabled();
    });
    expect(screen.getAllByRole('switch', { name: / 푸시$/ })).toHaveLength(6);
    expect(screen.getAllByRole('switch', { name: / 인앱$/ })).toHaveLength(6);
    for (const kind of ['COMMUNITY', 'SYSTEM']) {
      expect(screen.queryByTestId(pushId(kind))).toBeNull();
      expect(screen.queryByTestId(inAppId(kind))).toBeNull();
    }
    // 인앱은 서버 값 그대로(SLOT_PRE·TRIP_PRE 만 꺼짐 — TRIP_PRE 는 푸시 켜짐이라 채널이 섞이면 red).
    expect(screen.getByTestId(inAppId('TRIP_PRE'))).not.toBeChecked();
    expect(screen.getByTestId(inAppId('SLOT_PRE'))).not.toBeChecked();
    expect(screen.getByTestId(inAppId('PLAN_B'))).toBeChecked();

    expect(screen.getByText(TOP_COPY)).toBeOnTheScreen();
    expect(screen.getByText('푸시')).toBeOnTheScreen();
    expect(screen.getByText('인앱')).toBeOnTheScreen();
    expect(screen.getByText(BOTTOM_COPY)).toBeOnTheScreen();
    expect(screen.queryByText('권한 필요')).toBeNull();
    expect(screen.queryByText(DENIED_BOTTOM_COPY)).toBeNull();
  });

  it('권한 거부면 6종 푸시가 전부 꺼짐·잠김, 인앱은 값대로 켜짐·조작 가능, 거부 얼굴 문구만 보인다', async () => {
    renderPage();
    await waitForServerValues();
    await waitFor(() =>
      expect(screen.getByTestId(BANNER_ID)).toBeOnTheScreen()
    );

    VISIBLE_KINDS.forEach((kind) => {
      expect(screen.getByTestId(pushId(kind))).not.toBeChecked();
      expect(screen.getByTestId(pushId(kind))).toBeDisabled();
      expect(screen.getByTestId(inAppId(kind))).toBeChecked();
      expect(screen.getByTestId(inAppId(kind))).not.toBeDisabled();
    });
    expect(screen.getByText(DENIED_TOP_COPY)).toBeOnTheScreen();
    expect(screen.getByText('설정 이동')).toBeOnTheScreen();
    expect(screen.getByText('인앱')).toBeOnTheScreen();
    expect(screen.getByText(DENIED_BOTTOM_COPY)).toBeOnTheScreen();
    expect(screen.queryByText(TOP_COPY)).toBeNull();
    expect(screen.queryByText('푸시')).toBeNull();
    expect(screen.queryByText(BOTTOM_COPY)).toBeNull();
  });

  it('권한 허용이면 스위치를 누를 때 그 kind·그 채널의 반대 값 하나만 PATCH 로 나간다', async () => {
    primeOsPermission(Notifications, 'granted');
    renderPage();
    await waitFor(() => expect(screen.getByTestId(PUSH_STAY)).toBeChecked());

    fireEvent.press(screen.getByTestId(inAppId('REFLECTION'))); // 켜짐 → 끄기(STAY 가 아닌 kind — 다른 행으로 새면 red)
    fireEvent.press(screen.getByTestId(PUSH_SLOT_PRE)); // 꺼짐 → 켜기
    fireEvent.press(screen.getByTestId(pushId('TRIP_DAY'))); // 켜짐 → 끄기
    await waitFor(() => expect(patches).toHaveLength(3));

    expect(patches).toEqual(
      expect.arrayContaining([
        { kind: 'REFLECTION', body: { inAppEnabled: false } },
        { kind: 'SLOT_PRE', body: { pushEnabled: true } },
        { kind: 'TRIP_DAY', body: { pushEnabled: false } },
      ])
    );
  });

  it('권한 거부면 푸시 스위치를 눌러도 요청이 없고, 인앱 스위치는 PATCH 가 나간다', async () => {
    renderPage();
    await waitForServerValues();
    await waitFor(() =>
      expect(screen.getByTestId(BANNER_ID)).toBeOnTheScreen()
    );

    fireEvent.press(screen.getByTestId(PUSH_STAY));
    fireEvent.press(screen.getByTestId(INAPP_STAY)); // 앵커
    await waitFor(() => expect(patches).toHaveLength(1));
    await settle();

    expect(patches).toEqual([{ kind: 'STAY', body: { inAppEnabled: false } }]);
  });

  it('뒤로를 누르면 라우터 back 이 1회 나간다', async () => {
    routerSpies.back.mockClear();
    renderPage();
    await waitForServerValues();

    fireEvent.press(screen.getByTestId('notification-settings-back'));

    expect(routerSpies.back).toHaveBeenCalledTimes(1);
  });
});
