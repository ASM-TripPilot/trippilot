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
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';
import type { Place, SavedPlace } from '@/shared/api/generated/schemas';
import { optimisticSavedPlaceId } from '@/features/explore/model/savedPlaceIndex';
import { useTripWizardStore } from '@/features/trip/model/tripWizardStore';

import { SavedPlacesPage } from './SavedPlacesPage';

/**
 * A-1·A-2·A-5·A-6·A-8 · E-1·E-2·E-4 · N-1·N-2·N-4 · 01b Seed Q2·Q3·Q6·Q7·Q9·Q11
 * — d02 담은 장소의 **배선**. **TRIP-394 로 해제 동작이 뒤집혔다**(사라짐 → 자리에 남고 빈 하트).
 *
 * 무엇을 보장하나:
 *  - **S-1 (A-1·A-2)** 서버가 어떤 순서로 주든 화면은 `savedAt` 오름차순으로 1..N 을 매긴다.
 *  - **S-2 (AC-4 · BR-U1-04 재작성)** 하트를 누르면 그 행이 **자리를 유지한 채 빈 하트가 되고**,
 *    `DELETE` 는 savedPlaceId 로 정확히 한 번 나가며, 성공 재조회 후에도 행이 남는다.
 *  - **S-2R (AC-5)** 빈 하트를 다시 누르면 `POST` 가 나가고 **같은 자리에서** 찬 하트로 돌아온다.
 *  - **S-6R (AC-6)** 해제는 서버에 실제로 반영되고, 재방문(재마운트)하면 서버 진실로 재빌드돼 사라진다.
 *  - **S-3 (AC-7a · INV-4)** `DELETE` 실패는 배너 + 하트를 **찬 상태로 원복**한다(빈 하트로 안 남음).
 *  - **S-3R2 (AC-7b · INV-4)** 되돌리기 `POST` 실패는 배너 + 하트를 **빈 상태로 원복**한다(대칭).
 *  - **S-4 (Seed Q9)** 배너는 **다음 조작 시** 사라진다 — 타이머를 쓰지 않는다.
 *  - **S-5 (N-1)** 네트워크 실패는 재시도를 주고, 재시도 성공이 그 행을 빈 하트로 남긴다.
 *  - **S-6 (A-6)** 하단 CTA 가 여행 생성 1/2 로 보낸다.
 *  - **S-7 (E-1·E-2·E-4)** 0곳이면 안내 + `장소 둘러보기`가 d04 로 보낸다.
 *  - **S-8 (Seed Q6)** 조회 실패의 `다시 시도`가 **실제로 서버를 다시 부른다**(스텁 금지).
 *  - **S-9 (Seed Q7)** 게스트는 요청 0건에 로그인 안내를 본다 — 로딩도 빈 상태도 아니다.
 *  - **S-10 (Seed Q3·Q11)** 낙관 표식 항목은 맨 끝에 오고, 해제 요청이 아예 안 나간다.
 *  - **S-11 (N-4 · AC-9)** 이 칸은 필수 방문지(must-visits)를 만들지도 지우지도 않는다.
 *
 * 왜 통합 버킷인가: 심판 대상이 "**실제로 나간 요청**"이다. 나간 경로(어느 id 를 실었나) ·
 * 요청 유무 · 재조회 횟수는 msw 만 관찰할 수 있다(d04 `PlaceExplorePage.states` 계승).
 *
 * ★ 빈/찬 하트는 색이 아니라 `accessibilityState.selected`(=`toBeSelected()`)와
 *   `explore-saved-heart-{outline,filled}-*` 컴포넌트 testID 로 잰다(repo-trap 회피, 02a ★1).
 * ★ 성공 재조회 히트수가 "성공 반영이냐 실패 롤백이냐"를 가른다 — 실패 경로는 무효화하지 않는다.
 *
 * ── 졸업 조건 (frontend/CLAUDE.md "장치 판정 규칙") ──────────────────────
 * **A. 영구 규칙 — 유지한다.** 나간 요청·롤백·라우팅 목적지·하트 상태는 계약이 바뀌지 않는 한 유효하다.
 * **B. 이행 체크포인트 — 한시적.** 배너 문구 리터럴(S-3·S-3R2·S-5·S-10). **B 카운터 = 0.**
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

// ★ `router.push` 를 화살표로 한 겹 감싸 **지연 참조**한다. `jest.mock` 팩토리는 hoist 되어
// `const mockPush` 선언보다 먼저 도는데, `push: mockPush` 로 즉시 읽으면 그 시점의 undefined 가
// 박혀 `router.push is not a function` 이 난다(TRIP-221 실측 ★16).
jest.mock('expo-router', () => ({
  router: {
    push: (href: string) => mockPush(href),
    back: () => mockBack(),
  },
  useRouter: () => ({ push: mockPush, back: mockBack }),
  useLocalSearchParams: () => ({}),
}));

const BASE = 'http://localhost:8080/api/v1';

function makePlace(
  poiId: string,
  nameKo: string,
  region: string | null
): Place {
  return {
    poiId,
    nameKo,
    category: '명소',
    lat: 35.1587,
    lng: 129.1604,
    region,
    openingHours: null,
    imageUrl: null,
    tags: ['골목'],
    savedCount: 4,
    dataStatus: 'ACTIVE',
  };
}

/** 일부러 **뒤섞어** 둔다 — 서버 응답 순서를 믿지 않는다는 결정(01b Seed Q2)의 심판이다.
 * savedAt 오름차순 정답은 sp-a → sp-b → sp-c → sp-d 다. */
