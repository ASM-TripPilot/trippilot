import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

import { server } from '@/mocks/server';
import type { PreferenceView, Trip } from '@/shared/api/generated/schemas';
import { useTripWizardStore } from '@/features/trip/model/tripWizardStore';

import { TripNewStep1Page } from './TripNewStep1Page';

/**
 * TRIP-667 g01 기간 편집 시트 — **배선 승인 테스트**(요약 "기간" 행 → 시트 오픈 → 시작 탭 → 적용 → 스토어).
 * TRIP-1027 로 시트는 **시작 날짜만** 고른다 — 끝 날짜는 시작 + 여행지 박수 합이다(01b D2).
 *
 * 무엇을 보장하나:
 *  ① 기간 행 탭 → 시트 마운트(트리 존재)
 *  ② 날짜 탭 한 번 → 배선이 range 를 {시작, 시작 + Σ} 로 갱신해 재렌더 → 시작·사이·끝 표식이 실제로 바뀐다
 *     (무상태 시트라 이 전이는 여기서만 관측된다). 두 번째 탭도 새 시작이다(끝을 고르지 않는다)
 *  ③ "적용" **누르기 전엔** 스토어 기간 불변, 누르면 시작·파생 끝 커밋 + 닫힘
 *  ④ 제출 바디의 endDate − startDate = 박수 합(AC-9)
 *
 * 왜 통합 버킷인가: 시트는 props-only 무상태라 "셀 탭→표식 변화"는 배선이 range 를 소유·갱신할 때만
 * 일어난다 — 스토어 실반영과 전이를 함께 관측해야 한다. 컴포넌트 단위(표식 렌더·콜백)는 별 파일이 잠근다.
 *
 * ⚠️ 게스트(토큰 미주입)로 돈다 — `useSavedPlaces`/`useSavedStays` 가 `enabled:false` 라 안 나가고
 * (01b 비회원 예외), 무조건 발화하는 `useGetMePreferences`(프리필)만 `/me/preferences` 핸들러로 받는다.
 * `/regions`·`/saved-stays`·`/saved-places` 핸들러는 **일부러 안 준다**(남기면 신 페이지가 그 훅을
 * 게스트에서 물었다는 증거로 `onUnhandledRequest:'error'` 크래시 red). POST /trips 는 W-5 만 자기 안에서 준다.
 *
 * ⚠️ 바텀시트 통과형 목: 마운트하면 children 을 무조건 렌더한다 — 여기서 관측하는 "시트 오픈"은
 * **조건부 마운트 트리 존재/부재**뿐이다. 실제 슬라이드업·딤·범위 하이라이트 실렌더는 jest 사각(6-b 실기).
 *
 * ⚠️ 모듈 싱글턴 스토어 — 파일 최상위 beforeEach·afterEach 에서 reset 한다(02a ★11).
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

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: mockBack, replace: jest.fn() }),
}));

const BASE = 'http://localhost:8080/api/v1';
// 결정론적 today 주입 — 6/1 이라 6월 전 칸이 활성이다(과거 없음).
const BASE_DATE = '2026-06-01';

const PREFERENCE: PreferenceView = {
  pace: { value: '균형있게', isNeutralDefault: false },
  budget: { tier: '중간', rawAmount: 800000, isNeutralDefault: false },
  styles: { value: ['미식'] },
  activities: { value: ['야경'] },
};

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});

beforeEach(() => {
  mockPush.mockClear();
  mockBack.mockClear();
  useTripWizardStore.getState().reset();

  server.use(
    http.get(`${BASE}/me/preferences`, () => HttpResponse.json(PREFERENCE))
  );
});

afterEach(() => {
  server.resetHandlers();
  useTripWizardStore.getState().reset();
});

afterAll(() => server.close());

function createWrapper() {
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
  return Wrapper;
}

function renderPage() {
  return render(<TripNewStep1Page baseDate={BASE_DATE} />, {
    wrapper: createWrapper(),
  });
}

/** 기간 요약 행을 눌러 시트를 연다(공통). */
async function openSheet(): Promise<void> {
  fireEvent.press(screen.getByTestId('trip-wizard-summary-period'));
  await screen.findByTestId('trip-wizard-period-sheet');
}

