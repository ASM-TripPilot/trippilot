/**
 * @jest-environment ./src/test-support/deviceTimeZoneEnvironment.cjs
 */
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

import { PlusGlyph } from '@/features/record/ui/RecordGlyphs';
import { server } from '@/mocks/server';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';
import { WHEEL_CELL_HEIGHT } from '@/shared/ui/WheelPicker';

import { TripRecordsPage } from './TripRecordsPage';

/**
 * TRIP-1069 · j01 방문 기록 정비 — **실 페이지 + 실제 HTTP(MSW)** 로 본 사용자 관측 결과.
 *
 * 무엇을 보장하나:
 *  - 시각은 서울 시계로 보인다(AC-1·AC-3). 카드는 도착 이른 순, 도착 없는 카드는 끝(AC-20).
 *  - 도착한 카드엔 '시각 수정' 버튼이 있고, 누르면 시트가 서울 시각·장소명으로 열린다(AC-4). 건너뛴
 *    카드·아직 서버에 없는 낙관 카드엔 없다(AC-5·D7).
 *  - 저장하면 PATCH 본문엔 바꾼 필드 + expectedUpdatedAt 뿐이고, 시각은 "원본 서울 날짜 + 고른 서울
 *    HH:mm" 의 UTC 순간이다(AC-6·AC-7). 충돌·실패는 화면에 알린다(AC-9, INV-4).
 *  - 도착만 한 카드에서도 메모가 실제로 저장되고, 눌러도 반응 없는 +·메모 글자는 어디에도 없다
 *    (AC-12·AC-13·AC-15). 건너뛴 카드는 라벨만 있다(AC-14). TRIP-1070 — 도착한 카드의 사진 추가 `+` 는
 *    배선된 버튼이라 폴백 집계에서 뺀다(도착 카드에만 있고 건너뛴 카드엔 없다).
 *  - 건너뛰기는 확인을 거친다 — 확정 전 요청 0회, 실패는 다이얼로그 안에 알린다(AC-16~18).
 *  - 시트·다이얼로그 어디에도 체류 시간이 없다(AC-25 · INV-3).
 *
 * 왜 이렇게 테스트하나:
 *  - 기기 시간대를 **LA 로 바꿔** 돈다. LA 기기에서 13:42Z 는 문자열 자르기=13:42, 기기 시계=06:42,
 *    서울=22:42 — 셋이 다 달라 어느 오구현도 통과하지 못한다(로컬 개발기는 KST 라 그냥 돌리면 통과).
 *  - 서버 상태를 `serverVisits` 한 곳에 둔다. PATCH·skip 핸들러가 그것을 고치고 GET 이 그것을 돌려줘서,
 *    무효화 뒤 재조회가 "서버값"을 읽는다(충돌 뒤 카드가 서버값인지 볼 수 있다).
 *  - 바텀시트 목은 children 을 무조건 그린다 → "시트가 열렸다" = 페이지가 조건부로 마운트했다. 그래서
 *    누르기 전엔 없다는 앵커를 둔다. 실제 열림·딤·다이얼로그 덮임은 6-b 실기(AC-11·AC-19).
 *
 * (개념) `within(카드).getByText('22:42')` = 그 카드 안에서만 완전 일치 Text 검색 ·
 *   `findBy*` = 나타날 때까지 기다렸다 조회 · `waitFor(fn)` = fn 이 통과할 때까지 반복 ·
 *   `server.events.on('request:start')` = 실제로 나간 요청을 "메서드 경로" 로 기록하는 관찰자.
 */

declare const __setDeviceTimeZone: (tz: string | undefined) => void;

const BASE = 'http://localhost:8080/api/v1';
const TRIP_ID = 't1';
const DAY = '2026-08-20';
const CONFLICT_COPY = '다른 기기에서 먼저 수정됐어요';
const FAILED_COPY = '방문 시각을 저장하지 못했어요';
const DURATION_TEXT = /(\d+\s*분|\d+\s*시간|소요|체류)/;

const mockGetForeground = jest.fn();
jest.mock('expo-location', () => ({
  getForegroundPermissionsAsync: (...args: unknown[]) =>
    mockGetForeground(...args),
}));

jest.mock('@/shared/storage', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest
    .fn()
    .mockResolvedValue({ accessToken: 'a', refreshToken: 'r' }),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  hasStoredToken: jest.fn().mockResolvedValue(true),
}));

