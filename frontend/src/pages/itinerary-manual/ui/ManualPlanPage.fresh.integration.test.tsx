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
import { useItineraryEditStore } from '@/features/itinerary/model/itineraryEditStore';
import { buildSlotKey } from '@/entities/itinerary-slot/lib/slotKey';
import { getGetTripsTripIdItineraryQueryKey } from '@/shared/api/generated/trips/trips';
import type {
  Itinerary,
  ItineraryDaysItemSlotsItem,
} from '@/shared/api/generated/schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';

import { ManualPlanPage } from './ManualPlanPage';

/**
 * TRIP-1038 C (#036) — 초안의 「처음부터 직접 짜기」 확인 뒤 편집기가 `startFresh` 로 열리면, 기존 일정을
 * 비우고 빈 MANUAL 로 시작한다. 신호가 없으면 지금처럼 기존 일정을 이어 편집한다(TRIP-601 가드 a).
 *
 * 무엇을 보장하나:
 *  - 🔴 C3 조회가 끝난 뒤 `{ generationMode:'MANUAL' }` POST 를 정확히 1번 쏘고, 새 빈 일정이 보인다.
 *  - 🔴 C4 비우는 동안(POST 비행 중 · POST 성공 뒤 새 조회 도착 전) 옛 장소가 한 번도 안 보이고 저장이 막혀
 *    있다 — 그 틈에 저장하면 옛 일정이 저장·확정될 수 있다(01 맹점 ③).
 *  - C6 짝: 신호가 없으면 POST 0 · 옛 장소가 그대로 보인다(이 짝이 C4 의 "안 보임"을 공허 통과에서 떼어 낸다).
 *  - C7 확정된 일정은 신호가 있어도 비우지 않는다(되돌릴 API 가 없다).
 *  - 🔴 C8 비운 뒤 장소를 담아 재조회돼도 다시 비우지 않는다(POST 총 1).
 *
 * 3동작 뼈대: 준비=가짜 서버(옛 AI 일정 1일 → POST 뒤 빈 MANUAL 2일) → 실행=startFresh 렌더 → 단언=POST 건수·본문·화면.
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

// POST 성공 콜백이 알림 권한 루틴을 부른다(TRIP-835) — 실물을 안 태운다(emptyStart 선례).
jest.mock('@/shared/push', () => ({
  promptAndRegisterPush: jest.fn(() => Promise.resolve()),
  registerPushIfGranted: jest.fn(() => Promise.resolve()),
  requestPushPermission: jest.fn(() => Promise.resolve('UNDETERMINED')),
}));

// 02c(5-b 보강) — 「장소 추가」가 막혔는지 push 로 잰다. 이름 붙인 목이라야 호출을 셀 수 있다.
const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: mockBack, replace: mockReplace }),
  router: { push: mockPush, back: mockBack, replace: mockReplace },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/shared/map', () => require('@/test-support/mapViewMock'));

const BASE = 'http://localhost:8080/api/v1';
const TRIP_ID = '66666666-6666-6666-6666-666666666666';
const DAY1 = '2026-10-20';
const DAY2 = '2026-10-21';

/** 첫 조회 대기 한도 — 로컬 1000ms 의 CI 러너(약 4배 느림) 환산. */
const WAIT = { timeout: 4000 };

const CTA = 'sheet-cta-button-0';
const META = 'sheet-header-meta';
/** 새 빈 MANUAL 만 2일이다 — 이 칩이 뜨면 새 일정이 화면에 들어왔다는 뜻이다(02a ★9). */
const NEW_DAY_CHIP = 'itinerary-edit-day-2';
const OLD_CARD = `slot-stopcard-${buildSlotKey(DAY1, 'old')}`;

function slot(poiId: string): ItineraryDaysItemSlotsItem {
  return {
    poiId,
    startAt: '10:00:00',
    endAt: '11:00:00',
    isFixed: false,
    endsNextDay: false,
    hasViolation: false,
    alternatives: [],
    tags: [],
    nameKo: `장소-${poiId}`,
  };
}

/** 비우기 전 일정 — AI 초안 1일(옛 장소 `old`). */
function oldDraft(status: Itinerary['status'] = 'PLANNED'): Itinerary {
  return {
    itineraryId: 'itin-old',
    tripId: TRIP_ID,
    status,
    solveMode: 'DETERMINISTIC',
    generationMode: 'FULLY_AI',
    generationState: 'COMPLETE',
    isFallback: true,
    days: [{ date: DAY1, slots: [slot('old')] }],
  };
}

