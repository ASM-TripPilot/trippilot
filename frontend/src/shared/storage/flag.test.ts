import * as SecureStore from 'expo-secure-store';

import { readFlag, writeFlag } from './flag';

/**
 * TRIP-781 AC-12 · 키별 참/거짓 플래그 저장소(도메인 무관 — 키 이름과 뜻은 윗층이 갖는다).
 * 저장 형식은 계약 밖이라, SecureStore 를 메모리 Map 으로 바꿔 끼우고 "쓴 것을 그대로 읽는다"로만 본다
 * (`idSet.test` 패턴).
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

describe('🔴 flag · 키별 참/거짓 읽기/쓰기 (TRIP-781 AC-12)', () => {
  it('저장된 값이 없으면 false 를 돌려준다', async () => {
    await expect(readFlag('k.flag')).resolves.toBe(false);
  });

  it('true 를 쓰고 같은 키로 읽으면 true 다', async () => {
    await writeFlag('k.flag', true);

    await expect(readFlag('k.flag')).resolves.toBe(true);
  });

  it('true 다음 false 를 쓰면 false 로 돌아온다(되돌리기 — l05 토글 몫)', async () => {
    await writeFlag('k.flag', true);
    await writeFlag('k.flag', false);

    await expect(readFlag('k.flag')).resolves.toBe(false);
  });

  it('키가 다르면 서로 섞이지 않는다', async () => {
    await writeFlag('k.one', true);

    await expect(readFlag('k.two')).resolves.toBe(false);
  });

  it('SecureStore 는 넘겨받은 키로만 부르고 토큰 키는 건드리지 않는다', async () => {
    await writeFlag('k.flag', true);
    await readFlag('k.flag');

    const keys = [...mockSetItem.mock.calls, ...mockGetItem.mock.calls].map(
      (call) => call[0]
    );
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.every((key) => key === 'k.flag')).toBe(true);
    expect(keys).not.toContain('accessToken');
    expect(keys).not.toContain('refreshToken');
  });
});