jest.mock('expo-router', () => ({
  router: {
    canGoBack: jest.fn(() => false),
    back: jest.fn(),
    replace: jest.fn(),
  },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/shared/map', () => require('@/test-support/mapViewMock'));

const PLACES: Record<string, string> = {
  p1: '광안리 해변',
  p2: '부산시립미술관',
  p3: '웨이브온 커피',
  p4: '○○ 카페',
};

function itinerary() {
  return {
    itineraryId: 'it1',
    tripId: TRIP_ID,
    status: 'CONFIRMED',
    solveMode: 'FULL',
    generationMode: 'AI',
    isFallback: false,
    generationState: 'COMPLETE',
    days: [
      {
        date: DAY,
        slots: Object.entries(PLACES).map(([poiId, nameKo]) => ({
          poiId,
          nameKo,
          startAt: '10:00:00',
          endAt: '11:00:00',
          isFixed: false,
          endsNextDay: false,
          hasViolation: false,
          tags: [] as string[],
        })),
      },
    ],
  };
}

type Visit = {
  visitCheckId: string;
  slotKey: string;
  poiId: string;
  arrivedAt: string | null;
  completedAt: string | null;
  skippedAt: string | null;
  source: 'MANUAL';
  spontaneous: boolean;
  updatedAt: string;
};

function visit(
  visitCheckId: string,
  poiId: string,
  times: Partial<
    Pick<Visit, 'arrivedAt' | 'completedAt' | 'skippedAt' | 'updatedAt'>
  >
): Visit {
  return {
    visitCheckId,
    slotKey: `${DAY}#${poiId}`,
    poiId,
    arrivedAt: null,
    completedAt: null,
    skippedAt: null,
    source: 'MANUAL',
    spontaneous: false,
    updatedAt: '2026-08-20T07:00:00.000Z',
    ...times,
  };
}

/** 완료(부산시립미술관) — 서울 14:20 도착 · 15:20 완료. */
const V_DONE = () =>
  visit('v-done', 'p2', {
    arrivedAt: '2026-08-20T05:20:00Z',
    completedAt: '2026-08-20T06:20:00Z',
  });
/** 도착만(광안리) — 서울 14:20 도착. */
const V_IN = () => visit('v-in', 'p1', { arrivedAt: '2026-08-20T05:20:00Z' });
/** 도착 후 건너뜀(웨이브온). */
const V_SKIPPED = () =>
  visit('v-sk', 'p3', {
    arrivedAt: '2026-08-20T05:00:00Z',
    skippedAt: '2026-08-20T05:10:00Z',
  });

let serverVisits: Visit[] = [];
let observedHits: string[] = [];
let patchBodies: Record<string, unknown>[] = [];
let memoBodies: unknown[] = [];

const hits = (suffix: string) =>
  observedHits.filter((hit) => hit.endsWith(suffix)).length;
const SKIP_HIT = (id: string) => `/trips/${TRIP_ID}/visits/${id}/skip`;

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function renderPage() {
  render(<TripRecordsPage tripId={TRIP_ID} today={DAY} />, { wrapper });
}

const cardOf = (id: string) =>
  screen.getByTestId(`record-trip-visit-card-${id}`);
const cell = (field: 'arrived' | 'completed', unit: 'h' | 'm', v: string) =>
  `record-trip-visit-time-${field}-${unit}-${v}`;

/** 카드의 '시각 수정'을 눌러 시트가 뜰 때까지 기다린다. */
async function openSheet(id: string) {
  await screen.findByTestId(`record-trip-visit-card-${id}`);
  fireEvent.press(
    within(cardOf(id)).getByTestId(`record-trip-visit-time-edit-${id}`)
  );
  return screen.findByTestId('record-trip-visit-time-sheet');
}

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  server.events.on('request:start', ({ request }) => {
    observedHits.push(`${request.method} ${new URL(request.url).pathname}`);
  });
});
beforeEach(() => {
  __setDeviceTimeZone('America/Los_Angeles');
  setAccessToken('a');
  mockGetForeground.mockReset();
  mockGetForeground.mockResolvedValue({
    status: 'granted',
    granted: true,
    canAskAgain: true,
  });
  serverVisits = [];
  observedHits = [];
  patchBodies = [];
  memoBodies = [];
  server.use(
    http.get(`${BASE}/trips/:tripId/itinerary`, () =>
      HttpResponse.json(itinerary())
    ),
    http.get(`${BASE}/trips/:tripId/visits/days/:day`, () =>
      HttpResponse.json({ visits: serverVisits })
    ),
    http.get(`${BASE}/trips/:tripId/bases`, () => HttpResponse.json([])),
    http.get(`${BASE}/saved-stays`, () => HttpResponse.json([])),
    http.get(`${BASE}/trips/:tripId/visits/:visitCheckId/photos`, () =>
      HttpResponse.json({ items: [], count: 0 })
    ),
    http.put(
      `${BASE}/trips/:tripId/visits/:visitCheckId/memo`,
      async ({ request }) => {
        const body = (await request.json()) as { text: string };
        memoBodies.push(body);
        return HttpResponse.json({
          text: body.text,
          updatedAt: '2026-08-20T08:00:00.000Z',
        });
      }
    ),
    http.patch(
      `${BASE}/trips/:tripId/visits/:visitCheckId`,
      async ({ request, params }) => {
        const body = (await request.json()) as Record<string, unknown>;
        patchBodies.push(body);
        const { expectedUpdatedAt: _ignored, ...times } = body;
        serverVisits = serverVisits.map((v) =>
          v.visitCheckId === params.visitCheckId
            ? { ...v, ...times, updatedAt: '2026-08-20T09:00:00.000Z' }
            : v
        );
        return HttpResponse.json(
          serverVisits.find((v) => v.visitCheckId === params.visitCheckId)
        );
      }
    ),
    http.post(
      `${BASE}/trips/:tripId/visits/:visitCheckId/skip`,
      ({ params }) => {
        serverVisits = serverVisits.map((v) =>
          v.visitCheckId === params.visitCheckId
            ? { ...v, skippedAt: '2026-08-20T06:00:00Z' }
            : v
        );
        return HttpResponse.json(
          serverVisits.find((v) => v.visitCheckId === params.visitCheckId)
        );
      }
    )
  );
});
afterEach(() => {
  server.resetHandlers();
  clearAccessToken();
  __setDeviceTimeZone(undefined);
});
afterAll(() => server.close());

describe('앵커 — 기기 시간대가 LA 로 바뀌었다', () => {
  it('2026-08-20T13:42Z 가 기기 시계로는 6시로 읽힌다', () => {
    expect(new Date('2026-08-20T13:42:00Z').getHours()).toBe(6);
  });
});

describe('AC-1·AC-3 · 카드 시각은 서울 시계다', () => {
  it('13:42Z → 22:42, 소수 자리 붙은 13:44:05.123456Z → 22:44 (자른 값·기기 시계 값은 어디에도 없다)', async () => {
    serverVisits = [
      visit('v1', 'p1', {
        arrivedAt: '2026-08-20T13:42:00Z',
        completedAt: '2026-08-20T14:10:00Z',
      }),
      visit('v2', 'p2', { arrivedAt: '2026-08-20T13:44:05.123456Z' }),
    ];

    renderPage();
    await screen.findByTestId('record-trip-visit-card-v2');

    expect(within(cardOf('v1')).getByText('22:42')).toBeOnTheScreen();
    expect(within(cardOf('v2')).getByText('22:44')).toBeOnTheScreen();
    for (const wrong of ['13:42', '06:42', '13:44', '06:44']) {
      expect(screen.queryByText(wrong)).toBeNull();
    }
  });
});

describe('AC-20 · 카드는 도착 이른 순, 도착 없는 카드는 끝', () => {
  it('서버가 [13:44, 13:42, 도착 없는 건너뜀] 으로 주면 화면은 [13:42, 13:44, 건너뜀] 이다', async () => {
    serverVisits = [
      visit('v2', 'p2', { arrivedAt: '2026-08-20T13:44:00Z' }),
      visit('v1', 'p1', {
        arrivedAt: '2026-08-20T13:42:00Z',
        completedAt: '2026-08-20T14:00:00Z',
      }),
      visit('v3', 'p3', { skippedAt: '2026-08-20T13:50:00Z' }),
    ];

    renderPage();
    await screen.findByTestId('record-trip-visit-card-v3');

    const order = screen
      .getAllByTestId(/^record-trip-visit-card-/)
      .map((node) => node.props.testID);
    expect(order).toEqual([
      'record-trip-visit-card-v1',
      'record-trip-visit-card-v2',
      'record-trip-visit-card-v3',
    ]);
  });
});

describe('AC-4 · 시각 수정 → 시트가 서울 시각·장소명으로 열린다', () => {
  it('완료 카드의 "시각 수정"(버튼 역할)을 누르면 14:20·15:20 이 선택되고 부제가 장소명이다', async () => {
    serverVisits = [V_DONE()];

    renderPage();
    await screen.findByTestId('record-trip-visit-card-v-done');
    // 앵커 — 누르기 전엔 시트가 없다(목은 마운트되면 항상 "열린" 상태라 마운트 여부가 곧 열림).
    expect(screen.queryByTestId('record-trip-visit-time-sheet')).toBeNull();

    const edit = within(cardOf('v-done')).getByTestId(
      'record-trip-visit-time-edit-v-done'
    );
    expect(edit.props.accessibilityRole).toBe('button');
    fireEvent.press(edit);

    expect(
      await screen.findByTestId('record-trip-visit-time-sheet')
    ).toBeOnTheScreen();
    expect(screen.getByTestId(cell('arrived', 'h', '14'))).toBeSelected();
    expect(screen.getByTestId(cell('arrived', 'm', '20'))).toBeSelected();
    expect(screen.getByTestId(cell('completed', 'h', '15'))).toBeSelected();
    expect(screen.getByTestId(cell('completed', 'm', '20'))).toBeSelected();
    expect(
      screen.getByTestId('record-trip-visit-time-place')
    ).toHaveTextContent('부산시립미술관');
  });
});

describe('AC-5·AC-14 · D4 · 건너뛴 카드는 라벨만', () => {
  it('건너뛴 카드엔 시각 수정·건너뛰기·메모·사진이 없고 "건너뜀" 라벨이 있다', async () => {
    serverVisits = [V_IN(), V_SKIPPED()];

    renderPage();
    await screen.findByTestId('record-trip-visit-card-v-sk');
    // 짝 앵커 — 도착만 한 카드엔 시각 수정이 있다(부재 단언이 공허하지 않게).
    await waitFor(() =>
      expect(
        within(cardOf('v-in')).getByTestId('record-trip-visit-time-edit-v-in')
      ).toBeOnTheScreen()
    );

    const skipped = cardOf('v-sk');
    expect(
      within(skipped).queryByTestId('record-trip-visit-time-edit-v-sk')
    ).toBeNull();
    expect(within(skipped).queryByTestId('record-visit-skip-v-sk')).toBeNull();
    expect(within(skipped).queryByTestId('record-trip-memo-input')).toBeNull();
    expect(within(skipped).queryByTestId('record-trip-photo-strip')).toBeNull();
    expect(
      within(
        within(skipped).getByTestId('record-visit-skipped-label-v-sk')
      ).getByText('건너뜀')
    ).toBeOnTheScreen();
  });
});

describe('D7 · 서버에 아직 없는 낙관 카드엔 시각 수정이 없다', () => {
  it('계획 행 "방문 체크" 응답 대기 중 낙관 카드엔 없고, 응답으로 실 카드가 되면 선다', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.post(`${BASE}/trips/:tripId/visits`, async () => {
        await gate;
        return HttpResponse.json(
          visit('v-p4', 'p4', { arrivedAt: '2026-08-20T05:00:00Z' }),
          { status: 201 }
        );
      })
    );

    renderPage();
    fireEvent.press(
      await screen.findByTestId(`record-trip-plan-check-${DAY}#p4`)
    );

    // 낙관 순간 — 카드는 섰지만(앵커) 시각 수정은 없다(누르면 PATCH 가 없는 id 로 간다).
    const optimistic = await screen.findByTestId(
      'record-trip-visit-card-optimistic:p4'
    );
    expect(
      within(optimistic).queryByTestId(
        'record-trip-visit-time-edit-optimistic:p4'
      )
    ).toBeNull();

    // 짝 — 응답이 오면 실 카드엔 선다("영원히 끔" 오구현 차단).
    release();
    await screen.findByTestId('record-trip-visit-card-v-p4');
    await waitFor(() =>
      expect(
        within(cardOf('v-p4')).getByTestId('record-trip-visit-time-edit-v-p4')
      ).toBeOnTheScreen()
    );
  });
});

