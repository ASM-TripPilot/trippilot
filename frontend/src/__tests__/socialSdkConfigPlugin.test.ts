/**
 * @jest-environment node
 */

/**
 * TRIP-210 · config plugin 등록 계약 — 네이티브 빌드 설정 2줄에 심판을 세운다.
 *
 * *(개념)* **config plugin**: Expo 가 앱을 빌드할 때 iOS/Android 네이티브 설정 파일
 * (Info.plist·AppDelegate 등)을 자동으로 고쳐주는 장치다. 카카오·네이버 로그인은 "로그인 창에
 * 다녀온 뒤 앱으로 되돌아오는 통로(URL scheme)"를 네이티브에 등록해야 동작하는데, 그 등록을
 * `app.config.ts` 의 plugins 항목이 한다. **여기가 틀리면 로그인 창은 뜨는데 앱으로 못
 * 돌아온다** — 사용자에겐 "로그인하고 나면 앱이 멈춘 것처럼" 보인다.
 *
 * 왜 이 심판이 필요한가(code-critic 뮤테이션 C): 옵션 이름을 오타 내고 카카오·네이버 값을
 * 서로 바꿔도 **jest·tsc·eslint 가 전부 통과했다.** Expo 의 `plugins` 배열 타입이 `[string, any]`
 * 라 TypeScript 가 옵션 키를 검사하지 않기 때문이다. 그리고 이 결함은 **실기에서만 드러나는데,
 * 실기는 콘솔 등록이 갖춰져야 돌아간다** — 즉 지금은 아무도 못 본다.
 *
 * `app.config.ts` 는 평범한 TS 모듈이라 그냥 import 해서 배열을 단언하면 된다(실기 불필요).
 * 다만 키 값을 **모듈 최상단에서 env 로 읽으므로**, env 를 먼저 심고 `jest.isolateModules` 로
 * 새로 로드해야 주입한 값이 반영된다(캐시된 모듈은 로드 시점 env 를 그대로 갖고 있다).
 *
 * 3동작: 준비(서로 다른 표식 env 주입 + 재로드) → 실행(plugins 배열에서 항목 찾기) → 단언.
 */

const KAKAO_PLUGIN = '@react-native-seoul/kakao-login';
const NAVER_PLUGIN = '@react-native-seoul/naver-login';

/**
 * 표식 값을 **서로 다르게** 둔다 — 값 교차(카카오 자리에 네이버 값이 들어가는 배선 실수)는
 * 두 값이 달라야만 관측된다. 같은 값이면 교차해도 단언이 통과한다.
 */
const KAKAO_KEY_MARKER = 'kakao-native-app-key-marker';
const NAVER_SCHEME_MARKER = 'naver-url-scheme-marker';

/**
 * 각 플러그인이 **실제로 받는** props. 패키지 타입 정의 실측이다
 * (kakao `plugins/index.d.ts` → `kakaoAppKey`·`overrideKakaoSDKVersion?` /
 *  naver `plugin/build/index.d.ts` → `urlScheme`).
 * 이름이 이 목록과 다르면 플러그인이 그 값을 **조용히 무시**하고 `undefined` 로 빌드한다.
 */
const KAKAO_ALLOWED_PROPS = ['kakaoAppKey', 'overrideKakaoSDKVersion'];
const NAVER_ALLOWED_PROPS = ['urlScheme'];

type PluginEntry = string | [string, Record<string, unknown>?];

const ENV_KEYS = [
  'EXPO_PUBLIC_KAKAO_NATIVE_APP_KEY',
  'EXPO_PUBLIC_NAVER_URL_SCHEME',
] as const;

const ORIGINAL_ENV: Record<string, string | undefined> = {};
for (const key of ENV_KEYS) {
  ORIGINAL_ENV[key] = process.env[key];
}

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (ORIGINAL_ENV[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = ORIGINAL_ENV[key];
    }
  }
});

