import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { View } from 'react-native';
import { http, HttpResponse } from 'msw';
import { type QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';

import { server } from '@/mocks/server';
import { useItineraryEditStore } from '@/features/edit-itinerary';
import { buildSlotKey } from '@/entities/itinerary-slot';
import { ItineraryEditPage } from '@/pages/itinerary/itinerary-edit';
import {
  ManualPlanPage,
  PlaceAddPage,
} from '@/pages/itinerary/itinerary-manual';
import type {
  EditItineraryRequest,
  Itinerary,
  ItineraryDaysItem,
  ItineraryDaysItemSlotsItem,
  Place,
  Trip,
} from '@/shared/api/index.schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';
import { resetPressGuard } from '@/shared/lib/pressGuard';
import {
  editListData,
  fireEditDragEnd,
  fireEditDropOnZone,
} from '@/test-support/editDragList';
import { resetToast, WithToastHost } from '@/test-support/toastHarness';
import { guardKeyWarnings } from '@/test-support/keyWarnings';
import { newTestQueryClient, settle } from '@/test-support/queryRender';

/**
 * TRIP-1498 (a) — 일정 편집기에서 [저장] 전에 바꾼 것(순서·시각·삭제)이 장소 추가 뒤에도 남는다.
 *
 * 왜 한 파일로 두 화면을 같이 그리나: 실제 앱에서 편집기의 「장소 추가」「카드 사이 +」는 `router.push` 라
 * 편집기가 **마운트된 채** 장소 추가 화면 밑에 남는다. 장소 추가가 PUT 응답으로 일정 캐시를 바꾸면, 보이지도
 * 않는 편집기의 "캐시가 바뀌면 다시 시드" 규칙이 편집 초안을 응답으로 덮어 쓴다. 이 연쇄는 두 화면과
 * 그 사이의 캐시·스토어가 모두 진짜일 때만 재현된다(`PlaceAddPage.integration` N9 의 "편집기 대역"은 구독만
 * 하는 `Text` 라 못 본다). 두 화면은 서로 다른 pages 슬라이스(`itinerary-edit`·`itinerary-manual`)라
 * 어느 한 슬라이스 안 테스트가 상대를 import 할 수 없다(ESLint 형제 슬라이스 금지) — 선례
 * `recordAddVisitFlow.integration` 처럼 `src/__tests__` 에 둔다.
 *
 * 무엇을 보장하나(심판 대상 = 실제로 나간 PUT 바디 + 편집 스토어 값 + 보이는 트리):
 *  - F1·F2: 로컬 순서 변경 뒤 「카드 사이 +」로 추가해도 초안에 로컬 순서가 남고, 추가한 장소가
 *    사용자가 누른 카드 **바로 뒤**(초안 기준)에 들어 있으며, 이어 누른 [저장]의 PUT 에 둘 다 실린다.
 *    PUT 은 장소 추가 시점에는 서버 캐시 기준이라 로컬 변경이 서버에 먼저 새지 않는다.
 *  - F1-삭제·F1-시각: 삭제·시각 조정도 같다.
 *  - F3: 로컬 변경이 없으면 지금처럼 응답으로 초안이 시드되고 기존 토스트 문구 그대로다(무회귀).
 *  - F4a·b·c: 편집기 자신의 [저장] 성공 응답은 dirty 여도 시드하고(위반 배지) dirty 를 내린다.
 *    저장 실패면 dirty 가 남는다.
 *  - F5: 변경 뒤 편집기를 버리고 다시 열면 옛 변경이 되살아나지 않는다.
 *  - F6: dirty 일 때 토스트가 "다른 수정은 저장해야 남아요" 를 말한다.
 *
 * 장치:
 *  - 트리 = QueryClient 하나 + 토스트 호스트 + 편집기 + (「+」를 누르면 `push` 목이 params 를 받아) 그 위에
 *    `PlaceAddPage`. `back` 목은 장소 추가를 뺀다. 두 래퍼 View 는 이 파일 전용 테스트 testID 다.
 *  - 가짜 서버는 PUT 으로 받은 일정으로 자기 상태를 바꾸고 그대로 돌려준다(`nameKo` 는 후보 이름으로 채움).
 *  - 순서·삭제는 UI 경로(`fireEditDragEnd`·`fireEditDropOnZone`), 시각 조정만 같은 스토어 액션을 직접 부른다.
 *
 * 3동작 뼈대: 준비 = 가짜 서버·편집기 마운트 → 실행 = 로컬 변경·「+」·추가·(저장) → 단언 = 초안·PUT 바디·토스트.
 */

jest.setTimeout(30000);

// TRIP-1804 — 같은 날 같은 장소 카드도 키가 겹치면 안 된다(드래그 리스트가 이 키로 카드 자리를 잰다).
guardKeyWarnings();

// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/shared/storage', () => require('@/test-support/storageMock'));

// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/shared/map', () => require('@/test-support/mapViewMock'));

// 직접 짜기 편집기는 뒤로 가로채기(`usePreventRemove`)를 쓴다 — 네비게이터 밖에선 throw 라 목으로 바꾼다.
const mockNavigation = { dispatch: jest.fn(), addListener: () => () => {} };
jest.mock('@react-navigation/native', () => ({
  usePreventRemove: jest.fn(),
  useNavigation: () => mockNavigation,
}));

const mockPush = jest.fn();
const mockBack = jest.fn();
const mockReplace = jest.fn();
const mockDismissTo = jest.fn();
// 장소 추가 화면은 `useLocalSearchParams` 로 insertAfter·date 를 읽는다 — push 목이 받은 params 로 채운다.
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: mockPush,
    back: mockBack,
    replace: mockReplace,
    dismissTo: mockDismissTo,
    canGoBack: () => true,
  }),
  useNavigation: () => mockNavigation,
  useLocalSearchParams: () => mockParams,
}));

