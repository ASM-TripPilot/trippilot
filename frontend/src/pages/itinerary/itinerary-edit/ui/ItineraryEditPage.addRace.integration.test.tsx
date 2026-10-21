import type { ReactElement, ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import {
  QueryClient,
  QueryClientProvider,
  useQueryClient,
} from '@tanstack/react-query';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { Pressable, Text } from 'react-native';

import { server } from '@/mocks/server';
import { resetToast } from '@/test-support/toastHarness';
import { useItineraryEditStore } from '@/features/edit-itinerary';
import { buildSlotKey } from '@/entities/itinerary-slot';
import {
  getGetTripsTripIdItineraryQueryKey,
  usePutTripsTripIdItinerary,
} from '@/shared/api/index.hooks';
import type {
  EditItineraryRequest,
  Itinerary,
} from '@/shared/api/index.schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';

import { ItineraryEditPage } from './ItineraryEditPage';

/**
 * TRIP-1519(TRIP-1498 후속) · 반대 방향 경합 — 장소 추가 PUT 이 응답 전인 동안 편집기 [일정 저장하기]를 누르면
 * 방금 추가한 장소가 서버에서 지워지는가. 추가 화면은 스택에서 편집기 위에 얹혀 있고 [‹]로 돌아오면 편집기가
 * 그대로다(언마운트 안 됨) — 그래서 추가 PUT 을 내는 쪽은 같은 QueryClient 의 별도 훅 호출자(AddInFlight)로 흉내낸다.
 * 서버는 PUT 본문을 그대로 "저장된 일정"으로 삼는다(전체 교체 계약) — 마지막에 서버에 남은 슬롯으로 잰다.
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
const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({
    back: mockBack,
    push: jest.fn(),
    replace: jest.fn(),
    navigate: jest.fn(),
    canGoBack: () => true,
  }),
}));
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/shared/map', () => require('@/test-support/mapViewMock'));

const BASE = 'http://localhost:8080/api/v1';
const TRIP_ID = '11111111-1111-1111-1111-111111111111';
const DAY = '2026-06-10';
const SAVE = 'sheet-cta-button-0';

function slot(poiId: string, startAt: string, endAt: string) {
  return {
    poiId,
    startAt,
    endAt,
    isFixed: false,
    endsNextDay: false,
    hasViolation: false,
    alternatives: [],
    tags: [],
    nameKo: poiId,
  };
}
function itinerary(poiIds: string[]): Itinerary {
  return {
    itineraryId: 'itin-1',
    tripId: TRIP_ID,
    status: 'PLANNED',
    solveMode: 'FULL_AI',
    generationMode: 'FULLY_AI',
    generationState: 'COMPLETE',
    isFallback: false,
    days: [
      {
        date: DAY,
        slots: poiIds.map((id, i) =>
          slot(id, `${9 + i * 2}:00:00`.padStart(8, '0'), `${10 + i * 2}:00:00`)
        ),
      },
    ],
  };
}

/** 장소 추가 화면(스택 위에서 PUT 응답을 기다리는 중)의 훅 호출자 — PUT 하나를 낸다. */
function AddInFlight(): ReactElement {
  const queryClient = useQueryClient();
  // PlaceAddPage 와 같이 응답으로 일정 GET 캐시를 교체한다.
  const put = usePutTripsTripIdItinerary({
    mutation: {
      onSuccess: (data) =>
        queryClient.setQueryData(
          getGetTripsTripIdItineraryQueryKey(TRIP_ID),
          data
        ),
    },
  });
  return (
    <Pressable
      testID="add-fire"
      onPress={() =>
        put.mutate({
          tripId: TRIP_ID,
          data: {
            days: [
              {
                date: DAY,
                slots: ['poi-a', 'poi-b', 'poi-new'].map((poiId, i) => ({
                  poiId,
                  startAt: `${String(9 + i * 2).padStart(2, '0')}:00:00`,
                  endAt: `${String(10 + i * 2).padStart(2, '0')}:00:00`,
                  isFixed: false,
                  endsNextDay: false,
                })),
              },
            ],
          },
        })
      }
    >
      <Text>add</Text>
    </Pressable>
  );
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  clearAccessToken();
  resetToast();
});
afterAll(() => server.close());

describe('TRIP-1498 후속 · 장소 추가 PUT 중 편집기 [저장]', () => {
  let serverSlots: string[];
  let putBodies: EditItineraryRequest[];
  let releaseFirst: () => void;

  beforeEach(() => {
    setAccessToken('valid-access');
    useItineraryEditStore.getState().reset();
    mockBack.mockClear();
    serverSlots = ['poi-a', 'poi-b'];
    putBodies = [];
    let first = true;
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    server.use(
      http.get(`${BASE}/trips/:tripId`, () =>
        HttpResponse.json({
          tripId: TRIP_ID,
          title: 't',
          startDate: DAY,
          endDate: DAY,
          party: 2,
          preferenceSnapshot: {},
          destinations: [{ seq: 1, region: '제주', nights: 0 }],
          status: 'PLANNED',
          createdAt: '2026-08-01T10:00:00.000Z',
          updatedAt: '2026-08-01T10:00:00.000Z',
          baseCount: 0,
          itineraryDayCount: 0,
        })
      ),
      http.get(`${BASE}/trips/:tripId/itinerary`, () =>
        HttpResponse.json(itinerary(serverSlots))
      ),
      http.get(`${BASE}/trips/:tripId/visits/days/:day`, () =>
        HttpResponse.json({ visits: [] })
      ),
      http.put(`${BASE}/trips/:tripId/itinerary`, async ({ request }) => {
        const body = (await request.json()) as EditItineraryRequest;
        putBodies.push(body);
        const isFirst = first;
        first = false;
        // 첫 PUT(장소 추가)은 응답이 늦다 — 서버 반영은 요청 도착 순서대로 일어난다.
        serverSlots = body.days[0].slots.map((s) => s.poiId);
        if (isFirst) await gate;
        return HttpResponse.json(itinerary(serverSlots));
      })
    );
  });

  it('추가 PUT 이 응답 전일 때 [저장]을 눌러도 추가한 장소는 서버에 남는다', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    const Wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    render(
      <>
        <ItineraryEditPage tripId={TRIP_ID} />
        <AddInFlight />
      </>,
      { wrapper: Wrapper }
    );
    await screen.findByTestId(`slot-stopcard-${buildSlotKey(DAY, 'poi-a')}`);

    fireEvent.press(screen.getByTestId('add-fire'));
    await waitFor(() => expect(putBodies).toHaveLength(1));

    // 추가 응답 전 — 편집기 [저장]
    fireEvent.press(screen.getByTestId(SAVE));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });
    releaseFirst();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 200));
    });

    // 응답 전 [저장]은 PUT 을 내지 않았다 — 추가 PUT 하나뿐(TRIP-1519).
    expect(putBodies).toHaveLength(1);
    expect(serverSlots).toContain('poi-new');

    // 응답 뒤 [저장]은 추가분이 든 초안으로 나간다.
    await waitFor(() =>
      expect(
        screen.getByTestId(`slot-stopcard-${buildSlotKey(DAY, 'poi-new')}`)
      ).toBeTruthy()
    );
    fireEvent.press(screen.getByTestId(SAVE));
    await waitFor(() => expect(putBodies).toHaveLength(2));
    expect(putBodies[1].days[0].slots.map((s) => s.poiId)).toContain('poi-new');
  });
});
