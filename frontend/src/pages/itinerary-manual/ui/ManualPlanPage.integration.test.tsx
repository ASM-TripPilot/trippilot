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
import type { ReactNode } from 'react';

import { server } from '@/mocks/server';
import { resetToast, WithToastHost } from '@/test-support/toastHarness';
import { useItineraryEditStore } from '@/features/itinerary/model/itineraryEditStore';
import { useTripWizardStore } from '@/features/trip/model/tripWizardStore';
import { buildSlotKey } from '@/entities/itinerary-slot/lib/slotKey';
import { getGetTripsTripIdItineraryQueryKey } from '@/shared/api/generated/trips/trips';
import type {
  Itinerary,
  ItineraryDaysItemSlotsItem,
  EditItineraryRequest,
  Trip,
  BaseAssignment,
  SavedStay,
} from '@/shared/api/generated/schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';
import {
  EDIT_LIST,
  fireEditDragEnd,
  fireEditDropOnZone,
} from '@/test-support/editDragList';

import { ManualPlanPage } from './ManualPlanPage';

/**
 * h12/h13 직접 짜기(ManualPlanPage) — **실 훅 + MSW** 통합 테스트(TRIP-1151 에서 다섯 파일을 한 파일로
 * 합쳤다). 생성 훅을 통째로 목으로 바꾼 배선 테스트는 `ManualPlanPage.hookMock.test.tsx`(node)에 있다.
 *
 * 옛 파일 하나 = 바깥 describe 하나다. 안쪽 describe·it 이름과 각 파일의 픽스처·기본 MSW 핸들러
 * (describe 의 beforeEach)는 그대로다.
 *
 * 합치며 바뀐 장치(02a ★): 서버 listen/close 는 최상위 한 번. 라우터 목은 `push`·`back`·`replace` 를
 * 모두 기록한다(옛 `.emptyStart` 는 렌더마다 새 jest.fn 이었다 — 메서드는 다 있었으니 그물이 줄지 않는다).
 * 알림 권한 목(`@/shared/push`)은 옛 `.emptyStart`·`.fresh` 에만 있었는데 이제 파일 전체에 걸린다 —
 * 이 페이지 모듈 그래프엔 push 가 없다(도달 0). 토스트 스토어는 모듈 싱글턴이라 최상위 afterEach 에서 비운다.
 *
 * 3동작 뼈대: 준비 = MSW 핸들러·토큰 → 실행 = 편집기 렌더·저장/확정/장소 추가 press → 단언 = 나간 요청·화면·이동.
 */

// 생성 클라이언트의 인증 계층이 `@/shared/storage`(expo-secure-store)를 정적으로 문다(선례 동형).
jest.mock('@/shared/storage', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest.fn().mockResolvedValue({
    accessToken: 'old-access',
    refreshToken: 'old-refresh',
  }),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  hasStoredToken: jest.fn().mockResolvedValue(true),
}));

// POST 성공 콜백 쪽 알림 권한 루틴을 실물로 태우지 않는다(옛 `.emptyStart`·`.fresh` 목 — 도달 0).
jest.mock('@/shared/push', () => ({
  promptAndRegisterPush: jest.fn(() => Promise.resolve()),
  registerPushIfGranted: jest.fn(() => Promise.resolve()),
  requestPushPermission: jest.fn(() => Promise.resolve('UNDETERMINED')),
}));

// jest.mock 팩토리는 파일 맨 위로 끌어올려져 바깥 변수를 못 본다 — `mock` 접두 변수만 예외.
const mockPush = jest.fn();
const mockBack = jest.fn();
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: mockBack, replace: mockReplace }),
  router: { push: mockPush, back: mockBack, replace: mockReplace },
}));

// 지도(네이버 네이티브)는 jest 에서 못 뜬다 — 관찰 목으로 map-root 를 노출한다.
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/shared/map', () => require('@/test-support/mapViewMock'));

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

beforeEach(() => {
  [mockPush, mockBack, mockReplace].forEach((fn) => fn.mockClear());
});

// 토스트 스토어는 모듈 싱글턴이다 — 토스트 호스트가 없는 describe 가 띄운 토스트가 뒤 describe 로 새지 않게
// describe 안이 아니라 파일 최상위에서 비운다(02a ★).
afterEach(() => {
  resetToast();
});

afterAll(() => server.close());

