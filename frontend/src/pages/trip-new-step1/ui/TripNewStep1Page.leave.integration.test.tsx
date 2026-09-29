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
import type { PreferenceView } from '@/shared/api/generated/schemas';
import { useGetTrips } from '@/shared/api/generated/trips/trips';
import { resetPressGuard } from '@/shared/press/pressGuard';
import { useTripWizardStore } from '@/features/trip/model/tripWizardStore';

import { TripNewStep1Page } from './TripNewStep1Page';

/**
 * TRIP-1114 — g01 ‹ 를 눌렀을 때, 이미 만든 여행이 있으면 바로 나가지 않고 묻는다(실 HTTP 심판).
 * 추적: US-TRIP-10(확정 전 아무것도 안 지움 · 실패 안내) · BR-U1-33(입력 보존) · INV-4.
 *
 * 무엇을 보장하나:
 *  - 여행을 안 만들었으면 지금처럼 바로 나간다(AC-1). 만들었으면 다이얼로그만 뜨고 아무것도 안 나간다(AC-2).
 *  - [계속 작성]은 닫기만, [저장하고 나가기]는 요청 없이 나가기, [삭제하고 나가기]는 DELETE 뒤 나가기.
 *  - 나가기는 `canGoBack() ? back() : replace('/(tabs)')` 이다(01b 결정 2).
 *  - 삭제 성공(204)·이미 없음(404)이면 `createdTripId` 만 비우고 드래프트는 그대로 둔다(결정 3).
 *  - 삭제 실패(500·네트워크)면 다이얼로그 안에 알리고 머문다. 다시 누르면 다시 보낸다(INV-4).
 *  - 삭제가 날아가는 동안에는 세 버튼이 모두 잠기고, 이동은 삭제 결과로 정확히 1번이다(Q3).
 *  - 삭제 뒤 `GET /trips`(내 여행 목록) 캐시를 무효화해 살아 있는 목록이 다시 받는다(Q4).
 *  - 화면이 사라진 뒤 도착한 응답은 이동을 일으키지 않는다(Q3 · AC-12).
 *
 * 왜 통합 버킷인가: 심판 대상이 "실제로 나간 요청의 종류·횟수"와 "라우터 호출"이다(msw 관찰).
 * 훅 목 대신 실제 react-query 가 돈다 — 연타 잠금은 늦게 알려지는 실물 거동에서만 의미가 있다.
 *
 * "0번" 단언은 전부 `settle()` 뒤다. AC-5 가 같은 `settle()` 한 번 뒤 DELETE 1번을 바로 단언해
 * "settle 이면 요청이 나갈 시간은 충분하다"를 이 파일 안에서 증명한다(02a ★1).
 *
 * 사람 손 간격: 서로 다른 버튼을 누르는 사이엔 `tap()` 이 400ms 누름 가드(`guardPress`, 모듈 전역)를
 * 닫는다 — 구현이 어느 버튼을 가드로 감싸든 "사람이 따로 누른 것"이 가드에 먹히지 않게(02a ★2).
 * 같은 틱 연타는 `tap` 없이 `fireEvent.press` 를 두 번 부른다.
 *
 * ⚠️ 요청 수는 완전 일치로 센다 — must-visits 경로가 `/api/v1/trips` 를 접두로 품는다.
 * ⚠️ 게스트로 돈다(담은목록 조회 없음). 헤더 ‹ 만 가로챈다 — 스와이프·하드웨어 뒤로는 jest 밖(결정 1).
 * ⚠️ 딤이 실제로 덮는지·가운데 오는지·뒤 터치를 막는지는 jest 사각(repo-traps 오버레이 절) — 6-b.
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

// jest.mock 팩토리는 호이스트돼 바깥 변수를 못 본다 — `mock` 접두만 예외. `useRouter()` 와 `router` 가
// 같은 객체라 구현이 어느 쪽을 써도 같은 jest.fn 에 기록된다.
const mockRouter = {
  push: jest.fn(),
  back: jest.fn(),
  replace: jest.fn(),
  canGoBack: jest.fn(() => true),
};
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  router: mockRouter,
}));

const BASE = 'http://localhost:8080/api/v1';
const BASE_DATE = '2026-06-10';
const TRIP_ID = '11111111-1111-1111-1111-111111111111';
const HOME_FALLBACK = '/(tabs)';
const ERROR_TEXT = '삭제하지 못했어요. 다시 시도해 주세요.';

const PREFERENCE: PreferenceView = {
  pace: { value: '균형있게', isNeutralDefault: false },
  budget: { tier: '중간', rawAmount: 800000, isNeutralDefault: false },
  styles: { value: ['미식', '전시'] },
  activities: { value: ['야경'] },
};

const DELETE_TRIP = `DELETE /api/v1/trips/${TRIP_ID}`;
const LIST_TRIPS = 'GET /api/v1/trips';

type DeleteMode = 204 | 404 | 500 | 'network' | 'gate';

let observedHits: string[] = [];
let deleteMode: DeleteMode = 204;
/** `gate` 모드에서 붙잡힌 DELETE 를 풀어 줄 문들. */
let gates: (() => void)[] = [];