describe('AC-6·AC-7 · 저장 → PATCH 본문', () => {
  it('도착 시만 13 으로 → 본문 키는 arrivedAt·expectedUpdatedAt 뿐, 04:20Z 순간, 그 뒤 시트가 닫히고 카드는 13:20', async () => {
    serverVisits = [
      visit('v-done', 'p2', {
        arrivedAt: '2026-08-20T05:20:00Z',
        // 초·소수가 붙은 완료 — 분이 안 바뀌었으니 실리면 안 된다(AC-7).
        completedAt: '2026-08-20T06:00:59.999Z',
        updatedAt: '2026-08-20T06:01:00.000Z',
      }),
    ];

    renderPage();
    await openSheet('v-done');
    fireEvent.press(screen.getByTestId(cell('arrived', 'h', '13')));
    fireEvent.press(screen.getByTestId('record-trip-visit-time-save'));

    await waitFor(() => expect(patchBodies).toHaveLength(1));
    const body = patchBodies[0]!;
    expect(Object.keys(body).sort()).toEqual([
      'arrivedAt',
      'expectedUpdatedAt',
    ]);
    expect(body.arrivedAt).toMatch(/Z$/);
    expect(Date.parse(body.arrivedAt as string)).toBe(
      Date.parse('2026-08-20T04:20:00Z')
    );
    expect(body.expectedUpdatedAt).toBe('2026-08-20T06:01:00.000Z');

    await waitFor(() =>
      expect(screen.queryByTestId('record-trip-visit-time-sheet')).toBeNull()
    );
    await waitFor(() =>
      expect(within(cardOf('v-done')).getByText('13:20')).toBeOnTheScreen()
    );
    // D6 — 성공은 안내 없이 시트 닫힘으로 충분하다.
    expect(screen.queryByTestId('record-trip-visit-time-result')).toBeNull();
    expect(patchBodies).toHaveLength(1);
  });

  it('서울 01:30(UTC 전날 16:30) 방문 — 카드는 01:30, 분만 45 로 저장하면 전날 16:45Z 순간이다', async () => {
    serverVisits = [
      visit('v-early', 'p1', { arrivedAt: '2026-08-19T16:30:00Z' }),
    ];

    renderPage();
    await screen.findByTestId('record-trip-visit-card-v-early');
    expect(within(cardOf('v-early')).getByText('01:30')).toBeOnTheScreen();

    await openSheet('v-early');
    expect(screen.getByTestId(cell('arrived', 'h', '01'))).toBeSelected();
    expect(screen.getByTestId(cell('arrived', 'm', '30'))).toBeSelected();
    fireEvent.press(screen.getByTestId(cell('arrived', 'm', '45')));
    fireEvent.press(screen.getByTestId('record-trip-visit-time-save'));

    await waitFor(() => expect(patchBodies).toHaveLength(1));
    expect(Date.parse(patchBodies[0]!.arrivedAt as string)).toBe(
      Date.parse('2026-08-19T16:45:00Z')
    );
    expect(patchBodies[0]).not.toHaveProperty('completedAt');
  });
});

