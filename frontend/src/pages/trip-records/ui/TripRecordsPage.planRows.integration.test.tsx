import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

import { server } from '@/mocks/server';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';
import { tripRecordsTrip } from '@/test-support/tripRecordsTrip';

import { TripRecordsPage } from './TripRecordsPage';

/**
 * TRIP-1021 #086 · AC-10·AC-11·AC-13·AC-14 — j01 계획 행의 **조인과 도착 배선**(실제 HTTP).
 *
 * 무엇을 보장하나:
 *  - R1  그날 방문 0건이면 빈 상태 안내 + 계획 슬롯마다 행. 수동 모드 부제(법 문구)는 그대로 있다.
 *  - R2  수동 모드에서 계획 행 "방문 체크" → `POST /visits` 본문이 `{slotKey, poiId, source:'MANUAL'}`
 *        **정확히**(슬롯 키가 빠지면 서버가 "계획에 없던 곳" 즉석 방문으로 기록한다 — 브리프 맹점 ①).
 *        완료(`/complete`)는 0회(도착 없이 완료만 남길 수 없다, BR-U5-05).
 *  - R3  도착한 슬롯의 행만 사라지고 방문 카드가 생긴다. 다른 계획 행은 남고, 빈 상태 안내는 사라진다.
 *  - R4  위치 권한이 있어도 오늘 탭이면 "방문 체크"가 서고 도착을 올린다(TRIP-1069 결정 1(c) — 옛 "없다"를
 *        뒤집음). R4b 권한이 있어도 지난 날 탭엔 없다.
 *  - R5  연타해도 POST 는 1회(AC-11 "1회").
 *  - (5-c 수정 루프 1) R6 기록 조회 실패면 빈 상태 안내 대신 오류 표면 + [다시 시도]가 재조회한다(경고5) ·
 *        R7 로딩 중엔 빈 상태 안내가 없다(경고5) · R8·R9 "방문 체크"는 선택 일자가 실제 오늘일 때만 —
 *        미래·지난 날 탭은 행만 있고 버튼 없음(경고6) · R10 도착 실패 뒤 다시 누르면 요청이 다시 나간다(경고4).
 *
 * `today` 는 페이지의 오늘 주입 seam 이다(LiveItineraryPage 선례, 기본 = seoulDate(new Date())). R1~R5 도
 * `today={DAY}` 를 준다 — 안 주면 실제 오늘과 픽스처 날짜가 달라 "방문 체크"가 날짜 게이트에 막힌다.
 *
 * 왜 통합 버킷인가: "레코드 없는 슬롯만 행으로"라는 조인과 실제로 나간 본문이 심판 대상이다 — 훅을
 * 목킹하면 그 조인이 테스트의 가정이 된다(형제 manualCheckin 통합 선례).
 */

const BASE = 'http://localhost:8080/api/v1';
const TRIP_ID = 't1';
const DAY = '2026-08-20';

// OS 권한 seam — denied/granted 를 주입한다(형제 manualCheckin 통합 선례).
const mockGetForeground = jest.fn();
jest.mock('expo-location', () => ({
  getForegroundPermissionsAsync: (...args: unknown[]) =>
    mockGetForeground(...args),
}));

jest.mock('@/shared/storage', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest
    .fn()
    .mockResolvedValue({ accessToken: 'a', refreshToken: 'r' }),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  hasStoredToken: jest.fn().mockResolvedValue(true),
}));