const ROWS: SavedPlace[] = [
  {
    savedPlaceId: 'sp-c',
    savedAt: '2026-08-02T09:00:00.000Z',
    place: makePlace('p3', '전포 카페거리', null),
  },
  {
    savedPlaceId: 'sp-a',
    savedAt: '2026-08-01T10:00:00.000Z',
    place: makePlace('p1', '감천문화마을', '사하구'),
  },
  {
    savedPlaceId: 'sp-d',
    savedAt: '2026-08-03T08:00:00.000Z',
    place: makePlace('p4', '해동용궁사', '기장군'),
  },
  {
    savedPlaceId: 'sp-b',
    savedAt: '2026-08-01T11:00:00.000Z',
    place: makePlace('p2', '광안리 해변', '수영구'),
  },
];

const SORTED = ['sp-a', 'sp-b', 'sp-c', 'sp-d'];

/** ★ 되돌리기(POST) 재담김 시 서버가 주는 savedAt — **가장 늦게** 둔다(모든 기존 행보다 뒤).
 * 서버-진실만 쓰면 재담긴 행이 `orderSavedPlaces`로 **맨 끝**에 서므로, "같은 자리(position 2)"
 * 는 페이지가 **스냅숏의 원 savedAt(08-01T11)으로 정렬 키를 덮어써야만** 성립한다(02a ★3, 블라인드
 * 스팟 #1 — 낙관 표식 맨끝 규칙을 실제로 잠근다). */
const RESTORE_SAVED_AT = '2026-08-09T00:00:00.000Z';

/** 테스트가 풀어 줄 때까지 응답하지 않는 문(리포 선례). `delay(ms)` 로 재면 느린 CI 에서
 * 흔들리고 "아직 안 왔다"를 결정론적으로 보장하지 못한다. */
function createGate() {
  let release!: () => void;
  const opened = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { opened, release };
}

let savedRows: SavedPlace[] = [];
let listGate = createGate();
let observed: { method: string; url: string }[] = [];

function hitsOf(method: string, pathname: string) {
  return observed.filter(
    (hit) => hit.method === method && new URL(hit.url).pathname === pathname
  );
}

function deletedIds(): string[] {
  return observed
    .filter((hit) => hit.method === 'DELETE')
    .map((hit) => new URL(hit.url).pathname.split('/').slice(-1)[0]);
}

function itemTestIds(): string[] {
  return screen
    .queryAllByTestId(/^explore-saved-item-/)
    .map((node) => String(node.props.testID));
}

