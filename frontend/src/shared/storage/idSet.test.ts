import * as SecureStore from 'expo-secure-store';

import { readIdSet, writeIdSet } from './idSet';

/**
 * TRIP-928 · 문자열 id 집합 저장소 — 키를 인자로 받아 id 목록을 기기에 읽고/쓴다(도메인 무관).
 * 저장 형식은 계약 밖이라, SecureStore 를 메모리 Map 으로 바꿔 끼우고 "쓴 것을 그대로 읽는다"로만 본다.
 */

const mockVault = new Map<string, string>();

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

const mockGetItem = SecureStore.getItemAsync as jest.Mock;
const mockSetItem = SecureStore.setItemAsync as jest.Mock;

beforeEach(() => {
  mockVault.clear();
  mockGetItem
    .mockReset()
    .mockImplementation(async (key: string) => mockVault.get(key) ?? null);
  mockSetItem
    .mockReset()
    .mockImplementation(async (key: string, value: string) => {
      mockVault.set(key, value);
    });
});

describe('🔴 idSet · 키별 문자열 id 집합 읽기/쓰기 (AC-10)', () => {
  it('저장된 값이 없으면 빈 배열을 돌려준다', async () => {
    await expect(readIdSet('k.seen')).resolves.toEqual([]);
  });

  it('쓴 id 집합을 같은 키로 읽으면 그대로 돌아온다', async () => {
    await writeIdSet('k.seen', ['trip-a', 'trip-b']);

    const ids = await readIdSet('k.seen');

    expect([...ids].sort()).toEqual(['trip-a', 'trip-b']);
  });

  it('키가 다르면 서로 섞이지 않는다', async () => {
    await writeIdSet('k.one', ['trip-a']);

    await expect(readIdSet('k.two')).resolves.toEqual([]);
  });

  it('SecureStore 는 넘겨받은 키로만 부르고 토큰 키는 건드리지 않는다', async () => {
    await writeIdSet('k.seen', ['trip-a']);
    await readIdSet('k.seen');

    const keys = [...mockSetItem.mock.calls, ...mockGetItem.mock.calls].map(
      (call) => call[0]
    );
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.every((key) => key === 'k.seen')).toBe(true);
    expect(keys).not.toContain('accessToken');
    expect(keys).not.toContain('refreshToken');
  });
});
