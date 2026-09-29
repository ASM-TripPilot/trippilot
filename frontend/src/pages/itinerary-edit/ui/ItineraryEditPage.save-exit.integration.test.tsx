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
import type {
  Itinerary,
  ItineraryDaysItemSlotsItem,
} from '@/shared/api/generated/schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';
import { WithToastHost, resetToast } from '@/test-support/toastHarness';

import { ItineraryEditPage } from './ItineraryEditPage';

/**
 * TRIP-1089 · h12·i07 일정 편집 — 저장 성공 뒤 무반응 해소.
 *
 * 무엇을 보장하나:
 *  - 위반 없는 저장 성공 → 토스트 `itinerary-edit-saved` + 이전 화면(canGoBack 이면 back, 아니면
 *    h12 는 일정 탭 · i07 은 라이브 허브로 replace).
 *  - 응답에 위반(hasViolation)이 있으면 먼저 요약 게이트(TRIP-1095)가 뜨고, [고치기]를 고르면 제자리 —
 *    토스트가 뜨고 배지가 보이며 다시 저장할 수 있다(BR-U3-13 지속 가시화). 게이트 자체·[그대로 저장]은
 *    `save-conflict` 스위트 몫.
 *  - 시간 미정이 빠지면 그 수를 토스트 문구에 싣는다(복귀하면 배너가 안 보이므로).
 *  - 연타해도 PUT·이동은 1회, 실패하면 제자리 + 배너 + 다시 누를 수 있다. 확정 POST 는 어느 경로든 0.
 *
 * 3동작 뼈대: 준비=가짜 서버 응답 + 라우터 목의 canGoBack 값 → 실행=저장 누름 → 단언=토스트·라우터·요청 수.
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
const mockReplace = jest.fn();
const mockPush = jest.fn();
// ★ canGoBack 은 케이스마다 바꾼다 — 목 팩토리는 호이스팅되므로 mock 접두 변수로만 바깥 값을 읽는다.
let mockCanGoBack = true;
jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: mockPush,
    back: mockBack,
    replace: mockReplace,
    canGoBack: () => mockCanGoBack,
  }),
}));

jest.mock('@/shared/map', () => require('@/test-support/mapViewMock'));

const BASE = 'http://localhost:8080/api/v1';
const TRIP_ID = '11111111-1111-1111-1111-111111111111';
const DAY1 = '2026-06-10';
const SAVE = 'sheet-cta-button-0';
const SAVED = 'itinerary-edit-saved';
const SAVE_ERROR = 'itinerary-edit-save-error';
const NOTICE = 'itinerary-edit-unspecified-notice';
const CONFLICT = 'itinerary-edit-save-conflict';
const FIX = 'itinerary-edit-save-back';
const cardId = (poiId: string) => `slot-stopcard-${buildSlotKey(DAY1, poiId)}`;

function slot(
  poiId: string,
  startAt: string | null,
  endAt: string,
  extra: Partial<ItineraryDaysItemSlotsItem> = {}
): ItineraryDaysItemSlotsItem {
  return {
    poiId,
    // 미지정(null) 은 서버 타입상 없지만 런타임엔 흐른다 — 편집 스토어 픽스처 선례(unspecified 스위트).
    startAt: startAt as string,
    endAt,
    isFixed: false,
    endsNextDay: false,
    hasViolation: false,
    alternatives: [],
    tags: [],
    nameKo: poiId,
    ...extra,
  };
}

function itinerary(
  slots: ItineraryDaysItemSlotsItem[] = [
    slot('poi-a', '09:30:00', '11:00:00'),
    slot('poi-b', '13:00:00', '14:00:00'),
  ]
): Itinerary {
  return {
    itineraryId: 'itin-1',
    tripId: TRIP_ID,
    status: 'PLANNED',
    solveMode: 'FULL_AI',
    generationMode: 'FULLY_AI',
    generationState: 'COMPLETE',
    isFallback: false,
    days: [{ date: DAY1, slots }],
  };
}

/** 서버 재검증이 poi-b 를 위반으로 판정한 응답(PUT 200 — 비차단). */
function violatedResponse(): Itinerary {
  return itinerary([
    slot('poi-a', '09:30:00', '11:00:00'),
    slot('poi-b', '13:00:00', '14:00:00', {
      hasViolation: true,
      violationReason: '앞 장소에서 이동할 시간이 빠듯해요',
    }),
  ]);
}

