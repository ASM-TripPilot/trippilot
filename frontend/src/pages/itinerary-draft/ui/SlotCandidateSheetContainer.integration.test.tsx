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

import { SlotCandidateSheetContainer } from './SlotCandidateSheetContainer';

/**
 * h12 완전 AI 슬롯 교체 배선을 **실 HTTP 로** 태우는 심판(ItineraryEditPage.integration 골격).
 *
 * 무엇을 보장하나:
 *  - 마운트(=시트 열림)에 slot-candidates POST 1건이 나가고 slotKey 만 실린다 — 제외목록·반경
 *    필드 없음(AC1·BR-U3-24 와이어).
 *  - 화면에 뜬 후보 카드 집합 = 응답 후보 집합(INV-1 와이어).
 *  - "선택" 탭 → 치환된 **전체 days** 를 PUT 1건으로, 성공 시 onClose + 조회 무효화 재조회(AC2).
 *  - ★핵심(AC4·repo-trap h09): 펜딩이 전파되기 전 **동기 연속 탭 2회여도 PUT 1건** — firedRef 강제.
 *  - PUT 실패(409·500·네트워크)는 인라인 오류로 뜨고 시트를 안 닫는다(AC7).
 *
 * 왜 통합 버킷인가: "PUT 이 몇 건 나갔나·바디가 맞나·무효화로 재조회했나" 는 훅을 목킹하면
 * 테스트의 *가정*이 된다. 실제 버튼 press 로 나간 요청·보이는 것만 관찰한다(선례 IS1·IS4).
 *
 * 3동작 뼈대: 준비=가짜 서버 응답 → 실행=열고 선택 → 단언=나간 요청·보이는 것.
 */

// 생성 클라이언트의 인증 계층이 expo-secure-store 를 정적으로 문다 — 실물 로드 회피(h25 선례).
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

/** day1=[a, b] · day2=[c](endsNextDay:true). 교체 대상은 day1 의 a. */
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
};

let getCalls = 0;
let postCalls = 0;
let putCalls = 0;
let postBody: unknown = null;
let putBody: unknown = null;
let putHandler: () => Response;

const mockClose = jest.fn();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

beforeEach(() => {
  getCalls = 0;
  postCalls = 0;
  putCalls = 0;
  postBody = null;
  putBody = null;
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
        return HttpResponse.json(CANDIDATES);
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
    <SlotCandidateSheetContainer
      tripId={TRIP_ID}
      slotKey={CURRENT_SLOT_KEY}
      onClose={mockClose}
    />,
    { wrapper: Wrapper }
  );
}

const CANDIDATE_ROOT =
  /^itinerary-candidate-(?!sheet|current|empty|error|name-|image-|distance-|rationale-|select-|radio-)/;

