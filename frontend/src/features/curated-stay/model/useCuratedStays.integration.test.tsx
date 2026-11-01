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

// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/shared/storage', () => require('@/test-support/storageMock'));

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
  it('짧은 도시 이름이 없는 코드는 regionCode 를 그대로 실어 한 번 묻고 항목을 돌려준다', async () => {
    serve(() => HttpResponse.json({ city: '포항', items: [ITEM] }));

    const { result } = renderCurated({ regionCode: '47110', isAuthed: true });

    await waitFor(() => expect(result.current.hidden).toBe(false));
    expect(result.current.items).toEqual([ITEM]);
    expect(requests).toEqual(['?regionCode=47110']);
  });
});

/**
 * TRIP-1603 — 운영 서버(main)는 `?city=` 만 받고 `?regionCode=` 는 400 이다(#1524 는 develop 에만). 앱이 짧은 도시 이름을 아는
 * 지역 코드(서울 11 · 부산 26 · 제주 50 · 인천 28 · 대구 27 · 강릉 51150 · 속초 51210 · 경주 47130 · 전주 5211x — 운영 시드 9개 도시)는 city 로 묻는다. 개발 서버는 둘 다 받아 그대로 동작한다.
 */
describe('C1b · 짧은 도시 이름을 아는 지역 코드는 city 로 묻는다 (TRIP-1603)', () => {
  it.each([
    ['11', '서울'],
    ['26', '부산'],
    ['26350', '부산'],
    ['50', '제주'],
    ['28', '인천'],
    ['27', '대구'],
    ['51150', '강릉'],
    ['51210', '속초'],
    ['47130', '경주'],
    ['52111', '전주'],
  ])('regionCode %s → city=%s 하나만', async (code, city) => {
    // 준비 — 서버는 항목 하나를 준다.
    serve(() => HttpResponse.json({ city, items: [ITEM] }));

    // 실행 — 지역 코드로 훅을 부른다.
    const { result } = renderCurated({ regionCode: code, isAuthed: true });

    // 단언 — 요청은 city 하나만이고 항목이 보인다.
    await waitFor(() => expect(result.current.hidden).toBe(false));
    expect(requests).toEqual([`?city=${encodeURIComponent(city)}`]);
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
