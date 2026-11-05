import { http, HttpResponse } from 'msw';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';
import { QueryObserver } from '@tanstack/react-query';
import type { ReactTestInstance } from 'react-test-renderer';

import { rememberSpontaneousName } from '@/features/check-visit/index.view';
import { server } from '@/mocks/server';
import type {
  ActualVisit,
  PlannedSlot,
  Trip,
  TripRecord,
  TripRecordDay,
  VisitPhoto,
} from '@/shared/api/index.schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';
import { resetPressGuard } from '@/shared/lib/pressGuard';
import { BASE } from '@/test-support/apiBase';
import { createRequestLog } from '@/test-support/mswItinerary';
import { createGate } from '@/test-support/mswHookHarness';
import { createWrapper, newTestQueryClient } from '@/test-support/queryRender';
import { tripRecordsTrip } from '@/test-support/tripRecordsTrip';

import { TripAlbumPage } from './TripAlbumPage';

/**
 * TRIP-1798 · 여행 앨범 화면 — "일차 → 장소 → 사진 3열" 을 이 기기에서 붙인 사진만으로 보여 준다.
 * 초심자용: 아래 `serve()` 가 가짜 서버(여행·여행 기록·방문별 사진 목록)를 세우고, `getInstallId`(이 기기 번호)와 `resolvePhotoUri`
 * (기기 앨범에서 사진 주소 찾기)는 가짜 함수로 바꾼다. 화면을 그린 뒤 이름표(testID)와 문구, 서버를 몇 번 불렀는지를 확인한다.
 *
 * 무엇을 보장하나:
 *  - AC1 정상: 일차 묶음·사진 셀·제목 장수·안내 줄. 이름은 **기록 응답의 일정 칸**(`planned[].nameKo`)에서 오고 일정 GET 은 부르지 않는다.
 *  - AC2 기기: 다른 기기 사진은 셀이 없고 「다른 기기 사진 N장」만 알린다. 기기 번호를 모르면 아무것도 그리지 않는다.
 *  - AC3 빈: 이 기기에서 볼 사진이 0장이면 빈 안내. 단 기기 번호를 **읽는 중**에는 빈 안내를 그리지 않는다(깜빡임 방지).
 *  - AC4 실패: 기록 조회 실패는 빈 앨범이 아니라 오류 + 다시 시도. 방문 하나의 사진 목록 실패(404 제외)는 한 줄 오류 + 그 방문만 다시.
 *  - Q5 앨범에서 못 푼 사진은 「불러올 수 없는 사진 M장」, Q6 제목 장수 = 실제로 그린 장수, Q9 여행 조회 실패 시 날짜 없는 제목.
 *  - 맹점: 기록 조회 인자 `changeLimit=1` 은 j04 표지 훅과 같아야 캐시를 같이 쓴다.
 * 사진 셀 크기·3열·간격·r12(생김새)는 jest 가 못 본다 — 기능 지도·실화면 QA 몫.
 */

const mockGetInstallId = jest.fn();
jest.mock('@/shared/storage', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest
    .fn()
    .mockResolvedValue({ accessToken: 'a', refreshToken: 'r' }),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  hasStoredToken: jest.fn().mockResolvedValue(true),
  getInstallId: () => mockGetInstallId(),
}));

// `gone` 으로 시작하는 앨범 번호는 이 기기 앨범에 없는(원본 삭제) 사진.
// `slow` 로 시작하는 번호는 `mockSlowUriGate` 가 열릴 때까지 주소 찾기가 끝나지 않는다(TRIP-1798 5-b 이후 W1).
let mockSlowUriGate: Promise<void> = Promise.resolve();
jest.mock('@/shared/photo', () => ({
  canResolveDevicePhotos: () => true,
  resolvePhotoUri: async (id: string) => {
    if (id.startsWith('slow')) await mockSlowUriGate;
    return id.startsWith('gone') ? null : `file://${id}`;
  },
}));

const mockBack = jest.fn();
const mockReplace = jest.fn();
const mockRouterState = { canGoBack: true };
jest.mock('expo-router', () => {
  const router = {
    back: (...args: unknown[]) => mockBack(...args),
    replace: (...args: unknown[]) => mockReplace(...args),
    push: jest.fn(),
    canGoBack: () => mockRouterState.canGoBack,
  };
  return { router, useRouter: () => router };
});

