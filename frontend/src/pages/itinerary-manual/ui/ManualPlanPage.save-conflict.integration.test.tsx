import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';

import { server } from '@/mocks/server';
import { useItineraryEditStore } from '@/features/itinerary/model/itineraryEditStore';
import { useTripWizardStore } from '@/features/trip/model/tripWizardStore';
import { buildSlotKey } from '@/entities/itinerary-slot/lib/slotKey';
import type {
  Itinerary,
  ItineraryDaysItemSlotsItem,
} from '@/shared/api/generated/schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';
import { WithToastHost, resetToast } from '@/test-support/toastHarness';

import { ManualPlanPage } from './ManualPlanPage';

/**
 * TRIP-1095 · h19 직접 짜기 — 저장(PUT) 응답에 위반이 있으면 확정 전에 멈추고 묻는다(BR-U3-13 · INV-4).
 *
 * 무엇을 보장하나:
 *  - 위반 있는 PUT 성공 → 요약 게이트 「N곳에서 시간이 안 맞아요」가 뜨고 확정 POST 는 안 나간다.
 *    PUT 은 게이트보다 먼저 끝나 있다(저장은 막지 않는다 — BR-U3-12 · BR-U2-12 비차단).
 *  - [그대로 확정] → 지금의 확정 경로(확정 토스트 + h16 replace). 확정이 실패하면 배너 + 다시 저장 가능.
 *  - [고치기] → 편집기에 머물고 위반 배지가 보이며 다시 저장할 수 있다.
 *  - 게이트가 떠 있는 동안·확정 대기 중엔 저장 CTA 가 PUT 을 더 내지 않고, [그대로 확정] 연타는 1회다.
 *  - 저장 토스트는 PUT 시점 1회뿐 — 게이트 버튼이 다시 띄우지 않는다(01b Q1 ⓜ).
 *  - 위반이 없거나 PUT 이 실패하면 게이트는 없다(무회귀 짝).
 *
 * 커버하지 않는 것: 딤이 실제로 CTA 를 덮는지(jest 는 딤 뒤 버튼도 누른다 — 6-b). 다이얼로그 모양은
 * `features/itinerary/ui/SaveConflictDialog.test.tsx`.
 *
 * 3동작 뼈대: 준비=가짜 서버(MANUAL 초안 a·b, PUT 응답에 b 위반) → 실행=저장하고 확정하기·게이트 버튼 press
 * → 단언=요청 순서·수·라우터·게이트/토스트 testID.
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

const mockPush = jest.fn();
const mockBack = jest.fn();
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: mockBack, replace: mockReplace }),
  router: { push: mockPush, back: mockBack, replace: mockReplace },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/shared/map', () => require('@/test-support/mapViewMock'));

const BASE = 'http://localhost:8080/api/v1';
const TRIP_ID = '66666666-6666-6666-6666-666666666666';
const DAY = '2026-06-10';

/** 첫 조회·2왕복 사슬 대기 한도 — 로컬 1000ms 의 CI 러너(약 4배 느림) 환산(confirm 스위트 선례). */
const WAIT = { timeout: 4000 };

const CTA = 'sheet-cta-button-0';
const GATE = 'itinerary-edit-save-conflict';
const ASIS = 'itinerary-edit-save-asis';
const BACK = 'itinerary-edit-save-back';
const SAVE_ERROR = 'itinerary-manual-save-error';
const CONFIRM_ERROR = 'itinerary-manual-confirm-error';
const SAVED_TOAST = 'itinerary-manual-saved';
const CONFIRMED_TOAST = 'itinerary-confirmed-toast';
const H16 = {
  pathname: '/trips/[tripId]/itinerary',
  params: { tripId: TRIP_ID },
};
/** 사유 원문에 소요시간을 일부러 담는다 — 없으면 INV-3 부정 단언이 공허하다(02a ★11). */
const REASON = '이동 25분 필요 · 영업시간 밖: 543~618';
const badgeId = (poiId: string) =>
  `slot-stopcard-violation-${buildSlotKey(DAY, poiId)}`;

