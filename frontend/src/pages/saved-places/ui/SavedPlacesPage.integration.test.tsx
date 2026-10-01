import type { ReactNode } from 'react';
import { Text } from 'react-native';
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
import type {
  MustVisit,
  Place,
  Region,
  SavedPlace,
  Trip,
} from '@/shared/api/generated/schemas';
import { RegionLevel } from '@/shared/api/generated/schemas';
import { useGetTripsTripIdMustVisits } from '@/shared/api/generated/trips/trips';
import { optimisticSavedPlaceId } from '@/features/explore/model/savedPlaceIndex';
import { wizardOriginParams } from '@/features/explore/model/wizardOrigin';
import type { MustVisitSeedItem } from '@/features/trip/model/mustVisitSeed';
import { useTripWizardStore } from '@/features/trip/model/tripWizardStore';
import { tripRecordsTrip } from '@/test-support/tripRecordsTrip';
import {
  captureDraftAtNextCall,
  freshWizardDraft,
  leavePreviousTripDraft,
  resetWizardDraft,
  wizardDraftData,
  withoutSeedFields,
} from '@/test-support/wizardDraftFixture';

import { SavedPlacesPage } from './SavedPlacesPage';

/**
 * d02 담은 장소 페이지(`SavedPlacesPage`)의 **배선** 통합 테스트 — 진짜 react-query + msw 가짜 서버.
 * TRIP-1144 로 5파일(본·regionFilter·rowtap·select·tripMode)을 이 한 파일로 합쳤다. 관점은 맨 바깥 describe 다:
 *
 *  - `save`             — 하트 해제·되돌리기·배너·CTA·빈/에러/게스트 얼굴(옛 본 파일)
 *  - `save › 지역 필터`  — region 파라미터 필터(옛 `.regionFilter`, TRIP-689)
 *  - `save › 행 탭`      — 행 → d06 push 세그먼트(옛 `.rowtap`, TRIP-456)
 *  - `select › 위저드`   — 꼭 갈 곳 고르기, 위저드 모드(옛 `.select`, TRIP-706·982·1012·1026·1042·1093·1106·1113)
 *  - `select › 여행`     — 꼭 갈 곳 고르기, 여행 모드 `?tripId=`(옛 `.tripMode`, TRIP-1093·1106)
 *
 * 왜 통합 버킷인가: 심판 대상이 "실제로 나간 요청"(경로·본문·횟수)·라우팅 목적지·위저드 스토어에 심긴 시드다.
 *
 * ★ 공용은 목·관찰·렌더 도구뿐이다. 픽스처·msw 핸들러·스토어 준비는 관점 describe 의 자기 beforeEach 에 둔다.
 *   특히 `select › 여행` 의 "스토어=서울 / 여행 T=부산" 어긋남은 그 describe 안에만 있다 — 공용으로 올려
 *   같은 값으로 맞추면 스토어를 읽는 잘못된 구현도 green 이 된다.
 * ★ 위저드 스토어·토큰·주소 파라미터·push 목 구현은 모듈 싱글턴이라 리셋을 파일 최상위 afterEach 에 건다 —
 *   describe 안에만 걸면 앞 관점이 남긴 상태가 뒤 관점으로 샌다.
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

// jest.mock 팩토리는 파일 맨 위로 끌어올려져 바깥 변수를 못 본다 — `mock` 접두 변수만 예외다.
// push·back 은 화살표로 감싸 **호출 시점에** 목을 찾는다(즉시 읽으면 hoist 시점의 undefined 가 박힌다,
// TRIP-221 ★16). 구현이 `router` 객체를 쓰든 `useRouter()` 를 쓰든 같은 목에 모인다.
const mockPush = jest.fn();
const mockBack = jest.fn();
// 주소 파라미터 창구 — 테스트가 갈아 끼우고, 목은 호출 시점에 읽는다(최상위 afterEach 가 비운다).
let mockParams: Record<string, string | string[] | undefined> = {};

jest.mock('expo-router', () => ({
  router: {
    push: (href: unknown) => mockPush(href),
    back: () => mockBack(),
  },
  useRouter: () => ({
    push: (href: unknown) => mockPush(href),
    back: () => mockBack(),
  }),
  useLocalSearchParams: () => ({ ...mockParams }),
}));

const BASE = 'http://localhost:8080/api/v1';

/* ── 공용 관찰·렌더 도구 ───────────────────────────────────────────────────── */

/** 나간 요청 — 도착 순서대로. 최상위 beforeEach 가 비운다. */
let observed: { method: string; url: string }[] = [];

function hitsOf(method: string, pathname: string) {
  return observed.filter(
    (hit) => hit.method === method && new URL(hit.url).pathname === pathname
  );
}

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

function itemTestIds(): string[] {
  return screen
    .queryAllByTestId(/^explore-saved-item-/)
    .map((node) => String(node.props.testID));
}

function rowCount(): number {
  return screen.queryAllByTestId(/^mustvisit-pick-row-/).length;
}

/** 행과 "지역 밖" 머리글을 **화면 순서대로**(트리 pre-order) testID 문자열로. 순번·체크 testID 는
 * 정규식 앵커(`row-` 접두 · `region-outside` 끝)에 안 걸린다. */
function orderedPickIds(): string[] {
  return screen
    .queryAllByTestId(/^mustvisit-pick-(row-|region-outside$)/)
    .map((node) => String(node.props.testID));
}

/** 위저드 스토어 구독 해제 목록 — `select › 위저드` W 케이스가 채우고 최상위 afterEach 가 걷는다. */
let storeUnsubscribers: (() => void)[] = [];

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  server.events.on('request:start', ({ request }) => {
    observed.push({ method: request.method, url: request.url });
  });
});

beforeEach(() => {
  observed = [];
  clearAccessToken();
});

// 모듈 싱글턴 정리는 전부 여기 — describe 안 afterEach 는 이보다 먼저 돈다(안쪽 → 바깥 순).
// mockClear 는 구현(`mockImplementation`)을 안 지우므로 mockReset 이다.
afterEach(() => {
  storeUnsubscribers.forEach((unsubscribe) => unsubscribe());
  storeUnsubscribers = [];
  server.resetHandlers();
  clearAccessToken();
  mockPush.mockReset();
  mockBack.mockReset();
  mockParams = {};
  resetWizardDraft();
});

afterAll(() => server.close());