/** 순서와 순번을 한 번에 잰다 — 행만 세면 "줄은 맞는데 배지가 엉뚱한" 구현을 놓친다. */
function expectOrder(savedPlaceIds: string[]) {
  expect(itemTestIds()).toEqual(
    savedPlaceIds.map((id) => `explore-saved-item-${id}`)
  );
  savedPlaceIds.forEach((id, index) => {
    expect(
      within(screen.getByTestId(`explore-saved-rank-${id}`)).getByText(
        String(index + 1)
      )
    ).toBeOnTheScreen();
  });
}

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  server.events.on('request:start', ({ request }) => {
    observed.push({ method: request.method, url: request.url });
  });
});

beforeEach(() => {
  observed = [];
  savedRows = [...ROWS];
  mockPush.mockClear();
  mockBack.mockClear();
  clearAccessToken();
  listGate = createGate();
  listGate.release();

  server.use(
    http.get(`${BASE}/saved-places`, async () => {
      await listGate.opened;
      return HttpResponse.json(savedRows);
    }),
    http.delete(`${BASE}/saved-places/:savedPlaceId`, ({ params }) => {
      savedRows = savedRows.filter(
        (row) => row.savedPlaceId !== params.savedPlaceId
      );
      return new HttpResponse(null, { status: 204 });
    }),
    // 되돌리기(재담김) — 요청 poiId 로 원래 행을 찾아 **더 늦은 savedAt** 으로 재삽입한다(★3).
    http.post(`${BASE}/saved-places`, async ({ request }) => {
      const body = (await request.json()) as { poiId: string };
      const original = ROWS.find((row) => row.place.poiId === body.poiId);
      const restored: SavedPlace = original
        ? { ...original, savedAt: RESTORE_SAVED_AT }
        : {
            savedPlaceId: `sp-${body.poiId}`,
            savedAt: RESTORE_SAVED_AT,
            place: makePlace(body.poiId, body.poiId, null),
          };
      savedRows = [
        ...savedRows.filter((row) => row.place.poiId !== body.poiId),
        restored,
      ];
      return HttpResponse.json(restored, { status: 201 });
    })
  );
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(() => server.close());

function createWrapper() {
  const client = new QueryClient({
    defaultOptions: {
      // gcTime: 0 — 기본값이 만드는 타이머가 테스트 종료 후에도 살아남아 Node 프로세스를
      // 붙잡는다. **mutations 쪽도 반드시 0** 이다(빼면 이 버킷이 300초 매달린다, 리포 실측).
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

/** 목록이 도착해 행이 그려진 상태까지 만든다. 재마운트 테스트(S-6R)를 위해 render 결과를 돌려준다. */
async function renderLoaded() {
  setAccessToken('valid-access');
  const result = renderPage();
  await waitFor(() => expect(itemTestIds().length).toBeGreaterThan(0));
  return result;
}

/** 하트 컨트롤의 접근성 상태(담김=selected)를 짧게 부른다. */
function heart(savedPlaceId: string) {
  return screen.getByTestId(`explore-saved-remove-${savedPlaceId}`);
}

describe('S-1 · 담은 순서대로 줄을 세운다 (A-1·A-2 · 01b Seed Q2)', () => {
  it('서버 응답 순서를 믿지 않고 savedAt 오름차순으로 1..N 을 매긴다', async () => {
    await renderLoaded();

    await waitFor(() => expect(itemTestIds()).toHaveLength(4));
    expectOrder(SORTED);
    expect(
      within(screen.getByTestId('explore-saved-subtitle')).getByText(
        '4곳 · 마음에 든 순서대로'
      )
    ).toBeOnTheScreen();
  });
});

describe('S-2 · 해제는 자리에 남고 빈 하트가 된다 (AC-4 · BR-U1-04 재작성)', () => {
  it('행은 자리를 유지한 채 빈 하트가 되고, DELETE 는 한 번 나가며, 재조회 후에도 남는다', async () => {
    await renderLoaded();
    await waitFor(() => expect(itemTestIds()).toHaveLength(4));

    fireEvent.press(heart('sp-b'));

    // ★ 뒤집힌 계약 — 행이 사라지지 않고 그 자리(position 2)에서 빈 하트로 바뀐다.
    await waitFor(() => expect(heart('sp-b')).not.toBeSelected());
    expect(
      screen.getByTestId('explore-saved-heart-outline-sp-b')
    ).toBeOnTheScreen();
    expect(screen.getByTestId('explore-saved-item-sp-b')).toBeOnTheScreen();
    expectOrder(SORTED);

    // 해제 API 는 poiId 가 아니라 savedPlaceId 를 요구한다(계약) — 정확히 한 번.
    await waitFor(() => expect(deletedIds()).toEqual(['sp-b']));

    // ★ 성공 경로는 invalidateBoth 로 재조회한다(GET 2회) — 그런데도 행은 스냅숏에서 살아남는다.
    await waitFor(() =>
      expect(hitsOf('GET', '/api/v1/saved-places')).toHaveLength(2)
    );
    expect(screen.getByTestId('explore-saved-item-sp-b')).toBeOnTheScreen();
    expect(heart('sp-b')).not.toBeSelected();
  });
});

describe('S-2R · 되돌리기는 같은 자리에서 다시 담는다 (AC-5)', () => {
  it('빈 하트를 다시 누르면 POST 가 나가고 원래 자리에서 찬 하트로 돌아온다', async () => {
    await renderLoaded();
    await waitFor(() => expect(itemTestIds()).toHaveLength(4));

    // 준비 — 먼저 해제해 sp-b 를 빈 하트로 만든다(자리 유지).
    fireEvent.press(heart('sp-b'));
    await waitFor(() => expect(heart('sp-b')).not.toBeSelected());
    await waitFor(() => expect(deletedIds()).toEqual(['sp-b']));

    // 실행 — 빈 하트를 다시 누른다(되돌리기).
    fireEvent.press(heart('sp-b'));

    // 단언 ① 재담김 POST 가 나갔다.
    await waitFor(() =>
      expect(hitsOf('POST', '/api/v1/saved-places').length).toBeGreaterThan(0)
    );
    // 단언 ② **같은 자리(position 2)** 로 복귀 — 서버가 더 늦은 savedAt 을 줘도(★3) 스냅숏
    //   원 savedAt 이 정렬을 지배해야만 이 순서가 성립한다.
    await waitFor(() => expectOrder(SORTED));
    // 단언 ③ 찬 하트로 복귀.
    await waitFor(() => expect(heart('sp-b')).toBeSelected());
    expect(
      screen.getByTestId('explore-saved-heart-filled-sp-b')
    ).toBeOnTheScreen();
  });
});

describe('S-6R · 서버에 실제로 반영되고 재방문하면 사라진다 (AC-6 · 01b Seed Q1)', () => {
  it('해제 후 서버 목록에서 빠지고, 재마운트하면 서버 진실만 남는다', async () => {
    const first = await renderLoaded();
    await waitFor(() => expect(itemTestIds()).toHaveLength(4));

    fireEvent.press(heart('sp-b'));
    await waitFor(() => expect(heart('sp-b')).not.toBeSelected());
    await waitFor(() =>
      expect(hitsOf('GET', '/api/v1/saved-places')).toHaveLength(2)
    );

    // 서버 오라클 — 재조회 응답의 원천인 savedRows 에서 그 poiId 가 실제로 빠져 있다.
    expect(savedRows.some((row) => row.place.poiId === 'p2')).toBe(false);
    // 그런데도 이번 방문에는 빈 하트로 남아 있다(스냅숏이 살린다).
    expect(screen.getByTestId('explore-saved-item-sp-b')).toBeOnTheScreen();

    // 재방문(재마운트) — 방문 범위 상태가 리셋돼 서버 진실만 재빌드된다(Q1=(a)).
    first.unmount();
    renderPage();

    await waitFor(() =>
      expect(itemTestIds()).toEqual([
        'explore-saved-item-sp-a',
        'explore-saved-item-sp-c',
        'explore-saved-item-sp-d',
      ])
    );
    expect(screen.queryByTestId('explore-saved-item-sp-b')).toBeNull();
  });
});

describe('S-3 · 해제 실패는 하트를 찬 상태로 원복한다 (AC-7a · N-1·N-2 · INV-4)', () => {
  it('배너를 세우되 빈 하트로 남기지 않고, 실패 경로에서 재조회하지 않는다', async () => {
    server.use(
      http.delete(
        `${BASE}/saved-places/:savedPlaceId`,
        () => new HttpResponse(null, { status: 404 })
      )
    );

    await renderLoaded();
    await waitFor(() => expect(itemTestIds()).toHaveLength(4));
    expect(hitsOf('GET', '/api/v1/saved-places')).toHaveLength(1);

    fireEvent.press(heart('sp-b'));

    await waitFor(() =>
      expect(screen.getByTestId('explore-saved-removeerror')).toBeOnTheScreen()
    );
    expect(
      within(screen.getByTestId('explore-saved-removeerror')).getByText(
        '지금은 해제할 수 없는 장소예요'
      )
    ).toBeOnTheScreen();

    // ★ INV-4 의 본체 — 실패했으면 빈 하트로 남기지 않고 **찬 하트로 원복**한다(자리 유지).
    await waitFor(() => expect(heart('sp-b')).toBeSelected());
    expect(
      screen.getByTestId('explore-saved-heart-filled-sp-b')
    ).toBeOnTheScreen();
    expectOrder(SORTED);

    // 실패 경로에서 무효화하면 되돌린 것이 롤백 때문인지 재조회 때문인지 구별할 수 없어진다.
    expect(hitsOf('GET', '/api/v1/saved-places')).toHaveLength(1);
    // 404 는 다시 눌러도 같은 실패다 — 재시도 버튼을 달면 아무 일도 안 하는 컨트롤이 된다.
    expect(screen.queryByTestId('explore-saved-removeerror-retry')).toBeNull();
    expect(screen.queryByTestId('explore-saved-removeerror-login')).toBeNull();
  });
});

describe('S-3R2 · 되돌리기 실패는 하트를 빈 상태로 원복한다 (AC-7b · INV-4 대칭)', () => {
  it('POST 가 실패하면 담기 배너를 세우고 빈 하트로 되돌린다', async () => {
    await renderLoaded();
    await waitFor(() => expect(itemTestIds()).toHaveLength(4));

    // 준비 — 먼저 해제(성공)해 sp-b 를 빈 하트로 만든다.
    fireEvent.press(heart('sp-b'));
    await waitFor(() => expect(heart('sp-b')).not.toBeSelected());

    // 이제 되돌리기 POST 를 실패시킨다.
    server.use(
      http.post(
        `${BASE}/saved-places`,
        () => new HttpResponse(null, { status: 404 })
      )
    );

    fireEvent.press(heart('sp-b'));

    // 되돌리기 실패는 **담기(SAVE) 계열** 문구다(해제 문구가 아니다).
    await waitFor(() =>
      expect(
        within(screen.getByTestId('explore-saved-removeerror')).getByText(
          '지금은 담을 수 없는 장소예요'
        )
      ).toBeOnTheScreen()
    );

    // ★ 대칭 원복 — 되돌리기가 실패했으니 다시 빈 하트로 돌아간다(찬 하트로 거짓 표시하지 않는다).
    await waitFor(() => expect(heart('sp-b')).not.toBeSelected());
    expect(
      screen.getByTestId('explore-saved-heart-outline-sp-b')
    ).toBeOnTheScreen();
    expect(screen.getByTestId('explore-saved-item-sp-b')).toBeOnTheScreen();
  });
});

describe('S-4 · 배너는 다음 조작 시 사라진다 (01b Seed Q9 — 타이머 금지)', () => {
  it('다른 행을 해제하면 배너가 사라지고 그 행이 빈 하트가 된다', async () => {
    let attempts = 0;
    server.use(
      http.delete(`${BASE}/saved-places/:savedPlaceId`, ({ params }) => {
        attempts += 1;
        if (attempts === 1) return new HttpResponse(null, { status: 404 });
        savedRows = savedRows.filter(
          (row) => row.savedPlaceId !== params.savedPlaceId
        );
        return new HttpResponse(null, { status: 204 });
      })
    );

    await renderLoaded();
    await waitFor(() => expect(itemTestIds()).toHaveLength(4));

    fireEvent.press(heart('sp-b'));
    await waitFor(() =>
      expect(screen.getByTestId('explore-saved-removeerror')).toBeOnTheScreen()
    );

    fireEvent.press(heart('sp-c'));

    // 가짜 타이머를 들이면 이 화면의 상태 판정 전체가 타이밍 의존이 된다 — 조작이 지운다.
    await waitFor(() =>
      expect(screen.queryByTestId('explore-saved-removeerror')).toBeNull()
    );
    // sp-c 는 사라지지 않고 자리에 남아 빈 하트가 된다(뒤집힌 계약).
    await waitFor(() => expect(heart('sp-c')).not.toBeSelected());
    expect(screen.getByTestId('explore-saved-item-sp-c')).toBeOnTheScreen();
    expectOrder(SORTED);
  });
});

describe('S-5 · 네트워크 실패는 재시도를 준다 (N-1)', () => {
  it('재시도가 같은 해제를 다시 보내고, 성공하면 그 행이 빈 하트로 남는다', async () => {
    let attempts = 0;
    server.use(
      http.delete(`${BASE}/saved-places/:savedPlaceId`, ({ params }) => {
        attempts += 1;
        if (attempts === 1) return HttpResponse.error();
        savedRows = savedRows.filter(
          (row) => row.savedPlaceId !== params.savedPlaceId
        );
        return new HttpResponse(null, { status: 204 });
      })
    );

    await renderLoaded();
    await waitFor(() => expect(itemTestIds()).toHaveLength(4));

    fireEvent.press(heart('sp-b'));

    await waitFor(() =>
      expect(screen.getByTestId('explore-saved-removeerror')).toBeOnTheScreen()
    );
    expect(
      within(screen.getByTestId('explore-saved-removeerror')).getByText(
        '연결이 불안정해 해제하지 못했어요'
      )
    ).toBeOnTheScreen();
    // 실패 후 하트는 찬 상태로 원복(자리 유지).
    await waitFor(() => expect(heart('sp-b')).toBeSelected());
    expectOrder(SORTED);

    fireEvent.press(screen.getByTestId('explore-saved-removeerror-retry'));

    await waitFor(() => expect(deletedIds()).toEqual(['sp-b', 'sp-b']));
    // 재시도 성공 — sp-b 는 자리에 남아 빈 하트가 된다.
    await waitFor(() => expect(heart('sp-b')).not.toBeSelected());
    expect(screen.getByTestId('explore-saved-item-sp-b')).toBeOnTheScreen();
    expectOrder(SORTED);
    expect(screen.queryByTestId('explore-saved-removeerror')).toBeNull();
  });
});

describe('S-6 · 이 장소들로 여행 만들기 (A-6 · US-SHELL-05 · BR-U1-09)', () => {
  it('여행 생성 1/2 로 보낸다', async () => {
    await renderLoaded();
    await waitFor(() => expect(itemTestIds()).toHaveLength(4));

    fireEvent.press(screen.getByTestId('explore-saved-createtrip'));

    // 위저드가 담은 장소를 무엇으로 쓰는지는 TRIP-209 소관이다 — 이 칸은 이동까지다.
    expect(mockPush.mock.calls).toEqual([['/trips/new/step1']]);
  });

  // TRIP-458 회귀: CTA 는 위저드 진입으로 쳐야 한다 — 직전 세션에 x 로 뺀 기억
  // (`excludedMustVisitPoiIds`)을 비워야 warm 캐시로 다시 담긴다. 셸 재마운트에만 기대던
  // 옛 배선은 '더 담기' 왕복(셸이 스택에 살아 있음)에서 reset 이 안 돌아 '꼭 갈 곳'이 빈 채
  // 열렸다. 이 CTA 가 직접 reset 하는지를 스토어 상태로 관찰한다(셸 재마운트라는 jest 무심판
  // 경로를 안 탄다). 준비=스토어에 잔존 excluded 를 심는다 → 실행=CTA press → 단언=비워졌다.
  it('CTA 는 위저드 시드 잔존 기억(excluded)을 비운다 (재진입 캐리 복구)', async () => {
    // 준비값을 **비어 있지 않게** 심는다 — reset 값(전부 빈 상태)과 달라야 세 단언이 다
    // 판별력을 갖는다(mustVisits 도 `[]≠[한 개]` 로 실제로 검사된다). SavedPlacesPage 는 시드
    // 재충전 효과가 없어(그건 위저드 몫) reset 뒤 다시 채워지지 않는다 — 값이 안정적이다.
    useTripWizardStore.setState({
      mustVisits: [{ sourcePoiId: 'poi-x', name: '남겨진 곳', imageUrl: null }],
      mustVisitsInitialized: true,
      excludedMustVisitPoiIds: ['poi-y'],
    });

    await renderLoaded();
    await waitFor(() => expect(itemTestIds()).toHaveLength(4));

    fireEvent.press(screen.getByTestId('explore-saved-createtrip'));

    const state = useTripWizardStore.getState();
    expect(state.excludedMustVisitPoiIds).toEqual([]);
    expect(state.mustVisits).toEqual([]);
    expect(state.mustVisitsInitialized).toBe(false);
    // 이동 자체는 여전히 bare 문자열이다(동결 계약 무손상).
    expect(mockPush.mock.calls).toEqual([['/trips/new/step1']]);
  });
});

describe('S-7 · 0곳이면 안내와 둘러보기 (E-1·E-2·E-4 · BR-U1-09)', () => {
  it('여행 만들기 CTA 대신 안내를 두고, 둘러보기가 d04 로 보낸다', async () => {
    setAccessToken('valid-access');
    savedRows = [];
    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId('explore-saved-empty')).toBeOnTheScreen()
    );
    expect(screen.queryByTestId('explore-saved-createtrip')).toBeNull();

    fireEvent.press(screen.getByTestId('explore-saved-browse'));

    expect(mockPush.mock.calls).toEqual([['/explore/places']]);
  });
});

describe('S-8 · 조회 실패의 재시도가 실제로 서버를 다시 부른다 (01b Seed Q6 · INV-4)', () => {
  it('에러 안내가 뜨고, 다시 시도가 재조회해 목록이 온다', async () => {
    setAccessToken('valid-access');
    let attempts = 0;
    server.use(
      http.get(`${BASE}/saved-places`, () => {
        attempts += 1;
        return attempts === 1
          ? new HttpResponse(null, { status: 500 })
          : HttpResponse.json(savedRows);
      })
    );

    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId('explore-saved-error')).toBeOnTheScreen()
    );
    // ★ Seed Q6 의 본체 — 못 불러온 것을 "담은 게 없다"로 위장하면 거짓말이다.
    expect(screen.queryByTestId('explore-saved-empty')).toBeNull();
    expect(itemTestIds()).toEqual([]);

    fireEvent.press(screen.getByTestId('explore-saved-error-retry'));

    await waitFor(() =>
      expect(hitsOf('GET', '/api/v1/saved-places')).toHaveLength(2)
    );
    // 재조회 결과가 화면에 닿았다 — 히트수만 보면 "부르고 버리는" 구현도 통과한다.
    await waitFor(() => expectOrder(SORTED));
    expect(screen.queryByTestId('explore-saved-error')).toBeNull();
  });
});

describe('S-9 · 미로그인 진입 (01b Seed Q7 · BR-U1-03)', () => {
  it('요청을 보내지 않고, 로딩도 빈 상태도 아닌 로그인 안내를 보인다', async () => {
    // 토큰 없음(beforeEach 가 지운다). `/explore/saved-places` 는 Stack.Protected 밖이라
    // 딥링크로 게스트가 들어올 수 있다.
    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId('explore-saved-guest')).toBeOnTheScreen()
    );

    // 규칙의 본체 — 담은 목록 조회를 아예 보내지 않는다(BR-U1-03).
    expect(hitsOf('GET', '/api/v1/saved-places')).toHaveLength(0);

    // ★ 이 부정 짝이 이 케이스의 핵심이다. 담은 목록 쿼리는 `enabled: isAuthed` 라 게스트
    // 에게는 **영원히 `isPending: true`** 다(실측). 게스트 분기를 상태 판정보다 먼저 두지
    // 않으면 화면이 끝나지 않는 스켈레톤이 되고, `isLoading` 으로 피하면 이번엔 "담은 게
    // 없다"(empty)라는 거짓말이 뜬다.
    expect(screen.queryByTestId('explore-saved-loading')).toBeNull();
    expect(screen.queryByTestId('explore-saved-empty')).toBeNull();
    expect(itemTestIds()).toEqual([]);

    fireEvent.press(screen.getByTestId('explore-saved-guest-login'));

    expect(mockPush.mock.calls).toEqual([['/(auth)/login']]);
  });
});