const BASE = 'http://localhost:8080/api/v1';
const TRIP = 't1';
const D1 = '2026-06-10';
const D2 = '2026-06-11';

const EDITOR = 'flow-editor';
const ADD = 'flow-add';
const SAVE = 'sheet-cta-button-0';
const META = 'sheet-header-meta';
const TOAST = 'itinerary-place-added-toast';
const BASE_MESSAGE = '추가했어요 · 일정에 바로 저장됐어요';
const TAIL = ' · 다른 수정은 저장해야 남아요';
const DURATION_TEXT = /\d+\s*(분|초|시간)|소요/;

const NAMES: Record<string, string> = {
  p1: '해운대 해수욕장',
  p2: '감천문화마을',
};

function place(poiId: string): Place {
  return {
    poiId,
    nameKo: NAMES[poiId],
    category: '명소',
    lat: 35.1587,
    lng: 129.1604,
    region: '부산',
    openingHours: null,
    imageUrl: null,
    tags: [],
    savedCount: 1,
    dataStatus: 'ACTIVE',
  };
}

function slot(
  poiId: string,
  startAt: string,
  endAt: string
): ItineraryDaysItemSlotsItem {
  return {
    poiId,
    startAt,
    endAt,
    isFixed: false,
    endsNextDay: false,
    hasViolation: false,
    alternatives: [],
    tags: [],
    nameKo: NAMES[poiId] ?? `장소-${poiId}`,
  };
}

/** 서버 일정 — 1일차 [a, b, c] · 2일차 [d]. */
function initialDays(): ItineraryDaysItem[] {
  return [
    {
      date: D1,
      slots: [
        slot('a', '09:00:00', '10:00:00'),
        slot('b', '11:00:00', '12:00:00'),
        slot('c', '13:00:00', '14:00:00'),
      ],
    },
    { date: D2, slots: [slot('d', '10:00:00', '11:00:00')] },
  ];
}

function envelope(days: ItineraryDaysItem[]): Itinerary {
  return {
    itineraryId: 'it1',
    tripId: TRIP,
    status: 'PLANNED',
    solveMode: 'MINIMAL',
    generationMode: 'MANUAL',
    isFallback: false,
    scoringMode: null,
    degradations: [],
    generationState: 'COMPLETE',
    days,
  };
}

