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
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';
import type { SavedStay, StayItem } from '@/shared/api/generated/schemas';
import { StaySearchPage } from './StaySearchPage';

/**
 * TRIP-417 AC-1·AC-2·AC-3·AC-7·AC-8 (배선) — e02 카드 하트가 실제로 서버 요청·라우팅에 이어진다는 증거.
 * 화면은 라우터·훅을 모르므로(FSD 경계), 하트 press가 진짜로 `POST/DELETE /saved-stays`·초기 채움·
 * 미인증 로그인 이동으로 이어지는지는 이 배선 층에서만 확인할 수 있다.
 *
 * 무엇을 보장하나:
 *  - **P1 (AC-1)** 미담김 하트 press → `POST /saved-stays`가 **buildSaveStayRequest 본문**(MAP_SEARCH·
 *    좌표 보유 시 coordConfirmed:true, TRIP-600)으로 나가고, 응답 전 낙관적으로 찬 하트가 되며, 성공 후 담은 목록을 다시 받는다.
 *  - **P2 (AC-2)** 담김 하트 press → 매칭 **savedStayId**로 `DELETE /saved-stays/{id}`가 나간다(externalId 아님).
 *  - **P3 (AC-3)** 진입 시 `GET /saved-stays`와 externalSource+externalId로 매칭해 초기 채움을 그린다
 *    (외부키 null인 핀·수동 저장은 무시).
 *  - **P4 (AC-7)** 게스트는 `GET /saved-stays`·`POST` 0건이고, 누름은 `router.push('/(auth)/login')`로 간다.
 *  - **P5 (AC-8)** 응답 대기 중 재누름해도 `POST`는 1건뿐(연타 중복 요청 없음).
 *
 * 인프라: `StaySearchPage.emptyCta.integration.test.tsx`의 expo-router 목 + `savedPlaces.integration.test.tsx`의
 * observedHits/POST 본문 관찰을 복제(공용화 안 함 — 리포 관례). 인증은 `@/shared/api/tokenManager`의
 * set/clear로 구동(`getAccessToken() !== null`을 렌더 시점 읽는 PlaceExplorePage seam).
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

// 호이스팅 예외를 받으려면 이름이 mock으로 시작해야 한다(기존 통합테스트 관례).
let mockSearchParams: { region?: string } = {};
const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ ...mockSearchParams }),
  router: {
    push: (...args: unknown[]) => mockPush(...args),
    replace: jest.fn(),
    back: jest.fn(),
    setParams: jest.fn(),
  },
}));

const BASE = 'http://localhost:8080/api/v1';

/** 검색결과 카드 2건(A·B). */
const ITEM_A: StayItem = {
  externalSource: 'NAVER',
  externalId: 's1',
  name: '해운대 그랜드 호텔',
  lat: 35.1587,
  lng: 129.1604,
  region: '해운대',
  amenities: ['ocean'],
  stayType: 'HOTEL',
  price: { amount: 30000, currency: 'KRW' },
};
const ITEM_B: StayItem = {
  externalSource: 'NAVER',
  externalId: 's2',
  name: '서면 시티 호텔',
  lat: 35.1577,
  lng: 129.0594,
  region: '서면',
  amenities: ['wifi'],
  stayType: 'HOTEL',
  price: { amount: 10000, currency: 'KRW' },
};
const KEY_A = `${ITEM_A.externalSource}:${ITEM_A.externalId}`;
const KEY_B = `${ITEM_B.externalSource}:${ITEM_B.externalId}`;

const SEARCH_RESPONSE = {
  items: [ITEM_A, ITEM_B],
  degraded: false,
  filterZeroReasons: [],
};

const SAVED_ID_A = 'aaaaaaaa-1111-1111-1111-111111111111';
const NEW_SAVED_ID = '99999999-9999-9999-9999-999999999999';

