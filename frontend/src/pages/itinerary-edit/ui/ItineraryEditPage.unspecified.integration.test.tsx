import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

import { server } from '@/mocks/server';
import { useItineraryEditStore } from '@/features/itinerary/model/itineraryEditStore';
import { buildSlotKey } from '@/entities/itinerary-slot/lib/slotKey';
import type {
  EditItineraryRequest,
  Itinerary,
  ItineraryDaysItem,
  ItineraryDaysItemSlotsItem,
  Trip,
} from '@/shared/api/generated/schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';

import { ItineraryEditPage } from './ItineraryEditPage';

/**
 * TRIP-797 · h12 편집기 통일(묶음 C) — **미지정 슬롯 저장 제외 + 안내 UI**(INV-4 침묵 금지).
 *
 * 무엇을 보장하나: 서버 계약이 `startAt` non-nullable(openapi 2065/2559)이라 "시간대 미설정" 은
 * FE 로컬 상태(`EditorSlot.startAt: string | null`)로만 산다. 저장 시 `buildEditItineraryRequest` 가
 * `startAt === null` 슬롯을 요청에서 걸러(이미 커밋된 필터), 그렇게 **빠진 곳이 있으면 페이지가 인라인
 * 안내**(`itinerary-edit-unspecified-notice`)를 띄운다 — 조용히 지우지 않는다(INV-4).
 *
 * 왜 통합인가: 순수 필터(A2, buildEditItineraryRequest.unspecified.test)는 "제외" 까지만 잠근다.
 * "제외했으면 사용자에게 알린다" 는 페이지 렌더 책임이라(02a ★6·§9 이연 항목) 페이지를 관통해야 관측된다.
 *
 * 3동작 뼈대: 준비=미지정 슬롯 섞은 일정 → 실행=저장 press → 단언=PUT 제외 + 안내 렌더(+짝: 미지정 0 → 안내 부재).
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

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
}));

jest.mock('@/shared/map', () => require('@/test-support/mapViewMock'));

const BASE = 'http://localhost:8080/api/v1';
const TRIP_ID = '11111111-1111-1111-1111-111111111111';
const DAY1 = '2026-06-10';
const DAY2 = '2026-06-11';

const SAVE = 'sheet-cta-button-0';
const NOTICE = 'itinerary-edit-unspecified-notice';

function trip(): Trip {
  return {
    tripId: TRIP_ID,
    title: '제주 여행',
    startDate: DAY1,
    endDate: '2026-06-13',
    party: 2,
    preferenceSnapshot: {},
    destinations: [{ seq: 1, region: '제주', nights: 3 }],
    status: 'PLANNED',
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-01T10:00:00.000Z',
  };
}

function slot(
  poiId: string,
  startAt: string | null,
  nameKo: string
): ItineraryDaysItemSlotsItem {
  return {
    poiId,
    // 서버 계약은 non-nullable 이지만 로컬 미지정을 흉내내려 null 을 싣는다(런타임 경로만, 캐스트).
    startAt: startAt as unknown as string,
    endAt: '11:00:00',
    isFixed: false,
    endsNextDay: false,
    hasViolation: false,
    tags: [],
    nameKo,
  };
}

/** day1 = [a(09:00 지정) · u(미지정, startAt null)]. 저장 시 u 가 빠지고 안내가 떠야 한다. */
function itineraryWithUnspecified(): Itinerary {
  const days: ItineraryDaysItem[] = [
    {
      date: DAY1,
      slots: [
        slot('poi-a', '09:00:00', '성산일출봉'),
        slot('poi-u', null, '미정 장소'),
      ],
    },
  ];
  return {
    itineraryId: 'itin-1',
    tripId: TRIP_ID,
    status: 'PLANNED',
    solveMode: 'FULL_AI',
    generationMode: 'FULLY_AI',
    generationState: 'COMPLETE',
    isFallback: false,
    days,
  };
}

/**
 * TRIP-923 · day1 = [a · u1(미지정)] + day2 = [u2(미지정)] — 미지정 2곳을 두 날에 흩는다.
 * 1곳이면 개수를 상수 1 로 박아도 통과하고, 한 날에만 두면 "보이는 날만 세기" 회귀를 못 잡는다.
 */
function itineraryWithTwoUnspecified(): Itinerary {
  const days: ItineraryDaysItem[] = [
    {
      date: DAY1,
      slots: [
        slot('poi-a', '09:00:00', '성산일출봉'),
        slot('poi-u1', null, '미정 장소 1'),
      ],
    },
    { date: DAY2, slots: [slot('poi-u2', null, '미정 장소 2')] },
  ];
  return {
    itineraryId: 'itin-3',
    tripId: TRIP_ID,
    status: 'PLANNED',
    solveMode: 'FULL_AI',
    generationMode: 'FULLY_AI',
    generationState: 'COMPLETE',
    isFallback: false,
    days,
  };
}