/** PUT 요청을 서버 일정 모양으로 되돌린다(읽기 전용 필드·이름을 채움). `violatedPoiId` 슬롯엔 위반을 단다. */
function toServerDays(
  body: EditItineraryRequest,
  violatedPoiId?: string
): ItineraryDaysItem[] {
  return body.days.map((day) => ({
    date: day.date,
    slots: day.slots.map((one) => ({
      ...one,
      endsNextDay: one.endsNextDay ?? false,
      hasViolation: one.poiId === violatedPoiId,
      ...(one.poiId === violatedPoiId
        ? { violationReason: '시간이 겹쳐요' }
        : {}),
      alternatives: [],
      tags: [],
      nameKo: NAMES[one.poiId] ?? `장소-${one.poiId}`,
    })),
  }));
}

function trip(): Trip {
  return {
    tripId: TRIP,
    title: '부산 여행',
    startDate: D1,
    endDate: '2026-06-12',
    party: 2,
    preferenceSnapshot: {},
    destinations: [{ seq: 1, region: '부산', nights: 2 }],
    status: 'PLANNED',
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-01T10:00:00.000Z',
    baseCount: 0,
    itineraryDayCount: 0,
    // 일정이 없는 여행 — 목록이 싣는 일정 상태 네 칸(TRIP-1677).
    itineraryStatus: null,
    itineraryGenerationState: null,
    itineraryGenerationMode: null,
    itineraryGenerating: false,
  };
}

let serverDays: ItineraryDaysItem[];
let putBodies: EditItineraryRequest[];
/** n 번째(1부터) PUT 의 응답을 케이스가 덮는다. undefined 를 돌려주면 기본(받은 대로 되돌림). */
let putOverride:
  ((n: number, body: EditItineraryRequest) => Response | undefined) | undefined;

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

beforeEach(() => {
  [mockPush, mockBack, mockReplace, mockDismissTo].forEach((fn) =>
    fn.mockReset()
  );
  mockParams = {};
  setAccessToken('valid-access');
  // 편집 스토어는 모듈 싱글턴이다 — 앞 케이스의 초안·dirty 가 새지 않게 비운다(02a ★7).
  useItineraryEditStore.getState().reset();
  serverDays = initialDays();
  putBodies = [];
  putOverride = undefined;

  server.use(
    http.get(`${BASE}/trips/:tripId`, () => HttpResponse.json(trip())),
    http.get(`${BASE}/trips/:tripId/itinerary`, () =>
      HttpResponse.json(envelope(serverDays))
    ),
    http.get(`${BASE}/trips/:tripId/visits/days/:day`, () =>
      HttpResponse.json({ visits: [] })
    ),
    // 직접 짜기 편집기가 빈 편집기 지도 중심용으로 거점을 조회한다.
    http.get(`${BASE}/trips/:tripId/bases`, () => HttpResponse.json([])),
    http.get(`${BASE}/places`, () =>
      HttpResponse.json({
        items: [place('p1'), place('p2')],
        nextCursor: null,
      })
    ),
    http.put(`${BASE}/trips/:tripId/itinerary`, async ({ request }) => {
      const body = (await request.json()) as EditItineraryRequest;
      putBodies.push(body);
      const overridden = putOverride?.(putBodies.length, body);
      if (overridden !== undefined) return overridden;
      serverDays = toServerDays(body);
      return HttpResponse.json(envelope(serverDays));
    }),
    // 직접 짜기는 저장(PUT) 뒤 확정 POST 가 따라 나간다.
    http.post(`${BASE}/trips/:tripId/itinerary/confirm`, () =>
      HttpResponse.json({ ...envelope(serverDays), status: 'CONFIRMED' })
    )
  );
});

afterEach(() => {
  server.resetHandlers();
  clearAccessToken();
  // 토스트·편집 스토어는 모듈 싱글턴이다 — describe 안이 아니라 파일 최상위에서 비운다(02a ★6·★7).
  resetToast();
  useItineraryEditStore.getState().reset();
  // 저장 뒤 복귀가 연 연타 창(모듈 전역)이 다음 테스트의 첫 누름을 삼키지 않게(통합 QA O2).
  resetPressGuard();
});

