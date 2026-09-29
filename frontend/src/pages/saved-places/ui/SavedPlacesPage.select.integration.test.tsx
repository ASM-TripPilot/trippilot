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
import type { Place, Region, SavedPlace } from '@/shared/api/generated/schemas';
import { RegionLevel } from '@/shared/api/generated/schemas';
import type { MustVisitSeedItem } from '@/features/trip/model/mustVisitSeed';
import { useTripWizardStore } from '@/features/trip/model/tripWizardStore';
import { wizardOriginParams } from '@/features/explore/model/wizardOrigin';

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
 * 여행 지역 판정 공용 도우미 (TRIP-982 → TRIP-1012 → TRIP-1042)
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * TRIP-1042 로 판정이 **이름 접두사 → 행정구역 코드 접두사**로 바뀌었다(BR-U1-58 · INV-U1-21). 지역 안이
 * 0건이면 전체로 되돌리던 폴백(TRIP-982 D6)은 없어졌고, 그 자리를 region-empty 블록이 대신한다. 폴백을
 * 굳히던 옛 케이스(982 A1·A2·A3·A-INV3 · 1012 Q2)는 계약째 지웠다 — 대체는 아래 TRIP-1042 절.
 *
 * `savedIn`(이름만, 코드 없음) 픽스처는 지금 판정에선 전부 fail-open 이라 지역 안이다. 지역 안/밖을
 * 가르는 케이스는 `savedCoded`(코드를 싣는다) + `openSelectForTrip`(스토어에 목적지 코드)을 쓴다.
 */

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

/** 코드를 실은 담은 곳(TRIP-1042) — region 은 시군구 이름으로 둬 이름 비교로는 안 갈리게 한다(02a ★15). */
function savedCoded(
  poiId: string,
  region: string | null,
  regionCode: string | null,
  savedAt: string
): SavedPlace {
  return {
    savedPlaceId: `sp-${poiId}`,
    savedAt,
    place: { ...makePlace(poiId, `장소 ${poiId}`), region, regionCode },
  };
}

type TripDest = { region: string; regionCode?: string };

/**
 * 여행 목적지를 **스토어와 URL 에 같은 값으로** 심고 select 로 연다(02a ★1·★3). 코드는 스토어에만 있다
 * (1/4 는 URL 에 이름만 싣는다) — `setState` 는 부분 병합이라 나머지 드래프트는 그대로다.
 */
function openSelectForTrip(dests: TripDest[]): void {
  useTripWizardStore.setState({
    destinations: dests.map((dest, index) => ({
      seq: index + 1,
      region: dest.region,
      nights: 1,
      ...(dest.regionCode ? { regionCode: dest.regionCode } : {}),
    })),
  });
  openSelect(dests.map((dest) => dest.region));
}

const SEOUL_TRIP: TripDest[] = [{ region: '서울특별시', regionCode: '11' }];

function checkCount(): number {
  return screen.queryAllByTestId(/^mustvisit-pick-check-(?!filled-|outline-)/)
    .length;
}