jest.mock('expo-router', () => ({
  router: {
    canGoBack: jest.fn(() => false),
    back: jest.fn(),
    replace: jest.fn(),
  },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/shared/map', () => require('@/test-support/mapViewMock'));

const DENIED = {
  status: 'denied',
  granted: false,
  canAskAgain: false,
} as const;
const GRANTED = {
  status: 'granted',
  granted: true,
  canAskAgain: true,
} as const;
const MANUAL_NOTICE =
  '수동 체크인 · 방문한 곳을 직접 선택해 기록하세요 (좌표 자동기록 비활성)';

const KEY_P3 = `${DAY}#p3`;
const KEY_P4 = `${DAY}#p4`;
const rowId = (slotKey: string) => `record-trip-plan-row-${slotKey}`;
const checkId = (slotKey: string) => `record-trip-plan-check-${slotKey}`;

function daySlot(poiId: string, nameKo: string, startAt: string) {
  return {
    poiId,
    nameKo,
    startAt,
    endAt: startAt,
    isFixed: false,
    endsNextDay: false,
    hasViolation: false,
    tags: [] as string[],
  };
}

function itinerary() {
  return {
    itineraryId: 'it1',
    tripId: TRIP_ID,
    status: 'CONFIRMED',
    solveMode: 'FULL',
    generationMode: 'AI',
    isFallback: false,
    generationState: 'COMPLETE',
    days: [
      {
        date: DAY,
        slots: [
          daySlot('p3', '○○ 카페', '10:00:00'),
          daySlot('p4', '△△ 미술관', '13:00:00'),
        ],
      },
    ],
  };
}

/** POST /visits 응답 — record 훅은 이 레코드로 낙관 레코드를 교체한다(무효화 없음). */
function createdVisitP4() {
  return {
    visitCheckId: 'v-p4',
    slotKey: KEY_P4,
    poiId: 'p4',
    arrivedAt: `${DAY}T14:20:00`,
    completedAt: null,
    skippedAt: null,
    source: 'MANUAL',
    spontaneous: false,
    updatedAt: `${DAY}T14:20:00`,
  };
}

let postBodies: unknown[] = [];
let observedHits: string[] = [];

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  server.events.on('request:start', ({ request }) => {
    observedHits.push(`${request.method} ${new URL(request.url).pathname}`);
  });
});
beforeEach(() => {
  setAccessToken('a');
  postBodies = [];
  observedHits = [];
  mockGetForeground.mockReset();
  server.use(
    // TRIP-1085 — 페이지가 시트 헤더 여행명을 GET /trips/{tripId} 로 얻는다.
    http.get(`${BASE}/trips/:tripId`, () =>
      HttpResponse.json(tripRecordsTrip())
    ),
    http.get(`${BASE}/trips/:tripId/itinerary`, () =>
      HttpResponse.json(itinerary())
    ),
    // 그날 방문 0건 — 계획 2곳이 전부 행이 된다.
    http.get(`${BASE}/trips/:tripId/visits/days/:day`, () =>
      HttpResponse.json({ visits: [] })
    ),
    http.get(`${BASE}/trips/:tripId/bases`, () => HttpResponse.json([])),
    http.get(`${BASE}/saved-stays`, () => HttpResponse.json([])),
    // TRIP-1069 D3 — 도착한 카드도 사진·메모 컨테이너로 그려져 카드마다 사진 목록을 조회한다.
    http.get(`${BASE}/trips/:tripId/visits/:visitCheckId/photos`, () =>
      HttpResponse.json({ items: [], count: 0 })
    ),
    http.post(`${BASE}/trips/:tripId/visits`, async ({ request }) => {
      postBodies.push(await request.json());
      return HttpResponse.json(createdVisitP4(), { status: 201 });
    })
  );
});
afterEach(() => {
  server.resetHandlers();
  clearAccessToken();
});
afterAll(() => server.close());

describe('TripRecordsPage · 계획 행 조인 (TRIP-1021 AC-10·AC-13)', () => {
  it('R1 방문 0건 → 빈 상태 안내 + 계획 2곳 행, 수동 모드 부제(법 문구)도 그대로 있다', async () => {
    mockGetForeground.mockResolvedValue(DENIED);

    render(<TripRecordsPage tripId={TRIP_ID} today={DAY} />, { wrapper });

    expect(await screen.findByTestId(rowId(KEY_P3))).toBeOnTheScreen();
    expect(screen.getByTestId(rowId(KEY_P4))).toBeOnTheScreen();
    expect(screen.getAllByTestId('record-trip-empty')).toHaveLength(1);
    expect(await screen.findByText(MANUAL_NOTICE)).toBeOnTheScreen();
  });
});

describe('TripRecordsPage · 계획 행 "방문 체크" → 도착 (TRIP-1021 AC-11·AC-14)', () => {
  it('R2 수동 모드 → 행 "방문 체크"가 {slotKey, poiId, MANUAL} 로 POST 1회, 완료 요청은 0회', async () => {
    mockGetForeground.mockResolvedValue(DENIED);

    render(<TripRecordsPage tripId={TRIP_ID} today={DAY} />, { wrapper });
    fireEvent.press(await screen.findByTestId(checkId(KEY_P4)));

    await waitFor(() => expect(postBodies).toHaveLength(1));
    expect(postBodies[0]).toEqual({
      slotKey: KEY_P4,
      poiId: 'p4',
      source: 'MANUAL',
    });
    expect(observedHits.filter((hit) => hit.endsWith('/complete'))).toEqual([]);
  });

  it('R3 도착한 슬롯의 행만 사라지고 방문 카드가 생긴다 — 다른 행은 남고 빈 상태 안내는 사라진다', async () => {
    mockGetForeground.mockResolvedValue(DENIED);

    render(<TripRecordsPage tripId={TRIP_ID} today={DAY} />, { wrapper });
    fireEvent.press(await screen.findByTestId(checkId(KEY_P4)));

    expect(
      await screen.findByTestId('record-trip-visit-card-v-p4')
    ).toBeOnTheScreen();
    expect(screen.queryByTestId(rowId(KEY_P4))).toBeNull();
    expect(screen.getByTestId(rowId(KEY_P3))).toBeOnTheScreen();
    expect(screen.queryByTestId('record-trip-empty')).toBeNull();
  });

  // TRIP-1069 결정 1(c)·AC-22 — 옛 R4("권한이 있으면 없다")를 뒤집었다. 권한이 있어도 오늘 탭이면 손으로
  // 체크할 수 있다. 짝 R4b 가 "권한 있음이면 항상 켬" 오구현(지난 날에도 켬)을 막는다.
  it('R4 위치 권한이 있어도 오늘 탭 계획 행엔 "방문 체크"가 서고, 누르면 {slotKey, poiId, MANUAL} 로 POST 1회', async () => {
    mockGetForeground.mockResolvedValue(GRANTED);

    render(<TripRecordsPage tripId={TRIP_ID} today={DAY} />, { wrapper });
    await waitFor(() => expect(mockGetForeground).toHaveBeenCalled());

    expect(await screen.findByTestId(checkId(KEY_P3))).toBeOnTheScreen();
    fireEvent.press(screen.getByTestId(checkId(KEY_P4)));

    await waitFor(() => expect(postBodies).toHaveLength(1));
    expect(postBodies[0]).toEqual({
      slotKey: KEY_P4,
      poiId: 'p4',
      source: 'MANUAL',
    });
    expect(screen.queryByTestId('record-gps-banner')).toBeNull();
  });

  it('R4b 위치 권한이 있어도 지난 날 탭 계획 행엔 "방문 체크"가 없다 (AC-23)', async () => {
    mockGetForeground.mockResolvedValue(GRANTED);

    // 오늘 = 다음 날 → 첫 탭(DAY)은 지난 날이다.
    render(<TripRecordsPage tripId={TRIP_ID} today="2026-08-21" />, {
      wrapper,
    });

    // 짝 앵커 — 행 2개는 떴다(그 시점엔 권한 effect 도 flush 됐다).
    expect(await screen.findByTestId(rowId(KEY_P3))).toBeOnTheScreen();
    expect(screen.getByTestId(rowId(KEY_P4))).toBeOnTheScreen();
    await waitFor(() => expect(mockGetForeground).toHaveBeenCalled());
    expect(screen.queryAllByTestId(/^record-trip-plan-check-/)).toHaveLength(0);
  });

  it('R5 "방문 체크"를 연타해도 POST 는 1회뿐이다', async () => {
    mockGetForeground.mockResolvedValue(DENIED);

    render(<TripRecordsPage tripId={TRIP_ID} today={DAY} />, { wrapper });
    const check = await screen.findByTestId(checkId(KEY_P4));

    // 같은 참조를 연달아 — 캐시 갱신의 재렌더는 미뤄져 두 번째 press 때도 버튼이 트리에 남는다(02a ★1).
    fireEvent.press(check);
    fireEvent.press(check);

    // 응답으로 교체된 카드가 뜬 뒤에 센다(두 번째 요청이 늦게 찍히는 것까지 포함, 02a ★2).
    // 두 번 나가면 같은 낙관 id 두 개가 한 응답으로 함께 교체돼 같은 카드가 둘 선다 — 그래서 카드도 센다.
    await waitFor(() =>
      expect(
        screen.queryAllByTestId('record-trip-visit-card-v-p4').length
      ).toBeGreaterThan(0)
    );
    expect(
      observedHits.filter(
        (hit) => hit === `POST /api/v1/trips/${TRIP_ID}/visits`
      )
    ).toHaveLength(1);
    expect(screen.getAllByTestId('record-trip-visit-card-v-p4')).toHaveLength(
      1
    );
  });
});

const VISITS_GET = `GET /api/v1/trips/${TRIP_ID}/visits/days/${DAY}`;
const POST_VISITS = `POST /api/v1/trips/${TRIP_ID}/visits`;
const hitCount = (needle: string) =>
  observedHits.filter((hit) => hit === needle).length;

describe('TripRecordsPage · 기록 조회 실패·로딩 (TRIP-1021 5-c 경고5)', () => {
  it('R6 기록 조회가 실패하면 "아직 방문 기록이 없어요" 대신 오류 표면 — [다시 시도]가 재조회하고 성공하면 카드가 뜬다', async () => {
    mockGetForeground.mockResolvedValue(DENIED);
    server.use(
      http.get(`${BASE}/trips/:tripId/visits/days/:day`, () =>
        HttpResponse.json({ code: 'INTERNAL' }, { status: 500 })
      )
    );

    render(<TripRecordsPage tripId={TRIP_ID} today={DAY} />, { wrapper });

    expect(await screen.findByTestId('record-trip-error')).toBeOnTheScreen();
    expect(screen.queryByTestId('record-trip-empty')).toBeNull();
    expect(hitCount(VISITS_GET)).toBe(1);

    // 서버가 회복됐다 — 이후 조회는 p4 도착 레코드를 준다(나중에 등록한 핸들러가 이긴다, 02a ★17).
    server.use(
      http.get(`${BASE}/trips/:tripId/visits/days/:day`, () =>
        HttpResponse.json({ visits: [createdVisitP4()] })
      )
    );
    fireEvent.press(screen.getByTestId('record-trip-error-retry'));

    expect(
      await screen.findByTestId('record-trip-visit-card-v-p4')
    ).toBeOnTheScreen();
    expect(hitCount(VISITS_GET)).toBe(2);
    expect(screen.queryByTestId('record-trip-error')).toBeNull();
  });

  it('R7 기록이 로딩 중이면 빈 상태 안내가 없고, 0건으로 도착하면 그때 뜬다', async () => {
    mockGetForeground.mockResolvedValue(DENIED);
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get(`${BASE}/trips/:tripId/visits/days/:day`, async () => {
        await gate;
        return HttpResponse.json({ visits: [] });
      })
    );

    render(<TripRecordsPage tripId={TRIP_ID} today={DAY} />, { wrapper });

    // 앵커 — 일자 탭이 그려졌고(일정 도착) 기록 조회가 나가 응답을 기다리는 중이다.
    // (TRIP-1085 — 옛 `record-trip-day-tab-{date}` → 셸 `sheet-daychip-{index}`. DAY=0 · DAY2=1.)
    expect(await screen.findByTestId('sheet-daychip-0')).toBeOnTheScreen();
    await waitFor(() => expect(hitCount(VISITS_GET)).toBe(1));
    expect(screen.queryByTestId('record-trip-empty')).toBeNull();
    expect(screen.queryByTestId('record-trip-error')).toBeNull();

    // 짝 — 0건이 실제로 도착하면 안내가 선다("로딩이면 영원히 끔"이 아님).
    release();
    expect(await screen.findByTestId('record-trip-empty')).toBeOnTheScreen();
  });
});