describe('AC-9 · 저장 결과 안내', () => {
  it('409 VISIT_CONFLICT → "다른 기기에서 먼저 수정됐어요" + 카드는 재조회한 서버값(13:00)', async () => {
    serverVisits = [V_IN()];
    server.use(
      http.patch(`${BASE}/trips/:tripId/visits/:visitCheckId`, () => {
        // 그사이 다른 기기가 도착을 서울 13:00 으로 고쳐 두었다.
        serverVisits = [
          visit('v-in', 'p1', {
            arrivedAt: '2026-08-20T04:00:00Z',
            updatedAt: '2026-08-20T08:30:00.000Z',
          }),
        ];
        return HttpResponse.json(
          { error: { code: 'VISIT_CONFLICT', message: 'stale' } },
          { status: 409 }
        );
      })
    );

    renderPage();
    await openSheet('v-in');
    fireEvent.press(screen.getByTestId(cell('arrived', 'h', '13')));
    fireEvent.press(screen.getByTestId('record-trip-visit-time-save'));

    expect(
      await screen.findByTestId('record-trip-visit-time-result')
    ).toHaveTextContent(CONFLICT_COPY);
    await waitFor(() =>
      expect(within(cardOf('v-in')).getByText('13:00')).toBeOnTheScreen()
    );
  });

  it.each([
    [
      '404',
      () =>
        HttpResponse.json(
          { error: { code: 'VISIT_NOT_FOUND', message: 'gone' } },
          { status: 404 }
        ),
    ],
    ['네트워크', () => HttpResponse.error()],
  ])(
    '%s 실패 → "방문 시각을 저장하지 못했어요" + 카드는 원래 14:20 으로 돌아온다',
    async (_label, respond) => {
      serverVisits = [V_IN()];
      server.use(
        http.patch(`${BASE}/trips/:tripId/visits/:visitCheckId`, respond)
      );

      renderPage();
      await openSheet('v-in');
      fireEvent.press(screen.getByTestId(cell('arrived', 'h', '13')));
      fireEvent.press(screen.getByTestId('record-trip-visit-time-save'));

      expect(
        await screen.findByTestId('record-trip-visit-time-result')
      ).toHaveTextContent(FAILED_COPY);
      await waitFor(() =>
        expect(within(cardOf('v-in')).getByText('14:20')).toBeOnTheScreen()
      );
      expect(within(cardOf('v-in')).queryByText('13:20')).toBeNull();
    }
  );
});

