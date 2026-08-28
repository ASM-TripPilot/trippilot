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
import { SLOT_SWAP_CONFLICT_CODES } from '@/features/itinerary/model/slotSwapError';
import type {
  EditItineraryRequest,
  Itinerary,
  ItineraryDaysItem,
} from '@/shared/api/generated/schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';

import { SlotCandidatePanelContainer } from './SlotCandidatePanelContainer';

/**
 * h12 완전 AI 슬롯 교체 배선을 **실 HTTP 로** 태우는 심판(TRIP-335→483 이관).
 *
 * 프레젠테이션이 바텀시트→인라인 패널로 바뀌었지만 **배선 로직은 재사용**이다 — 이 파일은
 * 그 로직이 개명(`SlotCandidateSheetContainer`→`SlotCandidatePanelContainer`) 후에도 그대로
 * 무는지를 실 요청으로 재확인한다(★D). testID 는 `-sheet`→`-panel` 개명분만 반영한다.
 *
 * 무엇을 보장하나:
 *  - 마운트(=패널 열림)에 slot-candidates POST 1건, slotKey 만(BR-U3-24).
 *  - 화면 후보 집합 = 응답 집합(INV-1) · "선택"→치환 전체 days PUT 1건·성공 시 onClose+재조회.
 *  - ★h09: 동기 연속 탭 2회여도 PUT 1건(firedRef).
 *  - PUT 409/500/네트워크 실패는 인라인 오류로 뜨고 패널을 안 닫는다(AC3·INV-4).
 *  - 🔴 **헤더에 시간대가 관통된다**(`{시간대} — 다른 후보로 바꾸기`, K10 · 신규).
 *  - 🔴 **응답 degraded===true 면 강등 고지가 뜬다**(K11 · AC6 · 신규).
 *
 * 3동작 뼈대: 준비=가짜 서버 응답 → 실행=열고 선택 → 단언=나간 요청·보이는 것.
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

const BASE = 'http://localhost:8080/api/v1';
const TRIP_ID = '11111111-1111-1111-1111-111111111111';
const DAY1 = '2026-06-10';
const DAY2 = '2026-06-11';
const CURRENT_SLOT_KEY = buildSlotKey(DAY1, 'a');

/** day1=[a(09:30 → 오전), b] · day2=[c](endsNextDay:true). 교체 대상은 day1 의 a. */
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
    {
      date: DAY2,
      slots: [
        {
          poiId: 'c',
          startAt: '22:00:00',
          endAt: '01:00:00',
          isFixed: false,
          endsNextDay: true,
          hasViolation: false,
          tags: [],
        },
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

const CANDIDATES = {
  candidates: [
    { poiId: 'X', distanceRange: '420m', rationale: '가장 가까운 실내 전시' },
    { poiId: 'Y', distanceRange: '1.1km', rationale: '조용한 카페' },
  ],
  radiusMUsed: 1100,
  degraded: false,
};

let getCalls = 0;
let postCalls = 0;
let putCalls = 0;
let postBody: unknown = null;
let putBody: unknown = null;
let putHandler: () => Response;
let candidatesResponse: object = CANDIDATES;

const mockClose = jest.fn();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

beforeEach(() => {
  getCalls = 0;
  postCalls = 0;
  putCalls = 0;
  postBody = null;
  putBody = null;
  candidatesResponse = CANDIDATES;
  mockClose.mockClear();
  setAccessToken('valid-access');
  putHandler = () => HttpResponse.json(itinerary());

  server.use(
    http.get(`${BASE}/trips/:tripId/itinerary`, () => {
      getCalls += 1;
      return HttpResponse.json(itinerary());
    }),
    http.post(
      `${BASE}/trips/:tripId/itinerary/slot-candidates`,
      async ({ request }) => {
        postCalls += 1;
        postBody = await request.json();
        return HttpResponse.json(candidatesResponse);
      }
    ),
    http.put(`${BASE}/trips/:tripId/itinerary`, async ({ request }) => {
      putCalls += 1;
      putBody = await request.json();
      return putHandler();
    })
  );
});

afterEach(() => {
  server.resetHandlers();
  clearAccessToken();
});

afterAll(() => server.close());

function renderContainer() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  return render(
    <SlotCandidatePanelContainer
      tripId={TRIP_ID}
      slotKey={CURRENT_SLOT_KEY}
      onClose={mockClose}
    />,
    { wrapper: Wrapper }
  );
}

const CANDIDATE_ROOT =
  /^itinerary-candidate-(?!panel|current|empty|error|degraded|name-|image-|distance-|rationale-|select-|radio-)/;

describe('🔴 SlotCandidatePanelContainer (h12) 배선', () => {
  it('K1 · AC1·BR-U3-24 — 마운트에 slot-candidates POST 1건, slotKey 만 실린다(제외목록 없음)', async () => {
    renderContainer();

    await waitFor(() => expect(postCalls).toBe(1));
    expect((postBody as { slotKey: string }).slotKey).toBe(CURRENT_SLOT_KEY);
    expect(Object.keys(postBody as object).sort()).toEqual(['slotKey']);
    await screen.findByTestId('itinerary-candidate-X');
  });

  it('K2 · INV-1 — 렌더 후보 카드 집합 = 응답 후보 집합', async () => {
    renderContainer();

    await screen.findByTestId('itinerary-candidate-X');
    const poiIds = screen
      .getAllByTestId(CANDIDATE_ROOT)
      .map((n) => String(n.props.testID).replace('itinerary-candidate-', ''));
    expect(poiIds.sort()).toEqual(['X', 'Y'].sort());
  });

  it('K3 · AC1·AC3 — "선택" 탭 → 치환된 전체 days 를 PUT 1건, 성공 시 onClose + 조회 재조회', async () => {
    renderContainer();
    await screen.findByTestId('itinerary-candidate-select-X');
    await waitFor(() => expect(getCalls).toBe(1));

    fireEvent.press(screen.getByTestId('itinerary-candidate-select-X'));

    await waitFor(() => expect(putCalls).toBe(1));
    const body = putBody as EditItineraryRequest;
    expect(body.days.map((d) => d.date)).toEqual([DAY1, DAY2]);
    expect(body.days[0].slots[0].poiId).toBe('X');
    expect(body.days[0].slots[1].poiId).toBe('b');
    expect(body.days[0].slots[0].startAt).toBe('09:30:00');
    expect(Object.keys(body.days[0].slots[0]).sort()).toEqual(
      ['poiId', 'startAt', 'endAt', 'isFixed', 'endsNextDay'].sort()
    );

    await waitFor(() => expect(mockClose).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(getCalls).toBe(2));
  });

  it('K4 · AC3(★h09) — 동기 연속 탭 2회여도 PUT 은 1건이다', async () => {
    renderContainer();
    const button = await screen.findByTestId('itinerary-candidate-select-X');

    act(() => {
      fireEvent.press(button);
      fireEvent.press(button);
    });

    await waitFor(() => expect(mockClose).toHaveBeenCalledTimes(1));
    expect(putCalls).toBe(1);
  });

  it('K5 · AC3 — PUT 409(확정)는 인라인 오류로 뜨고 패널을 안 닫는다', async () => {
    putHandler = () =>
      HttpResponse.json(
        {
          error: { code: SLOT_SWAP_CONFLICT_CODES.confirmed, message: '확정' },
        },
        { status: 409 }
      );
    renderContainer();
    fireEvent.press(await screen.findByTestId('itinerary-candidate-select-X'));

    await waitFor(() => expect(putCalls).toBe(1));
    const err = await screen.findByTestId('itinerary-candidate-error');
    expect(err).toHaveTextContent(/\S/);
    expect(mockClose).toHaveBeenCalledTimes(0);
    expect(screen.getByTestId('itinerary-candidate-panel')).toBeOnTheScreen();
  });

  it('K6 · AC3·INV-4 — PUT 500 도 침묵하지 않는다', async () => {
    putHandler = () => new HttpResponse(null, { status: 500 });
    renderContainer();
    fireEvent.press(await screen.findByTestId('itinerary-candidate-select-X'));

    const err = await screen.findByTestId('itinerary-candidate-error');
    expect(err).toHaveTextContent(/\S/);
    expect(mockClose).toHaveBeenCalledTimes(0);
  });

  it('K7 · AC3·INV-4 — PUT 네트워크 실패도 침묵하지 않는다', async () => {
    putHandler = () => HttpResponse.error();
    renderContainer();
    fireEvent.press(await screen.findByTestId('itinerary-candidate-select-X'));

    const err = await screen.findByTestId('itinerary-candidate-error');
    expect(err).toHaveTextContent(/\S/);
  });

  it('K8 · 경고2 — 현 슬롯은 실이름(nameKo)을 보인다, "이름 준비 중" 아님', async () => {
    renderContainer();
    const current = await screen.findByTestId('itinerary-candidate-current');

    await waitFor(() => expect(current).toHaveTextContent(/경복궁/));
    expect(current).not.toHaveTextContent('이름 준비 중');
  });

  it('K9 · 경고3 — GET 미도착 중 선택 → PUT 0(빈 days 전체교체 방지)', async () => {
    server.use(
      http.get(`${BASE}/trips/:tripId/itinerary`, async () => {
        await delay('infinite');
        return HttpResponse.json(itinerary());
      })
    );
    renderContainer();
    await screen.findByTestId('itinerary-candidate-select-X');

    fireEvent.press(screen.getByTestId('itinerary-candidate-select-X'));

    await waitFor(() => expect(postCalls).toBe(1));
    expect(putCalls).toBe(0);
    expect(mockClose).toHaveBeenCalledTimes(0);
  });

  it('K12 · TRIP-601 가드 b — generationState=PARTIAL 이면 후보 선택 PUT 0(생성 중 전체교체 차단)', async () => {
    // 준비 — GET 이 PARTIAL(day1 도착)로 정착한다. day1 data 는 있으므로 콜드캐시(K9)와 달리 throw 가
    // 안 나고, 가드가 없으면 "선택"이 그대로 day1-only 전체교체 PUT 을 쏜다(★b-2 · copick 형제와 동형).
    server.use(
      http.get(`${BASE}/trips/:tripId/itinerary`, () => {
        getCalls += 1;
        return HttpResponse.json({
          ...itinerary(),
          generationState: 'PARTIAL',
        });
      })
    );
    renderContainer();
    await screen.findByTestId('itinerary-candidate-select-X');
    await waitFor(() => expect(getCalls).toBe(1));

    // 실행 — 후보 "선택" 탭. 조회(POST)는 정상, 막는 건 확정(PUT)뿐이다.
    fireEvent.press(screen.getByTestId('itinerary-candidate-select-X'));

    // ★b-1 통과형 목 함정 회피 — PUT 이 나갔다면 이 대기 동안 putCalls 가 오른다. 나갈 시간을 실제로
    // 줘야 "안 나갔다"가 거짓 green 이 아니다(K9 콜드캐시는 mutate 미호출이라 이 대기가 불필요했다).
    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });

    // ★ PARTIAL 이면 전체교체 PUT 이 나가면 안 된다(서버 409 의 클라 사본, 심층 방어).
    expect(putCalls).toBe(0);
    // 막혔으니 성공 콜백의 onClose 도 없다.
    expect(mockClose).toHaveBeenCalledTimes(0);
  });

  it('K10 · AC2 — 헤더에 현 슬롯 시간대가 관통된다(09:30 → 오전)', async () => {
    renderContainer();

    const title = await screen.findByTestId('itinerary-candidate-panel-title');
    // 현 슬롯 startAt 09:30:00 → timeBandLabel = 오전. 헤더는 `{시간대} — 다른 후보로 바꾸기`.
    await waitFor(() =>
      expect(title).toHaveTextContent(/오전 — 다른 후보로 바꾸기/)
    );
  });

  it('K11 · AC6·★E — 응답 degraded===true 면 강등 고지가 뜨고, false 면 미표시', async () => {
    candidatesResponse = { ...CANDIDATES, degraded: true };
    renderContainer();

    const notice = await screen.findByTestId('itinerary-candidate-degraded');
    expect(notice).toHaveTextContent(/AI 추천 준비 중/);
  });

  it('K11b · AC6 — degraded===false 면 강등 고지가 미표시(후보는 뜬다)', async () => {
    candidatesResponse = { ...CANDIDATES, degraded: false };
    renderContainer();

    await screen.findByTestId('itinerary-candidate-X');
    expect(screen.queryByTestId('itinerary-candidate-degraded')).toBeNull();
  });
});