// TRIP-1038 B · TRIP-1047 · 옛 ManualPlanPage.confirm.integration.test.tsx
describe('저장하고 확정하기', () => {
  /**
   * TRIP-1038 B (#032 · US-SCHED-12 · 결정 1=(ii)) — 직접 짜기 편집기의 CTA 는 「저장하고 확정하기」다.
   * 누르면 저장(PUT) → 확정(POST /confirm) → 확정 화면(h16, /trips/[tripId]/itinerary)으로 바꿔 간다.
   *
   * 무엇을 보장하나:
   *  - 🔴 B1 라벨 · B2 순서(PUT 성공 뒤에만 확정)·확정 응답을 캐시에 써넣기·위저드 비우기·h16 replace.
   *  - B3 PUT 이 실패하면 확정을 부르지 않고 제자리에서 저장 실패를 알린다(INV-4).
   *  - 🔴 B4 확정이 실패하면 이동하지 않고 확정 실패를 알린다. 저장은 됐으니 저장 토스트는 뜬다(01 Q3).
   *    409 면 서버 상태가 바뀌었을 수 있어 일정을 한 번 다시 조회하고, 500 이면 다시 조회하지 않는다.
   *  - 🔴 B5 2왕복 동안 연타해도 PUT·확정은 1번씩이다.
   *  - 🔴 B8 확정 응답이 오기 전에 화면을 떠나도 확정 결과는 캐시에 남고, 떠난 사람을 h16 으로 끌고 가지 않는다
   *    (호출별 콜백은 언마운트 뒤 안 불린다 — traps-itinerary).
   *
   * 3동작 뼈대: 준비=가짜 서버(MANUAL 초안 a·b, PUT·확정 핸들러) → 실행=CTA press → 단언=요청 순서·라우터·캐시·안내.
   */

  const BASE = 'http://localhost:8080/api/v1';
  const TRIP_ID = '55555555-5555-5555-5555-555555555555';
  const DAY = '2026-06-10';

  /** 첫 조회·2왕복 사슬 대기 한도 — 로컬 1000ms 의 CI 러너(약 4배 느림) 환산. */
  const WAIT = { timeout: 4000 };

  const CTA = 'sheet-cta-button-0';
  const SAVE_ERROR = 'itinerary-manual-save-error';
  const CONFIRM_ERROR = 'itinerary-manual-confirm-error';
  const SAVED_TOAST = 'itinerary-manual-saved';
  /** TRIP-1047 — 확정 토스트(h16 `ItineraryPlanPage` 와 같은 testID·문구). */
  const CONFIRMED_TOAST = 'itinerary-confirmed-toast';
  const H16 = {
    pathname: '/trips/[tripId]/itinerary',
    params: { tripId: TRIP_ID },
  };

  function slot(poiId: string, startAt: string): ItineraryDaysItemSlotsItem {
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
    };
  }

  function manualDraft(status: Itinerary['status'] = 'PLANNED'): Itinerary {
    return {
      itineraryId: 'itin-m',
      tripId: TRIP_ID,
      status,
      solveMode: 'MINIMAL',
      generationMode: 'MANUAL',
      generationState: 'COMPLETE',
      isFallback: false,
      days: [
        { date: DAY, slots: [slot('a', '09:00:00'), slot('b', '11:00:00')] },
      ],
    };
  }

  /** 요청 도착 순서 — PUT 이 먼저 끝나야 확정이 나간다(B2). */
  let requestLog: string[] = [];
  let itineraryGets = 0;
  let putCalls = 0;
  let confirmCalls = 0;
  let putHandler: () => Response;
  let confirmHandler: () => Response | Promise<Response>;

  /** 확정 응답을 붙잡아 두는 문 — "서버엔 도착했고 응답은 아직" 인 순간을 만든다(02a ★5). */
  function gate(): { wait: Promise<void>; open: () => void } {
    let open = () => {};
    const wait = new Promise<void>((resolve) => {
      open = resolve;
    });
    return { wait, open };
  }

  beforeEach(() => {
    requestLog = [];
    itineraryGets = 0;
    putCalls = 0;
    confirmCalls = 0;
    [mockPush, mockBack, mockReplace].forEach((fn) => fn.mockClear());
    setAccessToken('valid-access');
    // 모듈 싱글턴 두 개 — 편집 스토어(시드)와 위저드 스토어(B2 가 비워졌는지 본다).
    useItineraryEditStore.getState().reset();
    useTripWizardStore.getState().reset();
    putHandler = () => HttpResponse.json(manualDraft());
    confirmHandler = () => HttpResponse.json(manualDraft('CONFIRMED'));

    server.use(
      http.get(`${BASE}/trips/:tripId/itinerary`, () => {
        itineraryGets += 1;
        return HttpResponse.json(manualDraft());
      }),
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

  // 토스트 스토어는 모듈 싱글턴이다 — describe 안이 아니라 파일 최상위에서 비운다(02a ★11).
  afterEach(() => {
    server.resetHandlers();
    clearAccessToken();
    resetToast();
    useTripWizardStore.getState().reset();
  });

  function renderPage() {
    const client = new QueryClient({
      defaultOptions: {
        // gcTime 을 0 으로 두면 B8 에서 언마운트(관찰자 0) 뒤 캐시 항목이 곧바로 치워져 "캐시에 남았다"를
        // 잴 수 없다. Infinity 는 치우기 타이머 자체를 안 건다(테스트마다 새 클라이언트라 새지 않는다).
        queries: { retry: false, gcTime: Infinity },
        mutations: { gcTime: 0 },
      },
    });
    const utils = render(
      <QueryClientProvider client={client}>
        <WithToastHost>
          <ManualPlanPage tripId={TRIP_ID} />
        </WithToastHost>
      </QueryClientProvider>
    );
    return { ...utils, client };
  }

  async function ready(): Promise<void> {
    await screen.findByTestId(
      `slot-stopcard-${buildSlotKey(DAY, 'a')}`,
      {},
      WAIT
    );
  }

  /** 요청은 비동기다 — 흘려 보낸 뒤에 세야 "더 안 나갔다"가 뜻을 갖는다(02a ★4). */
  async function flush(): Promise<void> {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
  }

  describe('🔴 B1 · #032 — 직접 짜기 편집기의 CTA 는 「저장하고 확정하기」다', () => {
    it('슬롯이 있으면 CTA 글자가 저장하고 확정하기(완전일치)이고 누를 수 있다', async () => {
      renderPage();
      await ready();

      expect(screen.getByTestId(CTA)).toHaveTextContent('저장하고 확정하기');
      expect(screen.getByTestId(CTA)).toBeEnabled();
    });
  });

  describe('🔴 B2 · 결정 1(ii) — 저장 성공 뒤에만 확정하고, 확정되면 확정 화면(h16)으로 바꿔 간다 (US-SCHED-12)', () => {
    it('PUT → 확정 순서 · replace h16 1회 · 캐시가 CONFIRMED · 위저드가 비워진다 · push/back 0', async () => {
      // 준비 — 위저드에 이 여행의 흔적을 남겨 둔다(원래 빈 값이면 "비웠다"가 공허 — 02a ★12).
      useTripWizardStore.setState({ budgetText: '50만원' });
      const { client } = renderPage();
      await ready();

      fireEvent.press(screen.getByTestId(CTA));

      await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1), WAIT);
      expect(mockReplace).toHaveBeenCalledWith(H16);
      expect(requestLog).toEqual(['PUT', 'CONFIRM']);
      expect(
        client.getQueryData<Itinerary>(
          getGetTripsTripIdItineraryQueryKey(TRIP_ID)
        )?.status
      ).toBe('CONFIRMED');
      expect(useTripWizardStore.getState().budgetText).toBe('');
      expect(mockPush).not.toHaveBeenCalled();
      expect(mockBack).not.toHaveBeenCalled();
    });
  });

  describe('B3 · INV-4 — 저장(PUT)이 실패하면 확정을 부르지 않고 제자리에서 알린다 (선제 green · 사슬 회귀 트립와이어)', () => {
    it('PUT 500 → 저장 실패 안내 · 확정 0 · 라우터 0 · 확정 실패 안내 없음', async () => {
      putHandler = () => new HttpResponse(null, { status: 500 });
      renderPage();
      await ready();

      fireEvent.press(screen.getByTestId(CTA));

      expect(await screen.findByTestId(SAVE_ERROR, {}, WAIT)).toBeOnTheScreen();
      await flush();
      expect(confirmCalls).toBe(0);
      expect(screen.queryByTestId(CONFIRM_ERROR)).toBeNull();
      expect(mockReplace).not.toHaveBeenCalled();
      expect(mockPush).not.toHaveBeenCalled();
      expect(mockBack).not.toHaveBeenCalled();
    });
  });

  describe('🔴 B4 · INV-4 — 확정이 실패하면 이동하지 않고 확정 실패를 알린다', () => {
    it('확정 500 → 확정 실패 안내(비공백) · 저장 토스트는 뜬다 · 라우터 0 · 재조회 0 · 저장 실패 안내 없음', async () => {
      confirmHandler = () => new HttpResponse(null, { status: 500 });
      renderPage();
      await ready();
      // 앵커 — 저장 전엔 토스트가 없다(뒤의 토스트가 이번 저장 몫임을 가른다).
      expect(screen.queryByTestId(SAVED_TOAST)).toBeNull();

      fireEvent.press(screen.getByTestId(CTA));

      expect(
        await screen.findByTestId(CONFIRM_ERROR, {}, WAIT)
      ).toHaveTextContent(/\S/);
      expect(screen.getByTestId(SAVED_TOAST)).toBeOnTheScreen();
      // TRIP-1047 AC-5 — 확정이 실패했으니 확정 토스트는 없다(INV-4).
      expect(screen.queryByTestId(CONFIRMED_TOAST)).toBeNull();
      expect(screen.queryByTestId(SAVE_ERROR)).toBeNull();
      await flush();
      expect(putCalls).toBe(1);
      expect(confirmCalls).toBe(1);
      // 500 은 상태가 안 바뀌었다 — 다시 조회하지 않는다(첫 조회 1건 그대로 · ItineraryPlanPage 선례).
      expect(itineraryGets).toBe(1);
      expect(mockReplace).not.toHaveBeenCalled();
      expect(mockPush).not.toHaveBeenCalled();
      expect(mockBack).not.toHaveBeenCalled();
    });

    it('확정 409 → 확정 실패 안내 · 라우터 0 · 일정을 한 번 다시 조회한다(서버 상태가 바뀌었을 수 있다)', async () => {
      confirmHandler = () =>
        HttpResponse.json(
          { code: 'CONFLICT', message: '이미 확정됨' },
          { status: 409 }
        );
      renderPage();
      await ready();
      expect(itineraryGets).toBe(1);

      fireEvent.press(screen.getByTestId(CTA));

      expect(
        await screen.findByTestId(CONFIRM_ERROR, {}, WAIT)
      ).toBeOnTheScreen();
      await waitFor(() => expect(itineraryGets).toBe(2), WAIT);
      expect(mockReplace).not.toHaveBeenCalled();
      expect(mockPush).not.toHaveBeenCalled();
      // TRIP-1047 AC-5 — 409 는 확정 실패다. 재조회 뒤에도 확정 토스트는 없다.
      expect(screen.queryByTestId(CONFIRMED_TOAST)).toBeNull();
    });
  });

  /**
   * TRIP-1047 AC-1 (편집기 경로 · 01b) — 편집기의 「저장하고 확정하기」도 "확정한 그 순간"이다. 확정 POST 가
   * 성공하면 h16 으로 떠나기 전에 같은 확정 토스트를 띄운다. 토스트는 루트 호스트가 그리므로 화면이 바뀌어도
   * 남는다. h16(`ItineraryPlanPage`)은 캐시에 이미 CONFIRMED 가 든 채 새로 열려 재진입과 구별이 안 되므로,
   * 여기서 안 띄우면 이 경로엔 확정 알림이 없다. 한 번에 하나라 앞서 뜬 저장 토스트는 확정 토스트로 바뀐다.
   *
   * 3동작 뼈대: 준비=PUT 200·확정 200 → 실행=CTA press → 단언=replace·확정 토스트 문구·저장 토스트 교체.
   */
  describe('🔴 T1 · TRIP-1047 AC-1 — 편집기에서 저장하고 확정하면 확정 토스트가 뜬다', () => {
    it('확정 성공 → h16 replace 1회 · "일정이 확정됐어요" 토스트 · 저장 토스트는 확정 토스트로 바뀐다', async () => {
      renderPage();
      await ready();
      // 앵커 — 확정 전엔 확정 토스트가 없다.
      expect(screen.queryByTestId(CONFIRMED_TOAST)).toBeNull();

      fireEvent.press(screen.getByTestId(CTA));

      await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1), WAIT);
      expect(mockReplace).toHaveBeenCalledWith(H16);
      expect(await screen.findByTestId(CONFIRMED_TOAST)).toHaveTextContent(
        '일정이 확정됐어요'
      );
      expect(screen.queryByTestId(SAVED_TOAST)).toBeNull();
      expect(confirmCalls).toBe(1);
    });
  });

  describe('🔴 B5 · 01 맹점 ⑥ — 저장+확정 2왕복 동안 연타해도 PUT·확정은 1번씩이다', () => {
    it('같은 틱에 두 번 누르면 PUT 1 · 확정 1 · replace 1', async () => {
      renderPage();
      await ready();

      // await 없이 연달아 — isPending 은 다음 렌더에야 true 라 이 창을 못 막는다(02a ★6).
      fireEvent.press(screen.getByTestId(CTA));
      fireEvent.press(screen.getByTestId(CTA));

      await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1), WAIT);
      await flush();
      expect(putCalls).toBe(1);
      expect(confirmCalls).toBe(1);
      expect(mockReplace).toHaveBeenCalledTimes(1);
    });

    it('저장이 끝나고 확정 응답을 기다리는 동안 다시 눌러도 PUT·확정이 더 나가지 않는다', async () => {
      const door = gate();
      confirmHandler = async () => {
        await door.wait;
        return HttpResponse.json(manualDraft('CONFIRMED'));
      };
      renderPage();
      await ready();

      fireEvent.press(screen.getByTestId(CTA));
      // 확정 요청이 서버에 도착했다 = PUT 은 끝났다. 이 틈이 "저장만 끝난" 창이다.
      await waitFor(() => expect(confirmCalls).toBe(1), WAIT);

      fireEvent.press(screen.getByTestId(CTA));
      fireEvent.press(screen.getByTestId(CTA));
      await flush();
      expect(putCalls).toBe(1);
      expect(confirmCalls).toBe(1);

      door.open();
      await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1), WAIT);
      await flush();
      expect(putCalls).toBe(1);
      expect(confirmCalls).toBe(1);
    });
  });

  describe('🔴 B8 · traps-itinerary — 확정 응답 전에 화면을 떠나도 확정 결과는 캐시에 남고, 떠난 사람을 끌고 가지 않는다', () => {
    it('확정 대기 중 언마운트 → 응답 도착 뒤 캐시 status CONFIRMED · replace 0', async () => {
      const door = gate();
      confirmHandler = async () => {
        await door.wait;
        return HttpResponse.json(manualDraft('CONFIRMED'));
      };
      const { client, unmount } = renderPage();
      await ready();

      fireEvent.press(screen.getByTestId(CTA));
      await waitFor(() => expect(confirmCalls).toBe(1), WAIT);

      // 실행 — 확정 응답을 기다리는 사이 사용자가 떠났다(‹·스와이프 뒤로).
      unmount();
      door.open();

      // 캐시 쓰기는 훅 옵션(mutation.onSuccess)이라 언마운트 뒤에도 돈다 — 일정 탭 카드가 확정을 안다.
      await waitFor(
        () =>
          expect(
            client.getQueryData<Itinerary>(
              getGetTripsTripIdItineraryQueryKey(TRIP_ID)
            )?.status
          ).toBe('CONFIRMED'),
        WAIT
      );
      // 이동은 화면에 딸린 일이다 — 이미 떠난 사람을 h16 으로 끌고 가지 않는다(02a ★5).
      await flush();
      expect(mockReplace).not.toHaveBeenCalled();
    });
  });
});

