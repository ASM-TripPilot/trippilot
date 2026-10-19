import { http, HttpResponse } from 'msw';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { QueryClient } from '@tanstack/react-query';

import { server } from '@/mocks/server';
import {
  getGetTripsTripIdItineraryQueryKey,
  getGetTripsTripIdTriggersQueryKey,
} from '@/shared/api/index.hooks';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';
import { BASE } from '@/test-support/apiBase';
import { createWrapper, newTestQueryClient } from '@/test-support/queryRender';

import { useApplyReplan } from './useApplyReplan';

/**
 * 재계획 확정 seam(`useApplyReplan`)의 캐시 무효화 — 확정이 성공하면 그 여행의 일정(INV-U4-05)과
 * 트리거(상황 감지 FE-A · BR-SA-14: 적용이 트리거를 소비한다)를 다시 받게 한다.
 *
 * 왜 따로 두나: 페이지 테스트(`PlanbDraftPage`·`PlanbDiffPage` 통합)는 이 seam 을 통째로 목으로 바꿔 끼워,
 * 확정 뒤 무엇이 낡음 처리되는지는 거기서 안 보인다. 여기서 가짜 서버(MSW)로 실제 apply 왕복을 태운다.
 * 소비된 트리거가 허브 알약에 남지 않는지(화면)는 허브 통합 테스트·6-b 몫이다.
 *
 * 3동작: 준비 = 캐시 심기 + 가짜 서버 응답 → 실행 = 확정(mutate) → 단언 = 캐시의 낡음 표시.
 */

// authedClient(인증 계층)가 @/shared/storage 를 정적으로 문다(useReplanDiff.integration 선례).
jest.mock('@/shared/storage', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest
    .fn()
    .mockResolvedValue({ accessToken: 'a', refreshToken: 'r' }),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  hasStoredToken: jest.fn().mockResolvedValue(true),
}));

const APPLY_URL = `${BASE}/trips/trip-1/replan-sessions/s9/apply`;
const ITINERARY_TRIP_1 = getGetTripsTripIdItineraryQueryKey('trip-1');
const TRIGGERS_TRIP_1 = getGetTripsTripIdTriggersQueryKey('trip-1');
const TRIGGERS_TRIP_2 = getGetTripsTripIdTriggersQueryKey('trip-2');

let client: QueryClient;

function isInvalidated(key: readonly unknown[]): boolean {
  return client.getQueryState(key)?.isInvalidated ?? false;
}

function mountApply() {
  return renderHook(() => useApplyReplan(), {
    wrapper: createWrapper(client),
  });
}

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});

beforeEach(() => {
  setAccessToken('a');
  client = newTestQueryClient();
  client.setQueryData(ITINERARY_TRIP_1, { days: [] });
  client.setQueryData(TRIGGERS_TRIP_1, []);
  client.setQueryData(TRIGGERS_TRIP_2, []);
});

afterEach(() => {
  server.resetHandlers();
  clearAccessToken();
  client.clear();
});

afterAll(() => server.close());

describe('확정(apply) 뒤 캐시 — 바뀐 일정과 소비된 트리거를 다시 받는다', () => {
  it('A1 확정이 성공하면 그 여행의 일정·트리거 캐시를 낡게 하고, 다른 여행 트리거는 그대로 둔다', async () => {
    // 준비
    server.use(
      http.post(APPLY_URL, () =>
        HttpResponse.json({ sessionId: 's9', status: 'APPLIED' })
      )
    );
    const { result } = mountApply();

    // 실행
    act(() => {
      result.current.mutate({ tripId: 'trip-1', sessionId: 's9' });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // 단언
    expect(isInvalidated(ITINERARY_TRIP_1)).toBe(true);
    expect(isInvalidated(TRIGGERS_TRIP_1)).toBe(true);
    expect(isInvalidated(TRIGGERS_TRIP_2)).toBe(false);
  });

  it('A2 확정이 실패하면(409) 트리거 캐시를 건드리지 않는다 — 소비는 성공한 적용만', async () => {
    // 준비
    server.use(
      http.post(APPLY_URL, () =>
        HttpResponse.json({ code: 'STALE' }, { status: 409 })
      )
    );
    const { result } = mountApply();

    // 실행
    act(() => {
      result.current.mutate({ tripId: 'trip-1', sessionId: 's9' });
    });
    await waitFor(() => expect(result.current.isError).toBe(true));

    // 단언
    expect(isInvalidated(TRIGGERS_TRIP_1)).toBe(false);
  });
});
