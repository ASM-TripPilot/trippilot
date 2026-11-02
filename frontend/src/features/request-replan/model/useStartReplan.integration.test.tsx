import { http, HttpResponse } from 'msw';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { isAxiosError } from 'axios';

import { server } from '@/mocks/server';
import type { StartReplanRequest } from '@/shared/api/index.schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';
import { BASE } from '@/test-support/apiBase';
import { createWrapper } from '@/test-support/queryRender';

import { useStartReplan } from './useStartReplan';

/**
 * 재계획 세션 열기 seam(`useStartReplan`)의 실제 HTTP 왕복. 페이지 테스트(`PlanbRequestPage`·`PlanbSolvingPage`·
 * `LiveLocationPage` 통합)는 이 seam 을 통째로 목으로 바꿔 "페이지가 `{ tripId, data }` 로 부른다"까지만 본다 — 그 변수가
 * 어느 URL 로 어떤 본문이 되어 나가는지, 실패가 페이지가 읽는 모양(`isAxiosError` + `response.status === 409`)으로
 * 돌아오는지는 여기서 가짜 서버(MSW)로 본다.
 *
 * 3동작: 준비 = 가짜 서버 응답 → 실행 = mutate → 단언 = 나간 요청(경로·본문)·돌아온 값/오류.
 */

// authedClient(인증 계층)가 @/shared/storage 를 정적으로 문다(useApplyReplan.integration 선례).
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/shared/storage', () => require('@/test-support/storageMock'));

const TRIP = 'trip-1';
const START_URL = `${BASE}/trips/${TRIP}/replan-sessions`;

/** 페이지가 만드는 본문의 대표 — 선택 칸(이유·지시·제외·트리거)까지 다 채워 하나라도 빠지면 보이게 한다. */
const REQUEST: StartReplanRequest = {
  scope: 'FULL_DAY',
  targetDate: '2026-10-20',
  originKind: 'MANUAL',
  originLat: 37.5665,
  originLng: 126.978,
  reasons: ['RAIN'],
  directives: ['INDOOR'],
  freeText: '실내 위주로',
  excludedPoiIds: ['poi-9'],
  triggerId: 'trg-1',
};

let posted: { url: string; body: unknown }[];

function mountStart() {
  return renderHook(() => useStartReplan(), { wrapper: createWrapper() });
}

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});

beforeEach(() => {
  setAccessToken('a');
  posted = [];
});

afterEach(() => {
  server.resetHandlers();
  clearAccessToken();
});

afterAll(() => server.close());

function serveStart(respond: () => Response): void {
  server.use(
    http.post(START_URL, async ({ request }) => {
      posted.push({ url: request.url, body: await request.json() });
      return respond();
    })
  );
}

describe('useStartReplan — 세션 열기 POST', () => {
  it('S1 그 여행의 replan-sessions 로 페이지가 준 본문을 그대로 한 번 보내고, 서버가 연 세션을 돌려준다', async () => {
    // 준비
    serveStart(() =>
      HttpResponse.json({ sessionId: 's9', tripId: TRIP, status: 'SOLVING' })
    );
    const { result } = mountStart();

    // 실행
    act(() => {
      result.current.mutate({ tripId: TRIP, data: REQUEST });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // 단언
    expect(posted).toEqual([{ url: START_URL, body: REQUEST }]);
    expect(result.current.data?.sessionId).toBe('s9');
  });

  it.each([
    [409, true],
    [500, false],
  ])(
    'S2 서버가 %d 이면 실패로 끝나고, 오류는 페이지가 읽는 axios 오류(응답 상태 그대로)다 — 409 판정 %s',
    async (status, conflict) => {
      // 준비
      serveStart(() =>
        HttpResponse.json({ code: 'TRIP_DAY_UNAVAILABLE' }, { status })
      );
      const { result } = mountStart();

      // 실행
      act(() => {
        result.current.mutate({ tripId: TRIP, data: REQUEST });
      });
      await waitFor(() => expect(result.current.isError).toBe(true));

      // 단언 — PlanbRequestPage onError 와 같은 식으로 읽는다.
      const error = result.current.error;
      expect(isAxiosError(error)).toBe(true);
      expect(isAxiosError(error) && error.response?.status === 409).toBe(
        conflict
      );
      expect(result.current.data).toBeUndefined();
      expect(posted).toHaveLength(1);
    }
  );
});