const hits = (line: string) =>
  observedHits.filter((hit) => hit === line).length;

function openGates(): void {
  const pending = gates;
  gates = [];
  pending.forEach((resolve) => resolve());
}

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  server.events.on('request:start', ({ request }) => {
    observedHits.push(`${request.method} ${new URL(request.url).pathname}`);
  });
});

beforeEach(() => {
  observedHits = [];
  deleteMode = 204;
  gates = [];
  mockRouter.push.mockReset();
  mockRouter.back.mockReset();
  mockRouter.replace.mockReset();
  mockRouter.canGoBack.mockReset();
  mockRouter.canGoBack.mockImplementation(() => true);
  useTripWizardStore.getState().reset();

  server.use(
    http.get(`${BASE}/me/preferences`, () => HttpResponse.json(PREFERENCE)),
    http.get(`${BASE}/trips`, () => HttpResponse.json([])),
    http.delete(`${BASE}/trips/:tripId`, async () => {
      if (deleteMode === 'network') return HttpResponse.error();
      if (deleteMode === 500) {
        return HttpResponse.json(
          { error: { code: 'INTERNAL', message: '서버 오류' } },
          { status: 500 }
        );
      }
      if (deleteMode === 404) {
        return HttpResponse.json(
          { error: { code: 'NOT_FOUND', message: '없음' } },
          { status: 404 }
        );
      }
      if (deleteMode === 'gate') {
        await new Promise<void>((resolve) => {
          gates.push(resolve);
        });
      }
      return new HttpResponse(null, { status: 204 });
    })
  );
});

// 모듈 싱글턴 리셋은 파일 최상위에 건다 — describe 안에만 걸면 앞 테스트의 가드 창이 새어 든다.
afterEach(() => {
  // 단언이 문을 열기 전에 실패해도 붙잡힌 요청을 남기지 않는다(안 풀면 jest 가 red 대신 멈춘다).
  openGates();
  resetPressGuard();
  server.resetHandlers();
});

afterAll(() => server.close());

/** 살아 있는 "내 여행" 목록 흉내 — `GET /trips` 를 구독만 한다(무효화되면 다시 받는다, AC-11). */
function TripsListObserver(): null {
  useGetTrips();
  return null;
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false, gcTime: 0 },
    },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <TripsListObserver />
        {children}
      </QueryClientProvider>
    );
  }
  return render(<TripNewStep1Page baseDate={BASE_DATE} />, {
    wrapper: Wrapper,
  });
}

/** 요청이 출발할 시간을 준다(02a §5 실측 — 30ms 한 번이면 DELETE 가 이미 잡힌다). */
async function settle(): Promise<void> {
  await act(() => new Promise((r) => setTimeout(r, 30)));
}

/** 사람이 따로 누른 탭 — 400ms 누름 가드 창을 닫고(=시간이 흐른 것과 같다) 누른다. */
function tap(testID: string): void {
  resetPressGuard();
  fireEvent.press(screen.getByTestId(testID));
}

/** 부산 3박 + 2026-06-10~13 — 「다음」이 열리는 최소 드래프트. */
function seedValidDraft(): void {
  const store = useTripWizardStore.getState();
  store.addDestination('부산', 3);
  store.setPeriod('3n4d', '2026-06-10', '2026-06-13');
}

/** 이 위저드 세션에서 이미 여행을 만든 상태. */
function seedCreated(): void {
  seedValidDraft();
  useTripWizardStore.getState().setCreatedTripId(TRIP_ID);
}

function draftSnapshot() {
  const { destinations, startDate, endDate, party } =
    useTripWizardStore.getState();
  return { destinations, startDate, endDate, party };
}

/** 프리필·목록 첫 조회가 끝난 눈금 — 이 뒤로 "새로 나간 요청"만 센다. */
async function renderSettled() {
  const view = renderPage();
  await waitFor(() =>
    expect(
      screen.getByTestId('trip-wizard-summary-preference')
    ).toHaveTextContent(/미식/)
  );
  await waitFor(() => expect(hits(LIST_TRIPS)).toBe(1));
  await settle();
  return view;
}

