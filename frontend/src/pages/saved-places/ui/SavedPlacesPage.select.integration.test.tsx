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
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';
import type { Place, SavedPlace } from '@/shared/api/generated/schemas';
import { useTripWizardStore } from '@/features/trip/model/tripWizardStore';

import { SavedPlacesPage } from './SavedPlacesPage';

/**
 * TRIP-706 [d02] select 모드 **배선** — `SavedPlacesPage`(save 무접촉·별 파일, 게이트① 무개봉).
 *
 * 무엇을 보장하나:
 *  - **IS-1 (AC-3)** `?mode=select` 면 select 화면(체크 토글), mode 없으면 기존 save 화면(하트).
 *    `useLocalSearchParams().mode` 로 갈린다.
 *  - **IS-2 (AC-1 · TRIP-491 재현)** 6곳 중 3곳만 골라 완료하면 **선택한 3곳만** 위저드 스토어에
 *    시드된다(미선택 3곳은 빠짐). 전부 시드가 아님을 부정 짝으로 잠근다 — 이것이 TRIP-491 급소다.
 *  - **IS-3 (AC-2)** 선택 0곳이면 완료가 disabled — 눌러도 시드·네비 콜백이 0회다(빈 시드 진입 방지).
 *
 * 왜 통합 버킷인가: 심판 대상이 "**실제로 심긴 시드**"(`useTripWizardStore.getState().mustVisits`)와
 * mode 분기다. 페이지가 선택 집합을 소유(D2)하고 완료 시 `seedMustVisitsFromD02(seedMustVisits(선택분))`
 * 로 심는다 — save-mode CTA(`onPressCreateTrip`) 선례와 동형(`SavedPlacesPage.tsx`).
 *
 * ★ No QueryClient 함정(traps-explore): `useSavedPlaces`(react-query)를 물어 `QueryClientProvider`
 *   래퍼 필수. select 화면 자체는 props-only 라 그 화면 테스트는 래퍼가 필요 없다(별 파일, 02a §4-5).
 * ★ 선택/미선택은 색 fill 이 아니라 체크 press→선택 반영으로 관측 — 시드 내용이 최종 증거다.
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

// 딥링크 파라미터를 테스트가 갈아 끼우는 창구 — `mock` 접두라 jest.mock 팩토리에서 참조 가능.
const mockSearchParams: { mode?: string; region?: string | string[] } = {};

// ★ router.push 를 화살표로 감싸 지연 참조(hoist 함정 회피, 기존 통합테스트 ★16 선례).
jest.mock('expo-router', () => ({
  router: {
    push: (href: string) => mockPush(href),
    back: () => mockBack(),
  },
  useRouter: () => ({ push: mockPush, back: mockBack }),
  useLocalSearchParams: () => ({ ...mockSearchParams }),
}));

const BASE = 'http://localhost:8080/api/v1';

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
    tags: ['골목'],
    savedCount: 4,
    dataStatus: 'ACTIVE',
  };
}

/** 6곳 — savedAt 오름차순이라 정렬 순 p1..p6. */
const ROWS: SavedPlace[] = [
  {
    savedPlaceId: 'sp-1',
    savedAt: '2026-08-01T01:00:00.000Z',
    place: makePlace('p1', '감천문화마을'),
  },
  {
    savedPlaceId: 'sp-2',
    savedAt: '2026-08-01T02:00:00.000Z',
    place: makePlace('p2', '광안리 해변'),
  },
  {
    savedPlaceId: 'sp-3',
    savedAt: '2026-08-01T03:00:00.000Z',
    place: makePlace('p3', '전포 카페거리'),
  },
  {
    savedPlaceId: 'sp-4',
    savedAt: '2026-08-01T04:00:00.000Z',
    place: makePlace('p4', '해운대 해변'),
  },
  {
    savedPlaceId: 'sp-5',
    savedAt: '2026-08-01T05:00:00.000Z',
    place: makePlace('p5', '해동용궁사'),
  },
  {
    savedPlaceId: 'sp-6',
    savedAt: '2026-08-01T06:00:00.000Z',
    place: makePlace('p6', '자갈치 시장'),
  },
];

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

beforeEach(() => {
  mockPush.mockClear();
  mockBack.mockClear();
  delete mockSearchParams.mode;
  delete mockSearchParams.region;
  clearAccessToken();
  useTripWizardStore.getState().reset();
  server.use(http.get(`${BASE}/saved-places`, () => HttpResponse.json(ROWS)));
});