/** 비운 뒤 서버 일정 — MANUAL 은 전 일자를 빈 슬롯으로 깐다(emptyStart 선례). */
function freshManual(slots: ItineraryDaysItemSlotsItem[] = []): Itinerary {
  return {
    itineraryId: 'itin-new',
    tripId: TRIP_ID,
    status: 'PLANNED',
    solveMode: 'MINIMAL',
    generationMode: 'MANUAL',
    generationState: 'COMPLETE',
    isFallback: false,
    days: [
      { date: DAY1, slots },
      { date: DAY2, slots: [] },
    ],
  };
}

let requestLog: string[] = [];
let postCalls = 0;
let postBody: unknown = null;
let putCalls = 0;
let itineraryGets = 0;
/** GET 응답 — POST 전엔 옛 일정, POST 뒤엔 새 빈 일정. 케이스가 덮어쓴다. */
let getScript: () => Itinerary;
/** 응답을 붙잡아 두는 문 — 기본은 즉시 통과. */
let postDoor: Promise<void> = Promise.resolve();
let getAfterPostDoor: Promise<void> = Promise.resolve();
let posted = false;
/** 02c — 실패 경로 스위치. null 이면 정상 응답. */
let firstGetFailure: 'status500' | 'network' | null = null;
let getAfterPostFails = false;
let postFailure: (() => Response) | null = null;
let confirmCalls = 0;

function gate(): { wait: Promise<void>; open: () => void } {
  let open = () => {};
  const wait = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { wait, open };
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

// 편집 스토어는 모듈 싱글턴이다 — 최상위에서 비워 앞 케이스의 시드가 새지 않게 한다.
beforeEach(() => {
  requestLog = [];
  postCalls = 0;
  postBody = null;
  putCalls = 0;
  itineraryGets = 0;
  posted = false;
  firstGetFailure = null;
  getAfterPostFails = false;
  postFailure = null;
  confirmCalls = 0;
  [mockPush, mockReplace, mockBack].forEach((fn) => fn.mockClear());
  postDoor = Promise.resolve();
  getAfterPostDoor = Promise.resolve();
  getScript = () => (posted ? freshManual() : oldDraft());
  setAccessToken('valid-access');
  useItineraryEditStore.getState().reset();

  server.use(
    http.get(`${BASE}/trips/:tripId/itinerary`, async () => {
      itineraryGets += 1;
      requestLog.push('GET');
      if (posted) await getAfterPostDoor;
      if (!posted && firstGetFailure === 'status500')
        return new HttpResponse(null, { status: 500 });
      if (!posted && firstGetFailure === 'network') return HttpResponse.error();
      if (posted && getAfterPostFails)
        return new HttpResponse(null, { status: 500 });
      return HttpResponse.json(getScript());
    }),
    http.post(`${BASE}/trips/:tripId/itinerary`, async ({ request }) => {
      postCalls += 1;
      requestLog.push('POST');
      postBody = await request.json();
      await postDoor;
      if (postFailure !== null) return postFailure();
      posted = true;
      return HttpResponse.json(freshManual(), { status: 201 });
    }),
    http.put(`${BASE}/trips/:tripId/itinerary`, () => {
      putCalls += 1;
      return HttpResponse.json(freshManual());
    }),
    http.get(`${BASE}/trips/:tripId/bases`, () => HttpResponse.json([])),
    // 02c — CTA 가 눌려 PUT 이 성공하면 확정이 따라 나간다(미처리 오류 방지 + "옛 일정 확정" 계수).
    http.post(`${BASE}/trips/:tripId/itinerary/confirm`, () => {
      confirmCalls += 1;
      return HttpResponse.json({ ...oldDraft(), status: 'CONFIRMED' });
    })
  );
});

afterEach(() => {
  server.resetHandlers();
  clearAccessToken();
  useItineraryEditStore.getState().reset();
});

afterAll(() => server.close());

function renderPage(props: { startFresh?: boolean } = {}) {
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
  const utils = render(<ManualPlanPage tripId={TRIP_ID} {...props} />, {
    wrapper: Wrapper,
  });
  return { ...utils, client };
}

/** 요청은 비동기다 — 흘려 보낸 뒤에 세야 "안 나갔다"가 뜻을 갖는다(02a ★4). */
async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 100));
  });
}

describe('C6 · 짝 — 비우기 신호가 없으면 지금처럼 기존 일정을 이어 편집한다 (TRIP-601 가드 a · 선제 green)', () => {
  it('옛 장소 카드가 보이고, 흘려 보낸 뒤에도 생성 POST 는 0이다', async () => {
    renderPage();

    // 이 픽스처는 카드를 그린다 — 아래 C3·C4 의 "옛 카드 없음"이 공허 통과가 아닌 근거(02a ★10).
    expect(await screen.findByTestId(OLD_CARD, {}, WAIT)).toBeOnTheScreen();
    await flush();
    expect(postCalls).toBe(0);
  });
});