/** buildSaveStayRequest(ITEM_A)가 내야 할 본문 — 정본 결정(MAP_SEARCH·좌표 보유 시 coordConfirmed:true,
 * TRIP-600 INV-U1-08 재정의)을 이 배선 층에서 리터럴로 한 번 더 못 박는다(순수 함수 단위 테스트 U9와 별개로 실배선 확인). */
const EXPECTED_POST_A = {
  name: '해운대 그랜드 호텔',
  registerRoute: 'MAP_SEARCH',
  coordConfirmed: true,
  externalSource: 'NAVER',
  externalId: 's1',
  lat: 35.1587,
  lng: 129.1604,
};

/** openapi SavedStay.required + 외부키를 채운 서버 담기 기록. */
function savedFrom(item: StayItem, savedStayId: string): SavedStay {
  return {
    savedStayId,
    name: item.name,
    coordConfirmed: false,
    registerRoute: 'MAP_SEARCH',
    externalSource: item.externalSource,
    externalId: item.externalId,
    lat: item.lat,
    lng: item.lng,
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
  };
}

function createGate() {
  let release!: () => void;
  const opened = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { opened, release };
}

let observedHits: string[] = [];
let postedBodies: unknown[] = [];

function hitCount(needle: string): number {
  return observedHits.filter((hit) => hit === needle).length;
}

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  server.events.on('request:start', ({ request }) => {
    observedHits.push(`${request.method} ${new URL(request.url).pathname}`);
  });
});

