import { http, HttpResponse } from 'msw';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';
import { BASE } from '@/test-support/apiBase';
import { createGate } from '@/test-support/mswHookHarness';
import {
  createGcZeroWrapper,
  createWrapper,
  newTestQueryClient,
} from '@/test-support/queryRender';

import { server } from '@/mocks/server';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';
import { openPressGuardWindow, resetPressGuard } from '@/shared/lib/pressGuard';
import type { Place, SavedPlace } from '@/shared/api/index.schemas';
import { regionPickerHref } from '@/features/explore';
import { SERVICE_REGIONS } from '@/entities/trip';
import { wizardOriginParams, useTripWizardStore } from '@/features/create-trip';
import {
  captureDraftAtNextCall,
  freshWizardDraft,
  leavePreviousTripDraft,
  resetWizardDraft,
  wizardDraftData,
} from '@/test-support/wizardDraftFixture';

import { PlaceSubtitle } from '@/entities/place/ui/PlaceSubtitle';

import { PlaceExplorePage } from './PlaceExplorePage';
import { routerSpies } from '@/test-support/expoRouterMock';

/**
 * AC-3 · AC-4 · AC-5 · AC-6 · AC-7 · AC-8 (+ 01b Seed Q1·Q3·Q9) — d04 배선.
 *
 * 무엇을 보장하나:
 *  - **P-1 (AC-3)** 카테고리 칩은 `category` 파라미터로 **서버를 다시 부르고**, 그 응답이 카드에
 *    반영된다. 선택된 칩만 활성이다.
 *  - **P-2 (Seed Q9)** 라우트에 `region` 이 있으면 싣고, 없으면 파라미터 자체를 만들지 않는다.
 *  - **P-3 (AC-8·TRIP-502)** 검색은 **서버가 한다**(`q`) — 클라 재정렬 없이 서버 순서를 그린다.
 *  - **P-4 (AC-4)** 하트를 누르면 **서버가 답하기 전에** 담김 표기(배지·하트)가 켜진다
 *    (TRIP-708: CTA 숫자 표시 소멸, 담은 개수는 ♥ FAB→d02 로 이동).
 *  - **P-5 (AC-5)** 해제는 `savedPlaceId` 로 나가고, 낙관 제거로 배지·하트가 빠진다.
 *  - **P-6 (AC-1·AC-6)** ＋ FAB 는 여행 생성 1/2 로 보낸다(CtaBar 대체).
 *  - **P-7 (Seed Q1·BR-U1-03)** 게스트는 담은 목록 조회조차 보내지 않는다.
 *  - **P-8 (TRIP-502)** 목록 끝에 닿으면 `nextCursor` 로 다음 장을 이어 받는다(무한 스크롤).
 *  - **P-9 (TRIP-687)** 라우트 `region` 이 2곳 이상이면 지역별로 `getPlaces` 를 각 1회 부르고
 *    (fan-out) 병합 결과를 한 목록에 함께 그린다 — 단일지역 경로(P-2)의 무한 스크롤은 안 탄다.
 *  - **P-16 (TRIP-1560)** 지역을 안 고르면 전국 조회(region 없음)가 아니라 서비스 지역(서울·부산·제주)별로
 *    조회한다 — 카테고리·검색어를 걸어도 같고, 일부·전부 실패는 배너·error 얼굴로 갈린다(AC-4·S-4 가 AC-5).
 *  - **P-17 (TRIP-1563)** 목록은 이름순이 아니라 진입마다 새로 뽑는 시드 무작위다 — 모든 `/places` 요청이
 *    `order=random&seed=<이번 진입의 번호표>` 를 싣고, 진입 중에는 고정(칩·검색·다시 시도·이어받기·지역 바꾸기),
 *    재진입에는 새 번호표 + 캐시 미재사용, 3지역 병합은 지역을 번갈아 놓는다(아래 `P-17` describe).
 *  - **P-18 (TRIP-1617)** 검색어는 300ms 멈춰야 서버 키가 바뀐다 — 5글자 연속 입력이 지역당 1건(총 WAVE건)이고, 입력칸 글자는
 *    즉시 보이며, 느린 서버에선 옛 검색어 요청이 실제로 끊기되 오류 얼굴은 뜨지 않고, 0건 검색어를 지우는 창에도 얼굴이 안 깜빡인다.
 *  - **P-12 (AC-1)** ♥ FAB 는 담은 장소(d02, `/explore/saved-places`)로 push.
 *  - **P-13 (AC-1)** 복제 BottomTabBar 는 push·replace 가 아니라 dismissTo 로 항법한다(TRIP-1262).
 *  - **P-14 (TRIP-1562)** 검색바 ⇅ 버튼·카테고리 시트가 없다 — 어떤 조작으로도 시트가 마운트되지 않는다.
 *  - **S-1~S-12 (상태·예외)** 첫 조회 스켈레톤 · 0건 안내 · 검색어 지목과 해제 · 조회 실패의 실제
 *    재조회(INV-4) · 미로그인 담기 무요청 · 404 롤백 · 409 수렴 · 네트워크 실패 재시도 · 연타 1회 ·
 *    배너는 다음 조작 시 소멸 · 좌표 방어 · 두 조건 모두 해제(아래 `상태·예외 배선` describe).
 *  - **카드 → d06** 카드를 누르면 **그 카드의 poiId 로** `/explore/places/{poiId}` 에 push 한다
 *    (아래 `카드 → 상세 push` describe).
 *
 * 한 파일로 합친 기록(TRIP-1147): 옛 `PlaceExplorePage.states.integration.test.tsx`(S-*) ·
 * `.cardtap.integration.test.tsx`(TRIP-456 AC-1)를 각자의 바깥 describe 로 옮겼다. 두 관점은 기본
 * 핸들러·픽스처가 이 파일 위쪽 것과 달라서, 바깥 describe 의 `beforeEach` 가 옛 파일의 값을 그대로
 * 다시 건다(msw `server.use` 는 나중에 건 것이 먼저 답한다).
 *
 * 왜 통합 버킷인가: 심판 대상이 "**실제로 나간 요청**"이다. 직렬화가 끝난 최종 URL·재요청
 * 횟수·나간 경로의 id 는 msw 만 관찰할 수 있다(`savedPlaces.integration.test.tsx` 계승).
 *
 * ★ 낙관 단언의 비결정성을 두 겹으로 막는다(TRIP-220 B-1 재발 방지).
 *   ① `POST`/`DELETE` 를 **문(gate) 뒤**에 세운다 — "서버 응답 전"이 시간이 아니라 신호가 된다.
 *   ② 목을 **상태 있는 배열**로 만든다 — 무효화 재조회가 언제 도착하든 답이 낙관 반영과 같다.
 *   단언은 `waitFor` 로 감싼다: TanStack Query 의 통지는 항상 매크로태스크를 한 칸 거친다.
 * ★ 실패 경로는 무효화하지 않는다(TRIP-220 동결 계약) — 그래서 `GET /saved-places` 히트수가
 *   "롤백이냐 재조회냐"를 가르는 신호가 된다. 반대로 409 는 성공 수렴이라 무효화한다.
 */

// authedClient(생성 클라이언트가 타는 mutator 의 인증 계층)가 @/shared/storage 를 정적으로
// 물고 있다 — expo-secure-store 실물 로드를 피하려면 목킹해야 한다(리포 관례).
// TRIP-1349 P-15 — 카드 안 PlaceSubtitle 호출 수로 "카드가 재렌더됐나"를 센다(투명 래퍼, 다른 테스트 무영향).
jest.mock('@/entities/place/ui/PlaceSubtitle', () => {
  const actual = jest.requireActual('@/entities/place/ui/PlaceSubtitle');
  return {
    PlaceSubtitle: jest.fn((props: unknown) => actual.PlaceSubtitle(props)),
  };
});

// TRIP-1563 — 시드는 `expo-crypto` 의 randomUUID 에서 나오는데, jest 에서 실물은 undefined 를 돌려준다(네이티브 모듈 없음).
// 호출마다 다른 유효 값(숫자·하이픈 36자)을 주는 목으로 갈아 "진입마다 다름"을 우리가 통제한 값으로 증명한다.
const mockRandomUUID = jest.fn();
jest.mock('expo-crypto', () => ({ randomUUID: () => mockRandomUUID() }));

jest.mock('@/shared/storage', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest.fn().mockResolvedValue({
    accessToken: 'old-access',
    refreshToken: 'old-refresh',
  }),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  hasStoredToken: jest.fn().mockResolvedValue(true),
}));

const {
  push: mockPush,
  replace: mockReplace,
  dismissTo: mockDismissTo,
  back: mockBack,
} = routerSpies;
// TRIP-708: replace 도 같은 지연-참조 목으로 준다 — 탭바가 replace 를 쓰지 않음을 P-13 이 관찰한다.
// TRIP-1262: 복제 탭바는 replace 가 아니라 dismissTo 로 항법한다 — 같은 지연-참조 목(P-13 이 관찰).
// region 은 '더 담기'가 여행지 여러 곳을 같은 키로 반복해 실으면 배열이 된다(expo-router 규약) —
// P-9(다지역)를 위해 배열도 허용한다(단일지역 케이스 P-2 는 string 그대로 유효).
// TRIP-1026: 위저드 출처 파라미터(`wizardOriginParams()`)도 같은 창구로 싣는다 — 키 이름을 테스트가
// 손으로 적지 않도록 값 타입만 넓힌다.
let mockParams: Record<string, string | string[] | undefined> = {};

// 정적 `router` 싱글턴과 `useRouter()` 훅을 **둘 다** 같은 목으로 준다 — 배선이 어느 쪽을
// 쓰든 이 파일의 단언은 같다(리포에 두 선례가 공존한다: StaySearchPage vs TripNewStep1Page).
// ★ 훅·명령형 호출은 공용 목의 기록장(`routerSpies`)에 쌓인다 — `mockPush` 등은 그 별칭이다. 옛 인라인 목은
// `router: { push: mockPush }` 처럼 팩토리가 즉시 읽으면 hoist 때문에 undefined 가 박혀 화살표로 감싸야 했지만(실측),
// 이제 팩토리는 핸들을 읽지 않는다.
// TRIP-1026 AC-4 가 뒤로 버튼까지 누른다 — 없으면 `router.back is not a function` 으로 죽는다.
// TRIP-1093: 위저드 출처 ♥ 가 뒤로 간다 — 구현이 훅 쪽 back 을 골라도 같은 mockBack 에 모인다.
jest.mock('expo-router', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@/test-support/expoRouterMock').createExpoRouterMock({
    useRouter: ['push', 'replace', 'back', 'dismissTo'],
    router: ['push', 'replace', 'back', 'dismissTo'],
    params: () => ({ ...mockParams }),
  })
);

/** authWiring.integration.test.ts:59 와 같은 값(리포 관례). */

function makePlace(
  poiId: string,
  nameKo: string,
  category: Place['category'],
  region: string | null,
  savedCount: number
): Place {
  return {
    poiId,
    nameKo,
    category,
    lat: 35.1587,
    lng: 129.1604,
    region,
    openingHours: null,
    imageUrl: null,
    tags: [],
    savedCount,
    dataStatus: 'ACTIVE',
  };
}

/** 서버가 주는 순서는 savedCount 순서와 다르다 — 화면 순서가 곧 클라 정렬의 증거가 된다. */
const PLACES: Place[] = [
  makePlace('p1', '감천문화마을', '명소', '사하구', 12),
  makePlace('p2', '광안리 해변', '야경', '수영구', 30),
  makePlace('p3', '전포 카페거리', '카페', null, 7),
  makePlace('p4', '해동용궁사', '명소', '기장군', 3),
  makePlace('p5', '자갈치 시장', '맛집', '중구', 21),
];

function savedRowOf(poiId: string): SavedPlace {
  return {
    savedPlaceId: `saved-${poiId}`,
    savedAt: '2026-08-01T00:00:00Z',
    place: PLACES.find((place) => place.poiId === poiId) ?? PLACES[0],
  };
}

/** 서버가 실제로 들고 있는 담은 목록 — POST/DELETE 가 이 배열을 고친다(★ 겹②). */
let savedRows: SavedPlace[] = [];
let gate = createGate();
// 상태·예외 관점(S-*) 전용 문 둘 — `/places` 응답과 `POST` 를 따로 세운다(아래 그 describe 의 beforeEach).
let placesGate = createGate();
let saveGate = createGate();
let observed: { method: string; url: string }[] = [];

function hitsOf(method: string, pathname: string) {
  return observed.filter(
    (hit) => hit.method === method && new URL(hit.url).pathname === pathname
  );
}

/**
 * 지역 미지정일 때 d04 가 묻는 지역 이름 — 서비스 지역 상수(`SERVICE_REGIONS`)에서 파생한다.
 * 빌드 환경값 `EXPO_PUBLIC_TEST_REGIONS`(부천 등)가 있으면 상수 뒤에 붙으므로 이름을 손으로 적지 않는다
 * (jest 환경에는 그 값이 없어 지금은 서울·부산·제주 셋 — P-16 첫 케이스가 앞 셋을 앵커로 굳힌다).
 */
const SERVICE_REGION_NAMES = SERVICE_REGIONS.map((region) => region.name);
/** 지역 미지정 조회 한 번(파도)이 내는 `/places` 요청 수 = 서비스 지역 수. 지역별 병렬 발사라 순서는 안 굳힌다. */
const WAVE = SERVICE_REGION_NAMES.length;

/** 나간 `/places` 요청들의 `region` 값(없으면 null). */
function regionsOf(hits: { url: string }[]): (string | null)[] {
  return hits.map((hit) => new URL(hit.url).searchParams.get('region'));
}

/** 한 파도의 요청이 서비스 지역 전부를 정확히 한 번씩 덮는다 — region 없는 전국 요청(null)이 섞이면 red. */
function expectWaveCoversServiceRegions(hits: { url: string }[]): void {
  expect([...regionsOf(hits)].sort()).toEqual([...SERVICE_REGION_NAMES].sort());
}

function cardTestIds(): string[] {
  return screen
    .getAllByTestId(/^explore-places-card-/)
    .map((node) => String(node.props.testID));
}

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  server.events.on('request:start', ({ request }) => {
    observed.push({ method: request.method, url: request.url });
  });
});

