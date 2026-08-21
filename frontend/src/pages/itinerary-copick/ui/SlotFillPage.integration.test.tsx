import type { ReactNode } from 'react';
import { delay, http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

import { server } from '@/mocks/server';
import { buildSlotKey } from '@/features/itinerary/model/slotKey';
import type {
  EditItineraryRequest,
  Itinerary,
  ItineraryDaysItem,
  SlotCandidatesRequest,
} from '@/shared/api/generated/schemas';
import { getGetTripsTripIdItineraryQueryKey } from '@/shared/api/generated/trips/trips';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';

import { SlotFillPage } from './SlotFillPage';

/**
 * h13→h14/h15 슬롯 채우기 배선 — 슬라이스1 코어(POST 후보 → swapSlotPoi 치환 → PUT 전체교체)를
 * 컨셉/반경 앞단과 잇는다. 찬 슬롯 "변경" 경로로 잰다(빈 슬롯 스켈레톤은 계약 미결 · 코드 경로 동일).
 *
 * 무엇을 보장하나:
 *  - AC-1: 후보 조회는 usePostTripsTripIdItinerarySlotCandidates(slotKey+concept+radiusM)만.
 *  - AC-2: 컨셉 라벨이 concept 로 실림 · 스킵=concept 미전송(undefined).
 *  - AC-7(TRIP-504): 라디오 → "A로 선택" → swapSlotPoi+PUT 1건 → 성공 시 **다음 비고정 슬롯으로
 *    replace**(다음 없으면 h17 complete). 구 `router.back()`(허브 복귀)은 폐기 — 선형 순회.
 *  - AC-4: 반경 max → radiusM=null 재요청 · 서버 radiusMUsed → 화면 포맷 표시.
 *  - AC-5: 후보 0건 → 반경확대(재조회)·컨셉변경(h13 복귀) CTA 배선.
 *  - AC-8: 저장 실패 인라인(resolveSlotSwapError).
 *  - E1: 콜드캐시 가드(GET 미도착 중 확정 → PUT 0). firedRef: 같은 틱 연타 → PUT 1.
 *
 * 3동작: 준비=MSW 응답 → 실행=컨셉·반경·라디오·확정 → 단언=나간 요청 바디·이동.
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
const mockPush = jest.fn();
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: mockBack, replace: mockReplace }),
}));

const BASE = 'http://localhost:8080/api/v1';
const TRIP_ID = '22222222-2222-2222-2222-222222222222';
const DAY1 = '2026-06-10';
const SLOT_KEY = buildSlotKey(DAY1, 'a');

function itinerary(): Itinerary {
  const days: ItineraryDaysItem[] = [
    {
      date: DAY1,
      slots: [
        {
          poiId: 'a',
          nameKo: '경복궁',
          startAt: '09:30:00',
          endAt: '11:00:00',
          isFixed: false,
          endsNextDay: false,
          hasViolation: false,
          tags: [],
        },
        {
          poiId: 'b',
          startAt: '13:00:00',
          endAt: '14:00:00',
          isFixed: false,
          endsNextDay: false,
          hasViolation: false,
          tags: [],
        },
      ],
    },
  ];
  return {
    itineraryId: 'itin-2',
    tripId: TRIP_ID,
    status: 'PLANNED',
    solveMode: 'FULL_AI',
    generationMode: 'CO_PLAN',
    generationState: 'COMPLETE',
    isFallback: false,
    days,
  };
}

// 테스트별로 바꿔 끼우는 후보 응답(핸들러 클로저가 요청 시점에 읽는다).
let candidatesResponse: {
  candidates: { poiId: string; distanceRange: string; rationale: string }[];
  radiusMUsed: number;
};
let postCalls = 0;
let postBody: SlotCandidatesRequest | null = null;
let putCalls = 0;
let putBody: unknown = null;

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

beforeEach(() => {
  postCalls = 0;
  postBody = null;
  putCalls = 0;
  putBody = null;
  mockBack.mockClear();
  mockPush.mockClear();
  mockReplace.mockClear();
  candidatesResponse = {
    candidates: [
      { poiId: 'X', distanceRange: '420m', rationale: '가장 가까운 실내 전시' },
      { poiId: 'Y', distanceRange: '1.1km', rationale: '조용한 카페' },
    ],
    radiusMUsed: 11300,
  };
  setAccessToken('valid-access');

  server.use(
    http.get(`${BASE}/trips/:tripId/itinerary`, () =>
      HttpResponse.json(itinerary())
    ),
    http.post(
      `${BASE}/trips/:tripId/itinerary/slot-candidates`,
      async ({ request }) => {
        postCalls += 1;
        postBody = (await request.json()) as SlotCandidatesRequest;
        return HttpResponse.json(candidatesResponse);
      }
    ),
    http.put(`${BASE}/trips/:tripId/itinerary`, async ({ request }) => {
      putCalls += 1;
      putBody = await request.json();
      return HttpResponse.json(itinerary());
    })
  );
});

afterEach(() => {
  server.resetHandlers();
  clearAccessToken();
});

afterAll(() => server.close());

function renderPage(slotKey: string = SLOT_KEY) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  return render(<SlotFillPage tripId={TRIP_ID} slotKey={slotKey} />, {
    wrapper: Wrapper,
  });
}

async function pickConcept(key = 'culture') {
  await screen.findByTestId(`itinerary-copick-concept-${key}`);
  fireEvent.press(screen.getByTestId(`itinerary-copick-concept-${key}`));
}

describe('🔴 SlotFillPage (h13→h14/h15) 배선', () => {
  it('C1 · 마운트=컨셉 화면, 조회 POST 는 아직 0', async () => {
    renderPage();

    await screen.findByTestId('itinerary-copick-concept-root');
    expect(postCalls).toBe(0);
  });

  it('C2 · AC-1·AC-2 컨셉 탭 → slot-candidates POST 1건 · 바디에 slotKey·concept·radiusM', async () => {
    renderPage();
    await pickConcept('culture');

    await waitFor(() => expect(postCalls).toBe(1));
    expect(postBody?.slotKey).toBe(SLOT_KEY);
    expect(postBody?.concept).toBe('전시·문화');
    expect(postBody?.radiusM).toBe(1100); // 기본 mid 단계
  });

  it('C3 · AC-2 스킵 → concept 미전송(undefined)', async () => {
    renderPage();
    await screen.findByTestId('itinerary-copick-concept-skip');
    fireEvent.press(screen.getByTestId('itinerary-copick-concept-skip'));

    await waitFor(() => expect(postCalls).toBe(1));
    expect(postBody?.concept).toBeUndefined();
    expect(postBody?.radiusM).toBe(1100);
  });

  it('C4 · AC-1·INV-1 렌더 후보 집합 = 응답 poiId 집합', async () => {
    renderPage();
    await pickConcept('culture');
    await screen.findByTestId('itinerary-candidate-radio-X');

    const poiIds = screen
      .getAllByTestId(
        /^itinerary-candidate-(?!radio-|name-|image-|distance-|rationale-|current$|select-)/
      )
      .map((node) => node.props.testID.replace('itinerary-candidate-', ''))
      .sort();
    expect(poiIds).toEqual(['X', 'Y']);
  });

  it('C5 · AC-7 라디오 → "A로 선택" → PUT 1건(a→X) → 다음 비고정 슬롯으로 replace(허브 복귀 폐기)', async () => {
    renderPage();
    await pickConcept('culture');
    await screen.findByTestId('itinerary-candidate-radio-X');

    fireEvent.press(screen.getByTestId('itinerary-candidate-radio-X'));
    fireEvent.press(screen.getByTestId('itinerary-copick-slotfill-confirm'));

    await waitFor(() => expect(putCalls).toBe(1));
    // 같은 치환 = swapSlotPoi 코어 재사용(BR-U3-23, 무변경).
    expect((putBody as EditItineraryRequest).days[0].slots[0].poiId).toBe('X');

    // ★ 확정 성공 = 허브로 back 이 아니라 **다음 비고정 슬롯**으로 replace(선형 전진, 01b 순회 세부).
    await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
    const destination = mockReplace.mock.calls[0][0] as unknown;
    const asText =
      typeof destination === 'string'
        ? destination
        : JSON.stringify(destination);
    expect(asText).toContain('copick');
    // ★ 다음 비고정 슬롯 키(d1#b)가 목적지에 실려야 한다 — 허브(slotKey 없음)로 새면 red.
    expect(asText).toContain(buildSlotKey(DAY1, 'b'));
    // ★ 허브 복귀(router.back)는 폐기됐다.
    expect(mockBack).not.toHaveBeenCalled();
  });

  it('C12 · AC-7 마지막 비고정 슬롯 확정 → 다음이 없으면 h17(complete)로 replace', async () => {
    // 마지막 비고정 슬롯(d1#b)에서 진입 — 뒤에 비고정이 없다.
    renderPage(buildSlotKey(DAY1, 'b'));
    await pickConcept('culture');
    await screen.findByTestId('itinerary-candidate-radio-X');

    fireEvent.press(screen.getByTestId('itinerary-candidate-radio-X'));
    fireEvent.press(screen.getByTestId('itinerary-copick-slotfill-confirm'));

    await waitFor(() => expect(putCalls).toBe(1));

    // ★ 다음 비고정 슬롯이 없으면 h17 완성 확인(copick/complete)으로.
    await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
    const destination = mockReplace.mock.calls[0][0] as unknown;
    const asText =
      typeof destination === 'string'
        ? destination
        : JSON.stringify(destination);
    expect(asText).toContain('complete');
    expect(mockBack).not.toHaveBeenCalled();
  });

  it('C6 · AC-4 반경 max → radiusM=null 재요청', async () => {
    renderPage();
    await pickConcept('culture');
    await waitFor(() => expect(postCalls).toBe(1));

    fireEvent.press(screen.getByTestId('itinerary-copick-radius-seg-max'));

    await waitFor(() => expect(postCalls).toBe(2));
    expect(postBody?.radiusM).toBeNull(); // 3단째 = 명시적 null
  });

  it('C7 · AC-4 서버 radiusMUsed(11300) → 화면 "약 11.3km" 표시', async () => {
    renderPage();
    await pickConcept('culture');

    const used = await screen.findByTestId('itinerary-copick-radius-used');
    expect(used).toHaveTextContent('약 11.3km');
  });

  it('C8 · AC-5 후보 0건 → 반경확대(재조회)·컨셉변경(h13 복귀) 배선', async () => {
    candidatesResponse = { candidates: [], radiusMUsed: 1100 };
    renderPage();
    await pickConcept('culture');
    await waitFor(() => expect(postCalls).toBe(1));

    // 반경 확대 → 다음 단으로 재조회.
    fireEvent.press(await screen.findByTestId('itinerary-copick-zero-radius'));
    await waitFor(() => expect(postCalls).toBe(2));

    // 컨셉 변경 → h13 컨셉 화면 복귀.
    fireEvent.press(screen.getByTestId('itinerary-copick-zero-concept'));
    await screen.findByTestId('itinerary-copick-concept-root');
  });

  it('C9 · E1 콜드캐시 가드 — GET 미도착 중 확정 → PUT 0(빈 days 전체교체 방지)', async () => {
    server.use(
      http.get(`${BASE}/trips/:tripId/itinerary`, async () => {
        await delay('infinite');
        return HttpResponse.json(itinerary());
      })
    );
    renderPage();
    await pickConcept('culture');
    await screen.findByTestId('itinerary-candidate-radio-X'); // POST 는 도착

    fireEvent.press(screen.getByTestId('itinerary-candidate-radio-X'));
    fireEvent.press(screen.getByTestId('itinerary-copick-slotfill-confirm'));

    await waitFor(() => expect(postCalls).toBe(1));
    expect(putCalls).toBe(0);
    // 가드가 막았으니 어느 이동도 없다(전진 replace 도, 구 back 도 0).
    expect(mockReplace).toHaveBeenCalledTimes(0);
    expect(mockBack).toHaveBeenCalledTimes(0);
  });

  it('C10 · firedRef — 같은 틱 확정 2회 연타여도 PUT 1건', async () => {
    renderPage();
    await pickConcept('culture');
    await screen.findByTestId('itinerary-candidate-radio-X');

    fireEvent.press(screen.getByTestId('itinerary-candidate-radio-X'));
    const confirm = await screen.findByTestId(
      'itinerary-copick-slotfill-confirm'
    );
    await waitFor(() =>
      expect(confirm.props.accessibilityState?.disabled).not.toBe(true)
    );

    act(() => {
      fireEvent.press(confirm);
      fireEvent.press(confirm);
    });

    await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
    expect(putCalls).toBe(1);
  });

  it('C11 · AC-8 저장 실패 → 인라인 오류 · 이동 0', async () => {
    server.use(
      http.put(`${BASE}/trips/:tripId/itinerary`, () =>
        HttpResponse.json(
          { error: { code: 'X', message: 'x' } },
          { status: 500 }
        )
      )
    );
    renderPage();
    await pickConcept('culture');
    await screen.findByTestId('itinerary-candidate-radio-X');

    fireEvent.press(screen.getByTestId('itinerary-candidate-radio-X'));
    fireEvent.press(screen.getByTestId('itinerary-copick-slotfill-confirm'));

    await screen.findByTestId('itinerary-copick-slotfill-error');
    // 실패는 이동이 없다(전진 replace 도, 구 back 도 0).
    expect(mockReplace).toHaveBeenCalledTimes(0);
    expect(mockBack).toHaveBeenCalledTimes(0);
  });

  it('C13 · AC-7·경고-1 — 순차 확정: a→X 확정 뒤 b 확정 시 PUT 바디에 앞선 X 가 보존된다(캐시 무효화)', async () => {
    // 서버 진실을 쥔 stateful 핸들러 — GET 은 마지막 PUT 을 반영한다(실서버 동형). 두 슬롯을 이어
    // 확정하는 순회에서 "다음 SlotFillPage 가 최신 days 를 읽는가"를 재려면 GET 이 앞 확정을 반영해야
    // 하고, 그러려면 확정 성공(onSuccess)이 GET 캐시를 무효화(재조회)해야 한다.
    let serverDays = itinerary().days; // [a, b] 로 시작.
    server.use(
      http.get(`${BASE}/trips/:tripId/itinerary`, () =>
        HttpResponse.json({ ...itinerary(), days: serverDays })
      ),
      http.put(`${BASE}/trips/:tripId/itinerary`, async ({ request }) => {
        putCalls += 1;
        const body = (await request.json()) as EditItineraryRequest;
        putBody = body;
        // PUT 바디(5필드만)의 poiId 들을 원본 풀 슬롯에 얹어, 다음 GET 이 갱신된 days 를 돌려주게 한다.
        serverDays = itinerary().days.map((day, di) => ({
          ...day,
          slots: day.slots.map((slot, si) => ({
            ...slot,
            poiId: body.days[di].slots[si].poiId,
          })),
        }));
        return HttpResponse.json({ ...itinerary(), days: serverDays });
      })
    );

    // staleTime: Infinity 로 **refetch-on-mount 를 끈다** — 그러면 캐시를 최신으로 만드는 유일한 힘이
    // onSuccess 의 무효화뿐이라 그 효과만 격리해 잰다(안 끄면 다음 화면 마운트가 알아서 재조회해 무효화가
    // 없어도 통과 → 회귀를 못 잡는다). gcTime: Infinity 는 첫 화면이 언마운트돼도 stale 캐시가 살아남게
    // 해 실서비스 remount 상황을 재현한다.
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: Infinity, gcTime: Infinity },
      },
    });
    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      );
    }

    // 1) slot a 진입 → a 를 X 로 확정.
    const first = render(<SlotFillPage tripId={TRIP_ID} slotKey={SLOT_KEY} />, {
      wrapper: Wrapper,
    });
    await pickConcept('culture');
    await screen.findByTestId('itinerary-candidate-radio-X');
    fireEvent.press(screen.getByTestId('itinerary-candidate-radio-X'));
    fireEvent.press(screen.getByTestId('itinerary-copick-slotfill-confirm'));

    await waitFor(() => expect(putCalls).toBe(1));
    // 무효화가 재조회를 태워 GET 캐시가 [X, b] 로 수렴할 때까지 기다린다 — 무효화가 없으면 캐시가
    // stale [a, b] 로 남아 이 첫 슬롯 poiId 가 영영 'a' 라 여기서 멈춘다(회귀 잡힘).
    await waitFor(() =>
      expect(
        (
          client.getQueryData(getGetTripsTripIdItineraryQueryKey(TRIP_ID)) as
            Itinerary | undefined
        )?.days[0].slots[0].poiId
      ).toBe('X')
    );
    first.unmount();

    // 2) 다음 슬롯(b)로 전진 — 라우터는 목이라 직접 재렌더로 remount 를 흉내(같은 client = 캐시 공유).
    render(
      <SlotFillPage tripId={TRIP_ID} slotKey={buildSlotKey(DAY1, 'b')} />,
      {
        wrapper: Wrapper,
      }
    );
    await pickConcept('culture');
    await screen.findByTestId('itinerary-candidate-radio-Y');
    fireEvent.press(screen.getByTestId('itinerary-candidate-radio-Y'));
    fireEvent.press(screen.getByTestId('itinerary-copick-slotfill-confirm'));

    await waitFor(() => expect(putCalls).toBe(2));
    // ★ 둘째 PUT 바디에 앞서 확정한 X 가 살아 있어야 한다 — 무효화가 없으면 다음 화면이 stale [a, b]
    // 를 읽어 slot a 가 X→a 로 되돌아간다(경고-1 데이터 손실). slot b 는 이번에 고른 Y.
    const second = putBody as EditItineraryRequest;
    expect(second.days[0].slots[0].poiId).toBe('X');
    expect(second.days[0].slots[1].poiId).toBe('Y');
  });
});