describe('W-1 · 기간 행 탭이 시트를 연다', () => {
  it('탭 전엔 시트가 없고, 탭하면 마운트된다', async () => {
    renderPage();
    // 아직 안 눌렀다 — 조건부 마운트라 트리에 없다.
    expect(screen.queryByTestId('trip-wizard-period-sheet')).toBeNull();

    fireEvent.press(screen.getByTestId('trip-wizard-summary-period'));

    expect(
      await screen.findByTestId('trip-wizard-period-sheet')
    ).toBeOnTheScreen();
  });
});

/** 시작 날짜만 고른다(TRIP-1027) — 끝 표식은 시작 + 박수 합에 뜬다. */
function seedDestinations(nights: number[]): void {
  const store = useTripWizardStore.getState();
  const names = ['서울특별시', '부산광역시', '경주시'];
  nights.forEach((n, i) => store.addDestination(names[i], n));
}

function mark(role: 'start' | 'between' | 'end', date: string) {
  return screen.queryByTestId(`trip-wizard-period-cell-${role}-${date}`);
}

describe('W-2 · 날짜 탭 한 번 = 새 시작, 끝 표식은 시작 + 박수 합 (TRIP-1027 AC-5)', () => {
  it('서울1·부산2(3박)에서 6/10 탭 → 6/10–6/13, 범위 안 6/12 탭 → 새 시작 6/12–6/15, 6/20 탭 → 6/20–6/23', async () => {
    // 준비 — 박수 합 3.
    seedDestinations([1, 2]);
    renderPage();
    await openSheet();

    // 실행 ① — 6/10 한 번. 끝(6/13)을 누르지 않아도 범위가 완성돼 그려진다.
    fireEvent.press(screen.getByTestId('trip-wizard-period-cell-2026-06-10'));
    expect(
      await screen.findByTestId('trip-wizard-period-cell-start-2026-06-10')
    ).toBeOnTheScreen();
    expect(mark('between', '2026-06-11')).toBeOnTheScreen();
    expect(mark('between', '2026-06-12')).toBeOnTheScreen();
    expect(mark('end', '2026-06-13')).toBeOnTheScreen();
    expect(screen.getByTestId('trip-wizard-period-summary')).toHaveTextContent(
      /6월 10일.*13일/
    );

    // 실행 ② — 파생 범위 안쪽 뒤 날짜(6/12). 옛 2탭 규칙이면 "끝 = 6/12 완성"이었다(02a ★8).
    fireEvent.press(screen.getByTestId('trip-wizard-period-cell-2026-06-12'));
    expect(
      await screen.findByTestId('trip-wizard-period-cell-start-2026-06-12')
    ).toBeOnTheScreen();
    expect(mark('end', '2026-06-15')).toBeOnTheScreen();
    expect(mark('end', '2026-06-12')).toBeNull();
    expect(mark('end', '2026-06-13')).toBeNull();
    expect(mark('start', '2026-06-10')).toBeNull();

    // 실행 ③ — 먼 날짜(6/20)도 새 시작.
    fireEvent.press(screen.getByTestId('trip-wizard-period-cell-2026-06-20'));
    expect(
      await screen.findByTestId('trip-wizard-period-cell-start-2026-06-20')
    ).toBeOnTheScreen();
    expect(mark('end', '2026-06-23')).toBeOnTheScreen();
    await waitFor(() => expect(mark('end', '2026-06-15')).toBeNull());
  });
});

describe('W-3 · 한 번 탭하면 적용이 열리고, 적용 = 시작·파생 끝 커밋 + 닫기 (TRIP-1027 AC-5)', () => {
  it('탭 전엔 적용이 닫혀 있고, 6/10 한 번 탭하면 열리며, 적용하면 6/10–6/13 이 커밋된다', async () => {
    seedDestinations([1, 2]);
    renderPage();
    await openSheet();
    const apply = () => screen.getByTestId('trip-wizard-period-apply');

    // 앵커 — 아직 아무것도 안 골랐다(02a ★7).
    expect(apply()).toBeDisabled();

    fireEvent.press(screen.getByTestId('trip-wizard-period-cell-2026-06-10'));
    await screen.findByTestId('trip-wizard-period-cell-start-2026-06-10');
    expect(apply()).toBeEnabled();

    // 적용 전 — 아직 커밋 안 됨.
    expect(useTripWizardStore.getState().startDate).toBeUndefined();
    expect(useTripWizardStore.getState().endDate).toBeUndefined();

    fireEvent.press(apply());

    await waitFor(() =>
      expect(useTripWizardStore.getState().startDate).toBe('2026-06-10')
    );
    expect(useTripWizardStore.getState().endDate).toBe('2026-06-13');
    expect(useTripWizardStore.getState().presetCode).toBeUndefined();
    await waitFor(() =>
      expect(screen.queryByTestId('trip-wizard-period-sheet')).toBeNull()
    );
  });
});

