jest.mock('@/shared/api/generated/notifications/notifications');

import type * as NotificationsModule from 'expo-notifications';
import type * as ApiModule from '@/shared/api/generated/notifications/notifications';
import type * as PushModule from '@/shared/push';

import { primeExpoToken, primeOsPermission } from '@/test-support/pushOsFake';

/**
 * TRIP-835 · shared/push — 권한 요청·등록·해제 배선 루틴.
 *
 * 무엇을 보장하나:
 *  - AC-1 `requestPushPermission`: 아직 답하지 않은(UNDETERMINED) 사용자에게만 OS 다이얼로그를 띄운다.
 *    `getPushPermission` 은 여전히 조회만 한다(TRIP-607).
 *  - AC-2 `promptAndRegisterPush`: 허용(GRANTED)일 때만 `POST /me/push-tokens`, 바디는 서버 어휘.
 *  - AC-4 `registerPushIfGranted`: 조회만 하고 절대 묻지 않는다. 허용이면 등록.
 *  - AC-7 안드로이드 채널 3종이 권한 요청보다 **먼저 끝난다**. iOS 에선 0개.
 *  - AC-5·6 `unregisterStoredPushToken`: 이번 세션에 등록한 토큰만 해제하고, 기다리되 3초에서 끊고,
 *    실패는 삼킨다.
 *  - 세 루틴 모두 **reject 하지 않는다** — 화면이 기다리지 않고 부르기 때문이다(fire-and-forget).
 *
 * 커버하지 않는 것(6-b 실기): 실제 다이얼로그 표시, Android 13+ 에서 채널이 없을 때 다이얼로그가
 * 안 뜨는 OS 동작, 실제 Expo 토큰 발급(EAS projectId 선행).
 *
 * 3동작 뼈대: 준비=OS 가짜 상태·토큰·플랫폼 → 실행=루틴 호출 → 단언=요청·POST·DELETE·채널 호출.
 *
 * ★ `load()` 는 매번 모듈을 새로 받는다(02a ★3) — 등록한 토큰이 모듈 메모리에 남아 다음 테스트로
 *   새지 않게. 리셋 뒤엔 목도 새 인스턴스라 OS 가짜는 `load()` 가 준 `N` 에 심는다.
 */

type Loaded = {
  push: typeof PushModule;
  N: typeof NotificationsModule;
  api: jest.Mocked<typeof ApiModule>;
  Platform: { OS: string };
};

function load(): Loaded {
  jest.resetModules();
  /* eslint-disable @typescript-eslint/no-require-imports */
  return {
    push: require('@/shared/push'),
    N: require('expo-notifications'),
    api: require('@/shared/api/generated/notifications/notifications'),
    Platform: require('react-native').Platform,
  };
  /* eslint-enable @typescript-eslint/no-require-imports */
}

const TOKEN = 'ExponentPushToken[A]';

/** Android 로 바꾼다 — 리셋 뒤 새 Platform 인스턴스에 걸어야 구현이 본다(02a ★5). */
function asAndroid(Platform: { OS: string }): () => void {
  const replaced = jest.replaceProperty(Platform, 'OS', 'android');
  return () => replaced.restore();
}

/** 아직 안 풀린 promise 와 그것을 푸는 손잡이. */
function deferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

let restorePlatform: (() => void) | null = null;

afterEach(() => {
  restorePlatform?.();
  restorePlatform = null;
  jest.useRealTimers();
});

describe('AC-1 · requestPushPermission — 이미 답한 사용자에게 다시 묻지 않는다', () => {
  it.each([
    ['undetermined', 'granted', 1, 'GRANTED'],
    ['undetermined', 'denied', 1, 'DENIED'],
    ['granted', 'denied', 0, 'GRANTED'],
    ['denied', 'granted', 0, 'DENIED'],
  ] as const)(
    'R1 OS 권한 %s (다이얼로그 답 %s) → 요청 %i회, 결과 %s',
    async (initial, answer, requests, result) => {
      // 준비
      const { push, N } = load();
      primeOsPermission(N, initial, answer);

      // 실행
      const status = await push.requestPushPermission();

      // 단언
      expect(status).toBe(result);
      expect(N.requestPermissionsAsync).toHaveBeenCalledTimes(requests);
    }
  );

  it('R2 getPushPermission 은 여전히 조회만 한다(TRIP-607) — 요청 0회', async () => {
    const { push, N } = load();
    primeOsPermission(N, 'undetermined', 'granted');

    const status = await push.getPushPermission();

    expect(status).toBe('UNDETERMINED');
    expect(N.requestPermissionsAsync).not.toHaveBeenCalled();
  });
});