function slot(
  poiId: string,
  startAt: string,
  extra: Partial<ItineraryDaysItemSlotsItem> = {}
): ItineraryDaysItemSlotsItem {
  return {
    poiId,
    startAt,
    endAt: `${String(Number(startAt.slice(0, 2)) + 1).padStart(2, '0')}:00:00`,
    isFixed: false,
    endsNextDay: false,
    hasViolation: false,
    alternatives: [],
    tags: [],
    nameKo: `장소-${poiId}`,
    ...extra,
  };
}

function manualDraft(
  violated = false,
  status: Itinerary['status'] = 'PLANNED'
): Itinerary {
  return {
    itineraryId: 'itin-m',
    tripId: TRIP_ID,
    status,
    solveMode: 'MINIMAL',
    generationMode: 'MANUAL',
    generationState: 'COMPLETE',
    isFallback: false,
    days: [
      {
        date: DAY,
        slots: [
          slot('a', '09:00:00'),
          slot(
            'b',
            '11:00:00',
            violated ? { hasViolation: true, violationReason: REASON } : {}
          ),
        ],
      },
    ],
  };
}

/** 요청 도착 순서 — 게이트가 확정을 붙잡았는지 본다. */
let requestLog: string[] = [];
let putCalls = 0;
let confirmCalls = 0;
let putHandler: () => Response | Promise<Response>;
let confirmHandler: () => Response | Promise<Response>;

/** 응답을 붙잡아 두는 문 — "서버엔 도착했고 응답은 아직"인 순간을 만든다. */
function gate(): { wait: Promise<void>; open: () => void } {
  let open = () => {};
  const wait = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { wait, open };
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

beforeEach(() => {
  requestLog = [];
  putCalls = 0;
  confirmCalls = 0;
  [mockPush, mockBack, mockReplace].forEach((fn) => fn.mockClear());
  setAccessToken('valid-access');
  useItineraryEditStore.getState().reset();
  useTripWizardStore.getState().reset();
  // 기본 = 서버 재검증이 b 를 위반으로 판정한 PUT 200(비차단 저장).
  putHandler = () => HttpResponse.json(manualDraft(true));
  confirmHandler = () => HttpResponse.json(manualDraft(true, 'CONFIRMED'));

  server.use(
    http.get(`${BASE}/trips/:tripId/itinerary`, () =>
      HttpResponse.json(manualDraft())
    ),
    // 빈 편집기 지도 중심용 거점 조회(단언 무관 준비). `/saved-stays` 는 기본 핸들러가 받는다.
    http.get(`${BASE}/trips/:tripId/bases`, () => HttpResponse.json([])),
    http.put(`${BASE}/trips/:tripId/itinerary`, () => {
      putCalls += 1;
      requestLog.push('PUT');
      return putHandler();
    }),
    http.post(`${BASE}/trips/:tripId/itinerary/confirm`, () => {
      confirmCalls += 1;
      requestLog.push('CONFIRM');
      return confirmHandler();
    })
  );
});

// 토스트 스토어는 모듈 싱글턴이다 — describe 안이 아니라 파일 최상위에서 비운다(02a ★8).
afterEach(() => {
  resetToast();
  server.resetHandlers();
  clearAccessToken();
  useTripWizardStore.getState().reset();
});

afterAll(() => server.close());

function renderPage() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { gcTime: 0 },
    },
  });
  return render(
    <QueryClientProvider client={client}>
      <WithToastHost>
        <ManualPlanPage tripId={TRIP_ID} />
      </WithToastHost>
    </QueryClientProvider>
  );
}

async function ready(): Promise<void> {
  await screen.findByTestId(
    `slot-stopcard-${buildSlotKey(DAY, 'a')}`,
    {},
    WAIT
  );
}

/** 요청은 비동기다 — 흘려 보낸 뒤에 세야 "더 안 나갔다"가 뜻을 갖는다(02a ★5). */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 100));
  });
}

/** 열고 저장해서 게이트가 뜰 때까지. */
async function saveUntilGate() {
  renderPage();
  await ready();
  fireEvent.press(screen.getByTestId(CTA));
  return screen.findByTestId(GATE, {}, WAIT);
}