afterEach(() => server.resetHandlers());
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
  return render(<SavedPlacesPage />, { wrapper: createWrapper() });
}

/** select 6행이 그려진 상태까지 만든다. */
async function renderSelectLoaded() {
  mockSearchParams.mode = 'select';
  setAccessToken('valid-access');
  renderPage();
  await waitFor(() =>
    expect(screen.getByTestId('mustvisit-pick-row-p1')).toBeOnTheScreen()
  );
}

describe('IS-1 · mode 파라미터로 화면이 갈린다 (AC-3)', () => {
  it('?mode=select 면 select 화면(체크 토글)을 그린다', async () => {
    await renderSelectLoaded();

    expect(screen.getByTestId('mustvisit-pick-root')).toBeOnTheScreen();
    // 여행 만들기 CTA(save 화면 것)는 없다 — 두 화면은 별개다.
    expect(screen.queryByTestId('explore-saved-createtrip')).toBeNull();
  });

  it('mode 가 없으면 기존 save 화면(하트 목록)을 그린다', async () => {
    // mode 미설정(beforeEach 가 지움) = save 모드.
    setAccessToken('valid-access');
    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId('explore-saved-item-sp-1')).toBeOnTheScreen()
    );
    expect(screen.queryByTestId('mustvisit-pick-root')).toBeNull();
  });
});

describe('IS-2 · 선택한 곳만 시드된다 (AC-1 · TRIP-491 재현)', () => {
  it('6곳 중 3곳만 골라 완료하면 그 3곳만 위저드 스토어에 들어간다', async () => {
    await renderSelectLoaded();
    await waitFor(() =>
      expect(screen.getAllByTestId(/^mustvisit-pick-row-/)).toHaveLength(6)
    );

    // 흩어서 3곳 선택(1·3·5번).
    fireEvent.press(screen.getByTestId('mustvisit-pick-check-p1'));
    fireEvent.press(screen.getByTestId('mustvisit-pick-check-p3'));
    fireEvent.press(screen.getByTestId('mustvisit-pick-check-p5'));

    fireEvent.press(screen.getByTestId('mustvisit-pick-complete'));

    const state = useTripWizardStore.getState();
    // 긍정 — 선택한 3곳이 시드로 들어갔다.
    expect(state.mustVisits.map((m) => m.sourcePoiId).sort()).toEqual([
      'p1',
      'p3',
      'p5',
    ]);
    // ★ 부정 짝(TRIP-491 급소) — 미선택 3곳은 안 들어간다. 이 짝이 없으면 "전부 시드"(버그)도 통과한다.
    ['p2', 'p4', 'p6'].forEach((poiId) => {
      expect(state.mustVisits.some((m) => m.sourcePoiId === poiId)).toBe(false);
    });
    // 위저드로 이동.
    expect(mockPush).toHaveBeenCalledWith('/trips/new/step1');
  });
});

