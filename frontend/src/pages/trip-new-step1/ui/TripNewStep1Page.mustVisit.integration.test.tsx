import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';

import { server } from '@/mocks/server';
import type { Place, SavedPlace, Trip } from '@/shared/api/generated/schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';
import { useTripWizardStore } from '@/features/trip/model/tripWizardStore';

import { TripNewStep1Page } from './TripNewStep1Page';

/**
 * TRIP-209 '꼭 갈 곳' — **실 HTTP 로 태우는 심판**.
 *
 * ⚠️ **담은 곳(하트) 자동 시드 → 필수 방문지 자동 등록 파이프라인은 폐지됐다**(사용자 결정).
 * 예전엔 여기서 담은 곳을 시드로 가져와 여행 생성 뒤 `POST /trips/{tripId}/must-visits`로
 * 한 건씩 등록했으나(409 수렴·등록 실패 배너·재시도·동시성 가드까지 10케이스), `mustVisits`를
 * 채우는 경로 자체가 없어져(`TripNewStep1Page.tsx` 참고) 이제 이 등록 파이프라인은 **항상
 * 0건**으로 귀결된다. 아래 두 케이스만 남는다 — ① 담은 곳이 있어도 "꼭 갈 곳"은 비어 보인다
 * ② 제출해도 등록 요청 자체가 안 나간다. 옛 09케이스(409 수렴·재시도·동시성 등)는 전부 이
 * 파이프라인 없이는 도달 불가라 삭제했다(git 히스토리에 남음) — 여행 생성 자체의 이중 제출
 * 가드는 `TripNewStep1Page.integration.test.tsx`의 I-6이 must-visit과 무관하게 이미 본다.
 *
 * 왜 통합 버킷인가: "GET /saved-places가 실제로 나가는데도 등록 요청은 0건"이라는 성질은
 * 훅을 목킹하면 가정으로 전락한다 — 실 HTTP로 태워야 그 가정이 실제로 맞는지 증명된다.
 *
 * 3동작 뼈대: 준비=핸들러 응답 지정 + 드래프트 채우기 → 실행=`[다음]` press →
 * 단언=나간 요청(개수) · 캡션 · 이동 여부.
 */

// authedClient(생성 클라이언트가 타는 인증 계층)가 `@/shared/storage` 를 정적으로 물고 있다 —
// expo-secure-store 실물 로드를 피하려면 목킹해야 한다(선례와 동형).
jest.mock('@/shared/storage', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest.fn().mockResolvedValue({
    accessToken: 'old-access',
    refreshToken: 'old-refresh',
  }),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  hasStoredToken: jest.fn().mockResolvedValue(true),
}));

// jest.mock 팩토리는 파일 맨 위로 끌어올려지므로 바깥 변수를 못 본다 — 이름이 `mock` 으로
// 시작하는 변수만 예외다(리포 확립 규칙).
const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn(), replace: jest.fn() }),
}));

/** `authWiring.integration.test.ts:59` 와 같은 값(리포 관례). */
const BASE = 'http://localhost:8080/api/v1';

/** 프리셋 계산 기준일 고정 — 실행일이 바뀌어도 날짜 단언이 흔들리지 않는다. */
const BASE_DATE = '2026-06-10';

const TRIP_ID = '11111111-1111-1111-1111-111111111111';

/** openapi `Trip.required` 10필드를 그대로 채운다(상상해서 만들지 않는다). */
const TRIP: Trip = {
  tripId: TRIP_ID,
  title: '부산 여행',
  startDate: '2026-06-10',
  endDate: '2026-06-13',
  party: 1,
  companionType: null,
  budgetTotal: 800000,
  preferenceSnapshot: {},
  destinations: [{ seq: 1, region: '부산', nights: 3 }],
  status: 'PLANNED',
  createdAt: '2026-08-02T00:00:00Z',
  updatedAt: '2026-08-02T00:00:00Z',
};

function makePlace(poiId: string, nameKo: string): Place {
  return {
    poiId,
    nameKo,
    category: '명소',
    lat: 35.1587,
    lng: 129.1604,
    region: '수영구',
    openingHours: null,
    imageUrl: null,
    tags: [],
    savedCount: 0,
    dataStatus: 'ACTIVE',
  };
}

function savedPlace(poiId: string, nameKo: string): SavedPlace {
  return {
    savedPlaceId: `sp-${poiId}`,
    savedAt: '2026-08-01T10:00:00.000Z',
    place: makePlace(poiId, nameKo),
  };
}

const THREE: SavedPlace[] = [
  savedPlace('poi-1', '감천마을'),
  savedPlace('poi-2', '광안리'),
  savedPlace('poi-3', '전포'),
];

/** 나간 요청의 `METHOD /경로` 누적 — 요청 **횟수**를 세는 데 쓴다. */
let observedHits: string[] = [];

/** ⚠️ **완전 일치**로 센다 — must-visits 경로(`POST /api/v1/trips/{id}/must-visits`)가
 * 생성 경로를 접두로 포함하므로, 부분 일치로 세면 두 축이 섞여 "여행이 두 번 만들어졌다"를
 * 못 본다. 이 칸에서 가장 비싼 사고가 정확히 그 축이다(02a ★3). */
