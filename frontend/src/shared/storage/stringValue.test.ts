import * as SecureStore from 'expo-secure-store';

import * as storageBarrel from './index';
import { readStringValue, writeStringValue } from './stringValue';

/**
 * TRIP-1122 · AC-12 — 키별 문자열 1개 저장소(도메인 무관 — 키 이름과 뜻은 윗층이 갖는다).
 *
 * 무엇을 보장하나:
 *  - 없으면 null, 쓴 값을 같은 키로 읽으면 그대로, 키끼리 안 섞인다.
 *  - 값을 **그대로** 저장한다(JSON 으로 감싸지 않는다) — h06 정렬 기억은 `'start'` 그 문자열이다.
 *  - 넘겨받은 키로만 SecureStore 를 부르고 토큰 키는 건드리지 않는다(SEC-09 키 분리, idSet 동형).
 *  - `@/shared/storage` 공개 API(배럴)로 나간다(TRIP-1157 — 옛 "딥 경로 전용" 계약 폐기). 배럴을 통째로 목으로
 *    갈아끼우는 테스트는 `jest.requireActual` 로 실물을 펼친 뒤 덮는다(안 그러면 이 함수가 지워진다).
 *
 * 3동작: 준비(SecureStore 를 메모리 Map 으로) → 실행(읽기/쓰기) → 단언(값·호출 인자).
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

describe('🔴 stringValue · 키별 문자열 1개 읽기/쓰기 (AC-12)', () => {
  it('저장된 값이 없으면 null', async () => {
    await expect(readStringValue('k.sort')).resolves.toBeNull();
  });

  it('쓴 값을 같은 키로 읽으면 그대로 돌아온다', async () => {
    await writeStringValue('k.sort', 'title');

    await expect(readStringValue('k.sort')).resolves.toBe('title');
  });

  it('키가 다르면 서로 섞이지 않는다', async () => {
    await writeStringValue('k.one', 'title');

    await expect(readStringValue('k.two')).resolves.toBeNull();
  });

  it('값을 감싸지 않고 그대로 SecureStore 에 쓴다', async () => {
    await writeStringValue('k.sort', 'start');

    expect(mockSetItem).toHaveBeenCalledTimes(1);
    expect(mockSetItem.mock.calls[0].slice(0, 2)).toEqual(['k.sort', 'start']);
  });

  it('SecureStore 는 넘겨받은 키로만 부르고 토큰 키는 건드리지 않는다', async () => {
    await writeStringValue('k.sort', 'recent');
    await readStringValue('k.sort');

    const keys = [...mockSetItem.mock.calls, ...mockGetItem.mock.calls].map(
      (call) => call[0]
    );
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.every((key) => key === 'k.sort')).toBe(true);
    expect(keys).not.toContain('accessToken');
    expect(keys).not.toContain('refreshToken');
  });

  it('@/shared/storage 공개 API 가 토큰 함수와 함께 문자열 읽기/쓰기를 낸다(TRIP-1157)', () => {
    // 배럴의 함수가 이 모듈의 것과 같은 참조다 — 다른 구현을 재수출하면 red.
    expect(storageBarrel).toHaveProperty('saveTokens');
    expect(storageBarrel.readStringValue).toBe(readStringValue);
    expect(storageBarrel.writeStringValue).toBe(writeStringValue);
  });
});
