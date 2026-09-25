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
import { buildSlotKey } from '@/entities/itinerary-slot/lib/slotKey';
import { SLOT_SWAP_CONFLICT_CODES } from '@/features/itinerary/model/slotSwapError';
import type {
  EditItineraryRequest,
  Itinerary,
  ItineraryDaysItem,
} from '@/shared/api/generated/schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';

import { SlotCandidatePanelContainer } from './SlotCandidatePanelContainer';

/**
 * h08 슬롯 교체 배선을 **실 HTTP 로** 태우는 심판(TRIP-793 — 컨테이너는 이제 `SlotCandidateSheet`
 * (바텀시트·라디오 2단계)를 그린다). 프레젠테이션이 인라인 패널→바텀시트로, 확정이 즉시확정 1단계→
 * 라디오 2단계로 바뀌었어도 **배선 로직은 재사용**이다(조회·치환·PUT·firedRef·콜드캐시).
 *
 * 무엇을 보장하나:
 *  - 마운트(=시트 열림)에 slot-candidates POST 1건, slotKey 만(BR-U3-24).
 *  - 화면 후보 집합 = 응답 집합(INV-1).
 *  - 🔴 **라디오 2단계**: 행 press 는 선택만(PUT 0) · "교체하기" press 에서 전체 days PUT 1건·성공 시
 *    onClose + 재조회(AC-4).
 *  - ★h09: 동기 연속 확정 2회여도 PUT 1건(firedRef, handleConfirm).
 *  - PUT 409/500/네트워크 실패는 인라인 오류로 뜨고 시트를 안 닫는다(AC-6·INV-4).
 *  - 🔴 GET 미도착 중 확정 → PUT 0(빈 days 전체교체 방지, 경고3).
 *  - 🔴 **PARTIAL(2차 생성 중)이면 확정 PUT 0**(★ 가드가 handleConfirm 으로 이전 · AC-11 · 뮤테이션 실측).
 *  - 🔴 **헤더에 시각범위·컨셉 관통**(`{HH:mm}–{HH:mm} · {category} 슬롯의 …`, K10 · D5 · 옛 timeBand 대체).
 *  - 🔴 **degraded 전용 표면 제거**(응답이 degraded 여도 시트에 무표시 · AC-6, K12).
 *
 * 3동작 뼈대: 준비=가짜 서버 응답 → 실행=열고 라디오+확정 → 단언=나간 요청·보이는 것.
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

/** day1=[a(09:30–11:00 · category 문화) · b] · day2=[c](endsNextDay). 교체 대상은 day1 의 a. */
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
          category: '문화',
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

/** 후보 카드 루트 셀렉터(재설계 반영 — 하위·특수 testID 부정 룩어헤드 제외). */
const CANDIDATE_ROOT =
  /^itinerary-candidate-(?!sheet|scrim|current|empty|error|place-search|confirm|name-|image-|distance-|tags-|radio-|check-)/;

/** 라디오 선택 후 "교체하기"를 눌러 확정하는 2단계 헬퍼. */
async function selectAndConfirm(poiId: string) {
  fireEvent.press(
    await screen.findByTestId(`itinerary-candidate-radio-${poiId}`)
  );
  fireEvent.press(screen.getByTestId('itinerary-candidate-confirm'));
}

