import { Platform } from 'react-native';
import * as Sentry from '@sentry/react-native';

import { sandboxEnv } from '@/test-support/envSandbox';

import { initSentry } from './initSentry';

// TRIP-1743 — init 만 있던 인라인 목으로는 새 호출(reactNavigationIntegration·reactNativeTracingIntegration)이 TypeError 라 공용 대역으로 바꿨다.
jest.mock('@sentry/react-native', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@/test-support/sentryReactNativeMock')
);

const original = process.env.EXPO_PUBLIC_SENTRY_DSN;
const SAMPLE_RATE_KEY = 'EXPO_PUBLIC_SENTRY_TRACES_SAMPLE_RATE';

// 샘플링 env 는 테스트마다 비우고 되돌린다(파일 최상위 — 개발자 셸에 값이 있어도 새지 않게).
sandboxEnv([SAMPLE_RATE_KEY], { clearBefore: true });

// 플랫폼은 읽는 쪽이 "호출 때" 봐야 바꿀 수 있다(모듈 로드 때 굳히면 웹 케이스가 red). jest-expo 기본은 ios(실측)라 네이티브 케이스는 그대로 두고,
// 웹 케이스만 `asWeb()` 으로 바꾼다. 이미 바꾼 속성을 또 바꾸지 않도록 핸들은 하나만 쥔다.
let replacedPlatform: { restore: () => void } | null = null;
function asWeb(): void {
  replacedPlatform = jest.replaceProperty(Platform, 'OS', 'web');
}