async function openLeaveDialog() {
  const view = await renderSettled();
  tap('trip-wizard-step1-back');
  expect(screen.getByTestId('trip-wizard-leave-dialog')).toBeOnTheScreen();
  return view;
}

function navCalls() {
  return {
    back: mockRouter.back.mock.calls.length,
    replace: mockRouter.replace.mock.calls.length,
    push: mockRouter.push.mock.calls.length,
  };
}

describe('AC-1 · 여행을 안 만들었으면 지금처럼 바로 나간다 (무회귀)', () => {
  it('createdTripId 가 없으면 ‹ 한 번에 back 1회, 다이얼로그도 DELETE 도 없다', async () => {
    // 준비
    seedValidDraft();
    await renderSettled();

    // 실행
    tap('trip-wizard-step1-back');
    await settle();

    // 단언
    expect(screen.queryByTestId('trip-wizard-leave-dialog')).toBeNull();
    expect(navCalls()).toEqual({ back: 1, replace: 0, push: 0 });
    expect(hits(DELETE_TRIP)).toBe(0);
  });
});

describe('🔴 AC-2 · 이미 만든 여행이 있으면 ‹ 는 묻기만 한다 (US-TRIP-10 확정 전 아무것도 안 지움)', () => {
  it('다이얼로그가 세 버튼과 함께 뜨고, 이동 0 · DELETE 0 이다', async () => {
    // 준비
    seedCreated();
    await renderSettled();

    // 실행
    tap('trip-wizard-step1-back');
    await settle();

    // 단언
    const dialog = screen.getByTestId('trip-wizard-leave-dialog');
    for (const id of [
      'trip-wizard-leave-save',
      'trip-wizard-leave-delete',
      'trip-wizard-leave-stay',
    ]) {
      expect(within(dialog).getByTestId(id)).toBeOnTheScreen();
    }
    expect(screen.queryByTestId('trip-wizard-leave-error')).toBeNull();
    expect(navCalls()).toEqual({ back: 0, replace: 0, push: 0 });
    expect(hits(DELETE_TRIP)).toBe(0);
  });
});

describe('🔴 AC-3 · [계속 작성]은 닫기만 한다', () => {
  it('다이얼로그가 사라지고 이동 0 · 새 요청 0, createdTripId·드래프트는 그대로다', async () => {
    // 준비
    seedCreated();
    await openLeaveDialog();
    const before = draftSnapshot();
    const requestsBefore = observedHits.length;

    // 실행
    tap('trip-wizard-leave-stay');
    await settle();

    // 단언
    expect(screen.queryByTestId('trip-wizard-leave-dialog')).toBeNull();
    expect(navCalls()).toEqual({ back: 0, replace: 0, push: 0 });
    expect(observedHits.length).toBe(requestsBefore);
    expect(useTripWizardStore.getState().createdTripId).toBe(TRIP_ID);
    expect(draftSnapshot()).toEqual(before);
  });
});

describe('🔴 AC-4 · [저장하고 나가기]는 요청 없이 나간다', () => {
  it('back 1회 · DELETE 0, createdTripId 는 그대로다', async () => {
    // 준비
    seedCreated();
    await openLeaveDialog();

    // 실행
    tap('trip-wizard-leave-save');
    await settle();

    // 단언
    expect(navCalls()).toEqual({ back: 1, replace: 0, push: 0 });
    expect(hits(DELETE_TRIP)).toBe(0);
    expect(useTripWizardStore.getState().createdTripId).toBe(TRIP_ID);
  });

  it('같은 틱에 두 번 눌러도 back 은 1회다 (01b Q7 — 위저드 진입 전 화면까지 빠지지 않는다)', async () => {
    // 준비
    seedCreated();
    await openLeaveDialog();

    // 실행 — 가드 창을 닫지 않고 연달아 누른다.
    const save = screen.getByTestId('trip-wizard-leave-save');
    fireEvent.press(save);
    fireEvent.press(save);
    await settle();

    // 단언
    expect(navCalls()).toEqual({ back: 1, replace: 0, push: 0 });
  });
});

