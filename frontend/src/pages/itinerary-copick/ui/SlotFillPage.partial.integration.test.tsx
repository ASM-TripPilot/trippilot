import type { ReactNode } from 'react';
import { delay, http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

import { server } from '@/mocks/server';
import { buildSlotKey } from '@/entities/itinerary-slot/lib/slotKey';
import { DRAFT_POLL_INTERVAL_MS } from '@/features/itinerary/model/draftView';
import type {
  Itinerary,
  ItineraryDaysItem,
  ItineraryGenerationState,
  SlotCandidatesRequest,
} from '@/shared/api/generated/schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';

import { SlotFillPage } from './SlotFillPage';

/**
 * TRIP-978 · 같이 짜기 슬롯 채우기가 생성 중(PARTIAL) 일정에 갇히지 않는다.
 *
 * 무엇을 보장하나:
 *  - AC-1·AC-2: PARTIAL 인 동안 일정 GET 을 다시 부르고, COMPLETE·FAILED 에 닿으면 멈춘다(상한 없음, Q1).
 *  - AC-3·AC-4: PARTIAL 동안 'X로 선택'은 비활성 + "나머지 일정을 만드는 중이에요", PUT 0(INV-4).
 *  - AC-5·AC-6: COMPLETE 로 풀리면 확정이 되고, day1 마지막 슬롯은 complete 가 아니라 2일차로 전진한다.
 *    진행 줄 총 일수도 2 가 된다.
 *  - AC-7(Q2): 후보 조회 409 는 사유 문구로 말한다(0건 얼굴로 속이지 않음). 막힌 채 잠금이 풀리면 같은
 *    컨셉·반경으로 1회 다시 조회한다. 조회 중엔 0건 얼굴을 띄우지 않는다.
 *
 * 3동작: 준비=GET 응답을 호출 차수별로 정한다(itineraryScript) → 실행=머물거나 조작 → 단언=나간 요청 수·보이는 문구.
 * 폴링은 실타이머로 한 간격(2초)만 흘린다(DraftPage.integration I1 선례).
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
const TRIP_ID = '33333333-3333-3333-3333-333333333333';
const DAY1 = '2026-10-12';
const DAY2 = '2026-10-13';
const POLL_TEST_TIMEOUT = 30000;
// 폴링을 기다리는 waitFor 한도 — 간격의 5배. 3배(6초)는 CI 러너 부하에서 모자라 P-FAILED·P-UNLOCK 이
// 간헐 실패했다(PR #755 첫 CI). 단언 내용은 그대로, 기다리는 시간만 늘린다.
const POLL_WAIT_MS = DRAFT_POLL_INTERVAL_MS * 5;
const LOCKED_TEXT = '나머지 일정을 만드는 중이에요';
// resolveSlotSwapError 폴백 문구(slotSwapError.ts MESSAGE.fallback) — 실서버 409 코드는 늘 CONFLICT 라 여기로 떨어진다.
const FALLBACK_TEXT = '지금은 바꿀 수 없어요. 잠시 후 다시 시도해 주세요';
const CONFLICT_BODY = {
  error: {
    code: 'CONFLICT',
    message: '일정 생성이 진행 중입니다. 완료 후 교체할 수 있습니다.',
  },
};

function slot(poiId: string, startAt: string, endAt: string) {
  return {
    poiId,
    startAt,
    endAt,
    isFixed: false,
    endsNextDay: false,
    hasViolation: false,
    tags: [],
  };
}

// 2일 여행 — day1 [a, b], day2 [c]. PARTIAL 은 day1 만 담긴다(openapi POST 201).
function itinerary(state: ItineraryGenerationState): Itinerary {
  const day1: ItineraryDaysItem = {
    date: DAY1,
    slots: [
      slot('a', '09:30:00', '11:00:00'),
      slot('b', '13:00:00', '14:00:00'),
    ],
  };
  const day2: ItineraryDaysItem = {
    date: DAY2,
    slots: [slot('c', '10:00:00', '11:30:00')],
  };
  return {
    itineraryId: 'itin-978',
    tripId: TRIP_ID,
    status: 'PLANNED',
    solveMode: 'FULL_AI',
    generationMode: 'CO_PLAN',
    generationState: state,
    isFallback: false,
    days: state === 'COMPLETE' ? [day1, day2] : [day1],
  };
}

const CANDIDATES = {
  candidates: [
    { poiId: 'X', distanceRange: '420m', rationale: '가장 가까운 실내 전시' },
    { poiId: 'Y', distanceRange: '770m', rationale: '조용한 카페' },
  ],
  radiusMUsed: 1100,
};

// 테스트별로 바꿔 끼우는 응답 대본 — call 은 0부터 센 호출 차수.
let itineraryScript: (call: number) => Itinerary;
let candidatesScript: (call: number) => Response | Promise<Response>;
let getCalls = 0;
let postCalls = 0;
let postBodies: SlotCandidatesRequest[] = [];
let putCalls = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

beforeEach(() => {
  getCalls = 0;
  postCalls = 0;
  postBodies = [];
  putCalls = 0;
  mockBack.mockClear();
  mockPush.mockClear();
  mockReplace.mockClear();
  itineraryScript = () => itinerary('COMPLETE');
  candidatesScript = () => HttpResponse.json(CANDIDATES);
  setAccessToken('valid-access');

  server.use(
    http.get(`${BASE}/trips/:tripId/itinerary`, () => {
      const call = getCalls;
      getCalls += 1;
      return HttpResponse.json(itineraryScript(call));
    }),
    http.post(
      `${BASE}/trips/:tripId/itinerary/slot-candidates`,
      async ({ request }) => {
        const call = postCalls;
        postCalls += 1;
        postBodies.push((await request.json()) as SlotCandidatesRequest);
        return candidatesScript(call);
      }
    ),
    http.put(`${BASE}/trips/:tripId/itinerary`, () => {
      putCalls += 1;
      return HttpResponse.json(itinerary('COMPLETE'));
    })
  );
});

afterEach(() => {
  server.resetHandlers();
  clearAccessToken();
});

afterAll(() => server.close());

function renderPage(slotKey: string = buildSlotKey(DAY1, 'a')) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { gcTime: 0 },
    },
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
  fireEvent.press(await screen.findByTestId(`itinerary-copick-concept-${key}`));
}

function conflict() {
  return HttpResponse.json(CONFLICT_BODY, { status: 409 });
}

describe('🔴 TRIP-978 · PARTIAL 폴링 (AC-1·AC-2)', () => {
  it(
    'P-POLL · PARTIAL 이면 일정을 다시 조회하고, COMPLETE 를 받은 뒤엔 더 조회하지 않는다',
    async () => {
      itineraryScript = (call) =>
        call === 0 ? itinerary('PARTIAL') : itinerary('COMPLETE');

      renderPage();

      await waitFor(() => expect(getCalls).toBe(2), {
        timeout: POLL_WAIT_MS,
      });
      await sleep(DRAFT_POLL_INTERVAL_MS + 400);
      expect(getCalls).toBe(2);
    },
    POLL_TEST_TIMEOUT
  );

  it(
    'P-FAILED · FAILED 에 닿아도 조회가 멈추고 확정 잠금이 풀린다',
    async () => {
      itineraryScript = (call) =>
        call === 0 ? itinerary('PARTIAL') : itinerary('FAILED');

      renderPage();
      await pickConcept();
      fireEvent.press(await screen.findByTestId('itinerary-candidate-radio-X'));

      await waitFor(() => expect(getCalls).toBe(2), {
        timeout: POLL_WAIT_MS,
      });
      await waitFor(
        () =>
          expect(
            screen.queryByTestId('itinerary-copick-confirm-locked')
          ).toBeNull(),
        { timeout: POLL_WAIT_MS }
      );
      expect(
        screen.getByTestId('itinerary-copick-slotfill-confirm').props
          .accessibilityState?.disabled
      ).not.toBe(true);

      await sleep(DRAFT_POLL_INTERVAL_MS + 400);
      expect(getCalls).toBe(2);
    },
    POLL_TEST_TIMEOUT
  );
});

describe('🔴 TRIP-978 · 생성 중 확정 잠금과 해제 (AC-3~AC-6)', () => {
  it('P-LOCK · PARTIAL 동안 골라도 확정 버튼은 비활성이고 잠금 사유가 보이며 PUT 이 안 나간다', async () => {
    itineraryScript = () => itinerary('PARTIAL');

    renderPage();
    await pickConcept();
    fireEvent.press(await screen.findByTestId('itinerary-candidate-radio-X'));
    const confirm = screen.getByTestId('itinerary-copick-slotfill-confirm');
    fireEvent.press(confirm);
    // PUT 이 나갔다면 이 대기 동안 핸들러가 셀 시간을 준다("안 나갔다"는 시간을 흘려야 잰다).
    await sleep(50);

    expect(confirm.props.accessibilityState?.disabled).toBe(true);
    expect(
      screen.getByTestId('itinerary-copick-confirm-locked')
    ).toHaveTextContent(LOCKED_TEXT);
    expect(putCalls).toBe(0);
    expect(mockReplace).toHaveBeenCalledTimes(0);
  });

  it(
    'P-UNLOCK · 폴링으로 COMPLETE 가 오면 확정이 풀리고, 1일차 마지막 슬롯은 complete 가 아니라 2일차 슬롯으로 전진한다',
    async () => {
      itineraryScript = (call) =>
        call === 0 ? itinerary('PARTIAL') : itinerary('COMPLETE');

      renderPage(buildSlotKey(DAY1, 'b')); // 1일차의 마지막 비고정 슬롯
      await pickConcept();
      fireEvent.press(await screen.findByTestId('itinerary-candidate-radio-X'));
      // 처음엔 잠겨 있다.
      expect(
        screen.getByTestId('itinerary-copick-confirm-locked')
      ).toBeTruthy();

      // 폴링이 COMPLETE 를 받아 오면 잠금이 풀린다.
      await waitFor(
        () =>
          expect(
            screen.queryByTestId('itinerary-copick-confirm-locked')
          ).toBeNull(),
        { timeout: POLL_WAIT_MS }
      );
      const confirm = screen.getByTestId('itinerary-copick-slotfill-confirm');
      expect(confirm.props.accessibilityState?.disabled).not.toBe(true);
      fireEvent.press(confirm);

      await waitFor(() => expect(putCalls).toBe(1));
      await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
      const destination = JSON.stringify(mockReplace.mock.calls[0][0]);
      expect(destination).toContain(buildSlotKey(DAY2, 'c'));
      expect(destination).not.toContain('complete');
      // 성공한 조회 뒤의 잠금 해제는 후보를 다시 부르지 않는다(Q2 — 실패였을 때만 재조회).
      expect(postCalls).toBe(1);
    },
    POLL_TEST_TIMEOUT
  );

  it(
    'P-DAYS · 2일 여행이 COMPLETE 로 갱신되면 진행 줄이 "1일차 / 2" 다',
    async () => {
      itineraryScript = (call) =>
        call === 0 ? itinerary('PARTIAL') : itinerary('COMPLETE');

      renderPage();
      await pickConcept();

      await waitFor(
        () =>
          expect(
            screen.getByTestId('itinerary-copick-slotfill-progress-day')
          ).toHaveTextContent(/^1일차 \/ 2 · /),
        { timeout: POLL_WAIT_MS }
      );
    },
    POLL_TEST_TIMEOUT
  );
});

describe('🔴 TRIP-978 · 후보 조회 실패를 말한다 (AC-7 · Q2)', () => {
  it('P-409-PARTIAL · 생성 중 후보 조회가 409 면 "나머지 일정을 만드는 중이에요"를 보이고 0건 얼굴을 띄우지 않는다', async () => {
    itineraryScript = () => itinerary('PARTIAL');
    candidatesScript = conflict;

    renderPage();
    await pickConcept();

    const error = await screen.findByTestId(
      'itinerary-copick-candidates-error'
    );
    expect(error).toHaveTextContent(LOCKED_TEXT);
    expect(screen.queryByTestId('itinerary-copick-zero')).toBeNull();
  });

  it('P-409-COMPLETE · 생성이 끝난 뒤의 409 는 공통 폴백 문구로 말하고 0건 얼굴을 띄우지 않는다', async () => {
    itineraryScript = () => itinerary('COMPLETE');
    candidatesScript = conflict;

    renderPage();
    await pickConcept();

    const error = await screen.findByTestId(
      'itinerary-copick-candidates-error'
    );
    expect(error).toHaveTextContent(FALLBACK_TEXT);
    expect(screen.queryByTestId('itinerary-copick-zero')).toBeNull();
  });

  it(
    'P-REQUERY · 409 로 막힌 채 잠금이 풀리면 같은 컨셉·반경으로 딱 한 번 다시 조회해 후보를 보인다',
    async () => {
      itineraryScript = (call) =>
        call === 0 ? itinerary('PARTIAL') : itinerary('COMPLETE');
      candidatesScript = (call) =>
        call === 0 ? conflict() : HttpResponse.json(CANDIDATES);

      renderPage();
      await pickConcept();
      await screen.findByTestId('itinerary-copick-candidates-error');

      await screen.findByTestId(
        'itinerary-candidate-radio-X',
        {},
        { timeout: POLL_WAIT_MS }
      );
      expect(
        screen.queryByTestId('itinerary-copick-candidates-error')
      ).toBeNull();
      expect(postCalls).toBe(2);
      expect(postBodies[1].concept).toBe('전시·문화');
      expect(postBodies[1].radiusM).toBe(1100);

      await sleep(DRAFT_POLL_INTERVAL_MS + 400);
      expect(postCalls).toBe(2);
    },
    POLL_TEST_TIMEOUT
  );

  it(
    'P-NO-REQUERY · 잠긴 적 없이(처음부터 COMPLETE) 후보 조회가 409 면 자동으로 다시 조회하지 않는다',
    async () => {
      itineraryScript = () => itinerary('COMPLETE');
      candidatesScript = conflict;

      renderPage();
      await pickConcept();
      await screen.findByTestId('itinerary-copick-candidates-error');

      await sleep(DRAFT_POLL_INTERVAL_MS + 400);
      expect(postCalls).toBe(1);
    },
    POLL_TEST_TIMEOUT
  );

  it('P-PENDING ·후보 조회가 아직 안 끝났으면 "못 찾았어요" 0건 얼굴을 띄우지 않는다', async () => {
    candidatesScript = async () => {
      await delay('infinite');
      return HttpResponse.json(CANDIDATES);
    };

    renderPage();
    await pickConcept();
    await waitFor(() => expect(postCalls).toBe(1));

    expect(screen.getByTestId('itinerary-copick-slotfill-root')).toBeTruthy();
    expect(screen.queryByTestId('itinerary-copick-zero')).toBeNull();
  });
});