// TRIP-921 · 옛 ManualPlanPage.edit.integration.test.tsx
describe('편집 배선 — 순서·시각·저장·장소 추가', () => {
  /**
   * TRIP-921 · AC-9 — h12 직접 짜기(`ManualPlanPage`)가 **h12 편집(`ItineraryEditPage`)과 같은 위젯 편집
   * 뷰**를 소비하고, 그 뷰가 띄우는 표면(드래그·⌄ 시각칩·저장 CTA)이 전부 실제로 동작하는지 실 HTTP(msw)로
   * 태운다. 배선이 없으면 이 티켓이 없애려던 "받기만 하고 아무도 안 부르는" 표면이 직접 짜기 쪽에 재발한다
   * (01b Q3 채택 — 스토어 시드·드래그·시각 시트·저장 PUT·INV-4 안내).
   *
   * 무엇을 보장하나:
   *  - 🔴 M1 위젯 뷰 소비(드래그 리스트 존재) + 헤더 날짜 괄호형 `6월 10일(수)`(옛 `· 수` 중점형 정합).
   *  - 🔴 M2·M3 끌어 바꾼 순서 / 드롭존 삭제가 저장 PUT 에 실린다(INV-U3-02, AC-6·AC-8 의 직접 짜기판).
   *  - 🔴 M4 ⌄ → 시각 시트(`itinerary-manual-time-*`) → 적용값이 PUT 에 실린다.
   *  - 🔴 M5·M6 저장 실패·미지정 제외를 침묵하지 않는다(INV-4) — 페이지 소유 안내 testID 2종.
   *  - 🔴 M7 장소 추가·카드 사이 +·뒤로가 라우터로 이어진다(옛 `itinerary-manual-add-place` 대체).
   *    뒤로(‹)는 TRIP-1009 부터 `router.back` 이 아니라 일정 탭 `replace` 다(옛 C1b 는 TRIP-1038 로 삭제 — S1 주석).
   *
   * MANUAL 생성 POST 가드(G-a1~a3·I2)는 `ManualPlanPage.hookMock.test.tsx` 가 계속 잠근다 — 여기선
   * GET 이 기존 초안(days>0)을 돌려줘 POST 가 나가지 않는 경로만 쓴다.
   *
   * ⚠️ 실제 롱프레스·손가락 이동은 jest 사각(목) — 6-b 실기(AC-15, `/itinerary/manual` 입구).
   * 3동작 뼈대: 준비=가짜 서버(MANUAL 초안 한 날) → 실행=끌기·누르기·저장 → 단언=화면·나간 요청·라우터.
   */

  const BASE = 'http://localhost:8080/api/v1';
  const TRIP_ID = '22222222-2222-2222-2222-222222222222';
  const DAY = '2026-06-10';

  const k = (poiId: string): string => buildSlotKey(DAY, poiId);
  const SAVE = 'sheet-cta-button-0';
  const META = 'sheet-header-meta';
  const SHEET = 'itinerary-manual-time-sheet';
  const SAVE_ERROR = 'itinerary-manual-save-error';
  const UNSPECIFIED = 'itinerary-manual-unspecified-notice';

  function slot(
    poiId: string,
    startAt: string | null,
    endAt: string
  ): ItineraryDaysItemSlotsItem {
    return {
      poiId,
      // 미지정(null)은 서버 계약상 non-nullable 이라 캐스트로 심는다(unspecified 테스트 선례).
      startAt: startAt as unknown as string,
      endAt,
      isFixed: false,
      endsNextDay: false,
      hasViolation: false,
      alternatives: [],
      tags: [],
      nameKo: `장소-${poiId}`,
    };
  }

  /** a·b·c — c 는 P2 선례 시각(13:00–14:30)이라 시트에서 14시·15시로 바꾸면 14:00–15:30 이 된다(02a ★11). */
  const PLAIN = [
    slot('a', '09:00:00', '10:00:00'),
    slot('b', '11:00:00', '12:00:00'),
    slot('c', '13:00:00', '14:30:00'),
  ];

  function trip(): Trip {
    return {
      tripId: TRIP_ID,
      title: '부산 여행',
      startDate: DAY,
      endDate: '2026-06-12',
      party: 2,
      preferenceSnapshot: {},
      destinations: [{ seq: 1, region: '부산', nights: 2 }],
      status: 'PLANNED',
      createdAt: '2026-08-01T10:00:00.000Z',
      updatedAt: '2026-08-01T10:00:00.000Z',
      baseCount: 0,
      itineraryDayCount: 0,
    };
  }

  /** 직접 짜기 초안 — (MANUAL, MINIMAL, false). days>0 이라 페이지가 생성 POST 를 쏘지 않는다. */
  function manualDraft(slots: ItineraryDaysItemSlotsItem[]): Itinerary {
    return {
      itineraryId: 'itin-m',
      tripId: TRIP_ID,
      status: 'PLANNED',
      solveMode: 'MINIMAL',
      generationMode: 'MANUAL',
      generationState: 'COMPLETE',
      isFallback: false,
      days: [{ date: DAY, slots }],
    };
  }

  let putCalls = 0;
  let putBody: unknown = null;
  let daySlots: ItineraryDaysItemSlotsItem[] = PLAIN;
  let putHandler: () => Response;
  /** TRIP-1038 B — 저장 성공 뒤 확정 POST 가 따라 나간다. 핸들러가 없으면 `onUnhandledRequest:'error'` 에 걸린다(02a ★3). */
  let confirmHandler: () => Response | Promise<Response>;

  beforeEach(() => {
    putCalls = 0;
    putBody = null;
    daySlots = PLAIN;
    [mockPush, mockBack, mockReplace].forEach((fn) => fn.mockClear());
    setAccessToken('valid-access');
    useItineraryEditStore.getState().reset();
    putHandler = () => HttpResponse.json(manualDraft(daySlots));
    confirmHandler = () =>
      HttpResponse.json({ ...manualDraft(daySlots), status: 'CONFIRMED' });

    server.use(
      http.get(`${BASE}/trips/:tripId`, () => HttpResponse.json(trip())),
      http.get(`${BASE}/trips/:tripId/itinerary`, () =>
        HttpResponse.json(manualDraft(daySlots))
      ),
      // TRIP-1022 — 페이지가 빈 편집기 지도 중심용 거점을 조회한다(단언 무관 준비). `/saved-stays` 는
      // 기본 핸들러(`[]`)가 받는다. 없으면 `onUnhandledRequest:'error'` 에 걸린다(02a §3).
      http.get(`${BASE}/trips/:tripId/bases`, () => HttpResponse.json([])),
      http.put(`${BASE}/trips/:tripId/itinerary`, async ({ request }) => {
        putCalls += 1;
        putBody = await request.json();
        return putHandler();
      }),
      http.post(`${BASE}/trips/:tripId/itinerary/confirm`, () =>
        confirmHandler()
      )
    );
  });

  afterEach(() => {
    server.resetHandlers();
    clearAccessToken();
    // 토스트 스토어는 모듈 싱글턴이라 파일 안 테스트 사이로 샌다. S1 만이 아니라 **모든** 테스트 뒤에 비운다 —
    // 앞선 V3 저장이 띄운 토스트가 S1 첫 테스트까지 남아 거짓 green 을 만든 실측(03b 차단-1).
    resetToast();
  });

  function renderPage() {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      );
    }
    return render(<ManualPlanPage tripId={TRIP_ID} />, { wrapper: Wrapper });
  }

  async function ready(): Promise<void> {
    await screen.findByTestId(`slot-stopcard-${k('a')}`);
  }

  async function save(): Promise<EditItineraryRequest> {
    fireEvent.press(screen.getByTestId(SAVE));
    await waitFor(() => expect(putCalls).toBe(1));
    return putBody as EditItineraryRequest;
  }

  const ids = (body: EditItineraryRequest): string[] =>
    body.days[0].slots.map((s) => s.poiId);

  describe('🔴 M1 · AC-9 — 직접 짜기가 위젯 편집 뷰를 소비하고 헤더 날짜가 괄호형이다', () => {
    it('드래그 리스트가 있고 헤더가 "일정 편집 · 6월 10일(수) · 3곳" 조각이다', async () => {
      renderPage();
      await ready();

      expect(screen.getByTestId(EDIT_LIST)).toBeOnTheScreen();
      expect(screen.getByTestId('sheet-header-title')).toHaveTextContent(
        '일정 편집'
      );
      expect(screen.getByTestId('sheet-header-date')).toHaveTextContent(
        '6월 10일(수)'
      );
      expect(screen.getByTestId(META)).toHaveTextContent('3곳');
    });
  });

  describe('🔴 M2 · AC-9 — 끌어서 바꾼 순서가 저장 PUT 순서가 된다 (INV-U3-02)', () => {
    it('c 를 맨 앞으로(2→0) 끌고 저장하면 PUT 순서가 [c,a,b] 다', async () => {
      renderPage();
      await ready();

      fireEditDragEnd(2, 0);

      expect(ids(await save())).toEqual(['c', 'a', 'b']);
    });
  });

  describe('🔴 M3 · AC-9 — 드롭존에 놓은 곳은 곳수에서 빠지고 PUT 에 없다', () => {
    it('b 를 드롭존에 놓으면 2곳이 되고 저장 PUT 은 [a,c] 다', async () => {
      renderPage();
      await ready();

      fireEditDropOnZone(1);

      expect(screen.getByTestId(META)).toHaveTextContent('2곳');
      expect(ids(await save())).toEqual(['a', 'c']);
    });
  });

  describe('🔴 M4 · AC-9 — ⌄ 시각칩 → 시각 시트 → 적용값이 저장 PUT 에 실린다', () => {
    it('c 를 14:00–15:30 으로 바꿔 저장하면 PUT 의 c 시각이 바뀌고 a 는 그대로다', async () => {
      renderPage();
      await ready();

      expect(screen.queryByTestId(SHEET)).toBeNull();
      fireEvent.press(screen.getByTestId(`slot-stopcard-timechip-${k('c')}`));
      expect(await screen.findByTestId(SHEET)).toBeOnTheScreen();

      fireEvent.press(screen.getByTestId('itinerary-manual-time-start-h-14'));
      fireEvent.press(screen.getByTestId('itinerary-manual-time-end-h-15'));
      fireEvent.press(screen.getByTestId('itinerary-manual-time-apply'));
      await waitFor(() => expect(screen.queryByTestId(SHEET)).toBeNull());

      const body = await save();
      const c = body.days[0].slots.find((s) => s.poiId === 'c');
      const a = body.days[0].slots.find((s) => s.poiId === 'a');
      expect(c?.startAt).toBe('14:00:00');
      expect(c?.endAt).toBe('15:30:00');
      expect(a?.startAt).toBe('09:00:00');
    });
  });

  describe('🔴 M5 · AC-9 · INV-4 — 저장 실패는 침묵하지 않고 화면을 떠나지 않는다', () => {
    it('PUT 500 이면 저장 실패 안내가 완전일치 문구로 뜨고 라우터는 0회다', async () => {
      putHandler = () => new HttpResponse(null, { status: 500 });
      renderPage();
      await ready();

      await save();

      expect(await screen.findByTestId(SAVE_ERROR)).toHaveTextContent(
        '일정을 저장하지 못했어요. 잠시 후 다시 시도해 주세요'
      );
      expect(mockBack).not.toHaveBeenCalled();
      expect(mockPush).not.toHaveBeenCalled();
      expect(mockReplace).not.toHaveBeenCalled();
    });
  });

  describe('🔴 M6 · AC-9 · INV-4 — 시간대 미지정 곳은 저장에서 빠진다고 알린다', () => {
    it('a + 미지정 u 를 저장하면 "1곳은 저장에서 빠졌어요" 안내가 뜨고 PUT 에 u 가 없다', async () => {
      daySlots = [
        slot('a', '09:00:00', '10:00:00'),
        slot('u', null, '11:00:00'),
      ];
      renderPage();
      await ready();

      const body = await save();

      expect(ids(body)).toEqual(['a']);
      expect(await screen.findByTestId(UNSPECIFIED)).toHaveTextContent(
        '시간대를 정하지 않은 1곳은 저장에서 빠졌어요'
      );
    });
  });

  describe('🔴 M6-2 · TRIP-923 · INV-4 — 안내의 개수는 실제로 빠진 곳 수다', () => {
    it('두 날에 걸친 미지정 u1·u2 를 저장하면 PUT 은 [[a],[]] 이고 안내가 "2곳" 문장과 완전 일치한다', async () => {
      // 1곳(M6)이면 개수를 상수 1 로 박아도 통과한다 — 2곳이 구별되는 최소값.
      // 두 날에 흩는다 — 한 날에만 두면 "보이는 날만 세기" 회귀(1곳)를 못 잡는다(편집 UN3 과 같은 장치).
      const twoDays: Itinerary = {
        ...manualDraft([]),
        days: [
          {
            date: DAY,
            slots: [
              slot('u1', null, '09:00:00'),
              slot('a', '10:00:00', '11:00:00'),
            ],
          },
          { date: '2026-06-11', slots: [slot('u2', null, '12:00:00')] },
        ],
      };
      server.use(
        http.get(`${BASE}/trips/:tripId/itinerary`, () =>
          HttpResponse.json(twoDays)
        )
      );
      putHandler = () => HttpResponse.json(twoDays);
      renderPage();
      await ready();

      const body = await save();

      // ids() 는 days[0] 만 본다 — 두 날 모두 확인한다(빈 날도 날짜는 남는다).
      expect(body.days.map((d) => d.slots.map((s) => s.poiId))).toEqual([
        ['a'],
        [],
      ]);
      expect(await screen.findByTestId(UNSPECIFIED)).toHaveTextContent(
        '시간대를 정하지 않은 2곳은 저장에서 빠졌어요'
      );
    });
  });

  describe('🔴 M6-0 · TRIP-923 · INV-4 — 미지정 0 이면 저장해도 안내가 없다 (짝)', () => {
    it('전부 지정된 a·b·c 를 저장하면 PUT 은 그대로 나가고 제외 안내는 뜨지 않는다', async () => {
      renderPage();
      await ready();

      // 저장을 끝낸 뒤에 부재를 본다 — 저장 전 부재는 아무것도 증명하지 않는다.
      expect(ids(await save())).toEqual(['a', 'b', 'c']);
      expect(screen.queryByTestId(UNSPECIFIED)).toBeNull();
    });
  });

  describe('🟢 V3 · TRIP-590 AC1 · 5-b 경고-1 — 저장 응답의 서버 위반이 저장 뒤 화면에 뜬다', () => {
    it('위반 없는 초안을 저장하고 PUT 응답이 b 에 위반을 달면, 저장 뒤 b 에만 사유 배지가 뜬다', async () => {
      const REASON = '숙소 고정 충돌';
      // GET 은 위반 0(PLAIN), PUT 응답만 b 를 위반으로 재판정한다 — 배지의 출처가 PUT 응답뿐이게.
      const judged = manualDraft([
        PLAIN[0],
        { ...PLAIN[1], hasViolation: true, violationReason: REASON },
        PLAIN[2],
      ]);
      putHandler = () => HttpResponse.json(judged);
      // TRIP-1095 — 위반 응답이면 확정 전 요약 게이트에서 멈춰 확정이 안 나간다(배지 출처는 PUT 캐시뿐).
      // 아래 확정 핸들러는 게이트가 새어 확정이 나가더라도 배지를 지우지 않게 둔 옛 준비(TRIP-1038 B)다.
      confirmHandler = () =>
        HttpResponse.json({ ...judged, status: 'CONFIRMED' });
      renderPage();
      await ready();
      expect(screen.queryAllByTestId(/^slot-stopcard-violation-/)).toHaveLength(
        0
      );

      await save();

      expect(
        await screen.findByTestId(`slot-stopcard-violation-${k('b')}`)
      ).toHaveTextContent(REASON);
      expect(screen.queryAllByTestId(/^slot-stopcard-violation-/)).toHaveLength(
        1
      );
    });
  });

  describe('🔴 M7 · AC-9 — 장소 추가·카드 사이 +·뒤로가 라우터로 이어진다', () => {
    // TRIP-1009 C(01b Q3) — ‹ 는 이전 화면(방식 선택)이 아니라 일정 탭으로 바꿔 간다. 편집기에 들어온 순간
    // MANUAL 일정이 이미 있으므로 방식 선택으로 돌아가면 "일정이 없다"는 거짓 신호가 된다.
    it('장소 추가는 h13 말미, 카드 사이 + 는 선행 index, 뒤로는 일정 탭으로 replace 한다 (back 0회)', async () => {
      renderPage();
      await ready();

      fireEvent.press(screen.getByTestId('itinerary-edit-add-place'));
      expect(mockPush).toHaveBeenLastCalledWith({
        pathname: '/trips/[tripId]/itinerary/manual/add',
        params: { tripId: TRIP_ID },
      });

      // 카드 사이 + 는 보고 있는 날(date)도 싣는다(TRIP-1115 03b 차단-1). 말미 「장소 추가」는 위처럼 그대로.
      fireEvent.press(screen.getByTestId('itinerary-edit-insert-0'));
      expect(mockPush).toHaveBeenLastCalledWith({
        pathname: '/trips/[tripId]/itinerary/manual/add',
        params: { tripId: TRIP_ID, insertAfter: '0', date: DAY },
      });

      // 앵커 — ‹ 전엔 replace 0회(앞 동작이 부른 호출이 셈에 섞이지 않게).
      expect(mockReplace).not.toHaveBeenCalled();
      fireEvent.press(screen.getByTestId('itinerary-edit-back'));
      expect(mockReplace).toHaveBeenCalledTimes(1);
      expect(mockReplace).toHaveBeenCalledWith('/(tabs)/itinerary');
      expect(mockBack).not.toHaveBeenCalled();
    });

    // 2일짜리라야 "항상 1일차 날짜"로 박는 구현과 갈린다.
    it('2일차 칩으로 옮긴 뒤 카드 사이 + 는 2일차 date 를 싣는다 (TRIP-1115 03b 차단-1)', async () => {
      const DAY2 = '2026-06-11';
      const twoDays: Itinerary = {
        ...manualDraft(PLAIN),
        days: [
          { date: DAY, slots: PLAIN },
          {
            date: DAY2,
            slots: [
              slot('d', '09:00:00', '10:00:00'),
              slot('e', '11:00:00', '12:00:00'),
            ],
          },
        ],
      };
      server.use(
        http.get(`${BASE}/trips/:tripId/itinerary`, () =>
          HttpResponse.json(twoDays)
        )
      );
      renderPage();
      await ready();

      // 칩 testID 번호는 1부터다(day-2 = 2일차, EditorView 가 tab.dayIndex 를 쓴다).
      fireEvent.press(screen.getByTestId('itinerary-edit-day-2'));
      // 앵커 — 2일차 카드가 보인다.
      await screen.findByTestId(`slot-stopcard-${buildSlotKey(DAY2, 'd')}`);
      fireEvent.press(screen.getByTestId('itinerary-edit-insert-0'));

      expect(mockPush).toHaveBeenCalledTimes(1);
      expect(mockPush).toHaveBeenCalledWith({
        pathname: '/trips/[tripId]/itinerary/manual/add',
        params: { tripId: TRIP_ID, insertAfter: '0', date: DAY2 },
      });
    });
  });

  describe('🔴 M8 · AC-9 · 5-b 경고-4 — 다른 여행의 남은 드래프트를 이 여행 편집기에 그리지 않는다', () => {
    it('여행 A 드래프트가 스토어에 남은 채 B(일정 없음 404)에 들어오면 A 카드 0 · 0곳 · 저장 눌러도 PUT 0', async () => {
      // 준비 — 편집 스토어는 모듈 싱글턴이고 프로덕션 어디서도 reset 하지 않는다. A 를 고치다 저장 없이
      //   나간 상태를 스토어에 직접 심는다(다른 날짜·다른 장소).
      useItineraryEditStore
        .getState()
        .seed([
          { date: '2026-07-01', slots: [slot('ax', '10:00:00', '11:00:00')] },
        ]);
      let postCalls = 0;
      server.use(
        http.get(
          `${BASE}/trips/:tripId/itinerary`,
          () => new HttpResponse(null, { status: 404 })
        ),
        http.post(`${BASE}/trips/:tripId/itinerary`, () => {
          postCalls += 1;
          return HttpResponse.json(manualDraft([]), { status: 201 });
        })
      );

      // 실행 — B 의 직접 짜기 진입(GET 404 → 조회 데이터가 끝내 없다 → 시드가 안 돈다).
      renderPage();
      await waitFor(() => expect(postCalls).toBe(1)); // GET 정착(404) 확인 — MANUAL POST 가 나갔다.

      // 단언 — A 의 카드가 안 보이고 곳수는 0, 저장을 눌러도 A 의 장소가 B 로 PUT 되지 않는다.
      expect(screen.getByTestId('map-sheet-shell-root')).toBeOnTheScreen(); // 짝: 편집기는 떠 있다
      expect(screen.queryByText('장소-ax')).toBeNull();
      expect(screen.getByTestId(META)).toHaveTextContent('0곳');
      expect(screen.getByTestId(SAVE)).toBeDisabled();
      fireEvent.press(screen.getByTestId(SAVE));
      // PUT 은 비동기라 한 번 흘려 보낸 뒤 센다(누름이 요청을 냈다면 여기서 잡힌다).
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
      });
      expect(putCalls).toBe(0);
    });
  });

  /**
   * TRIP-990 · S1 (#043 · US-SCHED-08) → **TRIP-1038 B 로 뒤집음(D20 폐기)** — 직접 짜기 저장이 성공하면
   * "일정을 저장했어요" 토스트는 그대로 뜨지만, 이제 제자리에 남지 않고 확정까지 이어 확정 화면(h16)으로
   * 바꿔 간다(결정 1=(ii)). 토스트를 남기는 이유: 뒤이은 확정이 실패해도 저장은 됐다는 사실을 알린다(01 Q3).
   * 확정 흐름 자체(순서·실패·연타·언마운트)는 「저장하고 확정하기」 describe 가 잰다.
   *
   * 옛 C1b(TRIP-1009 — 저장 뒤 ‹)는 "저장해도 제자리"가 전제라 전제가 사라져 지웠다. ‹ → 일정 탭 replace
   * 계약은 위 M7 이 계속 잠근다.
   *
   * 토스트 호스트는 실제 앱에서 루트에 있다 — 이 테스트는 페이지 옆에 호스트를 함께 그려 "보였다"를 잰다
   * (`toastHarness`). 스토어가 모듈 싱글턴이라 파일 최상위 `afterEach` 가 테스트마다 비운다.
   *
   * 3동작 뼈대: 준비=PUT 200/500 → 실행=저장 → 단언=토스트 유무·라우터.
   */
  describe('🔴 S1 · 저장 성공 토스트 + 확정 화면으로 이동 (#043 · TRIP-1038 B)', () => {
    function renderPageWithToast() {
      const client = new QueryClient({
        defaultOptions: { queries: { retry: false, gcTime: 0 } },
      });
      return render(
        <QueryClientProvider client={client}>
          <WithToastHost>
            <ManualPlanPage tripId={TRIP_ID} />
          </WithToastHost>
        </QueryClientProvider>
      );
    }

    it('PUT 200 이면 "일정을 저장했어요" 토스트가 뜨고, 확정 뒤 h16 으로 replace 1회 · push/back 0', async () => {
      // TRIP-1047 — 확정이 성공하면 저장 토스트는 곧바로 확정 토스트로 바뀐다. 확정 응답을 문으로 붙잡아
      // "저장은 끝났고 확정은 아직"인 동안에 저장 토스트를 본다(안 붙잡으면 수 ms 만에 바뀌어 못 본다).
      let openDoor = () => {};
      const door = new Promise<void>((resolve) => {
        openDoor = resolve;
      });
      confirmHandler = async () => {
        await door;
        return HttpResponse.json({
          ...manualDraft(daySlots),
          status: 'CONFIRMED',
        });
      };
      renderPageWithToast();
      await ready();
      // 앵커: 저장 전엔 토스트가 없다 — 뒤에서 보이는 토스트가 이번 저장이 띄운 것임을 가른다.
      expect(screen.queryByTestId('itinerary-manual-saved')).toBeNull();

      await save();

      // 앵커: 이번 저장 PUT 이 실제로 1회 나갔다(저장 동작을 지우면 여기서 red).
      expect(putCalls).toBe(1);
      const toast = await screen.findByTestId('itinerary-manual-saved');
      expect(within(toast).getByText('일정을 저장했어요')).toBeOnTheScreen();
      // 저장 토스트를 본 **뒤에** 확정 응답을 보낸다.
      openDoor();
      // 저장+확정 2왕복 — CI 러너(약 4배 느림) 기준 한도.
      await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1), {
        timeout: 4000,
      });
      expect(mockReplace).toHaveBeenCalledWith({
        pathname: '/trips/[tripId]/itinerary',
        params: { tripId: TRIP_ID },
      });
      expect(mockBack).not.toHaveBeenCalled();
      expect(mockPush).not.toHaveBeenCalled();
    });

    it('짝: PUT 500 이면 실패 안내만 뜨고 성공 토스트는 없다', async () => {
      putHandler = () => new HttpResponse(null, { status: 500 });
      renderPageWithToast();
      await ready();

      await save();

      // 실패가 처리된 뒤에 센다 — 응답 전이면 어떤 구현이든 토스트가 없다.
      expect(await screen.findByTestId(SAVE_ERROR)).toBeOnTheScreen();
      expect(screen.queryByTestId('itinerary-manual-saved')).toBeNull();
    });
  });

  /**
   * TRIP-981 · MC (#057 같은 결함 · 브리프 후보5) — 직접 짜기 시각 시트도 딤으로 닫히면 페이지에 알린다.
   *
   * 기본 시각 시트가 딤 닫힘을 알리지 않으면 `editingSlotKey` 가 남아 시트가 마운트된 채 닫혀 있고, 시각
   * 칩을 다시 눌러도 열리지 않는다. 게다가 마운트된 채 다른 슬롯으로 바뀌면 시트가 옛 시각(처음 연 슬롯)을
   * 그대로 보여 준다. 테스트용 시트 목은 항상 열린 채라 `onClose` 를 불러 딤 닫힘을 흉내 낸다.
   *
   * 3동작 뼈대: 준비=c(13:00)·a(09:00) 초안 → 실행=c 칩 → close → a 칩 → 단언=시트 사라짐·재등장·a 시각 시드.
   */
  describe('🔴 MC · TRIP-981 — 직접 짜기 시각 시트도 딤으로 닫히면 다시 열린다', () => {
    it('MC1 · c 칩 시트를 딤으로 닫으면 트리에서 빠지고, a 칩을 누르면 a 의 09시로 새로 열린다', async () => {
      renderPage();
      await ready();

      fireEvent.press(screen.getByTestId(`slot-stopcard-timechip-${k('c')}`));
      const sheet = await screen.findByTestId(SHEET);
      expect(
        screen.getByTestId('itinerary-manual-time-start-h-13')
      ).toBeSelected();

      // 딤 탭 닫힘 대리 — 시트의 onClose 를 부른다(없으면 조용히 아무 일도 안 일어난다).
      fireEvent(sheet, 'close');
      await waitFor(() => expect(screen.queryByTestId(SHEET)).toBeNull());

      fireEvent.press(screen.getByTestId(`slot-stopcard-timechip-${k('a')}`));
      expect(await screen.findByTestId(SHEET)).toBeOnTheScreen();
      expect(
        screen.getByTestId('itinerary-manual-time-start-h-09')
      ).toBeSelected();
      expect(
        screen.getByTestId('itinerary-manual-time-start-h-13')
      ).not.toBeSelected();
    });
  });
});