describe('🔴 AC-4b · 뒤로 갈 곳이 없으면 홈으로 replace 한다 (결정 2 · HOME_FALLBACK 선례)', () => {
  it('[저장하고 나가기] → replace("/(tabs)") 1회 · back 0', async () => {
    // 준비
    mockRouter.canGoBack.mockImplementation(() => false);
    seedCreated();
    await openLeaveDialog();

    // 실행
    tap('trip-wizard-leave-save');
    await settle();

    // 단언
    expect(mockRouter.replace.mock.calls).toEqual([[HOME_FALLBACK]]);
    expect(mockRouter.back).not.toHaveBeenCalled();
  });

  it('[삭제하고 나가기] 204 → replace("/(tabs)") 1회 · back 0', async () => {
    // 준비
    mockRouter.canGoBack.mockImplementation(() => false);
    seedCreated();
    await openLeaveDialog();

    // 실행
    tap('trip-wizard-leave-delete');

    // 단언
    await waitFor(() =>
      expect(mockRouter.replace.mock.calls).toEqual([[HOME_FALLBACK]])
    );
    await settle();
    expect(mockRouter.replace).toHaveBeenCalledTimes(1);
    expect(mockRouter.back).not.toHaveBeenCalled();
  });
});

describe('🔴 AC-5 · [삭제하고 나가기] 204 — 그 여행을 지우고 id 만 비운 뒤 나간다 (결정 3)', () => {
  it('DELETE /trips/{id} 정확히 1회 → createdTripId 가 비고 드래프트는 그대로, back 1회', async () => {
    // 준비
    seedCreated();
    await openLeaveDialog();
    const before = draftSnapshot();

    // 실행
    tap('trip-wizard-leave-delete');
    await settle();

    // 단언 ① — settle 한 번 뒤 바로: DELETE 가 정확히 1번(이 줄이 ★1 "settle 이면 충분" 의 증명이다).
    expect(hits(DELETE_TRIP)).toBe(1);

    // 단언 ② — 응답 뒤: 나가기 1번, id 만 비고 드래프트는 그대로.
    await waitFor(() => expect(mockRouter.back).toHaveBeenCalledTimes(1));
    expect(navCalls()).toEqual({ back: 1, replace: 0, push: 0 });
    expect(useTripWizardStore.getState().createdTripId).toBeUndefined();
    expect(draftSnapshot()).toEqual(before);
    expect(hits(DELETE_TRIP)).toBe(1);
  });
});

describe('🔴 AC-6 · 삭제가 실패하면 다이얼로그 안에서 알리고 머문다 (INV-4)', () => {
  it.each<[string, DeleteMode]>([
    ['서버 오류(500)', 500],
    ['네트워크 실패', 'network'],
  ])(
    '%s → 실패 문구 · 이동 0 · createdTripId 그대로, 다시 누르면 DELETE 를 다시 보낸다',
    async (_label, mode) => {
      // 준비
      deleteMode = mode;
      seedCreated();
      await openLeaveDialog();

      // 실행
      tap('trip-wizard-leave-delete');

      // 단언 ① — 다이얼로그 안에 실패 문구(완전 일치), 머문다.
      await waitFor(() =>
        expect(
          within(screen.getByTestId('trip-wizard-leave-dialog')).getByTestId(
            'trip-wizard-leave-error'
          )
        ).toHaveTextContent(ERROR_TEXT)
      );
      await settle();
      expect(navCalls()).toEqual({ back: 0, replace: 0, push: 0 });
      expect(useTripWizardStore.getState().createdTripId).toBe(TRIP_ID);
      expect(hits(DELETE_TRIP)).toBe(1);

      // 실행 ② — "다시 시도해 주세요" 대로 다시 누른다.
      tap('trip-wizard-leave-delete');
      await settle();

      // 단언 ② — 잠금이 풀려 두 번째 DELETE 가 나갔다.
      expect(hits(DELETE_TRIP)).toBe(2);
    }
  );
});

describe('🔴 AC-7 · 404 는 "이미 없음" — 실패 문구 없이 나간다 (TRIP-1055 ③ 선례)', () => {
  it('DELETE 404 → createdTripId 가 비고 back 1회, 실패 문구는 없다', async () => {
    // 준비
    deleteMode = 404;
    seedCreated();
    await openLeaveDialog();

    // 실행
    tap('trip-wizard-leave-delete');

    // 단언
    await waitFor(() => expect(mockRouter.back).toHaveBeenCalledTimes(1));
    await settle();
    expect(navCalls()).toEqual({ back: 1, replace: 0, push: 0 });
    expect(useTripWizardStore.getState().createdTripId).toBeUndefined();
    expect(screen.queryByTestId('trip-wizard-leave-error')).toBeNull();
  });
});