beforeEach(() => {
  observedHits = [];
  postedBodies = [];
  mockSearchParams = { region: '부산' };
  mockPush.mockClear();
  clearAccessToken();
  // GET /saved-stays는 항상 등록해 둔다 — 게스트에서 잘못 나가면 throw가 아니라 hitCount로
  // 잡히게(P4의 "0건"이 깨끗한 red가 되도록).
  server.use(
    http.get(`${BASE}/stays/search`, () => HttpResponse.json(SEARCH_RESPONSE)),
    http.get(`${BASE}/saved-stays`, () => HttpResponse.json([]))
  );
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
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

describe('P1 · 담기 — POST 본문·낙관·무효화 (AC-1)', () => {
  it('미담김 하트 press → buildSaveStayRequest 본문으로 POST + 낙관적 찬 하트 + 성공 후 재조회', async () => {
    // 준비 — 로그인 + 담은 목록 비어 있음. POST 응답은 문 뒤에 세운다.
    setAccessToken('valid-access');
    const gate = createGate();
    server.use(
      http.post(`${BASE}/saved-stays`, async ({ request }) => {
        postedBodies.push(await request.json());
        await gate.opened;
        return HttpResponse.json(savedFrom(ITEM_A, NEW_SAVED_ID), {
          status: 201,
        });
      })
    );
    render(<StaySearchPage />, { wrapper: createWrapper() });
    // 카드 A의 빈 하트가 뜰 때까지 기다린다(GET 두 건 도착).
    await waitFor(() =>
      expect(
        screen.getByTestId(`stay-card-save-${KEY_A}-outline`)
      ).toBeOnTheScreen()
    );

    // 실행 — 하트 A press.
    fireEvent.press(screen.getByTestId(`stay-card-save-${KEY_A}`));

    // 단언 ① — POST가 정확한 본문으로 나갔다(MAP_SEARCH·좌표 보유 시 coordConfirmed:true 실배선, TRIP-600).
    await waitFor(() => expect(postedBodies).toHaveLength(1));
    expect(postedBodies[0]).toEqual(EXPECTED_POST_A);

    // 단언 ② — 응답 전(문 닫힘)에 이미 찬 하트다(낙관).
    await waitFor(() =>
      expect(
        screen.getByTestId(`stay-card-save-${KEY_A}-filled`)
      ).toBeOnTheScreen()
    );
    expect(screen.getByTestId(`stay-card-save-${KEY_A}`)).toBeSelected();

    // 실행 ② — 문 열기 → 성공 → 담은 목록 무효화.
    gate.release();
    await waitFor(() => expect(hitCount('GET /api/v1/saved-stays')).toBe(2));
  });
});

describe('P2 · 해제 — savedStayId로 DELETE (AC-2)', () => {
  it('담김 하트 press → 매칭 savedStayId로 DELETE (externalId·key 경로 아님) + 낙관 빈 하트', async () => {
    // 준비 — 로그인 + A가 이미 담김. DELETE 응답을 문 뒤에 세운다(P1·P5의 POST 게이트와 동형).
    // 게이트가 필요한 이유: 해제 성공은 담은 목록을 무효화(refetch)하는데, 이 GET 목은 상태를
    // 지니지 않아 재조회에 다시 [A 담김]을 돌려준다 → 낙관 빈 하트가 즉시 찬 하트로 되돌아간다.
    // 그래서 응답 전(문 닫힘) transient 시점에 빈 하트를 결정론적으로 관찰한다.
    setAccessToken('valid-access');
    const gate = createGate();
    server.use(
      http.get(`${BASE}/saved-stays`, () =>
        HttpResponse.json([savedFrom(ITEM_A, SAVED_ID_A)])
      ),
      http.delete(`${BASE}/saved-stays/:savedStayId`, async () => {
        await gate.opened;
        return new HttpResponse(null, { status: 204 });
      })
    );
    render(<StaySearchPage />, { wrapper: createWrapper() });
    // 초기 채움(AC-3 겸) — A가 찬 하트로 뜬다.
    await waitFor(() =>
      expect(
        screen.getByTestId(`stay-card-save-${KEY_A}-filled`)
      ).toBeOnTheScreen()
    );

    // 실행 — 하트 A press.
    fireEvent.press(screen.getByTestId(`stay-card-save-${KEY_A}`));

    // 단언 ① — 담기 기록 id로 나갔다(요청은 문 뒤 대기 중이지만 request:start로 관찰된다).
    await waitFor(() =>
      expect(hitCount(`DELETE /api/v1/saved-stays/${SAVED_ID_A}`)).toBe(1)
    );
    // 단언 ② (부정 짝) — externalId·key를 그대로 경로에 넣지 않았다.
    expect(hitCount(`DELETE /api/v1/saved-stays/${ITEM_A.externalId}`)).toBe(0);
    expect(hitCount(`DELETE /api/v1/saved-stays/${KEY_A}`)).toBe(0);
    // 단언 ③ — 응답 전(문 닫힘)에 이미 낙관적으로 빈 하트다. 무효화가 아직 안 돌아 되돌림이 없다.
    await waitFor(() =>
      expect(
        screen.getByTestId(`stay-card-save-${KEY_A}-outline`)
      ).toBeOnTheScreen()
    );

    // 정리 — 문 열기 → 해제 성공 → 담은 목록 무효화(재요청)로 대기 중 요청을 매듭짓는다.
    gate.release();
    await waitFor(() => expect(hitCount('GET /api/v1/saved-stays')).toBe(2));
  });
});

describe('P3 · 초기 채움 매칭키 (AC-3)', () => {
  it('externalSource+externalId로 매칭해 A만 찬 하트이고, 외부키 null 저장은 무시된다', async () => {
    // 준비 — A는 담김, 그리고 핀·수동 등록(외부키 null)도 하나 있음.
    setAccessToken('valid-access');
    const pinSaved: SavedStay = {
      savedStayId: 'pin-1',
      name: '직접 등록한 숙소',
      coordConfirmed: true,
      registerRoute: 'PIN',
      externalSource: null,
      externalId: null,
      lat: 35.1,
      lng: 129.0,
      createdAt: '2026-08-01T00:00:00Z',
      updatedAt: '2026-08-01T00:00:00Z',
    };
    server.use(
      http.get(`${BASE}/saved-stays`, () =>
        HttpResponse.json([savedFrom(ITEM_A, SAVED_ID_A), pinSaved])
      )
    );
    render(<StaySearchPage />, { wrapper: createWrapper() });

    // 단언 — A는 찬 하트+selected, B는 빈 하트+not selected(핀 저장은 어느 카드와도 매칭 안 됨).
    await waitFor(() =>
      expect(
        screen.getByTestId(`stay-card-save-${KEY_A}-filled`)
      ).toBeOnTheScreen()
    );
    expect(screen.getByTestId(`stay-card-save-${KEY_A}`)).toBeSelected();
    expect(
      screen.getByTestId(`stay-card-save-${KEY_B}-outline`)
    ).toBeOnTheScreen();
    expect(screen.getByTestId(`stay-card-save-${KEY_B}`)).not.toBeSelected();
  });
});

describe('P4 · 미인증 — 요청 미전송 + 로그인 이동 (AC-7)', () => {
  it('게스트는 GET/POST 0건이고, 하트 press는 /(auth)/login으로 push한다', async () => {
    // 준비 — 토큰 없음(게스트).
    clearAccessToken();
    render(<StaySearchPage />, { wrapper: createWrapper() });
    // 카드가 뜰 때까지(검색 GET는 인증과 무관) — 빈 하트.
    await waitFor(() =>
      expect(
        screen.getByTestId(`stay-card-save-${KEY_A}-outline`)
      ).toBeOnTheScreen()
    );

    // 단언 ① — 담은 목록 조회는 아예 안 나간다(enabled:isAuthed).
    expect(hitCount('GET /api/v1/saved-stays')).toBe(0);

    // 실행 — 하트 press.
    fireEvent.press(screen.getByTestId(`stay-card-save-${KEY_A}`));

    // 단언 ② — 로그인 유도로 간다(죽은 버튼이 아니다).
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/(auth)/login'));
    // 단언 ③ — 담기 요청은 나가지 않았고, 하트는 여전히 빈 상태다.
    expect(hitCount('POST /api/v1/saved-stays')).toBe(0);
    expect(
      screen.getByTestId(`stay-card-save-${KEY_A}-outline`)
    ).toBeOnTheScreen();
  });
});

describe('P5 · 연타 가드 (AC-8)', () => {
  it('응답 대기 중 하트를 다시 눌러도 POST는 1건뿐이다', async () => {
    // 준비 — 로그인 + POST를 문 뒤에 세운다.
    setAccessToken('valid-access');
    const gate = createGate();
    server.use(
      http.post(`${BASE}/saved-stays`, async () => {
        await gate.opened;
        return HttpResponse.json(savedFrom(ITEM_A, NEW_SAVED_ID), {
          status: 201,
        });
      })
    );
    render(<StaySearchPage />, { wrapper: createWrapper() });
    await waitFor(() =>
      expect(
        screen.getByTestId(`stay-card-save-${KEY_A}-outline`)
      ).toBeOnTheScreen()
    );

    // 실행 ① — 첫 press로 요청이 나가고 하트가 대기(disabled) 상태가 된다.
    fireEvent.press(screen.getByTestId(`stay-card-save-${KEY_A}`));
    await waitFor(() =>
      expect(screen.getByTestId(`stay-card-save-${KEY_A}`)).toBeDisabled()
    );

    // 실행 ② — 대기 중 다시 press(비활성이라 무동작).
    fireEvent.press(screen.getByTestId(`stay-card-save-${KEY_A}`));

    // 실행 ③ — 문 열어 완료시킨다.
    gate.release();
    await waitFor(() =>
      expect(screen.getByTestId(`stay-card-save-${KEY_A}`)).not.toBeDisabled()
    );

    // 단언 — 연타에도 POST는 딱 한 번만 나갔다.
    expect(hitCount('POST /api/v1/saved-stays')).toBe(1);
  });
});