describe('🔴 M1 · AC-1·6·8 — 위반 있는 저장은 확정 전에 멈추고 요약을 띄운다 (BR-U3-13 · INV-4)', () => {
  it('PUT 응답 b 위반 → 게이트 「1곳에서 시간이 안 맞아요」 · 긍정 「그대로 확정」 · 확정 POST 0 · 이동 0', async () => {
    const gateEl = await saveUntilGate();

    expect(
      within(gateEl).getByText('1곳에서 시간이 안 맞아요')
    ).toBeOnTheScreen();
    expect(screen.getByTestId(ASIS)).toHaveTextContent('그대로 확정');
    expect(screen.getByTestId(BACK)).toHaveTextContent('고치기');
    await settle();
    expect(requestLog).toEqual(['PUT']);
    expect(confirmCalls).toBe(0);
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  });
});

// 03b(1095) 경고-1 — 1089 의 교훈(활성 일자만 보면 다른 날 위반을 놓친다)을 직접 짜기에도 건다.
describe('🔴 M1b · 위반 수는 응답 전 일자 합이다 (2일차에만 위반이어도 멈춘다)', () => {
  it('1일차 깨끗 · 2일차 c 위반 → 게이트 「1곳에서 시간이 안 맞아요」 · 확정 0', async () => {
    const DAY2 = '2026-06-11';
    putHandler = () =>
      HttpResponse.json({
        ...manualDraft(),
        days: [
          ...manualDraft().days,
          {
            date: DAY2,
            slots: [
              slot('c', '10:00:00', {
                hasViolation: true,
                violationReason: REASON,
              }),
            ],
          },
        ],
      });

    const gateEl = await saveUntilGate();

    expect(
      within(gateEl).getByText('1곳에서 시간이 안 맞아요')
    ).toBeOnTheScreen();
    await settle();
    expect(requestLog).toEqual(['PUT']);
    expect(confirmCalls).toBe(0);
    expect(mockReplace).not.toHaveBeenCalled();
  });
});

describe('🔴 M2 · AC-3 — 게이트는 PUT 이 끝난 뒤에 선다 (저장을 막지 않는다 · BR-U3-12)', () => {
  it('PUT 응답 전엔 게이트가 없고, 응답이 오면 뜬다 · PUT 은 1회', async () => {
    const door = gate();
    putHandler = async () => {
      await door.wait;
      return HttpResponse.json(manualDraft(true));
    };
    renderPage();
    await ready();

    fireEvent.press(screen.getByTestId(CTA));
    await waitFor(() => expect(putCalls).toBe(1), WAIT);
    await settle();
    expect(screen.queryByTestId(GATE)).toBeNull();

    door.open();

    expect(await screen.findByTestId(GATE, {}, WAIT)).toBeOnTheScreen();
    expect(putCalls).toBe(1);
    expect(confirmCalls).toBe(0);
  });
});

describe('🔴 M3 · AC-7 — 요약에 사유 원문·소요시간이 없다 (INV-3 · violationLabel D5)', () => {
  it('사유에 「이동 25분」이 있어도 게이트 텍스트엔 원문·N분·N시간·소요가 없다', async () => {
    const gateEl = await saveUntilGate();

    // 긍정 앵커 — 게이트 텍스트가 실제로 읽힌다(빈 트리면 아래 부정이 공허).
    expect(gateEl).toHaveTextContent(/시간이 안 맞아요/);
    // ★ 문자열 인자는 완전일치라 not 에 그대로 쓰면 늘 통과한다 — 부분 포함(exact:false)으로 잰다(02a ★1).
    expect(gateEl).not.toHaveTextContent(REASON, { exact: false });
    expect(gateEl).not.toHaveTextContent(/\d+\s*분/);
    expect(gateEl).not.toHaveTextContent(/\d+\s*시간/);
    expect(gateEl).not.toHaveTextContent(/소요/);
  });
});