describe('S-10 · 낙관 표식 항목 (01b Seed Q3·Q11)', () => {
  it('시계가 뒤로 밀려도 맨 끝에 서고, 해제 요청은 나가지 않는다', async () => {
    // d04 에서 담고 바로 넘어온 찰나의 캐시 모양 — `savedPlaceId` 가 `optimistic:{poiId}` 라
    // **콜론이 섞인다**. savedAt 은 기기 시계에서 온 값이라 일부러 가장 이르게 둔다.
    const optimistic: SavedPlace = {
      savedPlaceId: optimisticSavedPlaceId('p9'),
      savedAt: '2019-01-01T00:00:00.000Z',
      place: makePlace('p9', '방금 담은 곳', '중구'),
    };
    savedRows = [ROWS[1], ROWS[3], optimistic];

    await renderLoaded();
    await waitFor(() => expect(itemTestIds()).toHaveLength(3));

    // 콜론이 섞인 testID 로 실제로 잡는다 — `getByTestId` 는 완전 일치라 통한다(실측).
    expect(
      screen.getByTestId('explore-saved-item-optimistic:p9')
    ).toBeOnTheScreen();
    // savedAt 이 가장 이른데도 맨 끝이다(01b Seed Q3 — 표식이 시계를 이긴다).
    expectOrder(['sp-a', 'sp-b', optimisticSavedPlaceId('p9')]);

    fireEvent.press(screen.getByTestId('explore-saved-remove-optimistic:p9'));

    await waitFor(() =>
      expect(screen.getByTestId('explore-saved-removeerror')).toBeOnTheScreen()
    );
    expect(
      within(screen.getByTestId('explore-saved-removeerror')).getByText(
        '담기 처리 중이에요. 잠시 후 다시 시도해 주세요'
      )
    ).toBeOnTheScreen();

    // 보낼 savedPlaceId 가 아직 없다 — 요청을 지어내지 않고, 그렇다고 침묵하지도 않는다.
    expect(deletedIds()).toEqual([]);
    // 행은 그대로 남고(사라진 채 두면 INV-4 위반), 해제에 실패했으니 담김(찬 하트)을 유지한다.
    expect(
      screen.getByTestId('explore-saved-item-optimistic:p9')
    ).toBeOnTheScreen();
    await waitFor(() =>
      expect(
        screen.getByTestId('explore-saved-remove-optimistic:p9')
      ).toBeSelected()
    );
  });
});

describe('S-11 · 필수 방문지를 건드리지 않는다 (N-4 · AC-9 · BR-U1-37 · TRIP-209 경계)', () => {
  it('해제를 해도 must-visits 요청이 한 건도 나가지 않는다', async () => {
    await renderLoaded();
    await waitFor(() => expect(itemTestIds()).toHaveLength(4));

    fireEvent.press(heart('sp-b'));
    await waitFor(() => expect(deletedIds()).toEqual(['sp-b']));

    // 긍정 짝 — 요청 로그가 실제로 채워졌다. 없으면 아래 0건이 공허하게 통과한다.
    expect(hitsOf('GET', '/api/v1/saved-places').length).toBeGreaterThan(0);

    // 부정 — 시드는 복사이며 원본 담기 상태와 독립이다(BR-U1-37 · INV-U1-04). 시드 실행도
    // 시드 삭제도 TRIP-209 소관이라, 이 칸이 그 API 를 부르면 스코프가 두 화면이 된다.
    const mustVisitHits = observed.filter((hit) =>
      new URL(hit.url).pathname.includes('must-visits')
    );
    expect(mustVisitHits).toEqual([]);
  });
});
