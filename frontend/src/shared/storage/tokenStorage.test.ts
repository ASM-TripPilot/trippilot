import * as SecureStore from 'expo-secure-store';

import { clearTokens, getTokens, saveTokens } from '.';

jest.mock('expo-secure-store', () => ({
  setItemAsync: jest.fn(),
  getItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

const mockSetItem = SecureStore.setItemAsync as jest.Mock;
const mockGetItem = SecureStore.getItemAsync as jest.Mock;
const mockDeleteItem = SecureStore.deleteItemAsync as jest.Mock;

beforeEach(() => {
  mockSetItem.mockReset().mockResolvedValue(undefined);
  mockGetItem.mockReset();
  mockDeleteItem.mockReset().mockResolvedValue(undefined);
});

describe('토큰 저장소 — expo-secure-store 전용 (AC-ONB-01-8)', () => {
  it('saveTokens 는 accessToken·refreshToken 을 secure-store 에만 기록하고 다른 저장소로 복사하지 않는다', async () => {
    await saveTokens({ accessToken: 'access-1', refreshToken: 'refresh-1' });

    const written = mockSetItem.mock.calls.map((call) => [call[0], call[1]]);
    expect(written).toContainEqual(['accessToken', 'access-1']);
    expect(written).toContainEqual(['refreshToken', 'refresh-1']);
    // 정확히 2회 — 토큰 두 개 외 다른 키/저장소 기록이 없음을 성질로 고정한다.
    expect(mockSetItem).toHaveBeenCalledTimes(2);
  });

  it('getTokens 는 secure-store 에서 두 토큰을 읽어 반환한다', async () => {
    mockGetItem.mockImplementation(async (key: string) => {
      if (key === 'accessToken') return 'access-1';
      if (key === 'refreshToken') return 'refresh-1';
      return null;
    });

    await expect(getTokens()).resolves.toEqual({
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
    });
  });

  it('clearTokens 는 secure-store 의 두 토큰을 삭제한다 (로그아웃·401 확정 시 즉시 삭제)', async () => {
    await clearTokens();

    const deleted = mockDeleteItem.mock.calls.map((call) => call[0]);
    expect(deleted).toContain('accessToken');
    expect(deleted).toContain('refreshToken');
  });
});
