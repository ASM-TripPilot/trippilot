/**
 * @jest-environment node
 */

/**
 * TRIP-1647 · AC-3(iOS 불변)·AC-5 — 네이티브 저장소 어댑터(`secureKv.ts`).
 *
 * 무엇을 보장하나:
 *  - 어댑터는 `expo-secure-store` 를 **인자 그대로** 통과시킨다(옵션 인자·값 가공 없음). 기존 토큰·id·문자열
 *    저장소 테스트(수정 없이 green)가 이 통과성에 기대고 있다.
 *  - SecureStore 가 거절하면 그대로 거절한다(삼키지 않음, INV-4). 네이티브 경로는 localStorage 를 건드리지 않는다.
 *  - 네이티브·웹 어댑터 쌍의 export 이름과 인자 개수가 같다 — `tsc` 는 `.web.ts` 를 import 그래프에 안 올려서
 *    웹 쪽이 어긋나도 못 잡는다. 배럴(`index.ts`)은 기존 12개 값만 내보낸다(어댑터 재수출 금지 — 배럴을 통째로
 *    목으로 갈아끼우는 테스트들이 어댑터 이름을 지운다).
 *
 * (개념) `toHaveBeenCalledWith(a, b)` = 호출 인자 **전체**가 정확히 (a, b) 일 때만 통과 — 인자가 하나 더 끼면 실패.
 * 3동작: 준비(SecureStore 목) → 실행(어댑터 호출) → 단언(호출 인자·반환·거절).
 */

import * as SecureStore from 'expo-secure-store';

import {
  defineLocalStorage,
  removeLocalStorage,
} from '@/test-support/fakeLocalStorage';

import { deleteSecureItem, getSecureItem, setSecureItem } from './secureKv';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

const mockGetItem = SecureStore.getItemAsync as jest.Mock;
const mockSetItem = SecureStore.setItemAsync as jest.Mock;
const mockDeleteItem = SecureStore.deleteItemAsync as jest.Mock;

beforeEach(() => {
  mockGetItem.mockReset();
  mockSetItem.mockReset().mockResolvedValue(undefined);
  mockDeleteItem.mockReset().mockResolvedValue(undefined);
});

afterEach(removeLocalStorage);

describe('네이티브 어댑터 — SecureStore 통과', () => {
  it('getSecureItem 은 키를 그대로 넘기고 돌아온 값(문자열·null)을 그대로 돌려준다', async () => {
    mockGetItem.mockResolvedValueOnce('v').mockResolvedValueOnce(null);

    await expect(getSecureItem('k')).resolves.toBe('v');
    await expect(getSecureItem('k')).resolves.toBeNull();

    expect(mockGetItem).toHaveBeenCalledTimes(2);
    expect(mockGetItem).toHaveBeenNthCalledWith(1, 'k');
  });

  it('setSecureItem 은 (키, 값) 두 인자만 한 번 넘긴다', async () => {
    await setSecureItem('k', 'v');

    expect(mockSetItem).toHaveBeenCalledTimes(1);
    expect(mockSetItem).toHaveBeenCalledWith('k', 'v');
  });

  it('deleteSecureItem 은 키 하나만 한 번 넘긴다', async () => {
    await deleteSecureItem('k');

    expect(mockDeleteItem).toHaveBeenCalledTimes(1);
    expect(mockDeleteItem).toHaveBeenCalledWith('k');
  });

  it('SecureStore 가 거절하면 세 함수 모두 그 에러 그대로 거절한다 (삼키지 않음)', async () => {
    const failure = new Error('keychain locked');
    mockGetItem.mockRejectedValue(failure);
    mockSetItem.mockRejectedValue(failure);
    mockDeleteItem.mockRejectedValue(failure);

    await expect(getSecureItem('k')).rejects.toBe(failure);
    await expect(setSecureItem('k', 'v')).rejects.toBe(failure);
    await expect(deleteSecureItem('k')).rejects.toBe(failure);
  });

  it('네이티브 경로는 localStorage 를 한 번도 읽지 않는다', async () => {
    const read = jest.fn(() => {
      throw new Error('localStorage touched');
    });
    defineLocalStorage(read);

    await getSecureItem('k');
    await setSecureItem('k', 'v');
    await deleteSecureItem('k');

    expect(read).not.toHaveBeenCalled();
  });
});

describe('어댑터 쌍 정합 · 배럴 공개 API', () => {
  const EXPECTED = ['deleteSecureItem', 'getSecureItem', 'setSecureItem'];

  it('네이티브·웹 어댑터는 같은 이름 3개를 같은 인자 개수로 내보낸다', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const native = require('./secureKv') as Record<
      string,
      (...a: never[]) => unknown
    >;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const web = require('./secureKv.web') as Record<
      string,
      (...a: never[]) => unknown
    >;

    expect(Object.keys(native).sort()).toEqual(EXPECTED);
    expect(Object.keys(web).sort()).toEqual(EXPECTED);
    for (const name of EXPECTED) {
      expect(web[name].length).toBe(native[name].length);
    }
  });

  it('배럴은 기존 값 12개만 내보내고 어댑터 함수를 노출하지 않는다', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const barrel = require('./index') as Record<string, unknown>;

    expect(Object.keys(barrel).sort()).toEqual(
      [
        'PUSH_REGISTERED_KEY',
        'clearTokens',
        'getInstallId',
        'getTokens',
        'hasStoredToken',
        'readIdSet',
        'readInstallFlag',
        'readStringValue',
        'saveTokens',
        'writeIdSet',
        'writeInstallFlag',
        'writeStringValue',
      ].sort()
    );
  });
});
