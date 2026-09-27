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
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';
import type { Place, SavedPlace } from '@/shared/api/generated/schemas';
import type { MustVisitSeedItem } from '@/features/trip/model/mustVisitSeed';
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

/** 행과 "지역 밖" 머리글을 **화면 순서대로**(트리 pre-order) testID 문자열로. 순번·체크·폴백
 * testID 는 정규식 앵커(`row-` 접두 · `region-outside` 끝)에 안 걸린다. */
function orderedPickIds(): string[] {
  return screen
    .queryAllByTestId(/^mustvisit-pick-(row-|region-outside$)/)
    .map((node) => String(node.props.testID));
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

// TRIP-1012 A5 — 옛 TRIP-982 A4("부산 1행만, 경주는 숨김")는 계약이 뒤집혔다. 이제 지역 밖도
// 숨기지 않고 "이 여행 지역 밖 N곳" 머리글 아래 보인다(D9 · INV-4 — 조용히 빠지면 안 된다).
describe('🔴 TRIP-1012 A5(구 982 A4 반전) · 일부가 맞으면 맞는 것 뒤에 지역 밖을 머리글과 함께', () => {
  it('부산 여행에 부산 1곳·경주 1곳이면 부산 행 → "이 여행 지역 밖 1곳" → 경주 행 순이고 폴백 안내는 0개다', async () => {
    serveSaved([
      savedIn('p-busan', '부산광역시 해운대구', '2026-09-01T01:00:00.000Z'),
      savedIn('p-gyeongju', '경주시', '2026-09-01T02:00:00.000Z'),
    ]);
    openSelect(['부산광역시']);

    await waitFor(() =>
      expect(screen.getByTestId('mustvisit-pick-row-p-busan')).toBeOnTheScreen()
    );
    expect(orderedPickIds()).toEqual([
      'mustvisit-pick-row-p-busan',
      'mustvisit-pick-region-outside',
      'mustvisit-pick-row-p-gyeongju',
    ]);
    expect(
      screen.getByTestId('mustvisit-pick-region-outside')
    ).toHaveTextContent('이 여행 지역 밖 1곳');
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
 * 선택만** 센다. 폴백 5행에서 s2·s4 를 고른 뒤 담은 곳 목록이 바뀌어 1행(s6)만 남으면, 안 보이는
 * s2·s4 는 셋 중 어디에도 세지 않는다 — "2곳 선택됨인데 시드 0" 금지.
 *
 * TRIP-1012 재편: 지역 밖이 이제 머리글 아래 보이므로 "폴백이 풀려 1행"은 더 이상 안 보이게 되는
 * 길이 아니다(s1~s5 가 밖으로 남아 6행). 같은 계약을 **목록에서 빠진 선택**(다른 화면에서 담기를
 * 푼 경우)으로 다시 세운다 — 새 응답은 s6 한 곳뿐이다.
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

  // 다른 화면에서 s1~s5 담기를 풀고 서울 장소 1곳을 담은 효과 — 응답이 바뀌고 목록을 다시 받는다.
  rows = [SEOUL_MATCH];
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

/* ────────────────────────────────────────────────────────────────────────────
 * TRIP-1012 — '더 담기' select 는 위저드의 꼭 갈 곳을 체크된 채로 보여 주고, 지역 밖도 숨기지 않는다
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * 무엇을 보장하나(#035 · D9 · BR-U1-37 · BR-U1-04):
 *  - A1 위저드에 이미 있는 꼭 갈 곳은 select 에 **체크된 채로** 뜬다(Figma 2437:1500 — "이미 담긴"
 *    표기는 tick 자체).
 *  - A2·A3 완료는 여전히 **교체**다 — 체크를 더하면 늘고, 사용자가 명시적으로 푼 것만 빠진다.
 *  - Q1 위저드엔 있는데 담은 목록엔 없는 곳(시드 뒤 담기를 푼 곳)은 행이 없어 풀 수도 없으니
 *    **완료해도 남는다** — 볼 수 없던 것은 뺀 것으로 치지 않는다. 단 부제·완료 활성엔 세지 않는다.
 *  - A4·A6 여행 지역 밖 담은 곳은 "이 여행 지역 밖 N곳" 머리글 아래 **고를 수 있는 행**으로 뜬다
 *    (region null 은 지역 안 쪽 — fail-open 유지). 위저드 항목이면 거기서도 체크된 채다.
 *  - Q2 지역 안이 0건이면 머리글 없이 기존 폴백 한 줄 + 전체(TRIP-982 A1 무회귀).
 *  - B2 select 완료는 위저드 **안** 왕복이다 — 여행지·기간·인원·동반·예산을 비우지 않는다.
 *
 * ★ 위저드 항목은 `initMustVisits` 로 심는다 — beforeEach 가 `reset()` 하므로 첫 호출이 반영된다.
 * ★ A6 은 "완료 disabled → press 무시 → 스토어엔 준비 때 심은 j1" 이 시드 단언을 공짜로 통과시킨다.
 *   push 1회·체크 상태를 짝으로 둬 그 거짓 green 을 막는다(02a ★9).
 */

function wizardItem(
  sourcePoiId: string,
  name = `장소 ${sourcePoiId}`,
  region: string | null = null
): MustVisitSeedItem {
  return { sourcePoiId, name, imageUrl: null, region };
}

function seededIds(): string[] {
  return useTripWizardStore.getState().mustVisits.map((m) => m.sourcePoiId);
}

/** 지역 미상(null) 담은 곳 — fail-open 이라 지역 안 쪽이다. */
function savedUnknownRegion(poiId: string, savedAt: string): SavedPlace {
  return {
    savedPlaceId: `sp-${poiId}`,
    savedAt,
    place: { ...makePlace(poiId, `장소 ${poiId}`), region: null },
  };
}

describe('🔴 TRIP-1012 A1 · 위저드의 꼭 갈 곳은 체크된 채로 뜬다 (#035)', () => {
  it('위저드 p1·p2·p3 에 담은 곳도 그 셋이면 세 행 모두 체크 상태이고 부제는 3곳 · 3곳 선택됨이다', async () => {
    useTripWizardStore
      .getState()
      .initMustVisits([wizardItem('p1'), wizardItem('p2'), wizardItem('p3')]);
    serveSaved(ROWS.slice(0, 3));
    openSelect();

    await waitFor(() => expect(rowCount()).toBe(3));
    ['p1', 'p2', 'p3'].forEach((poiId) => {
      expect(
        screen.getByTestId(`mustvisit-pick-check-${poiId}`)
      ).toBeSelected();
    });
    expect(screen.getByTestId('mustvisit-pick-subtitle')).toHaveTextContent(
      '담은 곳 3곳 · 3곳 선택됨'
    );
  });
});

describe('🔴 TRIP-1012 A2 · 하나 더 체크해 완료하면 늘기만 한다 (금지: 기존 꼭 갈 곳 소실)', () => {
  it('p1~p3 체크 상태에서 p4 를 더 골라 완료하면 꼭 갈 곳은 p1~p4 네 곳이다', async () => {
    useTripWizardStore
      .getState()
      .initMustVisits([wizardItem('p1'), wizardItem('p2'), wizardItem('p3')]);
    serveSaved(ROWS.slice(0, 4));
    openSelect();
    await waitFor(() => expect(rowCount()).toBe(4));

    fireEvent.press(screen.getByTestId('mustvisit-pick-check-p4'));
    fireEvent.press(screen.getByTestId('mustvisit-pick-complete'));

    expect(seededIds().sort()).toEqual(['p1', 'p2', 'p3', 'p4']);
    expect(mockPush.mock.calls).toEqual([['/trips/new/step1']]);
  });
});

describe('🔴 TRIP-1012 A3 · 완료는 교체 — 사용자가 푼 것만 빠진다', () => {
  it('p2 체크를 풀고 완료하면 꼭 갈 곳은 p1·p3 이고 p2 는 없다', async () => {
    useTripWizardStore
      .getState()
      .initMustVisits([wizardItem('p1'), wizardItem('p2'), wizardItem('p3')]);
    serveSaved(ROWS.slice(0, 3));
    openSelect();
    await waitFor(() => expect(rowCount()).toBe(3));

    fireEvent.press(screen.getByTestId('mustvisit-pick-check-p2'));
    fireEvent.press(screen.getByTestId('mustvisit-pick-complete'));

    expect(seededIds().sort()).toEqual(['p1', 'p3']);
    // 부정 짝 — "체크 토글"이 프리필 없이 p2 를 새로 고른 것으로 도는 구현을 가른다.
    expect(seededIds().some((id) => id === 'p2')).toBe(false);
  });
});

describe('🔴 TRIP-1012 Q1 · 담은 목록에 없는 위저드 항목은 완료해도 남는다 (BR-U1-04)', () => {
  it('행이 없는 px 는 부제에 안 세지만, p3 를 더해 완료하면 p1·p2·p3·px 이고 px 이름도 그대로다', async () => {
    useTripWizardStore
      .getState()
      .initMustVisits([
        wizardItem('p1'),
        wizardItem('p2'),
        wizardItem('px', '예전에 담았던 곳', '중구'),
      ]);
    serveSaved(ROWS.slice(0, 3));
    openSelect();
    await waitFor(() => expect(rowCount()).toBe(3));

    // 앵커 — px 는 행이 없고, 보이는 선택만 센다(TRIP-982 A8 계약과 한 몸).
    expect(screen.queryAllByTestId('mustvisit-pick-row-px')).toHaveLength(0);
    expect(screen.getByTestId('mustvisit-pick-subtitle')).toHaveTextContent(
      '담은 곳 3곳 · 2곳 선택됨'
    );

    fireEvent.press(screen.getByTestId('mustvisit-pick-check-p3'));
    fireEvent.press(screen.getByTestId('mustvisit-pick-complete'));

    expect(seededIds().sort()).toEqual(['p1', 'p2', 'p3', 'px']);
    // 보존은 지어낸 값이 아니라 원래 시드 그대로다(SavedPlace 모양이 없어 다시 만들 수 없다).
    expect(
      useTripWizardStore
        .getState()
        .mustVisits.find((m) => m.sourcePoiId === 'px')?.name
    ).toBe('예전에 담았던 곳');
  });
});

/**
 * 무엇을 보장하나(03b 경고-1): Q1 의 "행이 없어 남긴다"는 **한 번도 안 보였던** 항목에만 적용된다.
 * 보일 때 사용자가 체크를 푼 항목은, 그 뒤 다른 화면(d04)에서 담기를 풀어 목록에서 사라져도
 * 완료 때 되살아나지 않는다(A3 "푼 것만 빠진다"의 연장).
 *
 * ★ 목록 재조회는 A8 과 같은 장치 — 응답 행을 바꾸고 테스트가 쥔 QueryClient 를 무효화한다.
 * ★ 앵커 두 개: ① 재조회 뒤 p2 행이 실제로 사라졌다(안 사라지면 A3 와 같은 케이스가 된다)
 *   ② 완료 직전 스토어엔 아직 p2 가 있다(완료가 안 돌면 p2 부정 단언이 공짜로 red 가 되지 않게
 *   push 1회도 짝으로 잰다).
 */
describe('🔴 TRIP-1012 Q1 경계 · 체크를 푼 뒤 목록에서 사라진 항목은 완료해도 되살아나지 않는다 (03b 경고-1)', () => {
  it('위저드 p1·p2 → p2 체크 해제 → 목록에서 p2 가 빠진 뒤 완료하면 꼭 갈 곳은 p1 하나다', async () => {
    useTripWizardStore
      .getState()
      .initMustVisits([wizardItem('p1'), wizardItem('p2')]);
    let rows: SavedPlace[] = ROWS.slice(0, 3);
    server.use(http.get(`${BASE}/saved-places`, () => HttpResponse.json(rows)));
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
        mutations: { gcTime: 0 },
      },
    });
    mockSearchParams.mode = 'select';
    setAccessToken('valid-access');
    render(
      <QueryClientProvider client={client}>
        <SavedPlacesPage />
      </QueryClientProvider>
    );
    await waitFor(() => expect(rowCount()).toBe(3));

    // ① 보일 때 p2 체크를 푼다.
    fireEvent.press(screen.getByTestId('mustvisit-pick-check-p2'));
    expect(screen.getByTestId('mustvisit-pick-subtitle')).toHaveTextContent(
      '담은 곳 3곳 · 1곳 선택됨'
    );

    // ② d04 에서 p2 담기를 푼 효과 — 응답에서 p2 가 빠지고 목록을 다시 받는다.
    rows = [ROWS[0], ROWS[2]];
    await act(async () => {
      await client.invalidateQueries();
    });
    await waitFor(() => expect(rowCount()).toBe(2));
    expect(screen.queryAllByTestId('mustvisit-pick-row-p2')).toHaveLength(0);
    // 완료 전 — 스토어엔 아직 p2 가 있다(이 단계에서 빠진다면 완료를 검사한 게 아니다).
    expect(seededIds().includes('p2')).toBe(true);

    // ③ 완료.
    fireEvent.press(screen.getByTestId('mustvisit-pick-complete'));

    expect(mockPush.mock.calls).toEqual([['/trips/new/step1']]);
    expect(seededIds()).toEqual(['p1']);
  });
});

/** 서울 여행 — 지역 안(null)·밖(종로구)이 savedAt 으로 섞여 있다(j1 → n1 → j2). */
const SEOUL_MIXED: SavedPlace[] = [
  savedIn('j1', '종로구', '2026-09-01T01:00:00.000Z'),
  savedUnknownRegion('n1', '2026-09-01T02:00:00.000Z'),
  savedIn('j2', '종로구', '2026-09-01T03:00:00.000Z'),
];

describe('🔴 TRIP-1012 A4 · 지역 밖도 숨기지 않고 머리글 아래 고를 수 있게 (금지: 조용한 누락)', () => {
  it('서울 여행에 종로구 2곳·지역 미상 1곳이면 3곳 모두 뜨고, 종로구 2곳은 "이 여행 지역 밖 2곳" 아래다', async () => {
    serveSaved(SEOUL_MIXED);
    openSelect(['서울특별시']);

    await waitFor(() => expect(rowCount()).toBe(3));
    // 순서 — 지역 안(n1) → 머리글 → 밖(j1·j2). 정렬만 하고 다시 모으지 않으면 n1 이 머리글 뒤로 샌다.
    expect(orderedPickIds()).toEqual([
      'mustvisit-pick-row-n1',
      'mustvisit-pick-region-outside',
      'mustvisit-pick-row-j1',
      'mustvisit-pick-row-j2',
    ]);
    expect(
      screen.getByTestId('mustvisit-pick-region-outside')
    ).toHaveTextContent('이 여행 지역 밖 2곳');
    expect(fallbackCount()).toBe(0);
    // 순번은 보이는 순서대로 이어 매긴다(01b Q2).
    [
      ['n1', '1'],
      ['j1', '2'],
      ['j2', '3'],
    ].forEach(([poiId, rank]) => {
      expect(
        within(screen.getByTestId(`mustvisit-pick-rank-${poiId}`)).getByText(
          rank
        )
      ).toBeOnTheScreen();
    });
    // 부제 N 은 보이는 전체(안+밖).
    expect(screen.getByTestId('mustvisit-pick-subtitle')).toHaveTextContent(
      '담은 곳 3곳 · 0곳 선택됨'
    );

    // 밖 행도 고를 수 있고, 고른 것이 실제로 심긴다.
    fireEvent.press(screen.getByTestId('mustvisit-pick-check-j1'));
    fireEvent.press(screen.getByTestId('mustvisit-pick-complete'));
    expect(seededIds()).toEqual(['j1']);
  });
});

describe('🔴 TRIP-1012 A6 · 지역 밖에 있는 위저드 항목도 체크된 채로 뜨고 남는다', () => {
  it('위저드 j1(종로구)은 머리글 아래 체크 상태로 뜨고, 그대로 완료하면 j1 이 남는다', async () => {
    useTripWizardStore
      .getState()
      .initMustVisits([wizardItem('j1', '장소 j1', '종로구')]);
    serveSaved([
      savedIn('j1', '종로구', '2026-09-01T01:00:00.000Z'),
      savedIn('s-in', '서울특별시 마포구', '2026-09-01T02:00:00.000Z'),
    ]);
    openSelect(['서울특별시']);

    await waitFor(() => expect(rowCount()).toBe(2));
    expect(orderedPickIds()).toEqual([
      'mustvisit-pick-row-s-in',
      'mustvisit-pick-region-outside',
      'mustvisit-pick-row-j1',
    ]);
    expect(screen.getByTestId('mustvisit-pick-check-j1')).toBeSelected();
    expect(screen.getByTestId('mustvisit-pick-subtitle')).toHaveTextContent(
      '담은 곳 2곳 · 1곳 선택됨'
    );

    fireEvent.press(screen.getByTestId('mustvisit-pick-complete'));

    // 짝 — 완료가 실제로 눌렸다(disabled 로 무시되면 준비 때 심은 j1 이 공짜로 남는다, ★9).
    expect(mockPush.mock.calls).toEqual([['/trips/new/step1']]);
    expect(seededIds()).toEqual(['j1']);
  });
});

describe('🔴 TRIP-1012 A7 · 지역 밖 머리글 화면에도 소요시간 표기가 없다 (INV-3)', () => {
  it('머리글이 뜬 화면에서 분·시간·소요 표기가 0건이다', async () => {
    serveSaved(SEOUL_MIXED);
    openSelect(['서울특별시']);

    await waitFor(() =>
      expect(
        screen.getByTestId('mustvisit-pick-region-outside')
      ).toBeOnTheScreen()
    );
    // 긍정 앵커 — 정규식이 이 화면의 새 글자를 실제로 읽는다.
    expect(screen.queryAllByText(/지역 밖/).length).toBeGreaterThan(0);
    expect(screen.queryAllByText(/\d+\s*분|\d+\s*시간|소요/).length).toBe(0);
  });
});

describe('TRIP-1012 Q2 · 지역 안이 0건이면 머리글 없이 기존 폴백 그대로 (TRIP-982 A1 무회귀)', () => {
  it('서울 여행에 담은 곳이 전부 시군구면 폴백 한 줄 + 5행이고 "지역 밖" 머리글은 0개다', async () => {
    serveSaved(SEOUL_QA);
    openSelect(['서울특별시']);

    await waitFor(() => expect(rowCount()).toBe(5));
    expect(
      screen.getByTestId('mustvisit-pick-region-fallback')
    ).toHaveTextContent(REGION_FALLBACK_TEXT);
    expect(
      screen.queryAllByTestId('mustvisit-pick-region-outside')
    ).toHaveLength(0);
  });
});

describe('TRIP-1012 B2 · select 완료는 위저드 안 왕복 — 손으로 채운 드래프트를 비우지 않는다 (#074 금지)', () => {
  it('여행지·기간·인원·동반·예산이 완료 전과 같고, 꼭 갈 곳만 고른 것으로 바뀐다', async () => {
    const store = useTripWizardStore.getState();
    store.addDestination('부산', 2);
    store.setPeriod('3n4d', '2026-10-10', '2026-10-13');
    store.setParty(2);
    store.selectCompanion('친구');
    store.setBudgetText('300,000');
    const typedDraft = () => {
      const s = useTripWizardStore.getState();
      return {
        destinations: s.destinations,
        startDate: s.startDate,
        endDate: s.endDate,
        party: s.party,
        companionType: s.companionType,
        budgetText: s.budgetText,
      };
    };
    const before = typedDraft();
    // 앵커 — 준비가 실제로 들어갔다(초기값이면 "안 지웠다"가 공허해진다).
    expect(before.destinations).toHaveLength(1);

    await renderSelectLoaded();
    fireEvent.press(screen.getByTestId('mustvisit-pick-check-p1'));
    fireEvent.press(screen.getByTestId('mustvisit-pick-complete'));

    expect(typedDraft()).toEqual(before);
    expect(seededIds()).toEqual(['p1']);
  });
});