describe('IS-3 · 0곳 완료는 무효 (AC-2)', () => {
  it('아무것도 안 고르면 완료가 disabled — 시드·네비 콜백이 0회다', async () => {
    await renderSelectLoaded();
    await waitFor(() =>
      expect(screen.getAllByTestId(/^mustvisit-pick-row-/)).toHaveLength(6)
    );

    const complete = screen.getByTestId('mustvisit-pick-complete');
    expect(complete).toBeDisabled();

    fireEvent.press(complete);

    // 빈 시드로 위저드에 진입하지 않는다 — 시드 0회 + 네비 0회.
    expect(useTripWizardStore.getState().mustVisits).toEqual([]);
    expect(mockPush).not.toHaveBeenCalled();
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * TRIP-982 A — 여행 지역 필터가 0건이면 전체를 보여 주고 그 사실을 밝힌다 (D6 · INV-4)
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * 무엇을 보장하나: 위저드 '더 담기'로 온 select 화면에서, 담은 곳이 있는데 지역 필터 때문에 0건이
 * 되면 필터를 풀고 **전체를 고를 수 있게** 보여 주며 "여행 지역과 맞는 곳이 없어 전체를
 * 보여드려요"라고 알린다. "아직 담은 곳이 없어요"는 진짜로 0곳일 때만 나온다.
 *
 * 왜 이 픽스처인가: 여행 region 은 시도 이름(`서울특별시`)인데 담은 곳의 region 은 시군구
 * 이름(`강남구`)이라 접두사 비교가 전부 빗나간다 — QA DB 실측 5행을 그대로 옮겼다.
 *
 * ★ 급소는 A2 다 — 화면은 전체를 그리면서 완료 쪽이 필터된 목록(0건)을 보면, 체크는 되는데
 *   시드가 0개인 침묵 실패가 된다. 흩어서 두 곳(s2·s4)을 골라 "정확히 그 둘"만 심겼는지 잰다.
 * ★ 부재 단언(폴백 안내 0개)은 로딩이 끝난 뒤에만 잰다 — 로딩 중엔 무엇이든 0개라 공허하다.
 */

const REGION_FALLBACK_TEXT = '여행 지역과 맞는 곳이 없어 전체를 보여드려요';
const TRUE_EMPTY_TITLE = '아직 담은 곳이 없어요';

function placeIn(poiId: string, region: string): Place {
  return { ...makePlace(poiId, `장소 ${poiId}`), region };
}

function savedIn(poiId: string, region: string, savedAt: string): SavedPlace {
  return {
    savedPlaceId: `sp-${poiId}`,
    savedAt,
    place: placeIn(poiId, region),
  };
}

/** QA DB 실측 — 서울 여행인데 담은 곳 region 은 전부 시군구 이름. savedAt 오름차순이라 s1..s5 순. */
const SEOUL_QA: SavedPlace[] = [
  savedIn('s1', '강남구', '2026-09-01T01:00:00.000Z'),
  savedIn('s2', '강남구', '2026-09-01T02:00:00.000Z'),
  savedIn('s3', '연천군', '2026-09-01T03:00:00.000Z'),
  savedIn('s4', '종로구', '2026-09-01T04:00:00.000Z'),
  savedIn('s5', '송파구', '2026-09-01T05:00:00.000Z'),
];

/** 담은 곳 응답을 이 케이스 것으로 갈아 끼운다(beforeEach 기본 6행 핸들러보다 먼저 매칭된다). */
function serveSaved(rows: SavedPlace[]): void {
  server.use(http.get(`${BASE}/saved-places`, () => HttpResponse.json(rows)));
}

function openSelect(region?: string[]): void {
  mockSearchParams.mode = 'select';
  if (region) mockSearchParams.region = region;
  setAccessToken('valid-access');
  renderPage();
}

function rowCount(): number {
  return screen.queryAllByTestId(/^mustvisit-pick-row-/).length;
}

function fallbackCount(): number {
  return screen.queryAllByTestId('mustvisit-pick-region-fallback').length;
}

describe('🔴 TRIP-982 A1 · 지역이 전혀 안 맞으면 전체를 보여 주고 알린다 (D6)', () => {
  it('담은 5곳이 전부 행으로 뜨고, 폴백 안내가 정확한 문구로 뜨며, 빈 얼굴은 없다', async () => {
    serveSaved(SEOUL_QA);
    openSelect(['서울특별시']);

    await waitFor(() => expect(rowCount()).toBe(5));
    // 폴백 안내 — 문구 완전일치(D6 고정 문구).
    expect(
      screen.getByTestId('mustvisit-pick-region-fallback')
    ).toHaveTextContent(REGION_FALLBACK_TEXT);
    // 진짜 빈 얼굴은 안 뜬다.
    expect(screen.queryAllByTestId('mustvisit-pick-empty').length).toBe(0);
    // 부제의 N 은 그려진 전체 개수(01b Q2).
    expect(screen.getByTestId('mustvisit-pick-subtitle')).toHaveTextContent(
      '담은 곳 5곳 · 0곳 선택됨'
    );
  });
});

describe('🔴 TRIP-982 A2 · 폴백 목록에서 고른 곳이 실제로 시드된다 (급소)', () => {
  it('5곳 중 s2·s4 를 골라 완료하면 위저드 스토어에 정확히 그 둘만 들어간다', async () => {
    serveSaved(SEOUL_QA);
    openSelect(['서울특별시']);
    await waitFor(() => expect(rowCount()).toBe(5));

    fireEvent.press(screen.getByTestId('mustvisit-pick-check-s2'));
    fireEvent.press(screen.getByTestId('mustvisit-pick-check-s4'));
    fireEvent.press(screen.getByTestId('mustvisit-pick-complete'));

    // 0개(필터된 목록에서 뽑음)도 5개(전부 시드)도 아닌 정확히 고른 둘.
    expect(
      useTripWizardStore
        .getState()
        .mustVisits.map((m) => m.sourcePoiId)
        .sort()
    ).toEqual(['s2', 's4']);
    expect(mockPush).toHaveBeenCalledWith('/trips/new/step1');
  });
});

describe('🔴 TRIP-982 A3 · 담은 곳이 있으면 "없다"고 말하지 않는다 (INV-4)', () => {
  it('로딩이 끝난 뒤 "아직 담은 곳이 없어요"가 0회이고 빈 얼굴도 없다', async () => {
    serveSaved(SEOUL_QA);
    openSelect(['서울특별시']);

    // 행이 아니라 "로딩 끝"을 기다린다 — 구현 전에도 이 대기는 풀리고, 아래 단언이 red 이유가 된다.
    await waitFor(() =>
      expect(
        screen.queryAllByTestId(/^mustvisit-pick-skeleton-row-/).length
      ).toBe(0)
    );
    expect(screen.queryAllByText(TRUE_EMPTY_TITLE).length).toBe(0);
    expect(screen.queryAllByTestId('mustvisit-pick-empty').length).toBe(0);
  });
});

describe('TRIP-982 A4 · 무회귀 — 일부가 맞으면 맞는 것만, 안내는 없다', () => {
  it('부산 여행에 부산 1곳·경주 1곳이면 부산 1행만 뜨고 폴백 안내는 0개다', async () => {
    serveSaved([
      savedIn('p-busan', '부산광역시 해운대구', '2026-09-01T01:00:00.000Z'),
      savedIn('p-gyeongju', '경주시', '2026-09-01T02:00:00.000Z'),
    ]);
    openSelect(['부산광역시']);

    await waitFor(() =>
      expect(screen.getByTestId('mustvisit-pick-row-p-busan')).toBeOnTheScreen()
    );
    expect(rowCount()).toBe(1);
    expect(
      screen.queryAllByTestId('mustvisit-pick-row-p-gyeongju').length
    ).toBe(0);
    expect(fallbackCount()).toBe(0);
  });
});

describe('TRIP-982 A5 · 무회귀 — 진짜로 0곳이면 빈 얼굴 그대로', () => {
  it('담은 곳이 0이면 "아직 담은 곳이 없어요"와 둘러보기가 뜨고 폴백 안내는 0개다', async () => {
    serveSaved([]);
    openSelect(['서울특별시']);

    await waitFor(() =>
      expect(screen.getByTestId('mustvisit-pick-empty')).toBeOnTheScreen()
    );
    expect(screen.getByTestId('mustvisit-pick-browse')).toBeOnTheScreen();
    expect(screen.queryAllByText(TRUE_EMPTY_TITLE).length).toBe(1);
    expect(fallbackCount()).toBe(0);
  });
});

describe('TRIP-982 A6 · 무회귀 — region 이 없으면 무필터, 안내도 없다', () => {
  it('region 파라미터 없이 오면 5곳 전부 뜨고 폴백 안내는 0개다', async () => {
    serveSaved(SEOUL_QA);
    openSelect();

    await waitFor(() => expect(rowCount()).toBe(5));
    expect(fallbackCount()).toBe(0);
  });
});

describe('🔴 TRIP-982 A-INV3 · 폴백 화면에도 소요시간 표기가 없다 (INV-3)', () => {
  it('폴백 안내가 뜬 화면에서 분·시간·소요 표기가 0건이다', async () => {
    serveSaved(SEOUL_QA);
    openSelect(['서울특별시']);

    await waitFor(() =>
      expect(
        screen.getByTestId('mustvisit-pick-region-fallback')
      ).toBeOnTheScreen()
    );
    // 긍정 앵커 — 정규식 탐색이 이 화면의 글자를 실제로 읽는다(부제 `담은 곳 5곳 · …`).
    expect(screen.queryAllByText(/담은 곳/).length).toBeGreaterThan(0);
    expect(screen.queryAllByText(/\d+\s*분|\d+\s*시간|소요/).length).toBe(0);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * TRIP-982 A8 — 폴백이 조작 도중에 풀려도 선택 수·완료·시드가 서로 맞는다 (5-b 경고-1)
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * 무엇을 보장하나: 부제의 `N곳 선택됨`, 완료 버튼 활성, 완료 때 심는 시드는 **지금 보이는 행 안의
 * 선택만** 센다. 폴백 5행에서 s2·s4 를 고른 뒤 담은 곳 목록이 바뀌어 폴백이 풀리고 1행(s6)만
 * 남으면, 안 보이는 s2·s4 는 셋 중 어디에도 세지 않는다 — "2곳 선택됨인데 시드 0" 금지.
 *
 * 왜 QueryClient 를 손에 쥐나: '더 담기'에서 돌아오면 담기 뮤테이션의 `invalidateQueries` 가
 * 목록을 다시 받는다. 테스트는 그 효과만 재현한다 — 응답 행을 바꾸고 캐시를 무효화한다.
 *
 * ★ 전제 단언(1행·폴백 안내 0개)을 먼저 잰다 — 재조회가 안 일어나면 화면은 5행 그대로라
 *   아래 단언이 엉뚱한 이유로 red/green 이 된다.
 */

/** 여행 region 과 접두사로 맞는 새 담은 곳 — 필터 결과를 1건으로 만들어 폴백을 푼다. */
const SEOUL_MATCH = savedIn(
  's6',
  '서울특별시 마포구',
  '2026-09-01T06:00:00.000Z'
);

/** 폴백 5행에서 s2·s4 를 고른 뒤, 목록이 바뀌어 폴백이 풀린(s6 1행) 상태까지 만든다. */
async function arrangeFallbackLiftedWithHiddenPicks(): Promise<void> {
  let rows: SavedPlace[] = SEOUL_QA;
  server.use(http.get(`${BASE}/saved-places`, () => HttpResponse.json(rows)));
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { gcTime: 0 },
    },
  });
  mockSearchParams.mode = 'select';
  mockSearchParams.region = ['서울특별시'];
  setAccessToken('valid-access');
  render(
    <QueryClientProvider client={client}>
      <SavedPlacesPage />
    </QueryClientProvider>
  );
  await waitFor(() => expect(rowCount()).toBe(5));
  expect(fallbackCount()).toBe(1);

  fireEvent.press(screen.getByTestId('mustvisit-pick-check-s2'));
  fireEvent.press(screen.getByTestId('mustvisit-pick-check-s4'));

  // '더 담기'에서 서울 장소 1곳을 담고 돌아온 효과 — 응답이 바뀌고 목록을 다시 받는다.
  rows = [...SEOUL_QA, SEOUL_MATCH];
  await act(async () => {
    await client.invalidateQueries();
  });

  // 전제 — 폴백이 풀려 s6 1행만 보이고 안내가 사라졌다.
  await waitFor(() => expect(rowCount()).toBe(1));
  expect(screen.getByTestId('mustvisit-pick-row-s6')).toBeOnTheScreen();
  expect(fallbackCount()).toBe(0);
}

describe('🔴 TRIP-982 A8 · 폴백이 풀리면 안 보이는 선택은 세지 않는다 (경고-1)', () => {
  it('보이는 선택이 0이면 부제 0곳·완료 disabled·눌러도 시드 0·이동 0이다', async () => {
    await arrangeFallbackLiftedWithHiddenPicks();

    expect(screen.getByTestId('mustvisit-pick-subtitle')).toHaveTextContent(
      '담은 곳 1곳 · 0곳 선택됨'
    );
    const complete = screen.getByTestId('mustvisit-pick-complete');
    expect(complete).toBeDisabled();

    fireEvent.press(complete);

    expect(useTripWizardStore.getState().mustVisits.length).toBe(0);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('보이는 s6 을 고르면 부제 1곳·완료 활성·시드는 정확히 s6 하나다', async () => {
    await arrangeFallbackLiftedWithHiddenPicks();

    fireEvent.press(screen.getByTestId('mustvisit-pick-check-s6'));

    expect(screen.getByTestId('mustvisit-pick-subtitle')).toHaveTextContent(
      '담은 곳 1곳 · 1곳 선택됨'
    );
    const complete = screen.getByTestId('mustvisit-pick-complete');
    expect(complete).not.toBeDisabled();

    fireEvent.press(complete);

    // 부제가 센 1곳과 같은 1곳 — 안 보이는 s2·s4 가 딸려 들어가지 않는다.
    expect(
      useTripWizardStore.getState().mustVisits.map((m) => m.sourcePoiId)
    ).toEqual(['s6']);
    expect(mockPush).toHaveBeenCalledWith('/trips/new/step1');
  });
});