describe('🔴 C3 · #036 — startFresh 면 조회가 끝난 뒤 빈 MANUAL 로 한 번 비우고 새 일정을 보인다', () => {
  it('POST 1회 · 본문 { generationMode:"MANUAL" } 만 · 조회 뒤 발사 · 새 2일 일정(2일차 칩) · 옛 카드 0 · 0곳', async () => {
    renderPage({ startFresh: true });

    await waitFor(() => expect(postCalls).toBe(1), WAIT);
    // toEqual = 여분 키 0(deadlineMs 등 · BR-U3-03).
    expect(postBody).toEqual({ generationMode: 'MANUAL' });
    // 조회가 먼저 끝나야 한다 — 확정 여부를 모른 채 쏘면 확정이 풀린다(01 맹점 ⑨).
    expect(requestLog[0]).toBe('GET');
    expect(requestLog.indexOf('GET')).toBeLessThan(requestLog.indexOf('POST'));

    expect(await screen.findByTestId(NEW_DAY_CHIP, {}, WAIT)).toBeOnTheScreen();
    expect(screen.queryByTestId(OLD_CARD)).toBeNull();
    expect(screen.getByTestId(META)).toHaveTextContent('0곳');
  });
});

describe('🔴 C4 · 01 맹점 ③ — 비우는 동안 옛 장소가 안 보이고 저장이 막혀 있다', () => {
  it('POST 가 도는 중 — 옛 카드 0 · 0곳 · CTA 비활성 · 눌러도 PUT 0', async () => {
    const door = gate();
    postDoor = door.wait;
    renderPage({ startFresh: true });

    // POST 가 서버에 도착했다 = 조회는 이미 옛 일정으로 끝났다(캐시에 옛 장소가 있다).
    await waitFor(() => expect(postCalls).toBe(1), WAIT);
    await flush();

    expect(screen.queryByTestId(OLD_CARD)).toBeNull();
    expect(screen.getByTestId(META)).toHaveTextContent('0곳');
    expect(screen.getByTestId(CTA)).toBeDisabled();
    fireEvent.press(screen.getByTestId(CTA));
    await flush();
    expect(putCalls).toBe(0);

    door.open();
    expect(await screen.findByTestId(NEW_DAY_CHIP, {}, WAIT)).toBeOnTheScreen();
  });

  it('POST 성공 뒤 새 조회가 오기 전 — 옛 카드가 비치지 않는다(캐시에 쓰든 다시 조회하든 결과로 잰다)', async () => {
    const door = gate();
    getAfterPostDoor = door.wait;
    renderPage({ startFresh: true });

    await waitFor(() => expect(postCalls).toBe(1), WAIT);
    // POST 응답까지 흘려 보낸다 — 다시 조회를 택했다면 그 GET 은 문 앞에서 기다린다.
    await flush();
    await flush();

    expect(screen.queryByTestId(OLD_CARD)).toBeNull();
    expect(screen.getByTestId(CTA)).toBeDisabled();

    door.open();
    expect(await screen.findByTestId(NEW_DAY_CHIP, {}, WAIT)).toBeOnTheScreen();
    expect(screen.queryByTestId(OLD_CARD)).toBeNull();
  });
});

describe('C7 · 확정된 일정은 비우기 신호가 있어도 비우지 않는다 (확정 해제 API 없음 · 선제 green 트립와이어)', () => {
  it('startFresh + 조회 CONFIRMED → 흘려 보낸 뒤에도 POST 0', async () => {
    getScript = () => oldDraft('CONFIRMED');
    renderPage({ startFresh: true });

    await waitFor(() => expect(itineraryGets).toBe(1), WAIT);
    // 짝 — 편집기는 떠 있다.
    expect(screen.getByTestId('map-sheet-shell-root')).toBeOnTheScreen();
    await flush();
    await flush();
    expect(postCalls).toBe(0);
  });
});

describe('🔴 C8 · 01 맹점 ④ — 비운 뒤 장소를 담아 다시 조회돼도 또 비우지 않는다', () => {
  it('새 일정에 n1 이 담겨 재조회되면 n1 카드가 보이고 POST 는 총 1이다', async () => {
    const { client } = renderPage({ startFresh: true });
    await screen.findByTestId(NEW_DAY_CHIP, {}, WAIT);
    expect(postCalls).toBe(1);

    // 장소 추가(h13)가 PUT 뒤 일정 캐시를 무효화한 것과 같은 결과를 만든다.
    getScript = () => freshManual([slot('n1')]);
    await act(async () => {
      await client.invalidateQueries({
        queryKey: getGetTripsTripIdItineraryQueryKey(TRIP_ID),
      });
    });

    expect(
      await screen.findByTestId(
        `slot-stopcard-${buildSlotKey(DAY1, 'n1')}`,
        {},
        WAIT
      )
    ).toBeOnTheScreen();
    await flush();
    expect(postCalls).toBe(1);
  });
});