describe('AC-12·AC-13·AC-15 · 메모 실배선 + 무반응 폴백 0', () => {
  it('도착만 한 카드에서 메모를 쓰고 포커스를 빼면 PUT memo 1회, 페이지 어디에도 정적 +·메모 글자가 없다', async () => {
    serverVisits = [V_DONE(), V_IN(), V_SKIPPED()];

    renderPage();
    await screen.findByTestId('record-trip-visit-card-v-in');
    const memo = await waitFor(() =>
      within(cardOf('v-in')).getByTestId('record-trip-memo-input')
    );

    fireEvent.changeText(memo, '파도 소리가 좋았다');
    // TRIP-1078 — 저장 경로는 blur 하나(실기 iOS multiline 은 submitEditing 을 안 낸다).
    fireEvent(memo, 'blur');

    await waitFor(() => expect(memoBodies).toHaveLength(1));
    expect(memoBodies[0]).toMatchObject({ text: '파도 소리가 좋았다' });
    expect(hits(`/visits/v-in/memo`)).toBe(1);

    // AC-13·AC-15 — 계획 행(○○ 카페)까지 선 페이지 전체에서 정적 폴백 0.
    expect(
      screen.getByTestId(`record-trip-plan-row-${DAY}#p4`)
    ).toBeOnTheScreen();
    expect(screen.queryByText('메모를 남겨보세요')).toBeNull();
    // TRIP-1072 — 오늘 탭엔 [방문 추가] 버튼이 같은 ＋ 글리프를 그린다(Figma 1557:1799).
    // TRIP-1070 — 도착 카드의 사진 추가 타일(record-trip-photo-add)도 배선된 ＋ 다. 두 버튼 밖의 ＋ 만 센다.
    const wiredPlusOwners = [
      screen.getByTestId('record-trip-spontaneous-add'),
      ...screen.getAllByTestId('record-trip-photo-add'),
    ];
    const plusOutsideWired = screen
      .UNSAFE_queryAllByType(PlusGlyph)
      .filter((glyph) => {
        for (let node = glyph.parent; node; node = node.parent) {
          if (wiredPlusOwners.includes(node)) return false;
        }
        return true;
      });
    expect(plusOutsideWired).toHaveLength(0);
    // 사진 추가 타일은 도착한 카드(완료·관람 중)에만 있고, 건너뛴 카드엔 없다.
    expect(
      within(cardOf('v-done')).getByTestId('record-trip-photo-add')
    ).toBeOnTheScreen();
    expect(
      within(cardOf('v-in')).getByTestId('record-trip-photo-add')
    ).toBeOnTheScreen();
    expect(
      within(cardOf('v-sk')).queryByTestId('record-trip-photo-add')
    ).toBeNull();
  });
});

