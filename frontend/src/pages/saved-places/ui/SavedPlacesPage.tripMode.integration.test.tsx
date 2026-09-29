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
} from '@testing-library/react-native';

import { server } from '@/mocks/server';
import type {
  MustVisit,
  Place,
  SavedPlace,
  Trip,
} from '@/shared/api/generated/schemas';
import { useGetTripsTripIdMustVisits } from '@/shared/api/generated/trips/trips';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';
import { wizardOriginParams } from '@/features/explore/model/wizardOrigin';
import { useTripWizardStore } from '@/features/trip/model/tripWizardStore';
import { tripRecordsTrip } from '@/test-support/tripRecordsTrip';
import { wizardDraftData } from '@/test-support/wizardDraftFixture';

import { SavedPlacesPage } from './SavedPlacesPage';

/**
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
// push·back 은 화살표로 감싸 **호출 시점에** 목을 찾는다(호이스트 함정 회피). 구현이 `router` 객체를
// 쓰든 `useRouter()` 를 쓰든 같은 목에 모인다.
const mockPush = jest.fn();
const mockBack = jest.fn();
const mockSearchParams: Record<string, string | string[] | undefined> = {};

jest.mock('expo-router', () => ({
  router: {
    push: (href: unknown) => mockPush(href),
    back: () => mockBack(),
  },
  useRouter: () => ({
    push: (href: unknown) => mockPush(href),
    back: () => mockBack(),
  }),
  useLocalSearchParams: () => ({ ...mockSearchParams }),
}));

const BASE = 'http://localhost:8080/api/v1';
const TRIP_ID = '22222222-2222-2222-2222-222222222222';
const TRIP_PATH = `/api/v1/trips/${TRIP_ID}`;
const MUST_VISITS_PATH = `/api/v1/trips/${TRIP_ID}/must-visits`;
const SAVED_PATH = '/api/v1/saved-places';

/** 여행 T — 목적지 부산광역시(코드 26). */
const BUSAN_TRIP: Trip = {
  ...tripRecordsTrip('부산 여행', TRIP_ID),
  destinations: [{ seq: 1, region: '부산광역시', nights: 2, regionCode: '26' }],
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

/** 나간 요청 `METHOD /경로` — 도착 순서대로. */
let observedHits: string[] = [];
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
  return observedHits.filter((hit) => hit === `${method} ${pathname}`).length;
}

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  server.events.on('request:start', ({ request }) => {
    observedHits.push(`${request.method} ${new URL(request.url).pathname}`);
  });
});

// ★ 위저드 스토어는 모듈 싱글턴이다 — 준비·정리를 파일 최상위에 둬 앞 테스트 상태가 새지 않게 한다(02a ★3).
beforeEach(() => {
  observedHits = [];
  mustVisitStore = [mustVisit('bs3')];
  postStatus = {};
  postBodies = [];
  tripStatus = null;
  mustVisitsStatus = null;
  holdTrip = false;
  holdMustVisits = false;
  holdPost = false;
  releasers = [];
  mockPush.mockClear();
  mockBack.mockClear();
  Object.keys(mockSearchParams).forEach((key) => delete mockSearchParams[key]);

  // 위저드 드래프트 — 일부러 여행 T 와 **다른** 지역(서울 11)과 꼭 갈 곳(bs2)을 남겨 둔다(★ 본체).
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

afterEach(() => {
  releaseAll();
  server.resetHandlers();
  clearAccessToken();
  useTripWizardStore.getState().reset();
});

afterAll(() => server.close());

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
  mockSearchParams.mode = 'select';
  mockSearchParams.tripId = TRIP_ID;
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

function rowCount(): number {
  return screen.queryAllByTestId(/^mustvisit-pick-row-/).length;
}

/** 행과 "지역 밖" 머리글을 화면 순서(트리 깊이 우선)대로 — 문자열 배열이라 직렬화 함정 무관. */
function orderedPickIds(): string[] {
  return screen
    .queryAllByTestId(/^mustvisit-pick-(row-|region-outside$)/)
    .map((node) => String(node.props.testID));
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
    expect(screen.queryAllByTestId('mustvisit-pick-check-se1').length).toBe(0);
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
    server.use(http.get(`${BASE}/saved-places`, () => HttpResponse.json(rows)));
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