// TRIP-1022 · 옛 ManualPlanPage.emptyStart.integration.test.tsx
describe('빈 일정으로 시작 — POST 성공 뒤 헤더·일차 칩', () => {
  /**
   * TRIP-1022 #075 — 새 여행에서 직접 짜기를 열면, 장소를 하나도 안 담아도 곧바로 헤더 날짜와 2일차
   * 칩이 보여야 한다.
   *
   * 무엇이 틀렸나: 진입 순간 일정 조회(GET)는 404 로 정착하고(재시도 안 함), 페이지는 MANUAL 생성
   * POST 를 쏜다. 서버는 전 일자를 빈 슬롯으로 깔아 **즉시** 돌려주는데, POST 성공 콜백이 조회 캐시를
   * 건드리지 않아 GET 의 404 가 그대로 남는다 → 날짜 0개 → 헤더 공백·칩 0개.
   *
   * 무엇을 보장하나(01 AC-A1~A3):
   *  - 🔴 E1 (A1·A2) POST 가 성공하면 조회 캐시가 갱신돼 `10월 20일(화)` 헤더와 1·2일차 칩이 뜬다.
   *    1박 2일 픽스처 — 칩이 뜨는 조건은 "2일 이상"(티켓의 "2박 이상"은 오기, 01 드리프트).
   *  - 🔴 E2 (A3) 캐시 갱신 뒤 기존 초안으로 보이게 돼도 POST 는 **총 1회**다(TRIP-601 가드 · BR-U3-06).
   *  - 🟢 E3 (A4 · 5-c 보강, 03b 경고-1) 페이지가 **이 여행의** 거점과 등록 숙소를 실제로 요청해,
   *    늦게 도착해도 지도가 서울 → 강릉으로 옮겨 간다. 동기 목 파일(C 묶음)은 목이 인자를 버려
   *    "무엇을 요청하는가"를 못 본다 — 그 사각을 실 HTTP 로 메운다.
   *
   * ★ 수단이 아니라 결과로 잰다(02a ★4): 캐시에 POST 응답을 직접 쓰든(setQueryData) 다시 조회하게
   *   하든(invalidateQueries) 둘 다 통과해야 한다. 그래서 가짜 서버를 "POST 전엔 404, 후엔 200" 으로
   *   두고 화면에 날짜가 뜨는지만 본다 — 아무것도 안 하면 404 가 남아 실패한다.
   *
   * 3동작 뼈대: 준비=가짜 서버(404→POST→200) → 실행=페이지 렌더 → 단언=헤더·칩·POST 건수.
   */

  const BASE = 'http://localhost:8080/api/v1';
  const TRIP_ID = '33333333-3333-3333-3333-333333333333';

  /** 1박 2일 MANUAL — 서버가 POST 에 즉시 돌려주는 모양(전 일자 빈 슬롯 · COMPLETE). */
  const MANUAL_TWO_DAYS: Itinerary = {
    itineraryId: 'itin-new',
    tripId: TRIP_ID,
    status: 'PLANNED',
    solveMode: 'MINIMAL',
    generationMode: 'MANUAL',
    generationState: 'COMPLETE',
    isFallback: false,
    days: [
      { date: '2026-10-20', slots: [] },
      { date: '2026-10-21', slots: [] },
    ],
  };

  let posted = false;
  let postCalls = 0;

  // 편집 스토어는 모듈 싱글턴이다 — describe 밖 최상위에서 비워 앞 케이스의 시드가 새지 않게 한다(02a ★16).
  beforeEach(() => {
    posted = false;
    postCalls = 0;
    setAccessToken('valid-access');
    useItineraryEditStore.getState().reset();

    // 통합 버킷은 핸들러가 없으면 준비 단계에서 죽는다 — 페이지가 부르는 네 경로를 전부 건다(02a ★17).
    server.use(
      http.get(`${BASE}/trips/:tripId/itinerary`, () =>
        posted
          ? HttpResponse.json(MANUAL_TWO_DAYS)
          : HttpResponse.json({}, { status: 404 })
      ),
      http.post(`${BASE}/trips/:tripId/itinerary`, () => {
        postCalls += 1;
        posted = true;
        return HttpResponse.json(MANUAL_TWO_DAYS, { status: 201 });
      }),
      http.get(`${BASE}/trips/:tripId/bases`, () => HttpResponse.json([])),
      http.get(`${BASE}/saved-stays`, () => HttpResponse.json([]))
    );
  });

  afterEach(() => {
    server.resetHandlers();
    clearAccessToken();
    useItineraryEditStore.getState().reset();
  });

  function renderPage() {
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
    return render(<ManualPlanPage tripId={TRIP_ID} />, { wrapper: Wrapper });
  }

  describe('🔴 E1 · AC-A1·A2 — POST 가 성공하면 장소 없이도 헤더 날짜와 2일차 칩이 뜬다', () => {
    it('404 로 시작해도 MANUAL 생성 뒤 "10월 20일(화)" 헤더와 1·2일차 칩이 보인다', async () => {
      // 준비·실행 — 새 여행(일정 없음)에서 직접 짜기 진입.
      renderPage();

      // 앵커 — 생성 전엔 칩이 없다(앞 케이스 시드가 새면 여기서 먼저 죽는다).
      expect(screen.queryAllByTestId('itinerary-edit-day-2').length).toBe(0);

      // POST 가 실제로 나갔다(GET 404 정착 → 생성).
      await waitFor(() => expect(postCalls).toBe(1));

      // 단언 — 캐시가 갱신돼 날짜가 생겼다.
      expect(
        await screen.findByTestId('itinerary-edit-day-2')
      ).toBeOnTheScreen();
      expect(screen.getByTestId('itinerary-edit-day-1')).toBeOnTheScreen();
      expect(screen.getByTestId('sheet-header-date')).toHaveTextContent(
        '10월 20일(화)'
      );
    });
  });

  describe('🔴 E2 · AC-A3 — 캐시 갱신 뒤에도 생성 POST 는 총 1회다 (TRIP-601 가드)', () => {
    it('칩이 뜬 뒤 한 번 더 흘려 보내도 POST 는 1건이다', async () => {
      renderPage();

      // 캐시 갱신이 끝났다(재조회를 택했으면 그 GET 도 도착했다).
      await screen.findByTestId('itinerary-edit-day-2');

      // 이제 "기존 초안 있음"으로 보이는 재렌더가 돈다 — 여기서 두 번째 POST 가 나가면 빈 MANUAL 로
      // 방금 만든 일정을 덮어쓴다. 한 번 흘려 보낸 뒤 센다.
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
      });
      expect(postCalls).toBe(1);
    });
  });

  describe('🟢 E3 · AC-A4 — 이 여행의 거점·숙소를 실제로 요청해 지도가 거점으로 옮겨 간다 (5-c 보강)', () => {
    const GANGNEUNG = '37.7519,128.8761';
    const SEOUL_CITY_HALL = '37.5665,126.978';

    const GN_BASE: BaseAssignment = {
      baseAssignmentId: 'ba-gn',
      savedStayId: 's-gn',
      dateFrom: '2026-10-20',
      dateTo: '2026-10-21',
    };

    const GN_STAY: SavedStay = {
      savedStayId: 's-gn',
      name: '강릉 바다 스테이',
      lat: 37.7519,
      lng: 128.8761,
      coordConfirmed: true,
      linkedTripIds: [TRIP_ID],
      registerRoute: 'MAP_SEARCH',
      createdAt: '2026-09-01T00:00:00Z',
      updatedAt: '2026-09-01T00:00:00Z',
    };

    it('첫 화면은 서울시청이다가, 거점·숙소가 도착하면 강릉 숙소를 비춘다', async () => {
      // 준비 — 거점은 **이 여행 id 경로**에서만 강릉을 준다(다른 id 로 물으면 beforeEach 의 빈 목록).
      server.use(
        http.get(`${BASE}/trips/${TRIP_ID}/bases`, () =>
          HttpResponse.json([GN_BASE])
        ),
        http.get(`${BASE}/saved-stays`, () => HttpResponse.json([GN_STAY]))
      );

      // 실행
      renderPage();

      // 앵커 — 응답은 비동기라 첫 렌더엔 아직 거점이 없다. 여기가 강릉이면 아래 단언이 공허해진다.
      expect(screen.getByTestId('map-root')).toHaveTextContent(SEOUL_CITY_HALL);

      // 단언 — 서울에서 강릉으로 **바뀌어야** 통과한다. 조회를 꺼 버리면(요청 0건) 영원히 서울이라 red.
      await waitFor(() =>
        expect(screen.getByTestId('map-root')).toHaveTextContent(GANGNEUNG)
      );
    });
  });
});