describe('TripRecordsPage · "방문 체크"는 오늘 탭에서만 (TRIP-1021 5-c 경고6)', () => {
  const DAY2 = '2026-08-21';
  const KEY_P5 = `${DAY2}#p5`;
  const twoDays = () => ({
    ...itinerary(),
    days: [
      ...itinerary().days,
      { date: DAY2, slots: [daySlot('p5', '◇◇ 시장', '11:00:00')] },
    ],
  });

  beforeEach(() => {
    mockGetForeground.mockResolvedValue(DENIED);
    server.use(
      http.get(`${BASE}/trips/:tripId/itinerary`, () =>
        HttpResponse.json(twoDays())
      )
    );
  });

  it('R8 오늘이 1일차면 2일차(미래) 탭 계획 행엔 "방문 체크"가 없고, 1일차로 돌아오면 다시 선다', async () => {
    render(<TripRecordsPage tripId={TRIP_ID} today={DAY} />, { wrapper });

    // 오늘(1일차) — 버튼이 있다(긍정 앵커).
    expect(await screen.findByTestId(checkId(KEY_P4))).toBeOnTheScreen();

    // 미래(2일차) — 행은 보이되 버튼은 0.
    fireEvent.press(screen.getByTestId('sheet-daychip-1'));
    expect(await screen.findByTestId(rowId(KEY_P5))).toBeOnTheScreen();
    expect(screen.queryAllByTestId(/^record-trip-plan-check-/)).toHaveLength(0);

    // 오늘로 돌아오면 다시 선다("탭을 한 번이라도 고르면 끔" 오구현 차단).
    fireEvent.press(screen.getByTestId('sheet-daychip-0'));
    expect(await screen.findByTestId(checkId(KEY_P4))).toBeOnTheScreen();
    expect(postBodies).toHaveLength(0);
  });

  it('R9 오늘이 2일차면 1일차(지난 날) 탭 계획 행엔 "방문 체크"가 없고, 2일차 탭엔 있다', async () => {
    render(<TripRecordsPage tripId={TRIP_ID} today={DAY2} />, { wrapper });

    // 첫 탭(1일차 = 지난 날) — 행 2개는 보이되 버튼은 0. 권한 조회가 끝난 뒤에 본다(수동 모드 확정).
    expect(await screen.findByTestId(rowId(KEY_P3))).toBeOnTheScreen();
    expect(screen.getByTestId(rowId(KEY_P4))).toBeOnTheScreen();
    expect(await screen.findByTestId('record-gps-banner')).toBeOnTheScreen();
    expect(screen.queryAllByTestId(/^record-trip-plan-check-/)).toHaveLength(0);

    // 오늘(2일차) — 버튼이 있다.
    fireEvent.press(screen.getByTestId('sheet-daychip-1'));
    expect(await screen.findByTestId(checkId(KEY_P5))).toBeOnTheScreen();
  });
});