afterEach(() => {
  replacedPlatform?.restore();
  replacedPlatform = null;
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

  // TRIP-1743 개정 — 옛 단언은 3키 정확 일치(dsn·sendDefaultPii·beforeSend)였다. 네이티브는 추적 키가 늘어난 새 집합으로 다시 정확 일치시키고,
  // 옛 3키는 웹 케이스(아래 「웹」 describe)가 그대로 이어받는다. 완화(objectContaining)하지 않는다 — 키가 몰래 늘면 여기서 red.
  it('DSN 이 있으면 개인정보 전송 없이 init 한다 (네이티브: 추적 키까지 정확 일치)', () => {
    expect(Platform.OS).toBe('ios'); // 앵커 — 기본 플랫폼이 네이티브가 아니면 아래가 웹 분기를 본 것이다.
    process.env.EXPO_PUBLIC_SENTRY_DSN = 'https://key@example.invalid/1';
    initSentry();
    expect(Sentry.init).toHaveBeenCalledTimes(1);
    // 옵션 키 집합을 고정한다(TRIP-1650 5-b 보강) — 추적·리플레이 옵션이 몰래 켜지면 그 이벤트는 beforeSend 를 거치지 않아
    // URL 스크럽 밖으로 나간다. 옵션을 늘리려면 이 단언을 함께 고쳐 스크럽 범위를 다시 판단하게 한다.
    const options = (Sentry.init as jest.Mock).mock.calls[0][0] as Record<
      string,
      unknown
    >;
    // toHaveBeenCalledWith 는 값이 undefined 인 여분 키를 같다고 보므로(실측) 키 목록을 따로 정확 비교한다.
    expect(Object.keys(options).sort()).toEqual([
      'beforeSend',
      'beforeSendTransaction',
      'dsn',
      'integrations',
      'sendDefaultPii',
      'tracePropagationTargets',
      'tracesSampleRate',
    ]);
    expect(options).toEqual({
      dsn: 'https://key@example.invalid/1',
      sendDefaultPii: false,
      beforeSend: expect.any(Function),
      beforeSendTransaction: expect.any(Function),
      tracesSampleRate: 0.2,
      tracePropagationTargets: [],
      integrations: expect.any(Array),
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

/**
 * TRIP-1743 · M-2 — 성능 추적(앱 시작·화면 이동·프레임)은 네이티브에서 DSN 이 있을 때만 켜지고, 켜졌어도 네트워크 요청·헤더는 건드리지 않는다.
 *
 * (개념) 트랜잭션 = Sentry 가 "화면 하나 이동" 같은 한 동작의 시작~끝을 재서 보내는 묶음, 스팬 = 그 안의 단계. 오류 이벤트와 달리
 *   `beforeSend` 를 거치지 않고 `beforeSendTransaction` 을 거친다. 통합(integration) = init 에 끼우는 SDK 부품 — 화면 이동 트랜잭션은
 *   `reactNavigationIntegration` 을 직접 끼워야 생긴다.
 *
 * 무엇을 보장하나: ① DSN 이 없으면 init 도 통합 생성도 없다(null 을 돌려준다) ② 웹은 지금처럼 3키 + null ③ 네이티브는 네비게이션 통합(첫 화면 표시
 *   시간 켬)과 XHR·fetch 를 끈 추적 통합을 만들어 init 에 싣고 네비게이션 통합을 돌려준다 ④ 샘플링 비율은 env 가 0~1 숫자일 때만 따르고 아니면 0.2.
 * 커버하지 않는 것: 실제 트랜잭션이 나가는지·이름·프레임 값·앱 시작이 첫 화면 트랜잭션에 얹히는지(6-b 시뮬 + Sentry 조회), 부팅 비용(bench).
 * 3동작: 준비(DSN·플랫폼·env) → 실행(initSentry) → 단언(init 옵션·통합 호출·반환값).
 */
describe('initSentry — 추적 (TRIP-1743)', () => {
  const DSN = 'https://key@example.invalid/1';
  type Options = Record<string, unknown>;

  const initOptions = () =>
    (Sentry.init as jest.Mock).mock.calls[0][0] as Options;

  describe('B3 · DSN 이 없으면 아무것도 만들지 않는다', () => {
    it.each<[string, string | undefined]>([
      ['없음', undefined],
      ['빈 문자열', ''],
    ])(
      'DSN %s → init·네비게이션 통합·추적 통합·wrap 0회, null 반환',
      (_label, dsn) => {
        if (dsn === undefined) delete process.env.EXPO_PUBLIC_SENTRY_DSN;
        else process.env.EXPO_PUBLIC_SENTRY_DSN = dsn;

        const result = initSentry();

        expect(result).toBeNull();
        expect(Sentry.init).not.toHaveBeenCalled();
        // 통합 생성 자체가 부작용이라(첫 화면 표시 추적이면 네이티브 호출) DSN 없이 만들어지면 안 된다.
        expect(Sentry.reactNavigationIntegration).not.toHaveBeenCalled();
        expect(Sentry.reactNativeTracingIntegration).not.toHaveBeenCalled();
        expect(Sentry.wrap).not.toHaveBeenCalled();
      }
    );
  });

  describe('B1w · 웹은 오류 수집만 — 옵션은 TRIP-1742 그대로', () => {
    it('DSN 이 있어도 웹이면 3키(dsn·sendDefaultPii·beforeSend)만 싣고 추적 통합을 만들지 않으며 null 을 돌려준다', () => {
      asWeb();
      process.env.EXPO_PUBLIC_SENTRY_DSN = DSN;

      const result = initSentry();

      expect(result).toBeNull();
      expect(Sentry.init).toHaveBeenCalledTimes(1);
      const options = initOptions();
      expect(Object.keys(options).sort()).toEqual([
        'beforeSend',
        'dsn',
        'sendDefaultPii',
      ]);
      expect(options).toEqual({
        dsn: DSN,
        sendDefaultPii: false,
        beforeSend: expect.any(Function),
      });
      expect(Sentry.reactNavigationIntegration).not.toHaveBeenCalled();
      expect(Sentry.reactNativeTracingIntegration).not.toHaveBeenCalled();
      expect(Sentry.wrap).not.toHaveBeenCalled();
    });
  });

  describe('B1 · 네이티브 통합 구성', () => {
    it('네비게이션 통합(첫 화면 표시 시간 켬)과 XHR·fetch 를 끈 추적 통합을 한 번씩 만들어 init 에 싣고, 네비게이션 통합을 돌려준다', () => {
      process.env.EXPO_PUBLIC_SENTRY_DSN = DSN;

      const result = initSentry();

      // 인자는 개인정보·헤더에 걸린 값만 고정한다(objectContaining) — 6-b 에서 시작 시각 튜닝 키(routeChangeTimeoutMs 등)가 더해질 수 있다.
      expect(Sentry.reactNavigationIntegration).toHaveBeenCalledTimes(1);
      expect(Sentry.reactNavigationIntegration).toHaveBeenCalledWith(
        expect.objectContaining({ enableTimeToInitialDisplay: true })
      );
      // XHR·fetch 스팬을 켜면 스팬 설명에 경로 id 가 실리고 모든 요청에 추적 헤더가 붙는다(브리프 맹점 3·4).
      expect(Sentry.reactNativeTracingIntegration).toHaveBeenCalledTimes(1);
      expect(Sentry.reactNativeTracingIntegration).toHaveBeenCalledWith(
        expect.objectContaining({ traceXHR: false, traceFetch: false })
      );

      const navigation = (Sentry.reactNavigationIntegration as jest.Mock).mock
        .results[0].value;
      const tracing = (Sentry.reactNativeTracingIntegration as jest.Mock).mock
        .results[0].value;
      const integrations = initOptions().integrations as unknown[];
      // 순서·개수는 계약이 아니다 — 두 객체가 (참조 그대로) 들어 있기만 하면 된다. 6-b 의 D4 수정 루프가 앱 시작 통합(`appStartIntegration`)을
      // 같은 배열에 더해도 이 테스트는 그대로 green 이어야 한다(키 집합 정확 일치는 위 TRIP-935 케이스가 지킨다).
      expect(integrations).toContain(navigation);
      expect(integrations).toContain(tracing);

      expect(result).not.toBeNull();
      expect(result?.navigation).toBe(navigation);
      expect(Object.keys(result as object)).toEqual(['navigation']);
    });

    it('init 은 한 번만 부르고, wrap 은 부르지 않는다 (wrap 은 렌더 쪽 SentryRoot 몫)', () => {
      process.env.EXPO_PUBLIC_SENTRY_DSN = DSN;

      initSentry();

      expect(Sentry.init).toHaveBeenCalledTimes(1);
      expect(Sentry.wrap).not.toHaveBeenCalled();
    });
  });

  describe('B4 · 샘플링 비율 env (EXPO_PUBLIC_SENTRY_TRACES_SAMPLE_RATE)', () => {
    // '' 와 ' ' 는 Number() 가 0 으로 읽는 함정(실측) — 0 이 아니라 기본값이어야 한다.
    it.each<[string | undefined, number]>([
      [undefined, 0.2],
      ['1', 1],
      ['0.05', 0.05],
      ['0', 0],
      ['0.5', 0.5],
      ['2', 0.2],
      ['1.5', 0.2],
      ['-0.1', 0.2],
      ['abc', 0.2],
      ['', 0.2],
      [' ', 0.2], // 5-b W1 — 공백만 있는 값도 0(추적 꺼짐)이 아니라 기본값
      ['NaN', 0.2],
      ['Infinity', 0.2],
    ])('env=%j → tracesSampleRate %p', (raw, expected) => {
      process.env.EXPO_PUBLIC_SENTRY_DSN = DSN;
      if (raw !== undefined) process.env[SAMPLE_RATE_KEY] = raw;

      initSentry();

      expect(initOptions().tracesSampleRate).toBe(expected);
    });
  });
});

/**
 * TRIP-1743 · B2 — 성능 이벤트(트랜잭션)도 오류와 같은 스크러버를 거친다.
 *
 * (개념) 트랜잭션 이벤트의 `transaction`(이름)·`spans[].description`/`data`(단계 설명·부가 값)·`contexts.trace.data` 에도 주소·이메일·좌표가
 *   실릴 수 있다. 오류용 `beforeSend` 는 트랜잭션을 거치지 않으므로 `beforeSendTransaction` 에 같은 스크러버를 건다.
 *
 * 무엇을 보장하나: 위 칸들의 토큰·이메일·좌표가 `[Filtered]` 로 바뀌고, 민감하지 않은 값(라우트 이름·op·id·시각·측정값)은 그대로이며,
 *   이벤트는 버리지 않고(null 금지 — 성능 수집이 끊기면 안 된다) 모양이 이상해도 던지지 않는다.
 * 커버하지 않는 것: 실 SDK 가 이 칸들을 어떻게 채우는지(6-b 에서 실제로 나간 트랜잭션을 조회해 확인).
 * 3동작: 준비(DSN·트랜잭션 픽스처) → 실행(init 옵션의 beforeSendTransaction 호출) → 단언(반환 이벤트).
 */
describe('initSentry — beforeSendTransaction 스크러빙 (TRIP-1743 B2)', () => {
  // 테스트용 가짜 값 — 실제 토큰·이메일·좌표 아님.
  const TOKEN = 'SECRET-TOKEN-7Q2X';
  const EMAIL = 'traveler@example.com';
  const LAT = 37.5665;

  type Hook = (event: unknown, hint: unknown) => unknown;
  type Dirty = {
    transaction: string;
    spans: {
      description?: string;
      data?: Record<string, unknown>;
      [k: string]: unknown;
    }[];
    contexts: { trace: { data: Record<string, unknown>; op: string } };
    measurements: unknown;
  };

  function hooks(): { beforeSend: Hook; beforeSendTransaction: Hook } {
    process.env.EXPO_PUBLIC_SENTRY_DSN = 'https://key@example.invalid/1';
    initSentry();
    const options = (Sentry.init as jest.Mock).mock.calls[0][0] as {
      beforeSend?: Hook;
      beforeSendTransaction?: Hook;
    };
    // 앵커 — 훅이 없으면 아래 단언이 헛 통과하지 않도록 먼저 실패시킨다.
    expect(typeof options.beforeSendTransaction).toBe('function');
    return {
      beforeSend: options.beforeSend!,
      beforeSendTransaction: options.beforeSendTransaction!,
    };
  }

  async function scrubTransaction(event: unknown): Promise<unknown> {
    return await hooks().beforeSendTransaction(event, {});
  }

  it('T1 · 이름·스팬 설명·스팬 데이터·trace 컨텍스트의 토큰·이메일·좌표를 지우고 나머지는 남긴다', async () => {
    const out = (await scrubTransaction({
      type: 'transaction',
      transaction: `/share/${EMAIL}?access_token=${TOKEN}`,
      spans: [
        {
          op: 'http.client',
          span_id: 'a1',
          start_timestamp: 1,
          timestamp: 2,
          description: `GET https://api.example/places?lat=${LAT}&lng=127.0&access_token=${TOKEN}&limit=20`,
          data: {
            'http.query': `?code=${TOKEN}&limit=20`,
            url: `https://api.example/cb#access_token=${TOKEN}`,
            email: EMAIL,
            lat: LAT,
            'route.name': 'places/[placeId]',
          },
        },
        { op: 'ui.load', description: 'app start', data: { 'frames.slow': 3 } },
      ],
      contexts: {
        trace: {
          op: 'navigation',
          data: { email: EMAIL, lat: LAT, 'route.name': 'x' },
        },
      },
      measurements: { frames_slow: { value: 3, unit: 'none' } },
    })) as Dirty | null;

    expect(out).not.toBeNull();
    const event = out as Dirty;
    const text = JSON.stringify(event);
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain(EMAIL);
    expect(text).not.toContain(String(LAT));

    expect(event.transaction).toBe('/share/[Filtered]?access_token=[Filtered]');
    const [http, load] = event.spans;
    expect(http.description).toBe(
      'GET https://api.example/places?lat=[Filtered]&lng=[Filtered]&access_token=[Filtered]&limit=20'
    );
    expect(http.data).toMatchObject({
      'http.query': '?code=[Filtered]&limit=20',
      email: '[Filtered]',
      lat: '[Filtered]',
      'route.name': 'places/[placeId]',
    });
    // 주소 fragment 는 통째로 떼든 값만 지우든 구현 몫 — 토큰이 없고 앞 경로가 남았는지만 본다.
    expect(String(http.data?.url)).toMatch(/^https:\/\/api\.example\/cb/);
    // 안 민감한 필드·다른 스팬은 그대로.
    expect(http).toMatchObject({
      op: 'http.client',
      span_id: 'a1',
      start_timestamp: 1,
      timestamp: 2,
    });
    expect(load).toEqual({
      op: 'ui.load',
      description: 'app start',
      data: { 'frames.slow': 3 },
    });
    expect(event.contexts.trace).toEqual({
      op: 'navigation',
      data: { email: '[Filtered]', lat: '[Filtered]', 'route.name': 'x' },
    });
    expect(event.measurements).toEqual({
      frames_slow: { value: 3, unit: 'none' },
    });
  });

  it('T2 · 지울 게 없는 트랜잭션은 같은 내용 그대로 돌려준다 (null 로 버리지 않는다)', async () => {
    const event = {
      type: 'transaction',
      transaction: '(tabs)/trips/[tripId]/itinerary',
      spans: [
        {
          op: 'ui.load',
          description: 'Cold App Start',
          span_id: 'b1',
          data: { 'frames.slow': 0 },
        },
      ],
      contexts: { trace: { op: 'navigation', data: { 'route.name': 'x' } } },
      measurements: { frames_total: { value: 120, unit: 'none' } },
    };

    const out = await scrubTransaction(JSON.parse(JSON.stringify(event)));

    expect(out).toEqual(event);
  });

  it('T3 · spans 모양이 이상해도 던지지 않고, 뒤 칸(contexts)의 토큰은 지운다', async () => {
    const out = (await scrubTransaction({
      type: 'transaction',
      transaction: 'x',
      spans: 'oops',
      contexts: { trace: { data: { access_token: TOKEN } } },
    })) as { contexts: { trace: { data: { access_token: string } } } } | null;

    expect(out).not.toBeNull();
    expect(out?.contexts.trace.data.access_token).toBe('[Filtered]');
    // spans 가 아예 없거나 비어 있어도 던지지 않는다.
    await expect(
      scrubTransaction({ type: 'transaction', transaction: 'y' })
    ).resolves.toEqual({ type: 'transaction', transaction: 'y' });
    await expect(
      scrubTransaction({ type: 'transaction', transaction: 'z', spans: [] })
    ).resolves.toEqual({ type: 'transaction', transaction: 'z', spans: [] });
  });

  it('T4 · 오류용 beforeSend 와 같은 스크러버다 — 같은 입력이 두 길에서 같게 지워진다', async () => {
    const make = () => ({
      extra: { token: TOKEN, note: `mail ${EMAIL} Bearer abc.def` },
      contexts: { app: { email: EMAIL, status: 500 } },
    });
    const { beforeSend, beforeSendTransaction } = hooks();

    const asError = await beforeSend(make(), {});
    const asTransaction = await beforeSendTransaction(make(), {});

    expect(asTransaction).toEqual(asError);
    // 앵커 — 둘 다 아무것도 안 지운 채 같아지는 헛 통과 차단.
    expect(JSON.stringify(asTransaction)).not.toContain(TOKEN);
    expect(JSON.stringify(asTransaction)).not.toContain(EMAIL);
  });
});