let uuidSeq = 0;

beforeEach(() => {
  uuidSeq = 0;
  mockRandomUUID.mockImplementation(
    () => `00000000-0000-4000-8000-${String((uuidSeq += 1)).padStart(12, '0')}`
  );
  observed = [];
  savedRows = [];
  mockParams = {};
  mockPush.mockClear();
  mockReplace.mockClear();
  mockDismissTo.mockClear();
  mockBack.mockClear();
  clearAccessToken();
  // 기본 gate 는 열려 있다 — "즉시 반영"을 재는 케이스만 닫힌 문으로 갈아 끼운다.
  gate = createGate();
  gate.release();

  // 기본 handlers.ts 에 places 계열이 0건이고 `onUnhandledRequest: 'error'` 라, 안 건 요청은
  // 조용히 통과하지 않고 에러가 된다 — 그 성질을 그대로 쓴다.
  server.use(
    http.get(`${BASE}/places`, ({ request }) => {
      const url = new URL(request.url);
      const category = url.searchParams.get('category');
      const q = url.searchParams.get('q');
      // 서버가 category·q(이름 부분일치)로 거른다(TRIP-502) — 응답은 {items, nextCursor}.
      let result = PLACES;
      if (category !== null) {
        result = result.filter((place) => place.category === category);
      }
      if (q) result = result.filter((place) => place.nameKo.includes(q));
      return HttpResponse.json({ items: result, nextCursor: null });
    }),
    http.get(`${BASE}/saved-places`, () => HttpResponse.json(savedRows)),
    http.post(`${BASE}/saved-places`, async ({ request }) => {
      await gate.opened;
      const body = (await request.json()) as { poiId: string };
      const row = savedRowOf(body.poiId);
      savedRows = [...savedRows, row];
      return HttpResponse.json(row, { status: 201 });
    }),
    http.delete(`${BASE}/saved-places/:savedPlaceId`, async ({ params }) => {
      await gate.opened;
      savedRows = savedRows.filter(
        (row) => row.savedPlaceId !== params.savedPlaceId
      );
      return new HttpResponse(null, { status: 204 });
    })
  );
});

/** 서버 계약(openapi /places)의 seed 규칙 — random 이면 필수이고 이 모양이어야 400 이 아니다. */
const SEED_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

afterEach(() => {
  // TRIP-1563 INV-4 — 어느 테스트에서든 order 를 실은 요청은 규칙에 맞는 seed 도 실었다(시드 없는 random → 서버 400 → 목록이 비는 침묵 실패 방지).
  hitsOf('GET', '/api/v1/places').forEach((hit) => {
    const query = new URL(hit.url).searchParams;
    if (query.has('order')) expect(query.get('seed')).toMatch(SEED_PATTERN);
  });
  server.resetHandlers();
  // 연타 가드 창은 모듈 싱글턴 — 앞 테스트가 연 창이 다음 테스트로 새지 않게 닫는다(TRIP-1282).
  resetPressGuard();
});

afterAll(() => server.close());

/** 목록이 도착해 카드가 그려진 상태까지 만든다 — 이후 증가분이 곧 이 칸의 사정거리다. */
async function renderPage() {
  render(<PlaceExplorePage />, { wrapper: createGcZeroWrapper() });
  await waitFor(() =>
    expect(
      screen.getAllByTestId(/^explore-places-card-/).length
    ).toBeGreaterThan(0)
  );
}

describe('P-1 · 카테고리 칩은 서버를 다시 부른다 (AC-3)', () => {
  it('선택한 category 가 요청 URL 에 실리고, 응답이 카드에 반영되며, 그 칩만 활성이다', async () => {
    setAccessToken('valid-access');

    await renderPage();

    // 앵커 — 첫 조회(지역 미지정 = 서비스 지역별 한 파도, TRIP-1560)엔 category 필터가 없다.
    const first = hitsOf('GET', '/api/v1/places');
    expect(first).toHaveLength(WAVE);
    first.forEach((hit) =>
      expect(new URL(hit.url).searchParams.get('category')).toBeNull()
    );

    fireEvent.press(screen.getByTestId('explore-places-category-food'));

    // 새 파도가 한 번 더 나간다(첫 파도 WAVE + 둘째 파도 WAVE). 순서는 안 굳히고 둘째 파도 전체를 본다.
    await waitFor(() =>
      expect(hitsOf('GET', '/api/v1/places')).toHaveLength(2 * WAVE)
    );
    // URL.searchParams.get() 이 퍼센트 인코딩을 자동으로 되돌리므로 한글 비교가 성립한다.
    // '맛집'은 계약 enum 값 자체라 ASCII 로 바꿀 수 없다.
    const second = hitsOf('GET', '/api/v1/places').slice(WAVE);
    second.forEach((hit) =>
      expect(new URL(hit.url).searchParams.get('category')).toBe('맛집')
    );

    // 재조회 결과가 실제로 화면에 닿았다 — URL 만 보면 "보내고 버리는" 구현도 통과한다.
    await waitFor(() =>
      expect(cardTestIds()).toEqual(['explore-places-card-p5'])
    );
    expect(screen.getByTestId('explore-places-category-food')).toBeSelected();
    expect(
      screen.getByTestId('explore-places-category-all')
    ).not.toBeSelected();
  });
});

describe('P-2 · region 라우트 파라미터 (01b Seed Q9)', () => {
  it('라우트에 region 이 있으면 그대로 싣는다', async () => {
    setAccessToken('valid-access');
    // ASCII 를 쓴다 — 한글은 퍼센트 인코딩되어 실패 메시지를 읽을 수 없다(리포 관례).
    mockParams = { region: 'jeju' };

    await renderPage();

    const hits = hitsOf('GET', '/api/v1/places');
    expect(hits).toHaveLength(1);
    expect(new URL(hits[0].url).searchParams.get('region')).toBe('jeju');

    // TRIP-692 AC-4 — 단일/0지역은 usePlacesInfinite 경로라 degraded 개념이 없다
    // (페이지가 항상 false 전달) → 배너 없음. 선제 green 회귀 앵커.
    expect(screen.queryByTestId('explore-places-partialfailure')).toBeNull();
  });
});

describe('P-3 · 검색은 서버가 한다 (q) — 로드된 페이지 한정이 아니다 (AC-8 · TRIP-502)', () => {
  it('서버가 준 순서를 그대로 그리고, 검색어를 넣으면 q 로 서버를 다시 부른다', async () => {
    setAccessToken('valid-access');

    await renderPage();

    // 서버가 준 순서 그대로 그린다 — 클라 재정렬 없음(정렬은 서버 소유=이름순, TRIP-502).
    // 예전엔 visiblePlaces 가 savedCount 내림차순으로 클라 정렬했으나 그 층을 걷어냈다.
    expect(cardTestIds()).toEqual([
      'explore-places-card-p1',
      'explore-places-card-p2',
      'explore-places-card-p3',
      'explore-places-card-p4',
      'explore-places-card-p5',
    ]);

    fireEvent.changeText(screen.getByTestId('explore-places-search'), '해변');

    // 검색은 서버가 한다 — q 를 실은 새 요청이 나가고, 서버가 거른 결과만 남는다(로드된 페이지 한정 아님).
    await waitFor(() =>
      expect(cardTestIds()).toEqual(['explore-places-card-p2'])
    );
    // 정확값 — 첫 조회 한 파도 + '해변' 한 파도(TRIP-1617: 디바운스가 있어도 한 번에 통째로 넣은 검색어는 한 파도다).
    const hits = hitsOf('GET', '/api/v1/places');
    expect(hits).toHaveLength(2 * WAVE);
    expect(new URL(hits[hits.length - 1].url).searchParams.get('q')).toBe(
      '해변'
    );
  });
});

describe('P-4 · 담기 — 응답 전에 낙관 반영되고 재조회 후에도 유지된다 (AC-4)', () => {
  it('서버가 답하기 전에 담음 배지·하트가 켜지고, 재조회 후에도 유지된다', async () => {
    setAccessToken('valid-access');

    await renderPage();

    // 앵커 — 담기 전에는 담음 배지가 없다(TRIP-708: CTA 숫자 표시는 소멸, ♥ FAB→d02 로 이동).
    expect(hitsOf('GET', '/api/v1/saved-places')).toHaveLength(1);
    expect(
      within(screen.getByTestId('explore-places-card-p2')).queryAllByText(
        '담음'
      )
    ).toHaveLength(0);

    gate = createGate(); // 이 시점부터 POST 는 문 뒤에 선다
    fireEvent.press(screen.getByTestId('explore-places-save-p2'));

    await waitFor(() =>
      expect(screen.getByTestId('explore-places-save-p2')).toBeSelected()
    );
    expect(
      within(screen.getByTestId('explore-places-card-p2')).getByText('담음')
    ).toBeOnTheScreen();

    // 요청은 실제로 나갔고(낙관만 하고 안 보내는 구현이 아니다), **아직 답은 오지 않았다**
    // — 무효화 재조회가 0건인 것이 그 증거다.
    expect(hitsOf('POST', '/api/v1/saved-places')).toHaveLength(1);
    expect(hitsOf('GET', '/api/v1/saved-places')).toHaveLength(1);

    gate.release();

    await waitFor(() =>
      expect(hitsOf('GET', '/api/v1/saved-places')).toHaveLength(2)
    );
    // 서버 진실이 도착해도 담김이 유지된다(목이 낙관 반영과 정합이므로 이 단언은 타이밍이
    // 아니라 "무효화 뒤 상태"를 잰다).
    expect(
      within(screen.getByTestId('explore-places-card-p2')).getByText('담음')
    ).toBeOnTheScreen();
  });
});

describe('P-5 · 해제 — 낙관 제거되고 savedPlaceId 로 나간다 (AC-5)', () => {
  it('응답 전에 배지·하트가 빠지고, 해제 요청이 담기 기록 id 를 싣는다', async () => {
    setAccessToken('valid-access');
    savedRows = [savedRowOf('p1')];

    await renderPage();
    await waitFor(() =>
      expect(screen.getByTestId('explore-places-save-p1')).toBeSelected()
    );

    gate = createGate();
    fireEvent.press(screen.getByTestId('explore-places-save-p1'));

    await waitFor(() =>
      expect(screen.getByTestId('explore-places-save-p1')).not.toBeSelected()
    );
    expect(
      within(screen.getByTestId('explore-places-card-p1')).queryAllByText(
        '담음'
      )
    ).toHaveLength(0);

    // 담기 기록 id 로 나갔다. 부정 짝이 없으면 poiId 를 실은 구현이 404 를 받고, 그 실패가
    // 롤백에 흡수되어 "동작은 하는데 아무것도 안 되는" 모양으로 조용히 남는다.
    expect(hitsOf('DELETE', '/api/v1/saved-places/saved-p1')).toHaveLength(1);
    expect(hitsOf('DELETE', '/api/v1/saved-places/p1')).toHaveLength(0);

    gate.release();
    await waitFor(() =>
      expect(hitsOf('GET', '/api/v1/saved-places')).toHaveLength(2)
    );
  });
});

describe('P-6 · ＋ FAB 는 여행 생성 1/2 로 보낸다 (AC-1 · AC-6 · US-SHELL-05)', () => {
  it('＋ FAB 를 누르면 /trips/new/step1 로 이동한다 (담은 수 무관 · CtaBar 대체)', async () => {
    setAccessToken('valid-access');
    savedRows = [savedRowOf('p1')];

    await renderPage();

    fireEvent.press(screen.getByTestId('explore-places-create-fab'));

    expect(mockPush.mock.calls).toEqual([['/trips/new/step1']]);
  });
});

describe('P-12 · ♥ FAB 는 담은 장소(d02)로 보낸다 (AC-1 · 3-a)', () => {
  it('♥ FAB 를 누르면 /explore/saved-places 로 이동한다', async () => {
    setAccessToken('valid-access');

    await renderPage();

    fireEvent.press(screen.getByTestId('explore-places-saved-fab'));

    // onPressSavedPlaces 를 페이지가 배선하지 않으면(옵셔널 미전달) 무동작이라 push 0 → red.
    expect(mockPush.mock.calls).toEqual([['/explore/saved-places']]);
  });
});

describe('P-13 · 복제 BottomTabBar 는 dismissTo 로 항법한다 (AC-1 · TRIP-1262)', () => {
  it('탭을 누르면 router.dismissTo 로 그 탭 라우트로 간다 (home→/(tabs), 나머지→/{key})', async () => {
    setAccessToken('valid-access');

    await renderPage();

    fireEvent.press(screen.getByTestId('shell-tabbar-tab-home'));
    fireEvent.press(screen.getByTestId('shell-tabbar-tab-records'));

    // TRIP-1262 반전: replace 는 이 화면 하나만 (tabs) 로 바꿔 아래 스택(위저드 등)을 남겼다(QA F4).
    // dismissTo 는 스택 밑의 (tabs) 까지 걷어낸다 — 없으면(콜드 오픈) 지금 화면을 교체한다.
    // TRIP-1076: 홈은 '/' 가 아니라 '/(tabs)' — 경로는 공용 shellTabHref 가 정한다.
    expect(mockDismissTo.mock.calls).toEqual([['/(tabs)'], ['/records']]);
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  });
});

describe('P-15 · 페이지가 다시 그려져도 마운트된 카드는 재렌더되지 않는다 (TRIP-1349)', () => {
  it('공백만 입력(페이지 state 변경 · 재조회 없음)이 카드를 다시 그리지 않는다 — 콜백 참조가 안정이다', async () => {
    // TRIP-1562 — 옛 트리거(카테고리 시트 열기)가 사라져, 같은 성질의 트리거로 바꿨다: 검색어 state 는
    // 바뀌지만(페이지 재렌더) trim 결과가 '' 그대로라 조회 키가 안 바뀐다(목록·카드 데이터 불변).
    setAccessToken('valid-access');
    await renderPage();
    const subtitle = PlaceSubtitle as unknown as jest.Mock;
    const before = subtitle.mock.calls.length;
    expect(before).toBeGreaterThan(0);
    const fetchesBefore = hitsOf('GET', '/api/v1/places').length;

    fireEvent.changeText(screen.getByTestId('explore-places-search'), ' ');

    // 페이지가 실제로 다시 그려졌다 — 입력값이 state 를 거쳐 돌아왔다(무반응이면 이 앵커가 red).
    await waitFor(() =>
      expect(screen.getByTestId('explore-places-search')).toHaveProp(
        'value',
        ' '
      )
    );
    // 재조회가 없었다 — 카드가 다시 그려질 "정당한" 이유(새 데이터)가 없는 상황임을 보장한다.
    expect(hitsOf('GET', '/api/v1/places')).toHaveLength(fetchesBefore);

    expect(subtitle.mock.calls.length).toBe(before);
  });
});