// TRIP-1012 A5 — 옛 TRIP-982 A4("부산 1행만, 경주는 숨김")는 계약이 뒤집혔다. 지역 밖도 숨기지 않고
// "이 여행 지역 밖 N곳" 머리글 아래 보인다(D9 · INV-4). TRIP-1042: 판정 근거가 코드로 바뀌어 픽스처도 코드판.
describe('🔴 TRIP-1012 A5(구 982 A4 반전) · 일부가 맞으면 맞는 것 뒤에 지역 밖을 머리글과 함께', () => {
  it('부산(26) 여행에 해운대구(26350)·경주시(47130)면 해운대구 행 → "이 여행 지역 밖 1곳" → 경주시 행 순이고 폴백 안내는 0개다', async () => {
    serveSaved([
      savedCoded('p-busan', '해운대구', '26350', '2026-09-01T01:00:00.000Z'),
      savedCoded('p-gyeongju', '경주시', '47130', '2026-09-01T02:00:00.000Z'),
    ]);
    openSelectForTrip([{ region: '부산광역시', regionCode: '26' }]);

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
 * ★ 전제 단언(1행)을 먼저 잰다 — 재조회가 안 일어나면 화면은 5행 그대로라
 *   아래 단언이 엉뚱한 이유로 red/green 이 된다.
 * ★ TRIP-1042: 폴백이 없어졌다. 스토어에 목적지 코드가 없으면 판정을 건너뛰어(01b Q6) 5행이 모두 고를
 *   수 있는 행으로 뜬다 — "보이는 선택만 센다" 계약은 그대로라 준비 함수의 폴백 단언 두 줄만 뺐다.
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
 *  - A4·A6 여행 지역 밖 담은 곳은 "이 여행 지역 밖 N곳" 머리글 아래 뜨되 **흐리고 고를 수 없다**
 *    (TRIP-1042 AC-2 · BR-U1-58 ② 로 뒤집힘). 코드 null 은 지역 안 쪽(fail-open 유지). 위저드에 이미 있던
 *    밖 항목은 **채운 체크로 보이고 부제에 세며**, 완료하면 확인 다이얼로그가 뜬다 — [그대로 넣기]면
 *    남는다(TRIP-1106 · 조용히 빼지도 조용히 넣지도 않는다, INV-4).
 *  - (옛 Q2 "지역 안 0건이면 폴백"은 TRIP-1042 로 폐지 — region-empty 는 아래 TRIP-1042 절.)
 *  - B2 select 완료는 위저드 **안** 왕복이다 — 여행지·기간·인원·동반·예산을 비우지 않는다.
 *
 * ★ 위저드 항목은 `initMustVisits` 로 심는다 — beforeEach 가 `reset()` 하므로 첫 호출이 반영된다.
 * ★ A6 은 "완료가 안 돌았는데 스토어엔 준비 때 심은 j1" 이 시드 단언을 공짜로 통과시킨다.
 *   다이얼로그 존재·push 1회를 짝으로 둬 그 거짓 green 을 막는다(02a ★9 · TRIP-1106 02a ★8).
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

/** 서울(11) 여행 — 지역 안(코드 null)·밖(해운대구 26350)이 savedAt 으로 섞여 있다(j1 → n1 → j2). */
const SEOUL_MIXED: SavedPlace[] = [
  savedCoded('j1', '해운대구', '26350', '2026-09-01T01:00:00.000Z'),
  savedCoded('n1', null, null, '2026-09-01T02:00:00.000Z'),
  savedCoded('j2', '해운대구', '26350', '2026-09-01T03:00:00.000Z'),
];

describe('🔴 TRIP-1012 A4 → TRIP-1042 AC-2·3 · 지역 밖은 숨기지 않되 흐리고 고를 수 없다 (금지: 조용한 누락)', () => {
  it('서울 여행에 해운대구 2곳·코드 모름 1곳이면 3곳 모두 뜨고, 해운대구 2곳은 머리글 아래 체크 없이 disabled 다', async () => {
    serveSaved(SEOUL_MIXED);
    openSelectForTrip(SEOUL_TRIP);

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
    // 순번은 지역 안 행에만 있다(TRIP-1106 결정 1-A — 밖 행 순번이 "선택 번호"로 읽혔다).
    expect(
      within(screen.getByTestId('mustvisit-pick-rank-n1')).getByText('1')
    ).toBeOnTheScreen();
    ['j1', 'j2'].forEach((poiId) => {
      expect(screen.queryByTestId(`mustvisit-pick-rank-${poiId}`)).toBeNull();
    });
    // 부제 N 은 보이는 전체(안+밖).
    expect(screen.getByTestId('mustvisit-pick-subtitle')).toHaveTextContent(
      '담은 곳 3곳 · 0곳 선택됨'
    );

    // AC-3 — 코드 모름(n1)은 지역 안이라 고를 수 있다(긍정 짝).
    expect(screen.getByTestId('mustvisit-pick-check-n1')).toBeOnTheScreen();
    // AC-2 — 밖 행엔 체크가 없고 행이 disabled 다(02a ★7 세 겹 중 (a)(b)).
    ['j1', 'j2'].forEach((poiId) => {
      expect(screen.queryByTestId(`mustvisit-pick-check-${poiId}`)).toBeNull();
      expect(screen.getByTestId(`mustvisit-pick-row-${poiId}`)).toBeDisabled();
    });

    // (c) 밖 행을 눌러도 선택이 늘지 않고, 완료는 닫힌 채 눌러도 시드·이동이 없다.
    fireEvent.press(screen.getByTestId('mustvisit-pick-row-j1'));
    expect(screen.getByTestId('mustvisit-pick-subtitle')).toHaveTextContent(
      '담은 곳 3곳 · 0곳 선택됨'
    );
    const complete = screen.getByTestId('mustvisit-pick-complete');
    expect(complete).toBeDisabled();
    fireEvent.press(complete);
    expect(seededIds()).toEqual([]);
    expect(mockPush).not.toHaveBeenCalled();
  });
});

// TRIP-1106 으로 뒤집혔다 — 옛 계약("체크 없이 보이고 부제 0곳, 완료하면 곧장 j1·s-in")은 "조용히 넣기"였다.
// 옛 결과(j1·s-in 이 남는다)는 사용자가 [그대로 넣기]를 고른 경우로 살린다.
describe('🔴 TRIP-1012 A6 → TRIP-1042 Q2 → TRIP-1106 · 위저드에 이미 있던 지역 밖 꼭 갈 곳은 체크된 채 세고, [그대로 넣기]면 남는다', () => {
  it('위저드 j1(인천 남동구)은 머리글 아래 채운 체크로 뜨고 부제에 세며, s-in 을 골라 완료 → 다이얼로그 → [그대로 넣기]면 j1·s-in 이 남는다', async () => {
    useTripWizardStore
      .getState()
      .initMustVisits([wizardItem('j1', '장소 j1', '남동구')]);
    serveSaved([
      savedCoded('j1', '남동구', '28200', '2026-09-01T01:00:00.000Z'),
      savedCoded('s-in', '마포구', '11440', '2026-09-01T02:00:00.000Z'),
    ]);
    openSelectForTrip(SEOUL_TRIP);

    await waitFor(() => expect(rowCount()).toBe(2));
    expect(orderedPickIds()).toEqual([
      'mustvisit-pick-row-s-in',
      'mustvisit-pick-region-outside',
      'mustvisit-pick-row-j1',
    ]);
    // AC-1 — 이미 선택된 밖 행은 체크가 보인다(해제 수단).
    expect(screen.getByTestId('mustvisit-pick-check-j1')).toBeSelected();
    expect(
      screen.getByTestId('mustvisit-pick-check-filled-j1')
    ).toBeOnTheScreen();
    // AC-5 · 결정 0 — 보이는 체크와 M 이 같다(j1 을 센다).
    expect(screen.getByTestId('mustvisit-pick-subtitle')).toHaveTextContent(
      '담은 곳 2곳 · 1곳 선택됨'
    );

    fireEvent.press(screen.getByTestId('mustvisit-pick-check-s-in'));
    expect(screen.getByTestId('mustvisit-pick-subtitle')).toHaveTextContent(
      '담은 곳 2곳 · 2곳 선택됨'
    );
    fireEvent.press(screen.getByTestId('mustvisit-pick-complete'));

    // AC-6 — 곧장 가지 않고 묻는다.
    expect(
      screen.getByTestId('mustvisit-pick-outside-confirm')
    ).toBeOnTheScreen();
    expect(mockPush).not.toHaveBeenCalled();

    fireEvent.press(screen.getByTestId('mustvisit-pick-outside-keep'));

    // 짝 — 버튼이 실제로 완료를 돌렸다(안 돌면 준비 때 심은 j1 이 공짜로 남는다, ★9).
    expect(mockPush.mock.calls).toEqual([['/trips/new/step1']]);
    // AC-8 — 새로 고른 s-in 과 원래 있던 j1 이 함께 남는다.
    expect(seededIds().sort()).toEqual(['j1', 's-in']);
  });
});

describe('🔴 TRIP-1012 A7 · 지역 밖 머리글 화면에도 소요시간 표기가 없다 (INV-3)', () => {
  it('머리글이 뜬 화면에서 분·시간·소요 표기가 0건이다', async () => {
    serveSaved(SEOUL_MIXED);
    openSelectForTrip(SEOUL_TRIP);

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

// ── TRIP-1026 · select 모드에서 d04 로 갈 때는 위저드 출처를 싣는다 (AC-2 · AC-6) ──────────────
// select 는 위저드 안(1/4 '더 담기'·'전체 보기')에서만 열리므로 여기서 d04 로 가는 두 버튼은 곧 "위저드 →
// d04" 다. d04 는 그 신호를 보고 ＋ FAB 를 숨긴다. save 모드 '둘러보기'는 위저드 밖이라 신호를 안 싣는다
// (`SavedPlacesPage.integration.test.tsx` S-7 `[['/explore/places']]` 가 그대로 지킨다).
// 기대값은 헬퍼 출력으로 만든다 — 'from' 을 손으로 적으면 생산자 철자가 틀려도 green 이다.

describe('🔴 1026 AC-2 · select 의 d04 진입 두 곳이 위저드 출처를 싣는다', () => {
  it('W2 · "+ 탐색에서 더 담기"를 누르면 위저드 출처를 실어 d04 로 간다', async () => {
    await renderSelectLoaded();

    fireEvent.press(screen.getByTestId('mustvisit-pick-addmore'));

    expect(mockPush.mock.calls).toEqual([
      [{ pathname: '/explore/places', params: wizardOriginParams() }],
    ]);
  });

  it('W3 · 담은 곳 0곳 얼굴의 둘러보기를 누르면 위저드 출처를 실어 d04 로 간다', async () => {
    serveSaved([]);
    openSelect();
    await waitFor(() =>
      expect(screen.getByTestId('mustvisit-pick-empty')).toBeOnTheScreen()
    );

    fireEvent.press(screen.getByTestId('mustvisit-pick-browse'));

    expect(mockPush.mock.calls).toEqual([
      [{ pathname: '/explore/places', params: wizardOriginParams() }],
    ]);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * TRIP-1042 — 꼭 갈 곳 고르기 지역 판정: 코드 매칭 · 폴백 제거 · 지역 빈 상태 · 탐색 진입 region · 시도 표기
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * 무엇을 보장하나(BR-U1-58 · INV-U1-21 · 01b Q1~Q6):
 *  - R1·R2 서울(11) 여행에서 종로구(11110)는 지역 안, 인천 남동구(28200)는 머리글 아래 흐린 행 — 고를 수
 *    없고, 완료해도 지역 안에서 고른 것만 심긴다(AC-1·2·10·11).
 *  - R3~R5 지역 안이 0건이면 폴백 없이 목록 머리에 `{여행지}에 담은 곳이 없어요` + CTA(AC-4·5·6, Q3·Q4).
 *  - R6 d04 로 가는 세 버튼이 여행 지역 이름을 싣는다(AC-7 — d04 는 이름을 받는다).
 *  - R7 담은 곳이 진짜 0이면 기존 빈 얼굴 그대로(AC-8), R8 목적지 코드가 없으면 판정 생략(Q6).
 *  - R9 행 위치가 `인천 남동구`처럼 카탈로그의 시도 짧은 이름을 붙인다(AC-9).
 *  - R11 새 블록 화면에도 소요시간 표기가 없다(INV-3).
 *
 * ★ 목적지 코드는 스토어에만 있다 — `openSelectForTrip` 이 스토어·URL 에 같은 값을 심는다(02a ★1·★3).
 * ★ 부재 단언(폴백·빈 얼굴·체크 0)은 긍정 짝(블록·행 존재)을 먼저 잡은 뒤에 잰다(02a ★5).
 */

describe('🔴 TRIP-1042 R1 · 서울 여행 — 종로구는 지역 안, 인천 남동구는 흐린 밖 행 (AC-1·2·11)', () => {
  it('지역 안 두 곳 뒤에 머리글과 밖 한 곳이 오고, 밖 행은 눌러도 선택이 늘지 않으며 안 행 체크는 센다', async () => {
    serveSaved([
      savedCoded('out1', '남동구', '28200', '2026-09-01T01:00:00.000Z'),
      savedCoded('in1', '종로구', '11110', '2026-09-01T02:00:00.000Z'),
      savedCoded('n1', null, null, '2026-09-01T03:00:00.000Z'),
    ]);
    openSelectForTrip(SEOUL_TRIP);

    await waitFor(() => expect(rowCount()).toBe(3));
    expect(orderedPickIds()).toEqual([
      'mustvisit-pick-row-in1',
      'mustvisit-pick-row-n1',
      'mustvisit-pick-region-outside',
      'mustvisit-pick-row-out1',
    ]);
    expect(screen.getByTestId('mustvisit-pick-check-in1')).toBeOnTheScreen();
    expect(screen.getByTestId('mustvisit-pick-check-n1')).toBeOnTheScreen();
    expect(screen.getByTestId('mustvisit-pick-row-in1')).not.toBeDisabled();
    expect(screen.queryByTestId('mustvisit-pick-check-out1')).toBeNull();
    expect(screen.getByTestId('mustvisit-pick-row-out1')).toBeDisabled();
    expect(screen.getByTestId('mustvisit-pick-subtitle')).toHaveTextContent(
      '담은 곳 3곳 · 0곳 선택됨'
    );

    fireEvent.press(screen.getByTestId('mustvisit-pick-row-out1'));
    expect(screen.getByTestId('mustvisit-pick-subtitle')).toHaveTextContent(
      '담은 곳 3곳 · 0곳 선택됨'
    );

    fireEvent.press(screen.getByTestId('mustvisit-pick-check-in1'));
    expect(screen.getByTestId('mustvisit-pick-subtitle')).toHaveTextContent(
      '담은 곳 3곳 · 1곳 선택됨'
    );
  });
});

describe('🔴 TRIP-1042 R2 · 완료하면 지역 안에서 고른 것만 심긴다 (AC-10)', () => {
  it('in1·n1 을 골라 완료하면 꼭 갈 곳은 정확히 그 둘이고 밖 out1 은 없다', async () => {
    serveSaved([
      savedCoded('out1', '남동구', '28200', '2026-09-01T01:00:00.000Z'),
      savedCoded('in1', '종로구', '11110', '2026-09-01T02:00:00.000Z'),
      savedCoded('n1', null, null, '2026-09-01T03:00:00.000Z'),
    ]);
    openSelectForTrip(SEOUL_TRIP);
    await waitFor(() => expect(rowCount()).toBe(3));

    fireEvent.press(screen.getByTestId('mustvisit-pick-check-in1'));
    fireEvent.press(screen.getByTestId('mustvisit-pick-check-n1'));
    fireEvent.press(screen.getByTestId('mustvisit-pick-complete'));

    expect(mockPush.mock.calls).toEqual([['/trips/new/step1']]);
    expect(seededIds().sort()).toEqual(['in1', 'n1']);
    expect(seededIds().includes('out1')).toBe(false);
  });
});

/** 서울 여행인데 담은 곳이 전부 밖(인천 남동구·부산 해운대구) — savedAt 오름차순 o1 → o2. */
const ALL_OUTSIDE_SEOUL: SavedPlace[] = [
  savedCoded('o1', '남동구', '28200', '2026-09-01T01:00:00.000Z'),
  savedCoded('o2', '해운대구', '26350', '2026-09-01T02:00:00.000Z'),
];

describe('🔴 TRIP-1042 R3 · 지역 안이 0건이면 폴백 대신 region-empty 블록 (AC-4·6·8·11)', () => {
  it('"서울에 담은 곳이 없어요"·CTA 가 정확히 뜨고, 밖 두 곳은 체크 없이 이어지며, 폴백·빈 얼굴·더 담기는 없다', async () => {
    serveSaved(ALL_OUTSIDE_SEOUL);
    openSelectForTrip(SEOUL_TRIP);

    // 긍정 짝 먼저 — 블록이 떠야 아래 부재 단언이 로딩 중 공허 통과가 아니다(02a ★5).
    const block = await screen.findByTestId('mustvisit-pick-region-empty');
    expect(
      within(block).getByText('서울에 담은 곳이 없어요')
    ).toBeOnTheScreen();
    expect(
      screen.getByTestId('mustvisit-pick-region-empty-browse')
    ).toHaveTextContent('탐색에서 서울 장소 담기');
    expect(
      screen.getByTestId('mustvisit-pick-region-outside')
    ).toHaveTextContent('이 여행 지역 밖 2곳');
    expect(rowCount()).toBe(2);

    // AC-6 — 폴백이 없고, 밖 행이 체크 가능한 행으로 섞이지 않는다.
    expect(fallbackCount()).toBe(0);
    expect(checkCount()).toBe(0);
    // AC-8 과 구분 — 진짜 0곳 얼굴이 아니다. CTA 가 더 담기 행을 대신한다.
    expect(screen.queryAllByTestId('mustvisit-pick-empty')).toHaveLength(0);
    expect(screen.queryAllByText(TRUE_EMPTY_TITLE)).toHaveLength(0);
    expect(screen.queryAllByTestId('mustvisit-pick-addmore')).toHaveLength(0);

    expect(screen.getByTestId('mustvisit-pick-subtitle')).toHaveTextContent(
      '담은 곳 2곳 · 0곳 선택됨'
    );
    expect(screen.getByTestId('mustvisit-pick-complete')).toBeDisabled();
  });
});

describe('🔴 TRIP-1042 R4 · 다중 목적지 — 제목·CTA 를 "서울·부산"으로 잇고 두 이름을 싣는다 (AC-5·7 · Q3)', () => {
  it('서울(11)·부산(26) 여행에 인천 장소만 있으면 "서울·부산에 담은 곳이 없어요", CTA 는 두 지역을 실어 d04 로 간다', async () => {
    serveSaved([
      savedCoded('o1', '남동구', '28200', '2026-09-01T01:00:00.000Z'),
    ]);
    openSelectForTrip([
      { region: '서울특별시', regionCode: '11' },
      { region: '부산광역시', regionCode: '26' },
    ]);

    const block = await screen.findByTestId('mustvisit-pick-region-empty');
    expect(
      within(block).getByText('서울·부산에 담은 곳이 없어요')
    ).toBeOnTheScreen();
    const cta = screen.getByTestId('mustvisit-pick-region-empty-browse');
    expect(cta).toHaveTextContent('탐색에서 서울·부산 장소 담기');

    fireEvent.press(cta);

    expect(mockPush.mock.calls).toEqual([
      [
        {
          pathname: '/explore/places',
          params: {
            region: ['서울특별시', '부산광역시'],
            ...wizardOriginParams(),
          },
        },
      ],
    ]);
  });
});

describe('🔴 TRIP-1042 R5 · 시군구 목적지는 표시 이름 그대로 (Q4)', () => {
  it('해운대구(26350) 여행에 종로구 장소만 있으면 "해운대구에 담은 곳이 없어요"', async () => {
    serveSaved([
      savedCoded('o1', '종로구', '11110', '2026-09-01T01:00:00.000Z'),
    ]);
    openSelectForTrip([{ region: '해운대구', regionCode: '26350' }]);

    const block = await screen.findByTestId('mustvisit-pick-region-empty');
    expect(
      within(block).getByText('해운대구에 담은 곳이 없어요')
    ).toBeOnTheScreen();
  });
});

/** d04 로 갈 때 실어야 할 파라미터 — 기대값은 헬퍼 출력으로 만든다(철자 손복제 금지, 1026 관례). */
const SEOUL_TO_EXPLORE = {
  pathname: '/explore/places',
  params: { region: ['서울특별시'], ...wizardOriginParams() },
};

describe('🔴 TRIP-1042 R6 · d04 로 가는 세 버튼이 여행 지역 이름을 싣는다 (AC-7)', () => {
  it('R6a · 지역 안이 있으면 "+ 탐색에서 더 담기"가 서울특별시를 실어 간다', async () => {
    serveSaved([
      savedCoded('in1', '종로구', '11110', '2026-09-01T01:00:00.000Z'),
    ]);
    openSelectForTrip(SEOUL_TRIP);
    await waitFor(() => expect(rowCount()).toBe(1));

    fireEvent.press(screen.getByTestId('mustvisit-pick-addmore'));

    expect(mockPush.mock.calls).toEqual([[SEOUL_TO_EXPLORE]]);
  });

  it('R6b · region-empty CTA 가 서울특별시를 실어 간다', async () => {
    serveSaved(ALL_OUTSIDE_SEOUL);
    openSelectForTrip(SEOUL_TRIP);

    fireEvent.press(
      await screen.findByTestId('mustvisit-pick-region-empty-browse')
    );

    expect(mockPush.mock.calls).toEqual([[SEOUL_TO_EXPLORE]]);
  });

  it('R6c · 진짜 0곳 얼굴의 "장소 둘러보기"가 서울특별시를 실어 간다', async () => {
    serveSaved([]);
    openSelectForTrip(SEOUL_TRIP);

    fireEvent.press(await screen.findByTestId('mustvisit-pick-browse'));

    expect(mockPush.mock.calls).toEqual([[SEOUL_TO_EXPLORE]]);
  });
});

describe('TRIP-1042 R7 · 무회귀 — 목적지 코드가 있어도 담은 곳이 0이면 기존 빈 얼굴 (AC-8)', () => {
  it('"아직 담은 곳이 없어요" 얼굴이 뜨고 region-empty 블록은 없다', async () => {
    serveSaved([]);
    openSelectForTrip(SEOUL_TRIP);

    await waitFor(() =>
      expect(screen.getByTestId('mustvisit-pick-empty')).toBeOnTheScreen()
    );
    expect(screen.queryAllByText(TRUE_EMPTY_TITLE)).toHaveLength(1);
    expect(screen.queryAllByTestId('mustvisit-pick-region-empty')).toHaveLength(
      0
    );
  });
});

describe('🔴 TRIP-1042 R8 · 목적지 코드가 없으면 판정을 건너뛴다 (Q6 — 이름 폴백 금지)', () => {
  it('코드 없는 "부산" 여행이면 종로구·해운대구 두 곳 모두 고를 수 있고 머리글·빈 블록·폴백이 없다', async () => {
    serveSaved([
      savedCoded('a', '종로구', '11110', '2026-09-01T01:00:00.000Z'),
      savedCoded('b', '해운대구', '26350', '2026-09-01T02:00:00.000Z'),
    ]);
    openSelectForTrip([{ region: '부산' }]);

    await waitFor(() => expect(rowCount()).toBe(2));
    expect(checkCount()).toBe(2);
    expect(
      screen.queryAllByTestId('mustvisit-pick-region-outside')
    ).toHaveLength(0);
    expect(screen.queryAllByTestId('mustvisit-pick-region-empty')).toHaveLength(
      0
    );
    // 이름 비교가 살아 있으면 `부산` 이 두 곳과 안 맞아 폴백 한 줄이 뜬다(현행) — 그 경로가 없어야 한다.
    expect(fallbackCount()).toBe(0);
  });
});

function catalogRegion(
  regionCode: string,
  name: string,
  sidoName: string,
  level: RegionLevel
): Region {
  return { regionCode, name, sidoName, level, selectable: true, poiCount: 1 };
}

/** 실서버 모양의 숫자 코드 카탈로그 — 기본 목(`busan` 슬러그)은 숫자 코드와 안 맞아 이 케이스만 덮는다(02a ★11). */
const NUMERIC_CATALOG: Region[] = [
  catalogRegion('11', '서울특별시', '서울특별시', RegionLevel.SIDO),
  catalogRegion('11110', '종로구', '서울특별시', RegionLevel.SIGUNGU),
  catalogRegion('26', '부산광역시', '부산광역시', RegionLevel.SIDO),
  catalogRegion('28', '인천광역시', '인천광역시', RegionLevel.SIDO),
  catalogRegion('28200', '남동구', '인천광역시', RegionLevel.SIGUNGU),
];

describe('🔴 TRIP-1042 R9 · 행 위치에 시도 짧은 이름을 붙인다 (AC-9)', () => {
  it('28200/남동구 → "인천 남동구", 26/부산 → "부산"(겹쳐 쓰지 않음), 코드 없는 종로구 → "종로구"', async () => {
    server.use(
      http.get(`${BASE}/regions`, () => HttpResponse.json(NUMERIC_CATALOG))
    );
    serveSaved([
      savedCoded('c1', '남동구', '28200', '2026-09-01T01:00:00.000Z'),
      savedCoded('c2', '부산', '26', '2026-09-01T02:00:00.000Z'),
      savedCoded('c3', '종로구', null, '2026-09-01T03:00:00.000Z'),
    ]);
    openSelectForTrip(SEOUL_TRIP);

    // 라벨은 카탈로그가 도착한 뒤에 붙는다 — 행이 아니라 라벨 자체를 기다린다(02a ★12).
    await waitFor(() =>
      expect(
        within(screen.getByTestId('mustvisit-pick-row-c1')).getByText(
          '인천 남동구'
        )
      ).toBeOnTheScreen()
    );
    const busanRow = screen.getByTestId('mustvisit-pick-row-c2');
    expect(within(busanRow).getByText('부산')).toBeOnTheScreen();
    expect(within(busanRow).queryByText('부산 부산')).toBeNull();
    expect(
      within(screen.getByTestId('mustvisit-pick-row-c3')).getByText('종로구')
    ).toBeOnTheScreen();
  });
});

describe('🔴 TRIP-1042 R11 · region-empty 화면에도 소요시간 표기가 없다 (INV-3)', () => {
  it('블록이 뜬 화면에서 분·시간·소요 표기가 0건이다', async () => {
    serveSaved(ALL_OUTSIDE_SEOUL);
    openSelectForTrip(SEOUL_TRIP);

    await screen.findByTestId('mustvisit-pick-region-empty');
    // 긍정 앵커 — 정규식이 이 화면의 새 글자를 실제로 읽는다.
    expect(screen.queryAllByText(/담은 곳이 없어요/).length).toBeGreaterThan(0);
    expect(screen.queryAllByText(/\d+\s*분|\d+\s*시간|소요/).length).toBe(0);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * TRIP-1093 결정 2 — 1/4 「더 담기」가 담은 곳 수와 무관하게 이 화면으로 온다
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * 무엇을 보장하나(BR-U1-37 · 결정 2): 1/4 에서 x 로 뺀 곳(B)은 이 화면에 **체크 없이** 뜬다 — 체크 초기값이
 * 위저드의 꼭 갈 곳에서 오기 때문이다. 그대로 완료하면 B 는 빠진 채고, 다시 체크하면 들어간다(개별 추가 허용).
 * 결정 2 로 담은 곳 0곳 사용자도 이 화면을 타게 되어 경로가 늘었다 — 현행 동작을 잠근다(선제 green).
 *
 * ★ `initMustVisits` 는 첫 호출만 먹는다 — 최상위 beforeEach 의 `reset()` 뒤라 반영된다.
 */
function arrangeRemovedInWizard(): void {
  const store = useTripWizardStore.getState();
  store.initMustVisits([wizardItem('p1'), wizardItem('p2')]);
  store.removeMustVisit('p2');
  // 앵커 — 1/4 에서 p2 를 x 로 뺀 상태다(준비가 조용히 망가지면 "체크 없음"이 공짜로 통과한다).
  expect(seededIds()).toEqual(['p1']);
  expect(useTripWizardStore.getState().excludedMustVisitPoiIds).toEqual(['p2']);
  serveSaved(ROWS.slice(0, 3));
  openSelect();
}

describe('🔒 1093 AC-5 · 1/4 에서 x 로 뺀 곳은 select 에 체크 없이 뜬다 (BR-U1-37)', () => {
  it('뺀 p2 는 체크 없이, 남은 p1 은 체크된 채 뜨고 — 그대로 완료하면 꼭 갈 곳은 p1 하나다', async () => {
    arrangeRemovedInWizard();
    await waitFor(() => expect(rowCount()).toBe(3));

    expect(screen.getByTestId('mustvisit-pick-check-p1')).toBeSelected();
    expect(screen.getByTestId('mustvisit-pick-check-p2')).not.toBeSelected();

    fireEvent.press(screen.getByTestId('mustvisit-pick-complete'));

    expect(seededIds()).toEqual(['p1']);
    expect(mockPush.mock.calls).toEqual([['/trips/new/step1']]);
  });

  it('뺀 p2 를 다시 체크해 완료하면 p2 가 꼭 갈 곳에 돌아온다 (개별 추가 허용)', async () => {
    arrangeRemovedInWizard();
    await waitFor(() => expect(rowCount()).toBe(3));

    fireEvent.press(screen.getByTestId('mustvisit-pick-check-p2'));
    fireEvent.press(screen.getByTestId('mustvisit-pick-complete'));

    expect(seededIds().sort()).toEqual(['p1', 'p2']);
    expect(mockPush.mock.calls).toEqual([['/trips/new/step1']]);
  });
});

// ── TRIP-1113 결정 2 · select 완료는 위저드 안 재진입이다 — 이미 만든 여행 id 를 셸이 지우지 않게 표식을 켠다 ──
// 표식이 켜지면 셸이 id 를 남긴다는 쪽은 `tripWizardReentryPreserve.test.tsx` GP 가 동작으로 잠근다(이 파일의
// expo-router 목엔 Stack 이 없어 셸을 함께 그릴 수 없다). 새 진입(「이 장소들로」 CTA)이 표식을 켜지 않는 쪽은
// `SavedPlacesPage.integration.test.tsx` C1 이 freshWizardDraft 비교로 잡는다.

describe('🔴 TRIP-1113 SP-1 · select 완료가 셸 보존 표식을 켠다', () => {
  it('p1 을 골라 완료하면 preserveCreatedTripIdOnce 가 켜지고 step1 으로 간다', async () => {
    // 앵커 — 완료 전엔 켜져 있지 않다(구현 전 undefined · 구현 뒤 false 둘 다 통과).
    expect(useTripWizardStore.getState().preserveCreatedTripIdOnce).not.toBe(
      true
    );

    await renderSelectLoaded();
    fireEvent.press(screen.getByTestId('mustvisit-pick-check-p1'));
    fireEvent.press(screen.getByTestId('mustvisit-pick-complete'));

    expect(useTripWizardStore.getState().preserveCreatedTripIdOnce).toBe(true);
    expect(mockPush.mock.calls).toEqual([['/trips/new/step1']]);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * TRIP-1106 — 지역 밖 선택 행 해제 · 밖 포함 완료 경고 · 밖 행 순번 없음
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * 무엇을 보장하나(BR-U1-37 · BR-U1-58 ② · INV-4 · 결정 0~2 · 01b Q3):
 *  - W1 여행지를 바꾸기 전에 담아 둔 밖 항목이 위저드에 있으면 그 밖 행엔 채운 체크가 보이고 부제에 센다.
 *    선택 안 된 밖 행은 체크가 없고, 밖 행엔 순번이 없다.
 *  - W2 그 체크를 누르면 풀리고 체크 자체가 사라져 다시 켤 수 없다 — 완료하면 시드에서도 빠진다.
 *  - W4 선택된 밖 행이 있으면 완료가 곧장 가지 않고 「이 여행 지역 밖 N곳이 함께 들어가요」를 띄운다.
 *    떠 있는 동안 시드·재진입 표식·이동은 0회다(표식이 먼저 켜지면 다른 길로 나갈 때 옛 여행 id 가 산다).
 *  - W5·W6 [빼고 완료]는 밖 행을 빼고, [그대로 넣기]는 원래 시드 그대로 남긴다. 둘 다 누른 뒤에만
 *    시드 → 표식 → step1 순서로 간다(TRIP-1113). 행이 없는 위저드 항목(px)은 두 버튼 모두 남긴다(1012 Q1).
 *  - W7 선택된 밖 행이 없으면 다이얼로그 없이 지금 그대로 간다.
 *  - W8·W9 떠 있는 동안 완료를 또 누르거나 다이얼로그 버튼을 같은 틱에 두 번 눌러도 한 번만 간다.
 *
 * ★ 시드 호출 수는 결과 목록이 아니라 스토어 구독으로 센다(02a ★2) — 시드는 목록을 **교체**하므로
 *   일찍 시드한 구현도 목록이 준비값과 같아 보일 수 있다.
 * ★ 순서는 push 목 안에서 그 순간의 스토어를 찍어 잰다(02a ★3).
 * ★ 같은 틱 연타는 바깥 act 하나로 묶는다 — 묶지 않으면 첫 누름이 다이얼로그를 닫아 두 번째가
 *   가드 없이도 무시된다(RNTL 은 언마운트된 요소에 press 를 안 보낸다, 02a ★1).
 */

/** 서울(11) 여행 — 밖 j1(인천 남동구) → 안 s-in(마포구) → 밖 j2(해운대구) → 밖 j3(연천군). */
const OUTSIDE_GATE_ROWS: SavedPlace[] = [
  savedCoded('j1', '남동구', '28200', '2026-09-01T01:00:00.000Z'),
  savedCoded('s-in', '마포구', '11440', '2026-09-01T02:00:00.000Z'),
  savedCoded('j2', '해운대구', '26350', '2026-09-01T03:00:00.000Z'),
  savedCoded('j3', '연천군', '41800', '2026-09-01T04:00:00.000Z'),
];

/** 위저드에 이미 있던 꼭 갈 곳 — 밖 j1·j2 는 행이 있고, px 는 담기를 풀어 행이 없다. */
const OUTSIDE_GATE_WIZARD: MustVisitSeedItem[] = [
  wizardItem('j1', '인천 논현 포구', '남동구'),
  wizardItem('j2', '장소 j2', '해운대구'),
  wizardItem('px', '예전에 담았던 곳', '중구'),
];

const CONFIRM = 'mustvisit-pick-outside-confirm';
const EXCLUDE = 'mustvisit-pick-outside-exclude';
const KEEP = 'mustvisit-pick-outside-keep';

// 모듈 싱글턴(위저드 스토어) 구독과 push 목 구현은 파일 최상위에서 걷는다 — describe 안에 걸면 앞 테스트의
// 구독·구현이 뒤 테스트로 샌다(하네스 규칙). mockClear 는 구현을 안 지우므로 mockReset 이다.
let storeUnsubscribers: (() => void)[] = [];
afterEach(() => {
  storeUnsubscribers.forEach((unsubscribe) => unsubscribe());
  storeUnsubscribers = [];
  mockPush.mockReset();
});

/** 지금부터 `mustVisits` 가 바뀐(=시드된) 횟수를 센다. 준비 단계의 쓰기는 세지 않는다. */
function countSeedWrites(): () => number {
  let writes = 0;
  storeUnsubscribers.push(
    useTripWizardStore.subscribe((state, prev) => {
      if (state.mustVisits !== prev.mustVisits) writes += 1;
    })
  );
  return () => writes;
}

type PushMoment = { seeded: string[]; preserve: boolean };

/** push 가 불린 순간의 시드·재진입 표식을 기록한다 — 시드·표식이 push 보다 먼저인지 잰다. */
function recordStoreAtPush(): PushMoment[] {
  const moments: PushMoment[] = [];
  mockPush.mockImplementation(() => {
    const state = useTripWizardStore.getState();
    moments.push({
      seeded: state.mustVisits.map((m) => m.sourcePoiId).sort(),
      preserve: state.preserveCreatedTripIdOnce,
    });
  });
  return moments;
}

function seededName(poiId: string): string | undefined {
  return useTripWizardStore
    .getState()
    .mustVisits.find((m) => m.sourcePoiId === poiId)?.name;
}

/** 위저드 j1·j2·px + 4행으로 열고 s-in 을 더 고른 상태(완료 직전)까지 만든다. */
async function arrangeOutsideGate(): Promise<void> {
  useTripWizardStore.getState().initMustVisits(OUTSIDE_GATE_WIZARD);
  serveSaved(OUTSIDE_GATE_ROWS);
  openSelectForTrip(SEOUL_TRIP);
  await waitFor(() => expect(rowCount()).toBe(4));
  fireEvent.press(screen.getByTestId('mustvisit-pick-check-s-in'));
  expect(screen.getByTestId('mustvisit-pick-subtitle')).toHaveTextContent(
    '담은 곳 4곳 · 3곳 선택됨'
  );
}

/** 완료를 눌러 다이얼로그가 뜬 상태 — 긍정 앵커(뜸)를 먼저 잡는다(02a ★8). */
async function arrangeGateOpen(): Promise<{ seedWrites: () => number }> {
  await arrangeOutsideGate();
  const seedWrites = countSeedWrites();
  fireEvent.press(screen.getByTestId('mustvisit-pick-complete'));
  expect(screen.getByTestId(CONFIRM)).toBeOnTheScreen();
  return { seedWrites };
}

describe('🔴 TRIP-1106 W1 · 이미 선택된 밖 행은 채운 체크로 보이고 부제에 세며, 밖 행엔 순번이 없다 (AC-1·3·5·10)', () => {
  it('j1·j2 는 채운 체크+selected, 선택 안 된 j3 는 체크 없음, 밖 3행 순번 없음, s-in 순번 1, 부제 4곳 · 2곳', async () => {
    useTripWizardStore.getState().initMustVisits(OUTSIDE_GATE_WIZARD);
    serveSaved(OUTSIDE_GATE_ROWS);
    openSelectForTrip(SEOUL_TRIP);

    await waitFor(() => expect(rowCount()).toBe(4));
    expect(orderedPickIds()).toEqual([
      'mustvisit-pick-row-s-in',
      'mustvisit-pick-region-outside',
      'mustvisit-pick-row-j1',
      'mustvisit-pick-row-j2',
      'mustvisit-pick-row-j3',
    ]);
    expect(
      screen.getByTestId('mustvisit-pick-region-outside')
    ).toHaveTextContent('이 여행 지역 밖 3곳');

    ['j1', 'j2'].forEach((poiId) => {
      expect(
        screen.getByTestId(`mustvisit-pick-check-${poiId}`)
      ).toBeSelected();
      expect(
        screen.getByTestId(`mustvisit-pick-check-filled-${poiId}`)
      ).toBeOnTheScreen();
    });
    // AC-3 — 선택 안 된 밖 행은 켤 수단이 없다.
    expect(screen.queryByTestId('mustvisit-pick-check-j3')).toBeNull();

    // AC-10 — 순번은 안 행에만.
    ['j1', 'j2', 'j3'].forEach((poiId) => {
      expect(screen.queryByTestId(`mustvisit-pick-rank-${poiId}`)).toBeNull();
    });
    expect(
      within(screen.getByTestId('mustvisit-pick-rank-s-in')).getByText('1')
    ).toBeOnTheScreen();

    // AC-5 — 보이는 체크(j1·j2)와 M 이 같다. 행 없는 px 는 세지 않는다.
    expect(screen.getByTestId('mustvisit-pick-subtitle')).toHaveTextContent(
      '담은 곳 4곳 · 2곳 선택됨'
    );
  });
});

describe('🔴 TRIP-1106 W2 · 밖 행 체크를 풀면 체크가 사라져 다시 켤 수 없고, 완료하면 시드에서도 빠진다 (AC-2·4)', () => {
  it('j1 해제 → 체크 없음·부제 0곳 → j1 행을 눌러도 그대로 → s-in 골라 완료하면 다이얼로그 없이 꼭 갈 곳은 s-in 하나', async () => {
    useTripWizardStore
      .getState()
      .initMustVisits([wizardItem('j1', '장소 j1', '남동구')]);
    serveSaved([OUTSIDE_GATE_ROWS[0], OUTSIDE_GATE_ROWS[1]]);
    openSelectForTrip(SEOUL_TRIP);
    await waitFor(() => expect(rowCount()).toBe(2));
    // 앵커 — 처음엔 체크된 채다(없으면 아래 "사라짐"이 공허하다).
    expect(screen.getByTestId('mustvisit-pick-check-j1')).toBeSelected();

    // AC-2 — 해제.
    fireEvent.press(screen.getByTestId('mustvisit-pick-check-j1'));
    expect(screen.queryByTestId('mustvisit-pick-check-j1')).toBeNull();
    expect(screen.queryByTestId('mustvisit-pick-check-filled-j1')).toBeNull();
    expect(screen.getByTestId('mustvisit-pick-subtitle')).toHaveTextContent(
      '담은 곳 2곳 · 0곳 선택됨'
    );

    // AC-4 — 행을 눌러도 다시 선택되지 않는다.
    fireEvent.press(screen.getByTestId('mustvisit-pick-row-j1'));
    expect(screen.queryByTestId('mustvisit-pick-check-j1')).toBeNull();
    expect(screen.getByTestId('mustvisit-pick-subtitle')).toHaveTextContent(
      '담은 곳 2곳 · 0곳 선택됨'
    );

    fireEvent.press(screen.getByTestId('mustvisit-pick-check-s-in'));
    fireEvent.press(screen.getByTestId('mustvisit-pick-complete'));

    // 밖 선택이 남지 않았으니 묻지 않고 간다(짝: push 1).
    expect(screen.queryAllByTestId(CONFIRM)).toHaveLength(0);
    expect(mockPush.mock.calls).toEqual([['/trips/new/step1']]);
    expect(seededIds()).toEqual(['s-in']);
  });
});

describe('🔴 TRIP-1106 W4 · 선택된 밖 행이 있으면 완료가 먼저 묻는다 — 떠 있는 동안 시드·표식·이동 0 (AC-6)', () => {
  it('「이 여행 지역 밖 2곳이 함께 들어가요」(선택 안 된 j3·행 없는 px 는 안 셈)가 뜨고, 스토어·이동은 그대로다', async () => {
    const { seedWrites } = await arrangeGateOpen();

    const gate = screen.getByTestId(CONFIRM);
    expect(
      within(gate).getByText('이 여행 지역 밖 2곳이 함께 들어가요')
    ).toBeOnTheScreen();
    expect(screen.getByTestId(EXCLUDE)).toBeOnTheScreen();
    expect(screen.getByTestId(KEEP)).toBeOnTheScreen();

    expect(seedWrites()).toBe(0);
    expect(seededIds()).toEqual(['j1', 'j2', 'px']);
    expect(useTripWizardStore.getState().preserveCreatedTripIdOnce).not.toBe(
      true
    );
    expect(mockPush).not.toHaveBeenCalled();
  });
});

describe('🔴 TRIP-1106 W5 · [빼고 완료]는 밖 행을 빼고 시드 → 표식 → step1 순서로 간다 (AC-7 · Q3)', () => {
  it('꼭 갈 곳은 s-in·px(이름 그대로)이고 j1·j2 는 없으며, push 순간 이미 시드·표식이 반영돼 있다', async () => {
    await arrangeGateOpen();
    const moments = recordStoreAtPush();

    fireEvent.press(screen.getByTestId(EXCLUDE));

    expect(mockPush.mock.calls).toEqual([['/trips/new/step1']]);
    expect(seededIds().sort()).toEqual(['px', 's-in']);
    expect(seededIds().some((id) => id === 'j1' || id === 'j2')).toBe(false);
    expect(seededName('px')).toBe('예전에 담았던 곳');
    expect(useTripWizardStore.getState().preserveCreatedTripIdOnce).toBe(true);
    expect(moments).toEqual([{ seeded: ['px', 's-in'], preserve: true }]);
  });

  it('Q3 · 밖 j1 만 선택된 채 완료해도 완료가 열려 있고, [빼고 완료]면 빈 꼭 갈 곳으로 간다', async () => {
    useTripWizardStore
      .getState()
      .initMustVisits([wizardItem('j1', '장소 j1', '남동구')]);
    serveSaved([OUTSIDE_GATE_ROWS[0], OUTSIDE_GATE_ROWS[1]]);
    openSelectForTrip(SEOUL_TRIP);
    await waitFor(() => expect(rowCount()).toBe(2));

    const complete = screen.getByTestId('mustvisit-pick-complete');
    expect(complete).not.toBeDisabled();
    fireEvent.press(complete);
    expect(
      within(screen.getByTestId(CONFIRM)).getByText(
        '이 여행 지역 밖 1곳이 함께 들어가요'
      )
    ).toBeOnTheScreen();

    fireEvent.press(screen.getByTestId(EXCLUDE));

    expect(mockPush.mock.calls).toEqual([['/trips/new/step1']]);
    expect(seededIds()).toEqual([]);
  });
});

describe('🔴 TRIP-1106 W6 · [그대로 넣기]는 원래 시드 그대로 남기고 시드 → 표식 → step1 순서로 간다 (AC-8)', () => {
  it('꼭 갈 곳은 j1·j2·px·s-in 이고 j1 이름은 원래 시드 그대로이며, push 순간 이미 시드·표식이 반영돼 있다', async () => {
    await arrangeGateOpen();
    const moments = recordStoreAtPush();

    fireEvent.press(screen.getByTestId(KEEP));

    expect(mockPush.mock.calls).toEqual([['/trips/new/step1']]);
    expect(seededIds().sort()).toEqual(['j1', 'j2', 'px', 's-in']);
    // 지어낸 값이 아니라 원래 시드(담은 목록의 이름 `장소 j1` 이 아니다).
    expect(seededName('j1')).toBe('인천 논현 포구');
    expect(useTripWizardStore.getState().preserveCreatedTripIdOnce).toBe(true);
    expect(moments).toEqual([
      { seeded: ['j1', 'j2', 'px', 's-in'], preserve: true },
    ]);
  });
});

describe('🔴 TRIP-1106 W7 · 선택된 밖 행이 없으면 묻지 않고 지금 그대로 간다 (AC-9 · 무회귀)', () => {
  it('밖 3행이 있어도 위저드가 비어 있으면 s-in 을 골라 완료할 때 다이얼로그 없이 시드·표식·이동이 한 번이다', async () => {
    serveSaved(OUTSIDE_GATE_ROWS);
    openSelectForTrip(SEOUL_TRIP);
    await waitFor(() => expect(rowCount()).toBe(4));

    fireEvent.press(screen.getByTestId('mustvisit-pick-check-s-in'));
    fireEvent.press(screen.getByTestId('mustvisit-pick-complete'));

    expect(mockPush.mock.calls).toEqual([['/trips/new/step1']]);
    expect(screen.queryAllByTestId(CONFIRM)).toHaveLength(0);
    expect(seededIds()).toEqual(['s-in']);
    expect(useTripWizardStore.getState().preserveCreatedTripIdOnce).toBe(true);
  });
});

describe('🔴 TRIP-1106 W8 · 다이얼로그가 떠 있는 동안 완료를 또 눌러도 다이얼로그는 하나이고 아무것도 안 나간다 (AC-11)', () => {
  it('완료 두 번 더 → 다이얼로그 1개 · 시드 쓰기 0 · 표식 꺼짐 · push 0', async () => {
    const { seedWrites } = await arrangeGateOpen();

    // ★ jest 의 press 는 딤 뒤 완료 버튼에도 닿는다 — 막는 것은 코드여야 한다(repo-traps 오버레이 절).
    fireEvent.press(screen.getByTestId('mustvisit-pick-complete'));
    fireEvent.press(screen.getByTestId('mustvisit-pick-complete'));

    expect(screen.getAllByTestId(CONFIRM)).toHaveLength(1);
    expect(seedWrites()).toBe(0);
    expect(useTripWizardStore.getState().preserveCreatedTripIdOnce).not.toBe(
      true
    );
    expect(mockPush).not.toHaveBeenCalled();
  });
});

describe('🔴 TRIP-1106 W9 · 다이얼로그 버튼을 같은 틱에 두 번 눌러도 한 번만 간다 (AC-11)', () => {
  it.each([
    ['빼고 완료 ×2', EXCLUDE, EXCLUDE],
    ['그대로 넣기 ×2', KEEP, KEEP],
    ['빼고 완료 → 그대로 넣기', EXCLUDE, KEEP],
  ])('%s → 시드 쓰기 1 · push 1', async (_label, first, second) => {
    const { seedWrites } = await arrangeGateOpen();
    const firstButton = screen.getByTestId(first);
    const secondButton = screen.getByTestId(second);

    // ★ 바깥 act 하나로 묶어야 두 누름이 다이얼로그가 닫히기 전 버튼에 닿는다(02a ★1).
    await act(async () => {
      fireEvent.press(firstButton);
      fireEvent.press(secondButton);
    });

    expect(mockPush.mock.calls).toEqual([['/trips/new/step1']]);
    expect(seedWrites()).toBe(1);
  });
});
