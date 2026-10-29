/**
 * @jest-environment node
 */

/**
 * TRIP-1647 · AC-1·2·4·6 — 웹 저장소 어댑터(`secureKv.web.ts`)와 그 위에서 도는 공개 API.
 *
 * 무엇을 보장하나:
 *  - 웹에서는 `localStorage` 로 읽고·쓰고·지운다. 없는 키는 null. SecureStore 는 한 번도 안 부른다.
 *  - `localStorage` 를 호출 때마다 꺼내고(모듈 로드 시 1회 캡처 아님), 없거나·접근이 막혔거나·용량 초과면
 *    **그 에러 그대로 거절**한다(INV-4 — 실패를 삼키지 않는다). 동기 throw 가 아니라 거절된 Promise 로 온다.
 *  - 토큰·id 집합·문자열·기기 식별자 저장소가 이 어댑터 위에서 새로고침(모듈 메모리 소실, localStorage 만 유지)
 *    뒤에도 값을 돌려주고, `clearTokens` 는 토큰 3키만 지운다(다른 키·`localStorage.clear()` 아님).
 *
 * (개념) 이 파일이 `./secureKv.web` 를 이름으로 직접 불러오는 이유 — jest-expo 는 iOS 기준이라 `.web.ts` 를 자동으로
 *   고르지 않는다. Metro 가 웹 빌드에서 `.web.ts` 를 실제로 고르는지는 jest 가 못 본다([검증]의 웹 export 몫).
 * (개념) `jest.isolateModules` = 그 안에서 require 한 모듈을 캐시 없이 새로 읽는다. 두 번 부르면 "메모리는 비었는데
 *   localStorage 에는 값이 남은" 새로고침 상태가 된다.
 * 3동작: 준비(가짜 localStorage·SecureStore 폭발 목) → 실행(API 호출) → 단언(돌아온 값·가짜 안의 키·거절).
 */

import * as SecureStore from 'expo-secure-store';

import {
  createFakeStorage,
  defineLocalStorage,
  installFakeLocalStorage,
  removeLocalStorage,
} from '@/test-support/fakeLocalStorage';

import { deleteSecureItem, getSecureItem, setSecureItem } from './secureKv.web';

// 웹 경로가 SecureStore 에 닿으면 즉시 터지게 한다 — 배럴 아래 부품 교체가 실패해 네이티브 경로를 타는 경우를 잡는다.
jest.mock('expo-secure-store', () => {
  const boom = () => {
    throw new Error('SecureStore must not be used on web');
  };
  return {
    getItemAsync: jest.fn(boom),
    setItemAsync: jest.fn(boom),
    deleteItemAsync: jest.fn(boom),
  };
});
let mockUuidCalls = 0;
jest.mock('expo-crypto', () => ({
  randomUUID: () => `uuid-${++mockUuidCalls}`,
}));

// 가짜 localStorage 는 파일 최상위에서 치운다 — describe 안에 두면 앞 케이스의 가짜가 새어 "없음" 케이스가 거짓 green 이 된다.
afterEach(removeLocalStorage);

/** 새로고침 모사: 새 모듈 레지스트리에서 배럴을 읽되 저장소 부품만 웹 어댑터로 바꿔 끼운다. */
function loadStorageOnWeb(): typeof import('./index') {
  let loaded: typeof import('./index') | undefined;
  jest.isolateModules(() => {
    jest.doMock('./secureKv', () => jest.requireActual('./secureKv.web'));
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    loaded = require('./index');
  });
  return loaded as typeof import('./index');
}

describe('웹 어댑터 — localStorage', () => {
  it('쓴 값을 같은 키로 읽고, 없는 키는 null, 지우면 null', async () => {
    installFakeLocalStorage();

    await setSecureItem('k', 'v');
    await expect(getSecureItem('k')).resolves.toBe('v');
    await expect(getSecureItem('other')).resolves.toBeNull();

    await deleteSecureItem('k');
    await expect(getSecureItem('k')).resolves.toBeNull();
  });

  it('키끼리 섞이지 않고, 없는 키를 지워도 던지지 않는다', async () => {
    installFakeLocalStorage();

    await setSecureItem('a', '1');
    await setSecureItem('b', '2');
    await deleteSecureItem('a');

    await expect(getSecureItem('b')).resolves.toBe('2');
    await expect(deleteSecureItem('never-set')).resolves.toBeUndefined();
  });

  it('localStorage 를 호출 때마다 꺼낸다 (모듈을 불러온 시점엔 없었고, 중간에 바꿔도 새것을 본다)', async () => {
    const first = installFakeLocalStorage();
    await setSecureItem('k', 'v');
    expect(first.data.get('k')).toBe('v');

    const second = createFakeStorage();
    defineLocalStorage(() => second);

    await expect(getSecureItem('k')).resolves.toBeNull();
  });

  it('SecureStore 를 한 번도 부르지 않는다', async () => {
    installFakeLocalStorage();

    await setSecureItem('k', 'v');
    await getSecureItem('k');
    await deleteSecureItem('k');

    expect(SecureStore.getItemAsync).not.toHaveBeenCalled();
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
    expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
  });
});