describe('🔴 P-14 · TRIP-1562 — 카테고리 시트는 어떤 조작으로도 열리지 않는다', () => {
  it('검색바 ⇅ 버튼이 없고, 칩·검색을 조작해도 시트가 마운트되지 않으며 칩 선택은 그대로 동작한다', async () => {
    setAccessToken('valid-access');
    await renderPage();

    // 시트를 여는 입구 자체가 없다.
    expect(screen.queryByTestId('explore-places-filter')).toBeNull();

    // 화면에 있는 조작을 차례로 해 본다 — 가로 칩 선택·해제, 검색어 입력.
    fireEvent.press(screen.getByTestId('explore-places-category-food'));
    await waitFor(() =>
      expect(screen.getByTestId('explore-places-category-food')).toBeSelected()
    );
    fireEvent.press(screen.getByTestId('explore-places-category-all'));
    await waitFor(() =>
      expect(screen.getByTestId('explore-places-category-all')).toBeSelected()
    );
    fireEvent.changeText(screen.getByTestId('explore-places-search'), '해운대');

    // 어떤 시점에도 시트·시트 칩이 트리에 없다.
    expect(screen.queryByTestId('explore-places-category-sheet')).toBeNull();
    expect(
      screen.queryAllByTestId(/^explore-places-sheet-category-/)
    ).toHaveLength(0);
  });
});

describe('P-7 · 게스트는 담은 목록을 아예 부르지 않는다 (01b Seed Q1 · BR-U1-03)', () => {
  it('토큰이 없으면 GET /saved-places 가 0건이고, 목록은 정상으로 뜬다', async () => {
    // 서버에는 담은 기록이 있다 — 그래도 요청을 보내지 않는 것이 규칙이다.
    savedRows = [savedRowOf('p1')];

    await renderPage();

    // 장소 목록이 왕복을 **끝냈다**면 담은 목록 요청도 이미 나갔어야 한다 — 그래서 이 0건은
    // "아직 안 나갔다"가 아니라 "안 나간다"다.
    expect(hitsOf('GET', '/api/v1/places')).toHaveLength(WAVE);
    expect(hitsOf('GET', '/api/v1/saved-places')).toHaveLength(0);

    // 긍정 짝 — 화면은 정상으로 돌았다(목록 열람은 미로그인도 가능한 화면이다).
    expect(cardTestIds()).toHaveLength(5);
    expect(
      within(screen.getByTestId('explore-places-card-p1')).queryAllByText(
        '담음'
      )
    ).toHaveLength(0);
  });
});

describe('P-8 · 지역 한 곳을 고르면 커서로 이어 받는다 (무한 스크롤 · TRIP-502 · AC-3)', () => {
  it('목록 끝에 닿으면 nextCursor 로 다음 장을 이어 받는다', async () => {
    setAccessToken('valid-access');
    // 지역 미지정은 서비스 지역별 단발 조회라 이어받기가 없다(TRIP-1560) — 한 곳 선택 경로가 이 심판의 자리다.
    mockParams = { region: 'jeju' };
    const PAGE2 = [makePlace('p6', '태종대', '명소', '영도구', 5)];
    // 첫 장은 nextCursor 를 주고, cursor 가 실린 요청엔 다음 장을 준다.
    server.use(
      http.get(`${BASE}/places`, ({ request }) => {
        const cursor = new URL(request.url).searchParams.get('cursor');
        return cursor
          ? HttpResponse.json({ items: PAGE2, nextCursor: null })
          : HttpResponse.json({ items: PLACES, nextCursor: 'CURSOR_2' });
      })
    );

    await renderPage();
    expect(cardTestIds()).toHaveLength(5);
    // 앵커 — 첫 장은 그 한 곳으로 정확히 1회 나갔다(다지역 파도로 새지 않는다).
    expect(regionsOf(hitsOf('GET', '/api/v1/places'))).toEqual(['jeju']);

    // 목록 끝에 닿음 → 다음 장 요청. onEndReached 배선을 지우면 p6 가 안 와 red 가 된다(뮤테이션 심판).
    fireEvent(screen.getByTestId('explore-places-grid'), 'endReached');

    await waitFor(() =>
      expect(screen.getByTestId('explore-places-card-p6')).toBeOnTheScreen()
    );
    // 첫 장 + 다음 장이 함께 그려진다(5 + 1).
    expect(cardTestIds()).toHaveLength(6);
    // 다음 장 요청에 cursor 가 실린다(첫 요청엔 없다).
    const hits = hitsOf('GET', '/api/v1/places');
    expect(new URL(hits[hits.length - 1].url).searchParams.get('cursor')).toBe(
      'CURSOR_2'
    );
    // 이어받기 요청도 같은 한 곳이고, 단일 지역 경로엔 부분 실패 배너가 없다.
    expect(regionsOf(hits)).toEqual(['jeju', 'jeju']);
    expect(screen.queryByTestId('explore-places-partialfailure')).toBeNull();
  });
});

describe('P-9 · 다지역이면 지역별로 조회해 한 목록에 합쳐 그린다 (TRIP-687 · code-critic 경고-1 봉합)', () => {
  // 부산·경주 각각 다른 장소를 준다 — poiId 가 안 겹쳐 병합 후에도 4장이 모두 남는다.
  const BUSAN: Place[] = [
    makePlace('b1', '감천문화마을', '명소', '부산광역시', 12),
    makePlace('b2', '광안리 해변', '야경', '부산광역시', 30),
  ];
  const GYEONGJU: Place[] = [
    makePlace('g1', '불국사', '명소', '경주시', 40),
    makePlace('g2', '첨성대', '명소', '경주시', 15),
  ];

  it('getPlaces 가 지역마다 한 번씩(2회) 나가고, 부산·경주 장소가 한 목록에 함께 그려진다', async () => {
    setAccessToken('valid-access');
    // 라우트가 여행지 2곳을 배열로 실어 보낸다 → PlaceExplorePage 가 다지역 병합 경로로 갈린다.
    mockParams = { region: ['부산광역시', '경주시'] };
    // region 파라미터로 갈라 지역별 응답을 준다(P-8 의 server.use 오버라이드 선례와 동형).
    // region 이 없는 헛조회가 새면 빈 목록이 오고, 아래 "정확히 2회" 단언이 그것을 red 로 잡는다.
    server.use(
      http.get(`${BASE}/places`, ({ request }) => {
        const region = new URL(request.url).searchParams.get('region');
        if (region === '부산광역시')
          return HttpResponse.json({ items: BUSAN, nextCursor: null });
        if (region === '경주시')
          return HttpResponse.json({ items: GYEONGJU, nextCursor: null });
        return HttpResponse.json({ items: [], nextCursor: null });
      })
    );

    await renderPage();

    // ① fan-out — 지역당 정확히 1회씩, 총 2회. 다지역인데 usePlacesInfinite 가 enabled 게이팅이
    //    깨져 단일 조회가 하나 더 나가면 3회, regions.map 이 둘째 지역을 빠뜨리면 1회가 되어 둘 다 red.
    const hits = hitsOf('GET', '/api/v1/places');
    expect(hits).toHaveLength(2);

    // ② 나간 두 요청의 region 이 부산·경주 각각이다(발사 순서는 안 굳힌다 — 두 값의 존재만 본다).
    const regionsCalled = hits.map((hit) =>
      new URL(hit.url).searchParams.get('region')
    );
    expect(regionsCalled).toContain('부산광역시');
    expect(regionsCalled).toContain('경주시');

    // ③ 병합 결과 — 부산 2곳 + 경주 2곳이 한 목록에 함께 뜬다(입력 순서 보존 = 부산 먼저).
    //    둘째 지역 누락 뮤턴트면 경주 카드(g1·g2)가 없어 red.
    //    TRIP-1563: d04 는 시드를 들고 있어 지역을 번갈아 놓는다(부산1·경주1·부산2·경주2) — 지역 블록이 아니다.
    expect(cardTestIds()).toEqual([
      'explore-places-card-b1',
      'explore-places-card-g1',
      'explore-places-card-b2',
      'explore-places-card-g2',
    ]);

    // TRIP-692 AC-3 — 전부 성공이면 degraded 가 false 라 배너가 없다(회귀 앵커: 배너가
    // 잘못 뜨면 red). 부재 단언이라 구현 전에도 통과하는 선제 green.
    expect(screen.queryByTestId('explore-places-partialfailure')).toBeNull();
  });
});

describe('P-10 · 다지역 부분 성공 — 한 지역이 실패해도 나머지는 뜬다 (TRIP-691 · RESILIENCY · INV-4)', () => {
  // 부산은 응답, 경주는 500 으로 실패시킨다. Promise.all 이면 한쪽 실패가 전체를 error 로 접어
  // 부산 장소도 안 뜬다(부분 성공 없음). Promise.allSettled 로 바꾸면 성공한 부산만 병합돼 뜬다.
  const BUSAN: Place[] = [
    makePlace('b1', '감천문화마을', '명소', '부산광역시', 12),
    makePlace('b2', '광안리 해변', '야경', '부산광역시', 30),
  ];

  it('경주 조회가 실패해도 부산 장소는 그대로 뜬다 (부분 성공, AC-1)', async () => {
    setAccessToken('valid-access');
    // 준비(Arrange) — 여행지 2곳, 경주만 서버 500.
    mockParams = { region: ['부산광역시', '경주시'] };
    server.use(
      http.get(`${BASE}/places`, ({ request }) => {
        const region = new URL(request.url).searchParams.get('region');
        if (region === '부산광역시')
          return HttpResponse.json({ items: BUSAN, nextCursor: null });
        // 경주는 실패 — allSettled 면 조용히 탈락, all 이면 전체가 error 로 접힌다.
        return new HttpResponse(null, { status: 500 });
      })
    );

    // 실행(Act) — 화면을 그린다.
    render(<PlaceExplorePage />, { wrapper: createGcZeroWrapper() });

    // 단언(Assert) — 부산 두 장이 뜨고(부분 성공), 경주는 없다, error 얼굴도 아니다.
    await waitFor(() =>
      expect(screen.getByTestId('explore-places-card-b1')).toBeTruthy()
    );
    expect(screen.getByTestId('explore-places-card-b2')).toBeTruthy();
    expect(screen.queryByTestId('explore-places-card-g1')).toBeNull();
    expect(screen.queryByTestId('explore-places-error')).toBeNull();
  });

  it('모든 지역이 실패하면 error 얼굴을 보인다 — 빈 목록을 성공으로 위장하지 않는다 (AC-2, INV-4)', async () => {
    setAccessToken('valid-access');
    // 준비 — 두 지역 다 500. allSettled 라도 "전부 실패면 throw" 가드가 없으면 빈 목록을
    // 성공으로 위장해 error 가 안 뜬다. 이 케이스가 그 가드를 강제한다.
    mockParams = { region: ['부산광역시', '경주시'] };
    server.use(
      http.get(`${BASE}/places`, () => new HttpResponse(null, { status: 500 }))
    );

    render(<PlaceExplorePage />, { wrapper: createGcZeroWrapper() });

    // 단언 — 조회 실패 안내(다시 시도)가 뜨고 카드는 없다.
    await waitFor(() =>
      expect(screen.getByTestId('explore-places-error')).toBeTruthy()
    );
    expect(screen.queryByTestId('explore-places-card-b1')).toBeNull();

    // TRIP-692 AC-2 — 전부 실패는 훅이 throw(lists.length===0) → error 얼굴이지 degraded 가
    // 아니다. degraded 배너와 error 얼굴이 섞이지 않음을 잠근다(기존 throw 경로 무변경 회귀 앵커).
    expect(screen.queryByTestId('explore-places-partialfailure')).toBeNull();
  });
});

describe('P-11 · 다지역 부분 실패면 degraded 배너를 얹고 다시 시도가 실제 재조회한다 (TRIP-692 · AC-1 · AC-6)', () => {
  // 부산은 응답, 경주는 500. Promise.allSettled 라 부산은 병합돼 뜨고, 경주 실패로 degraded 가
  // 참이 된다 — 그때 성공 목록 위에 배너가 얹힌다. degraded 는 서버 필드가 아니라 이 성공/실패
  // 개수에서 클라가 파생한다(brief §맹점① — /places 응답엔 degraded 필드가 없어 아래 핸들러도
  // {items,nextCursor} 만 준다).
  const BUSAN: Place[] = [
    makePlace('b1', '감천문화마을', '명소', '부산광역시', 12),
    makePlace('b2', '광안리 해변', '야경', '부산광역시', 30),
  ];

  function usePartialFailureHandler() {
    mockParams = { region: ['부산광역시', '경주시'] };
    server.use(
      http.get(`${BASE}/places`, ({ request }) => {
        const region = new URL(request.url).searchParams.get('region');
        if (region === '부산광역시')
          return HttpResponse.json({ items: BUSAN, nextCursor: null });
        // 경주는 실패 — allSettled 가 부분 실패로 접어 degraded=true.
        return new HttpResponse(null, { status: 500 });
      })
    );
  }

  it('부분 실패면 부산 카드는 그대로 뜨고 그 위에 배너가 얹힌다 — error 얼굴이 아니다 (AC-1)', async () => {
    setAccessToken('valid-access');
    usePartialFailureHandler();

    render(<PlaceExplorePage />, { wrapper: createGcZeroWrapper() });

    // 배너가 뜬다(성공분은 살아 있고 부분 실패만 알린다).
    await waitFor(() =>
      expect(
        screen.getByTestId('explore-places-partialfailure')
      ).toBeOnTheScreen()
    );
    // 부산 두 장은 그대로 — degraded 는 목록을 지우지 않고 표식만 얹는다.
    expect(screen.getByTestId('explore-places-card-b1')).toBeOnTheScreen();
    expect(screen.getByTestId('explore-places-card-b2')).toBeOnTheScreen();
    // 부분 실패는 전부 실패(error 얼굴)와 구분된다.
    expect(screen.queryByTestId('explore-places-error')).toBeNull();
  });

  it('배너의 "다시 시도"를 누르면 지역별 재조회가 실제로 다시 나간다 (AC-6, 스텁 금지)', async () => {
    setAccessToken('valid-access');
    usePartialFailureHandler();

    render(<PlaceExplorePage />, { wrapper: createGcZeroWrapper() });
    await waitFor(() =>
      expect(
        screen.getByTestId('explore-places-partialfailure')
      ).toBeOnTheScreen()
    );

    // 누르기 전 앵커 — 다지역 fan-out 은 지역당 1건씩 정확히 2건(P-9 가 이미 실행으로 확정).
    // 이게 없으면 아래 "4건"이 재요청인지 최초 2번인지 구분이 안 된다.
    expect(hitsOf('GET', '/api/v1/places')).toHaveLength(2);

    fireEvent.press(screen.getByTestId('explore-places-partialfailure-retry'));

    // refetch 1회 = queryFn 1회 재실행 = allSettled 가 지역당 1건씩 = +2 → 총 4건.
    // onRetry 가 refetch 에 실제로 물려 있어야만(스텁이면) 새 요청이 나간다.
    await waitFor(() =>
      expect(hitsOf('GET', '/api/v1/places')).toHaveLength(4)
    );
  });
});