describe('AC-2 · promptAndRegisterPush — 허용일 때만, 서버 어휘로 등록', () => {
  it('P1 처음 묻고 허용하면 POST 1회, 바디는 정확히 {token, platform:IOS, osPermission:GRANTED}', async () => {
    // 준비: 아직 안 물어본 사용자가 다이얼로그에서 [허용]을 누른다.
    const { push, N, api } = load();
    primeOsPermission(N, 'undetermined', 'granted');
    primeExpoToken(N, TOKEN);

    // 실행
    await push.promptAndRegisterPush();

    // 단언: 요청 1회 → 등록 1회. 바디는 완전 일치(02a ★2) — 요청 전에 읽어 둔 낡은 값을 올리면
    // osPermission 이 NOT_DETERMINED 가 되어 여기서 걸린다.
    expect(N.requestPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(api.postMePushTokens).toHaveBeenCalledTimes(1);
    expect(api.postMePushTokens.mock.calls[0][0]).toEqual({
      token: TOKEN,
      platform: 'IOS',
      osPermission: 'GRANTED',
    });
  });

  it.each([
    ['물었는데 거부', 'undetermined', 'denied'],
    ['다이얼로그를 닫아 여전히 미정', 'undetermined', 'undetermined'],
    ['이미 거부', 'denied', 'granted'],
  ] as const)(
    'P2 %s이면 등록하지 않는다 — 토큰 획득·POST 0회',
    async (_label, initial, answer) => {
      const { push, N, api } = load();
      primeOsPermission(N, initial, answer);
      primeExpoToken(N, TOKEN);

      await push.promptAndRegisterPush();

      expect(N.getExpoPushTokenAsync).not.toHaveBeenCalled();
      expect(api.postMePushTokens).not.toHaveBeenCalled();
    }
  );

  it('P3 이미 허용한 사용자는 묻지 않고 등록한다(osPermission=GRANTED)', async () => {
    const { push, N, api } = load();
    primeOsPermission(N, 'granted');
    primeExpoToken(N, TOKEN);

    await push.promptAndRegisterPush();

    expect(N.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(api.postMePushTokens).toHaveBeenCalledTimes(1);
    expect(api.postMePushTokens.mock.calls[0][0]).toEqual({
      token: TOKEN,
      platform: 'IOS',
      osPermission: 'GRANTED',
    });
  });

  it.each([
    [
      '토큰 획득 실패(projectId 없음)',
      (N: typeof NotificationsModule) =>
        (N.getExpoPushTokenAsync as jest.Mock).mockRejectedValue(
          new Error('No "projectId" found')
        ),
      () => {},
    ],
    [
      'POST 네트워크 실패',
      (N: typeof NotificationsModule) => primeExpoToken(N, TOKEN),
      (api: jest.Mocked<typeof ApiModule>) =>
        api.postMePushTokens.mockRejectedValue(new Error('Network Error')),
    ],
  ])(
    'P4 %s여도 reject 하지 않는다(화면이 기다리지 않고 부른다)',
    async (_label, primeToken, primeApi) => {
      const { push, N, api } = load();
      primeOsPermission(N, 'undetermined', 'granted');
      primeToken(N);
      primeApi(api);

      await expect(push.promptAndRegisterPush()).resolves.toBeUndefined();
    }
  );
});

describe('AC-4 · registerPushIfGranted — 조회만, 절대 묻지 않는다', () => {
  it('S1 허용 상태면 요청 없이 POST 1회(osPermission=GRANTED)', async () => {
    const { push, N, api } = load();
    primeOsPermission(N, 'granted');
    primeExpoToken(N, TOKEN);

    await push.registerPushIfGranted();

    expect(N.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(api.postMePushTokens).toHaveBeenCalledTimes(1);
    expect(api.postMePushTokens.mock.calls[0][0]).toEqual({
      token: TOKEN,
      platform: 'IOS',
      osPermission: 'GRANTED',
    });
  });

  it.each(['undetermined', 'denied'] as const)(
    'S2 OS 권한 %s 이면 요청 0회·POST 0회(앱을 켤 때 다이얼로그를 띄우지 않는다)',
    async (initial) => {
      const { push, N, api } = load();
      primeOsPermission(N, initial, 'granted');
      primeExpoToken(N, TOKEN);

      await push.registerPushIfGranted();

      expect(N.requestPermissionsAsync).not.toHaveBeenCalled();
      expect(api.postMePushTokens).not.toHaveBeenCalled();
    }
  );

  it('S3 권한 조회가 실패해도 reject 하지 않는다', async () => {
    const { push, N } = load();
    (N.getPermissionsAsync as jest.Mock).mockRejectedValue(new Error('boom'));

    await expect(push.registerPushIfGranted()).resolves.toBeUndefined();
  });
});

describe('AC-7 · 안드로이드 채널 3종 — 권한 요청보다 먼저 끝난다', () => {
  it('C1 Android 에서 요청하면 passive·active·time-sensitive 채널을 정해진 이름·중요도로 만든다', async () => {
    // 준비
    const { push, N, Platform } = load();
    restorePlatform = asAndroid(Platform);
    primeOsPermission(N, 'undetermined', 'granted');

    // 실행
    await push.requestPushPermission();

    // 단언: 정확히 3개, 각각 ID·이름·중요도.
    const setChannel = N.setNotificationChannelAsync as jest.Mock;
    expect(setChannel).toHaveBeenCalledTimes(3);
    expect(setChannel).toHaveBeenCalledWith(
      'passive',
      expect.objectContaining({
        name: '회고·소식',
        importance: N.AndroidImportance.LOW,
      })
    );
    expect(setChannel).toHaveBeenCalledWith(
      'active',
      expect.objectContaining({
        name: '여행 알림',
        importance: N.AndroidImportance.DEFAULT,
      })
    );
    expect(setChannel).toHaveBeenCalledWith(
      'time-sensitive',
      expect.objectContaining({
        name: '일정 임박·Plan-B',
        importance: N.AndroidImportance.HIGH,
      })
    );
    // 방해금지 뚫기는 켜지 않는다(별도 권한 필요 · 받을지는 사용자가 정한다).
    for (const [, config] of setChannel.mock.calls) {
      expect((config as { bypassDnd?: boolean }).bypassDnd).not.toBe(true);
    }
  });

  it('C2 채널 생성이 끝나기 전에는 권한 요청을 하지 않는다(Android 13+ 는 채널 없으면 다이얼로그가 안 뜬다)', async () => {
    // 준비: 채널 생성이 게이트를 풀 때까지 안 끝나게 붙잡는다(02a ★4).
    const { push, N, Platform } = load();
    restorePlatform = asAndroid(Platform);
    primeOsPermission(N, 'undetermined', 'granted');
    const gate = deferred<null>();
    (N.setNotificationChannelAsync as jest.Mock).mockImplementation(
      () => gate.promise
    );

    // 실행: 기다리지 않고 시작만 한다.
    const pending = push.requestPushPermission();
    await new Promise((resolve) => setTimeout(resolve, 0));

    // 단언: 채널이 아직 안 끝났으니 요청도 없다.
    expect(N.requestPermissionsAsync).not.toHaveBeenCalled();

    // 실행: 채널 생성을 끝낸다.
    gate.resolve(null);
    await pending;

    // 단언: 그제야 요청 1회.
    expect(N.requestPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  it('C3 iOS 에서는 채널을 만들지 않는다(C1 의 짝) — 요청은 그대로 1회', async () => {
    const { push, N } = load();
    primeOsPermission(N, 'undetermined', 'granted');

    await push.requestPushPermission();

    expect(N.setNotificationChannelAsync).not.toHaveBeenCalled();
    expect(N.requestPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  it('C4 앱 진입 등록(registerPushIfGranted)도 Android 에서 채널 3종을 보장하고 platform=ANDROID 로 올린다', async () => {
    const { push, N, api, Platform } = load();
    restorePlatform = asAndroid(Platform);
    primeOsPermission(N, 'granted');
    primeExpoToken(N, TOKEN);

    await push.registerPushIfGranted();

    expect(N.setNotificationChannelAsync).toHaveBeenCalledTimes(3);
    expect(api.postMePushTokens.mock.calls[0][0]).toEqual({
      token: TOKEN,
      platform: 'ANDROID',
      osPermission: 'GRANTED',
    });
  });
});

describe('AC-5·6 · unregisterStoredPushToken — 이번 세션에 등록한 토큰만 해제', () => {
  /** 이번 세션에 토큰 하나를 등록해 둔다(보관은 등록 성공이 만든다). */
  async function registerOnce(loaded: Loaded): Promise<void> {
    primeOsPermission(loaded.N, 'granted');
    primeExpoToken(loaded.N, TOKEN);
    await loaded.push.registerPushToken();
  }

  it('U1 등록한 토큰으로 DELETE 를 1회 보낸다', async () => {
    const loaded = load();
    await registerOnce(loaded);

    await loaded.push.unregisterStoredPushToken();

    expect(loaded.api.deleteMePushTokensToken).toHaveBeenCalledTimes(1);
    expect(loaded.api.deleteMePushTokensToken).toHaveBeenCalledWith(TOKEN);
  });

  it('U2 이번 세션에 등록하지 않았으면 DELETE 를 보내지 않는다', async () => {
    const { push, api } = load();

    await push.unregisterStoredPushToken();

    expect(api.deleteMePushTokensToken).not.toHaveBeenCalled();
  });

  it.each([
    ['404(이미 없는 토큰)', Object.assign(new Error('404'), { status: 404 })],
    ['네트워크 실패', new Error('Network Error')],
  ])('U3 DELETE %s 여도 reject 하지 않는다', async (_label, error) => {
    const loaded = load();
    await registerOnce(loaded);
    loaded.api.deleteMePushTokensToken.mockRejectedValue(error);

    await expect(
      loaded.push.unregisterStoredPushToken()
    ).resolves.toBeUndefined();
  });

  it('U4 DELETE 응답을 기다린다 — 응답 전에는 끝나지 않는다(02a ★6)', async () => {
    const loaded = load();
    await registerOnce(loaded);
    jest.useFakeTimers();
    const gate = deferred();
    loaded.api.deleteMePushTokensToken.mockImplementation(
      () => gate.promise as ReturnType<typeof ApiModule.deleteMePushTokensToken>
    );
    let done = false;

    // 실행: 해제를 시작한다.
    const pending = loaded.push.unregisterStoredPushToken().then(() => {
      done = true;
    });
    await jest.advanceTimersByTimeAsync(0);

    // 단언: 서버가 아직 답하지 않았으니 끝나지 않았다.
    expect(done).toBe(false);

    // 실행: 서버가 답한다.
    gate.resolve();
    await jest.advanceTimersByTimeAsync(0);
    await pending;

    // 단언: 이제 끝났다.
    expect(done).toBe(true);
  });

  it('U5 서버가 끝내 답하지 않아도 3초에서 끊는다(1초엔 아직 기다린다)', async () => {
    const loaded = load();
    await registerOnce(loaded);
    jest.useFakeTimers();
    loaded.api.deleteMePushTokensToken.mockImplementation(
      () =>
        new Promise(() => {}) as ReturnType<
          typeof ApiModule.deleteMePushTokensToken
        >
    );
    let done = false;

    const pending = loaded.push.unregisterStoredPushToken().then(() => {
      done = true;
    });

    await jest.advanceTimersByTimeAsync(1000);
    expect(done).toBe(false);

    await jest.advanceTimersByTimeAsync(2000);
    await pending;
    expect(done).toBe(true);
  });
});