describe('AC-16·AC-17 · 건너뛰기는 확인을 거친다', () => {
  it('누르면 다이얼로그만 뜨고(요청 0), 취소하면 닫히고(요청 0), 확정하면 skip 1회 뒤 건너뜀 라벨', async () => {
    serverVisits = [V_IN()];

    renderPage();
    await screen.findByTestId('record-trip-visit-card-v-in');
    const skip = within(cardOf('v-in')).getByTestId('record-visit-skip-v-in');
    expect(skip.props.accessibilityRole).toBe('button');
    expect(skip).toHaveTextContent('건너뛰기');

    // 실행 ① — 누르면 확인 다이얼로그만.
    fireEvent.press(skip);
    expect(
      await screen.findByTestId('record-visit-skip-dialog')
    ).toBeOnTheScreen();
    expect(hits(SKIP_HIT('v-in'))).toBe(0);
    // 확정 전엔 낙관 건너뜀도 없다(먼저 skip 을 부르고 다이얼로그를 띄우는 오구현 차단).
    expect(screen.queryByTestId('record-visit-skipped-label-v-in')).toBeNull();

    // 실행 ② — 취소.
    fireEvent.press(screen.getByTestId('record-visit-skip-dialog-cancel'));
    await waitFor(() =>
      expect(screen.queryByTestId('record-visit-skip-dialog')).toBeNull()
    );
    expect(hits(SKIP_HIT('v-in'))).toBe(0);

    // 실행 ③ — 다시 눌러 확정.
    fireEvent.press(
      within(cardOf('v-in')).getByTestId('record-visit-skip-v-in')
    );
    fireEvent.press(
      await screen.findByTestId('record-visit-skip-dialog-confirm')
    );

    await waitFor(() => expect(hits(SKIP_HIT('v-in'))).toBe(1));
    await waitFor(() =>
      expect(screen.queryByTestId('record-visit-skip-dialog')).toBeNull()
    );
    expect(
      await screen.findByTestId('record-visit-skipped-label-v-in')
    ).toBeOnTheScreen();
  });
});

describe('AC-18 · 건너뛰기 실패는 다이얼로그 안에 알린다', () => {
  it.each([
    [
      '409',
      () =>
        HttpResponse.json(
          { error: { code: 'VISIT_CONFLICT', message: 'conflict' } },
          { status: 409 }
        ),
    ],
    [
      '404',
      () =>
        HttpResponse.json(
          { error: { code: 'VISIT_NOT_FOUND', message: 'gone' } },
          { status: 404 }
        ),
    ],
    ['네트워크', () => HttpResponse.error()],
  ])(
    '%s → 오류 문구가 다이얼로그 안에 서고 다이얼로그는 남는다',
    async (_label, respond) => {
      serverVisits = [V_IN()];
      server.use(
        http.post(`${BASE}/trips/:tripId/visits/:visitCheckId/skip`, respond)
      );

      renderPage();
      await screen.findByTestId('record-trip-visit-card-v-in');
      fireEvent.press(
        within(cardOf('v-in')).getByTestId('record-visit-skip-v-in')
      );
      fireEvent.press(
        await screen.findByTestId('record-visit-skip-dialog-confirm')
      );

      const dialog = await screen.findByTestId('record-visit-skip-dialog');
      await waitFor(() =>
        expect(
          within(dialog).getByTestId('record-visit-skip-dialog-error')
        ).toBeOnTheScreen()
      );
      expect(hits(SKIP_HIT('v-in'))).toBe(1);
    }
  );
});

/**
 * 5-b 보강(03b W1) — 확정한 뒤 응답이 오기 전에는 다이얼로그를 닫을 수 없다.
 * 이 창에서 [취소]가 먹으면 요청은 계속 가서 실제로 건너뛰어지는데 사용자는 취소했다고 믿고, 늦게 온 결과가
 * 그사이 연 다른 카드의 다이얼로그를 덮는다(대상 뒤바뀜). 계약: 대기 중 [취소]는 비활성 + 눌러도 무변화.
 * 비활성은 `toBeDisabled`(조상도 본다) 대신 버튼 자신의 `accessibilityState.disabled` 로 읽는다.
 * 응답은 promise 로 묶어 대기 창을 붙잡는다(D7 의 gate 선례).
 */
describe('5-b 보강 W1 · 건너뛰기 응답 대기 중엔 다이얼로그를 닫을 수 없다', () => {
  it('확정 뒤 응답 전 [취소]는 비활성이고 눌러도 다이얼로그가 남는다 — 실패 응답이 오면 오류와 함께 다시 닫을 수 있다', async () => {
    serverVisits = [V_IN()];
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.post(`${BASE}/trips/:tripId/visits/:visitCheckId/skip`, async () => {
        await gate;
        return HttpResponse.error();
      })
    );

    renderPage();
    await screen.findByTestId('record-trip-visit-card-v-in');
    fireEvent.press(
      within(cardOf('v-in')).getByTestId('record-visit-skip-v-in')
    );
    // 짝 앵커 — 확정 전 [취소]는 살아 있다(항상 비활성인 오구현 차단).
    expect(
      (await screen.findByTestId('record-visit-skip-dialog-cancel')).props
        .accessibilityState?.disabled
    ).not.toBe(true);

    fireEvent.press(screen.getByTestId('record-visit-skip-dialog-confirm'));
    await waitFor(() => expect(hits(SKIP_HIT('v-in'))).toBe(1));

    // 대기 창 — [취소]는 비활성이고, 눌러도 다이얼로그가 닫히지 않는다.
    const cancel = screen.getByTestId('record-visit-skip-dialog-cancel');
    expect(cancel.props.accessibilityState?.disabled).toBe(true);
    fireEvent.press(cancel);
    expect(screen.getByTestId('record-visit-skip-dialog')).toBeOnTheScreen();

    // 응답(실패)이 오면 다이얼로그 안에 오류가 서고, 이제 [취소]로 닫을 수 있다.
    release();
    expect(
      await screen.findByTestId('record-visit-skip-dialog-error')
    ).toBeOnTheScreen();
    fireEvent.press(screen.getByTestId('record-visit-skip-dialog-cancel'));
    await waitFor(() =>
      expect(screen.queryByTestId('record-visit-skip-dialog')).toBeNull()
    );
    expect(hits(SKIP_HIT('v-in'))).toBe(1);
  });
});