describe('P-16 · 지역을 안 고르면 서비스 지역(서울·부산·제주)별로 조회한다 (TRIP-1560 · AC-1 · AC-4)', () => {
  // 기본 핸들러는 region 을 안 보고 같은 5장을 주고 병합이 poiId 중복을 거른다 — 그래서 카드만 봐서는 전국
  // 조회와 서비스 지역 조회가 구분되지 않는다. 지역별로 **다른** 장소를 주는 핸들러를 걸어(P-9 선례),
  // 요청 URL(region)과 "세 지역 결과가 한 목록에 섞인다"를 함께 본다. region 이 없는 요청(전국 누수)은 기본 5장을 받는다 —
  // 빈 응답이면 카드 대기 타임아웃으로 죽어 원인이 안 보이므로, 누수가 요청 수·region 단언에서 선명히 red 가 나게 한다.
  const SEOUL: Place[] = [
    makePlace('s1', '경복궁', '명소', '서울', 50),
    makePlace('s2', '남산타워', '야경', '서울', 40),
  ];
  const BUSAN: Place[] = [makePlace('b1', '감천문화마을', '명소', '부산', 12)];
  const JEJU: Place[] = [makePlace('j1', '성산일출봉', '명소', '제주', 60)];

  /** 지역별 응답 — `failing` 에 든 지역은 500. region 없는 요청(전국 누수)은 기본 5장 — 요청 수·region 단언이 잡는다. */
  function useRegionResponder(failing: string[] = []) {
    server.use(
      http.get(`${BASE}/places`, ({ request }) => {
        const region = new URL(request.url).searchParams.get('region');
        if (region !== null && failing.includes(region))
          return new HttpResponse(null, { status: 500 });
        const items =
          region === '서울'
            ? SEOUL
            : region === '부산'
              ? BUSAN
              : region === '제주'
                ? JEJU
                : PLACES;
        return HttpResponse.json({ items, nextCursor: null });
      })
    );
  }

  it('서비스 지역 상수의 앞 셋은 서울·부산·제주다 (테스트 기대값의 앵커)', () => {
    // 아래 케이스는 지역 이름을 SERVICE_REGIONS 에서 파생한다 — 제품 결정(3지역)이 바뀌면 여기서 먼저 red 가 난다.
    expect(SERVICE_REGION_NAMES.slice(0, 3)).toEqual(['서울', '부산', '제주']);
  });

  it('region 이 없는 요청은 0회이고 지역마다 한 번씩 나가며, 세 지역 장소가 한 목록에 섞여 뜬다 (AC-1)', async () => {
    setAccessToken('valid-access');
    useRegionResponder();

    await renderPage();

    // ① 요청 — 지역당 정확히 1회(총 WAVE), 서울·부산·제주 각각. region 없는 전국 조회가 새면 null 이 섞여 red.
    const hits = hitsOf('GET', '/api/v1/places');
    expect(hits).toHaveLength(WAVE);
    expectWaveCoversServiceRegions(hits);
    expect(regionsOf(hits)).not.toContain(null);

    // ② 결과 — 세 지역 장소가 지역을 번갈아(서울1·부산1·제주1·서울2) 한 목록에 있다(응답 도착 순서가 아니라 입력 순서 기준).
    //    TRIP-1563: 시드가 있는 d04 는 지역 블록(s1,s2,b1,j1)이 아니라 라운드 로빈이다.
    expect(cardTestIds()).toEqual([
      'explore-places-card-s1',
      'explore-places-card-b1',
      'explore-places-card-j1',
      'explore-places-card-s2',
    ]);
    // 전부 성공이면 부분 실패 배너가 없다.
    expect(screen.queryByTestId('explore-places-partialfailure')).toBeNull();
    expect(screen.queryByTestId('explore-places-error')).toBeNull();
  });

  it('카테고리 칩·검색어를 걸어도 그 필터를 실은 채 서비스 지역별로 나간다 (AC-1)', async () => {
    setAccessToken('valid-access');
    useRegionResponder();
    await renderPage();

    fireEvent.press(screen.getByTestId('explore-places-category-food'));
    await waitFor(() =>
      expect(hitsOf('GET', '/api/v1/places')).toHaveLength(2 * WAVE)
    );
    const categoryWave = hitsOf('GET', '/api/v1/places').slice(WAVE, 2 * WAVE);
    expectWaveCoversServiceRegions(categoryWave);
    categoryWave.forEach((hit) => {
      const params = new URL(hit.url).searchParams;
      expect({ category: params.get('category'), q: params.get('q') }).toEqual({
        category: '맛집',
        q: null,
      });
    });

    fireEvent.changeText(screen.getByTestId('explore-places-search'), '해변');
    await waitFor(() =>
      expect(hitsOf('GET', '/api/v1/places')).toHaveLength(3 * WAVE)
    );
    const searchWave = hitsOf('GET', '/api/v1/places').slice(2 * WAVE);
    expectWaveCoversServiceRegions(searchWave);
    searchWave.forEach((hit) => {
      const params = new URL(hit.url).searchParams;
      expect({ category: params.get('category'), q: params.get('q') }).toEqual({
        category: '맛집',
        q: '해변',
      });
    });

    // 어느 파도에서도 region 없는 요청이 나가지 않았다.
    expect(regionsOf(hitsOf('GET', '/api/v1/places'))).not.toContain(null);
  });

  it('세 지역 중 한 곳만 실패하면 받은 지역 카드 위에 부분 실패 배너가 얹히고, 다시 시도가 서비스 지역 전부를 재조회한다 (AC-4)', async () => {
    setAccessToken('valid-access');
    useRegionResponder(['부산']);

    render(<PlaceExplorePage />, { wrapper: createGcZeroWrapper() });

    await waitFor(() =>
      expect(
        screen.getByTestId('explore-places-partialfailure')
      ).toBeOnTheScreen()
    );
    // 받은 두 지역(서울·제주)은 그대로 뜨고, 실패한 부산은 없다 — error 얼굴이 아니라 배너다.
    // TRIP-1563: 살아남은 서울·제주도 번갈아 놓인다(서울1·제주1·서울2).
    expect(cardTestIds()).toEqual([
      'explore-places-card-s1',
      'explore-places-card-j1',
      'explore-places-card-s2',
    ]);
    expect(screen.queryByTestId('explore-places-error')).toBeNull();
    // 앵커 — 누르기 전엔 첫 파도뿐이다(아래 증분이 재요청임을 보장).
    expect(hitsOf('GET', '/api/v1/places')).toHaveLength(WAVE);

    fireEvent.press(screen.getByTestId('explore-places-partialfailure-retry'));

    // 재조회는 성공한 지역까지 포함한 전부 — 실패한 한 곳만 다시 묻는 구현이면 증분이 1 이라 red.
    await waitFor(() =>
      expect(hitsOf('GET', '/api/v1/places')).toHaveLength(2 * WAVE)
    );
    expectWaveCoversServiceRegions(hitsOf('GET', '/api/v1/places').slice(WAVE));
  });
});

describe('P-17 · 진입마다 새 시드로 무작위 순서를 묻는다 (TRIP-1563)', () => {
  // 개념: **시드(seed)** 는 "섞는 방법을 정하는 번호표"다. 같은 번호표면 서버가 늘 같은 순서를, 바꾸면 다른 순서를 준다.
  // 이 describe 가 보증하는 것은 "올바른 번호표를 모든 요청에 싣는다"까지다 — 실제로 섞여 보이는지는 서버 테스트와 6-b 몫이다.
  const queryOf = (hit: { url: string }) => new URL(hit.url).searchParams;
  const allPlaceHits = () => hitsOf('GET', '/api/v1/places');

  /** 이 요청들이 전부 order=random 과 규칙에 맞는 seed 를 실었다. */
  function expectRandomWithSeed(hits: { url: string }[]): void {
    expect(hits.length).toBeGreaterThan(0);
    hits.forEach((hit) => {
      expect(queryOf(hit).get('order')).toBe('random');
      expect(queryOf(hit).get('seed')).toMatch(SEED_PATTERN);
    });
  }

  /** 위에 더해 요청들이 **같은 하나의** seed 를 썼다 — 그 seed 를 돌려준다. */
  function expectOneSharedSeed(hits: { url: string }[]): string {
    expectRandomWithSeed(hits);
    const seeds = new Set(hits.map((hit) => queryOf(hit).get('seed')));
    expect([...seeds]).toHaveLength(1);
    return [...seeds][0] as string;
  }

  it('지역이 한 곳이면 첫 조회가 order=random 과 규칙에 맞는 seed 를 싣는다 (AC-1)', async () => {
    setAccessToken('valid-access');
    mockParams = { region: 'jeju' };

    await renderPage();

    const hits = allPlaceHits();
    expect(hits).toHaveLength(1);
    expectRandomWithSeed(hits);
  });

  it.each<[string, Record<string, string | string[]>, number]>([
    ['지역 미지정(서비스 지역 전부)', {}, WAVE],
    ['지역 2곳', { region: ['부산광역시', '경주시'] }, 2],
  ])(
    '%s 이면 지역별 요청 전부가 같은 order=random&seed 를 싣는다 (AC-2)',
    async (_label, routeParams, expectedRequests) => {
      setAccessToken('valid-access');
      mockParams = routeParams;

      await renderPage();

      const hits = allPlaceHits();
      expect(hits).toHaveLength(expectedRequests);
      expectOneSharedSeed(hits);
    }
  );

  it.each<[string, Record<string, string>, number]>([
    ['지역 한 곳', { region: 'jeju' }, 1],
    ['지역 미지정', {}, WAVE],
  ])(
    '%s: 닫았다 다시 들어오면 새 seed 로 서버에 새로 묻는다 — 지난 진입의 캐시를 읽지 않는다 (AC-3 · AC-7)',
    async (_label, routeParams, perEntry) => {
      setAccessToken('valid-access');
      mockParams = routeParams;
      // 캐시를 오래 들고 stale 도 되지 않는 클라이언트 — gcTime 0 래퍼로는 "지난 캐시를 읽는 사고"가 안 보인다.
      const client = newTestQueryClient({ staleTime: Infinity });
      const wrapper = createWrapper(client);

      const firstEntry = render(<PlaceExplorePage />, { wrapper });
      await waitFor(() =>
        expect(
          screen.getAllByTestId(/^explore-places-card-/).length
        ).toBeGreaterThan(0)
      );
      const firstSeed = expectOneSharedSeed(allPlaceHits());
      expect(allPlaceHits()).toHaveLength(perEntry);
      firstEntry.unmount();

      render(<PlaceExplorePage />, { wrapper });

      // 두 번째 진입은 요청이 새로 나가 누계가 정확히 2배가 된다(캐시 히트면 그대로라 여기서 시간 초과로 red).
      await waitFor(() => expect(allPlaceHits()).toHaveLength(2 * perEntry));
      const secondSeed = expectOneSharedSeed(allPlaceHits().slice(perEntry));
      expect(secondSeed).not.toBe(firstSeed);
      client.clear();
    }
  );

  it('지역 한 곳에서 다음 장을 이어 받을 때 cursor 와 함께 첫 장과 같은 seed·order 를 싣고, 카드는 중복이 없다 (AC-4)', async () => {
    setAccessToken('valid-access');
    mockParams = { region: 'jeju' };
    const PAGE2 = [makePlace('p6', '태종대', '명소', '영도구', 5)];
    server.use(
      http.get(`${BASE}/places`, ({ request }) => {
        const cursor = new URL(request.url).searchParams.get('cursor');
        return cursor
          ? HttpResponse.json({ items: PAGE2, nextCursor: null })
          : HttpResponse.json({ items: PLACES, nextCursor: 'CURSOR_2' });
      })
    );
    await renderPage();

    fireEvent(screen.getByTestId('explore-places-grid'), 'endReached');
    await waitFor(() =>
      expect(screen.getByTestId('explore-places-card-p6')).toBeOnTheScreen()
    );

    const hits = allPlaceHits();
    expect(hits).toHaveLength(2);
    expect(queryOf(hits[0]).get('cursor')).toBeNull();
    expect(queryOf(hits[1]).get('cursor')).toBe('CURSOR_2');
    expectOneSharedSeed(hits);
    const cards = cardTestIds();
    expect(cards).toHaveLength(6);
    expect(new Set(cards).size).toBe(6);
  });

  it('지역 미지정에서 카테고리 칩·검색어를 바꿔도 새 요청 전부가 같은 seed 를 쓴다 (AC-5)', async () => {
    setAccessToken('valid-access');
    await renderPage();

    fireEvent.press(screen.getByTestId('explore-places-category-food'));
    await waitFor(() => expect(allPlaceHits()).toHaveLength(2 * WAVE));
    fireEvent.changeText(screen.getByTestId('explore-places-search'), '해변');
    await waitFor(() => expect(allPlaceHits()).toHaveLength(3 * WAVE));

    // 세 파도(첫 조회 · 칩 · 검색어) 전체가 하나의 번호표를 쓴다.
    expectOneSharedSeed(allPlaceHits());
  });

  it('부분 실패 배너의 다시 시도도 같은 seed 로 재조회한다 — 실패 후 재시도에 목록이 뒤바뀌지 않는다 (AC-5)', async () => {
    setAccessToken('valid-access');
    server.use(
      http.get(`${BASE}/places`, ({ request }) => {
        const region = new URL(request.url).searchParams.get('region');
        return region === SERVICE_REGION_NAMES[1]
          ? new HttpResponse(null, { status: 500 })
          : HttpResponse.json({ items: PLACES, nextCursor: null });
      })
    );
    render(<PlaceExplorePage />, { wrapper: createGcZeroWrapper() });
    await waitFor(() =>
      expect(
        screen.getByTestId('explore-places-partialfailure')
      ).toBeOnTheScreen()
    );

    fireEvent.press(screen.getByTestId('explore-places-partialfailure-retry'));
    await waitFor(() => expect(allPlaceHits()).toHaveLength(2 * WAVE));

    expectOneSharedSeed(allPlaceHits());
  });

  it('지역 한 곳에서도 칩·검색어를 바꾸면 같은 seed 를 쓴다 (AC-5)', async () => {
    setAccessToken('valid-access');
    mockParams = { region: 'jeju' };
    await renderPage();

    fireEvent.press(screen.getByTestId('explore-places-category-food'));
    await waitFor(() => expect(allPlaceHits()).toHaveLength(2));
    fireEvent.changeText(screen.getByTestId('explore-places-search'), '해변');
    await waitFor(() => expect(allPlaceHits()).toHaveLength(3));

    expectOneSharedSeed(allPlaceHits());
  });

  it('같은 화면 인스턴스에서 지역만 바뀌어도(지역 바꾸기) seed 는 그대로다 (AC-6)', async () => {
    setAccessToken('valid-access');
    const { rerender } = render(<PlaceExplorePage />, {
      wrapper: createGcZeroWrapper(),
    });
    await waitFor(() =>
      expect(
        screen.getAllByTestId(/^explore-places-card-/).length
      ).toBeGreaterThan(0)
    );
    const enterSeed = expectOneSharedSeed(allPlaceHits());
    expect(allPlaceHits()).toHaveLength(WAVE);

    // dismissTo 로 기존 d04 가 앞으로 당겨지며 라우트 파라미터만 바뀌는 상황 — 새 마운트가 아니다.
    mockParams = { region: 'jeju' };
    rerender(<PlaceExplorePage />);
    await waitFor(() => expect(allPlaceHits()).toHaveLength(WAVE + 1));

    const afterChange = allPlaceHits()[WAVE];
    expect(queryOf(afterChange).get('region')).toBe('jeju');
    expect(queryOf(afterChange).get('seed')).toBe(enterSeed);
    expect(queryOf(afterChange).get('order')).toBe('random');
  });
});