afterAll(() => server.close());

type Kind = 'edit' | 'manual';

/** 편집기 + (「+」를 누르면) 그 위에 장소 추가. 실제 스택처럼 편집기는 밑에 마운트된 채 남는다. */
function Flow({ kind }: { kind: Kind }): ReactElement {
  const [adding, setAdding] = useState(false);
  useEffect(() => {
    mockPush.mockImplementation((href: { params: Record<string, string> }) => {
      mockParams = href.params;
      setAdding(true);
    });
    mockBack.mockImplementation(() => setAdding(false));
  }, []);
  return (
    <WithToastHost>
      <View testID={EDITOR}>
        {kind === 'edit' ? (
          <ItineraryEditPage tripId={TRIP} />
        ) : (
          <ManualPlanPage tripId={TRIP} />
        )}
      </View>
      {adding ? (
        <View testID={ADD}>
          <PlaceAddPage tripId={TRIP} />
        </View>
      ) : null}
    </WithToastHost>
  );
}

let lastFlowClient: QueryClient | undefined;

function renderFlow(
  kind: Kind,
  client: QueryClient = newTestQueryClient({ gcTime: 0 })
) {
  lastFlowClient = client;
  const view = render(
    <QueryClientProvider client={client}>
      <Flow kind={kind} />
    </QueryClientProvider>
  );
  return { client, view };
}

const cardId = (date: string, poiId: string): string =>
  `slot-stopcard-${buildSlotKey(date, poiId)}`;

/** 편집기가 일정을 시드해 첫 카드가 뜰 때까지. */
async function ready(): Promise<void> {
  await screen.findByTestId(cardId(D1, 'a'));
  // TRIP-1748 — h12 편집기는 그 날 방문 조회가 응답하기 전엔 저장을 막는다(완료 여부를 모름). 카드와 방문 조회 시작이 같은
  // 렌더라 바로 저장하면 경합한다 — 방문 조회가 끝나기를 기다린다(직접 짜기는 방문 조회가 없어 곧바로 통과).
  await waitFor(() =>
    expect(
      (lastFlowClient?.getQueryCache().getAll() ?? []).some(
        (query) =>
          String(query.queryKey[0]).includes('/visits/days/') &&
          query.getObserversCount() > 0 &&
          query.state.status === 'pending'
      )
    ).toBe(false)
  );
}

const editor = () => within(screen.getByTestId(EDITOR));

/** 편집 스토어의 그날 초안 poiId 순서. */
function draftIds(date: string): string[] {
  return (
    useItineraryEditStore
      .getState()
      .days.find((day) => day.date === date)
      ?.slots.map((one) => one.poiId) ?? []
  );
}

/** 나간 n 번째(0부터) PUT 의 그날 poiId 순서. */
function sentIds(index: number, date: string): string[] {
  return (
    putBodies[index]?.days
      .find((day) => day.date === date)
      ?.slots.map((one) => one.poiId) ?? []
  );
}

/** 편집기의 버튼을 눌러 장소 추가 화면을 연다(`push` 목이 그 위에 얹는다). */
async function openAdd(trigger: string): Promise<void> {
  fireEvent.press(editor().getByTestId(trigger));
  await screen.findByTestId(ADD);
}

/** 장소 추가 화면에서 poiId 의 [추가] → 기본 시각 [적용] → 추가 토스트가 뜰 때까지. */
async function addPlaceAndWait(poiId: string): Promise<void> {
  const add = within(screen.getByTestId(ADD));
  fireEvent.press(await add.findByTestId(`itinerary-place-add-${poiId}`));
  fireEvent.press(await screen.findByTestId('itinerary-edit-time-apply'));
  await screen.findByTestId(TOAST);
  await settle();
  // 연타 창(400ms)이 지난 것과 같다 — [적용]이 창을 연다(TRIP-1793 D4), 사람 손은 편집기 [저장]까지 그보다 느리다.
  resetPressGuard();
}