/**
 * 5-b 보강(03b N2) — 서버에 아직 없는 낙관 카드는 건너뛰기·완료도 누를 수 없다(D7 을 시각 수정 밖으로 넓힘).
 * 낙관 id 로 skip·complete 가 나가면 404 가 되고, 완료 쪽은 실패가 삼켜진다.
 */
describe('5-b 보강 N2 · 낙관 카드엔 건너뛰기·완료 체크가 없다', () => {
  it('계획 행 "방문 체크" 응답 대기 중 낙관 카드엔 없고, 응답으로 실 카드가 되면 둘 다 선다', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.post(`${BASE}/trips/:tripId/visits`, async () => {
        await gate;
        return HttpResponse.json(
          visit('v-p4', 'p4', { arrivedAt: '2026-08-20T05:00:00Z' }),
          { status: 201 }
        );
      })
    );

    renderPage();
    fireEvent.press(
      await screen.findByTestId(`record-trip-plan-check-${DAY}#p4`)
    );

    const optimistic = await screen.findByTestId(
      'record-trip-visit-card-optimistic:p4'
    );
    expect(
      within(optimistic).queryByTestId('record-visit-skip-optimistic:p4')
    ).toBeNull();
    expect(
      within(optimistic).queryByTestId(
        'record-visit-check-active-optimistic:p4'
      )
    ).toBeNull();

    // 짝 — 실 카드엔 둘 다 선다("낙관이 아니어도 끔" 오구현 차단).
    release();
    await screen.findByTestId('record-trip-visit-card-v-p4');
    await waitFor(() => {
      expect(
        within(cardOf('v-p4')).getByTestId('record-visit-skip-v-p4')
      ).toBeOnTheScreen();
      expect(
        within(cardOf('v-p4')).getByTestId('record-visit-check-active-v-p4')
      ).toBeOnTheScreen();
    });
  });
});

describe('AC-25 · INV-3 — 시트·다이얼로그 어디에도 체류 시간이 없다', () => {
  it('시트를 연 화면과 건너뛰기 다이얼로그를 연 화면 모두 N분·N시간·소요·체류 0건', async () => {
    serverVisits = [V_DONE(), V_IN(), V_SKIPPED()];

    renderPage();
    await openSheet('v-done');
    const withSheet = JSON.stringify(screen.toJSON());
    expect(withSheet).toContain('부산시립미술관');
    expect(DURATION_TEXT.test(withSheet)).toBe(false);

    fireEvent.press(screen.getByTestId('record-trip-visit-time-cancel'));
    fireEvent.press(
      within(cardOf('v-in')).getByTestId('record-visit-skip-v-in')
    );
    await screen.findByTestId('record-visit-skip-dialog');
    const withDialog = JSON.stringify(screen.toJSON());
    expect(DURATION_TEXT.test(withDialog)).toBe(false);
  });
});

/**
 * TRIP-1080 · 시트를 딤으로 닫아도 다시 열리고, 다른 카드로 바꾸면 그 카드 값으로 열린다.
 *
 * 왜: 라이브러리가 딤 탭으로 시트를 닫아도 페이지의 "편집 중" 상태가 그대로면 '시각 수정'을 다시 눌러도
 * 아무 일도 안 일어난다(INV-4 무반응). 또 시트가 떠 있는 채 다른 카드를 누르면, 시트는 처음 받은 값만
 * 기억하므로(`useState` 초깃값은 첫 마운트에서만 읽힌다) 이전 카드 시각이 그대로 보인다.
 *
 * 무엇을 보장하나:
 *  - P1·P2 닫힘 신호 뒤 시트가 사라지고, 같은 카드·다른 카드 어느 쪽을 눌러도 그 카드 시각으로 다시 뜬다.
 *  - P3 시트가 떠 있는 채 다른 카드를 누르면 그 카드 시각으로 바뀐다(`key` 리마운트의 유일한 심판).
 *  - P4 휠을 현재 위치에 멈추고 저장하면 PATCH 가 안 나가고, 휠로 바꿔 저장하면 PATCH 1회로 반영된다.
 *
 * ⚠️ `fireEvent(시트, 'close')` 는 딤 탭의 대역이다 — `onClose` 를 못 찾으면 조용히 끝나므로, "닫힌 뒤
 *   부재"를 다시 누르기 **전에** 먼저 본다(02a ★6). 실제 딤 탭은 6-b 실기.
 *
 * 3동작 뼈대: 준비=두 카드 서버 상태 → 실행=열기·닫힘 신호·다른 카드 탭·휠 정지·저장 → 단언=시트 개수·선택 셀·PATCH 본문.
 */