// ── TRIP-1012 B1 · 새 진입점은 이동 직전 위저드 드래프트를 비운다 (#074 · D9) ─────────────
// d04 ＋ FAB 는 명시적인 "새 여행"이라 비운다. 위저드 '더 담기'로 들어온 d04 에는 TRIP-1026 이후 ＋ 가
// 없다(아래 1026 AC-1). push 가 불리는 **그 순간** 드래프트가 스토어 초기값인지 잰다.
afterEach(resetWizardDraft);

describe('P-18 · 검색은 300ms 멈춰야 서버를 부른다 — 글자마다 부르지 않는다 (TRIP-1617)', () => {
  // 개념: **디바운스**는 "입력이 멈춘 뒤 N ms 가 지나야 반영"하는 기법이다. 서버 키(q)만 늦추고 입력칸 글자는 즉시 보인다.
  // 실시간 타이머를 쓴다(이 파일 관례 — msw·TanStack 알림이 실제 비동기라 가짜 시계와 섞으면 멈춘다).
  const STEPS = ['감', '감천', '감천문화', '감천문화마', '감천문화마을'];
  const FINAL = '감천문화마을';
  const qOf = (hit: { url: string }) => new URL(hit.url).searchParams.get('q');
  const sleep = (ms: number) =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, ms));
    });

  /** 키 입력 간격(실제 타이핑은 100ms 안팎)으로 글자를 하나씩 늘려 입력한다 — 이 간격이면 디바운스 없는 구현은 글자마다 요청이 나간다. */
  async function typeSteps(steps: string[]) {
    for (const text of steps) {
      fireEvent.changeText(screen.getByTestId('explore-places-search'), text);
      await sleep(60);
    }
  }

  // 느린 서버 케이스의 문 — 실패해도 끝에 연다(붙잡힌 응답이 남으면 jest 가 안 끝난다).
  let slowGate = createGate();
  beforeEach(() => {
    slowGate = createGate();
  });
  afterEach(() => {
    slowGate.release();
  });

  it('AC1 · 지역 미지정에서 5글자를 연달아 쳐도 새 요청은 최종 검색어 한 파도(지역당 1건)뿐이다', async () => {
    setAccessToken('valid-access');
    await renderPage();
    const before = hitsOf('GET', '/api/v1/places').length;
    // 앵커 — 첫 조회 한 파도.
    expect(before).toBe(WAVE);

    await typeSteps(STEPS);

    await waitFor(() =>
      expect(cardTestIds()).toEqual(['explore-places-card-p1'])
    );
    // 최종 파도 도착 뒤에도 300ms+ 더 흘려 늦게 나오는 요청까지 센다 — 안 흘리면 "더는 없다"가 공허하다.
    await sleep(400);
    const fresh = hitsOf('GET', '/api/v1/places').slice(before);
    expect(fresh).toHaveLength(WAVE);
    expectWaveCoversServiceRegions(fresh);
    // 중간 글자('감'·'감천'…) 요청은 한 건도 없다 — 새 요청 전부가 최종 검색어다.
    fresh.forEach((hit) => expect(qOf(hit)).toBe(FINAL));
  });

  it('AC1 · 지역 한 곳(단일 지역 경로)에서도 5글자를 연달아 쳐도 새 요청은 최종 검색어 1건뿐이다', async () => {
    setAccessToken('valid-access');
    mockParams = { region: 'jeju' };
    await renderPage();
    const before = hitsOf('GET', '/api/v1/places').length;
    expect(before).toBe(1);

    await typeSteps(STEPS);

    await waitFor(() =>
      expect(cardTestIds()).toEqual(['explore-places-card-p1'])
    );
    await sleep(400);
    const fresh = hitsOf('GET', '/api/v1/places').slice(before);
    expect(fresh).toHaveLength(1);
    expect(qOf(fresh[0])).toBe(FINAL);
  });

  it('AC6 · 입력칸 글자는 바로 보이고, 300ms 가 지나기 전엔 새 요청이 없다가 지나면 최종 검색어 한 파도가 나간다', async () => {
    setAccessToken('valid-access');
    await renderPage();
    const before = hitsOf('GET', '/api/v1/places').length;

    fireEvent.changeText(screen.getByTestId('explore-places-search'), '해변');

    // 입력칸은 즉시 — 서버 키만 늦춘다.
    expect(screen.getByTestId('explore-places-search')).toHaveProp(
      'value',
      '해변'
    );
    // 디바운스 창 안(80ms < 300ms)이라 아직 새 요청이 없다.
    await sleep(80);
    expect(hitsOf('GET', '/api/v1/places')).toHaveLength(before);

    // 창이 지나면 요청은 사라지지 않고 나간다(디바운스가 요청을 삼키는 구현 방지).
    await waitFor(() =>
      expect(hitsOf('GET', '/api/v1/places')).toHaveLength(before + WAVE)
    );
    await waitFor(() =>
      expect(cardTestIds()).toEqual(['explore-places-card-p2'])
    );
  });

  it('AC2·AC3 · 느린 서버에서 검색어를 바꾸면 옛 검색어 요청이 전부 끊기고, 오류 얼굴·부분 실패 배너는 한 번도 안 뜬다', async () => {
    setAccessToken('valid-access');
    await renderPage();
    // 신호 관측은 서버 쪽에서 한다 — 앱이 보낸 요청의 AbortSignal 이 끊겼는지를 msw 가 `request.signal` 로 안다
    // (훅 내부 스파이가 아니라 네트워크 경계 기준이라 "신호를 읽지 않아 안 끊기는" 회귀가 그대로 보인다).
    const seen: { q: string | null; signal: AbortSignal }[] = [];
    server.use(
      http.get(`${BASE}/places`, async ({ request }) => {
        const q = new URL(request.url).searchParams.get('q');
        seen.push({ q, signal: request.signal });
        if (q === '해') await slowGate.opened; // '해' 만 느리다 — '해변' 은 즉시 답한다
        const items = q ? PLACES.filter((p) => p.nameKo.includes(q)) : PLACES;
        return HttpResponse.json({ items, nextCursor: null });
      })
    );
    const seenOf = (q: string) => seen.filter((entry) => entry.q === q);

    fireEvent.changeText(screen.getByTestId('explore-places-search'), '해');
    // 디바운스가 지난 뒤 '해' 한 파도가 출발했고, 서버가 붙잡고 있다(앵커 — 없으면 아래 aborted 가 공허하다).
    await waitFor(() => expect(seenOf('해')).toHaveLength(WAVE));
    expect(screen.getByTestId('explore-places-loading')).toBeOnTheScreen();
    seenOf('해').forEach((entry) => expect(entry.signal.aborted).toBe(false));

    fireEvent.changeText(screen.getByTestId('explore-places-search'), '해변');
    await waitFor(() =>
      expect(cardTestIds()).toEqual(['explore-places-card-p2'])
    );

    // 옛 요청 전부 끊김 · 새 요청은 안 끊김 · 호출 수 정확값(재시도·중복 없음).
    expect(seenOf('해')).toHaveLength(WAVE);
    seenOf('해').forEach((entry) => expect(entry.signal.aborted).toBe(true));
    expect(seenOf('해변')).toHaveLength(WAVE);
    seenOf('해변').forEach((entry) => expect(entry.signal.aborted).toBe(false));
    expect(screen.queryByTestId('explore-places-error')).toBeNull();
    expect(screen.queryByTestId('explore-places-partialfailure')).toBeNull();

    // 붙잡힌 옛 응답이 뒤늦게 풀려도 얼굴은 그대로다 — 끊긴 요청의 뒤늦은 결과가 새 결과를 덮거나 오류로 새지 않는다.
    slowGate.release();
    await sleep(100);
    expect(screen.queryByTestId('explore-places-error')).toBeNull();
    expect(screen.queryByTestId('explore-places-partialfailure')).toBeNull();
    expect(cardTestIds()).toEqual(['explore-places-card-p2']);
    expect(seenOf('해')).toHaveLength(WAVE);
  });

  it('D1 · 0건 검색어를 입력칸에서 지우는 300ms 창에도 "조건이 걸린 0건" 얼굴이 그대로이고 "담긴 장소가 없어요" 로 바뀌지 않는다', async () => {
    setAccessToken('valid-access');
    await renderPage();
    fireEvent.changeText(
      screen.getByTestId('explore-places-search'),
      '없는이름'
    );
    await waitFor(() =>
      expect(screen.getByTestId('explore-places-filterzero')).toBeOnTheScreen()
    );

    fireEvent.changeText(screen.getByTestId('explore-places-search'), '');

    // 지운 바로 그 렌더 — 입력칸은 비었는데(즉시) 화면 얼굴은 아직 직전 서버 키 기준이다.
    // 검색어 유무 판정이 입력값을 보면 여기서 "담긴 장소가 없어요"(empty)가 깜빡이고, 키는 안 바뀌었는데 목록 판정만 바뀐 거짓 얼굴이 된다.
    expect(screen.getByTestId('explore-places-search')).toHaveProp('value', '');
    expect(screen.queryByTestId('explore-places-empty')).toBeNull();
    expect(screen.getByTestId('explore-places-filterzero')).toBeOnTheScreen();

    // 창이 지나면 전체 목록으로 돌아온다.
    await waitFor(() => expect(cardTestIds()).toHaveLength(5));
    expect(screen.queryByTestId('explore-places-empty')).toBeNull();
  });
});

describe('🔴 1012-B1 · d04 ＋ FAB 는 직전 드래프트를 비우고 위저드로 간다', () => {
  it('push 시점의 드래프트가 새 여행의 초기값이고, push 는 step1 로 1회다', async () => {
    leavePreviousTripDraft();
    // 앵커 — 아직 안 비었다(픽스처가 조용히 망가지면 아래 단언이 공짜로 통과한다).
    expect(wizardDraftData()).not.toEqual(freshWizardDraft());
    expect(useTripWizardStore.getState().destinations).toHaveLength(1);
    const draftAtPush = captureDraftAtNextCall(mockPush);
    setAccessToken('valid-access');
    savedRows = [savedRowOf('p1')];

    await renderPage();
    fireEvent.press(screen.getByTestId('explore-places-create-fab'));

    expect(mockPush.mock.calls).toEqual([['/trips/new/step1']]);
    expect(draftAtPush()).toEqual(freshWizardDraft());
  });
});

// ── TRIP-1026 · 위저드에서 들어온 d04 는 ＋ FAB 를 그리지 않는다 (결정 1 = 숨김) ─────────────
// 출처 신호는 push 파라미터다. 파라미터는 **헬퍼 출력(`wizardOriginParams()`)으로만** 싣는다 —
// 테스트가 'from'·'wizard' 를 손으로 적으면 수신자 철자가 틀려도 이 파일이 green 이 된다(AC-6).
// ⚠️ 헬퍼 호출은 it 본문 안에서만 한다(it.each 표에서 부르면 수집 단계에서 파일째 죽는다).
// 드래프트 리셋은 위 파일 최상위 `afterEach(resetWizardDraft)` 가 맡는다(모듈 싱글턴 누수 방지).

