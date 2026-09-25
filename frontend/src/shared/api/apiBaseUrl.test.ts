/**
 * @jest-environment node
 */

/**
 * TRIP-936 · API 주소 env 가 없는 운영 빌드는 localhost 로 조용히 폴백하지 말고 드러나게
 * 실패한다(INV-4). localhost 폴백은 개발 빌드(`__DEV__`)에서만 허용한다.
 *
 * jest 의 `__DEV__` 는 항상 true 라 운영 분기는 직접 false 로 뒤집어야 실행된다. 주소는 모듈
 * 최상단에서 한 번 계산되므로, 값을 바꾼 뒤 `jest.isolateModules` 로 모듈을 새로 불러온다.
 */

const ENV_KEY = 'EXPO_PUBLIC_API_BASE_URL';
const devGlobal = globalThis as unknown as { __DEV__: boolean };

const ORIGINAL_DEV = devGlobal.__DEV__;
const ORIGINAL_ENV = process.env.EXPO_PUBLIC_API_BASE_URL;

afterEach(() => {
  devGlobal.__DEV__ = ORIGINAL_DEV;
  if (ORIGINAL_ENV === undefined) {
    delete process.env.EXPO_PUBLIC_API_BASE_URL;
  } else {
    process.env.EXPO_PUBLIC_API_BASE_URL = ORIGINAL_ENV;
  }
});

/** 모듈 캐시를 우회해 api 모듈을 새로 불러오고, 인증 클라이언트가 붙은 주소를 돌려준다. */
function loadBaseUrl(): unknown {
  let baseURL: unknown;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const api = require('@/shared/api') as typeof import('@/shared/api');
    baseURL = api.authedClient.defaults.baseURL;
  });
  return baseURL;
}

describe('API 주소 env 부재 — 운영은 드러나게 실패, 개발만 localhost 폴백', () => {
  it('운영 빌드에서 주소 env가 없으면 api 모듈 로드가 env 이름을 담은 에러로 실패한다', () => {
    devGlobal.__DEV__ = false;
    delete process.env.EXPO_PUBLIC_API_BASE_URL;

    expect(() => loadBaseUrl()).toThrow(ENV_KEY);
  });

  it('운영 빌드에서 주소 env가 빈 문자열이어도 로드가 실패한다', () => {
    devGlobal.__DEV__ = false;
    process.env.EXPO_PUBLIC_API_BASE_URL = '';

    expect(() => loadBaseUrl()).toThrow(ENV_KEY);
  });

  it('운영 빌드에서 주소 env가 있으면 그 주소로 붙는다(localhost 아님)', () => {
    devGlobal.__DEV__ = false;
    process.env.EXPO_PUBLIC_API_BASE_URL = 'https://api.example.test';

    const baseURL = loadBaseUrl();

    expect(baseURL).toBe('https://api.example.test/api/v1');
  });

  it('개발 빌드에서 주소 env가 없으면 localhost로 폴백한다', () => {
    devGlobal.__DEV__ = true;
    delete process.env.EXPO_PUBLIC_API_BASE_URL;

    const baseURL = loadBaseUrl();

    expect(baseURL).toBe('http://localhost:8080/api/v1');
  });
});