describe('M4·M5 · AC-4·5 — 위반이 없거나 저장이 실패하면 게이트는 없다 (무회귀 · 선제 green)', () => {
  it('M4 · 위반 없는 PUT → PUT → 확정 → h16 replace 1회 · 이동 뒤에도 게이트 없음', async () => {
    putHandler = () => HttpResponse.json(manualDraft(false));
    renderPage();
    await ready();

    fireEvent.press(screen.getByTestId(CTA));

    await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1), WAIT);
    expect(mockReplace).toHaveBeenCalledWith(H16);
    await settle();
    expect(requestLog).toEqual(['PUT', 'CONFIRM']);
    expect(screen.queryByTestId(GATE)).toBeNull();
  });

  it('M5 · PUT 500 → 저장 실패 배너 · 게이트 없음 · 확정 0', async () => {
    putHandler = () => new HttpResponse(null, { status: 500 });
    renderPage();
    await ready();

    fireEvent.press(screen.getByTestId(CTA));

    expect(await screen.findByTestId(SAVE_ERROR, {}, WAIT)).toBeOnTheScreen();
    await settle();
    expect(screen.queryByTestId(GATE)).toBeNull();
    expect(confirmCalls).toBe(0);
  });
});

describe('🔴 M6·M7·M8 · AC-10·11·13 — [그대로 확정]은 지금의 확정 경로를 탄다', () => {
  it('M6 · asis → 게이트 닫힘 · 확정 1 · PUT 추가 0 · 확정 토스트 · h16 replace 1회', async () => {
    await saveUntilGate();

    fireEvent.press(screen.getByTestId(ASIS));

    await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1), WAIT);
    expect(mockReplace).toHaveBeenCalledWith(H16);
    expect(await screen.findByTestId(CONFIRMED_TOAST)).toHaveTextContent(
      '일정이 확정됐어요'
    );
    expect(screen.queryByTestId(GATE)).toBeNull();
    expect(requestLog).toEqual(['PUT', 'CONFIRM']);
  });

  it('M7 · asis → 확정 500 → 확정 실패 배너 · 이동 0 · 다시 저장하면 PUT 2 (INV-4)', async () => {
    confirmHandler = () => new HttpResponse(null, { status: 500 });
    await saveUntilGate();

    fireEvent.press(screen.getByTestId(ASIS));

    expect(
      await screen.findByTestId(CONFIRM_ERROR, {}, WAIT)
    ).toBeOnTheScreen();
    await settle();
    expect(mockReplace).not.toHaveBeenCalled();

    fireEvent.press(screen.getByTestId(CTA));
    await waitFor(() => expect(putCalls).toBe(2), WAIT);
  });

  it('M8 · 같은 틱에 asis 를 두 번 눌러도 확정 1 · replace 1', async () => {
    await saveUntilGate();
    const asis = screen.getByTestId(ASIS);

    // ★ 바깥 act 하나로 묶어야 두 누름이 게이트가 닫히기 전 같은 버튼에 닿는다(02a ★4).
    await act(async () => {
      fireEvent.press(asis);
      fireEvent.press(asis);
    });
    await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1), WAIT);
    await settle();

    expect(confirmCalls).toBe(1);
    expect(mockReplace).toHaveBeenCalledTimes(1);
  });
});

describe('🔴 M9·M10·M11 · AC-14·15 — [고치기]는 편집기에 머물고 다시 저장할 수 있다', () => {
  it('M9 · back → 게이트 닫힘 · 확정 0 · 이동 0 · b 위반 배지가 보인다', async () => {
    await saveUntilGate();

    fireEvent.press(screen.getByTestId(BACK));

    expect(screen.queryByTestId(GATE)).toBeNull();
    expect(await screen.findByTestId(badgeId('b'))).toBeOnTheScreen();
    await settle();
    expect(confirmCalls).toBe(0);
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockBack).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('M10 · back → 고쳐 다시 저장, 두 번째 응답이 깨끗하면 게이트 없이 확정 → h16', async () => {
    // ★ 첫 PUT 만 위반, 두 번째는 깨끗 — 카운터는 핸들러 전에 늘어난다(02a ★10).
    putHandler = () => HttpResponse.json(manualDraft(putCalls === 1));
    await saveUntilGate();

    fireEvent.press(screen.getByTestId(BACK));
    fireEvent.press(screen.getByTestId(CTA));

    await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1), WAIT);
    expect(mockReplace).toHaveBeenCalledWith(H16);
    expect(requestLog).toEqual(['PUT', 'PUT', 'CONFIRM']);
    expect(screen.queryByTestId(GATE)).toBeNull();
  });

  it('M11 · back → 다시 저장해도 여전히 위반이면 게이트가 다시 뜨고 확정 0', async () => {
    await saveUntilGate();

    fireEvent.press(screen.getByTestId(BACK));
    expect(screen.queryByTestId(GATE)).toBeNull();
    fireEvent.press(screen.getByTestId(CTA));

    await waitFor(() => expect(putCalls).toBe(2), WAIT);
    expect(await screen.findByTestId(GATE, {}, WAIT)).toBeOnTheScreen();
    await settle();
    expect(confirmCalls).toBe(0);
  });
});