const TRIP_ID = 'trip-1';
const ME = 'me';

const planned = (date: string, poiId: string, nameKo: string): PlannedSlot => ({
  slotKey: `${date}#${poiId}`,
  date,
  poiId,
  orderIndex: 0,
  startAt: '10:00',
  endAt: '11:00',
  endsNextDay: false,
  isFixed: false,
  hasViolation: false,
  nameKo,
});
const visit = (
  id: string,
  poiId: string,
  photoCount: number,
  over: Partial<ActualVisit> = {}
): ActualVisit => ({
  visitCheckId: id,
  poiId,
  spontaneous: false,
  photoCount,
  hasMemo: false,
  updatedAt: '2026-06-10T10:00:00Z',
  ...over,
});
const day = (
  date: string,
  actual: ActualVisit[],
  slots: PlannedSlot[] = []
): TripRecordDay => ({
  date,
  planned: slots,
  actual,
  unvisitedSlotKeys: [],
});
const photo = (id: string, sortOrder = 0, deviceId = ME): VisitPhoto => ({
  visitPhotoMetaId: `meta-${id}`,
  localAssetId: id,
  deviceId,
  sortOrder,
});

const trip = (over: Partial<Trip> = {}): Trip => ({
  ...tripRecordsTrip('강남구 여행', TRIP_ID),
  startDate: '2026-06-10',
  endDate: '2026-06-11',
  ...over,
});

/** 표준 기록: 1일차 코엑스 3장·봉은사 1장, 2일차 광안리 2장 = 6장. */
function standardRecord(): TripRecord {
  return {
    tripId: TRIP_ID,
    days: [
      day(
        '2026-06-10',
        [visit('v1', 'poiA', 3), visit('v2', 'poiB', 1)],
        [
          planned('2026-06-10', 'poiA', '코엑스'),
          planned('2026-06-10', 'poiB', '봉은사'),
        ]
      ),
      day(
        '2026-06-11',
        [visit('v3', 'poiC', 2)],
        [planned('2026-06-11', 'poiC', '광안리')]
      ),
    ],
    changes: [],
  };
}
const standardPhotos = (): Record<string, () => Reply<VisitPhoto[]>> => ({
  v1: () => [photo('a2', 2), photo('a0', 0), photo('a1', 1)],
  v2: () => [photo('b0')],
  v3: () => [photo('c1', 1), photo('c0', 0)],
});

type Reply<T> = T | Response | Promise<T | Response>;
const recordsUrls: string[] = [];

function serve({
  tripReply = () => trip(),
  record = standardRecord,
  photos = standardPhotos(),
}: {
  tripReply?: () => Reply<Trip>;
  record?: () => Reply<TripRecord>;
  photos?: Record<string, () => Reply<VisitPhoto[]>>;
} = {}) {
  const asResponse = async <T,>(reply: Reply<T>): Promise<Response> => {
    const body = await reply;
    return body instanceof Response ? body : HttpResponse.json(body as object);
  };
  server.use(
    http.get(`${BASE}/trips/:tripId`, () => asResponse(tripReply())),
    http.get(`${BASE}/trips/:tripId/records`, ({ request }) => {
      recordsUrls.push(request.url);
      return asResponse(record());
    }),
    http.get(
      `${BASE}/trips/:tripId/visits/:visitCheckId/photos`,
      async ({ params }) => {
        const make = photos[String(params.visitCheckId)];
        if (!make) return new HttpResponse(null, { status: 404 });
        const reply = await make();
        if (reply instanceof Response) return reply;
        return HttpResponse.json({ items: reply, count: reply.length });
      }
    )
  );
}

const requests = createRequestLog(server);
const hits = (method: string, includes: string) =>
  requests.hitsFor(method, includes);

function renderAlbum(client = newTestQueryClient()) {
  render(<TripAlbumPage tripId={TRIP_ID} />, {
    wrapper: createWrapper(client),
  });
}
const cell = (metaId: string) =>
  screen.queryByTestId(`trip-album-photo-${metaId}`);
const cells = () => screen.queryAllByTestId(/^trip-album-photo-meta-/);
const sourceOf = (node: ReactTestInstance) =>
  ([] as unknown[]).concat(node.props.source);
const isTouchable = (node: ReactTestInstance) =>
  typeof node.props.onStartShouldSetResponder === 'function' ||
  typeof node.props.onClick === 'function';