let putCalls = 0;
let confirmCalls = 0;
let getHandler: () => Response;
let putHandler: () => Response | Promise<Response>;

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

beforeEach(() => {
  putCalls = 0;
  confirmCalls = 0;
  mockCanGoBack = true;
  [mockBack, mockReplace, mockPush].forEach((fn) => fn.mockClear());
  setAccessToken('valid-access');
  useItineraryEditStore.getState().reset();
  getHandler = () => HttpResponse.json(itinerary());
  putHandler = () => HttpResponse.json(itinerary());

  server.use(
    http.get(`${BASE}/trips/:tripId/itinerary`, () => getHandler()),
    http.get(`${BASE}/trips/:tripId/visits/days/:day`, () =>
      HttpResponse.json({ visits: [] })
    ),
    http.put(`${BASE}/trips/:tripId/itinerary`, () => {
      putCalls += 1;
      return putHandler();
    }),
    http.post(`${BASE}/trips/:tripId/itinerary/confirm`, () => {
      confirmCalls += 1;
      return HttpResponse.json({ ...itinerary(), status: 'CONFIRMED' });
    })
  );
});

// ★ 토스트 스토어는 모듈 싱글턴 — 파일 최상위에서 지워야 앞 케이스 토스트가 다음 케이스로 새지 않는다.
afterEach(() => {
  resetToast();
  server.resetHandlers();
  clearAccessToken();
});

afterAll(() => server.close());

function renderPage(inTrip?: boolean) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <WithToastHost>{children}</WithToastHost>
      </QueryClientProvider>
    );
  }
  return render(<ItineraryEditPage tripId={TRIP_ID} inTrip={inTrip} />, {
    wrapper: Wrapper,
  });
}

/** 요청이 더 나갔다면 여기서 잡히도록 잠깐 흘려 보낸다(부정 단언을 waitFor 로 쓰지 않는다). */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 100));
  });
}

async function openAndSave(inTrip?: boolean) {
  renderPage(inTrip);
  await screen.findByTestId(cardId('poi-a'));
  fireEvent.press(screen.getByTestId(SAVE));
  await waitFor(() => expect(putCalls).toBe(1));
}

/** TRIP-1095 — 위반 응답이면 요약 게이트가 먼저 선다. 머묾 분기는 그 게이트의 [고치기]다. */
async function saveThenFix(inTrip?: boolean) {
  await openAndSave(inTrip);
  fireEvent.press(await screen.findByTestId(FIX));
  expect(screen.queryByTestId(CONFLICT)).toBeNull();
}