describe('🔴 M12·M13 · AC-16·17 — 게이트·확정 대기 중엔 저장 CTA 가 PUT 을 더 내지 않는다', () => {
  it('M12 · 게이트가 떠 있는 동안 저장을 다시 눌러도 PUT 1 · 확정 0', async () => {
    await saveUntilGate();

    // ★ jest 의 press 는 딤 뒤 CTA 에도 닿는다 — 막는 것은 코드 가드여야 한다(02a ★3).
    fireEvent.press(screen.getByTestId(CTA));
    fireEvent.press(screen.getByTestId(CTA));
    await settle();

    expect(putCalls).toBe(1);
    expect(confirmCalls).toBe(0);
  });

  it('M13 · asis 뒤 확정 응답을 기다리는 동안 저장을 눌러도 PUT 1 · 확정 1', async () => {
    const door = gate();
    confirmHandler = async () => {
      await door.wait;
      return HttpResponse.json(manualDraft(true, 'CONFIRMED'));
    };
    await saveUntilGate();

    fireEvent.press(screen.getByTestId(ASIS));
    await waitFor(() => expect(confirmCalls).toBe(1), WAIT);
    fireEvent.press(screen.getByTestId(CTA));
    await settle();
    expect(putCalls).toBe(1);

    door.open();
    await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1), WAIT);
    await settle();
    expect(putCalls).toBe(1);
    expect(confirmCalls).toBe(1);
  });
});

describe('🔴 M14·M15 · AC-18(01b) — 저장 토스트는 PUT 시점 1회, 게이트 버튼은 다시 띄우지 않는다', () => {
  it('M14 · 게이트와 함께 저장 토스트가 이미 떠 있고, 지운 뒤 [고치기]를 눌러도 다시 뜨지 않는다', async () => {
    renderPage();
    await ready();
    // 앵커 — 저장 전엔 토스트가 없다(뒤의 토스트가 이번 저장 몫임을 가른다).
    expect(screen.queryByTestId(SAVED_TOAST)).toBeNull();

    fireEvent.press(screen.getByTestId(CTA));
    await screen.findByTestId(GATE, {}, WAIT);
    expect(screen.getByTestId(SAVED_TOAST)).toHaveTextContent(
      '일정을 저장했어요'
    );

    // ★ 한 번에 하나라 재호출해도 모습이 같다 — 지우고 나서 다시 뜨는지 본다(02a ★7).
    resetToast();
    fireEvent.press(screen.getByTestId(BACK));
    await settle();
    expect(screen.queryByTestId(SAVED_TOAST)).toBeNull();
  });

  it('M15 · 지운 뒤 asis 를 누르면 확정 응답 전까지 저장 토스트가 다시 뜨지 않고, 확정 뒤엔 확정 토스트다', async () => {
    const door = gate();
    confirmHandler = async () => {
      await door.wait;
      return HttpResponse.json(manualDraft(true, 'CONFIRMED'));
    };
    await saveUntilGate();
    expect(screen.getByTestId(SAVED_TOAST)).toBeOnTheScreen();

    resetToast();
    fireEvent.press(screen.getByTestId(ASIS));
    await waitFor(() => expect(confirmCalls).toBe(1), WAIT);
    await settle();
    expect(screen.queryByTestId(SAVED_TOAST)).toBeNull();

    door.open();
    expect(
      await screen.findByTestId(CONFIRMED_TOAST, {}, WAIT)
    ).toHaveTextContent('일정이 확정됐어요');
  });
});