describe.each([
  ['ItineraryEditPage', 'edit'],
  ['ManualPlanPage', 'manual'],
] as const)('%s — 로컬 변경 뒤 장소 추가', (_name, kind) => {
  it('F1·F2 · AC-a1·a2·a3 — 순서를 바꾼 뒤 「카드 사이 +」로 추가해도 로컬 순서가 남고 추가한 장소는 누른 카드 바로 뒤이며, 이어 누른 [저장]의 PUT 에 둘 다 실린다', async () => {
    // 준비 — 서버 [a,b,c]. 편집기에서 c 를 맨 앞으로 끌어 로컬 [c,a,b].
    renderFlow(kind);
    await ready();
    fireEditDragEnd(2, 0);
    expect(draftIds(D1)).toEqual(['c', 'a', 'b']);

    // 실행 — 0번 카드(c) 뒤 「+」 → 장소 추가 화면에서 p1 추가.
    await openAdd('itinerary-edit-insert-0');
    await addPlaceAndWait('p1');

    // 단언 — 초안: 로컬 순서 + p1 이 c 바로 뒤(초안 기준). 서버 index 를 쓰면 a 뒤가 된다.
    expect(draftIds(D1)).toEqual(['c', 'p1', 'a', 'b']);
    expect(editor().getByTestId(META)).toHaveTextContent('4곳');
    // 추가한 카드에 장소 이름이 보인다(빈 카드가 아니다).
    expect(
      editor().getByTestId(`slot-stopcard-name-${buildSlotKey(D1, 'p1')}`)
    ).toHaveTextContent('해운대 해수욕장');
    // 장소 추가는 서버 캐시 기준으로 저장한다 — p1 을 빼면 서버 순서 [a,b,c] 그대로, 로컬 순서는 안 새어 들어간다.
    expect(putBodies).toHaveLength(1);
    expect(sentIds(0, D1)).toContain('p1');
    expect(sentIds(0, D1).filter((id) => id !== 'p1')).toEqual(['a', 'b', 'c']);

    // 실행 — 장소 추가 화면에서 돌아와 [저장].
    fireEvent.press(
      within(screen.getByTestId(ADD)).getByTestId('sheet-daychip-back')
    );
    expect(screen.queryByTestId(ADD)).toBeNull();
    fireEvent.press(editor().getByTestId(SAVE));
    await waitFor(() => expect(putBodies).toHaveLength(2));

    // 단언 — 서버에서 방금 추가한 p1 이 지워지지 않고, 로컬 순서도 그대로 저장된다.
    expect(sentIds(1, D1)).toEqual(['c', 'p1', 'a', 'b']);
    expect(sentIds(1, D2)).toEqual(['d']);
  });

  it('F4a · AC-a5 — 로컬 변경이 있어도 편집기 자신의 [저장] 응답은 초안에 시드돼 위반 배지가 그려진다', async () => {
    // 준비 — 서버가 저장 응답에서 a 에 위반을 단다.
    putOverride = (_n, body) =>
      HttpResponse.json(envelope(toServerDays(body, 'a')));
    renderFlow(kind);
    await ready();
    fireEditDragEnd(2, 0);

    // 실행 — [저장] → 위반 요약 게이트 → [고치기].
    fireEvent.press(editor().getByTestId(SAVE));
    fireEvent.press(await screen.findByTestId('itinerary-edit-save-back'));

    // 단언 — 응답으로 초안이 시드돼 a 에 위반 배지가 뜬다(과하게 막으면 배지가 없다).
    expect(
      await screen.findByTestId(
        `slot-stopcard-violation-${buildSlotKey(D1, 'a')}`
      )
    ).toBeOnTheScreen();
    expect(draftIds(D1)).toEqual(['c', 'a', 'b']);
  });
});

/**
 * TRIP-1804 · 저장 안 한 변경이 있을 때 그날 이미 있는 장소를 또 담으면 — 고른 시각이 초안을 지나 **이어 누른 [저장]의 PUT** 까지 간다.
 * 초안에 끼울 슬롯을 poiId 로 찾으면 기존 슬롯(옛 시각)이 들어가 [저장]이 고른 시각을 지운다(QA N1).
 */
