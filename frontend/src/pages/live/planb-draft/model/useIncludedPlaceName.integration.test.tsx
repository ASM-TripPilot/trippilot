import { http, HttpResponse } from 'msw';
import { renderHook, waitFor } from '@testing-library/react-native';

import { server } from '@/mocks/server';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';
import { BASE } from '@/test-support/apiBase';
import { createHitLog, createWrapper } from '@/test-support/mswHookHarness';

import { useIncludedPlaceName } from './useIncludedPlaceName';

/**
 * 상황 감지 FE-B · frontend-components §3.6 — i06 미포함 안내의 장소 이름 seam 이 `GET /places/{poiId}` 를 부른다.
 *
 * 왜 따로 두나: 페이지 테스트(`PlanbDraftPage.integration`)는 이 seam 을 목으로 바꾼다 — "정말 그 주소를 부르나·
 * 넣으려던 POI 가 없으면 안 부르나·실패를 null 로 접나"는 여기서 가짜 서버(MSW)로 본다.
 *
 * 돌려주는 값: undefined = 아직(또는 물을 POI 없음) · string = 이름 · null = 조회 실패(이름 없이 안내한다).
 * 3동작: 준비(가짜 서버) → 실행(훅) → 단언(값·요청 수).
 */

jest.mock('@/shared/storage', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest
    .fn()
    .mockResolvedValue({ accessToken: 'a', refreshToken: 'r' }),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  hasStoredToken: jest.fn().mockResolvedValue(true),
}));

const PLACE_PATH = '/places/poi-sky';
const hits = createHitLog(server);

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  hits.attach();
});
beforeEach(() => {
  hits.reset();
  setAccessToken('a');
});
afterEach(() => {
  server.resetHandlers();
  clearAccessToken();
});
afterAll(() => server.close());

describe('🔴 useIncludedPlaceName — GET /places/{poiId}', () => {
  it('P1 넣으려던 POI 가 있으면 그 장소 이름을 돌려준다(GET 1회)', async () => {
    server.use(
      http.get(`${BASE}${PLACE_PATH}`, () =>
        HttpResponse.json({
          poiId: 'poi-sky',
          nameKo: '하늘공원',
          category: 'NATURE',
          lat: 37.5,
          lng: 126.9,
          tags: [],
          savedCount: 0,
          dataStatus: 'ACTIVE',
        })
      )
    );

    const { result } = renderHook(() => useIncludedPlaceName('poi-sky'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current).toBe('하늘공원'));
    expect(hits.count(`GET /api/v1${PLACE_PATH}`)).toBe(1);
  });

  it('P2 조회가 실패(404)하면 null — 재시도 없이 1회', async () => {
    server.use(
      http.get(
        `${BASE}${PLACE_PATH}`,
        () => new HttpResponse(null, { status: 404 })
      )
    );

    const { result } = renderHook(() => useIncludedPlaceName('poi-sky'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current).toBeNull());
    expect(hits.count(`GET /api/v1${PLACE_PATH}`)).toBe(1);
  });

  it('P3 물을 POI 가 없으면(null) 요청하지 않고 undefined 다', async () => {
    const { result } = renderHook(() => useIncludedPlaceName(null), {
      wrapper: createWrapper(),
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(result.current).toBeUndefined();
    expect(hits.all()).toEqual([]);
  });
});