describe('🔴 1026 AC-1 · 위저드 출처면 ＋ FAB 가 없고 ♥ FAB 는 남는다', () => {
  it.each([
    { name: 'W2 d02 select 더 담기(여행 지역과 함께)', region: ['부산광역시'] },
    { name: 'W2·W3 d02 select 더 담기·둘러보기(지역 없이)', region: undefined },
  ])('$name', async ({ region }) => {
    mockParams = { ...(region ? { region } : {}), ...wizardOriginParams() };

    await renderPage();

    expect(screen.queryByTestId('explore-places-create-fab')).toBeNull();
    expect(screen.getByTestId('explore-places-saved-fab')).toBeOnTheScreen();
  });
});

describe('1026 AC-3 · region 만으로는 위저드 출처가 아니다 (d03 모두 보기·지역 피커 무회귀)', () => {
  it('region 만 싣고 오면 ＋ FAB 가 있고, 누르면 드래프트를 비운 뒤 step1 로 간다', async () => {
    // region 은 위저드 밖(d03 '모두 보기'·피커 places)도 싣는다 — 이걸 신호로 쓰면 그 경로의 ＋ 가 사라진다.
    leavePreviousTripDraft();
    expect(wizardDraftData()).not.toEqual(freshWizardDraft());
    const draftAtPush = captureDraftAtNextCall(mockPush);
    mockParams = { region: '부산광역시' };

    await renderPage();
    fireEvent.press(screen.getByTestId('explore-places-create-fab'));

    expect(mockPush.mock.calls).toEqual([['/trips/new/step1']]);
    expect(draftAtPush()).toEqual(freshWizardDraft());
  });
});

describe('🔴 1026 AC-4 · 위저드 출처 d04 에서 무엇을 눌러도 진행 중 드래프트가 그대로다', () => {
  it('화면의 버튼을 전부 눌러도 드래프트가 누르기 전과 같고, step1 으로 가지 않는다', async () => {
    // 준비 — 1/4 에서 손으로 채운 드래프트(여행지·기간·꼭 갈 곳 등 전 필드).
    leavePreviousTripDraft();
    const before = wizardDraftData();
    // 앵커 — 채워졌다(픽스처가 조용히 망가지면 "그대로다"가 공짜로 통과한다).
    expect(before).not.toEqual(freshWizardDraft());
    mockParams = { region: ['부산광역시'], ...wizardOriginParams() };
    await renderPage();

    // 실행 — 지금 화면의 버튼을 **뒤에서부터** 전부 누른다. 앞(칩)부터 누르면 목록이 로딩으로
    // 바뀌어 뒤쪽 카드가 트리에서 빠진다 — 뒤(탭바·FAB·카드)부터 누르면 누를 대상이 끝까지 남는다.
    const buttons = screen.getAllByRole('button');
    const pressedIds = buttons.map((node) => String(node.props.testID));
    // 모집단 앵커 — 실제로 여러 버튼을 눌렀고, 그중에 ♥ FAB·카드 하트·뒤로가 있다.
    expect(pressedIds).toEqual(
      expect.arrayContaining([
        'explore-places-saved-fab',
        'explore-places-save-p1',
        'explore-places-back',
      ])
    );
    [...buttons].reverse().forEach((button) => fireEvent.press(button));

    // 단언 — 드래프트가 누르기 전과 같다. 비동기 담기 시도가 **끝난 표시**(게스트라 결국 뜨는 로그인
    // 안내)를 먼저 기다린 뒤 동기로 본다 — `waitFor` 로 비교하면 첫 검사에서 같으면 바로 끝나
    // `await` 뒤의 변경을 못 잡는다(5-b 경고-1, 오케 보강).
    await screen.findByTestId('explore-places-saveerror-login');
    expect(wizardDraftData()).toEqual(before);
    expect(mockPush.mock.calls).not.toContainEqual(['/trips/new/step1']);
  });
});

// ── TRIP-1093 결정 2 · 위저드 출처 d04 에서 위저드 진행분이 지워지는 길을 없앤다 ─────────────────
// 위저드 출처 d04 를 여는 곳은 이제 d02 select 하나뿐이다(옛 가드 wizardOriginProducers 는 TRIP-1145 로 지웠다) — 그래서 ♥ 는
// 새 d02(save 모드 → 「이 장소들로 여행 만들기」 = reset)를 여는 대신 한 칸 뒤(d02 select)로 돌아간다(01b Q2 A3).
// 비위저드 ♥ 는 P-12 그대로 push 다(짝). 실제 스택이 d02 select 로 돌아가는지는 jest 가 못 본다(6-b).
// 드래프트 리셋은 위 파일 최상위 `afterEach(resetWizardDraft)` 가 맡는다.

describe('🔴 1093 AC-6 · 위저드 출처 d04 의 ♥ 는 한 칸 뒤로 간다 — save 모드 d02 를 열지 않는다', () => {
  it('♥ 를 누르면 back 1회·push 0회이고, 드래프트가 누르기 전과 같다', async () => {
    leavePreviousTripDraft();
    const before = wizardDraftData();
    // 앵커 — 채워졌다(픽스처가 조용히 망가지면 "그대로다"가 공짜로 통과한다).
    expect(before).not.toEqual(freshWizardDraft());
    mockParams = { region: ['부산광역시'], ...wizardOriginParams() };
    await renderPage();

    fireEvent.press(screen.getByTestId('explore-places-saved-fab'));

    expect(mockBack).toHaveBeenCalledTimes(1);
    // push 가 한 번도 없다 — 파라미터를 바꿔 d02 를 새로 여는 구현(select 로 push)도 여기서 red.
    expect(mockPush.mock.calls).toEqual([]);
    expect(wizardDraftData()).toEqual(before);
  });
});

describe('🔒 1093 AC-4 · 위저드 출처 d04 의 하트는 담기만 한다 — 꼭 갈 곳은 그대로 (INV-U1-04)', () => {
  it('로그인 상태에서 하트를 누르면 담기 요청이 1건 나가고, 꼭 갈 곳·뺀 목록·드래프트가 누르기 전과 같다', async () => {
    // 준비 — 꼭 갈 곳 1곳(poi-prev-1)·뺀 곳 1곳(poi-prev-2)이 있는 위저드 드래프트.
    leavePreviousTripDraft();
    const before = wizardDraftData();
    const mustVisitsBefore = useTripWizardStore.getState().mustVisits;
    const excludedBefore =
      useTripWizardStore.getState().excludedMustVisitPoiIds;
    expect(mustVisitsBefore).toHaveLength(1);
    expect(excludedBefore).toEqual(['poi-prev-2']);
    // 게스트면 담기 요청이 아예 안 나가 "담기만"을 잴 수 없다(1026 AC-4 는 게스트판).
    setAccessToken('valid-access');
    mockParams = { region: ['부산광역시'], ...wizardOriginParams() };
    await renderPage();

    fireEvent.press(screen.getByTestId('explore-places-save-p1'));

    // 담기는 실제로 나갔고, 무효화 재조회까지 끝났다 — 이 "끝난 표시"를 먼저 기다린 뒤 동기로 본다
    // (waitFor 로 스토어를 비교하면 첫 검사에서 같아 바로 끝나, 그 뒤의 변경을 못 잡는다).
    await waitFor(() =>
      expect(hitsOf('POST', '/api/v1/saved-places')).toHaveLength(1)
    );
    await waitFor(() =>
      expect(hitsOf('GET', '/api/v1/saved-places')).toHaveLength(2)
    );
    expect(useTripWizardStore.getState().mustVisits).toEqual(mustVisitsBefore);
    expect(useTripWizardStore.getState().excludedMustVisitPoiIds).toEqual(
      excludedBefore
    );
    expect(wizardDraftData()).toEqual(before);
  });
});

// ── TRIP-1023 칸 B #026 · d04 지역 칩(결정5 · Seed Q4·Q5·Q6) ─────────────────────────────────
// 라벨은 라우트 `region` 을 배열로 편 값에서 나온다(없음 → "전체 지역", 한 곳 → 이름, 여러 곳 → "{첫} 외 N곳").
// 칩 목적지는 어디서 왔든 같다 — 지역 선택 places(Seed Q6). 기대 URL 은 **헬퍼 출력**
// (`regionPickerHref('places')`)으로만 적는다 — 테스트가 철자를 손으로 적으면 헬퍼·수신자 철자가 틀려도
// green 이 된다(TRIP-985 규약). 복귀 시 다지역·`from` 파라미터 소실은 Seed Q6 가 새 티켓 후보로 넘겼다
// (jest 가 원리적으로 못 보는 `dismissTo` 교체 — traps-explore).

describe('🔴 1023-B #026 · 지역 칩 라벨은 라우트 region 에서 나온다 (AC-B5 · AC-B6 · AC-B10)', () => {
  it('region 이 없으면(탐색 탭·홈 "장소 더 보기") 칩이 "전체 지역" 이고 "전국" 은 없다 (TRIP-1560 AC-2)', async () => {
    await renderPage();

    // 앵커 — 조회도 전국이 아니라 서비스 지역별이다(칩 문구와 실제 조회 범위가 같은 말을 한다).
    expectWaveCoversServiceRegions(hitsOf('GET', '/api/v1/places'));
    const chip = screen.getByTestId('explore-places-region');
    // 긍정 앵커를 먼저 — 칩이 실제로 그려졌고 새 라벨이 떠 있다. 이게 있어야 아래 "전국 없음"이 공허하지 않다.
    expect(within(chip).getByText('전체 지역')).toBeOnTheScreen();
    expect(within(chip).queryByText('전국')).toBeNull();
  });

  it('region 이 한 곳이면 그 이름(피커가 싣는 한글 이름 그대로)이 라벨이다', async () => {
    mockParams = { region: '강릉시' };

    await renderPage();

    const chip = screen.getByTestId('explore-places-region');
    expect(within(chip).getByText('강릉시')).toBeOnTheScreen();
    expect(within(chip).queryByText('전체 지역')).toBeNull();
  });

  it('region 이 여러 곳(더 담기)이면 "{첫 지역} 외 N곳" 이다', async () => {
    mockParams = { region: ['부산광역시', '경주시'] };
    // 다지역 fan-out 경로(P-9)라 지역별로 서로 다른 카드를 준다 — 같은 poiId 가 겹치지 않게.
    server.use(
      http.get(`${BASE}/places`, ({ request }) => {
        const region = new URL(request.url).searchParams.get('region');
        const items =
          region === '부산광역시'
            ? [makePlace('b1', '감천문화마을', '명소', '부산광역시', 12)]
            : region === '경주시'
              ? [makePlace('g1', '불국사', '명소', '경주시', 40)]
              : [];
        return HttpResponse.json({ items, nextCursor: null });
      })
    );

    await renderPage();

    expect(
      within(screen.getByTestId('explore-places-region')).getByText(
        '부산광역시 외 1곳'
      )
    ).toBeOnTheScreen();
  });
});

describe('🔴 1023-B #026 · 칩을 누르면 어디서 왔든 지역 선택(places)으로 간다 (AC-B7 · Seed Q6)', () => {
  it.each([
    { name: '지역 없음(전체 지역)', region: undefined, wizard: false },
    { name: '한 곳', region: '강릉시', wizard: false },
    { name: '다지역', region: ['부산광역시', '경주시'], wizard: false },
    { name: '위저드 출처(더 담기)', region: ['부산광역시'], wizard: true },
  ])('$name', async ({ region, wizard }) => {
    // 헬퍼 호출은 it 본문 안에서만 한다(위 1026 절 주석 — 표에서 부르면 수집 단계에서 죽는다).
    mockParams = {
      ...(region ? { region } : {}),
      ...(wizard ? wizardOriginParams() : {}),
    };

    await renderPage();
    fireEvent.press(screen.getByTestId('explore-places-region'));

    // 빈 상태 "다른 지역 보기"(states 통합 테스트)와 같은 목적지 — push 한 번, 다른 곳으로는 안 간다.
    expect(mockPush.mock.calls).toEqual([[regionPickerHref('places')]]);
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockBack).not.toHaveBeenCalled();
  });
});