describe('웹 어댑터 — 막히면 거절한다 (INV-4)', () => {
  it('localStorage 가 없으면 세 함수 모두 거절한다', async () => {
    // 가짜를 설치하지 않은 상태 — 앞 케이스의 가짜가 남아 있으면 여기서 거절이 안 나 실패한다.
    await expect(getSecureItem('k')).rejects.toThrow();
    await expect(setSecureItem('k', 'v')).rejects.toThrow();
    await expect(deleteSecureItem('k')).rejects.toThrow();
  });

  it('localStorage 접근이 SecurityError 로 막히면 세 함수 모두 그 에러 그대로 거절한다', async () => {
    const blocked = Object.assign(new Error('access denied'), {
      name: 'SecurityError',
    });
    defineLocalStorage(() => {
      throw blocked;
    });

    await expect(getSecureItem('k')).rejects.toBe(blocked);
    await expect(setSecureItem('k', 'v')).rejects.toBe(blocked);
    await expect(deleteSecureItem('k')).rejects.toBe(blocked);
  });

  it('setItem 이 용량 초과(QuotaExceededError)면 쓰기만 거절하고 읽기·삭제는 그대로 되며 값은 남지 않는다', async () => {
    const full = installFakeLocalStorage();
    const quota = Object.assign(new Error('quota exceeded'), {
      name: 'QuotaExceededError',
    });
    full.setItem = () => {
      throw quota;
    };

    await expect(setSecureItem('k', 'v')).rejects.toBe(quota);
    await expect(getSecureItem('k')).resolves.toBeNull();
    await expect(deleteSecureItem('k')).resolves.toBeUndefined();
  });
});

describe('웹 어댑터 위의 공개 API — 새로고침 뒤에도 값이 남는다', () => {
  it('saveTokens 로 저장한 토큰을 새로고침 뒤 getTokens 가 그대로 돌려준다 (AC-1)', async () => {
    const browser = installFakeLocalStorage();
    const tokens = { accessToken: 'access-1', refreshToken: 'refresh-1' };

    await loadStorageOnWeb().saveTokens(tokens);
    expect(browser.data.get('accessToken')).toBe('access-1');
    expect(browser.data.get('refreshToken')).toBe('refresh-1');

    await expect(loadStorageOnWeb().getTokens()).resolves.toEqual(tokens);
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
  });

  it('clearTokens 뒤에는 hasStoredToken 이 false, getTokens 는 null 이고 푸시 등록 기억도 사라진다 (AC-2)', async () => {
    const browser = installFakeLocalStorage();
    const storage = loadStorageOnWeb();
    await storage.saveTokens({ accessToken: 'a', refreshToken: 'r' });
    browser.setItem(storage.PUSH_REGISTERED_KEY, 'token|granted');
    await expect(storage.hasStoredToken()).resolves.toBe(true);

    await storage.clearTokens();

    await expect(storage.hasStoredToken()).resolves.toBe(false);
    await expect(storage.getTokens()).resolves.toBeNull();
    expect(browser.data.has('pushTokenRegistered')).toBe(false);
  });

  it('clearTokens 는 토큰 3키만 지우고 같은 localStorage 의 다른 키(installId)는 남긴다', async () => {
    const browser = installFakeLocalStorage();
    const storage = loadStorageOnWeb();
    await storage.saveTokens({ accessToken: 'a', refreshToken: 'r' });
    browser.setItem('installId', 'device-1');

    await storage.clearTokens();

    expect([...browser.data.keys()]).toEqual(['installId']);
  });

  it('쓰기가 막히면 saveTokens 가 호출자까지 거절하고 토큰은 저장되지 않는다 (AC-4)', async () => {
    const browser = installFakeLocalStorage();
    const quota = Object.assign(new Error('quota exceeded'), {
      name: 'QuotaExceededError',
    });
    browser.setItem = () => {
      throw quota;
    };
    const storage = loadStorageOnWeb();

    await expect(
      storage.saveTokens({ accessToken: 'a', refreshToken: 'r' })
    ).rejects.toBe(quota);
    await expect(storage.getTokens()).resolves.toBeNull();
  });

  it('localStorage 접근이 막히면 getTokens·hasStoredToken 도 null/false 로 접지 않고 거절한다', async () => {
    const blocked = Object.assign(new Error('access denied'), {
      name: 'SecurityError',
    });
    defineLocalStorage(() => {
      throw blocked;
    });
    const storage = loadStorageOnWeb();

    await expect(storage.getTokens()).rejects.toBe(blocked);
    await expect(storage.hasStoredToken()).rejects.toBe(blocked);
  });

  it('id 집합·문자열 값·기기 식별자 저장소도 어댑터를 거쳐 새로고침 뒤 복원된다 (SecureStore 직접 호출 없음)', async () => {
    installFakeLocalStorage();
    mockUuidCalls = 0;
    const before = loadStorageOnWeb();

    await before.writeIdSet('seen', ['p1', 'p2']);
    await before.writeStringValue('sort', 'start');
    const installId = await before.getInstallId();

    const after = loadStorageOnWeb();
    await expect(after.readIdSet('seen')).resolves.toEqual(['p1', 'p2']);
    await expect(after.readStringValue('sort')).resolves.toBe('start');
    // 새 UUID 가 만들어졌다면 'uuid-2' — 저장된 값을 재사용하면 첫 값 그대로다.
    await expect(after.getInstallId()).resolves.toBe(installId);
    expect(mockUuidCalls).toBe(1);
  });
});