/**
 * ── save ── 옛 `SavedPlacesPage.integration.test.tsx`.
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
describe('save', () => {
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
  function deletedIds(): string[] {
    return observed
      .filter((hit) => hit.method === 'DELETE')
      .map((hit) => new URL(hit.url).pathname.split('/').slice(-1)[0]);
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
  beforeEach(() => {
    savedRows = [...ROWS];
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
        expect(
          screen.getByTestId('explore-saved-removeerror')
        ).toBeOnTheScreen()
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
      expect(
        screen.queryByTestId('explore-saved-removeerror-retry')
      ).toBeNull();
      expect(
        screen.queryByTestId('explore-saved-removeerror-login')
      ).toBeNull();
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
        expect(
          screen.getByTestId('explore-saved-removeerror')
        ).toBeOnTheScreen()
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
        expect(
          screen.getByTestId('explore-saved-removeerror')
        ).toBeOnTheScreen()
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
    // 사용자 결정으로 갱신: 위저드 진입마다 도는 자동 시드는 폐지됐지만(다른 진입점은 항상
    // 빈 상태로 시작), **이 CTA는 "이 장소들로" 만들겠다는 명시적 선택**이라 눌리는 순간 지금
    // 화면에 보이는 목록을 시드로 직접 심는다. 그 전에 `resetMustVisits()`로 이전 세션의 잔존
    // 시드·제외 기억(`excludedMustVisitPoiIds`)을 먼저 비운다(TRIP-458이 잡던 함정 — 위저드 안
    // '더 담기'로 d02를 열고 돌아오면 셸이 재마운트 안 돼 x로 뺀 기억이 남는다).
    it('CTA 는 잔존 기억을 비우고 지금 화면의 목록으로 시드를 다시 심는다', async () => {
      // 준비값을 **비어 있지 않게** 심는다 — reset 값과 달라야 "그냥 안 지운 것"이 아니라
      // "지우고 다시 심었다"는 것을 판별할 수 있다.
      useTripWizardStore.setState({
        mustVisits: [
          {
            sourcePoiId: 'poi-x',
            name: '남겨진 곳',
            imageUrl: null,
            region: null,
          },
        ],
        mustVisitsInitialized: true,
        excludedMustVisitPoiIds: ['poi-y'],
      });

      await renderLoaded();
      await waitFor(() => expect(itemTestIds()).toHaveLength(4));

      fireEvent.press(screen.getByTestId('explore-saved-createtrip'));

      const state = useTripWizardStore.getState();
      // ① 이전 세션의 잔존 기억은 지워진다(poi-x·poi-y 둘 다 안 남는다).
      expect(state.excludedMustVisitPoiIds).toEqual([]);
      // ② 비우고 끝이 아니라 지금 화면의 4곳으로 다시 채워진다 — 이 긍정 짝이 없으면
      //    "비우기만 하는" 구현도 ①만으로 통과한다.
      expect(state.mustVisits.map((one) => one.sourcePoiId).sort()).toEqual([
        'p1',
        'p2',
        'p3',
        'p4',
      ]);
      expect(state.mustVisitsInitialized).toBe(true);
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
        expect(
          screen.getByTestId('explore-saved-removeerror')
        ).toBeOnTheScreen()
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

  /* ────────────────────────────────────────────────────────────────────────────
   * TRIP-1012 C — '이 장소들로 여행 만들기'는 새 여행 진입이다 (#031 · #074 · D9)
   * ──────────────────────────────────────────────────────────────────────────── */

  /**
   * 무엇을 보장하나: 이 CTA 는 위저드 **밖**에서 새 여행을 시작한다. 그래서 이동 직전에 직전 여행의
   * 드래프트(여행지·기간·인원·동반·예산·취향·만든 여행 id·뺀 곳 기억)를 전부 비우고, 그 **다음에**
   * 지금 목록을 꼭 갈 곳으로 심는다. 여행지는 담은 곳에서 추정해 채우지 않는다(#031 현행 유지).
   *
   * ★ push 가 불리는 **그 순간**의 드래프트를 붙잡는다(`captureDraftAtNextCall`). 순서가 거꾸로(시드
   *   → 비우기)면 비우기가 방금 켠 "셸 초기화 1회 건너뛰기" 표시를 꺼서 셸이 시드를 지운다 — 그
   *   표시가 push 시점에 켜져 있는지까지 잰다(셸이 그 표시를 존중하는 것은 `tripWizardEntryReset`
   *   GC-3 이 잠근다).
   */
  describe('🔴 TRIP-1012 C1 · 담은 장소 CTA 는 드래프트를 비운 뒤 지금 목록만 시드한다', () => {
    it('직전 여행 드래프트가 있어도 push 시점엔 여행지·기간·예산 등이 초기값이고, 꼭 갈 곳은 지금 4곳이며 셸 통과 표시가 켜져 있다', async () => {
      leavePreviousTripDraft();
      // 앵커 — 아직 안 비었다(픽스처가 조용히 망가지면 아래 단언이 공짜로 통과한다).
      expect(wizardDraftData()).not.toEqual(freshWizardDraft());
      expect(useTripWizardStore.getState().destinations).toHaveLength(1);
      const draftAtPush = captureDraftAtNextCall(mockPush);

      await renderLoaded();
      await waitFor(() => expect(itemTestIds()).toHaveLength(4));
      fireEvent.press(screen.getByTestId('explore-saved-createtrip'));

      expect(mockPush.mock.calls).toEqual([['/trips/new/step1']]);
      const atPush = draftAtPush();
      expect(atPush).toBeDefined();
      // 시드 3필드를 뺀 나머지는 새 여행의 얼굴 그대로다(뺀 곳 기억 poi-prev-2 도 사라진다).
      expect(withoutSeedFields(atPush ?? {})).toEqual(
        withoutSeedFields(freshWizardDraft())
      );
      // 시드는 지금 화면의 목록 — 직전 여행의 poi-prev-1 은 없다.
      expect(
        ((atPush?.mustVisits ?? []) as MustVisitSeedItem[])
          .map((one) => one.sourcePoiId)
          .sort()
      ).toEqual(['p1', 'p2', 'p3', 'p4']);
      expect(atPush?.mustVisitsInitialized).toBe(true);
      expect(atPush?.preserveMustVisitsOnce).toBe(true);
    });
  });

  describe('TRIP-1012 C2 · 담은 곳에서 여행지를 추정해 채우지 않는다 (#031 현행 유지)', () => {
    it('담은 곳이 전부 수영구여도 push 시점과 이후의 여행지는 비어 있다', async () => {
      savedRows = ['p1', 'p2', 'p3'].map((poiId, index) => ({
        savedPlaceId: `sp-${poiId}`,
        savedAt: `2026-08-0${index + 1}T10:00:00.000Z`,
        place: makePlace(poiId, `장소 ${poiId}`, '수영구'),
      }));
      const draftAtPush = captureDraftAtNextCall(mockPush);

      await renderLoaded();
      await waitFor(() => expect(itemTestIds()).toHaveLength(3));
      fireEvent.press(screen.getByTestId('explore-saved-createtrip'));

      expect(mockPush).toHaveBeenCalledTimes(1);
      expect(draftAtPush()?.destinations).toEqual([]);
      expect(useTripWizardStore.getState().destinations).toEqual([]);
    });
  });
});

/**
 * ── save › 지역 필터 ── 옛 `.regionFilter.integration.test.tsx`.
 * TRIP-689 · d02 저장목록 여행 지역 필터 — 배선(AC-2)·무필터(AC-3)·필터-후-0건(AC-5).
 *
 * 무엇을 보장하나:
 *  - **I1 (AC-3)** region 파라미터가 없으면(홈·탐색·목적지상세 진입) 저장목록 **전체**를 그린다(현행 보존).
 *  - **I2 (AC-2)** region 파라미터가 있으면 지역 안 저장만 남기고, **null 지역은 fail-open으로 표시**한다.
 *  - **I3 (AC-2·★6)** region이 배열이 아니라 **단일 문자열**(단일 목적지 여행)로 와도 배열처럼 정규화한다.
 *  - **I4 (AC-5)** 저장이 비지 않았는데 필터로 0건이면 "담은 곳 없음"(거짓)이 아니라 **구분 안내**
 *    (`explore-saved-region-empty`)를 그린다.
 *
 * 왜 통합 버킷인가: region 파라미터 수신(`useLocalSearchParams`) → 순수 필터 → 화면 얼굴까지가
 * 실제로 관통하는지를 봐야 한다. 목록은 msw가 `GET /saved-places`로 준다(실 훅·실 필터).
 *
 * ★ 하트·CTA를 누르지 않는다 — `onUnhandledRequest:'error'`라 GET 외 요청이 나가면 실패한다(02a ★9).
 * ★ 필터 판정 자체(양방향 접두사·fail-open·빈 지역 급소)의 주 심판은 순수함수 유닛 테스트
 *   (`filterSavedPlacesByTripRegions.test.ts`)다 — 여기선 "페이지가 실제로 그 필터를 태운다"만 본다.
 */