/** 표식 env 를 심고 app.config.ts 를 새로 로드한다(모듈 캐시 우회). */
function loadPlugins(): PluginEntry[] {
  process.env.EXPO_PUBLIC_KAKAO_NATIVE_APP_KEY = KAKAO_KEY_MARKER;
  process.env.EXPO_PUBLIC_NAVER_URL_SCHEME = NAVER_SCHEME_MARKER;

  let plugins: PluginEntry[] = [];
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const config = require('../../app.config').default as {
      plugins?: PluginEntry[];
    };
    plugins = config.plugins ?? [];
  });
  return plugins;
}

/** 튜플 형태(`[이름, 옵션]`)로 등록된 항목의 옵션 객체. 문자열 단독 등록이면 undefined. */
function optionsOf(
  plugins: PluginEntry[],
  name: string
): Record<string, unknown> | undefined {
  const entry = plugins.find(
    (item): item is [string, Record<string, unknown>?] =>
      Array.isArray(item) && item[0] === name
  );
  return entry?.[1];
}

describe('config plugin 등록 — 두 SDK 가 옵션과 함께 plugins 에 있다', () => {
  it('카카오·네이버 플러그인이 각각 튜플 형태로 등록돼 있고, 옵션 키가 패키지가 받는 이름과 일치한다', () => {
    const plugins = loadPlugins();

    // 도달 앵커 — plugins 배열을 실제로 읽었다.
    expect(plugins.length).toBeGreaterThan(0);

    const kakaoOptions = optionsOf(plugins, KAKAO_PLUGIN);
    const naverOptions = optionsOf(plugins, NAVER_PLUGIN);

    // 긍정 — 둘 다 **옵션과 함께** 등록돼 있다. 문자열 단독(`'@react-native-seoul/…'`)으로
    // 등록하면 옵션이 undefined 라 플러그인이 키 없이 돌아간다 → 여기서 undefined 로 잡힌다.
    expect(kakaoOptions).toBeDefined();
    expect(naverOptions).toBeDefined();

    // 본체 — 옵션 키 이름. 오타(`appKey`·`scheme`)는 tsc 가 못 잡으므로 여기서 잡는다.
    expect(Object.keys(kakaoOptions ?? {})).toContain('kakaoAppKey');
    expect(Object.keys(naverOptions ?? {})).toContain('urlScheme');

    // 본체 — 패키지가 모르는 키가 섞이지 않았다(오타는 "모르는 키"로 나타난다).
    expect(
      Object.keys(kakaoOptions ?? {}).filter(
        (key) => !KAKAO_ALLOWED_PROPS.includes(key)
      )
    ).toEqual([]);
    expect(
      Object.keys(naverOptions ?? {}).filter(
        (key) => !NAVER_ALLOWED_PROPS.includes(key)
      )
    ).toEqual([]);
  });

  it('각 옵션 값이 자기 provider 의 env 에서 오고, 카카오·네이버 값이 서로 뒤바뀌지 않았다', () => {
    const plugins = loadPlugins();
    const kakaoOptions = optionsOf(plugins, KAKAO_PLUGIN) ?? {};
    const naverOptions = optionsOf(plugins, NAVER_PLUGIN) ?? {};

    // 본체(값 출처) — 주입한 표식이 그대로 나오면 그 env 를 읽었다는 뜻이다. 리터럴을
    // 박아 넣었거나 다른 변수를 읽으면 표식과 달라져 즉시 red 다.
    expect(kakaoOptions.kakaoAppKey).toBe(KAKAO_KEY_MARKER);
    expect(naverOptions.urlScheme).toBe(NAVER_SCHEME_MARKER);

    // 본체(교차 배선) — 카카오 자리에 네이버 값이, 네이버 자리에 카카오 값이 들어가는
    // 실수를 잡는다. 위 두 단언으로도 잡히지만, 실패했을 때 **무엇이 잘못됐는지**를
    // 이 단언이 이름으로 말해준다(교차인지 단순 오타인지 구분된다).
    expect(Object.values(kakaoOptions)).not.toContain(NAVER_SCHEME_MARKER);
    expect(Object.values(naverOptions)).not.toContain(KAKAO_KEY_MARKER);
  });
});
