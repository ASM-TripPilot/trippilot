import * as Sentry from '@sentry/react-native';

import { initSentry } from './initSentry';

jest.mock('@sentry/react-native', () => ({ init: jest.fn() }));

const original = process.env.EXPO_PUBLIC_SENTRY_DSN;

afterEach(() => {
  jest.clearAllMocks();
  if (original === undefined) delete process.env.EXPO_PUBLIC_SENTRY_DSN;
  else process.env.EXPO_PUBLIC_SENTRY_DSN = original;
});

describe('initSentry', () => {
  it('DSN 이 없으면 init 을 부르지 않는다', () => {
    delete process.env.EXPO_PUBLIC_SENTRY_DSN;
    initSentry();
    expect(Sentry.init).not.toHaveBeenCalled();
  });

  it('DSN 이 빈 문자열이어도 init 을 부르지 않는다', () => {
    process.env.EXPO_PUBLIC_SENTRY_DSN = '';
    initSentry();
    expect(Sentry.init).not.toHaveBeenCalled();
  });

  it('DSN 이 있으면 개인정보 전송 없이 init 한다', () => {
    process.env.EXPO_PUBLIC_SENTRY_DSN = 'https://key@example.invalid/1';
    initSentry();
    expect(Sentry.init).toHaveBeenCalledTimes(1);
    // 옵션 키 집합을 고정한다(TRIP-1650 5-b 보강) — 추적·리플레이 옵션이 몰래 켜지면 그 이벤트는 beforeSend 를 거치지 않아
    // URL 스크럽 밖으로 나간다. 옵션을 늘리려면 이 단언을 함께 고쳐 스크럽 범위를 다시 판단하게 한다.
    expect(Sentry.init).toHaveBeenCalledWith({
      dsn: 'https://key@example.invalid/1',
      sendDefaultPii: false,
      beforeSend: expect.any(Function),
    });
  });
});

/**
 * TRIP-1650 · AC-W4-SEC-4 — 웹 오류 이벤트가 주소의 토큰 fragment 를 싣지 않는다.
 *
 * (개념) 웹에서 Sentry 는 오류가 날 때 지금 주소(`location.href`, `#access_token=…` 포함)를 이벤트 `request.url` 에 붙이고,
 *   주소가 바뀔 때마다(`history.replaceState` 포함) 내비 breadcrumb 의 `from`·`to` 에도 주소를 남긴다. 네이버 implicit 로그인 중에
 *   오류가 나면 토큰이 외부(Sentry)로 나갈 수 있어서, 이벤트가 나가기 직전(`beforeSend`)에 `#` 뒤를 지운다.
 *
 * 무엇을 보장하나: `init` 옵션의 `beforeSend` 가 이벤트의 `request.url` 과 breadcrumb `data.{from,to,url}` 에서 fragment 만 지우고
 *   (경로·쿼리는 보존), 지울 게 없는 이벤트는 그대로 돌려준다(드롭 금지 — 오류 수집이 끊기면 안 된다).
 * 커버하지 않는 것: 실 Sentry 가 이 필드들을 채우는지(02a §5 소스 확인), 쿼리스트링(`?code=`)·예외 메시지 본문의 스크럽.
 * 3동작: 준비(DSN·이벤트 픽스처) → 실행(init 옵션의 beforeSend 호출) → 단언(반환 이벤트).
 */
describe('initSentry — beforeSend 가 URL fragment 를 지운다 (AC-W4-SEC-4)', () => {
  // 테스트용 가짜 값 — 실제 토큰 아님.
  const TOKEN = 'SECRET-TOKEN-7Q2X';
  const WITH_FRAGMENT = `https://app.example/oauth/naver?a=1#access_token=${TOKEN}&state=s`;

  type BeforeSend = (event: unknown, hint: unknown) => unknown;

  async function scrub(event: unknown): Promise<unknown> {
    process.env.EXPO_PUBLIC_SENTRY_DSN = 'https://key@example.invalid/1';
    initSentry();
    const options = (Sentry.init as jest.Mock).mock.calls[0][0] as {
      beforeSend?: BeforeSend;
    };
    // 앵커 — 옵션에 beforeSend 가 없으면 아래 단언이 헛 통과하지 않도록 먼저 실패시킨다.
    expect(typeof options.beforeSend).toBe('function');
    return await options.beforeSend!(event, {});
  }

  it('request.url 의 fragment 를 지우고 경로·쿼리는 남긴다', async () => {
    const out = (await scrub({
      message: 'boom',
      request: { url: WITH_FRAGMENT, headers: { 'User-Agent': 'x' } },
    })) as { message: string; request: { url: string; headers: unknown } };

    expect(out.request.url).toBe('https://app.example/oauth/naver?a=1');
    expect(out.message).toBe('boom');
    expect(out.request.headers).toEqual({ 'User-Agent': 'x' });
  });

  it('내비게이션 breadcrumb 의 from·to·url 에서도 fragment 를 지운다 (replaceState 자체가 남기는 기록 포함)', async () => {
    const out = (await scrub({
      breadcrumbs: [
        {
          category: 'navigation',
          data: { from: WITH_FRAGMENT, to: 'https://app.example/oauth/naver' },
        },
        // expo-router 의 첫 replaceState 는 hash 를 유지한 채 주소만 정규화한다(04b 실측) — `to` 에도 토큰이 실린다.
        { category: 'navigation', data: { from: '/', to: WITH_FRAGMENT } },
        { category: 'xhr', data: { url: `${WITH_FRAGMENT}`, method: 'GET' } },
        { category: 'ui.click', message: 'button#login' },
      ],
    })) as {
      breadcrumbs: { data?: Record<string, string>; message?: string }[];
    };

    expect(out.breadcrumbs[0].data).toEqual({
      from: 'https://app.example/oauth/naver?a=1',
      to: 'https://app.example/oauth/naver',
    });
    expect(out.breadcrumbs[1].data).toEqual({
      from: '/',
      to: 'https://app.example/oauth/naver?a=1',
    });
    expect(out.breadcrumbs[2].data).toEqual({
      url: 'https://app.example/oauth/naver?a=1',
      method: 'GET',
    });
    // data 가 없는 breadcrumb·`#` 가 들어간 일반 문자열(message)은 건드리지 않는다.
    expect(out.breadcrumbs[3].message).toBe('button#login');
    expect(JSON.stringify(out)).not.toContain(TOKEN);
  });

  it('지울 것이 없는 이벤트는 같은 내용 그대로 돌려준다 (드롭하지 않는다)', async () => {
    const event = {
      message: 'plain',
      request: { url: 'https://app.example/home' },
      breadcrumbs: [{ category: 'navigation', data: { to: '/home' } }],
    };

    const out = await scrub(JSON.parse(JSON.stringify(event)));

    expect(out).toEqual(event);
  });

  it('request·breadcrumbs 가 없는 이벤트(네이티브)도 그대로 돌려준다', async () => {
    const out = await scrub({ message: 'native crash' });

    expect(out).toEqual({ message: 'native crash' });
  });
});
