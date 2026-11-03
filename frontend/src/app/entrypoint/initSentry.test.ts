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
 * 커버하지 않는 것: 실 Sentry 가 이 필드들을 채우는지(02a §5 소스 확인). 쿼리스트링(`?code=`)·예외 메시지 본문의 스크럽은
 *   아래 TRIP-1742 describe 가 본다.
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

/**
 * TRIP-1742 · M-1 — beforeSend 가 토큰·개인정보를 지운다(README 「토큰: 크래시 리포트 미포함」의 집행 지점).
 *
 * (개념) 스크러빙 = 이벤트가 Sentry 로 나가기 직전에 민감한 값을 `[Filtered]` 로 바꾸는 것. 이벤트는 버리지 않고(오류 수집 유지)
 *   민감한 "값"만 바꾼다. 어디에 토큰이 실릴 수 있나: 주소의 쿼리(`?access_token=…`), 오류 문구(`Bearer …`·이메일),
 *   이벤트에 붙은 부가 정보 객체(`extra`·`contexts`·breadcrumb `data`).
 * 무엇을 보장하나: 민감 키의 값만 지우고 나머지(쿼리 `page=2`·경로·오류 문구 앞뒤)는 글자 그대로 남는다. 객체의 `code`(오류 코드)는
 *   남기고 쿼리의 `code`(OAuth 인가 코드)는 지운다. 이상한 모양(순환 참조·던지는 getter)에도 던지지 않고 이벤트를 돌려준다.
 * 3동작: 준비(이벤트 픽스처) → 실행(init 옵션의 beforeSend 호출) → 단언(반환 이벤트를 글자 단위로).
 */