const settleScreen = () => new Promise((resolve) => setTimeout(resolve, 60));

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  requests.attach();
});
beforeEach(() => {
  requests.reset();
  recordsUrls.length = 0;
  mockGetInstallId.mockReset().mockResolvedValue(ME);
  mockSlowUriGate = Promise.resolve();
  mockRouterState.canGoBack = true;
  setAccessToken('a');
});
let refetchSpy: jest.SpyInstance | undefined;
afterEach(() => {
  refetchSpy?.mockRestore();
  refetchSpy = undefined;
  resetPressGuard();
  server.resetHandlers();
  clearAccessToken();
  mockBack.mockClear();
  mockReplace.mockClear();
});
afterAll(() => server.close());

describe('🔴 TRIP-1798 · 여행 앨범 — 정상·기기·이름 (AC1·2·7·8)', () => {
  it('P1 일차·장소·사진이 서고 제목은 보이는 장수이며, 일정 GET 은 부르지 않고 소요시간 문구도 없다', async () => {
    serve();
    renderAlbum();

    const day1 = await screen.findByTestId('trip-album-day-1');
    const day2 = screen.getByTestId('trip-album-day-2');
    expect(screen.getByTestId('trip-album-screen')).toBeOnTheScreen();
    expect(within(day1).getByText('1일차 · 6월 10일(수)')).toBeOnTheScreen();
    expect(within(day2).getByText('2일차 · 6월 11일(목)')).toBeOnTheScreen();
    const place1 = within(screen.getByTestId('trip-album-place-v1'));
    expect(place1.getByText('코엑스')).toBeOnTheScreen();
    expect(place1.getByText('3장')).toBeOnTheScreen();
    expect(
      within(screen.getByTestId('trip-album-place-v3')).getByText('광안리')
    ).toBeOnTheScreen();

    await waitFor(() => expect(cells()).toHaveLength(6));
    // 이 기기 앨범의 주소로 그려지고, 누를 수 없다(Q8). 장소 안 순서는 sortOrder(응답은 2,0,1 로 섞여 옴).
    expect(sourceOf(screen.getByTestId('trip-album-photo-meta-a0'))).toEqual([
      { uri: 'file://a0' },
    ]);
    expect(isTouchable(screen.getByTestId('trip-album-photo-meta-a0'))).toBe(
      false
    );
    const order = within(screen.getByTestId('trip-album-place-v1'))
      .getAllByTestId(/^trip-album-photo-meta-/)
      .map((n) => n.props.testID);
    expect(order).toEqual([
      'trip-album-photo-meta-a0',
      'trip-album-photo-meta-a1',
      'trip-album-photo-meta-a2',
    ]);
    expect(screen.getByTestId('trip-album-title')).toHaveTextContent(
      '강남구 여행 · 사진 6장'
    );
    expect(screen.getByText('이 기기에 있는 사진만 보여요')).toBeOnTheScreen();
    expect(screen.queryByTestId('trip-album-other-device-notice')).toBeNull();
    expect(screen.queryByTestId('trip-album-unresolved-notice')).toBeNull();
    expect(screen.queryByTestId('trip-album-empty')).toBeNull();

    expect(hits('GET', '/itinerary')).toBe(0); // 이름은 기록 응답의 planned[].nameKo
    expect(screen.queryByText(/\d+\s*분|소요/)).toBeNull(); // INV-3
  });

  it('P2 다른 기기 사진 3장은 셀이 없고 「다른 기기 사진 3장」만 알리며 제목 장수에서도 빠진다', async () => {
    serve({
      photos: {
        ...standardPhotos(),
        v2: () => [
          photo('b0'),
          photo('x0', 1, 'tablet'),
          photo('x1', 2, 'tablet'),
          photo('x2', 3, 'tablet'),
        ],
      },
    });
    renderAlbum();

    await waitFor(() => expect(cells()).toHaveLength(6));
    expect(cell('x0')).toBeNull();
    expect(cell('x1')).toBeNull();
    expect(cell('x2')).toBeNull();
    expect(
      screen.getByTestId('trip-album-other-device-notice')
    ).toHaveTextContent('다른 기기 사진 3장');
    expect(screen.getByTestId('trip-album-title')).toHaveTextContent(
      '강남구 여행 · 사진 6장'
    );
  });

  it('P9 이름: 일정 칸 → 즉석 방문 이름 → 그날 N번째 장소, 지어내지 않는다', async () => {
    const client = newTestQueryClient();
    rememberSpontaneousName(client, TRIP_ID, 'poiX', '즉석 카페');
    serve({
      record: () => ({
        tripId: TRIP_ID,
        days: [
          day(
            '2026-06-10',
            [
              visit('v1', 'poiA', 1),
              visit('v2', 'poiX', 1),
              visit('v3', 'poiZ', 1),
            ],
            [planned('2026-06-10', 'poiA', '코엑스')]
          ),
        ],
        changes: [],
      }),
      photos: {
        v1: () => [photo('p1')],
        v2: () => [photo('p2')],
        v3: () => [photo('p3')],
      },
    });
    renderAlbum(client);

    await screen.findByTestId('trip-album-place-v1');
    expect(
      within(screen.getByTestId('trip-album-place-v1')).getByText('코엑스')
    ).toBeOnTheScreen();
    expect(
      within(screen.getByTestId('trip-album-place-v2')).getByText('즉석 카페')
    ).toBeOnTheScreen();
    expect(
      within(screen.getByTestId('trip-album-place-v3')).getByText('3번째 장소')
    ).toBeOnTheScreen();
  });

  it('P10 여행 조회가 실패해도 앨범은 서고 제목은 `이번 여행`, 일차 제목은 날짜 없이 `1일차`다', async () => {
    serve({ tripReply: () => new HttpResponse(null, { status: 500 }) });
    renderAlbum();

    const day1 = await screen.findByTestId('trip-album-day-1');
    expect(within(day1).getByText('1일차')).toBeOnTheScreen();
    await waitFor(() => expect(cells()).toHaveLength(6));
    expect(screen.getByTestId('trip-album-title')).toHaveTextContent(
      '이번 여행 · 사진 6장'
    );
  });

  it('P11 기록 조회는 `changeLimit=1` 로 부른다 — j04 표지 훅과 같은 캐시 키', async () => {
    serve();
    renderAlbum();

    await screen.findByTestId('trip-album-day-1');
    expect(recordsUrls).toHaveLength(1);
    expect(new URL(recordsUrls[0]).searchParams.get('changeLimit')).toBe('1');
  });
});