function createHits(): number {
  return observedHits.filter((hit) => hit === 'POST /api/v1/trips').length;
}

function mustVisitHits(): number {
  return observedHits.filter((hit) => hit.endsWith('/must-visits')).length;
}

function savedPlaceHits(method: 'GET' | 'DELETE'): number {
  return observedHits.filter(
    (hit) => hit.startsWith(method) && hit.includes('/api/v1/saved-places')
  ).length;
}

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  server.events.on('request:start', ({ request }) => {
    observedHits.push(`${request.method} ${new URL(request.url).pathname}`);
  });
});

beforeEach(() => {
  observedHits = [];
  mockPush.mockClear();
  useTripWizardStore.getState().reset();
  // 담은 목록 조회는 `enabled: isAuthed` 다 — 토큰이 없으면 요청 자체가 안 나간다(BR-U1-03).
  setAccessToken('valid-access');

  // 통합 버킷은 `onUnhandledRequest: 'error'` 라 핸들러가 없으면 AC 실패가 아니라 **준비
  // 단계에서 죽는다**. must-visits 핸들러는 **호출되면 안 되는** 것을 확인하는 용도로만
  // 걸어 둔다(mustVisitHits()===0 이 그 확인) — 등록 파이프라인 자체가 폐지돼 성공/실패
  // 분기를 만들 이유가 없다.
  server.use(
    http.get(`${BASE}/saved-places`, () => HttpResponse.json(THREE)),
    http.post(`${BASE}/trips`, () => HttpResponse.json(TRIP, { status: 201 })),
    http.post(`${BASE}/trips/:tripId/must-visits`, () =>
      HttpResponse.json({}, { status: 201 })
    )
  );
});

afterEach(() => {
  server.resetHandlers();
  clearAccessToken();
});

afterAll(() => server.close());

/**
 * `gcTime: 0` — 기본값이 만드는 타이머가 테스트 종료 후에도 살아남아 Node 프로세스를 붙잡는다.
 * mutation 기본 gcTime 은 5분이라 그쪽도 0으로 둔다(TRIP-203 실측).
 * `retry: false` — 실패를 즉시 실패로 본다.
 */
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
  return render(<TripNewStep1Page baseDate={BASE_DATE} />, {
    wrapper: Wrapper,
  });
}

/** 도시 추가 시트를 열어 지역 하나를 N박으로 확정하는 3동작 묶음(승인 파일과 같은 형태). */
function addDestination(regionCode: string, nights: number): void {
  fireEvent.press(screen.getByTestId('trip-wizard-destination-add'));
  fireEvent.press(
    screen.getByTestId(`trip-wizard-destination-region-${regionCode}`)
  );
  for (let i = 1; i < nights; i += 1) {
    fireEvent.press(screen.getByTestId('trip-wizard-destination-nights-inc'));
  }
  fireEvent.press(screen.getByTestId('trip-wizard-destination-confirm'));
}

/** 정상 제출이 가능한 상태(부산 3박 + 3박 4일 = 박수 3 ≤ 기간 3). */
function fillValidDraft(): void {
  addDestination('busan', 3);
  fireEvent.press(screen.getByTestId('trip-wizard-period-preset-3n4d'));
}

function next() {
  return screen.getByTestId('trip-wizard-step1-next');
}

describe('I-1 · 조회는 나가지만 "꼭 갈 곳"은 자동으로 안 채워진다', () => {
  it('담은 곳 3건이 있어도 꼭 갈 곳은 empty 얼굴이고, 캡션은 실제 담은 개수를 보여준다', async () => {
    renderPage();

    // 캡션은 GET 응답을 그대로 반영한다 — 자동 시드와 무관하게 살아있는 조회다.
    const caption = await screen.findByTestId('trip-wizard-saved-place-count');
    expect(within(caption).getByText('담은 곳 3곳')).toBeOnTheScreen();

    // ★ 예전엔 이 자리에서 썸네일(trip-wizard-mustvisit-poi-1)이 셋 다 떴다 — 자동 시드가
    // 폐지돼 이제 담은 곳이 몇 곳이든 항상 empty 얼굴이다(사용자 결정).
    expect(
      screen.getByTestId('trip-wizard-mustvisit-empty')
    ).toBeOnTheScreen();
    expect(screen.queryByTestId('trip-wizard-mustvisit-poi-1')).toBeNull();
    expect(savedPlaceHits('GET')).toBe(1);
  });
});

describe('I-2 · 제출해도 must-visits 등록 자체가 안 나간다', () => {
  it('POST /trips 1건만 나가고 must-visits 는 0건, step2 로 이동한다', async () => {
    renderPage();
    await screen.findByTestId('trip-wizard-mustvisit-empty');

    fillValidDraft();
    fireEvent.press(next());

    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith('/trips/new/step2')
    );
    expect(createHits()).toBe(1);
    // ★ 옛 계약(BR-U1-48, 남은 시드를 한 건씩 ANYTIME 으로 등록)은 폐지됐다 — 시드를 채우는
    // 경로 자체가 없어져 등록 요청이 원천적으로 안 나간다.
    expect(mustVisitHits()).toBe(0);
    expect(mockPush).toHaveBeenCalledTimes(1);
  });
});