/** day1 = [a · b] 둘 다 지정 — 미지정 0 이라 저장해도 안내가 없어야 한다(짝). */
function itineraryAllSpecified(): Itinerary {
  const days: ItineraryDaysItem[] = [
    {
      date: DAY1,
      slots: [
        slot('poi-a', '09:00:00', '성산일출봉'),
        slot('poi-b', '13:00:00', '섭지코지'),
      ],
    },
  ];
  return {
    itineraryId: 'itin-2',
    tripId: TRIP_ID,
    status: 'PLANNED',
    solveMode: 'FULL_AI',
    generationMode: 'FULLY_AI',
    generationState: 'COMPLETE',
    isFallback: false,
    days,
  };
}

let putCalls = 0;
let putBody: unknown = null;
let getHandler: () => Response;

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

beforeEach(() => {
  putCalls = 0;
  putBody = null;
  setAccessToken('valid-access');
  useItineraryEditStore.getState().reset();
  getHandler = () => HttpResponse.json(itineraryWithUnspecified());

  server.use(
    http.get(`${BASE}/trips/:tripId`, () => HttpResponse.json(trip())),
    http.get(`${BASE}/trips/:tripId/itinerary`, () => getHandler()),
    http.get(`${BASE}/trips/:tripId/visits/days/:day`, () =>
      HttpResponse.json({ visits: [] })
    ),
    http.put(`${BASE}/trips/:tripId/itinerary`, async ({ request }) => {
      putCalls += 1;
      putBody = await request.json();
      return HttpResponse.json(itineraryAllSpecified());
    })
  );
});

afterEach(() => {
  server.resetHandlers();
  clearAccessToken();
});

afterAll(() => server.close());

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  return render(<ItineraryEditPage tripId={TRIP_ID} />, { wrapper: Wrapper });
}

describe('🔴 UN1 · AC-6·INV-4 — 미지정 슬롯은 저장에서 빠지고 안내가 뜬다', () => {
  it('미지정 칩이 뜨고, 저장하면 PUT 에서 poi-u 가 빠지며 제외 안내(개수 포함)가 렌더된다', async () => {
    renderPage();
    await screen.findByTestId(`slot-stopcard-${buildSlotKey(DAY1, 'poi-a')}`);

    // 미지정 슬롯은 "시간대 설정" 칩으로 뜬다(AC-6).
    expect(screen.getByText('시간대 설정')).toBeOnTheScreen();

    fireEvent.press(screen.getByTestId(SAVE));
    await waitFor(() => expect(putCalls).toBe(1));

    // 미지정(poi-u) 은 요청에서 빠지고 지정 슬롯만 남는다(순서 유지, INV-U3-02).
    const body = putBody as EditItineraryRequest;
    expect(body.days[0].slots.map((s) => s.poiId)).toEqual(['poi-a']);

    // INV-4 침묵 금지 — 빠진 곳을 사용자에게 알린다(제외 개수 1 을 담아 정직하게).
    // ★ 문자열 form 은 완전일치(matches exact=true, node_modules 실측)라 문장 안의 "1" 을 못 잡는다 —
    //   부분 포함은 regex 로 잰다(개수 없는 "빠진 곳이 있어요" 는 red 로 잡아 정직한 개수 표기를 강제).
    const notice = await screen.findByTestId(NOTICE);
    expect(notice).toHaveTextContent(/\S/);
    expect(notice).toHaveTextContent(/1/);
  });
});

describe('🔴 UN3 · TRIP-923 · INV-4 — 안내의 개수는 실제로 빠진 곳 수다', () => {
  it('두 날에 걸친 미지정 2곳을 저장하면 안내가 "2곳" 문장과 완전 일치한다', async () => {
    getHandler = () => HttpResponse.json(itineraryWithTwoUnspecified());

    renderPage();
    await screen.findByTestId(`slot-stopcard-${buildSlotKey(DAY1, 'poi-a')}`);

    fireEvent.press(screen.getByTestId(SAVE));
    await waitFor(() => expect(putCalls).toBe(1));

    // 두 날 모두에서 미지정이 빠진다 — 빈 날도 날짜는 남는다.
    const body = putBody as EditItineraryRequest;
    expect(body.days.map((d) => d.slots.map((s) => s.poiId))).toEqual([
      ['poi-a'],
      [],
    ]);

    expect(await screen.findByTestId(NOTICE)).toHaveTextContent(
      '시간대를 정하지 않은 2곳은 저장에서 빠졌어요'
    );
  });
});

describe('🔴 UN2 · AC-6 — 미지정 0 이면 저장해도 안내가 없다 (짝)', () => {
  it('전부 지정된 일정은 저장 후에도 제외 안내가 뜨지 않는다', async () => {
    getHandler = () => HttpResponse.json(itineraryAllSpecified());

    renderPage();
    await screen.findByTestId(`slot-stopcard-${buildSlotKey(DAY1, 'poi-a')}`);

    fireEvent.press(screen.getByTestId(SAVE));
    await waitFor(() => expect(putCalls).toBe(1));

    // 미지정이 없으므로 안내는 안 뜬다 — "항상 렌더" 하는 공허 구현을 막는 부정 짝.
    expect(screen.queryByTestId(NOTICE)).toBeNull();
  });
});
