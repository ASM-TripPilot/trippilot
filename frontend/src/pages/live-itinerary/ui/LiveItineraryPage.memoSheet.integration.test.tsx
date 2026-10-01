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
import type { ReactTestInstance } from 'react-test-renderer';

import { server } from '@/mocks/server';
import type { Itinerary, VisitCheck } from '@/shared/api/generated/schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';

import { LiveItineraryPage } from './LiveItineraryPage';

/**
 * TRIP-1117 · i01 허브 [메모] → 허브 위 메모 시트에서 저장 — 실 페이지 + 실제 HTTP(MSW).
 * TRIP-1070 결정 1(c)("[메모]는 j01 그날로 간다")를 뒤집는다.
 *
 * 무엇을 보장하나:
 *  - AC-1·11·12  [메모] → 이동 없이 허브 위 시트(제목 `{장소} · 메모`, 글자 수 `n/2000`).
 *  - AC-2·3·9·8  blur → `PUT …/visits/{관람 중 방문}/memo` 1회(trim), 공백만이면 0회. 성공하면 시트가 닫히고
 *                 관람 중 카드에 메모 박스가 선다(결정 2).
 *  - AC-4 · Q3   실패는 조용히 넘기지 않는다(INV-4) — 시트가 열려 있으면 시트 안, 닫힌 뒤 도착하면 카드 아래 한 줄.
 *  - AC-10       다시 열면 저장본이 입력칸에 심긴다. 같은 값이면 PUT 0회.
 *  - AC-13·14·15 ✕·스크림·끌어 닫기 = 닫힘(초안 버림, Q2). 시트가 열린 동안 수정 FAB 는 숨는다.
 *  - AC-6        입력칸은 허브 셸 시트가 아닌 **별도** 바텀시트 안에 있다.
 *  - AC-16       관람 중 방문이 바뀌면 시트가 사라진다(옛 방문에 쓰지 않는다).
 *  - AC-17 · Q4  사진 목록 GET 0회 유지. 메모 세션 캐시는 j01 과 같은 키 한 벌.
 *
 * 왜 이렇게 테스트하나:
 *  - 훅을 목으로 바꾸지 않는다 — 실제 요청 경로·본문을 MSW 로 본다(훅 목 금지 원칙).
 *  - PUT 응답을 `memoGate` 약속으로 붙잡아 "저장 중에 시트를 닫는" 창(Q3)을 타이머 없이 연다(02a ★3).
 *
 * (개념) `fireEvent(input, 'blur')` = 입력칸에서 포커스가 빠진 것처럼 흉내(키보드 "완료"와 같다) ·
 *   `holdMemo()` = 다음 PUT 응답을 `releaseMemo()` 전까지 붙잡는다 · `settle()` = 비동기 일이 끝나도록 잠깐 기다리기.
 * 3동작: 준비(일정·관람 중 방문·PUT 응답 모양) → 실행(누르기·입력·blur) → 단언(요청·시트·카드·문구).
 */

jest.mock('@/shared/storage', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest
    .fn()
    .mockResolvedValue({ accessToken: 'a', refreshToken: 'r' }),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  hasStoredToken: jest.fn().mockResolvedValue(true),
}));

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: {
    push: (...args: unknown[]) => mockPush(...args),
    replace: jest.fn(),
    back: jest.fn(),
    canGoBack: jest.fn(() => false),
    setParams: jest.fn(),
  },
}));

// 페이지가 [사진] 경로로 앨범 모듈(네이티브)을 import 한다 — 이 파일은 [사진]을 누르지 않는다.
jest.mock('@/shared/photo', () => ({
  pickPhotoAsset: jest.fn(),
  resolvePhotoUri: jest.fn(),
}));

const BASE = 'http://localhost:8080/api/v1';
const TRIP_ID = 'trip-1';
const TODAY = '2026-08-20';
const MEMO_PUT = `PUT /api/v1/trips/${TRIP_ID}/visits/v1/memo`;
const PHOTOS_GET = `GET /api/v1/trips/${TRIP_ID}/visits/v1/photos`;
const COPY_MEMO_FAILED = '메모를 저장하지 못했어요. 다시 시도해 주세요.';