describe('initSentry — beforeSend 토큰·PII 스크러빙 (TRIP-1742)', () => {
  // 테스트용 가짜 값 — 실제 토큰 아님.
  const TOKEN = 'SECRET-TOKEN-9K4M';
  const F = '[Filtered]';

  type BeforeSend = (event: unknown, hint: unknown) => unknown;

  async function scrub<T>(event: unknown): Promise<T> {
    process.env.EXPO_PUBLIC_SENTRY_DSN = 'https://key@example.invalid/1';
    initSentry();
    const options = (Sentry.init as jest.Mock).mock.calls[0][0] as {
      beforeSend?: BeforeSend;
    };
    expect(typeof options.beforeSend).toBe('function');
    return (await options.beforeSend!(event, {})) as T;
  }

  it('S1 · request.url 의 민감 쿼리 값만 지우고 다른 쿼리·경로는 남긴다 (fragment 제거는 그대로)', async () => {
    const out = await scrub<{ request: { url: string } }>({
      request: {
        url: `https://a.example/p?access_token=${TOKEN}&page=2#frag`,
      },
    });

    expect(out.request.url).toBe(
      `https://a.example/p?access_token=${F}&page=2`
    );
  });

  it('S2 · breadcrumb from·to·url 의 code·refresh_token·위치 쿼리를 지운다', async () => {
    const out = await scrub<{
      breadcrumbs: { data: Record<string, string> }[];
    }>({
      breadcrumbs: [
        {
          category: 'navigation',
          data: {
            from: `/oauth/kakao?code=${TOKEN}&region=seoul`,
            to: `https://a.example/r?refresh_token=${TOKEN}`,
          },
        },
        {
          category: 'xhr',
          data: {
            url: `https://api.example/v1/places?lat=37.5&lng=127.0&q=x`,
            method: 'GET',
          },
        },
      ],
    });

    expect(out.breadcrumbs[0].data).toEqual({
      from: `/oauth/kakao?code=${F}&region=seoul`,
      to: `https://a.example/r?refresh_token=${F}`,
    });
    expect(out.breadcrumbs[1].data).toEqual({
      url: `https://api.example/v1/places?lat=${F}&lng=${F}&q=x`,
      method: 'GET',
    });
    expect(JSON.stringify(out)).not.toContain(TOKEN);
  });

  it('S3 · request.query_string 의 세 모양(문자열·객체·쌍 배열)을 모양 그대로 두고 민감 값만 지운다', async () => {
    const asString = await scrub<{ request: { query_string: string } }>({
      request: { query_string: `access_token=${TOKEN}&page=2` },
    });
    const asObject = await scrub<{ request: { query_string: object } }>({
      request: { query_string: { id_token: TOKEN, page: '2' } },
    });
    const asPairs = await scrub<{ request: { query_string: unknown } }>({
      request: {
        query_string: [
          ['password', TOKEN],
          ['page', '2'],
        ],
      },
    });

    expect(asString.request.query_string).toBe(`access_token=${F}&page=2`);
    expect(asObject.request.query_string).toEqual({ id_token: F, page: '2' });
    expect(asPairs.request.query_string).toEqual([
      ['password', F],
      ['page', '2'],
    ]);
  });

  it('S4 · fetch/xhr breadcrumb 의 http.query 민감 값과 http.fragment 를 지운다', async () => {
    const out = await scrub<{
      breadcrumbs: { data: Record<string, string> }[];
    }>({
      breadcrumbs: [
        {
          category: 'fetch',
          data: {
            url: 'https://api.example/v1/me',
            'http.query': '?email=a@b.co&page=2',
            'http.fragment': `#access_token=${TOKEN}`,
            status_code: 200,
          },
        },
      ],
    });

    expect(out.breadcrumbs[0].data).toEqual({
      url: 'https://api.example/v1/me',
      'http.query': `?email=${F}&page=2`,
      'http.fragment': F,
      status_code: 200,
    });
  });

  it('S5 · 오류 문구 속 Bearer 토큰·이메일·JWT·민감 쿼리 부분만 지우고 앞뒤 글은 남긴다', async () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl';
    const out = await scrub<{
      message: string;
      logentry: { message: string };
      exception: { values: { type: string; value: string }[] };
      breadcrumbs: { message: string }[];
    }>({
      message: `auth failed Bearer ${TOKEN}`,
      logentry: { message: `token refresh: bearer ${TOKEN} rejected` },
      exception: {
        values: [
          { type: 'Error', value: 'user a.b@example.com not found' },
          {
            type: 'AxiosError',
            value: `GET /x?access_token=${TOKEN}&page=2 failed`,
          },
        ],
      },
      breadcrumbs: [{ category: 'console', message: `session ${jwt} expired` }],
    });

    expect(out.message).toBe(`auth failed Bearer ${F}`);
    expect(out.logentry.message).toBe(`token refresh: bearer ${F} rejected`);
    expect(out.exception.values[0]).toEqual({
      type: 'Error',
      value: `user ${F} not found`,
    });
    expect(out.exception.values[1].value).toBe(
      `GET /x?access_token=${F}&page=2 failed`
    );
    expect(out.breadcrumbs[0].message).toBe(`session ${F} expired`);
    expect(JSON.stringify(out)).not.toContain(TOKEN);
  });

  it('S6 · extra·contexts 의 민감 키 값을 깊이 들어가 지우고, 오류 코드 code·status 는 남긴다', async () => {
    const out = await scrub<{ extra: unknown; contexts: unknown }>({
      extra: {
        Authorization: `Bearer ${TOKEN}`,
        nested: { refreshToken: TOKEN, list: [{ email: 'a@b.co', id: 7 }] },
        code: 'ERR_NETWORK',
        status: 500,
      },
      contexts: { app: { pushToken: TOKEN, name: 'TripPilot' } },
    });

    expect(out.extra).toEqual({
      Authorization: F,
      nested: { refreshToken: F, list: [{ email: F, id: 7 }] },
      code: 'ERR_NETWORK',
      status: 500,
    });
    expect(out.contexts).toEqual({ app: { pushToken: F, name: 'TripPilot' } });
  });

  it('S7 · 순환 참조·던지는 getter 가 있어도 던지지 않고 이벤트를 돌려주며, 다른 칸의 토큰은 그대로 지운다', async () => {
    const extra: Record<string, unknown> = { ok: 1 };
    extra.self = extra;
    Object.defineProperty(extra, 'boom', {
      enumerable: true,
      get() {
        throw new Error('getter boom');
      },
    });

    const out = await scrub<{ message: string } | null | undefined>({
      message: `Bearer ${TOKEN}`,
      extra,
    });

    expect(out).not.toBeNull();
    expect(out).not.toBeUndefined();
    expect(out!.message).toBe(`Bearer ${F}`);
  });

  // 5-b W2 보강 — 키 하나가 던져도 같은 객체의 **뒤** 키는 계속 지운다(키별 try 를 겨눈다).
  it('S7b · 던지는 getter 뒤에 있는 민감 키도 지운다', async () => {
    const extra: Record<string, unknown> = {};
    Object.defineProperty(extra, 'boom', {
      enumerable: true,
      get() {
        throw new Error('getter boom');
      },
    });
    extra.Authorization = `Bearer ${TOKEN}`;
    extra.password = TOKEN;

    const out = await scrub<{ extra: Record<string, unknown> }>({ extra });

    expect(out.extra.Authorization).toBe(F);
    expect(out.extra.password).toBe(F);
  });

  // 5-b W2 보강 — 한 칸(예외 목록)이 모양이 이상해 던져도 다음 칸(extra)은 계속 지운다(칸별 safely 를 겨눈다).
  it('S7c · 예외 목록 모양이 이상해도 뒤 칸의 토큰을 지운다', async () => {
    const out = await scrub<{ extra: { password: string } }>({
      exception: { values: 5 },
      extra: { password: TOKEN },
    });

    expect(out.extra.password).toBe(F);
  });

  // 5-b W1·W3 보강 — request.data(문자열·객체)·request.headers·breadcrumb data 의 민감 키.
  it('S10 · request.data(폼 문자열·객체)·request.headers·breadcrumb data 의 민감 값을 지운다', async () => {
    const asForm = await scrub<{ request: { data: string } }>({
      request: { data: `access_token=${TOKEN}&page=2` },
    });
    const asObject = await scrub<{
      request: { data: unknown; headers: unknown };
      breadcrumbs: { data: unknown }[];
    }>({
      request: {
        data: { refresh_token: TOKEN, nickname: 'trip' },
        headers: { Authorization: `Bearer ${TOKEN}`, 'User-Agent': 'x' },
      },
      breadcrumbs: [
        {
          category: 'xhr',
          data: {
            Authorization: `Bearer ${TOKEN}`,
            method: 'POST',
            email: 'a@b.co',
          },
        },
      ],
    });

    expect(asForm.request.data).toBe(`access_token=${F}&page=2`);
    expect(asObject.request.data).toEqual({
      refresh_token: F,
      nickname: 'trip',
    });
    expect(asObject.request.headers).toEqual({
      Authorization: F,
      'User-Agent': 'x',
    });
    expect(asObject.breadcrumbs[0].data).toEqual({
      Authorization: F,
      method: 'POST',
      email: F,
    });
  });

  it('S9 · 민감하지 않은 쿼리만 있는 주소는 바이트 그대로 둔다 (다시 인코딩하지 않는다)', async () => {
    const url = 'https://a.example/places?page=2&q=%EC%84%9C%EC%9A%B8&tag=a+b';
    const out = await scrub<{ request: { url: string } }>({ request: { url } });

    expect(out.request.url).toBe(url);
  });
});