// TRIP-1038 C(#036) · 옛 ManualPlanPage.fresh.integration.test.tsx
describe('새로 짜기(startFresh) — 옛 일정 비우기', () => {
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
        if (!posted && firstGetFailure === 'network')
          return HttpResponse.error();
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
      expect(requestLog.indexOf('GET')).toBeLessThan(
        requestLog.indexOf('POST')
      );

      expect(
        await screen.findByTestId(NEW_DAY_CHIP, {}, WAIT)
      ).toBeOnTheScreen();
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
      expect(
        await screen.findByTestId(NEW_DAY_CHIP, {}, WAIT)
      ).toBeOnTheScreen();
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
      expect(
        await screen.findByTestId(NEW_DAY_CHIP, {}, WAIT)
      ).toBeOnTheScreen();
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
      await waitFor(
        () => expect(itineraryGets).toBeGreaterThanOrEqual(2),
        WAIT
      );

      expect(
        await screen.findByTestId(FRESH_ERROR, {}, WAIT)
      ).toHaveTextContent(/\S/);
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
      expect(
        await screen.findByTestId(FRESH_ERROR, {}, WAIT)
      ).toHaveTextContent(/\S/);

      expect(screen.getByTestId(CTA)).toBeDisabled();
      fireEvent.press(screen.getByTestId(CTA));
      // 장소 추가(h13)는 캐시의 옛 일정으로 PUT 을 만든다 — 가면 옛 장소 전부 + 새 장소가 저장된다(03b 경고-2).
      // 버튼을 숨기든 비활성으로 두든 "눌러도 안 간다"로 잰다(있으면 누른다 · 02a ★15 와 같은 방식).
      screen
        .queryAllByTestId(ADD_PLACE)
        .forEach((node) => fireEvent.press(node));
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
});

// TRIP-1095 · 옛 ManualPlanPage.save-conflict.integration.test.tsx
describe('저장 뒤 위반 요약 게이트', () => {
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
});