// ── 상태·예외 배선 S-1~S-12 (옛 `PlaceExplorePage.states.integration.test.tsx`) ───────────────────
// 옛 파일의 기본 핸들러를 그대로 다시 건다 — `/places` 는 `placesGate` 뒤에 서고 `q` 만 거른다
// (위 기본 핸들러는 category 도 거르고 문이 없다. S-1 스켈레톤이 이 문에 기댄다). `POST` 는 `saveGate`
// 뒤에 선다(S-9). 옛 `renderLoaded`(카드가 뜰 때까지 기다림)는 위 `renderPage` 와 몸통이 같아 그것을
// 쓰고, 옛 `renderPage`(그리기만)는 `renderNow` 로 이름을 갈랐다.
describe('상태·예외 배선 (S-1~S-12)', () => {
  beforeEach(() => {
    // 두 문 다 기본은 열려 있다 — "응답 전"을 재는 케이스만 닫힌 문으로 갈아 끼운다.
    placesGate = createGate();
    placesGate.release();
    saveGate = createGate();
    saveGate.release();

    server.use(
      http.get(`${BASE}/places`, async ({ request }) => {
        await placesGate.opened;
        // 서버가 q(이름 부분일치)로 거른다(TRIP-502) — 검색은 서버 몫이라 이 스텁도 q 를 반영한다.
        const q = new URL(request.url).searchParams.get('q');
        const result = q ? PLACES.filter((p) => p.nameKo.includes(q)) : PLACES;
        return HttpResponse.json({ items: result, nextCursor: null });
      }),
      http.post(`${BASE}/saved-places`, async ({ request }) => {
        await saveGate.opened;
        const body = (await request.json()) as { poiId: string };
        const row = savedRowOf(body.poiId);
        savedRows = [...savedRows, row];
        return HttpResponse.json(row, { status: 201 });
      })
    );
  });

  // 상태·예외 케이스는 어느 것도 화면을 떠나지 않는다 — 실패·재시도·로그인 안내는 이 화면 안의
  // 얼굴·배너로 끝나고, 나가는 길은 push 뿐이다(S-2·S-5 가 그 push 를 따로 단언한다). 옛 파일은
  // 라우터 목에 push 만 있어 back·replace 를 부르면 TypeError 로 red 였다. 합치며 본 파일 목
  // (push·replace·back)을 물려받아 그 그물이 사라져, 같은 성질을 여기서 명시로 건다.
  afterEach(() => {
    expect(mockBack).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  /** 그리기만 한다 — 첫 조회가 문 뒤에 서 있는 동안을 재는 케이스(S-1·S-2·S-4)용. */
  function renderNow() {
    render(<PlaceExplorePage />, { wrapper: createGcZeroWrapper() });
  }

  /** 카드가 하나도 없을 때 빈 배열을 돌려준다(위 `cardTestIds` 는 0장이면 throw). */
  function cardTestIdsOrNone(): string[] {
    return screen
      .queryAllByTestId(/^explore-places-card-/)
      .map((node) => String(node.props.testID));
  }

  describe('S-1 · 첫 조회 중에는 스켈레톤이 뜬다 (AC-4)', () => {
    it('응답 전에는 스켈레톤 4장이고, 응답이 오면 카드로 바뀐다', async () => {
      setAccessToken('valid-access');
      placesGate = createGate(); // 이 시점부터 GET /places 는 문 뒤에 선다

      renderNow();

      await waitFor(() =>
        expect(screen.getByTestId('explore-places-loading')).toBeOnTheScreen()
      );
      expect(screen.getAllByTestId(/^explore-places-skeleton-/)).toHaveLength(
        4
      );
      expect(cardTestIdsOrNone()).toEqual([]);
      // B안 — 뷰 단위에서 옮김: 라벨·검색 placeholder, 그리고 로딩 얼굴에도 ♥·＋ FAB·지역 칩이 남는다.
      expect(screen.getByText('장소를 모으는 중')).toBeOnTheScreen();
      expect(screen.getByPlaceholderText('장소 · 명소 · 맛집 검색')).toHaveProp(
        'testID',
        'explore-places-search'
      );
      expect(screen.getByTestId('explore-places-saved-fab')).toBeOnTheScreen();
      expect(screen.getByTestId('explore-places-create-fab')).toBeOnTheScreen();
      expect(screen.getByTestId('explore-places-region')).toBeOnTheScreen();

      placesGate.release();

      await waitFor(() => expect(cardTestIdsOrNone()).toHaveLength(5));
      // 스켈레톤이 카드와 함께 남아 있으면 화면이 두 얼굴을 동시에 보인다.
      expect(screen.queryByTestId('explore-places-loading')).toBeNull();
    });
  });

  describe('S-2 · 0건이면 다른 지역으로 보낸다 (AC-5 · 01b Seed Q4)', () => {
    it('안내가 뜨고 "다른 지역 보기"가 d04 지역 교체용 지역 선택(purpose=places)으로 보낸다', async () => {
      setAccessToken('valid-access');
      server.use(
        http.get(`${BASE}/places`, () =>
          HttpResponse.json({ items: [], nextCursor: null })
        )
      );

      renderNow();

      await waitFor(() =>
        expect(screen.getByTestId('explore-places-empty')).toBeOnTheScreen()
      );
      expect(
        within(screen.getByTestId('explore-places-empty')).getByText(
          '담긴 장소가 없어요'
        )
      ).toBeOnTheScreen();

      fireEvent.press(screen.getByTestId('explore-places-empty-region'));

      // d04 는 여행지 맥락이다(01b Seed Q4 ⓐ). TRIP-985: 고른 지역은 위저드가 아니라 이 d04 의 지역을
      // 바꿔야 하므로 위저드 전용 trip 이 아니라 places 로 간다.
      expect(mockPush.mock.calls).toEqual([[regionPickerHref('places')]]);
    });
  });

  describe('S-3 · 검색어가 0건을 만들면 그 검색어를 지목한다 (AC-6 · BR-U1-16 취지)', () => {
    it('검색어를 문구에 박고, 해제하면 목록이 되돌아온다 (검색은 서버가 한다 — TRIP-502)', async () => {
      setAccessToken('valid-access');

      await renderPage();

      fireEvent.changeText(
        screen.getByTestId('explore-places-search'),
        '없는이름'
      );

      await waitFor(() =>
        expect(
          screen.getByTestId('explore-places-filterzero')
        ).toBeOnTheScreen()
      );
      expect(
        within(screen.getByTestId('explore-places-filterzero')).getByText(
          '‘없는이름’ 때문에 0건이에요'
        )
      ).toBeOnTheScreen();

      fireEvent.press(screen.getByTestId('explore-places-filterzero-clear'));

      // 해제 수단이 실제로 조건을 지운다 — 문구만 있고 버튼이 아무 일도 안 하면 no-op 컨트롤이다.
      await waitFor(() => expect(cardTestIdsOrNone()).toHaveLength(5));
      // 검색·해제는 서버가 한다(q) — 각각 새 한 파도가 나간다(초기 + 검색 + 해제, 로드된 페이지 한정 아님).
      // 정확값 3 파도(TRIP-1617) — 이 래퍼가 gcTime 0 이라 키를 되돌려도 캐시 없이 다시 묻는다(실앱은 캐시 히트라 더 적다).
      expect(hitsOf('GET', '/api/v1/places')).toHaveLength(3 * WAVE);
    });
  });

  // TRIP-1019 #027 — 두 조건이 다 걸려 0건일 때 "조건 모두 해제" 가 **실제로 두 상태를 다** 푼다.
  // 한쪽만 풀면 남은 조건 때문에 목록이 5장으로 돌아오지 않는다(검색어만 풀면 카페 1장, 카테고리만
  // 풀면 '해변' 1장) — 그래서 "5장 복귀" 하나가 "둘 다 풀었다"의 심판이 된다.
  describe('🔴 S-12 · TRIP-1019 #027 · 조건 모두 해제는 검색어와 카테고리를 함께 푼다 (BR-U1-16 취지)', () => {
    it('카페 + "해변" 으로 0건일 때 누르면 검색어가 비고 "전체" 로 돌아가 목록 5장이 온다', async () => {
      setAccessToken('valid-access');
      // 이 케이스만 카테고리도 서버가 거른다(기본 스텁은 q 만 본다) — 카테고리 해제 여부가 결과에
      // 드러나야 "하나만 풀기" 구현이 red 가 된다.
      server.use(
        http.get(`${BASE}/places`, ({ request }) => {
          const params = new URL(request.url).searchParams;
          const q = params.get('q');
          const category = params.get('category');
          const result = PLACES.filter(
            (p) =>
              (!q || p.nameKo.includes(q)) &&
              (!category || p.category === category)
          );
          return HttpResponse.json({ items: result, nextCursor: null });
        })
      );

      await renderPage();

      // 조건 ① 카테고리 '카페' → 전포 카페거리 1장.
      fireEvent.press(screen.getByTestId('explore-places-category-cafe'));
      await waitFor(() =>
        expect(cardTestIdsOrNone()).toEqual(['explore-places-card-p3'])
      );

      // 조건 ② 검색어 '해변' → 카페 중엔 없어 0건(filter-zero, 두 조건 모두 걸림).
      fireEvent.changeText(screen.getByTestId('explore-places-search'), '해변');
      await waitFor(() =>
        expect(
          screen.getByTestId('explore-places-filterzero')
        ).toBeOnTheScreen()
      );

      // 제목은 검색어를 지목하고, 부제가 함께 걸린 카테고리를, 지목 해제 버튼은 검색어를 가리킨다.
      const notice = screen.getByTestId('explore-places-filterzero');
      expect(
        within(notice).getByText(
          '‘카페’ 필터도 함께 걸려 있어요 · 조건을 해제하면 더 많은 장소를 볼 수 있어요'
        )
      ).toBeOnTheScreen();
      expect(
        within(screen.getByTestId('explore-places-filterzero-clear')).getByText(
          '검색어 지우기'
        )
      ).toBeOnTheScreen();

      fireEvent.press(
        screen.getByTestId('explore-places-filterzero-clear-all')
      );

      // 두 조건이 모두 풀려야 5장이 돌아온다.
      await waitFor(() => expect(cardTestIdsOrNone()).toHaveLength(5));
      expect(screen.getByTestId('explore-places-search').props.value).toBe('');
      expect(screen.getByTestId('explore-places-category-all')).toBeSelected();
      expect(
        screen.getByTestId('explore-places-category-cafe')
      ).not.toBeSelected();

      // 마지막으로 나간 조회에 q·category 가 둘 다 없다(서버 기준으로도 조건이 풀렸다).
      const placeHits = hitsOf('GET', '/api/v1/places');
      const last = new URL(placeHits[placeHits.length - 1].url).searchParams;
      expect({ q: last.get('q'), category: last.get('category') }).toEqual({
        q: null,
        category: null,
      });
    });
  });

  // B안 — 뷰 단위에서 옮김. 카테고리만 0건을 만들면 카테고리를 지목하고, 공백 검색어는 조건이 아니다.
  describe('S-13 · 카테고리가 0건을 만들면 카테고리를 지목한다', () => {
    it('쇼핑 0건이면 "‘쇼핑’ 때문에 0건"·"‘쇼핑’ 필터 해제"이고, 공백만 쳐도 "조건 모두 해제" 는 없다', async () => {
      setAccessToken('valid-access');
      server.use(
        http.get(`${BASE}/places`, ({ request }) => {
          const category = new URL(request.url).searchParams.get('category');
          const result = PLACES.filter(
            (p) => !category || p.category === category
          );
          return HttpResponse.json({ items: result, nextCursor: null });
        })
      );

      await renderPage();
      fireEvent.press(screen.getByTestId('explore-places-category-shopping'));
      await waitFor(() =>
        expect(
          screen.getByTestId('explore-places-filterzero')
        ).toBeOnTheScreen()
      );

      const notice = screen.getByTestId('explore-places-filterzero');
      expect(
        within(notice).getByText('‘쇼핑’ 때문에 0건이에요')
      ).toBeOnTheScreen();
      expect(
        within(screen.getByTestId('explore-places-filterzero-clear')).getByText(
          '‘쇼핑’ 필터 해제'
        )
      ).toBeOnTheScreen();

      fireEvent.changeText(screen.getByTestId('explore-places-search'), '   ');
      expect(screen.getByTestId('explore-places-filterzero')).toBeOnTheScreen();
      expect(
        screen.queryByTestId('explore-places-filterzero-clear-all')
      ).toBeNull();
    });
  });

  describe('S-4 · 조회 실패의 재시도가 실제로 서버를 다시 부른다 (AC-7 · INV-4 · TRIP-1560 AC-5)', () => {
    it('에러 안내가 뜨고, 다시 시도를 누르면 재조회해 목록이 온다', async () => {
      setAccessToken('valid-access');
      // 지역 미지정 첫 조회는 서비스 지역별 WAVE 요청이다 — 한 곳만 실패하면 부분 실패(배너)라 error 얼굴이
      // 안 뜬다. "전부 실패"를 만들려고 첫 파도(WAVE 번째까지)를 모두 500 으로 한다(INV-4: 전부 실패 = error).
      let attempts = 0;
      server.use(
        http.get(`${BASE}/places`, () => {
          attempts += 1;
          return attempts <= WAVE
            ? new HttpResponse(null, { status: 500 })
            : HttpResponse.json({ items: PLACES, nextCursor: null });
        })
      );

      renderNow();

      await waitFor(() =>
        expect(screen.getByTestId('explore-places-error')).toBeOnTheScreen()
      );
      // 빈 목록으로 위장하면 위반이다(INV-4). 배너(부분 실패)와도 섞이지 않는다.
      expect(cardTestIdsOrNone()).toEqual([]);
      expect(screen.queryByTestId('explore-places-partialfailure')).toBeNull();
      expect(
        within(screen.getByTestId('explore-places-error')).getByText(
          '지금 장소 정보를 불러올 수 없어요'
        )
      ).toBeOnTheScreen();
      // 오류 얼굴에도 ＋ FAB·지역 칩이 남는다(B안 — 뷰 단위에서 옮김).
      expect(screen.getByTestId('explore-places-create-fab')).toBeOnTheScreen();
      expect(screen.getByTestId('explore-places-region')).toBeOnTheScreen();
      // 앵커 — 실패한 파도는 지역별로 정확히 WAVE 건이었다(재시도 증분을 가르는 기준선).
      expect(hitsOf('GET', '/api/v1/places')).toHaveLength(WAVE);

      fireEvent.press(screen.getByTestId('explore-places-error-retry'));

      // 다시 시도 = 서비스 지역 전부 재조회(새 파도 WAVE 건) — 한 곳만 다시 묻는 구현이면 red.
      await waitFor(() =>
        expect(hitsOf('GET', '/api/v1/places')).toHaveLength(2 * WAVE)
      );
      expectWaveCoversServiceRegions(
        hitsOf('GET', '/api/v1/places').slice(WAVE)
      );
      // 재조회 결과가 화면에 닿았다 — 히트수만 보면 "부르고 버리는" 구현도 통과한다.
      await waitFor(() => expect(cardTestIdsOrNone()).toHaveLength(5));
      expect(screen.queryByTestId('explore-places-error')).toBeNull();
    });
  });

  describe('S-5 · 미로그인 담기 (AC-9 · BR-U1-03)', () => {
    it('요청을 보내지 않고, 로그인 유도 배너로 로그인 화면에 보낸다', async () => {
      // 토큰 없음 — 목록 열람은 미로그인도 가능한 화면이다.
      await renderPage();

      fireEvent.press(screen.getByTestId('explore-places-save-p2'));

      await waitFor(() =>
        expect(screen.getByTestId('explore-places-saveerror')).toBeOnTheScreen()
      );
      expect(
        within(screen.getByTestId('explore-places-saveerror')).getByText(
          '로그인하면 마음에 든 장소를 담을 수 있어요'
        )
      ).toBeOnTheScreen();

      // 규칙의 본체 — 요청 자체가 나가지 않는다. 낙관 반영도 하지 않는다.
      expect(hitsOf('POST', '/api/v1/saved-places')).toHaveLength(0);
      expect(
        within(screen.getByTestId('explore-places-card-p2')).queryAllByText(
          '담음'
        )
      ).toHaveLength(0);
      expect(screen.getByTestId('explore-places-save-p2')).not.toBeSelected();

      fireEvent.press(screen.getByTestId('explore-places-saveerror-login'));

      // 01b Seed Q6 ⓒ — 배너만 두면 목적지 없는 안내가 된다(관통 원칙: no-op 컨트롤 금지).
      expect(mockPush.mock.calls).toEqual([['/(auth)/login']]);
    });
  });

  describe('S-6 · 404 는 롤백하고 사유를 알린다 (AC-10 · INV-4)', () => {
    it('낙관 반영이 되돌려지고 배너가 뜨며, 실패 경로에서 재조회하지 않는다', async () => {
      setAccessToken('valid-access');
      server.use(
        http.post(
          `${BASE}/saved-places`,
          () => new HttpResponse(null, { status: 404 })
        )
      );

      await renderPage();
      expect(hitsOf('GET', '/api/v1/saved-places')).toHaveLength(1);

      fireEvent.press(screen.getByTestId('explore-places-save-p2'));

      await waitFor(() =>
        expect(screen.getByTestId('explore-places-saveerror')).toBeOnTheScreen()
      );
      expect(
        within(screen.getByTestId('explore-places-saveerror')).getByText(
          '지금은 담을 수 없는 장소예요'
        )
      ).toBeOnTheScreen();

      // 롤백 — 티켓의 "카드 상태 갱신"은 재조회가 아니라 되돌리기다.
      expect(
        within(screen.getByTestId('explore-places-card-p2')).queryAllByText(
          '담음'
        )
      ).toHaveLength(0);
      expect(screen.getByTestId('explore-places-save-p2')).not.toBeSelected();

      // 실패 경로에서 무효화하면 되돌린 것이 롤백 때문인지 재조회 때문인지 구별할 수 없어진다.
      expect(hitsOf('GET', '/api/v1/saved-places')).toHaveLength(1);
      expect(hitsOf('POST', '/api/v1/saved-places')).toHaveLength(1);

      // 다시 눌러도 결과가 같은 실패다 — 재시도 버튼을 달면 no-op 컨트롤이 된다.
      expect(screen.queryByTestId('explore-places-saveerror-retry')).toBeNull();
      expect(screen.queryByTestId('explore-places-saveerror-login')).toBeNull();
    });
  });

  describe('S-7 · 409 는 오류를 발명하지 않는다 (AC-11)', () => {
    it('배너 없이 담김을 유지하고, 서버 진실로 한 번 맞춰 본다', async () => {
      setAccessToken('valid-access');
      server.use(
        http.post(`${BASE}/saved-places`, async ({ request }) => {
          // 이미 담겨 있던 상태(클라 캐시가 낡았을 때 나는 갈래) — 서버 쪽 진실을 채워 둔다.
          const body = (await request.json()) as { poiId: string };
          savedRows = [savedRowOf(body.poiId)];
          return new HttpResponse(null, { status: 409 });
        })
      );

      await renderPage();

      fireEvent.press(screen.getByTestId('explore-places-save-p2'));

      // 목표 상태와 결과 상태가 같다(INV-U1-04) — 실패가 아니라 담김으로 수렴한다.
      await waitFor(() =>
        expect(hitsOf('GET', '/api/v1/saved-places')).toHaveLength(2)
      );
      expect(screen.queryByTestId('explore-places-saveerror')).toBeNull();
      expect(
        within(screen.getByTestId('explore-places-card-p2')).getByText('담음')
      ).toBeOnTheScreen();
      expect(screen.getByTestId('explore-places-save-p2')).toBeSelected();
    });
  });

  describe('S-8 · 네트워크 실패는 롤백 + 재시도다 (AC-12)', () => {
    it('사유와 재시도를 주고, 재시도가 같은 담기를 다시 보낸다', async () => {
      setAccessToken('valid-access');
      let attempts = 0;
      server.use(
        http.post(`${BASE}/saved-places`, async ({ request }) => {
          attempts += 1;
          if (attempts === 1) return HttpResponse.error();
          const body = (await request.json()) as { poiId: string };
          const row = savedRowOf(body.poiId);
          savedRows = [...savedRows, row];
          return HttpResponse.json(row, { status: 201 });
        })
      );

      await renderPage();

      fireEvent.press(screen.getByTestId('explore-places-save-p2'));

      await waitFor(() =>
        expect(screen.getByTestId('explore-places-saveerror')).toBeOnTheScreen()
      );
      expect(
        within(screen.getByTestId('explore-places-saveerror')).getByText(
          '연결이 불안정해 담지 못했어요'
        )
      ).toBeOnTheScreen();
      expect(screen.getByTestId('explore-places-save-p2')).not.toBeSelected();

      fireEvent.press(screen.getByTestId('explore-places-saveerror-retry'));

      await waitFor(() =>
        expect(hitsOf('POST', '/api/v1/saved-places')).toHaveLength(2)
      );
      await waitFor(() =>
        expect(screen.getByTestId('explore-places-save-p2')).toBeSelected()
      );
      // 성공했으면 실패 배너가 남아 있으면 안 된다(다음 조작 시 사라진다 — 01b Seed Q5).
      expect(screen.queryByTestId('explore-places-saveerror')).toBeNull();
    });
  });

  describe('S-9 · 응답 대기 중 연타 (AC-13 · 01b Seed Q7 ⓑ)', () => {
    it('두 번째 누름이 유실되지 않고, 담기가 정확히 한 번만 나간다', async () => {
      setAccessToken('valid-access');
      saveGate = createGate(); // POST 를 문 뒤에 세운다

      await renderPage();

      fireEvent.press(screen.getByTestId('explore-places-save-p2'));

      await waitFor(() =>
        expect(screen.getByTestId('explore-places-save-p2')).toBeDisabled()
      );

      // 응답 전 두 번째 누름 — 예전에는 여기서 해제 경로로 새어 조작이 조용히 사라졌다
      // (TRIP-221 03b W-2). 눌리지 않게 만들어 그 자리 자체를 없앤다.
      fireEvent.press(screen.getByTestId('explore-places-save-p2'));
      expect(hitsOf('POST', '/api/v1/saved-places')).toHaveLength(1);

      saveGate.release();

      await waitFor(() =>
        expect(screen.getByTestId('explore-places-save-p2')).not.toBeDisabled()
      );
      expect(screen.getByTestId('explore-places-save-p2')).toBeSelected();
      expect(hitsOf('POST', '/api/v1/saved-places')).toHaveLength(1);
      // 유실도 없고 침묵도 없다 — 알릴 실패가 없으므로 배너도 없다.
      expect(screen.queryByTestId('explore-places-saveerror')).toBeNull();
    });
  });

  describe('S-10 · 배너는 다음 조작 시 사라진다 (01b Seed Q5 — 타이머 금지)', () => {
    it('실패 배너가 뜬 뒤 검색어를 바꾸면 배너가 사라진다', async () => {
      setAccessToken('valid-access');
      server.use(
        http.post(
          `${BASE}/saved-places`,
          () => new HttpResponse(null, { status: 404 })
        )
      );

      await renderPage();
      fireEvent.press(screen.getByTestId('explore-places-save-p2'));
      await waitFor(() =>
        expect(screen.getByTestId('explore-places-saveerror')).toBeOnTheScreen()
      );

      fireEvent.changeText(screen.getByTestId('explore-places-search'), '광안');

      // 가짜 타이머를 들이면 이 칸의 상태 판정 전체가 타이밍 의존이 된다 — 조작이 지운다.
      await waitFor(() =>
        expect(screen.queryByTestId('explore-places-saveerror')).toBeNull()
      );
      // 긍정 짝 — 화면이 통째로 죽어서 "없음"이 된 게 아니다. 검색은 서버가 하므로(q=광안, TRIP-502)
      // 새 조회가 해소되면 p2 만 남는다(클라 즉시 필터 아님 — waitFor 로 서버 응답을 기다린다).
      await waitFor(() =>
        expect(cardTestIdsOrNone()).toEqual(['explore-places-card-p2'])
      );
    });
  });

  describe('S-11 · 좌표 방어 배선 (01b Seed Q12 · BR-U1-02 · US-EXPL-04 예외)', () => {
    it('좌표를 확인할 수 없는 장소는 담기를 막고 사유를 표시한다', async () => {
      setAccessToken('valid-access');

      // ⚠️ 이 응답은 **계약상 존재할 수 없다** — `openapi.yaml` 의 `Place` 는 `lat`·`lng` 가
      // required 이고 nullable 이 아니며 `GET /places` 는 ACTIVE POI 만 준다. 캐스팅을 해야
      // 만들어진다는 사실 자체가 "US-EXPL-04 예외 AC 는 현재 계약에서 재현 불가"의 증거다
      // (미충족으로 기록한다). 그럼에도 방어 코드는 두고, 이 케이스가 그 배선의 심판이다.
      const noCoords = {
        ...PLACES[1],
        lat: null,
        lng: null,
      } as unknown as Place;
      server.use(
        http.get(`${BASE}/places`, () =>
          HttpResponse.json({ items: [noCoords], nextCursor: null })
        )
      );

      await renderPage();

      fireEvent.press(screen.getByTestId('explore-places-save-p2'));

      await waitFor(() =>
        expect(screen.getByTestId('explore-places-saveerror')).toBeOnTheScreen()
      );
      expect(
        within(screen.getByTestId('explore-places-saveerror')).getByText(
          '위치를 확인할 수 없어 담을 수 없어요'
        )
      ).toBeOnTheScreen();

      // 서버 판정을 기다리지 않고 클라가 먼저 막는다(BR-U1-02 는 UX 사본이고 정본은 서버다).
      expect(hitsOf('POST', '/api/v1/saved-places')).toHaveLength(0);
      expect(
        within(screen.getByTestId('explore-places-card-p2')).queryAllByText(
          '담음'
        )
      ).toHaveLength(0);
    });
  });
});

// ── 카드 → 상세 push (옛 `PlaceExplorePage.cardtap.integration.test.tsx`, TRIP-456 AC-1) ──────────
// 심판 대상은 "실제로 조립된 push 문자열"이다 — 화면이 올린 place 로 페이지가 URL 을 만드는 마지막
// 조립을 라우터 목으로만 관찰할 수 있다. 첫·둘째 카드가 서로 다른 세그먼트를 만들어 poiId 하드코딩을
// 가른다. 픽스처는 옛 파일 값 그대로(카드 2장)다.
describe('카드 → 상세 push', () => {
  function makeCardtapPlace(
    poiId: string,
    nameKo: string,
    savedCount: number
  ): Place {
    return {
      poiId,
      nameKo,
      category: '문화',
      lat: 35.1,
      lng: 129.1,
      region: '부산',
      openingHours: null,
      imageUrl: null,
      tags: [],
      savedCount,
      dataStatus: 'ACTIVE',
    };
  }

  const CARDTAP_PLACES: Place[] = [
    makeCardtapPlace('p1', '감천문화마을', 30),
    makeCardtapPlace('p2', '광안리 해변', 10),
  ];

  beforeEach(() => {
    setAccessToken('valid-access');
    server.use(
      http.get(`${BASE}/places`, () =>
        HttpResponse.json({ items: CARDTAP_PLACES, nextCursor: null })
      )
    );
  });

  describe('AC-1 · d04 카드 → d06 push', () => {
    it('카드를 누르면 그 카드의 poiId로 /explore/places/{poiId} 로 이동한다 (첫·둘째 각자)', async () => {
      // 준비 — 카드가 도착할 때까지.
      render(<PlaceExplorePage />, { wrapper: createGcZeroWrapper() });
      await waitFor(() =>
        expect(screen.getByTestId('explore-places-card-p2')).toBeOnTheScreen()
      );

      // 실행·단언 — 둘째 카드.
      fireEvent.press(screen.getByTestId('explore-places-card-p2'));
      expect(mockPush.mock.calls).toEqual([['/explore/places/p2']]);

      // 첫 카드 — poiId를 하드코딩하면 여기서 갈린다. 사람이 따로 누른 탭이라 연타 가드 창(400ms)이
      // 지난 것으로 둔다(TRIP-1282 — 카드가 가드로 감싸져 둘째 누름이 창 안이면 무시된다).
      resetPressGuard();
      fireEvent.press(screen.getByTestId('explore-places-card-p1'));
      expect(mockPush.mock.calls).toEqual([
        ['/explore/places/p2'],
        ['/explore/places/p1'],
      ]);
    });
  });

  // TRIP-1282 ① — 홈 "더 보기" 연타의 둘째 탭이 이 화면 카드에 떨어진다(QA A-02). 트리거 반쪽("더 보기"가
  // 창을 연다)은 HomePage.test.tsx 에 있다 — 두 화면을 잇는 것은 모듈 전역 창 하나뿐이다.
  describe('연타 관통 표적 — 창 안의 카드 누름은 무시된다', () => {
    const FROZEN_NOW = 1_790_000_000_000;
    let clock: jest.SpyInstance | undefined;
    afterEach(() => clock?.mockRestore());

    it('창이 열려 있으면 카드를 눌러도 장소 상세로 안 가고, 창이 닫힌 뒤 한 번 누르면 그 카드 상세로 정확히 1회 간다', async () => {
      render(<PlaceExplorePage />, { wrapper: createGcZeroWrapper() });
      await waitFor(() =>
        expect(screen.getByTestId('explore-places-card-p2')).toBeOnTheScreen()
      );
      // 시계는 목록이 도착한 뒤에 멈춘다 — 그다음부터 누름 판정만 고정한다.
      clock = jest.spyOn(Date, 'now').mockReturnValue(FROZEN_NOW);
      // 준비 — 홈 "더 보기"가 방금 눌렸다(창이 열려 있다).
      openPressGuardWindow();

      fireEvent.press(screen.getByTestId('explore-places-card-p2'));

      expect(mockPush).not.toHaveBeenCalled();

      // 무회귀 — 창이 닫힌 뒤의 한 번.
      resetPressGuard();
      fireEvent.press(screen.getByTestId('explore-places-card-p2'));

      expect(mockPush.mock.calls).toEqual([['/explore/places/p2']]);
    });
  });
});