// 편집기 렌더 하나가 소음 예산 reanimated 1건이라 두 페이지를 곱하지 않는다 — 고친 곳은 장소 추가 쪽이고 저장 경로는 F1·F2 가 두 페이지 다 본다.
describe('같은 날 같은 장소 저장 (TRIP-1804)', () => {
  const sentTimes = (index: number): [string, string][] =>
    (putBodies[index]?.days.find((day) => day.date === D1)?.slots ?? []).map(
      (one) => [one.poiId, one.startAt]
    );

  function serveD1(slots: ItineraryDaysItemSlotsItem[]): void {
    serverDays = [{ date: D1, slots }, ...initialDays().slice(1)];
  }

  async function backToEditorAndSave(): Promise<void> {
    fireEvent.press(
      within(screen.getByTestId(ADD)).getByTestId('sheet-daychip-back')
    );
    fireEvent.press(editor().getByTestId(SAVE));
    await waitFor(() => expect(putBodies).toHaveLength(2));
  }

  it('F7 · AC-2 · 일정 편집 — 이미 있는 두 곳을 각각 다른 시각에 담고 [저장]하면 각자 고른 시각으로 저장된다', async () => {
    // 준비 — QA 재현: 서버 [p1 09:00, p2 12:00], p1 을 빼서 저장 안 한 변경을 만든다.
    serveD1([
      slot('p1', '09:00:00', '10:00:00'),
      slot('p2', '12:00:00', '13:00:00'),
    ]);
    renderFlow('edit');
    await screen.findByTestId(cardId(D1, 'p2'));
    useItineraryEditStore.getState().deleteSlot(D1, 'p1');

    // 실행 — 말미 「장소 추가」 → p1 13시·p2 14시 → 돌아와 [저장].
    await openAdd('itinerary-edit-add-place');
    const add = within(screen.getByTestId(ADD));
    resetPressGuard();
    fireEvent.press(await add.findByTestId('place-add-check-p1'));
    fireEvent.press(add.getByTestId('place-add-check-p2'));
    fireEvent.press(screen.getByTestId('place-add-bulk-confirm'));
    fireEvent.press(
      await screen.findByTestId('itinerary-edit-time-wheel-h-13')
    );
    fireEvent.press(screen.getByTestId('itinerary-edit-time-apply'));
    await waitFor(() =>
      expect(
        screen.getByTestId('itinerary-edit-time-place-summary')
      ).toHaveTextContent(NAMES.p2)
    );
    fireEvent.press(screen.getByTestId('itinerary-edit-time-wheel-h-14'));
    resetPressGuard(); // 새 시트를 보고 따로 누른다 — 첫 [적용]의 창은 지났다(TRIP-1828)
    fireEvent.press(screen.getByTestId('itinerary-edit-time-apply'));
    await screen.findByTestId(TOAST);
    await settle();
    resetPressGuard();
    await backToEditorAndSave();

    // 단언 — 저장 PUT: 뺀 p1(09:00)은 없고 있던 p2 는 12:00, 담은 둘은 고른 시각.
    const [, addedP1, addedP2] = sentTimes(1);
    expect(sentTimes(1)).toHaveLength(3);
    expect(sentTimes(1)[0]).toEqual(['p2', '12:00:00']);
    expect(addedP1[0]).toBe('p1');
    expect(addedP1[1].slice(0, 2)).toBe('13');
    expect(addedP2[0]).toBe('p2');
    expect(addedP2[1].slice(0, 2)).toBe('14');
  });

  it('F8 · AC-1 · 직접 짜기 — 카드 사이 「+」로 뒤쪽에 이미 있는 장소를 담아도 끼운 자리의 시각으로 저장된다', async () => {
    // 준비 — 서버 [p2 08:00, p1 14:00], p2 시각을 바꿔 저장 안 한 변경. 새 p1 은 기존 p1 **앞**에 끼므로
    // "그 장소의 마지막 일치"로 집어도 틀리다(말미 추가로는 첫·마지막 일치 말고는 못 가른다).
    serveD1([
      slot('p2', '08:00:00', '09:00:00'),
      slot('p1', '14:00:00', '15:00:00'),
    ]);
    renderFlow('manual');
    await screen.findByTestId(cardId(D1, 'p2'));
    useItineraryEditStore.getState().adjustSlotTime(D1, 'p2', {
      startAt: '08:30:00',
      endAt: '09:00:00',
      endsNextDay: false,
    });

    // 실행 — 0번 카드 뒤 「+」 → p1 을 09:14 로(기본 09:00~10:00 에서 분만) → 돌아와 [저장].
    await openAdd('itinerary-edit-insert-0');
    const add = within(screen.getByTestId(ADD));
    fireEvent.press(await add.findByTestId('itinerary-place-add-p1'));
    fireEvent.press(
      await screen.findByTestId('itinerary-edit-time-wheel-m-14')
    );
    fireEvent.press(screen.getByTestId('itinerary-edit-time-apply'));
    await screen.findByTestId(TOAST);
    await settle();
    resetPressGuard();
    await backToEditorAndSave();

    expect(sentTimes(1)).toEqual([
      ['p2', '08:30:00'],
      ['p1', '09:14:00'],
      ['p1', '14:00:00'],
    ]);
  });
});