const SHEET = 'live-memo-sheet';
const INPUT = 'record-trip-memo-input';
const CARD_MEMO = `execution-live-slot-memo-${TODAY}#p1`;
const CARD_NOTICE = 'execution-arrive-memo-notice';
const FAB = 'execution-live-replan-fab';

const slot = (poiId: string, nameKo: string, startAt: string) => ({
  poiId,
  startAt,
  endAt: startAt,
  isFixed: false,
  endsNextDay: false,
  hasViolation: false,
  nameKo,
  distanceRange: null,
  openingHours: null,
  tags: [],
});

const itinerary = (): Itinerary =>
  ({
    itineraryId: 'it1',
    tripId: TRIP_ID,
    status: 'PLANNED',
    solveMode: 'FULL',
    generationMode: 'AI',
    isFallback: false,
    generationState: 'COMPLETE',
    days: [
      {
        date: TODAY,
        slots: [
          slot('p1', '감천문화마을', '13:00:00'),
          slot('p2', '광안리 해변', '15:00:00'),
        ],
      },
    ],
  }) as unknown as Itinerary;

const trip = () => ({
  tripId: TRIP_ID,
  title: '부산 여행',
  startDate: TODAY,
  endDate: '2026-08-22',
  party: 2,
  destinations: [{ seq: 1, region: '부산', nights: 2 }],
  status: 'PLANNED',
  createdAt: '2026-08-01T00:00:00Z',
  updatedAt: '2026-08-01T00:00:00Z',
});

const visit = (
  visitCheckId: string,
  poiId: string,
  completedAt: string | null
): VisitCheck => ({
  visitCheckId,
  poiId,
  slotKey: `${TODAY}#${poiId}`,
  arrivedAt: '2026-08-20T13:00:00',
  completedAt,
  skippedAt: null,
  source: 'MANUAL',
  spontaneous: false,
  updatedAt: '2026-08-20T13:00:05Z',
});

let observedHits: string[] = [];
const hitCount = (needle: string) =>
  observedHits.filter((hit) => hit === needle).length;
const memoHits = () => observedHits.filter((hit) => hit.endsWith('/memo'));
let memoBodies: unknown[] = [];
let memoStatus = 200;
let memoGate: Promise<void> = Promise.resolve();
let releaseMemo: () => void = () => {};
let visitsResponse: () => VisitCheck[];

/** 다음 PUT 응답을 releaseMemo() 전까지 붙잡는다 — 응답 상태는 풀 때의 memoStatus 로 정해진다. */
function holdMemo() {
  memoGate = new Promise<void>((resolve) => {
    releaseMemo = resolve;
  });
}

let client: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** 비동기 일이 끝나도록 잠깐 기다린다 — "요청 0회" 단언이 공허해지지 않게. */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