/**
 * 02c · 5-b 보강(03b 경고-1·2·3) — 비우기가 **실패한** 경로. 승인 스위트는 성공 창(C4)만 잠가, 실패하면
 * 옛 일정이 되살아나 확정되거나(경고-1), 서버에 옛 일정이 남은 채 말없이 굳거나(경고-2), 확정 여부를 모른 채
 * 비우는(경고-3) 길이 비어 있었다. 오케 결정: 셋 다 `itinerary-manual-fresh-error` 로 알리고, 옛 일정을
 * 저장·확정하는 길을 막는다.
 *
 * 3동작 뼈대: 준비=실패 응답 스위치 → 실행=startFresh 렌더(+ CTA·장소 추가 press) → 단언=안내·요청 계수·옛 카드.
 */
const FRESH_ERROR = 'itinerary-manual-fresh-error';
const ADD_PLACE = 'itinerary-edit-add-place';

describe('🔴 R1 · 03b 경고-1 — 비운 뒤 새 조회가 실패하면 옛 일정을 되살리지 않고 알린다 (INV-4)', () => {
  it('POST 201 · 재조회 500 → 비우기 실패 안내 · 옛 카드 0 · CTA 비활성 · 눌러도 PUT·확정 0', async () => {
    getAfterPostFails = true;
    renderPage({ startFresh: true });

    await waitFor(() => expect(postCalls).toBe(1), WAIT);
    // 재조회가 실제로 나가 실패했다(POST 전 1 + 뒤 1).
    await waitFor(() => expect(itineraryGets).toBeGreaterThanOrEqual(2), WAIT);

    expect(await screen.findByTestId(FRESH_ERROR, {}, WAIT)).toHaveTextContent(
      /\S/
    );
    // 캐시엔 옛 일정 data 가 남아 있다(조회 오류여도 data 는 유지) — 그걸 그리면 되살아난다.
    expect(screen.queryByTestId(OLD_CARD)).toBeNull();
    expect(screen.getByTestId(CTA)).toBeDisabled();
    fireEvent.press(screen.getByTestId(CTA));
    await flush();
    expect(putCalls).toBe(0);
    expect(confirmCalls).toBe(0);
  });
});

describe('🔴 R2 · 03b 경고-2 — 비우기 POST 가 실패하면(여행 중 409 등) 알리고, 옛 일정을 저장하는 길을 막는다', () => {
  it('POST 409 → 비우기 실패 안내 · CTA 비활성·눌러도 PUT 0 · 「장소 추가」를 눌러도 이동 0', async () => {
    postFailure = () =>
      HttpResponse.json(
        {
          code: 'ITINERARY_IN_TRIP',
          message: '여행 중에는 일정을 다시 만들 수 없어요',
        },
        { status: 409 }
      );
    renderPage({ startFresh: true });

    await waitFor(() => expect(postCalls).toBe(1), WAIT);
    expect(await screen.findByTestId(FRESH_ERROR, {}, WAIT)).toHaveTextContent(
      /\S/
    );

    expect(screen.getByTestId(CTA)).toBeDisabled();
    fireEvent.press(screen.getByTestId(CTA));
    // 장소 추가(h13)는 캐시의 옛 일정으로 PUT 을 만든다 — 가면 옛 장소 전부 + 새 장소가 저장된다(03b 경고-2).
    // 버튼을 숨기든 비활성으로 두든 "눌러도 안 간다"로 잰다(있으면 누른다 · 02a ★15 와 같은 방식).
    screen.queryAllByTestId(ADD_PLACE).forEach((node) => fireEvent.press(node));
    await flush();
    expect(putCalls).toBe(0);
    expect(mockPush).not.toHaveBeenCalled();
  });
});

describe('🔴 R3 · 03b 경고-3 — 첫 조회가 404 도 성공도 아니면 확정 여부를 모르므로 비우지 않고 알린다', () => {
  it.each([
    ['500', 'status500' as const],
    ['네트워크 끊김', 'network' as const],
  ])(
    '첫 GET %s → 흘려 보낸 뒤에도 POST 0 · 비우기 실패 안내',
    async (_label, failure) => {
      firstGetFailure = failure;
      renderPage({ startFresh: true });

      await waitFor(
        () => expect(itineraryGets).toBeGreaterThanOrEqual(1),
        WAIT
      );
      expect(
        await screen.findByTestId(FRESH_ERROR, {}, WAIT)
      ).toBeOnTheScreen();
      // 서버는 확정 일정 재생성을 막지 않는다 — 모른 채 쏘면 되돌릴 수 없다(DraftPage handleRetry 의 404 규칙과 같게).
      await flush();
      await flush();
      expect(postCalls).toBe(0);
    }
  );
});
