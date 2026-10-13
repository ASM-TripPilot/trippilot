import { act, renderHook } from '@testing-library/react-native';

import { clearAccessToken, setAccessToken } from './tokenManager';
import { useAccessToken } from './useAccessToken';

/** `useAccessToken` — 렌더 중 `getAccessToken()` 직접 읽기 대신 구독으로 읽는다(TRIP-1364 · React Compiler 대비). */

afterEach(() => {
  clearAccessToken();
});

describe('useAccessToken', () => {
  it('토큰이 없으면 null, 마운트 때 있으면 그 값', () => {
    expect(renderHook(() => useAccessToken()).result.current).toBeNull();
    setAccessToken('tok-1');
    expect(renderHook(() => useAccessToken()).result.current).toBe('tok-1');
  });

  it('호스트가 따로 다시 그려지지 않아도 로그인·로그아웃에 따라 바뀐다', () => {
    const { result } = renderHook(() => useAccessToken());
    expect(result.current).toBeNull();
    act(() => setAccessToken('tok-2'));
    expect(result.current).toBe('tok-2');
    act(() => clearAccessToken());
    expect(result.current).toBeNull();
  });

  it('언마운트하면 구독이 풀린다(이후 변경에 상태 갱신 경고 없음)', () => {
    const { unmount } = renderHook(() => useAccessToken());
    unmount();
    expect(() => setAccessToken('tok-3')).not.toThrow();
  });
});