async function release() {
  await act(async () => {
    releaseMemo();
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  server.events.on('request:start', ({ request }) => {
    observedHits.push(`${request.method} ${new URL(request.url).pathname}`);
  });
});
beforeEach(() => {
  observedHits = [];
  memoBodies = [];
  memoStatus = 200;
  memoGate = Promise.resolve();
  releaseMemo = () => {};
  visitsResponse = () => [visit('v1', 'p1', null)];
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  mockPush.mockReset();
  setAccessToken('a');
  server.use(
    http.get(`${BASE}/trips/:tripId`, () => HttpResponse.json(trip())),
    http.get(`${BASE}/trips/:tripId/itinerary`, () =>
      HttpResponse.json(itinerary())
    ),
    http.get(`${BASE}/trips/:tripId/visits/days/:day`, () =>
      HttpResponse.json({ visits: visitsResponse() })
    ),
    http.get(`${BASE}/trips/:tripId/visits/:visitCheckId/photos`, () =>
      HttpResponse.json({ items: [], count: 0 })
    ),
    http.put(
      `${BASE}/trips/:tripId/visits/:visitCheckId/memo`,
      async ({ request }) => {
        const body = (await request.json()) as { text: string };
        memoBodies.push(body);
        await memoGate;
        if (memoStatus !== 200) {
          return HttpResponse.json(
            { error: { code: 'INTERNAL', message: 'boom' } },
            { status: memoStatus }
          );
        }
        return HttpResponse.json({
          text: body.text,
          updatedAt: '2026-08-20T13:10:00Z',
        });
      }
    )
  );
});
afterEach(() => {
  server.resetHandlers();
  clearAccessToken();
  client.clear();
});
afterAll(() => server.close());

async function renderHub() {
  render(<LiveItineraryPage tripId={TRIP_ID} today={TODAY} />, { wrapper });
  return screen.findByTestId('execution-arrive-memo');
}

/** [메모]를 눌러 시트를 연다 — 입력칸을 돌려준다. */
async function openSheet() {
  fireEvent.press(await screen.findByTestId('execution-arrive-memo'));
  return screen.findByTestId(INPUT);
}

/** 입력하고 포커스를 뺀다(= 키보드 "완료"). */
function typeAndBlur(input: ReactTestInstance, text: string) {
  fireEvent.changeText(input, text);
  fireEvent(input, 'blur');
}

/** 가장 가까운 바텀시트 host — 통과형 목은 `index` 등 시트 prop 을 host View 에 펼친다(BottomSheetView 는 index 가 없다). */
function nearestSheetHost(node: ReactTestInstance): ReactTestInstance | null {
  let current: ReactTestInstance | null = node;
  while (current !== null && typeof current.props.index !== 'number') {
    current = current.parent;
  }
  return current;
}

describe('🔴 AC-1 · [메모]는 허브를 떠나지 않고 메모 시트를 연다 (결정 1(c) 번복)', () => {
  it('M1 [메모]를 누르면 live-memo-sheet 가 열리고, 이동·저장 요청은 0회다', async () => {
    const memo = await renderHub();
    // 앵커 — 누르기 전엔 시트가 없다.
    expect(screen.queryByTestId(SHEET)).toBeNull();

    fireEvent.press(memo);
    await settle();

    expect(screen.getByTestId(SHEET)).toBeOnTheScreen();
    expect(screen.getByTestId(INPUT)).toBeOnTheScreen();
    expect(mockPush).not.toHaveBeenCalled();
    expect(memoHits()).toEqual([]);
  });
});

describe('🔴 AC-11·AC-12 · 제목과 글자 수', () => {
  it('M2 제목은 "감천문화마을 · 메모", 글자 수는 0/2000 에서 입력하면 바로 7/2000 이 된다', async () => {
    await renderHub();
    const input = await openSheet();

    expect(screen.getByTestId('live-memo-title')).toHaveTextContent(
      '감천문화마을 · 메모'
    );
    expect(screen.getByTestId('live-memo-count')).toHaveTextContent('0/2000');

    fireEvent.changeText(input, '광안리 좋았다');

    expect(screen.getByTestId('live-memo-count')).toHaveTextContent('7/2000');
  });
});

describe('🔴 AC-2·AC-9·AC-8 · blur 저장 → 시트 닫힘 → 카드에 메모 박스', () => {
  it('M3 앞뒤 공백을 걷은 본문으로 PUT …/visits/v1/memo 1회, 성공하면 시트가 닫히고 관람 중 카드에 본문이 보인다', async () => {
    await renderHub();
    const input = await openSheet();

    typeAndBlur(input, '  바다가 예뻤다  ');

    await waitFor(() => expect(hitCount(MEMO_PUT)).toBe(1));
    expect(memoBodies).toEqual([{ text: '바다가 예뻤다' }]);
    await waitFor(() =>
      expect(screen.queryByTestId(SHEET)).not.toBeOnTheScreen()
    );
    expect(screen.getByTestId(CARD_MEMO)).toHaveTextContent('바다가 예뻤다');
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('M4 저장 전엔 관람 중 카드에 메모 박스가 없다', async () => {
    await renderHub();
    await settle();

    // 앵커 — 관람 중 카드는 있다.
    expect(
      screen.getByTestId(`execution-live-slot-${TODAY}#p1`)
    ).toBeOnTheScreen();
    expect(screen.queryByTestId(CARD_MEMO)).toBeNull();
  });
});

describe('🔴 AC-3 · 공백만이면 저장하지 않는다', () => {
  it('M5 공백만 입력하고 blur → PUT 0회, 시트는 그대로 열려 있다', async () => {
    await renderHub();
    const input = await openSheet();

    typeAndBlur(input, '   ');
    await settle();

    expect(memoHits()).toEqual([]);
    expect(screen.getByTestId(SHEET)).toBeOnTheScreen();
  });
});

describe('🔴 AC-9 (Q1) · 닫힘은 저장 성공 **뒤**다', () => {
  it('M6 PUT 응답을 기다리는 동안엔 시트가 열려 있고, 200 이 오면 닫힌다', async () => {
    holdMemo();
    await renderHub();
    const input = await openSheet();

    typeAndBlur(input, '기다리는 메모');
    await waitFor(() => expect(hitCount(MEMO_PUT)).toBe(1));
    await settle();

    // 단언 — 응답 전: 아직 열림.
    expect(screen.getByTestId(SHEET)).toBeOnTheScreen();

    await release();

    await waitFor(() =>
      expect(screen.queryByTestId(SHEET)).not.toBeOnTheScreen()
    );
  });
});

describe('🔴 AC-4 · 시트가 열린 채 실패하면 시트 안에 알린다 (INV-4)', () => {
  it('M7 PUT 500 → live-memo-notice 문구, 시트는 열린 채 입력값을 지키고 카드 아래 안내는 없다', async () => {
    memoStatus = 500;
    await renderHub();
    const input = await openSheet();

    typeAndBlur(input, '실패할 메모');

    expect(await screen.findByTestId('live-memo-notice')).toHaveTextContent(
      COPY_MEMO_FAILED
    );
    expect(screen.getByTestId(SHEET)).toBeOnTheScreen();
    expect(screen.getByTestId(INPUT).props.value).toBe('실패할 메모');
    expect(screen.queryByTestId(CARD_NOTICE)).toBeNull();
  });

  it('M8 실패 뒤 다시 blur 하면 안내가 지워지고, 이번에 성공하면 시트가 닫힌다 (PUT 총 2회)', async () => {
    memoStatus = 500;
    await renderHub();
    const input = await openSheet();
    typeAndBlur(input, '두 번째엔 된다');
    expect(await screen.findByTestId('live-memo-notice')).toHaveTextContent(
      COPY_MEMO_FAILED
    );

    // 실행 — 두 번째 시도는 응답을 붙잡은 채 보낸다.
    memoStatus = 200;
    holdMemo();
    fireEvent(screen.getByTestId(INPUT), 'blur');
    await waitFor(() => expect(hitCount(MEMO_PUT)).toBe(2));
    await settle();

    // 단언 — 새 시도가 시작되면 옛 안내는 사라진다.
    expect(screen.queryByTestId('live-memo-notice')).toBeNull();

    await release();

    await waitFor(() =>
      expect(screen.queryByTestId(SHEET)).not.toBeOnTheScreen()
    );
  });
});

describe('🔴 Q3 · 저장 중에 시트를 닫으면 결과는 관람 중 카드가 받는다', () => {
  it('M9 blur → PUT 보류 중 ✕ 로 닫고 → 500 이 오면 카드 아래에 안내 한 줄이 뜬다', async () => {
    holdMemo();
    await renderHub();
    const input = await openSheet();
    typeAndBlur(input, '닫고 나서 실패');
    await waitFor(() => expect(hitCount(MEMO_PUT)).toBe(1));

    fireEvent.press(screen.getByTestId('live-memo-close'));
    expect(screen.queryByTestId(SHEET)).toBeNull();

    memoStatus = 500;
    await release();

    expect(await screen.findByTestId(CARD_NOTICE)).toHaveTextContent(
      COPY_MEMO_FAILED
    );
    expect(screen.queryByTestId('live-memo-notice')).toBeNull();
  });

  it('M10 같은 창에서 200 이 오면 카드에 메모 박스가 서고 안내는 없다', async () => {
    holdMemo();
    await renderHub();
    const input = await openSheet();
    typeAndBlur(input, '닫고 나서 성공');
    await waitFor(() => expect(hitCount(MEMO_PUT)).toBe(1));

    fireEvent.press(screen.getByTestId('live-memo-close'));
    await release();

    expect(await screen.findByTestId(CARD_MEMO)).toHaveTextContent(
      '닫고 나서 성공'
    );
    expect(screen.queryByTestId(CARD_NOTICE)).toBeNull();
  });

  it('M11 카드 아래 안내는 다음 [메모] 누름에 지워지고, 새로 연 시트에도 안내가 없다', async () => {
    holdMemo();
    await renderHub();
    const input = await openSheet();
    typeAndBlur(input, '닫고 나서 실패');
    await waitFor(() => expect(hitCount(MEMO_PUT)).toBe(1));
    fireEvent.press(screen.getByTestId('live-memo-close'));
    memoStatus = 500;
    await release();
    expect(await screen.findByTestId(CARD_NOTICE)).toBeOnTheScreen();

    fireEvent.press(screen.getByTestId('execution-arrive-memo'));

    expect(screen.getByTestId(SHEET)).toBeOnTheScreen();
    expect(screen.queryByTestId(CARD_NOTICE)).toBeNull();
    expect(screen.queryByTestId('live-memo-notice')).toBeNull();
  });
});

describe('🔴 AC-10 · 다시 열면 저장본이 심긴다', () => {
  it('M12 저장 뒤 [메모]를 다시 누르면 입력값·글자 수가 저장본이고, 같은 값으로 blur 해도 PUT 은 총 1회다', async () => {
    await renderHub();
    typeAndBlur(await openSheet(), '다시 볼 메모');
    await waitFor(() =>
      expect(screen.queryByTestId(SHEET)).not.toBeOnTheScreen()
    );

    const again = await openSheet();

    expect(again.props.value).toBe('다시 볼 메모');
    expect(screen.getByTestId('live-memo-count')).toHaveTextContent('7/2000');

    fireEvent(again, 'blur');
    await settle();

    expect(hitCount(MEMO_PUT)).toBe(1);
  });
});

describe('🔴 AC-13·AC-14 · ✕·스크림·끌어 닫기 = 저장 없이 닫힘 (Q2 초안 버림)', () => {
  it('M13 입력 뒤 ✕ → 시트가 사라지고 이동·저장 0회, 다시 열면 입력칸이 비어 있다', async () => {
    await renderHub();
    const input = await openSheet();
    fireEvent.changeText(input, '버릴 초안');

    const close = screen.getByTestId('live-memo-close');
    expect(close).toHaveAccessibleName('닫기');
    fireEvent.press(close);
    await settle();

    expect(screen.queryByTestId(SHEET)).toBeNull();
    expect(mockPush).not.toHaveBeenCalled();
    expect(memoHits()).toEqual([]);

    const reopened = await openSheet();
    expect(reopened.props.value).toBe('');
    expect(screen.getByTestId('live-memo-count')).toHaveTextContent('0/2000');
  });

  it('M14 스크림을 누르면 시트가 사라지고 이동·저장 0회다', async () => {
    await renderHub();
    fireEvent.changeText(await openSheet(), '스크림으로 닫기');

    fireEvent.press(screen.getByTestId('live-memo-scrim'));
    await settle();

    expect(screen.queryByTestId(SHEET)).toBeNull();
    expect(mockPush).not.toHaveBeenCalled();
    expect(memoHits()).toEqual([]);
  });

  it('M15 시트를 아래로 끌어 닫으면(시트의 close) 시트가 사라진다', async () => {
    await renderHub();
    const host = nearestSheetHost(await openSheet());
    expect(host).not.toBeNull();

    fireEvent(host as ReactTestInstance, 'close');

    expect(screen.queryByTestId(SHEET)).toBeNull();
  });
});

describe('🔴 AC-15 · 시트가 열린 동안 수정 FAB 는 숨는다', () => {
  it('M16 열기 전 FAB 있음 → 열면 없음 → ✕ 로 닫으면 다시 있음', async () => {
    await renderHub();
    expect(screen.getByTestId(FAB)).toBeOnTheScreen();

    await openSheet();
    expect(screen.queryByTestId(FAB)).toBeNull();

    fireEvent.press(screen.getByTestId('live-memo-close'));
    expect(screen.getByTestId(FAB)).toBeOnTheScreen();
  });
});

describe('🔴 AC-6 · 입력칸은 허브 셸 시트가 아닌 별도 바텀시트 안에 있다', () => {
  it('M17 입력칸의 가장 가까운 시트는 닫힘(onClose)을 쥐고 메모 시트를 품으며, 허브 셸 헤더는 품지 않는다', async () => {
    await renderHub();

    // 판별자 자가검사(짝) — 허브 셸 시트는 onClose 가 없다. 이게 깨지면 아래 onClose 단언이 셸도 통과시킨다.
    const shellHost = nearestSheetHost(
      screen.getByTestId('execution-live-sheet-header')
    );
    expect(shellHost).not.toBeNull();
    expect(typeof shellHost?.props.onClose).not.toBe('function');

    const host = nearestSheetHost(await openSheet());

    expect(host).not.toBeNull();
    expect(typeof host?.props.onClose).toBe('function');
    expect(
      host?.findAll(
        (node) => node.props.testID === 'execution-live-sheet-header'
      )
    ).toEqual([]);
    expect(
      host?.findAll((node) => node.props.testID === SHEET).length
    ).toBeGreaterThan(0);
  });
});

describe('🔴 AC-16 · 관람 중 방문이 바뀌면 시트가 사라진다', () => {
  it('M18 시트가 열린 채 p1 완료·p2 도착으로 재조회되면 시트가 사라지고, 옛 방문에 저장하지 않는다', async () => {
    await renderHub();
    await openSheet();

    visitsResponse = () => [
      visit('v1', 'p1', '2026-08-20T14:00:00'),
      visit('v2', 'p2', null),
    ];
    await act(async () => {
      await client.invalidateQueries();
    });

    // 앵커 — p2 가 관람 중 얼굴로 바뀌었다. time 노드는 예정 얼굴에도 있어 존재만으론
    // 재조회 전에 통과한다 — 관람 중 얼굴의 문구(완전 일치)로 기다린다.
    await waitFor(() =>
      expect(
        screen.getByTestId(`execution-live-slot-time-${TODAY}#p2`)
      ).toHaveTextContent('15:00 도착 · 지금 관람 중')
    );
    expect(screen.queryByTestId(SHEET)).toBeNull();
    expect(screen.getByTestId('execution-arrive-memo')).toBeOnTheScreen();
    await settle();
    expect(memoHits()).toEqual([]);
  });
});

describe('🔴 AC-17 · 허브는 메모를 저장해도 사진 목록을 조회하지 않는다 (F6)', () => {
  it('M19 시트를 열고 저장까지 해도 GET …/visits/v1/photos 는 0회다', async () => {
    await renderHub();
    typeAndBlur(await openSheet(), '사진은 안 부른다');
    await waitFor(() => expect(hitCount(MEMO_PUT)).toBe(1));
    await settle();

    expect(hitCount(PHOTOS_GET)).toBe(0);
  });
});

describe('🔴 Q4 · 메모 세션 캐시는 j01 과 같은 키 한 벌이다', () => {
  it('M20a j01 이 같은 세션에 저장한 메모(세션 캐시)가 있으면 허브 카드 박스와 시트 입력칸이 그 값이다', async () => {
    // 준비 — j01(useVisitAttachments)이 PUT 성공 뒤 적는 자리. 관찰자 없는 값이 gcTime 0 에 지워지지 않게 한다(02a ★8).
    client.setQueryDefaults(['visit-memo'], { gcTime: Infinity });
    client.setQueryData(['visit-memo', TRIP_ID, 'v1'], 'j01에서 쓴 메모');

    await renderHub();

    expect(await screen.findByTestId(CARD_MEMO)).toHaveTextContent(
      'j01에서 쓴 메모'
    );
    const input = await openSheet();
    expect(input.props.value).toBe('j01에서 쓴 메모');
  });

  it('M20b 허브에서 저장하면 j01 이 읽는 같은 키에 저장본이 남는다', async () => {
    await renderHub();
    typeAndBlur(await openSheet(), '  허브에서 쓴 메모 ');
    await waitFor(() =>
      expect(screen.queryByTestId(SHEET)).not.toBeOnTheScreen()
    );

    expect(client.getQueryData(['visit-memo', TRIP_ID, 'v1'])).toBe(
      '허브에서 쓴 메모'
    );
  });
});

describe('AC-5 · 관람 중 방문이 없으면 [메모]도 시트도 없다 (무회귀)', () => {
  it('M21 방문 기록이 비면 [메모] 버튼이 없다', async () => {
    visitsResponse = () => [];
    render(<LiveItineraryPage tripId={TRIP_ID} today={TODAY} />, { wrapper });

    // 앵커 — 카드는 그려졌다(예정 상태).
    expect(
      await screen.findByTestId(`execution-live-slot-${TODAY}#p1`)
    ).toBeOnTheScreen();
    await settle();
    expect(screen.queryByTestId('execution-arrive-memo')).toBeNull();
    expect(screen.queryByTestId(SHEET)).toBeNull();
  });
});