describe('TripRecordsPage · 도착 실패 뒤 재시도 (TRIP-1021 5-c 경고4)', () => {
  it('R10 "방문 체크"가 네트워크 실패로 되돌아간 뒤 다시 누르면 POST 가 한 번 더 나가고 방문 카드가 뜬다', async () => {
    mockGetForeground.mockResolvedValue(DENIED);
    let posts = 0;
    server.use(
      http.post(`${BASE}/trips/:tripId/visits`, async ({ request }) => {
        postBodies.push(await request.json());
        posts += 1;
        if (posts === 1) return HttpResponse.error();
        return HttpResponse.json(createdVisitP4(), { status: 201 });
      })
    );

    render(<TripRecordsPage tripId={TRIP_ID} today={DAY} />, { wrapper });
    fireEvent.press(await screen.findByTestId(checkId(KEY_P4)));

    // 1차 — 서버가 실패를 돌려준 뒤, 롤백으로 p4 행의 "방문 체크"가 다시 섰다.
    await waitFor(() => expect(posts).toBe(1));
    await waitFor(() => {
      expect(screen.getByTestId(checkId(KEY_P4))).toBeOnTheScreen();
      expect(screen.queryByTestId('record-trip-visit-card-v-p4')).toBeNull();
    });
    // record 훅은 롤백 뒤 한 틱 양보(settleRollback)하고 나서 가드를 푼다 — 사람 손가락처럼 한 틱 쉬고
    // 누른다(02c ★4). 이 대기가 없으면 올바른 구현에서도 두 번째 press 가 가드에 걸릴 수 있다.
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));

    // 2차 — 새로 찾은 버튼을 누른다(실패 뒤라 연타가 아니다).
    fireEvent.press(screen.getByTestId(checkId(KEY_P4)));

    expect(
      await screen.findByTestId('record-trip-visit-card-v-p4')
    ).toBeOnTheScreen();
    expect(hitCount(POST_VISITS)).toBe(2);
    expect(postBodies[1]).toEqual({
      slotKey: KEY_P4,
      poiId: 'p4',
      source: 'MANUAL',
    });
  });
});