describe('🔴 TRIP-1080 · 시트 닫힘·재오픈·카드 전환·휠 저장', () => {
  const SHEET = 'record-trip-visit-time-sheet';
  /** 도착만(광안리) — 서울 10:05. A(V_DONE, 14:20·15:20)와 시·분이 모두 다르다. */
  const V_B = () => visit('v-b', 'p1', { arrivedAt: '2026-08-20T01:05:00Z' });

  const pressEdit = (id: string) =>
    fireEvent.press(
      within(cardOf(id)).getByTestId(`record-trip-visit-time-edit-${id}`)
    );
  const settleArrivedHour = (index: number) =>
    fireEvent(
      screen.getByTestId('record-trip-visit-time-arrived-h-wheel'),
      'momentumScrollEnd',
      {
        nativeEvent: { contentOffset: { x: 0, y: index * WHEEL_CELL_HEIGHT } },
      }
    );

  it('P1 · AC-5 — 딤으로 닫은 뒤 같은 카드를 다시 누르면 시트가 1개로 다시 뜨고 14:20 이 선택돼 있다', async () => {
    serverVisits = [V_DONE(), V_B()];
    renderPage();
    await openSheet('v-done');

    fireEvent(screen.getByTestId(SHEET), 'close');
    // 앵커 — 먼저 닫혔어야 "다시 열림"이 뜻을 가진다.
    expect(screen.queryByTestId(SHEET)).not.toBeOnTheScreen();

    pressEdit('v-done');

    expect(screen.getAllByTestId(SHEET).length).toBe(1);
    expect(screen.getByTestId(cell('arrived', 'h', '14'))).toBeSelected();
    expect(screen.getByTestId(cell('arrived', 'm', '20'))).toBeSelected();
  });

  it('P2 · AC-5 짝 — 딤으로 닫은 뒤 다른 카드를 누르면 그 카드 시각(10:05)으로 뜬다', async () => {
    serverVisits = [V_DONE(), V_B()];
    renderPage();
    await openSheet('v-done');

    fireEvent(screen.getByTestId(SHEET), 'close');
    expect(screen.queryByTestId(SHEET)).not.toBeOnTheScreen();

    pressEdit('v-b');

    expect(screen.getAllByTestId(SHEET).length).toBe(1);
    expect(screen.getByTestId(cell('arrived', 'h', '10'))).toBeSelected();
    expect(screen.getByTestId(cell('arrived', 'm', '05'))).toBeSelected();
  });

  it('P3 · AC-6 — 시트가 떠 있는 채 다른 카드를 누르면 시트는 1개, 그 카드 시각(10:05)이고 이전 카드(14:20)는 아니다', async () => {
    serverVisits = [V_DONE(), V_B()];
    renderPage();
    await openSheet('v-done');
    expect(screen.getByTestId(cell('arrived', 'h', '14'))).toBeSelected();

    pressEdit('v-b');

    expect(screen.getAllByTestId(SHEET).length).toBe(1);
    expect(screen.getByTestId(cell('arrived', 'h', '10'))).toBeSelected();
    expect(screen.getByTestId(cell('arrived', 'm', '05'))).toBeSelected();
    expect(screen.getByTestId(cell('arrived', 'h', '14'))).not.toBeSelected();
    expect(screen.getByTestId(cell('arrived', 'm', '20'))).not.toBeSelected();
  });

  it('P4 · AC-2·AC-7·AC-9 — 현재 위치에서 멈춘 저장은 PATCH 0, 휠로 13 에 멈춘 저장은 PATCH 1회(04:20Z)', async () => {
    serverVisits = [V_DONE()];
    renderPage();

    // ① 무변경 — 도착 시 휠이 현재 값(14)에서 멈춘 채 저장. 시트는 닫힌다(무반응 아님).
    await openSheet('v-done');
    settleArrivedHour(14);
    fireEvent.press(screen.getByTestId('record-trip-visit-time-save'));
    await waitFor(() =>
      expect(screen.queryByTestId(SHEET)).not.toBeOnTheScreen()
    );

    // ② 진짜 변경 — 다시 열어 13 에서 멈추고 저장.
    await openSheet('v-done');
    settleArrivedHour(13);
    fireEvent.press(screen.getByTestId('record-trip-visit-time-save'));

    await waitFor(() => expect(patchBodies.length).toBeGreaterThanOrEqual(1));
    // 순서 앵커 — ①이 헛 PATCH 를 냈다면 ②보다 먼저 도착해 여기서 2개다(02a ★8).
    expect(patchBodies.length).toBe(1);
    const body = patchBodies[0]!;
    expect(Date.parse(body.arrivedAt as string)).toBe(
      Date.parse('2026-08-20T04:20:00Z')
    );
    await waitFor(() =>
      expect(screen.queryByTestId(SHEET)).not.toBeOnTheScreen()
    );
  });
});