describe('🔴 S1 · AC-1 — 위반 없는 저장 성공: 토스트 + back', () => {
  it('h12 · canGoBack true → 토스트 「일정을 저장했어요」(완전일치) · back 1 · replace 0', async () => {
    await openAndSave();

    expect(await screen.findByTestId(SAVED)).toHaveTextContent(
      '일정을 저장했어요'
    );
    await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('누르기 전·요청 전엔 토스트도 이동도 없다(짝)', async () => {
    renderPage();
    await screen.findByTestId(cardId('poi-a'));

    expect(screen.queryByTestId(SAVED)).toBeNull();
    expect(mockBack).not.toHaveBeenCalled();
  });
});

describe('🔴 S2 · AC-2 결정 1 · TRIP-1095 — 위반 응답은 게이트를 거쳐 [고치기]면 제자리 + 배지 + 토스트', () => {
  it('PUT 응답 poi-b hasViolation → [고치기] → 토스트 「일정을 저장했어요」 · poi-b 위반 배지 · back·replace 0', async () => {
    putHandler = () => HttpResponse.json(violatedResponse());

    await saveThenFix();

    expect(await screen.findByTestId(SAVED)).toHaveTextContent(
      '일정을 저장했어요'
    );
    // 캐시에 쓴 응답으로 재-시드돼 배지가 그려진다(BR-U3-13 저장 후 지속 가시화).
    expect(
      await screen.findByTestId(
        `slot-stopcard-violation-${buildSlotKey(DAY1, 'poi-b')}`
      )
    ).toBeOnTheScreen();
    await settle();
    expect(mockBack).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  // 03b 경고-1 — 머묾을 고른 이유(라이브 허브는 위반을 안 그린다)가 바로 i07 얼굴이라 그 얼굴로도 잰다.
  it('i07(inTrip) 도 [고치기]면 머문다 — back·replace 0 · 배지 보임', async () => {
    putHandler = () => HttpResponse.json(violatedResponse());

    await saveThenFix(true);

    await screen.findByTestId(SAVED);
    expect(
      await screen.findByTestId(
        `slot-stopcard-violation-${buildSlotKey(DAY1, 'poi-b')}`
      )
    ).toBeOnTheScreen();
    await settle();
    expect(mockBack).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  // 03b 경고-2 — 판정은 응답 전 일자다. 활성 일자(1일차)만 보면 2일차 위반을 두고 떠난다.
  it('활성 일자가 아닌 날(2일차)에만 위반이 있어도 게이트가 서고, [고치기] 뒤 2일차 칩을 누르면 배지가 보인다', async () => {
    const DAY2 = '2026-06-11';
    const twoDays = (violated: boolean): Itinerary => ({
      ...itinerary(),
      days: [
        { date: DAY1, slots: [slot('poi-a', '09:30:00', '11:00:00')] },
        {
          date: DAY2,
          slots: [
            slot('poi-c', '10:00:00', '11:00:00', {
              hasViolation: violated,
              violationReason: violated ? '시간이 겹쳐요' : null,
            }),
          ],
        },
      ],
    });
    getHandler = () => HttpResponse.json(twoDays(false));
    putHandler = () => HttpResponse.json(twoDays(true));

    await saveThenFix();

    await screen.findByTestId(SAVED);
    await settle();
    expect(mockBack).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();

    fireEvent.press(screen.getByTestId('itinerary-edit-day-2'));
    expect(
      await screen.findByTestId(
        `slot-stopcard-violation-${buildSlotKey(DAY2, 'poi-c')}`
      )
    ).toBeOnTheScreen();
  });

  it('[고치기] 뒤엔 잠금이 풀려 다시 저장할 수 있다(PUT 2)', async () => {
    putHandler = () => HttpResponse.json(violatedResponse());

    await saveThenFix();
    await screen.findByTestId(SAVED);

    fireEvent.press(screen.getByTestId(SAVE));
    await waitFor(() => expect(putCalls).toBe(2));
  });
});

describe('🔴 S3 · AC-3·4·5 결정 3 — 히스토리 없으면 얼굴별 목적지로 replace', () => {
  it('h12 · canGoBack false → replace 일정 탭 1회 · back 0', async () => {
    mockCanGoBack = false;

    await openAndSave();

    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith({
        pathname: '/trips/[tripId]/itinerary',
        params: { tripId: TRIP_ID },
      })
    );
    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(mockBack).not.toHaveBeenCalled();
  });

  it('i07(inTrip) · canGoBack false → replace 라이브 허브 1회 · back 0', async () => {
    mockCanGoBack = false;

    await openAndSave(true);

    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith({
        pathname: '/trips/[tripId]/live',
        params: { tripId: TRIP_ID },
      })
    );
    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(mockBack).not.toHaveBeenCalled();
  });

  it('i07(inTrip) · canGoBack true(i06 경유 포함) → back 1 · 허브 replace 0', async () => {
    await openAndSave(true);

    await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
    expect(mockReplace).not.toHaveBeenCalled();
  });
});

describe('🔴 S4 · AC-6 결정 2 — 빠진 시간 미정 수를 토스트에 싣는다', () => {
  it('미정 2곳이 빠지면 토스트가 「일정을 저장했어요 · 시간 미정 2곳은 빠졌어요」(완전일치), 배너는 없다', async () => {
    getHandler = () =>
      HttpResponse.json(
        itinerary([
          slot('poi-a', '09:30:00', '11:00:00'),
          slot('poi-u', null, '12:00:00'),
          slot('poi-v', null, '15:00:00'),
        ])
      );

    await openAndSave();

    expect(await screen.findByTestId(SAVED)).toHaveTextContent(
      '일정을 저장했어요 · 시간 미정 2곳은 빠졌어요'
    );
    // 성공이면 안내는 토스트로 옮겨 가고 페이지 배너는 서지 않는다(복귀하면 안 보이므로).
    expect(screen.queryByTestId(NOTICE)).toBeNull();
  });
});

describe('🔴 S5 · AC-7 — 연타해도 PUT 1 · 이동 1', () => {
  it('같은 프레임에 저장을 두 번 눌러도 PUT 1회 · back 1회', async () => {
    renderPage();
    await screen.findByTestId(cardId('poi-a'));

    // ★ 바깥 act 하나로 묶어야 두 누름이 리렌더 전 같은 화면을 본다(따로 누르면 연타 재현이 안 된다).
    await act(async () => {
      fireEvent.press(screen.getByTestId(SAVE));
      fireEvent.press(screen.getByTestId(SAVE));
    });
    await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
    await settle();

    expect(putCalls).toBe(1);
    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('요청이 날아가는 중(응답 전)에 다시 눌러도 PUT 은 1회다', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    putHandler = async () => {
      await gate;
      return HttpResponse.json(itinerary());
    };

    renderPage();
    await screen.findByTestId(cardId('poi-a'));
    fireEvent.press(screen.getByTestId(SAVE));
    await waitFor(() => expect(putCalls).toBe(1));
    fireEvent.press(screen.getByTestId(SAVE));
    await settle();
    release();

    await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
    await settle();
    expect(putCalls).toBe(1);
    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});

describe('🔴 S6 · AC-8 — 실패는 제자리 + 배너 + 다시 누를 수 있다', () => {
  it('PUT 500 → save-error 배너 · 토스트 없음 · 이동 0 · 다시 누르면 PUT 2', async () => {
    putHandler = () => new HttpResponse(null, { status: 500 });

    await openAndSave();

    expect(await screen.findByTestId(SAVE_ERROR)).toBeOnTheScreen();
    expect(screen.queryByTestId(SAVED)).toBeNull();
    expect(mockBack).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();

    fireEvent.press(screen.getByTestId(SAVE));
    await waitFor(() => expect(putCalls).toBe(2));
  });

  it('PUT 409(재조회 CONFIRMED) → 확정 문구 배너 · 이동 0 · 다시 누르면 PUT 2', async () => {
    putHandler = () => new HttpResponse(null, { status: 409 });
    getHandler = () =>
      HttpResponse.json({ ...itinerary(), status: 'CONFIRMED' });

    await openAndSave();

    expect(await screen.findByTestId(SAVE_ERROR)).toHaveTextContent(
      '확정된 일정은 수정할 수 없어요'
    );
    expect(mockBack).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();

    fireEvent.press(screen.getByTestId(SAVE));
    await waitFor(() => expect(putCalls).toBe(2));
  });

  it('미정이 빠진 채 실패하면 미정 배너는 그대로 선다(실패 경로 무변경)', async () => {
    getHandler = () =>
      HttpResponse.json(
        itinerary([
          slot('poi-a', '09:30:00', '11:00:00'),
          slot('poi-u', null, '12:00:00'),
        ])
      );
    putHandler = () => new HttpResponse(null, { status: 500 });

    await openAndSave();

    expect(await screen.findByTestId(NOTICE)).toHaveTextContent(
      '시간대를 정하지 않은 1곳은 저장에서 빠졌어요'
    );
    expect(screen.getByTestId(SAVE_ERROR)).toBeOnTheScreen();
  });
});

describe('🔴 S7 · AC-9 — 어느 성공 경로든 확정 POST 는 0', () => {
  it('복귀 경로·머묾 경로 모두 confirm 0', async () => {
    await openAndSave();
    await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
    await settle();
    expect(confirmCalls).toBe(0);
  });

  it('위반 머묾 경로([고치기])도 confirm 0', async () => {
    putHandler = () => HttpResponse.json(violatedResponse());
    await saveThenFix();
    await screen.findByTestId(SAVED);
    await settle();
    expect(confirmCalls).toBe(0);
  });
});
