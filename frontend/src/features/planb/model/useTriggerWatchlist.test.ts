import { renderHook } from '@testing-library/react-native';

import { useActiveTriggers } from './useActiveTriggers';
import { useTriggerWatchlist } from './useTriggerWatchlist';

/**
 * TRIP-562 · AC-1/2/5 데이터 seam — useTriggerWatchlist 는 `GET /triggers` 얇은 데이터 훅이다.
 *
 * 무엇을 보장하나: 훅은 tripId 를 `useActiveTriggers` 에 그대로 넘기고 그 react-query 결과를
 * 돌려준다(사영·필터는 페이지가 순수 함수 `triggerWatchlist` 로 1회 수행 — 여기선 데이터만).
 * 페이지가 `.data.triggers` 에 의존하므로 이 위임 계약을 잠근다.
 *
 * ★ `useActiveTriggers` 를 목으로 치환해 react-query 실호출을 차단 → QueryClientProvider 불필요.
 * 개념 **renderHook**: 컴포넌트 없이 훅 하나만 렌더해 그 반환값(`result.current`)을 관찰한다.
 */

jest.mock('./useActiveTriggers', () => ({
  useActiveTriggers: jest.fn(),
}));

const mockResult = {
  data: { triggers: [] },
  isPending: false,
  isError: false,
};

beforeEach(() => {
  (useActiveTriggers as jest.Mock).mockReset();
  (useActiveTriggers as jest.Mock).mockReturnValue(mockResult);
});

describe('🔴 useTriggerWatchlist', () => {
  it('H1 tripId 를 useActiveTriggers 에 위임하고 그 결과를 그대로 반환한다', () => {
    const { result } = renderHook(() => useTriggerWatchlist('trip-1'));

    // tripId 가 첫 인자로 흘러간다(옵션 인자 유무는 구속하지 않는다 — i09 는 게이팅 없음).
    expect((useActiveTriggers as jest.Mock).mock.calls[0][0]).toBe('trip-1');
    expect(result.current).toBe(mockResult);
  });
});
