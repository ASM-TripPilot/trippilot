import * as Linking from 'expo-linking';
import { http, HttpResponse } from 'msw';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';

import { server } from '@/mocks/server';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';
import type { CuratedStay, SavedStay } from '@/shared/api/index.schemas';
import { BASE } from '@/test-support/apiBase';
import { createGcZeroWrapper } from '@/test-support/queryRender';

import {
  CuratedStaysSection,
  CuratedStaysSheet,
  useCuratedStaysController,
  type CuratedStaysProps,
} from './CuratedStaysSection';

/**
 * TRIP-1579 — 인기 숙소 줄 + Trip.com 전체 보기 + 제휴 시트를 한 덩어리로 조립한 위젯.
 *
 *  - S1 카드 누름 → 고지 시트(Trip.com · 가격 칸 없음) → [이동]이 인기 숙소 상세 아웃바운드(+여행 맥락)를 연다.
 *  - S2 목록이 비면 카드 줄은 없고 전체 보기만 남는다 → 시트 → 지역 목록 아웃바운드.
 *  - S3 하트(로그인) → POST 본문에 lat/lng 키가 없고 좌표 미확정이다.
 *  - S4 showBrowseAll=false + 빈 목록 → 아무 버튼도 없다(죽은 버튼 금지 — 줄도 없으니 빈 덩어리).
 *  - S5 게스트 → 인기 숙소 요청 0(인증 필요 계약) · 전체 보기만, 시트에 "다시 보지 않기" 없음.
 *  - S6 컨트롤러 + 두 조각(TRIP-1580 보완) — 줄(Section)은 시트를 그리지 않고 시트 조각(Sheet)이 그린다.
 *  - S7 regionCode 가 없으면 city(이름)로 조회한다.
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

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockPush(...args) },
}));

jest.mock('expo-linking', () => ({
  openURL: jest.fn().mockResolvedValue(true),
  canOpenURL: jest.fn().mockResolvedValue(true),
}));

const mockOpenURL = Linking.openURL as jest.Mock;

const STAY: CuratedStay = {
  rank: 1,
  stayId: 'TRIPCOM:123',
  name: '해운대 그랜드 호텔',
  address: null,
  imageUrl: 'https://ak-d.tripcdn.com/images/a.jpg',
};
const TRIP = { checkin: '2026-11-01', checkout: '2026-11-03', adults: 2 };
const TRIP_QS = 'checkin=2026-11-01&checkout=2026-11-03&adults=2';

let curatedHits = 0;
let postBodies: unknown[] = [];
let savedRows: SavedStay[] = [];

function serve(items: CuratedStay[]): void {
  server.use(
    http.get(`${BASE}/stays/curated`, () => {
      curatedHits += 1;
      return HttpResponse.json({ city: '부산', items });
    }),
    http.get(`${BASE}/me/settings`, () =>
      HttpResponse.json({ affiliateNoticeDismissed: false })
    ),
    // 담은 목록은 상태형 — POST 가 행을 더하고 GET 이 돌려준다(성공 뒤 재조회에도 담김이 남는다).
    http.get(`${BASE}/saved-stays`, () => HttpResponse.json(savedRows)),
    http.post(`${BASE}/saved-stays`, async ({ request }) => {
      postBodies.push(await request.json());
      const row: SavedStay = {
        savedStayId: '99999999-9999-9999-9999-999999999999',
        name: STAY.name,
        coordConfirmed: false,
        linkedTripIds: [],
        registerRoute: 'MAP_SEARCH',
        externalSource: 'TRIPCOM',
        externalId: '123',
        createdAt: '2026-10-22T00:00:00Z',
        updatedAt: '2026-10-22T00:00:00Z',
      };
      savedRows.push(row);
      return HttpResponse.json(row, { status: 201 });
    })
  );
}

// 소비처 모양 그대로 — 훅은 한 번, 줄과 시트는 형제(시트는 화면 루트에 둔다).
function Harness({
  withSheet = true,
  ...props
}: CuratedStaysProps & { withSheet?: boolean }) {
  const controller = useCuratedStaysController(props);
  return (
    <>
      <CuratedStaysSection controller={controller} />
      {withSheet ? <CuratedStaysSheet controller={controller} /> : null}
    </>
  );
}

function renderSection(
  props: Partial<CuratedStaysProps> & { withSheet?: boolean } = {}
) {
  return render(
    <Harness
      regionCode="26"
      regionName="부산"
      trip={TRIP}
      variant="list"
      {...props}
    />,
    { wrapper: createGcZeroWrapper() }
  );
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
beforeEach(() => {
  curatedHits = 0;
  postBodies = [];
  savedRows = [];
  mockPush.mockClear();
  mockOpenURL.mockClear();
  mockOpenURL.mockResolvedValue(true);
  clearAccessToken();
});
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('S1 · 카드 누름 → 고지 시트 → 인기 숙소 상세 아웃바운드', () => {
  it('시트가 먼저 뜨고(이동 0), [이동]에서 여행 맥락을 붙여 연다', async () => {
    setAccessToken('valid-access');
    serve([STAY]);
    renderSection();

    fireEvent.press(await screen.findByTestId('curated-stay-card-123'));

    const sheet = await screen.findByTestId('stay-ota-sheet');
    expect(mockOpenURL).not.toHaveBeenCalled();
    const row = within(sheet).getByTestId('stay-ota-option-TRIPCOM');
    expect(within(row).getByText('Trip.com')).toBeOnTheScreen();
    expect(within(row).queryByText('·')).toBeNull();

    await act(async () => {
      fireEvent.press(screen.getByTestId('stay-ota-confirm'));
    });

    await waitFor(() =>
      expect(mockOpenURL).toHaveBeenCalledWith(
        `${BASE}/stays/TRIPCOM%3A123/outbound?${TRIP_QS}`
      )
    );
    await waitFor(() =>
      expect(screen.queryByTestId('stay-ota-sheet')).toBeNull()
    );
  });
});

describe('S2 · 빈 목록 → 카드 줄 없음 + 전체 보기만', () => {
  it('카드가 없고, 전체 보기 → 시트 → 지역 목록 아웃바운드', async () => {
    setAccessToken('valid-access');
    serve([]);
    renderSection();

    await waitFor(() => expect(curatedHits).toBe(1));
    const browse = await screen.findByTestId('curated-stay-browse-all');
    // 응답이 도착한 뒤에도 줄은 없다.
    await act(async () => {});
    expect(screen.queryByTestId('curated-stays-row')).toBeNull();

    fireEvent.press(browse);
    await screen.findByTestId('stay-ota-sheet');
    await act(async () => {
      fireEvent.press(screen.getByTestId('stay-ota-confirm'));
    });

    await waitFor(() =>
      expect(mockOpenURL).toHaveBeenCalledWith(
        `${BASE}/stays/browse/outbound?region=${encodeURIComponent('부산')}&regionCode=26&${TRIP_QS}`
      )
    );
  });
});

describe('S3 · 하트 → 좌표 없이 담기', () => {
  it('POST 본문에 lat/lng 키가 없고 coordConfirmed:false 이며, 카드 시트는 열리지 않는다', async () => {
    setAccessToken('valid-access');
    serve([STAY]);
    renderSection();

    fireEvent.press(await screen.findByTestId('curated-stay-heart-123'));

    await waitFor(() => expect(postBodies).toHaveLength(1));
    expect(postBodies[0]).toEqual({
      name: '해운대 그랜드 호텔',
      registerRoute: 'MAP_SEARCH',
      coordConfirmed: false,
      externalSource: 'TRIPCOM',
      externalId: '123',
    });
    expect(screen.queryByTestId('stay-ota-sheet')).toBeNull();
    await waitFor(() =>
      expect(screen.getByTestId('curated-stay-heart-123')).toBeSelected()
    );
  });
});

describe('S4 · showBrowseAll=false', () => {
  it('목록이 있으면 카드만, 버튼은 없다', async () => {
    setAccessToken('valid-access');
    serve([STAY]);
    renderSection({ showBrowseAll: false });

    expect(
      await screen.findByTestId('curated-stay-card-123')
    ).toBeOnTheScreen();
    expect(screen.queryByTestId('curated-stay-browse-all')).toBeNull();
  });
});

describe('S5 · 게스트', () => {
  it('인기 숙소 요청 0 · 전체 보기만 · 시트에 "다시 보지 않기" 없음', async () => {
    serve([STAY]);
    renderSection();

    fireEvent.press(screen.getByTestId('curated-stay-browse-all'));
    await screen.findByTestId('stay-ota-sheet');

    expect(screen.queryByTestId('curated-stay-card-123')).toBeNull();
    expect(screen.queryByTestId('stay-ota-dont-show')).toBeNull();
    expect(curatedHits).toBe(0);
  });
});

describe('S6 · 줄과 시트는 따로 그린다', () => {
  it('시트 조각이 없으면 카드를 눌러도 줄 안에 시트가 생기지 않는다', async () => {
    setAccessToken('valid-access');
    serve([STAY]);
    renderSection({ withSheet: false });

    fireEvent.press(await screen.findByTestId('curated-stay-card-123'));
    await act(async () => {});

    expect(screen.queryByTestId('stay-ota-sheet')).toBeNull();
  });
});

describe('S7 · 지역 코드가 없으면 이름(city)으로 조회', () => {
  it('city 쿼리로 묻고 카드를 그린다', async () => {
    setAccessToken('valid-access');
    let seen: string | null = null;
    serve([STAY]);
    server.use(
      http.get(`${BASE}/stays/curated`, ({ request }) => {
        seen = new URL(request.url).search;
        return HttpResponse.json({ city: '부산', items: [STAY] });
      })
    );
    renderSection({ regionCode: undefined, city: '부산' });

    expect(
      await screen.findByTestId('curated-stay-card-123')
    ).toBeOnTheScreen();
    expect(seen).toBe(`?city=${encodeURIComponent('부산')}`);
  });
});
