import { http, HttpResponse } from 'msw';
import { renderHook, waitFor } from '@testing-library/react-native';

import { server } from '@/mocks/server';
import { useGetStaysCurated } from '@/shared/api/index.hooks';
import type {
  CuratedStay,
  GetStaysCuratedParams,
} from '@/shared/api/index.schemas';
import { BASE } from '@/test-support/apiBase';
import { createGcZeroWrapper } from '@/test-support/queryRender';

import { useCuratedStays } from './useCuratedStays';

/**
 * TRIP-1579 — 인기 숙소 목록 훅. 보장: 조건(regionCode·city)이 없거나 게스트면 요청 0 + hidden, 로딩·실패·빈
 * 목록도 hidden(카드 줄을 숨긴다 — 죽은 줄 금지), 성공 + 항목이 있을 때만 hidden=false 로 그대로 돌려준다.
 * 카탈로그 코드는 손대지 않고 regionCode 로 넘긴다(이름을 city 로 넘기면 빈 목록이 온다).
 */

jest.mock('@/shared/storage', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest.fn().mockResolvedValue({
    accessToken: 'old-access',
    refreshToken: 'old-refresh',
  }),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  hasStoredToken: jest.fn().mockResolvedValue(true),
}));

const ITEM: CuratedStay = {
  rank: 1,
  stayId: 'TRIPCOM:123',
  name: '해운대 그랜드 호텔',
  address: null,
  imageUrl: 'https://ak-d.tripcdn.com/images/a.jpg',
};

let requests: string[] = [];

function serve(response: () => Response): void {
  server.use(
    http.get(`${BASE}/stays/curated`, ({ request }) => {
      requests.push(new URL(request.url).search);
      return response();
    })
  );
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
beforeEach(() => {
  requests = [];
});
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

/**
 * 훅 + 같은 쿼리 키 관찰(요청은 안 낸다) — 응답이 캐시에 도착했는지(성공·실패)를 기다리는 데만 쓴다.
 * 숨김은 로딩 중에도 true 라, 도착을 따로 기다리지 않으면 "빈 목록이라 숨김"을 "아직 로딩이라 숨김"과 못 가른다.
 */
function renderCurated(
  args: Parameters<typeof useCuratedStays>[0],
  observed: GetStaysCuratedParams = {}
) {
  return renderHook(
    () => ({
      ...useCuratedStays(args),
      raw: useGetStaysCurated(observed, { query: { enabled: false } }),
    }),
    { wrapper: createGcZeroWrapper() }
  );
}

describe('C1 · 성공 + 항목 있음 → hidden=false', () => {
  it('regionCode 를 그대로 실어 한 번 묻고 항목을 돌려준다', async () => {
    serve(() => HttpResponse.json({ city: '부산', items: [ITEM] }));

    const { result } = renderCurated({ regionCode: '26', isAuthed: true });

    await waitFor(() => expect(result.current.hidden).toBe(false));
    expect(result.current.items).toEqual([ITEM]);
    expect(requests).toEqual(['?regionCode=26']);
  });
});

describe('C2 · 숨김 갈래', () => {
  it('성공했지만 빈 목록이면 hidden', async () => {
    serve(() => HttpResponse.json({ city: null, items: [] }));

    const { result } = renderCurated(
      { regionCode: '45', isAuthed: true },
      { regionCode: '45' }
    );

    // 응답이 도착할 때까지 기다린 뒤에도 숨김이다.
    await waitFor(() => expect(result.current.raw.isSuccess).toBe(true));
    expect(result.current.hidden).toBe(true);
    expect(result.current.items).toEqual([]);
  });

  it('서버 실패면 hidden', async () => {
    serve(() => HttpResponse.json({}, { status: 500 }));

    const { result } = renderCurated(
      { city: '부산', isAuthed: true },
      { city: '부산' }
    );

    await waitFor(() => expect(result.current.raw.isError).toBe(true));
    expect(result.current.hidden).toBe(true);
    expect(requests).toEqual([`?city=${encodeURIComponent('부산')}`]);
  });

  it('조건이 없으면 요청 0 + hidden', async () => {
    serve(() => HttpResponse.json({ city: '부산', items: [ITEM] }));

    const { result } = renderCurated({ isAuthed: true });

    expect(result.current.hidden).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(requests).toEqual([]);
  });

  it('게스트면 요청 0 + hidden (인증 필요 계약)', async () => {
    serve(() => HttpResponse.json({ city: '부산', items: [ITEM] }));

    const { result } = renderCurated({ regionCode: '26', isAuthed: false });

    expect(result.current.hidden).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(requests).toEqual([]);
  });
});
