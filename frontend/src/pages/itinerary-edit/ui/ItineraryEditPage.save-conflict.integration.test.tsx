import type { ReactNode } from 'react';
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
import { buildSlotKey } from '@/entities/itinerary-slot/lib/slotKey';
import type {
  Itinerary,
  ItineraryDaysItemSlotsItem,
} from '@/shared/api/generated/schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';
import { WithToastHost, resetToast } from '@/test-support/toastHarness';

import { ItineraryEditPage } from './ItineraryEditPage';

/**
 * TRIP-1095 결정 4 · h12·i07 일정 편집 — 저장(PUT) 응답에 위반이 있으면 떠나기 전에 요약 게이트를 띄운다.
 *
 * 무엇을 보장하나:
 *  - 위반 있는 PUT 성공 → 게이트 「N곳에서 시간이 안 맞아요」(N = 응답 전 일자 합) · [고치기] · [그대로 저장].
 *    이 시점엔 이동 0 · 확정 POST 0 · **저장 토스트도 없다**(01b Q1 ⓔ — 게이트가 토스트보다 앞선다).
 *  - [그대로 저장] → TRIP-1089 의 토스트(시간 미정 N곳 꼬리 포함) + 복귀 1회(canGoBack 이면 back, 아니면
 *    h12 일정 탭 · i07 라이브 허브로 replace). PUT 추가 0 · 확정 0(TRIP-1038 B6).
 *  - 게이트가 떠 있는 동안 저장 CTA 는 PUT 을 더 내지 않고, [그대로 저장] 연타는 복귀 1회다.
 *  - 위반이 없거나 PUT 이 실패하면 게이트는 없다(무회귀 짝).
 *  - [고치기](머묾 분기)는 1089 스위트 `save-exit` S2·S7b 가 게이트 경유로 잰다.
 *
 * 커버하지 않는 것: 딤이 실제로 CTA·일차 칩을 덮는지(6-b). 다이얼로그 모양은 `SaveConflictDialog.test`.
 *
 * 3동작 뼈대: 준비=가짜 서버(PUT 응답 poi-b 위반) + 라우터 목 canGoBack → 실행=저장·게이트 버튼 press
 * → 단언=게이트·토스트 testID·라우터·요청 수.
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
// ★ 목 팩토리는 호이스팅되므로 mock 접두 변수로만 바깥 값을 읽는다(02a ★9).
let mockCanGoBack = true;
jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: mockPush,
    back: mockBack,
    replace: mockReplace,
    canGoBack: () => mockCanGoBack,
  }),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/shared/map', () => require('@/test-support/mapViewMock'));

const BASE = 'http://localhost:8080/api/v1';
const TRIP_ID = '11111111-1111-1111-1111-111111111111';
const DAY1 = '2026-06-10';
const DAY2 = '2026-06-11';
const SAVE = 'sheet-cta-button-0';
const GATE = 'itinerary-edit-save-conflict';
const ASIS = 'itinerary-edit-save-asis';
const BACK = 'itinerary-edit-save-back';
const SAVED = 'itinerary-edit-saved';
const SAVE_ERROR = 'itinerary-edit-save-error';
const NOTICE = 'itinerary-edit-unspecified-notice';
/** 사유 원문에 소요시간을 일부러 담는다 — 없으면 INV-3 부정 단언이 공허하다(02a ★11). */
const REASON = '이동 25분 필요 · 영업시간 밖: 543~618';
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
function violatedResponse(reason = '앞 장소에서 이동할 시간이 빠듯해요') {
  return itinerary([
    slot('poi-a', '09:30:00', '11:00:00'),
    slot('poi-b', '13:00:00', '14:00:00', {
      hasViolation: true,
      violationReason: reason,
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
  putHandler = () => HttpResponse.json(violatedResponse());

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

// ★ 토스트 스토어는 모듈 싱글턴 — 파일 최상위에서 지워야 앞 케이스 토스트가 다음 케이스로 새지 않는다(02a ★8).
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

/** 요청이 더 나갔다면 여기서 잡히도록 잠깐 흘려 보낸다(부정 단언을 waitFor 로 쓰지 않는다 — 02a ★5). */
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

async function saveUntilGate(inTrip?: boolean) {
  await openAndSave(inTrip);
  return screen.findByTestId(GATE);
}

describe('🔴 E1·E2·E3 · AC-2·6·8 — 위반 있는 저장은 떠나기 전에 요약을 띄운다 (결정 4)', () => {
  it('E1 · h12 · PUT 응답 poi-b 위반 → 게이트 「1곳에서…」 · [그대로 저장] · [고치기] · 이동 0 · 확정 0', async () => {
    const gateEl = await saveUntilGate();

    expect(
      within(gateEl).getByText('1곳에서 시간이 안 맞아요')
    ).toBeOnTheScreen();
    expect(screen.getByTestId(ASIS)).toHaveTextContent('그대로 저장');
    expect(screen.getByTestId(BACK)).toHaveTextContent('고치기');
    await settle();
    expect(mockBack).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
    expect(confirmCalls).toBe(0);
  });

  it('E2 · i07(inTrip) 도 같은 게이트가 뜨고 이동 0', async () => {
    expect(await saveUntilGate(true)).toBeOnTheScreen();

    await settle();
    expect(mockBack).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('E3 · N 은 응답 전 일자의 합이다 — 1일차 1곳 + 2일차 1곳이면 「2곳에서 시간이 안 맞아요」', async () => {
    const twoDays = (violated: boolean): Itinerary => ({
      ...itinerary(),
      days: [
        {
          date: DAY1,
          slots: [
            slot('poi-a', '09:30:00', '11:00:00'),
            slot('poi-b', '13:00:00', '14:00:00', {
              hasViolation: violated,
              violationReason: violated ? '시간이 겹쳐요' : null,
            }),
          ],
        },
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

    const gateEl = await saveUntilGate();

    expect(
      within(gateEl).getByText('2곳에서 시간이 안 맞아요')
    ).toBeOnTheScreen();
  });
});

describe('🔴 E4 · AC-3 — 게이트는 PUT 이 끝난 뒤에 선다 (BR-U3-12 비차단)', () => {
  it('PUT 응답 전엔 게이트가 없고, 응답이 오면 뜬다 · PUT 1회', async () => {
    let release: () => void = () => undefined;
    const door = new Promise<void>((resolve) => {
      release = resolve;
    });
    putHandler = async () => {
      await door;
      return HttpResponse.json(violatedResponse());
    };

    await openAndSave();
    await settle();
    expect(screen.queryByTestId(GATE)).toBeNull();

    release();

    expect(await screen.findByTestId(GATE)).toBeOnTheScreen();
    expect(putCalls).toBe(1);
  });
});

describe('🔴 E5 · AC-7 — 요약에 사유 원문·소요시간이 없다 (INV-3 · violationLabel D5)', () => {
  it('사유에 「이동 25분」이 있어도 게이트 텍스트엔 원문·N분·N시간·소요가 없다', async () => {
    putHandler = () => HttpResponse.json(violatedResponse(REASON));

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

describe('E6·E7 · AC-4·5 — 위반이 없거나 저장이 실패하면 게이트는 없다 (무회귀 · 선제 green)', () => {
  it('E6 · 위반 없는 PUT → back 1 · 복귀 뒤에도 게이트 없음', async () => {
    putHandler = () => HttpResponse.json(itinerary());

    await openAndSave();

    await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
    await settle();
    expect(screen.queryByTestId(GATE)).toBeNull();
  });

  it('E7 · PUT 500 → 저장 실패 배너 · 게이트 없음 · 토스트 없음', async () => {
    putHandler = () => new HttpResponse(null, { status: 500 });

    await openAndSave();

    expect(await screen.findByTestId(SAVE_ERROR)).toBeOnTheScreen();
    await settle();
    expect(screen.queryByTestId(GATE)).toBeNull();
    expect(screen.queryByTestId(SAVED)).toBeNull();
  });
});

describe('🔴 E8~E12 · AC-12·13·18 — [그대로 저장]은 1089 의 토스트 + 복귀로 이어진다', () => {
  it('E8 · 게이트 시점엔 저장 토스트가 없고, asis → 토스트 「일정을 저장했어요」 · back 1 · PUT 1 · 확정 0', async () => {
    await saveUntilGate();
    await settle();
    // ★ 01b Q1 ⓔ — 게이트가 토스트보다 앞선다. PUT 성공 즉시 토스트를 띄우면 여기서 red(02a ★12).
    expect(screen.queryByTestId(SAVED)).toBeNull();

    fireEvent.press(screen.getByTestId(ASIS));

    expect(await screen.findByTestId(SAVED)).toHaveTextContent(
      '일정을 저장했어요'
    );
    await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId(GATE)).toBeNull();
    await settle();
    expect(mockReplace).not.toHaveBeenCalled();
    expect(putCalls).toBe(1);
    expect(confirmCalls).toBe(0);
  });

  it('E9 · h12 · canGoBack false → asis 뒤 일정 탭으로 replace 1회 · back 0', async () => {
    mockCanGoBack = false;
    await saveUntilGate();

    fireEvent.press(screen.getByTestId(ASIS));

    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith({
        pathname: '/trips/[tripId]/itinerary',
        params: { tripId: TRIP_ID },
      })
    );
    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(mockBack).not.toHaveBeenCalled();
  });

  it('E10 · i07(inTrip) · canGoBack false → asis 뒤 라이브 허브로 replace 1회 · back 0', async () => {
    mockCanGoBack = false;
    await saveUntilGate(true);

    fireEvent.press(screen.getByTestId(ASIS));

    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith({
        pathname: '/trips/[tripId]/live',
        params: { tripId: TRIP_ID },
      })
    );
    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(mockBack).not.toHaveBeenCalled();
  });

  it('E11 · 시간 미정 1곳이 빠진 채 위반이면, asis 토스트에 꼬리가 붙는다(완전일치) · 미정 배너 없음', async () => {
    getHandler = () =>
      HttpResponse.json(
        itinerary([
          slot('poi-a', '09:30:00', '11:00:00'),
          slot('poi-u', null, '12:00:00'),
        ])
      );

    await saveUntilGate();
    fireEvent.press(screen.getByTestId(ASIS));

    expect(await screen.findByTestId(SAVED)).toHaveTextContent(
      '일정을 저장했어요 · 시간 미정 1곳은 빠졌어요'
    );
    expect(screen.queryByTestId(NOTICE)).toBeNull();
  });

  it('E12 · 같은 틱에 asis 를 두 번 눌러도 back 1 · PUT 1', async () => {
    await saveUntilGate();
    const asis = screen.getByTestId(ASIS);

    // ★ 바깥 act 하나로 묶어야 두 누름이 게이트가 닫히기 전 같은 버튼에 닿는다(02a ★4).
    await act(async () => {
      fireEvent.press(asis);
      fireEvent.press(asis);
    });
    await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
    await settle();

    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(putCalls).toBe(1);
  });

  // 03b(1095) 참고-1 — 03 이 신고한 "[그대로 저장] 뒤 잠금 유지"를 잰다. 목 back 은 화면을 내리지 않으므로
  // 떠나는 중(전환 애니메이션) 저장 누름을 흉내낸다.
  it('E12b · asis 로 떠난 뒤 저장을 다시 눌러도 PUT 1 · back 1 (떠나는 경로는 잠금 유지)', async () => {
    await saveUntilGate();
    fireEvent.press(screen.getByTestId(ASIS));
    await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));

    fireEvent.press(screen.getByTestId(SAVE));
    await settle();

    expect(putCalls).toBe(1);
    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});

describe('🔴 E13 · AC-16 — 게이트가 떠 있는 동안 저장 CTA 는 PUT 을 더 내지 않는다', () => {
  it('게이트 뒤 저장을 두 번 더 눌러도 PUT 1 · 이동 0', async () => {
    await saveUntilGate();

    // ★ jest 의 press 는 딤 뒤 CTA 에도 닿는다 — 막는 것은 코드 가드여야 한다(02a ★3).
    fireEvent.press(screen.getByTestId(SAVE));
    fireEvent.press(screen.getByTestId(SAVE));
    await settle();

    expect(putCalls).toBe(1);
    expect(mockBack).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