describe('🔴 TRIP-1798 · 여행 앨범 — 빈 앨범·기기 번호 (AC2·3)', () => {
  it.each([
    ['기기 번호가 null', () => mockGetInstallId.mockResolvedValue(null)],
    [
      '기기 번호 조회가 실패',
      () => mockGetInstallId.mockRejectedValue(new Error('storage')),
    ],
  ])(
    'P3 %s 이면 사진을 하나도 그리지 않고 빈 안내가 선다(오류 얼굴 아님)',
    async (_label, arrange) => {
      arrange();
      serve();
      renderAlbum();

      expect(await screen.findByTestId('trip-album-empty')).toHaveTextContent(
        '이 기기에서 볼 수 있는 사진이 없어요'
      );
      expect(cells()).toHaveLength(0);
      expect(screen.queryByTestId('trip-album-error')).toBeNull();
    }
  );

  it('P4 이 기기 사진이 0장이면(전부 다른 기기·사진 없는 방문) 빈 안내가 서고 일차 묶음은 없으며, 사진 0장 방문은 목록 GET 을 하지 않는다', async () => {
    serve({
      record: () => ({
        tripId: TRIP_ID,
        days: [
          day(
            '2026-06-10',
            [visit('v1', 'poiA', 2), visit('v2', 'poiB', 0)],
            [planned('2026-06-10', 'poiA', '코엑스')]
          ),
        ],
        changes: [],
      }),
      photos: {
        v1: () => [photo('x0', 0, 'tablet'), photo('x1', 1, 'tablet')],
      },
    });
    renderAlbum();

    expect(await screen.findByTestId('trip-album-empty')).toBeOnTheScreen();
    expect(screen.queryByTestId('trip-album-day-1')).toBeNull();
    expect(
      screen.getByTestId('trip-album-other-device-notice')
    ).toHaveTextContent('다른 기기 사진 2장');
    expect(hits('GET', '/visits/v1/photos')).toBe(1);
    expect(hits('GET', '/visits/v2/photos')).toBe(0);
  });

  it('P7 기기 번호를 읽는 중에는 빈 안내도 사진도 없고, 읽히면 사진이 선다 (깜빡임 방지)', async () => {
    const gate = createGate();
    mockGetInstallId.mockReturnValue(gate.opened.then(() => ME));
    serve();
    renderAlbum();

    await waitFor(() => expect(hits('GET', '/trips/trip-1/records')).toBe(1));
    await settleScreen();
    expect(screen.queryByTestId('trip-album-empty')).toBeNull();
    expect(cells()).toHaveLength(0);

    gate.release();

    await waitFor(() => expect(cells()).toHaveLength(6));
    expect(screen.queryByTestId('trip-album-empty')).toBeNull();
  });

  // TRIP-1798 5-b 이후 W1 — 빈 안내는 "목록·주소가 다 정해진 뒤"에만. 대기 중에 서면 사진 있는 여행에서 안내가 번쩍인다.
  it('P13 방문 사진 목록이 아직 오는 중이면 빈 안내가 없고, 도착하면 사진이 선다 (깜빡임 방지)', async () => {
    const gate = createGate();
    const later = (items: VisitPhoto[]) => async () => {
      await gate.opened;
      return items;
    };
    serve({
      photos: {
        v1: later([photo('a0')]),
        v2: later([photo('b0')]),
        v3: later([photo('c0')]),
      },
    });
    renderAlbum();

    // 기록은 도착해 앨범 화면이 서 있지만(로딩 얼굴 아님) 사진 목록 세 건은 대기 중
    await screen.findByTestId('trip-album-screen');
    await waitFor(() => expect(hits('GET', '/visits/v3/photos')).toBe(1));
    await settleScreen();
    expect(screen.queryByTestId('trip-album-empty')).toBeNull();
    expect(cells()).toHaveLength(0);

    gate.release();

    await waitFor(() => expect(cells()).toHaveLength(3));
    expect(screen.queryByTestId('trip-album-empty')).toBeNull();
  });

  it('P14 사진 주소를 앨범에서 찾는 중이면 빈 안내가 없고, 찾으면 사진이 선다 (깜빡임 방지)', async () => {
    const gate = createGate();
    mockSlowUriGate = gate.opened;
    serve({
      record: () => ({
        tripId: TRIP_ID,
        days: [
          day(
            '2026-06-10',
            [visit('v1', 'poiA', 1)],
            [planned('2026-06-10', 'poiA', '코엑스')]
          ),
        ],
        changes: [],
      }),
      photos: { v1: () => [photo('slow-a0')] },
    });
    renderAlbum();

    // 사진 목록은 왔고(GET 1회) 주소 찾기만 대기 중 → 보일 사진 0장이어도 아직 "없음"이 아니다
    await waitFor(() => expect(hits('GET', '/visits/v1/photos')).toBe(1));
    await screen.findByTestId('trip-album-screen');
    await settleScreen();
    expect(screen.queryByTestId('trip-album-empty')).toBeNull();
    expect(cells()).toHaveLength(0);

    gate.release();

    await waitFor(() => expect(cells()).toHaveLength(1));
    expect(screen.queryByTestId('trip-album-empty')).toBeNull();
  });

  // TRIP-1798 5-b 이후 N3 — 404 는 "방문 기록 없음"이라 기다릴 것도 실패도 아니다 → 빈 안내가 선다.
  it('P15 사진 목록이 전부 404 뿐이면 오류 줄 없이 빈 안내가 선다', async () => {
    serve({ photos: {} }); // 어떤 방문도 사진 목록 핸들러가 없어 404

    renderAlbum();

    expect(await screen.findByTestId('trip-album-empty')).toHaveTextContent(
      '이 기기에서 볼 수 있는 사진이 없어요'
    );
    expect(hits('GET', '/visits/v3/photos')).toBe(1); // 세 방문 모두 실제로 404 를 받았다
    expect(screen.queryByTestId('trip-album-photo-error')).toBeNull();
    expect(cells()).toHaveLength(0);
  });

  it('P8 이 기기 사진인데 앨범에서 못 푼 것은 셀 없이 「불러올 수 없는 사진 1장」으로 알리고 제목 장수에서 뺀다', async () => {
    serve({ photos: { ...standardPhotos(), v2: () => [photo('gone-b0')] } });
    renderAlbum();

    await waitFor(() => expect(cells()).toHaveLength(5));
    expect(
      screen.getByTestId('trip-album-unresolved-notice')
    ).toHaveTextContent('불러올 수 없는 사진 1장');
    expect(screen.getByTestId('trip-album-title')).toHaveTextContent(
      '강남구 여행 · 사진 5장'
    );
    expect(screen.queryByTestId('trip-album-place-v2')).toBeNull();
  });
});

