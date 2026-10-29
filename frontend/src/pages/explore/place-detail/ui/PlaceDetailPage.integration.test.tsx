import type { ReactNode } from 'react';
import { Share } from 'react-native';
import * as Linking from 'expo-linking';
import { http, HttpResponse } from 'msw';
import { QueryClientProvider } from '@tanstack/react-query';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';

import { BASE } from '@/test-support/apiBase';
import { server } from '@/mocks/server';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';
import type { Place, SavedPlace } from '@/shared/api/index.schemas';

import { resetPressGuard } from '@/shared/lib/pressGuard';

import { PlaceDetailPage } from './PlaceDetailPage';
import { newTestQueryClient } from '@/test-support/queryRender';

/**
 * TRIP-1372(TRIP-824 단건 조회) · d06 장소 상세 배선(페이지 층).
 *
 * 상세는 `GET /places/{poiId}` 단건으로 그린다 — 목록·담은목록 캐시를 훑지 않는다. 그래서 딥링크·도우미
 * `next_action` 진입처럼 앞 화면 캐시가 하나도 없어도 그려진다. 이 스위트는 QueryClient 를 비워 둔 채 msw 로
 * 단건만 내려준다.
 *
 * ★ 회귀 심판: 목록 `GET /places` 는 **한 번도 안 불려야** 한다(`placesHandler`) — 옛 캐시-전용 구현으로 되돌아가거나
 *   목록 전량(약 2MB)을 받는 구현으로 가면 깨진다. 단건 요청은 `detailHits` 로 센다.
 *
 * 무엇을 보장하나:
 *  - **D1** 캐시가 비어 있어도 단건 응답으로 상세 표면을 그린다.
 *  - **D2·D3·D4** 하트가 `useSavedPlaces` 로 서버 토글된다(담김/미담김 글리프 testID, 색 아님).
 *  - **D5** 계약에 없는 필드(소개·입장료·관련사진)는 지어내지 않는다.
 *  - **D6** 뒤로가기가 딥링크에서 갇히지 않는다(canGoBack 폴백). **D7** 공유는 Share.share 를 이름으로.
 *  - **D8** 404(없음·UNVERIFIED)는 notFound 얼굴. **D9** 조회 중에는 loading(notFound 로 성급히 접지 않는다).
 *  - **D10** 404 가 아닌 실패는 notFound 가 아니라 오류 얼굴 + 다시 시도(INV-4).
 *  - **D11** 폐업(CLOSED)·유실(LOST)도 그려지되 상태 배지가 붙는다. ACTIVE 는 배지 없음.
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

jest.mock('expo-linking', () => ({ openURL: jest.fn() }));
const mockOpenURL = Linking.openURL as jest.Mock;

const mockBack = jest.fn();
const mockReplace = jest.fn();
const mockCanGoBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({
    back: mockBack,
    replace: mockReplace,
    canGoBack: mockCanGoBack,
    push: jest.fn(),
  }),
  useLocalSearchParams: () => ({}),
}));

function makePlace(overrides: Partial<Place> = {}): Place {
  return {
    poiId: 'p1',
    nameKo: '부산시립미술관',
    category: '문화',
    lat: 35.1,
    lng: 129.1,
    region: '부산 부산진구',
    openingHours: '10:00~18:00 (월 휴관)',
    imageUrl: null,
    tags: ['미술', '실내'],
    savedCount: 12,
    dataStatus: 'ACTIVE',
    ...overrides,
  };
}

type DetailReply = Place | 404 | 500;

// GET /places 회귀 심판 — 상세는 목록을 절대 부르면 안 된다(단건만).
let placesHandler: jest.Mock;
let detailHits: string[];
let detailReply: DetailReply;
let savedRows: SavedPlace[] = [];

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
beforeEach(() => {
  savedRows = [];
  detailHits = [];
  detailReply = makePlace();
  mockBack.mockClear();
  mockOpenURL.mockReset();
  resetPressGuard();
  mockReplace.mockClear();
  mockCanGoBack.mockReset();
  mockCanGoBack.mockReturnValue(true);
  clearAccessToken();
  setAccessToken('valid-access');

  placesHandler = jest.fn(() =>
    HttpResponse.json({ items: [], nextCursor: null })
  );
  server.use(
    http.get(`${BASE}/places`, placesHandler),
    http.get(`${BASE}/places/:poiId`, ({ params }) => {
      detailHits.push(String(params.poiId));
      if (detailReply === 404 || detailReply === 500) {
        return new HttpResponse(null, { status: detailReply });
      }
      return HttpResponse.json(detailReply);
    }),
    http.get(`${BASE}/saved-places`, () => HttpResponse.json(savedRows)),
    http.post(`${BASE}/saved-places`, async ({ request }) => {
      const body = (await request.json()) as { poiId: string };
      const row: SavedPlace = {
        savedPlaceId: `saved-${body.poiId}`,
        savedAt: '2026-08-02T00:00:00Z',
        place: makePlace({ poiId: body.poiId }),
      };
      savedRows = [...savedRows, row];
      return HttpResponse.json(row, { status: 201 });
    }),
    http.delete(`${BASE}/saved-places/:savedPlaceId`, ({ params }) => {
      savedRows = savedRows.filter(
        (r) => r.savedPlaceId !== params.savedPlaceId
      );
      return new HttpResponse(null, { status: 204 });
    })
  );
});
afterEach(() => {
  server.resetHandlers();
  clearAccessToken();
});
afterAll(() => server.close());

// 빈 QueryClient 로 그린다 — 앞 화면 캐시가 없는 딥링크 진입 그대로.
function renderDetail(poiId: string): void {
  const client = newTestQueryClient({ gcTime: 0 });
  function wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  render(<PlaceDetailPage poiId={poiId} />, { wrapper });
}

describe('D1 · d06 상세 표면 렌더 — 캐시 없이 단건으로', () => {
  it('앞 화면 캐시가 비어 있어도 GET /places/{poiId} 로 그린다 — 목록은 부르지 않는다', async () => {
    renderDetail('p1');

    await waitFor(() =>
      expect(screen.getByTestId('explore-place-detail')).toBeOnTheScreen()
    );
    expect(detailHits).toEqual(['p1']);
    expect(placesHandler).not.toHaveBeenCalled();

    expect(screen.getByTestId('explore-place-hero')).toBeOnTheScreen();
    expect(screen.getByTestId('explore-place-back')).toBeOnTheScreen();
    expect(screen.getByTestId('explore-place-share')).toBeOnTheScreen();
    expect(screen.getByTestId('explore-place-save')).toBeOnTheScreen();
    expect(screen.getByTestId('explore-place-save-outline')).toBeOnTheScreen();
    expect(screen.getByTestId('explore-place-map')).toBeOnTheScreen();

    expect(screen.getByTestId('explore-place-title')).toHaveTextContent(
      '부산시립미술관'
    );
    expect(screen.getByTestId('explore-place-openhours')).toHaveTextContent(
      '10:00~18:00 (월 휴관)'
    );
    expect(screen.getByTestId('explore-place-address')).toHaveTextContent(
      '부산 부산진구'
    );
    expect(screen.getByText('#미술')).toBeOnTheScreen();
    expect(screen.getByText('#실내')).toBeOnTheScreen();
  });
});

describe('D2·D3·D4 · 저장 하트 서버 토글', () => {
  it('D2 미담김 하트를 누르면 save(place) 가 나가고 filled+selected 로 굳는다', async () => {
    renderDetail('p1');
    await waitFor(() =>
      expect(screen.getByTestId('explore-place-save-outline')).toBeOnTheScreen()
    );

    fireEvent.press(screen.getByTestId('explore-place-save'));

    await waitFor(() =>
      expect(screen.getByTestId('explore-place-save-filled')).toBeOnTheScreen()
    );
    expect(screen.queryByTestId('explore-place-save-outline')).toBeNull();
    expect(screen.getByTestId('explore-place-save')).toBeSelected();
  });

  it('D3 재진입 시 savedPoiIds 에 있으면 처음부터 filled 다', async () => {
    savedRows = [
      {
        savedPlaceId: 'saved-p1',
        savedAt: '2026-08-01T00:00:00Z',
        place: makePlace(),
      },
    ];
    renderDetail('p1');

    await waitFor(() =>
      expect(screen.getByTestId('explore-place-save-filled')).toBeOnTheScreen()
    );
    expect(screen.queryByTestId('explore-place-save-outline')).toBeNull();
    expect(screen.getByTestId('explore-place-save')).toBeSelected();
  });

  it('D4 저장 실패 시 하트가 안 굳고(롤백) 안내가 뜬다 (INV-4)', async () => {
    server.use(
      http.post(
        `${BASE}/saved-places`,
        () => new HttpResponse(null, { status: 500 })
      )
    );
    renderDetail('p1');
    await waitFor(() =>
      expect(screen.getByTestId('explore-place-save-outline')).toBeOnTheScreen()
    );

    fireEvent.press(screen.getByTestId('explore-place-save'));

    await waitFor(() =>
      expect(screen.getByTestId('explore-place-saveerror')).toBeOnTheScreen()
    );
    expect(screen.getByTestId('explore-place-save-outline')).toBeOnTheScreen();
    expect(screen.queryByTestId('explore-place-save-filled')).toBeNull();
    expect(screen.getByTestId('explore-place-save')).not.toBeSelected();
  });
});

describe('D5 · 무발명 (INV-1)', () => {
  it('계약에 없는 필드는 지어내지 않는다 — 주소=미확인, 없는 블록의 testID 부재', async () => {
    detailReply = makePlace({ region: null, openingHours: null, tags: [] });
    renderDetail('p1');
    await waitFor(() =>
      expect(screen.getByTestId('explore-place-detail')).toBeOnTheScreen()
    );

    expect(screen.getByTestId('explore-place-address')).toHaveTextContent(
      '미확인'
    );
    expect(
      screen.getByTestId('explore-place-unknown-openhours')
    ).toBeOnTheScreen();
    expect(screen.queryByTestId('explore-place-openhours')).toBeNull();

    // imageUrls·admissionFee·description 은 서버에 아직 없다(TRIP-824 잔여) — 그리지 않는다.
    expect(screen.queryByTestId('explore-place-intro')).toBeNull();
    expect(screen.queryByTestId('explore-place-fee')).toBeNull();
    expect(screen.queryByTestId('explore-place-relphotos')).toBeNull();
    expect(screen.queryByTestId('explore-place-galcount')).toBeNull();
  });
});

describe('D6 · 뒤로가기 딥링크 탈출', () => {
  it('히스토리가 있으면 back(), 딥링크면 홈으로 replace 한다', async () => {
    renderDetail('p1');
    await waitFor(() =>
      expect(screen.getByTestId('explore-place-back')).toBeOnTheScreen()
    );
    fireEvent.press(screen.getByTestId('explore-place-back'));
    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockReplace).not.toHaveBeenCalled();

    mockBack.mockClear();
    mockCanGoBack.mockReturnValue(false);
    renderDetail('p1');
    const backs = await screen.findAllByTestId('explore-place-back');
    fireEvent.press(backs[backs.length - 1]);
    expect(mockReplace).toHaveBeenCalledWith('/(tabs)');
    expect(mockBack).not.toHaveBeenCalled();
  });
});

describe('D7 · 공유 실동작', () => {
  it('공유를 누르면 Share.share 가 place.nameKo 로 불린다', async () => {
    const spy = jest
      .spyOn(Share, 'share')
      .mockResolvedValue({ action: 'sharedAction' } as never);

    renderDetail('p1');
    await waitFor(() =>
      expect(screen.getByTestId('explore-place-share')).toBeOnTheScreen()
    );

    fireEvent.press(screen.getByTestId('explore-place-share'));

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0].message).toBe('부산시립미술관');
    spy.mockRestore();
  });
});

describe('D12 · 네이버 지도에서 보기', () => {
  const APP_URL = `nmap://place?lat=35.1&lng=129.1&name=${encodeURIComponent('부산시립미술관')}&appname=com.trippilot.travel`;
  const WEB_URL = `https://map.naver.com/p/search/${encodeURIComponent('부산시립미술관')}`;

  async function renderAndPress(): Promise<void> {
    renderDetail('p1');
    await waitFor(() =>
      expect(screen.getByTestId('explore-place-open-naver')).toBeOnTheScreen()
    );
    fireEvent.press(screen.getByTestId('explore-place-open-naver'));
  }

  it('누르면 앱 URL 을 연다 — 같은 틱 두 번 눌러도 한 번이다', async () => {
    mockOpenURL.mockResolvedValue(undefined);
    renderDetail('p1');
    await waitFor(() =>
      expect(screen.getByTestId('explore-place-open-naver')).toBeOnTheScreen()
    );
    fireEvent.press(screen.getByTestId('explore-place-open-naver'));
    fireEvent.press(screen.getByTestId('explore-place-open-naver'));

    await waitFor(() => expect(mockOpenURL).toHaveBeenCalledTimes(1));
    expect(mockOpenURL).toHaveBeenCalledWith(APP_URL);
    expect(screen.queryByTestId('explore-place-opennaver-error')).toBeNull();
  });

  it('한 번 실패해 배너가 뜬 뒤 다시 눌러 성공하면 배너가 사라진다', async () => {
    mockOpenURL.mockRejectedValueOnce(new Error('x'));
    mockOpenURL.mockRejectedValueOnce(new Error('x'));
    mockOpenURL.mockResolvedValue(undefined);
    await renderAndPress();
    expect(
      await screen.findByTestId('explore-place-opennaver-error')
    ).toBeOnTheScreen();

    resetPressGuard();
    fireEvent.press(screen.getByTestId('explore-place-open-naver'));
    await waitFor(() =>
      expect(screen.queryByTestId('explore-place-opennaver-error')).toBeNull()
    );
  });

  it('앱이 없어 reject 되면 웹 URL 로 강등한다', async () => {
    mockOpenURL.mockRejectedValueOnce(new Error('no app'));
    mockOpenURL.mockResolvedValueOnce(undefined);
    await renderAndPress();

    await waitFor(() => expect(mockOpenURL).toHaveBeenCalledTimes(2));
    expect(mockOpenURL).toHaveBeenLastCalledWith(WEB_URL);
    expect(screen.queryByTestId('explore-place-opennaver-error')).toBeNull();
  });

  it('앱·웹 모두 실패하면 안내 배너를 띄운다(INV-4)', async () => {
    mockOpenURL.mockRejectedValue(new Error('x'));
    await renderAndPress();

    expect(
      await screen.findByTestId('explore-place-opennaver-error')
    ).toBeOnTheScreen();
  });
});

describe('D8·D9·D10 · 얼굴 판정', () => {
  it('D8 단건이 404(없음·UNVERIFIED)면 notFound 얼굴이다', async () => {
    detailReply = 404;
    renderDetail('ghost');

    await waitFor(() =>
      expect(screen.getByTestId('explore-place-notfound')).toBeOnTheScreen()
    );
    expect(detailHits).toEqual(['ghost']);
    expect(screen.queryByTestId('explore-place-detail')).toBeNull();
    expect(screen.queryByTestId('explore-place-error')).toBeNull();
    expect(placesHandler).not.toHaveBeenCalled();
  });

  it('D9 응답 전에는 loading 만 그린다(notFound·상세로 성급히 접지 않는다)', async () => {
    renderDetail('p1');

    expect(screen.getByTestId('explore-place-loading')).toBeOnTheScreen();
    expect(screen.queryByTestId('explore-place-notfound')).toBeNull();
    expect(screen.queryByTestId('explore-place-detail')).toBeNull();

    await waitFor(() =>
      expect(screen.getByTestId('explore-place-detail')).toBeOnTheScreen()
    );
    expect(screen.queryByTestId('explore-place-loading')).toBeNull();
  });

  it('D10 404 가 아닌 실패는 notFound 가 아니라 오류 얼굴이고, 다시 시도하면 다시 묻는다 (INV-4)', async () => {
    detailReply = 500;
    renderDetail('p1');

    await waitFor(() =>
      expect(screen.getByTestId('explore-place-error')).toBeOnTheScreen()
    );
    expect(screen.queryByTestId('explore-place-notfound')).toBeNull();
    expect(detailHits).toHaveLength(1);

    detailReply = makePlace();
    fireEvent.press(screen.getByTestId('explore-place-retry'));

    await waitFor(() =>
      expect(screen.getByTestId('explore-place-detail')).toBeOnTheScreen()
    );
    expect(detailHits).toHaveLength(2);
  });

  it('D10 오류 얼굴에도 뒤로가 있다(딥링크에서 갇히지 않는다)', async () => {
    detailReply = 500;
    mockCanGoBack.mockReturnValue(false);
    renderDetail('p1');
    await waitFor(() =>
      expect(screen.getByTestId('explore-place-error')).toBeOnTheScreen()
    );

    fireEvent.press(screen.getByTestId('explore-place-error-back'));

    expect(mockReplace.mock.calls).toEqual([['/(tabs)']]);
    expect(mockBack).not.toHaveBeenCalled();
  });
});

describe('D11 · 폐업·유실 장소도 그리되 상태를 알린다', () => {
  it.each([
    ['CLOSED', '폐업'],
    ['LOST', '미확인'],
  ] as const)('%s → "%s" 배지', async (dataStatus, label) => {
    detailReply = makePlace({ dataStatus });
    renderDetail('p1');

    await waitFor(() =>
      expect(screen.getByTestId('explore-place-detail')).toBeOnTheScreen()
    );
    expect(screen.getByTestId('explore-place-status-badge')).toHaveTextContent(
      label
    );
  });

  it('ACTIVE 는 배지가 없다', async () => {
    renderDetail('p1');
    await waitFor(() =>
      expect(screen.getByTestId('explore-place-detail')).toBeOnTheScreen()
    );
    expect(screen.queryByTestId('explore-place-status-badge')).toBeNull();
  });
});

// ── TRIP-1015 D · d06 장소 없음 얼굴에도 뒤로가 있다 (QA #096 · US-SHELL-04 예외 · 결정 3) ──
// 상세 얼굴의 뒤로(`explore-place-back`)와 같은 폴백 규칙(canGoBack → back, 아니면 홈 replace)을 쓰되,
// testID 는 따로 둔다. 안내(StateNotice)엔 행동 버튼을 두지 않는다(결정 3).
describe('🔴 1015-D · d06 장소 없음 얼굴의 뒤로 (explore-place-notfound-back)', () => {
  async function renderNotFound(): Promise<void> {
    detailReply = 404;
    renderDetail('ghost');
    await waitFor(() =>
      expect(screen.getByTestId('explore-place-notfound')).toBeOnTheScreen()
    );
  }

  it('D1 뒤로 버튼이 있고(역할 button · 이름 "뒤로"), 안내 밖에 있으며, 안내엔 행동 버튼이 없다', async () => {
    await renderNotFound();

    // 역할 button · 접근성 이름 "뒤로"인 요소가 정확히 그 testID 다(스크린리더로도 찾을 수 있다).
    const back = screen.getByRole('button', { name: '뒤로' });
    expect(back).toHaveProp('testID', 'explore-place-notfound-back');
    const notFound = screen.getByTestId('explore-place-notfound');
    expect(
      within(notFound).queryByTestId('explore-place-notfound-back')
    ).toBeNull();
    expect(within(notFound).queryAllByRole('button')).toHaveLength(0);
  });

  it('D2 히스토리가 있으면 back 1회 · replace 0회', async () => {
    await renderNotFound();

    fireEvent.press(screen.getByTestId('explore-place-notfound-back'));

    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('D3 딥링크(히스토리 없음)면 홈으로 replace 1회 · back 0회', async () => {
    mockCanGoBack.mockReturnValue(false);
    await renderNotFound();

    fireEvent.press(screen.getByTestId('explore-place-notfound-back'));

    expect(mockReplace.mock.calls).toEqual([['/(tabs)']]);
    expect(mockBack).not.toHaveBeenCalled();
  });
});