describe('🔴 SlotCandidateSheetContainer (h12) 배선', () => {
  it('C1 · AC1·BR-U3-24 — 마운트에 slot-candidates POST 1건, slotKey 만 실린다(제외목록 없음)', async () => {
    renderContainer();

    await waitFor(() => expect(postCalls).toBe(1));
    expect((postBody as { slotKey: string }).slotKey).toBe(CURRENT_SLOT_KEY);
    // radiusM·concept·excludePoiIds 등 없음 — slotKey 하나뿐.
    expect(Object.keys(postBody as object).sort()).toEqual(['slotKey']);
    await screen.findByTestId('itinerary-candidate-X');
  });

  it('C2 · INV-1 — 렌더 후보 카드 집합 = 응답 후보 집합', async () => {
    renderContainer();

    await screen.findByTestId('itinerary-candidate-X');
    const poiIds = screen
      .getAllByTestId(CANDIDATE_ROOT)
      .map((n) => String(n.props.testID).replace('itinerary-candidate-', ''));
    expect(poiIds.sort()).toEqual(['X', 'Y'].sort());
  });

  it('C3 · AC1·AC2 — "선택" 탭 → 치환된 전체 days 를 PUT 1건, 성공 시 onClose + 조회 재조회', async () => {
    renderContainer();
    await screen.findByTestId('itinerary-candidate-select-X');
    await waitFor(() => expect(getCalls).toBe(1));

    fireEvent.press(screen.getByTestId('itinerary-candidate-select-X'));

    await waitFor(() => expect(putCalls).toBe(1));
    const body = putBody as EditItineraryRequest;
    // 전체 교체 — 두 일자 전부.
    expect(body.days.map((d) => d.date)).toEqual([DAY1, DAY2]);
    // a → X 치환 · 이웃 b 불변.
    expect(body.days[0].slots[0].poiId).toBe('X');
    expect(body.days[0].slots[1].poiId).toBe('b');
    // 옛 시각 초까지 보존.
    expect(body.days[0].slots[0].startAt).toBe('09:30:00');
    // 5필드뿐 — 제외목록 없음(와이어 확인).
    expect(Object.keys(body.days[0].slots[0]).sort()).toEqual(
      ['poiId', 'startAt', 'endAt', 'isFixed', 'endsNextDay'].sort()
    );

    // 성공 → 시트 닫힘(onClose) + 조회 무효화로 재조회(GET 1→2).
    await waitFor(() => expect(mockClose).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(getCalls).toBe(2));
  });

  it('C4 · AC4(★h09) — 동기 연속 탭 2회여도 PUT 은 1건이다', async () => {
    renderContainer();
    const button = await screen.findByTestId('itinerary-candidate-select-X');

    // 펜딩이 전파(재렌더)되기 전 같은 틱에 두 번 — firedRef 없으면 두 번째가 통과해 PUT 2건.
    act(() => {
      fireEvent.press(button);
      fireEvent.press(button);
    });

    await waitFor(() => expect(mockClose).toHaveBeenCalledTimes(1));
    expect(putCalls).toBe(1);
  });

  it('C5 · AC7 — PUT 409(확정)는 인라인 오류로 뜨고 시트를 안 닫는다', async () => {
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
    // 실패엔 안 닫힌다(성공만 닫는다).
    expect(mockClose).toHaveBeenCalledTimes(0);
    expect(screen.getByTestId('itinerary-candidate-sheet')).toBeOnTheScreen();
  });

  it('C6 · AC7·INV-4 — PUT 500 도 침묵하지 않는다', async () => {
    putHandler = () => new HttpResponse(null, { status: 500 });
    renderContainer();
    fireEvent.press(await screen.findByTestId('itinerary-candidate-select-X'));

    const err = await screen.findByTestId('itinerary-candidate-error');
    expect(err).toHaveTextContent(/\S/);
    expect(mockClose).toHaveBeenCalledTimes(0);
  });

  it('C7 · AC7·INV-4 — PUT 네트워크 실패도 침묵하지 않는다', async () => {
    putHandler = () => HttpResponse.error();
    renderContainer();
    fireEvent.press(await screen.findByTestId('itinerary-candidate-select-X'));

    const err = await screen.findByTestId('itinerary-candidate-error');
    expect(err).toHaveTextContent(/\S/);
  });

  // 5-b 경고2 봉합 — 현 슬롯 실이름은 후보와 달리 이미 GET 에 있다(nameKo). 배선이 이를 내려
  // 플레이스홀더 대신 실이름을 보이는지 잠근다(후보 이름·사진은 여전히 미확보).
  it('C8 · 경고2 — 현 슬롯은 실이름(nameKo)을 보인다, "이름 준비 중" 아님', async () => {
    renderContainer();
    const current = await screen.findByTestId('itinerary-candidate-current');

    await waitFor(() => expect(current).toHaveTextContent(/경복궁/));
    expect(current).not.toHaveTextContent('이름 준비 중');
  });

  // 5-b 경고3 봉합 — itinerary GET 미도착(콜드 캐시) 중 선택하면 빈 days 전체교체 PUT 이 나가
  // 일정이 소실될 수 있다. 로딩 가드가 이를 막는지 잠근다.
  it('C9 · 경고3 — GET 미도착 중 선택 → PUT 0(빈 days 전체교체 방지)', async () => {
    // GET 을 영영 응답하지 않게 덮어 itinerary.data 를 undefined 로 묶는다(POST 는 즉시 응답).
    server.use(
      http.get(`${BASE}/trips/:tripId/itinerary`, async () => {
        await delay('infinite');
        return HttpResponse.json(itinerary());
      })
    );
    renderContainer();
    await screen.findByTestId('itinerary-candidate-select-X'); // POST 는 도착

    fireEvent.press(screen.getByTestId('itinerary-candidate-select-X'));

    await waitFor(() => expect(postCalls).toBe(1));
    expect(putCalls).toBe(0);
    expect(mockClose).toHaveBeenCalledTimes(0);
  });
});