describe('🔴 AC-8 · 삭제가 날아가는 중 [삭제]를 다시 눌러도 DELETE 는 1번이다', () => {
  it.each<[string, boolean]>([
    ['같은 틱 연타', false],
    ['사람 간격으로 다시 누름(누름 가드 창 닫힘)', true],
  ])('%s → DELETE 1 · 응답 뒤 이동 정확히 1회', async (_label, spaced) => {
    // 준비 — DELETE 응답을 문 뒤에 붙잡아 "진행 중" 을 만든다.
    deleteMode = 'gate';
    seedCreated();
    await openLeaveDialog();

    // 실행
    const del = screen.getByTestId('trip-wizard-leave-delete');
    fireEvent.press(del);
    if (spaced) resetPressGuard();
    fireEvent.press(del);
    await settle();

    // 단언 ① — 진행 중에 나간 DELETE 는 1번, 아직 안 나갔다.
    expect(hits(DELETE_TRIP)).toBe(1);
    expect(navCalls()).toEqual({ back: 0, replace: 0, push: 0 });

    // 실행 ② — 응답을 보낸다.
    await act(async () => {
      openGates();
    });

    // 단언 ② — 끝난 뒤에도 DELETE 1번, 이동 1번.
    await waitFor(() => expect(mockRouter.back).toHaveBeenCalledTimes(1));
    await settle();
    expect(hits(DELETE_TRIP)).toBe(1);
    expect(navCalls()).toEqual({ back: 1, replace: 0, push: 0 });
  });
});

describe('🔴 AC-10 · 삭제가 날아가는 중엔 [저장]·[계속 작성]도 잠긴다 (01b Q3 — 이중 이동 방지)', () => {
  it.each([
    ['[저장하고 나가기]', 'trip-wizard-leave-save'],
    ['[계속 작성]', 'trip-wizard-leave-stay'],
  ])(
    '%s 를 눌러도 이동 0 · 다이얼로그 유지, 응답 뒤 이동은 삭제 결과로 정확히 1회',
    async (_label, testID) => {
      // 준비 — 삭제를 붙잡아 둔다.
      deleteMode = 'gate';
      seedCreated();
      await openLeaveDialog();
      tap('trip-wizard-leave-delete');
      await settle();
      expect(hits(DELETE_TRIP)).toBe(1);

      // 실행 — 사람이 따로 다른 버튼을 누른다(누름 가드가 아니라 진행 중 잠금이 막아야 한다).
      tap(testID);
      await settle();

      // 단언 ① — 아무 데도 안 갔고 다이얼로그는 그대로다.
      expect(navCalls()).toEqual({ back: 0, replace: 0, push: 0 });
      expect(screen.getByTestId('trip-wizard-leave-dialog')).toBeOnTheScreen();

      // 실행 ② — 삭제 응답(204)을 보낸다.
      await act(async () => {
        openGates();
      });

      // 단언 ② — 이동은 삭제 결과 하나뿐이다.
      await waitFor(() => expect(mockRouter.back).toHaveBeenCalledTimes(1));
      await settle();
      expect(navCalls()).toEqual({ back: 1, replace: 0, push: 0 });
      expect(hits(DELETE_TRIP)).toBe(1);
    }
  );
});

describe('🔴 AC-11 · 지우면 내 여행 목록 캐시를 무효화한다 (01b Q4)', () => {
  it.each<[string, DeleteMode]>([
    ['204', 204],
    ['404', 404],
  ])(
    'DELETE %s → 살아 있는 목록이 GET /trips 를 다시 받는다',
    async (_label, mode) => {
      // 준비 — 목록 구독자가 이미 한 번 받아 둔 상태(renderSettled 가 1회를 확인).
      deleteMode = mode;
      seedCreated();
      await openLeaveDialog();
      expect(hits(LIST_TRIPS)).toBe(1);

      // 실행
      tap('trip-wizard-leave-delete');

      // 단언
      await waitFor(() => expect(hits(LIST_TRIPS)).toBe(2));
    }
  );
});

describe('🔴 AC-12 · 화면이 사라진 뒤 도착한 삭제 응답은 이동을 일으키지 않는다 (01b Q3)', () => {
  it('삭제 대기 중 언마운트(스와이프 이탈 흉내) → 응답 204 뒤 back·replace 0', async () => {
    // 준비
    deleteMode = 'gate';
    seedCreated();
    const view = await openLeaveDialog();
    tap('trip-wizard-leave-delete');
    await settle();
    expect(hits(DELETE_TRIP)).toBe(1);

    // 실행 — 화면이 먼저 사라지고, 그다음 응답이 온다.
    view.unmount();
    await act(async () => {
      openGates();
    });
    await settle();
    await settle();

    // 단언
    expect(navCalls()).toEqual({ back: 0, replace: 0, push: 0 });
  });
});