describe('W-4 · 여행지 0곳이면 당일 — 끝 원 없이 시작만, 적용하면 시작 = 끝 (TRIP-1027 AC-2)', () => {
  it('6/10 탭 → 시작 표식만(끝·사이 없음) · 적용 열림 → 커밋 6/10–6/10', async () => {
    expect(useTripWizardStore.getState().destinations).toHaveLength(0);
    renderPage();
    await openSheet();

    fireEvent.press(screen.getByTestId('trip-wizard-period-cell-2026-06-10'));

    expect(
      await screen.findByTestId('trip-wizard-period-cell-start-2026-06-10')
    ).toBeOnTheScreen();
    expect(mark('end', '2026-06-10')).toBeNull();
    expect(mark('between', '2026-06-11')).toBeNull();
    expect(screen.getByTestId('trip-wizard-period-apply')).toBeEnabled();

    fireEvent.press(screen.getByTestId('trip-wizard-period-apply'));

    await waitFor(() =>
      expect(useTripWizardStore.getState().startDate).toBe('2026-06-10')
    );
    expect(useTripWizardStore.getState().endDate).toBe('2026-06-10');
  });
});

/** openapi `Trip.required` 필드를 채운 201 응답(제출 배선 형제 파일 선례). */
const CREATED_TRIP: Trip = {
  tripId: '11111111-1111-1111-1111-111111111111',
  title: '서울 여행',
  startDate: '2026-06-10',
  endDate: '2026-06-13',
  party: 1,
  companionType: null,
  budgetTotal: 800000,
  preferenceSnapshot: {},
  destinations: [
    { seq: 1, region: '서울특별시', nights: 1 },
    { seq: 2, region: '부산광역시', nights: 2 },
  ],
  status: 'PLANNED',
  createdAt: '2026-08-02T00:00:00Z',
  updatedAt: '2026-08-02T00:00:00Z',
  baseCount: 0,
  itineraryDayCount: 0,
};

describe('W-5 · 제출 바디의 기간은 시작 + 박수 합이다 (TRIP-1027 AC-9)', () => {
  it('6/10 적용 → 부산 +1 → 다음: POST /trips 1회, startDate 6/10 · endDate 6/13 · 박수 [1, 2]', async () => {
    // 준비 — 이 테스트만 제출 핸들러를 더한다.
    const postedBodies: Record<string, unknown>[] = [];
    server.use(
      http.post(`${BASE}/trips`, async ({ request }) => {
        postedBodies.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json(CREATED_TRIP, { status: 201 });
      })
    );
    seedDestinations([1, 1]);
    renderPage();
    await openSheet();
    fireEvent.press(screen.getByTestId('trip-wizard-period-cell-2026-06-10'));
    fireEvent.press(screen.getByTestId('trip-wizard-period-apply'));
    fireEvent.press(screen.getByTestId('trip-wizard-summary-destination'));
    fireEvent.press(
      await screen.findByTestId('trip-wizard-destination-nights-inc-2')
    );
    fireEvent.press(screen.getByTestId('trip-wizard-destination-apply'));

    // 실행 — 프리필 도착(로딩 해제) 뒤 다음.
    const next = screen.getByTestId('trip-wizard-step1-next');
    await waitFor(() => expect(next).toBeEnabled());
    fireEvent.press(next);

    // 단언 — 요청 모양은 그대로, 끝 날짜만 파생값이다.
    await waitFor(() => expect(postedBodies).toHaveLength(1));
    const body = postedBodies[0] as {
      startDate: string;
      endDate: string;
      destinations: { seq: number; region: string; nights: number }[];
    };
    expect(body.startDate).toBe('2026-06-10');
    expect(body.endDate).toBe('2026-06-13');
    expect(body.destinations.map((one) => one.nights)).toEqual([1, 2]);
    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith('/trips/new/step2')
    );
  });
});