describe('ItineraryEditPage — 로컬 변경 뒤 장소 추가 (변형·무회귀)', () => {
  it('F1-삭제 · AC-a1 — 삭제한 뒤 말미 「장소 추가」를 해도 삭제가 남고 추가한 장소가 말미에 붙는다', async () => {
    renderFlow('edit');
    await ready();
    // 실행 1 — b 를 삭제 영역에 놓는다.
    await fireEditDropOnZone(1);
    expect(draftIds(D1)).toEqual(['a', 'c']);
    expect(editor().getByTestId('editor-undo')).not.toBeDisabled(); // TRIP-1792 — 삭제 직후엔 되돌릴 수 있다

    // 실행 2 — 말미 「장소 추가」 → p1.
    await openAdd('itinerary-edit-add-place');
    await addPlaceAndWait('p1');

    // 단언 — 초안은 삭제 유지 + 말미 p1. PUT 은 서버 기준이라 b 를 아직 포함한다.
    expect(draftIds(D1)).toEqual(['a', 'c', 'p1']);
    expect(editor().getByTestId(META)).toHaveTextContent('3곳');
    expect(sentIds(0, D1).filter((id) => id !== 'p1')).toEqual(['a', 'b', 'c']);
    // TRIP-1792 — 장소 추가는 서버가 이미 저장한 변경이라 그 전 편집(삭제)의 되돌리기 길을 닫는다: ↶ 가 다시 비활성(D1·AC-8).
    expect(editor().getByTestId('editor-undo')).toBeDisabled();
  });

  it('F1-시각 · AC-a1 — 시각을 바꾼 뒤 장소를 추가해도 바꾼 시각이 남는다', async () => {
    renderFlow('edit');
    await ready();
    // 준비 — 편집기 시각 시트의 [적용]이 부르는 액션을 직접 부른다(02a ★3).
    act(() => {
      useItineraryEditStore.getState().adjustSlotTime(D1, 'b', {
        startAt: '15:00:00',
        endAt: '16:00:00',
        endsNextDay: false,
      });
    });

    await openAdd('itinerary-edit-add-place');
    await addPlaceAndWait('p1');

    // 단언 — 초안의 b 는 15:00 그대로 + p1 존재. 서버로 간 b 는 원래 11:00.
    const draftB = useItineraryEditStore
      .getState()
      .days.find((day) => day.date === D1)
      ?.slots.find((one) => one.poiId === 'b');
    expect(draftB?.startAt).toBe('15:00:00');
    expect(draftIds(D1)).toContain('p1');
    const sentB = putBodies[0].days
      .find((day) => day.date === D1)
      ?.slots.find((one) => one.poiId === 'b');
    expect(sentB?.startAt).toBe('11:00:00');
  });

  it('F3 · AC-a4 — 로컬 변경이 없으면 초안이 응답으로 시드되고 토스트는 기존 문구 그대로다 (무회귀)', async () => {
    renderFlow('edit');
    await ready();
    expect(screen.queryByTestId(TOAST)).toBeNull();

    await openAdd('itinerary-edit-insert-1');
    await addPlaceAndWait('p1');

    expect(draftIds(D1)).toEqual(['a', 'b', 'p1', 'c']);
    expect(screen.getByTestId(TOAST)).toHaveTextContent(BASE_MESSAGE);
  });

  it('F4b · AC-a5 — 자기 저장이 성공하면 dirty 가 내려가 그 뒤 추가 토스트에 꼬리가 없다', async () => {
    putOverride = (n, body) =>
      n === 1
        ? HttpResponse.json(envelope(toServerDays(body, 'a')))
        : undefined;
    renderFlow('edit');
    await ready();
    fireEditDragEnd(2, 0);
    fireEvent.press(editor().getByTestId(SAVE));
    fireEvent.press(await screen.findByTestId('itinerary-edit-save-back'));
    await screen.findByTestId(
      `slot-stopcard-violation-${buildSlotKey(D1, 'a')}`
    );
    // 앵커 — 아직 추가한 적 없다(앞 테스트의 토스트가 새지 않았다).
    expect(screen.queryByTestId(TOAST)).toBeNull();

    await openAdd('itinerary-edit-insert-0');
    await addPlaceAndWait('p1');

    expect(screen.getByTestId(TOAST)).toHaveTextContent(BASE_MESSAGE);
  });

  it('F4c · AC-a5 — 저장이 실패하면 dirty 가 남아 이어진 추가에서도 로컬 변경이 보존되고 꼬리가 붙는다', async () => {
    putOverride = (n) =>
      n === 1 ? HttpResponse.json({}, { status: 500 }) : undefined;
    renderFlow('edit');
    await ready();
    fireEditDragEnd(2, 0);
    fireEvent.press(editor().getByTestId(SAVE));
    await screen.findByTestId('itinerary-edit-save-error');

    await openAdd('itinerary-edit-insert-0');
    await addPlaceAndWait('p1');

    expect(draftIds(D1)).toEqual(['c', 'p1', 'a', 'b']);
    expect(screen.getByTestId(TOAST)).toHaveTextContent(BASE_MESSAGE + TAIL);
  });

  it('F5 · AC-a6 — 변경한 채 편집기를 버리고 다시 열면 옛 변경이 되살아나지 않고 서버 일정으로 시드된다', async () => {
    // 준비 — 캐시가 살아남는 클라이언트(gcTime 무한 = 타이머 없음). 재마운트의 첫 렌더에 시드가 도는 경로를 잰다.
    const client = newTestQueryClient();
    const first = renderFlow('edit', client);
    await ready();
    fireEditDragEnd(2, 0);
    expect(draftIds(D1)).toEqual(['c', 'a', 'b']);

    // 실행 — 화면을 통째로 버리고 같은 캐시로 새로 연다.
    first.view.unmount();
    renderFlow('edit', client);

    // 단언 — 서버 순서로 시드됐다.
    await waitFor(() =>
      expect(
        (editListData() as { poiId: string }[]).map((one) => one.poiId)
      ).toEqual(['a', 'b', 'c'])
    );
    expect(draftIds(D1)).toEqual(['a', 'b', 'c']);
  });

  it('F6 · AC-a7 — 저장 안 한 변경이 있으면 추가 토스트가 "다른 수정은 저장해야 남아요" 를 말한다', async () => {
    renderFlow('edit');
    await ready();
    fireEditDragEnd(2, 0);
    // 앵커 — 추가 전엔 토스트가 없다.
    expect(screen.queryByTestId(TOAST)).toBeNull();

    await openAdd('itinerary-edit-add-place');
    await addPlaceAndWait('p1');

    const toast = screen.getByTestId(TOAST);
    expect(toast).toHaveTextContent(BASE_MESSAGE + TAIL);
    // INV-3 — 새 문구에 소요시간 표기가 없다.
    expect(toast).not.toHaveTextContent(DURATION_TEXT);
    // 편집기의 고정 안내 줄은 그대로다.
    expect(
      editor().getByTestId('itinerary-edit-add-saved-hint')
    ).toHaveTextContent('장소를 추가하면 바로 저장돼요');
  });
});