describe('save › 지역 필터', () => {
  function makePlace(poiId: string, region: string | null): Place {
    return {
      poiId,
      nameKo: poiId,
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

  function row(
    savedPlaceId: string,
    poiId: string,
    region: string | null
  ): SavedPlace {
    return {
      savedPlaceId,
      savedAt: '2026-08-01T00:00:00.000Z',
      place: makePlace(poiId, region),
    };
  }

  // 부산 접두사 매칭 1 · 지역 밖(경주) 1 · null(fail-open) 1.
  const MIXED: SavedPlace[] = [
    row('sp-busan', 'p-busan', '부산광역시 해운대구'),
    row('sp-gyeongju', 'p-gyeongju', '경주시'),
    row('sp-null', 'p-null', null),
  ];

  // 전부 실지역이면서 '경주시'와는 전부 비매칭 → 필터 0건(AC-5)용.
  const ALL_REAL_NONMATCH: SavedPlace[] = [
    row('sp-x', 'p-x', '수영구'),
    row('sp-y', 'p-y', '사하구'),
  ];

  let savedRows: SavedPlace[] = [];

  function itemCount(): number {
    return screen.queryAllByTestId(/^explore-saved-item-/).length;
  }
  beforeEach(() => {
    savedRows = [];
    setAccessToken('valid-access'); // 게스트가 아니어야 조회가 나간다.
    server.use(
      http.get(`${BASE}/saved-places`, () => HttpResponse.json(savedRows))
    );
  });

  describe('I1 · region 파라미터 없으면 무필터 (AC-3, 현행 보존)', () => {
    it('저장목록 전체를 그린다(지역 밖·null 포함)', async () => {
      mockParams = {}; // 홈·탐색 FAB·목적지상세 진입 = 파라미터 없음
      savedRows = MIXED;
      renderPage();

      // 3건 전부 도착·표시.
      await waitFor(() => expect(itemCount()).toBe(3));
      expect(
        screen.getByTestId('explore-saved-item-sp-busan')
      ).toBeOnTheScreen();
      expect(
        screen.getByTestId('explore-saved-item-sp-gyeongju')
      ).toBeOnTheScreen();
      expect(
        screen.getByTestId('explore-saved-item-sp-null')
      ).toBeOnTheScreen();
    });
  });

  describe('I2 · region 파라미터 → 지역 안만 (AC-2, fail-open 포함)', () => {
    it('부산 지역과 null(fail-open)은 남고, 지역 밖(경주)은 빠진다', async () => {
      mockParams = { region: ['부산광역시'] };
      savedRows = MIXED;
      renderPage();

      await waitFor(() =>
        expect(
          screen.getByTestId('explore-saved-item-sp-busan')
        ).toBeOnTheScreen()
      );
      // null 지역은 fail-open으로 표시.
      expect(
        screen.getByTestId('explore-saved-item-sp-null')
      ).toBeOnTheScreen();
      // 지역 밖(경주)은 숨김 — 부재 단언은 queryBy*.
      expect(screen.queryByTestId('explore-saved-item-sp-gyeongju')).toBeNull();
      expect(itemCount()).toBe(2);
    });
  });

  describe('I3 · region이 단일 문자열이어도 배열처럼 정규화 (AC-2 · ★6)', () => {
    it('배열이 아닌 문자열 파라미터도 필터가 동작한다(정규화 없으면 크래시로도 red)', async () => {
      // expo-router는 1원소 배열 파라미터를 문자열로 되돌릴 수 있다(단일 목적지 여행).
      mockParams = { region: '부산광역시' };
      savedRows = MIXED;
      renderPage();

      await waitFor(() =>
        expect(
          screen.getByTestId('explore-saved-item-sp-busan')
        ).toBeOnTheScreen()
      );
      expect(screen.queryByTestId('explore-saved-item-sp-gyeongju')).toBeNull();
    });
  });

  describe('I4 · 필터-후-0건은 구분 안내 (AC-5, ≠ empty)', () => {
    it('저장이 있는데 지역 필터로 0건이면 region-empty를 그리고 기본 empty는 안 그린다', async () => {
      mockParams = { region: ['경주시'] };
      savedRows = ALL_REAL_NONMATCH; // 전부 실지역·전부 비매칭 → 필터 0건
      renderPage();

      // 지역 필터 0건 전용 안내가 뜬다.
      await waitFor(() =>
        expect(
          screen.getByTestId('explore-saved-region-empty')
        ).toBeOnTheScreen()
      );
      // "담은 곳 없음"(기본 empty)은 거짓이므로 안 뜬다.
      expect(screen.queryByTestId('explore-saved-empty')).toBeNull();
      // 실제로 행은 0건.
      expect(itemCount()).toBe(0);
    });
  });
});

/**
 * ── save › 행 탭 ── 옛 `.rowtap.integration.test.tsx`.
 * TRIP-456 · AC-2 — d02 담은 장소 행 → d06 상세 배선(페이지 층).
 *
 * 무엇을 보장하나: 행을 누르면 push 세그먼트가 **place.poiId** 다 — 행 키인 savedPlaceId 가 아니다.
 * 둘을 일부러 다른 값으로 두었으므로, 세그먼트를 savedPlaceId 로 바꾸는 뮤테이션은 여기서 red 다.
 *
 * 왜 통합 버킷인가: 심판 대상이 "조립된 push 문자열의 세그먼트"다 — 낙관 표식·정렬을 거친 뒤의
 * 최종 poiId 는 msw 목록에서 나온 실데이터라야 의미가 있다(`SavedPlacesPage.integration` 선례).
 */
describe('save › 행 탭', () => {
  function makePlace(poiId: string, nameKo: string): Place {
    return {
      poiId,
      nameKo,
      category: '명소',
      lat: 35.1,
      lng: 129.1,
      region: '부산',
      openingHours: null,
      imageUrl: null,
      tags: [],
      savedCount: 3,
      dataStatus: 'ACTIVE',
    };
  }

  // ★ savedPlaceId('saved-x') ≠ place.poiId('p9') — push 는 place.poiId 여야 한다.
  const ROWS: SavedPlace[] = [
    {
      savedPlaceId: 'saved-x',
      savedAt: '2026-08-01T00:00:00Z',
      place: makePlace('p9', '감천문화마을'),
    },
  ];
  beforeEach(() => {
    setAccessToken('valid-access');
    server.use(http.get(`${BASE}/saved-places`, () => HttpResponse.json(ROWS)));
  });

  describe('AC-2 · d02 행 → d06 push', () => {
    it('행을 누르면 place.poiId 로 이동한다 — 행 키(savedPlaceId)가 아니다', async () => {
      // 준비 — 담은 장소 1건이 도착할 때까지.
      renderPage();
      await waitFor(() =>
        expect(
          screen.getByTestId('explore-saved-item-saved-x')
        ).toBeOnTheScreen()
      );

      // 실행 — 행 본문(savedPlaceId testID)을 누른다.
      fireEvent.press(screen.getByTestId('explore-saved-item-saved-x'));

      // 단언 — 세그먼트는 place.poiId. savedPlaceId 를 실으면 red(뮤테이션 잠금).
      expect(mockPush.mock.calls).toEqual([['/explore/places/p9']]);
    });
  });
});

/**
 * ── select › 위저드 ── 옛 `.select.integration.test.tsx`.
 * TRIP-706 [d02] select 모드 **배선** — `SavedPlacesPage`(save 무접촉·별 파일, 게이트① 무개봉).
 *
 * 무엇을 보장하나:
 *  - **IS-1 (AC-3)** `?mode=select` 면 select 화면(체크 토글), mode 없으면 기존 save 화면(하트).
 *    `useLocalSearchParams().mode` 로 갈린다. (mode 없음 쪽 it 은 `save` 관점 전부가 같은 결함을 잡아 TRIP-1144 에서 지웠다.)
 *  - **IS-2 (AC-1 · TRIP-491 재현)** 6곳 중 3곳만 골라 완료하면 **선택한 3곳만** 위저드 스토어에
 *    시드된다(미선택 3곳은 빠짐). 전부 시드가 아님을 부정 짝으로 잠근다 — 이것이 TRIP-491 급소다.
 *  - **IS-3 (AC-2)** 선택 0곳이면 완료가 disabled — 눌러도 시드·네비 콜백이 0회다(빈 시드 진입 방지). TRIP-1144 에서 `TRIP-982 A8` 첫 it 이 같은 결함을
 *    잡아 지웠다(뮤테이션 확인).
 *
 * 왜 통합 버킷인가: 심판 대상이 "**실제로 심긴 시드**"(`useTripWizardStore.getState().mustVisits`)와
 * mode 분기다. 페이지가 선택 집합을 소유(D2)하고 완료 시 `seedMustVisitsFromD02(seedMustVisits(선택분))`
 * 로 심는다 — save-mode CTA(`onPressCreateTrip`) 선례와 동형(`SavedPlacesPage.tsx`).
 *
 * ★ No QueryClient 함정(traps-explore): `useSavedPlaces`(react-query)를 물어 `QueryClientProvider`
 *   래퍼 필수. select 화면 자체는 props-only 라 그 화면 테스트는 래퍼가 필요 없다(별 파일, 02a §4-5).
 * ★ 선택/미선택은 색 fill 이 아니라 체크 press→선택 반영으로 관측 — 시드 내용이 최종 증거다.
 */
describe('select › 위저드', () => {
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
  beforeEach(() => {
    useTripWizardStore.getState().reset();
    server.use(http.get(`${BASE}/saved-places`, () => HttpResponse.json(ROWS)));
  });

  /** select 6행이 그려진 상태까지 만든다. */
  async function renderSelectLoaded() {
    mockParams.mode = 'select';
    setAccessToken('valid-access');
    renderPage();
    // 파일 첫 테스트가 냉시작(모듈 첫 로드)을 흡수해 CI 에서 기본 1000ms 경계를 넘는다 — develop 로컬
    // --no-cache 도 751~879ms 선재 경계. 첫 목록 대기만 5000ms(TRIP-1125 04_qa-verifier_report_5 참조).
    await waitFor(
      () =>
        expect(screen.getByTestId('mustvisit-pick-row-p1')).toBeOnTheScreen(),
      { timeout: 5000 }
    );
  }

  describe('IS-1 · mode 파라미터로 화면이 갈린다 (AC-3)', () => {
    it('?mode=select 면 select 화면(체크 토글)을 그린다', async () => {
      await renderSelectLoaded();

      expect(screen.getByTestId('mustvisit-pick-root')).toBeOnTheScreen();
      // 여행 만들기 CTA(save 화면 것)는 없다 — 두 화면은 별개다.
      expect(screen.queryByTestId('explore-saved-createtrip')).toBeNull();
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
        expect(state.mustVisits.some((m) => m.sourcePoiId === poiId)).toBe(
          false
        );
      });
      // 위저드로 이동.
      expect(mockPush).toHaveBeenCalledWith('/trips/new/step1');
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
    mockParams.mode = 'select';
    if (region) mockParams.region = region;
    setAccessToken('valid-access');
    renderPage();
  }

  function fallbackCount(): number {
    return screen.queryAllByTestId('mustvisit-pick-region-fallback').length;
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
        expect(
          screen.getByTestId('mustvisit-pick-row-p-busan')
        ).toBeOnTheScreen()
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
    mockParams.mode = 'select';
    mockParams.region = ['서울특별시'];
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
      server.use(
        http.get(`${BASE}/saved-places`, () => HttpResponse.json(rows))
      );
      const client = new QueryClient({
        defaultOptions: {
          queries: { retry: false, gcTime: 0 },
          mutations: { gcTime: 0 },
        },
      });
      mockParams.mode = 'select';
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
        expect(
          screen.queryByTestId(`mustvisit-pick-check-${poiId}`)
        ).toBeNull();
        expect(
          screen.getByTestId(`mustvisit-pick-row-${poiId}`)
        ).toBeDisabled();
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
      expect(
        screen.queryAllByTestId('mustvisit-pick-region-empty')
      ).toHaveLength(0);
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
      expect(
        screen.queryAllByTestId('mustvisit-pick-region-empty')
      ).toHaveLength(0);
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
    expect(useTripWizardStore.getState().excludedMustVisitPoiIds).toEqual([
      'p2',
    ]);
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

      expect(useTripWizardStore.getState().preserveCreatedTripIdOnce).toBe(
        true
      );
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
      expect(useTripWizardStore.getState().preserveCreatedTripIdOnce).toBe(
        true
      );
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
      expect(useTripWizardStore.getState().preserveCreatedTripIdOnce).toBe(
        true
      );
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
      expect(useTripWizardStore.getState().preserveCreatedTripIdOnce).toBe(
        true
      );
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
});

/**
 * ── select › 여행 ── 옛 `.tripMode.integration.test.tsx`.
 * TRIP-1093 결정 3 — d02 꼭 갈 곳 고르기의 **여행 모드**(`?mode=select&tripId=T`) 배선.
 * h02 필수 방문지의 「꼭 갈 곳 추가」로 들어와, 이미 만든 여행 T 에 필수 방문지를 더한다.
 *
 * 무엇을 보장하나(01 AC-5~13 · 01b S1~S3·Q2·Q3):
 *  - 지역 판정(BR-U1-58)은 **여행 T 의 목적지**로 한다 — 위저드 스토어가 아니다(T1·T11).
 *  - 지역 밖 행은 골라지지 않고 POST 에도 안 실린다(T2).
 *  - 완료 = 새로 고른 곳마다 `POST /trips/T/must-visits {poiId, type:'ANYTIME'}` → 스택 아래 h02 가 쓰는
 *    목록 캐시가 새 항목을 받고 → `back()` 한 번(T3). 위저드로 가지 않는다(push 0).
 *  - 위저드 스토어는 읽지도 쓰지도 않는다(T4).
 *  - 이미 그 여행 필수 방문지인 곳은 체크된 채 잠겨 다시 못 넣고, 새로 고른 곳이 0이면 완료가 꺼진다(T5).
 *  - 409(이미 있음)는 성공으로 친다(T6). 일부가 실패하면 화면에 남아 배너로 알리고, 재시도는 실패분만
 *    보낸다(T7 · INV-4). 연타해도 POST 는 고른 수만큼(T8).
 *  - 여행·등록 목록이 도착하기 전엔 결과를 그리지 않고(T9), 조회 실패는 에러 얼굴 + 다시 시도(T10).
 *
 * ★ 픽스처가 이 파일의 본체다: 여행 T 는 **부산(26)**, 위저드 스토어는 **서울(11)** 이고 스토어 꼭 갈 곳엔
 *   `bs2` 가 있다. 스토어를 읽는 잘못된 구현은 판정이 정반대(서울 장소가 안, 부산 장소가 밖)가 되고 `bs2`
 *   가 미리 체크돼 나온다 — 둘을 같게 두면 그 구현도 green 이다(01 맹점 ①).
 * ★ `router.back()` 은 목이라 h02 가 실제로 다시 그려지지 않는다. 그래서 같은 QueryClient 에 h02 와
 *   **같은 캐시 키**를 구독하는 프로브(`H02Probe`)를 함께 렌더해 "돌아간 h02 가 새 항목을 본다"를 잰다.
 *
 * 3동작 뼈대: 준비=가짜 서버·위저드 스토어 → 실행=체크·완료를 누른다 → 단언=나간 요청·back·보이는 것.
 */
describe('select › 여행', () => {
  const TRIP_ID = '22222222-2222-2222-2222-222222222222';
  const TRIP_PATH = `/api/v1/trips/${TRIP_ID}`;
  const MUST_VISITS_PATH = `/api/v1/trips/${TRIP_ID}/must-visits`;
  const SAVED_PATH = '/api/v1/saved-places';

  /** 여행 T — 목적지 부산광역시(코드 26). */
  const BUSAN_TRIP: Trip = {
    ...tripRecordsTrip('부산 여행', TRIP_ID),
    destinations: [
      { seq: 1, region: '부산광역시', nights: 2, regionCode: '26' },
    ],
  };

  function makePlace(poiId: string, region: string, regionCode: string): Place {
    return {
      poiId,
      nameKo: `장소 ${poiId}`,
      category: '명소',
      lat: 35.1587,
      lng: 129.1604,
      region,
      regionCode,
      openingHours: null,
      imageUrl: null,
      tags: [],
      savedCount: 0,
      dataStatus: 'ACTIVE',
    };
  }

  function saved(
    poiId: string,
    region: string,
    regionCode: string,
    savedAt: string
  ): SavedPlace {
    return {
      savedPlaceId: `sp-${poiId}`,
      savedAt,
      place: makePlace(poiId, region, regionCode),
    };
  }

  /** 담은 곳 4곳 — savedAt 오름차순이라 bs1·bs2·bs3·se1 순. 부산 셋 · 서울 하나. */
  const SAVED: SavedPlace[] = [
    saved('bs1', '해운대구', '26350', '2026-09-01T01:00:00.000Z'),
    saved('bs2', '수영구', '26500', '2026-09-01T02:00:00.000Z'),
    saved('bs3', '중구', '26110', '2026-09-01T03:00:00.000Z'),
    saved('se1', '종로구', '11110', '2026-09-01T04:00:00.000Z'),
  ];

  /** 부산 여행 기준 화면 순서 — 안 3곳 → "이 여행 지역 밖" 머리글 → 서울 1곳. */
  const TRIP_ORDER = [
    'mustvisit-pick-row-bs1',
    'mustvisit-pick-row-bs2',
    'mustvisit-pick-row-bs3',
    'mustvisit-pick-region-outside',
    'mustvisit-pick-row-se1',
  ];

  function mustVisit(sourcePoiId: string): MustVisit {
    return {
      mustVisitId: `mv-${sourcePoiId}`,
      poiSnapshotId: `snap-${sourcePoiId}`,
      sourcePoiId,
      type: 'ANYTIME',
    };
  }
  /* ── 가짜 서버 상태 ─────────────────────────────────────────────────────────── */

  /** 서버에 등록된 여행 T 의 필수 방문지. POST 성공(201)·409 는 여기 더한다. */
  let mustVisitStore: MustVisit[] = [];
  /** poiId → POST 응답 상태(없으면 201). */
  let postStatus: Record<string, number> = {};
  /** 도착한 POST 본문 — 도착 순서대로. */
  let postBodies: unknown[] = [];
  let tripStatus: number | null = null;
  let mustVisitsStatus: number | null = null;
  let holdTrip = false;
  let holdMustVisits = false;
  let holdPost = false;
  /** 보류 중인 응답을 푸는 스위치들. afterEach 가 반드시 비운다(워커가 매달리지 않게, 02a ★4). */
  let releasers: (() => void)[] = [];

  function held(): Promise<void> {
    return new Promise((resolve) => {
      releasers.push(resolve);
    });
  }

  function releaseAll(): void {
    const pending = releasers;
    releasers = [];
    pending.forEach((release) => release());
  }

  function hits(method: string, pathname: string): number {
    return hitsOf(method, pathname).length;
  }

  // ★ 위저드 드래프트 — 일부러 여행 T 와 **다른** 지역(서울 11)과 꼭 갈 곳(bs2)을 남겨 둔다(이 관점의 본체).
  //   이 describe 안에만 둔다 — 공용으로 올려 같은 값으로 맞추면 스토어를 읽는 구현도 green 이다.
  beforeEach(() => {
    mustVisitStore = [mustVisit('bs3')];
    postStatus = {};
    postBodies = [];
    tripStatus = null;
    mustVisitsStatus = null;
    holdTrip = false;
    holdMustVisits = false;
    holdPost = false;
    releasers = [];

    useTripWizardStore.getState().reset();
    useTripWizardStore.setState({
      destinations: [
        { seq: 1, region: '서울특별시', nights: 1, regionCode: '11' },
      ],
      mustVisits: [
        {
          sourcePoiId: 'bs2',
          name: '장소 bs2',
          imageUrl: null,
          region: '수영구',
        },
      ],
      mustVisitsInitialized: true,
    });

    server.use(
      http.get(`${BASE}/saved-places`, () => HttpResponse.json(SAVED)),
      http.get(`${BASE}/trips/:tripId`, async () => {
        if (holdTrip) await held();
        if (tripStatus !== null)
          return HttpResponse.json({}, { status: tripStatus });
        return HttpResponse.json(BUSAN_TRIP);
      }),
      http.get(`${BASE}/trips/:tripId/must-visits`, async () => {
        if (holdMustVisits) await held();
        if (mustVisitsStatus !== null)
          return HttpResponse.json({}, { status: mustVisitsStatus });
        return HttpResponse.json(mustVisitStore);
      }),
      http.post(`${BASE}/trips/:tripId/must-visits`, async ({ request }) => {
        const body = (await request.json()) as { poiId: string };
        postBodies.push(body);
        if (holdPost) await held();
        const status = postStatus[body.poiId] ?? 201;
        // 201 = 새로 등록, 409 = 다른 기기에서 먼저 넣음 — 어느 쪽이든 서버엔 그 곳이 있다.
        if (
          (status === 201 || status === 409) &&
          !mustVisitStore.some((entry) => entry.sourcePoiId === body.poiId)
        ) {
          mustVisitStore = [...mustVisitStore, mustVisit(body.poiId)];
        }
        if (status === 201)
          return HttpResponse.json(mustVisit(body.poiId), { status: 201 });
        return HttpResponse.json({}, { status });
      })
    );
  });
  // 보류 중 응답을 먼저 풀어야 워커가 매달리지 않는다 — 최상위 afterEach(핸들러 리셋)보다 먼저 돈다.
  afterEach(() => {
    releaseAll();
  });

  /* ── 렌더 ─────────────────────────────────────────────────────────────────── */

  /**
   * 스택 아래 h02 의 대역 — h02(`MustVisitListPage`)와 **같은 생성 훅·같은 캐시 키**로 여행 T 의 필수
   * 방문지를 구독하고, 받은 sourcePoiId 들을 쉼표로 이어 보여 준다(02a ★2).
   */
  function H02Probe() {
    const { data } = useGetTripsTripIdMustVisits(TRIP_ID);
    return (
      <Text testID="h02-probe">
        {(data ?? []).map((entry) => entry.sourcePoiId).join(',')}
      </Text>
    );
  }

  /**
   * h02 가 싣는 파라미터(`mode=select` + `tripId`)로 d02 를 연다. `gcTime: 0`·`retry: false` 는 리포 관례
   * (타이머 누수·재시도로 요청 수가 흔들리는 것 방지). 클라이언트를 돌려주는 이유: 로딩 게이트(T9)가
   * "보류 중인 조회만 남았다"를 `isFetching()` 으로 확인한다.
   */
  function openTripMode(options?: { withProbe?: boolean }) {
    mockParams.mode = 'select';
    mockParams.tripId = TRIP_ID;
    setAccessToken('valid-access');
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
    render(
      <>
        <SavedPlacesPage />
        {options?.withProbe ? <H02Probe /> : null}
      </>,
      { wrapper: Wrapper }
    );
    return { client };
  }

  /** 모든 조회가 끝나 행 4개가 선 상태까지 기다린다. */
  async function settle(client: QueryClient): Promise<void> {
    await waitFor(() => {
      expect(rowCount()).toBe(4);
      expect(client.isFetching()).toBe(0);
    });
  }

  function subtitle() {
    return screen.getByTestId('mustvisit-pick-subtitle');
  }

  function check(poiId: string) {
    return screen.getByTestId(`mustvisit-pick-check-${poiId}`);
  }

  function bannerCount(): number {
    return screen.queryAllByTestId('mustvisit-pick-complete-error').length;
  }

  function pressComplete(): void {
    fireEvent.press(screen.getByTestId('mustvisit-pick-complete'));
  }

  /* ── 케이스 ───────────────────────────────────────────────────────────────── */

  describe('🔴 TRIP-1093 T1 · AC-5 — 지역 판정은 여행 T 의 목적지로 한다 (BR-U1-58)', () => {
    it('부산 여행이면 부산 세 곳이 안, 서울 종로구는 "이 여행 지역 밖" 아래 체크 없이 흐리다 — 스토어의 서울이 아니다', async () => {
      // 준비·실행
      const { client } = openTripMode();
      await settle(client);

      // 단언 — 순서(안 → 머리글 → 밖)와 고를 수 있는지.
      expect(orderedPickIds()).toEqual(TRIP_ORDER);
      expect(check('bs1')).not.toBeDisabled();
      expect(screen.queryAllByTestId('mustvisit-pick-check-se1').length).toBe(
        0
      );
      expect(screen.getByTestId('mustvisit-pick-row-se1')).toBeDisabled();
      // 선택 수는 채워진 체크 전부 — 이미 등록돼 잠긴 bs3 하나(01b Q2).
      expect(subtitle()).toHaveTextContent('담은 곳 4곳 · 1곳 선택됨');
    });
  });

  describe('🔴 TRIP-1093 T2 · AC-6 — 여행 지역 밖 행은 골라지지 않고 POST 에도 안 실린다', () => {
    it('se1 행을 눌러도 선택 수가 그대로이고, bs1 을 골라 완료하면 본문은 bs1 하나뿐이다', async () => {
      const { client } = openTripMode();
      await settle(client);

      // 실행 ① — 지역 밖 행 누름
      fireEvent.press(screen.getByTestId('mustvisit-pick-row-se1'));
      expect(subtitle()).toHaveTextContent('담은 곳 4곳 · 1곳 선택됨');

      // 실행 ② — 안 행을 골라 완료
      fireEvent.press(check('bs1'));
      pressComplete();

      // 단언
      await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
      expect(postBodies).toEqual([{ poiId: 'bs1', type: 'ANYTIME' }]);
    });
  });

  describe('🔴 TRIP-1093 T3 · AC-7 — 완료하면 고른 곳을 ANYTIME 으로 한 번 등록하고 h02 로 돌아간다 (US-TRIP-08)', () => {
    it('POST 1건·본문 {poiId, type} 정확히 · 아래층 h02 캐시가 새 항목을 받고 · back 1회 · push 0회', async () => {
      // 준비 — 스택 아래 h02 대역(프로브)까지 함께 띄운다.
      const { client } = openTripMode({ withProbe: true });
      await settle(client);
      expect(screen.getByTestId('h02-probe')).toHaveTextContent('bs3'); // 앵커 — 처음엔 등록분 bs3 뿐
      expect(bannerCount()).toBe(0); // 앵커 — 실행 전 배너 없음

      // 실행
      fireEvent.press(check('bs1'));
      pressComplete();

      // 단언 ① — 이동: 뒤로 한 번, 위저드(step1) 등 어떤 push 도 없다.
      await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
      expect(mockPush.mock.calls).toEqual([]);

      // 단언 ② — 요청: 이 여행 경로로 정확히 1건, 본문은 최소본(여분 키 = 솔버 힌트라 금지).
      expect(hits('POST', MUST_VISITS_PATH)).toBe(1);
      expect(postBodies).toHaveLength(1);
      expect(postBodies[0]).toEqual({ poiId: 'bs1', type: 'ANYTIME' });

      // 단언 ③ — 돌아간 h02 가 새 항목을 본다(같은 캐시 키가 다시 채워졌다).
      await waitFor(() =>
        expect(screen.getByTestId('h02-probe')).toHaveTextContent('bs3,bs1')
      );
      expect(bannerCount()).toBe(0);
    });
  });

  describe('🔴 TRIP-1093 T4 · AC-8 — 위저드 스토어는 읽지도 쓰지도 않는다', () => {
    it('스토어의 꼭 갈 곳 bs2 는 체크된 채 뜨지 않고, 완료 뒤에도 드래프트 전체가 그대로다', async () => {
      // 준비 — 드래프트 스냅숏(데이터 필드만)을 떠 둔다.
      const before = wizardDraftData();
      const { client } = openTripMode();
      await settle(client);

      // 단언 ① — 초기 체크는 스토어에서 오지 않는다.
      expect(check('bs2')).not.toBeSelected();
      expect(
        screen.getByTestId('mustvisit-pick-check-outline-bs2')
      ).toBeOnTheScreen();

      // 실행
      fireEvent.press(check('bs1'));
      pressComplete();
      await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));

      // 단언 ② — 드래프트 불변(꼭 갈 곳·뺀 목록·목적지·보존 표시 모두).
      expect(wizardDraftData()).toEqual(before);
    });
  });

  describe('🔴 TRIP-1093 T5 · AC-9 — 이미 등록된 곳은 체크된 채 잠기고 다시 보내지 않는다 (INV-U1-18 · 01b Q2)', () => {
    it('bs3 는 선택+잠금 상태이고 눌러도 안 풀리며, 새로 고른 곳이 0이면 완료가 꺼지고, bs1 을 고르면 bs1 만 보낸다', async () => {
      const { client } = openTripMode();
      await settle(client);

      // 단언 ① — 잠금: 채운 글리프 + 접근성 상태 selected·disabled(색이 아니라 상태로 잰다, 02a ★8).
      expect(check('bs3')).toBeSelected();
      expect(check('bs3')).toBeDisabled();
      expect(
        screen.getByTestId('mustvisit-pick-check-filled-bs3')
      ).toBeOnTheScreen();

      // 실행 ① — 잠긴 체크를 눌러 본다.
      fireEvent.press(check('bs3'));
      expect(check('bs3')).toBeSelected();
      expect(subtitle()).toHaveTextContent('담은 곳 4곳 · 1곳 선택됨');

      // 단언 ② — 새로 고른 곳 0 → 완료가 진짜로 꺼져 있다(눌러도 요청·이동 0).
      expect(screen.getByTestId('mustvisit-pick-complete')).toBeDisabled();
      pressComplete();
      await act(async () => {});
      expect(postBodies).toEqual([]);
      expect(mockBack).toHaveBeenCalledTimes(0);

      // 실행 ② — bs1 을 골라 완료
      fireEvent.press(check('bs1'));
      expect(screen.getByTestId('mustvisit-pick-complete')).not.toBeDisabled();
      pressComplete();

      // 단언 ③ — 잠긴 bs3 는 본문에 없다.
      await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
      expect(postBodies).toEqual([{ poiId: 'bs1', type: 'ANYTIME' }]);
    });
  });

  describe('🔴 TRIP-1093 T6 · AC-10 — 409(이미 있음)는 실패가 아니다', () => {
    it('bs1 POST 가 409 여도 배너 없이 돌아간다', async () => {
      // 준비 — 다른 기기에서 먼저 넣은 경우.
      postStatus = { bs1: 409 };
      const { client } = openTripMode();
      await settle(client);

      // 실행
      fireEvent.press(check('bs1'));
      pressComplete();

      // 단언
      await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
      expect(postBodies).toEqual([{ poiId: 'bs1', type: 'ANYTIME' }]);
      expect(bannerCount()).toBe(0);
    });
  });

  describe('🔴 TRIP-1093 T7 · AC-11 — 일부가 실패하면 화면에 남아 알리고, 재시도는 실패분만 보낸다 (INV-4)', () => {
    it('bs2 가 500 이면 back 0·배너 문구 정확 · 재조회로 bs1 이 잠기고 · 조작하면 배너가 지워지며 · 다시 완료하면 bs2 만 간다', async () => {
      // 준비
      postStatus = { bs2: 500 };
      const { client } = openTripMode();
      await settle(client);
      expect(bannerCount()).toBe(0); // 앵커 — 실행 전 배너 없음

      // 실행 ① — 두 곳을 골라 완료
      fireEvent.press(check('bs1'));
      fireEvent.press(check('bs2'));
      pressComplete();

      // 단언 ① — 머문다 + 몇 곳 중 몇 곳이 안 됐는지 말한다.
      await waitFor(() => expect(bannerCount()).toBe(1));
      expect(
        screen.getByTestId('mustvisit-pick-complete-error')
      ).toHaveTextContent('꼭 갈 곳 2곳 중 1곳을 등록하지 못했어요');
      expect(mockBack).toHaveBeenCalledTimes(0);

      // 단언 ② — 이미 등록된 bs1 은 다시 읽혀 잠기고, 실패한 bs2 는 선택이 남는다.
      await waitFor(() => expect(check('bs1')).toBeDisabled());
      expect(check('bs1')).toBeSelected();
      expect(check('bs2')).toBeSelected();

      // 실행 ② — 다음 조작(체크 해제)에서 배너가 지워진다(타이머 없음, 01b Q3).
      fireEvent.press(check('bs2'));
      expect(bannerCount()).toBe(0);
      expect(check('bs2')).not.toBeSelected();

      // 실행 ③ — 다시 골라 재시도(이번엔 성공)
      postStatus = {};
      postBodies = [];
      fireEvent.press(check('bs2'));
      pressComplete();

      // 단언 ③ — 실패분만 보냈고 이제 돌아간다.
      await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
      expect(postBodies).toEqual([{ poiId: 'bs2', type: 'ANYTIME' }]);
      expect(bannerCount()).toBe(0);
    });
  });

  describe('🔴 TRIP-1093 T8 · AC-12 — 응답 전 연타해도 POST 는 고른 수만큼', () => {
    it('완료를 두 번 눌러도 bs1 POST 는 1건이고 back 도 1회다', async () => {
      // 준비 — POST 응답을 붙든다.
      holdPost = true;
      const { client } = openTripMode();
      await settle(client);

      // 실행 — 응답 전에 두 번
      fireEvent.press(check('bs1'));
      pressComplete();
      pressComplete();
      await waitFor(() => expect(postBodies.length).toBeGreaterThanOrEqual(1));
      await act(async () => {});

      // 풀기
      holdPost = false;
      releaseAll();

      // 단언
      await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
      expect(postBodies.length).toBe(1);
      expect(hits('POST', MUST_VISITS_PATH)).toBe(1);
    });
  });

  describe('🔴 TRIP-1093 T9 · AC-13 — 여행·등록 목록이 오기 전엔 결과를 그리지 않는다 (맹점 ③ fail-open)', () => {
    it.each([
      ['여행 조회', 'trip', TRIP_PATH],
      ['등록 목록 조회', 'mustVisits', MUST_VISITS_PATH],
    ] as const)(
      '%s 가 보류 중이면 담은 곳이 도착해도 행 0·스켈레톤이고, 풀리면 여행 기준으로 4행이 선다',
      async (_label, which, heldPath) => {
        // 준비 — 한 조회만 붙든다.
        if (which === 'trip') holdTrip = true;
        else holdMustVisits = true;
        const { client } = openTripMode();

        // 담은 곳은 도착했고, 붙든 조회 하나만 남았다(공허 통과 차단 — 02a ★5).
        await waitFor(() => {
          expect(hits('GET', SAVED_PATH)).toBeGreaterThanOrEqual(1);
          expect(hits('GET', heldPath)).toBeGreaterThanOrEqual(1);
          expect(client.isFetching()).toBe(1);
        });
        await act(async () => {});

        // 단언 ① — 결과 얼굴이 아니다.
        expect(rowCount()).toBe(0);
        expect(
          screen.queryAllByTestId('mustvisit-pick-skeleton-row-0').length
        ).toBe(1);

        // 실행 — 푼다
        holdTrip = false;
        holdMustVisits = false;
        releaseAll();

        // 단언 ② — 여행 지역 기준으로 선다.
        await waitFor(() => expect(rowCount()).toBe(4));
        expect(orderedPickIds()).toEqual(TRIP_ORDER);
      }
    );
  });

  describe('🔴 TRIP-1093 T10 · AC-13 — 여행·등록 목록 조회가 실패하면 에러 얼굴 + 다시 시도', () => {
    it.each([
      ['여행 조회', 'trip', TRIP_PATH],
      ['등록 목록 조회', 'mustVisits', MUST_VISITS_PATH],
    ] as const)(
      '%s 가 500 이면 에러 얼굴이고, 다시 시도하면 그 조회를 다시 보내 목록이 선다',
      async (_label, which, failedPath) => {
        // 준비
        if (which === 'trip') tripStatus = 500;
        else mustVisitsStatus = 500;
        openTripMode();

        // 단언 ① — 에러 얼굴
        await screen.findByTestId('mustvisit-pick-error');
        expect(rowCount()).toBe(0);
        const before = hits('GET', failedPath);

        // 실행 — 서버가 회복된 뒤 다시 시도
        tripStatus = null;
        mustVisitsStatus = null;
        fireEvent.press(screen.getByTestId('mustvisit-pick-error-retry'));

        // 단언 ② — 실패한 그 조회가 다시 나갔고 목록이 선다.
        await waitFor(() =>
          expect(hits('GET', failedPath)).toBeGreaterThan(before)
        );
        await waitFor(() => expect(rowCount()).toBe(4));
      }
    );
  });

  describe('🔴 TRIP-1093 T11 · AC-5·01b S3 — 탐색으로 가는 버튼도 여행 T 의 지역 이름을 싣는다', () => {
    it('"+ 탐색에서 더 담기"는 부산광역시 + 위저드 출처를 실어 d04 로 간다 (스토어의 서울이 아니다)', async () => {
      const { client } = openTripMode();
      await settle(client);

      fireEvent.press(screen.getByTestId('mustvisit-pick-addmore'));

      // 기대값의 출처 파라미터는 헬퍼 출력으로 만든다(철자 손복제 금지, TRIP-1026 관례).
      expect(mockPush.mock.calls).toEqual([
        [
          {
            pathname: '/explore/places',
            params: { region: ['부산광역시'], ...wizardOriginParams() },
          },
        ],
      ]);
    });
  });

  describe('🔴 TRIP-1093 T12 · AC-12 — 성공 응답 뒤, 등록 목록 재조회가 끝나기 전에 한 번 더 눌러도 POST·back 은 한 번 (03b 경고-1)', () => {
    it('bs1 완료가 201 로 끝나 back 1회 → 재조회가 붙들린 사이 완료를 또 눌러도 bs1 POST 1건·back 1회다', async () => {
      // 준비 — 첫 조회는 그대로 끝내고, 완료 뒤 무효화가 부르는 재조회만 붙든다.
      const { client } = openTripMode();
      await settle(client);
      holdMustVisits = true;
      const listReadsBefore = hits('GET', MUST_VISITS_PATH);

      // 실행 ① — 고르고 완료 → 201 → 뒤로 한 번.
      fireEvent.press(check('bs1'));
      pressComplete();
      await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));

      // 앵커 — 재조회가 나갔고 아직 안 끝났다(잠금 목록이 옛 값인 창이 실제로 열려 있다).
      await waitFor(() => {
        expect(hits('GET', MUST_VISITS_PATH)).toBeGreaterThan(listReadsBefore);
        expect(client.isFetching()).toBe(1);
      });

      // 실행 ② — 화면이 아직 떠 있는 동안 한 번 더.
      pressComplete();
      await act(async () => {});

      // 풀기 — 재조회를 끝내 bs1 이 잠기는 것까지 기다린다(두 번째 POST 가 나갔다면 이 사이 도착한다).
      holdMustVisits = false;
      releaseAll();
      await waitFor(() => expect(check('bs1')).toBeDisabled());
      await waitFor(() => expect(client.isFetching()).toBe(0));

      // 단언
      expect(postBodies).toEqual([{ poiId: 'bs1', type: 'ANYTIME' }]);
      expect(hits('POST', MUST_VISITS_PATH)).toBe(1);
      expect(mockBack).toHaveBeenCalledTimes(1);
    });
  });

  describe('🔴 TRIP-1093 T13 · AC-7 — 체크한 뒤 목록에서 사라진 곳은 완료 POST 에 실리지 않는다 (03b 경고-2)', () => {
    it('bs1 체크 → d04 에서 bs1 담기 해제로 목록이 3행이 된 뒤 bs2 를 골라 완료하면 본문은 bs2 하나뿐이다', async () => {
      // 준비 — 담은 곳 응답을 바꿀 수 있게 쥔다(select 통합 「TRIP-1012 Q1 경계」와 같은 장치).
      let rows: SavedPlace[] = SAVED;
      server.use(
        http.get(`${BASE}/saved-places`, () => HttpResponse.json(rows))
      );
      const { client } = openTripMode();
      await settle(client);

      // 실행 ① — 보일 때 bs1 을 고른다.
      fireEvent.press(check('bs1'));
      expect(subtitle()).toHaveTextContent('담은 곳 4곳 · 2곳 선택됨');

      // 실행 ② — d04 에서 bs1 담기를 푼 효과: 응답에서 bs1 이 빠지고 목록을 다시 받는다.
      rows = SAVED.filter((entry) => entry.place.poiId !== 'bs1');
      await act(async () => {
        await client.invalidateQueries();
      });
      await waitFor(() => expect(rowCount()).toBe(3));

      // 앵커 — bs1 행이 실제로 사라졌고, 선택 수도 등록분 bs3 하나로 돌아왔다.
      expect(screen.queryAllByTestId('mustvisit-pick-row-bs1')).toHaveLength(0);
      expect(subtitle()).toHaveTextContent('담은 곳 3곳 · 1곳 선택됨');

      // 실행 ③ — 보이는 bs2 를 골라 완료.
      fireEvent.press(check('bs2'));
      pressComplete();

      // 단언 — 화면에 없는 bs1 은 서버로 가지 않는다.
      await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
      expect(postBodies).toEqual([{ poiId: 'bs2', type: 'ANYTIME' }]);
    });
  });

  /* ── TRIP-1106 — 위저드 쪽 밖 행 규칙이 여행 모드로 새지 않는다 (위 T1~T13 은 무수정) ────────────── */

  /**
   * 무엇을 보장하나(01b Q1·Q2):
   *  - Q1 "선택된 밖 행에 체크를 보여 주고 부제에 센다"는 위저드의 **잠금 아닌** 선택에만 건다. 여행 모드에서
   *    이미 등록된 곳이 여행 지역 밖이어도(se1) 그 행엔 체크가 없고 부제에 안 센다 — 지금 동작 그대로다.
   *  - Q2 밖 행 순번 배지 제거는 두 모드 공통이다(행 컴포넌트를 모드로 가르지 않는다).
   *
   * ★ Q1 은 위 T1~T13 에 없는 경우다(잠긴 bs3 는 지역 안) — "선택 ∪ 잠금을 밖 행까지 센다"는 구현은
   *   T1~T13 을 전부 green 으로 통과한다. 여기서 서버에 밖 se1 을 등록해 둬 그 누수를 잡는다(02a ★6).
   */
  describe('🔒 TRIP-1106 TM-Q1 · 여행 모드 — 이미 등록된 지역 밖 곳은 체크·선택 수에 들지 않는다 (무변경)', () => {
    it('se1(서울)이 여행 T 에 등록돼 있어도 se1 행엔 체크가 없고, 부제는 bs3 하나만 세며, 완료는 닫혀 있다', async () => {
      mustVisitStore = [mustVisit('bs3'), mustVisit('se1')];
      const { client } = openTripMode();
      await settle(client);

      expect(orderedPickIds()).toEqual(TRIP_ORDER);
      // 앵커 — 잠금 목록이 실제로 들어왔다(안 행 bs3 는 체크된 채 잠김).
      expect(check('bs3')).toBeSelected();

      expect(screen.queryByTestId('mustvisit-pick-check-se1')).toBeNull();
      expect(subtitle()).toHaveTextContent('담은 곳 4곳 · 1곳 선택됨');
      expect(screen.getByTestId('mustvisit-pick-complete')).toBeDisabled();
      expect(
        screen.queryAllByTestId('mustvisit-pick-outside-confirm')
      ).toHaveLength(0);
    });
  });

  describe('🔴 TRIP-1106 TM-Q2 · 여행 모드도 밖 행엔 순번 배지가 없다 (결정 1-A · 01b Q2)', () => {
    it('안 행 bs1·bs2·bs3 는 1·2·3, 밖 se1 은 순번 배지가 없다', async () => {
      const { client } = openTripMode();
      await settle(client);

      [
        ['bs1', '1'],
        ['bs2', '2'],
        ['bs3', '3'],
      ].forEach(([poiId, rank]) => {
        // 배지 안엔 숫자 Text 하나뿐이라 완전 일치로 잰다.
        expect(
          screen.getByTestId(`mustvisit-pick-rank-${poiId}`)
        ).toHaveTextContent(rank);
      });
      expect(screen.queryByTestId('mustvisit-pick-rank-se1')).toBeNull();
    });
  });
});