describe('🔴 TRIP-1798 · 여행 앨범 — 실패는 빈 앨범이 아니다 (AC4 · INV-4)', () => {
  it('P5 기록 조회 실패 → 오류 + 다시 시도, 빈 안내는 없고, 다시 시도하면 기록만 다시 불러 앨범이 선다', async () => {
    let failing = true;
    serve({
      record: () =>
        failing ? new HttpResponse(null, { status: 500 }) : standardRecord(),
    });
    renderAlbum();

    expect(await screen.findByTestId('trip-album-error')).toBeOnTheScreen();
    expect(screen.queryByTestId('trip-album-empty')).toBeNull();
    expect(screen.queryByTestId('trip-album-day-1')).toBeNull();

    failing = false;
    fireEvent.press(screen.getByTestId('trip-album-retry'));

    await screen.findByTestId('trip-album-day-1');
    expect(hits('GET', '/trips/trip-1/records')).toBe(2);
    expect(screen.queryByTestId('trip-album-error')).toBeNull();
  });

  it('P6 한 방문의 사진 목록이 실패하면 나머지는 그대로 그리고 한 줄 오류를 띄우며, 다시 시도는 그 방문만 다시 부른다 (재시도 중에도 줄 유지)', async () => {
    let v2Fails = true;
    const gate = createGate();
    let secondCall = false;
    serve({
      photos: {
        ...standardPhotos(),
        v2: async () => {
          if (v2Fails) return new HttpResponse(null, { status: 500 });
          if (!secondCall) {
            secondCall = true;
            await gate.opened; // 재시도 응답을 붙잡아 "다시 부르는 중"을 본다
          }
          return [photo('b0')];
        },
      },
    });
    renderAlbum();

    expect(
      await screen.findByTestId('trip-album-photo-error')
    ).toBeOnTheScreen();
    await waitFor(() => expect(cells()).toHaveLength(5)); // v2 의 b0 만 빠짐
    expect(screen.queryByTestId('trip-album-empty')).toBeNull();

    v2Fails = false;
    fireEvent.press(screen.getByTestId('trip-album-photo-retry'));
    await waitFor(() => expect(hits('GET', '/visits/v2/photos')).toBe(2));
    expect(screen.getByTestId('trip-album-photo-error')).toBeOnTheScreen(); // 재시도 중에도 줄은 안 꺼진다
    gate.release();

    await waitFor(() => expect(cells()).toHaveLength(6));
    expect(screen.queryByTestId('trip-album-photo-error')).toBeNull();
    expect(hits('GET', '/visits/v1/photos')).toBe(1); // 성공한 방문은 다시 부르지 않는다
    expect(hits('GET', '/visits/v3/photos')).toBe(1);
  });

  // TRIP-1798 5-b 이후 W4 — TRIP-1757 이 겪은 구멍: 다시 시도 중(데이터 없이 재조회)에 얼굴이 사라지거나 재누름이 요청을 더 만들면 안 된다.
  it('P16 기록 조회 실패 뒤 다시 시도 중에도 오류 얼굴이 유지되고(빈 앨범·로딩으로 안 바뀜) 그 사이 재누름은 요청을 더 만들지 않는다', async () => {
    // 데이터 없이 실패한 쿼리는 refetch 를 또 불러도 TanStack 이 진행 중 요청에 합쳐 버려 요청 수만으론 잠금이 안 보인다 →
    // 조회 객체의 refetch 호출 수도 센다(생성 전에 걸어야 bind 된 사본이 스파이를 가리킨다).
    refetchSpy = jest.spyOn(QueryObserver.prototype, 'refetch');
    const gate = createGate();
    let calls = 0;
    serve({
      record: async () => {
        calls += 1;
        if (calls === 1) return new HttpResponse(null, { status: 500 });
        await gate.opened; // 재시도 응답을 붙잡아 "다시 부르는 중"을 본다
        return standardRecord();
      },
    });
    renderAlbum();

    await screen.findByTestId('trip-album-error');
    fireEvent.press(screen.getByTestId('trip-album-retry'));
    await waitFor(() => expect(hits('GET', '/trips/trip-1/records')).toBe(2));
    await settleScreen();

    // 재조회 중: 오류 얼굴 그대로, 로딩·빈 안내·앨범은 안 나온다
    expect(screen.getByTestId('trip-album-error')).toBeOnTheScreen();
    expect(screen.queryByTestId('trip-album-loading')).toBeNull();
    expect(screen.queryByTestId('trip-album-empty')).toBeNull();
    expect(screen.queryByTestId('trip-album-day-1')).toBeNull();

    // 재시도 중 재누름(연타 400ms 창은 닫고 누른다) → 요청 추가 없음
    resetPressGuard();
    fireEvent.press(screen.getByTestId('trip-album-retry'));
    resetPressGuard();
    fireEvent.press(screen.getByTestId('trip-album-retry'));
    await settleScreen();
    expect(hits('GET', '/trips/trip-1/records')).toBe(2);
    expect(refetchSpy).toHaveBeenCalledTimes(1); // 첫 누름만 — 재시도 중 재누름은 조회를 다시 부르지 않는다

    gate.release();

    await screen.findByTestId('trip-album-day-1');
    expect(screen.queryByTestId('trip-album-error')).toBeNull();
    expect(hits('GET', '/trips/trip-1/records')).toBe(2);
  });

  it('P17 한 줄 오류의 다시 시도 중 재누름도 요청을 더 만들지 않는다', async () => {
    refetchSpy = jest.spyOn(QueryObserver.prototype, 'refetch');
    let v2Fails = true;
    const gate = createGate();
    serve({
      photos: {
        ...standardPhotos(),
        v2: async () => {
          if (v2Fails) return new HttpResponse(null, { status: 500 });
          await gate.opened;
          return [photo('b0')];
        },
      },
    });
    renderAlbum();

    await screen.findByTestId('trip-album-photo-error');
    v2Fails = false;
    fireEvent.press(screen.getByTestId('trip-album-photo-retry'));
    await waitFor(() => expect(hits('GET', '/visits/v2/photos')).toBe(2));
    await settleScreen();

    fireEvent.press(screen.getByTestId('trip-album-photo-retry'));
    fireEvent.press(screen.getByTestId('trip-album-photo-retry'));
    await settleScreen();
    expect(hits('GET', '/visits/v2/photos')).toBe(2);
    expect(refetchSpy).toHaveBeenCalledTimes(1); // 실패한 v2 한 건만, 첫 누름에서 한 번

    gate.release();
    await waitFor(() => expect(cells()).toHaveLength(6));
  });

  it('P6c 사진 목록이 전부 실패해 그릴 사진이 0장이어도 「사진이 없어요」 빈 앨범으로 접지 않는다', async () => {
    const boom = () => new HttpResponse(null, { status: 500 });
    serve({ photos: { v1: boom, v2: boom, v3: boom } });
    renderAlbum();

    expect(
      await screen.findByTestId('trip-album-photo-error')
    ).toBeOnTheScreen();
    await settleScreen();
    expect(screen.queryByTestId('trip-album-empty')).toBeNull();
    expect(cells()).toHaveLength(0);
  });

  it('P6b 사진 목록이 404(방문 기록 없음)면 오류 줄 없이 그 방문만 빠진다', async () => {
    serve({
      photos: {
        ...standardPhotos(),
        v2: () => new HttpResponse(null, { status: 404 }),
      },
    });
    renderAlbum();

    await waitFor(() => expect(cells()).toHaveLength(5));
    expect(screen.queryByTestId('trip-album-photo-error')).toBeNull();
  });
});

describe('🔴 TRIP-1798 · 여행 앨범 — 뒤로', () => {
  it('P12 스택이 있으면 router.back() 이고, 딥링크 첫 화면이면 요약으로 replace 한다', async () => {
    serve();
    renderAlbum();
    await screen.findByTestId('trip-album-day-1');

    fireEvent.press(screen.getByTestId('trip-album-back'));
    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockReplace).not.toHaveBeenCalled();

    resetPressGuard(); // 연타 가드(400ms 창)를 닫고 두 번째 경로를 본다
    mockRouterState.canGoBack = false;
    fireEvent.press(screen.getByTestId('trip-album-back'));
    expect(mockReplace).toHaveBeenCalledWith('/trips/trip-1/records/summary');
  });
});