describe('🔴 SlotCandidatePanelContainer (h08) 배선', () => {
  it('K1 · AC1·BR-U3-24 — 마운트에 slot-candidates POST 1건, slotKey 만 실린다', async () => {
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

  it('K3 · AC4 — 라디오 2단계: 행 선택은 PUT 0, "교체하기"에서 치환 PUT 1건 + onClose + 재조회', async () => {
    renderContainer();
    await screen.findByTestId('itinerary-candidate-radio-X');
    await waitFor(() => expect(getCalls).toBe(1));

    // 1단계 — 라디오 선택은 controlled 상태만 바꾼다(PUT 안 나감).
    fireEvent.press(screen.getByTestId('itinerary-candidate-radio-X'));
    expect(putCalls).toBe(0);

    // 2단계 — "교체하기"에서 확정.
    fireEvent.press(screen.getByTestId('itinerary-candidate-confirm'));

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

  it('K4 · AC4(★h09) — 확정 CTA 동기 연속 2회여도 PUT 은 1건이다(firedRef)', async () => {
    renderContainer();
    fireEvent.press(await screen.findByTestId('itinerary-candidate-radio-X'));
    const confirm = screen.getByTestId('itinerary-candidate-confirm');

    act(() => {
      fireEvent.press(confirm);
      fireEvent.press(confirm);
    });

    await waitFor(() => expect(mockClose).toHaveBeenCalledTimes(1));
    expect(putCalls).toBe(1);
  });

  it('K5 · AC6 — PUT 409(확정)는 인라인 오류로 뜨고 시트를 안 닫는다', async () => {
    putHandler = () =>
      HttpResponse.json(
        {
          error: { code: SLOT_SWAP_CONFLICT_CODES.confirmed, message: '확정' },
        },
        { status: 409 }
      );
    renderContainer();
    await selectAndConfirm('X');

    await waitFor(() => expect(putCalls).toBe(1));
    const err = await screen.findByTestId('itinerary-candidate-error');
    expect(err).toHaveTextContent(/\S/);
    expect(mockClose).toHaveBeenCalledTimes(0);
    expect(screen.getByTestId('itinerary-candidate-sheet')).toBeOnTheScreen();
  });

  it('K6 · AC6·INV-4 — PUT 500 도 침묵하지 않는다', async () => {
    putHandler = () => new HttpResponse(null, { status: 500 });
    renderContainer();
    await selectAndConfirm('X');

    const err = await screen.findByTestId('itinerary-candidate-error');
    expect(err).toHaveTextContent(/\S/);
    expect(mockClose).toHaveBeenCalledTimes(0);
  });

  it('K7 · AC6·INV-4 — PUT 네트워크 실패도 침묵하지 않는다', async () => {
    putHandler = () => HttpResponse.error();
    renderContainer();
    await selectAndConfirm('X');

    const err = await screen.findByTestId('itinerary-candidate-error');
    expect(err).toHaveTextContent(/\S/);
  });

  it('K8 · 경고2 — 현 슬롯은 실이름(nameKo)을 보인다, "이름 준비 중" 아님', async () => {
    renderContainer();
    const current = await screen.findByTestId('itinerary-candidate-current');

    await waitFor(() => expect(current).toHaveTextContent(/경복궁/));
    expect(current).not.toHaveTextContent('이름 준비 중');
  });

  it('K9 · 경고3 — GET 미도착 중 확정 → PUT 0(빈 days 전체교체 방지)', async () => {
    server.use(
      http.get(`${BASE}/trips/:tripId/itinerary`, async () => {
        await delay('infinite');
        return HttpResponse.json(itinerary());
      })
    );
    renderContainer();
    await selectAndConfirm('X');

    await waitFor(() => expect(postCalls).toBe(1));
    expect(putCalls).toBe(0);
    expect(mockClose).toHaveBeenCalledTimes(0);
  });

  it('K10 · AC2·D5 — 헤더에 현 슬롯 시각범위·컨셉이 관통된다(09:30–11:00 · 문화)', async () => {
    renderContainer();

    const subtitle = await screen.findByTestId(
      'itinerary-candidate-sheet-subtitle'
    );
    // 현 슬롯 startAt 09:30·endAt 11:00·category 문화 → 부제에 시각범위+컨셉이 실린다(옛 timeBand 대체).
    await waitFor(() => expect(subtitle).toHaveTextContent(/09:30–11:00/));
    expect(subtitle).toHaveTextContent(/문화/);
  });

  it('K11 · AC-11(★ PARTIAL 게이트 handleConfirm) — PARTIAL 중 라디오+확정 → PUT 0', async () => {
    // 준비 — GET 이 PARTIAL(day1 도착)로 정착. data 는 있어 콜드캐시(K9)와 달리 throw 안 나고,
    // 가드가 없으면 "교체하기"가 그대로 day1-only 전체교체 PUT 을 쏜다(traps-itinerary TRIP-467/483 잔여).
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
    await screen.findByTestId('itinerary-candidate-radio-X');
    await waitFor(() => expect(getCalls).toBe(1));

    // 실행 — 라디오 선택은 되지만 확정(PUT)은 막혀야 한다.
    await selectAndConfirm('X');

    // ★ 통과형 목 함정 회피 — PUT 이 나갔다면 이 대기 동안 putCalls 가 오른다(나갈 시간을 실제로 준다).
    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });

    // ★ PARTIAL 이면 전체교체 PUT 이 나가면 안 된다(handleConfirm 의 isConfirmLocked 가드).
    // 뮤테이션 실측: 이 가드를 지우면 이 테스트만 red(PUT 1) — 원복은 cp/Edit, git checkout 금지.
    expect(putCalls).toBe(0);
    expect(mockClose).toHaveBeenCalledTimes(0);
  });

  it('K12 · AC6 — degraded 전용 표면 제거: 응답이 degraded 여도 시트에 무표시', async () => {
    candidatesResponse = { ...CANDIDATES, degraded: true };
    renderContainer();

    // 후보는 뜨지만 강등 전용 표면은 더 이상 없다(옛 itinerary-candidate-degraded 소멸).
    await screen.findByTestId('itinerary-candidate-X');
    expect(screen.queryByTestId('itinerary-candidate-degraded')).toBeNull();
  });
});
