import type { ReactNode } from 'react';
import { delay, http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

import { server } from '@/mocks/server';
import { buildSlotKey } from '@/entities/itinerary-slot/lib/slotKey';
import type {
  EditItineraryRequest,
  Itinerary,
  ItineraryDaysItem,
  SlotCandidates,
  SlotCandidatesCandidatesItem,
  SlotCandidatesRequest,
  Trip,
} from '@/shared/api/generated/schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';

import { SlotFillPage } from './SlotFillPage';

/**
 * TRIP-1073 B · h10 후보가 도착하면 첫 후보(A)를 선택 상태로 두고 버튼을 'A로 선택'으로 켠다
 * (결정 2 (a) · Figma h10 default). 반경·컨셉을 바꿔 다시 조회하면 사용자가 **직접 탭한** 후보가 새
 * 목록에 있을 때만 그 선택을 유지하고, 아니면 새 A 로 다시 잡는다(01b 열린 질문 3 글자 그대로).
 *
 * 무엇을 보장하나:
 *  - 🔴 B1·B2 아무것도 안 눌러도 A 가 선택돼 있고, 그대로 확정하면 A 로 PUT 이 나간다.
 *  - B3·B3c 탭한 후보가 새 목록에 있으면 반경(B3)·컨셉(B3c) 재조회 뒤에도 유지된다.
 *  - B3r 반경 재조회의 나머지 입구(하단 넓히기·좁히기, 0건 얼굴 넓히기)에서도 같다.
 *  - 🔴 B4·B4c 자동으로 잡힌 A 는 "고른 것"이 아니다 — 재조회 뒤 새 A 로 바뀐다(02a ★B-1).
 *  - 🔴 B5 탭한 후보가 새 목록에서 빠지면 새 A 로 바뀌고, 확정 PUT 도 새 A 다 — 목록에 없는 poiId 로
 *    PUT 이 나가지 않는다(INV-1, 02a ★B-7). 재조회 중엔 확정 버튼 자체가 없다(B5p, ★B-3).
 *  - B6 후보 0건·조회 실패·조회 중엔 선택도 확정 버튼도 없다.
 *  - 🔴 B7 생성 중(PARTIAL)이면 A 는 선택되지만 확정은 잠기고 PUT 은 0이다(TRIP-978 무회귀).
 *  - D 반경 밖 표지가 계약에 없으니 거리 문자열이 멀어 보여도 어느 카드도 흐리게 그리지 않는다.
 *
 * 3동작: 준비=MSW 응답(요청 반경·컨셉별 대본) → 실행=컨셉·반경·라디오·확정 → 단언=선택 표지·버튼·PUT 바디.
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

const mockBack = jest.fn();
const mockPush = jest.fn();
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: mockBack, replace: mockReplace }),
}));

const BASE = 'http://localhost:8080/api/v1';
const TRIP_ID = '44444444-4444-4444-4444-444444444444';
const DAY1 = '2026-06-10';
const SLOT_KEY = buildSlotKey(DAY1, 'a');
const LOCKED_TEXT = '나머지 일정을 만드는 중이에요';

const TRIP_NO_DESTINATIONS: Trip = {
  tripId: TRIP_ID,
  title: '테스트 여행',
  startDate: DAY1,
  endDate: '2026-06-11',
  party: 1,
  preferenceSnapshot: {},
  destinations: [],
  status: 'PLANNED',
  createdAt: '2026-06-01T00:00:00Z',
  updatedAt: '2026-06-01T00:00:00Z',
  baseCount: 0,
  itineraryDayCount: 1,
};

/** 같이 짜기 일정 — 1일차 비고정 [a, b]. slot a 를 채운다(다음 = b). */
function itinerary(
  generationState: Itinerary['generationState'] = 'COMPLETE'
): Itinerary {
  const days: ItineraryDaysItem[] = [
    {
      date: DAY1,
      slots: ['a', 'b'].map((poiId, i) => ({
        poiId,
        nameKo: poiId === 'a' ? '경복궁' : '북촌',
        startAt: i === 0 ? '09:30:00' : '13:00:00',
        endAt: i === 0 ? '11:00:00' : '14:00:00',
        isFixed: false,
        endsNextDay: false,
        hasViolation: false,
        alternatives: [],
        tags: [],
      })),
    },
  ];
  return {
    itineraryId: 'itin-1073',
    tripId: TRIP_ID,
    status: 'PLANNED',
    solveMode: 'FULL_AI',
    generationMode: 'CO_PLAN',
    generationState,
    isFallback: false,
    days,
  };
}

/** 후보 한 건 — 이름을 채워 둔다(이름 leaf 의 흐림 톤 판정용, D). */
function cand(
  poiId: string,
  distanceRange = '420m'
): SlotCandidatesCandidatesItem {
  return {
    poiId,
    distanceRange,
    rationale: `${poiId} 근거`,
    nameKo: `장소 ${poiId}`,
  };
}

function ok(candidates: SlotCandidatesCandidatesItem[], radiusMUsed = 1100) {
  const body: SlotCandidates = { candidates, radiusMUsed, degraded: false };
  return HttpResponse.json(body);
}

/** 후보 POST 대본 — 요청 바디(반경·컨셉)로 응답을 고른다. 테스트마다 바꿔 끼운다. */
let candidatesScript: (
  body: SlotCandidatesRequest
) => Response | Promise<Response>;
let itineraryState: Itinerary['generationState'] = 'COMPLETE';
let postCalls = 0;
let putCalls = 0;
let putBody: EditItineraryRequest | null = null;

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

beforeEach(() => {
  postCalls = 0;
  putCalls = 0;
  putBody = null;
  itineraryState = 'COMPLETE';
  mockBack.mockClear();
  mockPush.mockClear();
  mockReplace.mockClear();
  candidatesScript = () => ok([cand('X'), cand('Y'), cand('Z')]);
  setAccessToken('valid-access');

  server.use(
    http.get(`${BASE}/trips/:tripId`, () =>
      HttpResponse.json(TRIP_NO_DESTINATIONS)
    ),
    http.get(`${BASE}/trips/:tripId/itinerary`, () =>
      HttpResponse.json(itinerary(itineraryState))
    ),
    http.post(
      `${BASE}/trips/:tripId/itinerary/slot-candidates`,
      async ({ request }) => {
        postCalls += 1;
        return candidatesScript(
          (await request.json()) as SlotCandidatesRequest
        );
      }
    ),
    http.put(`${BASE}/trips/:tripId/itinerary`, async ({ request }) => {
      putCalls += 1;
      putBody = (await request.json()) as EditItineraryRequest;
      return HttpResponse.json(itinerary());
    })
  );
});

afterEach(() => {
  server.resetHandlers();
  clearAccessToken();
});

afterAll(() => server.close());

function renderPage() {
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
  return render(<SlotFillPage tripId={TRIP_ID} slotKey={SLOT_KEY} />, {
    wrapper: Wrapper,
  });
}

async function pickConcept(key = 'culture'): Promise<void> {
  fireEvent.press(await screen.findByTestId(`itinerary-copick-concept-${key}`));
}

/** 라디오의 선택 표지(호스트 accessibilityState, 02a ★B-6). */
const isSelected = (poiId: string): boolean | undefined =>
  screen.getByTestId(`itinerary-candidate-radio-${poiId}`).props
    .accessibilityState?.selected;

const confirmButton = () =>
  screen.getByTestId('itinerary-copick-slotfill-confirm');

/** "안 나갔다"는 나갈 시간을 준 뒤 센다(02a ★B-5). */
const sleep = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** 반경 near(700m)·mid(1100m)로 응답을 가르는 대본. */
function byRadius(
  mid: SlotCandidatesCandidatesItem[],
  near: SlotCandidatesCandidatesItem[] | 'never'
) {
  return async (body: SlotCandidatesRequest) => {
    if (body.radiusM === 700) {
      if (near === 'never') {
        await delay('infinite');
      }
      return ok(near === 'never' ? [] : near, 700);
    }
    return ok(mid);
  };
}

/** 컨셉 전시·문화 / 카페로 응답을 가르는 대본. */
function byConcept(
  culture: SlotCandidatesCandidatesItem[],
  cafe: SlotCandidatesCandidatesItem[]
) {
  return (body: SlotCandidatesRequest) =>
    ok(body.concept === '카페' ? cafe : culture);
}

describe('🔴 TRIP-1073 B1·B2 · 후보가 오면 A 가 선택돼 있다', () => {
  it('B1 · 아무것도 안 눌러도 첫 후보 X 가 선택이고 확정이 켜진 "A로 선택"이다', async () => {
    // 준비·실행 — 컨셉만 고른다(라디오는 건드리지 않는다).
    renderPage();
    await pickConcept();
    await screen.findByTestId('itinerary-candidate-radio-X');

    // 단언 — A 하나만 선택, 확정 활성, 라벨은 완전 일치.
    await waitFor(() => expect(isSelected('X')).toBe(true));
    expect(isSelected('Y')).toBe(false);
    expect(isSelected('Z')).toBe(false);
    expect(confirmButton().props.accessibilityState?.disabled).not.toBe(true);
    expect(confirmButton()).toHaveTextContent('A로 선택');
  });

  it('B2 · 라디오를 안 누르고 확정하면 X 로 PUT 1건이 나가고 다음 슬롯(b)으로 간다', async () => {
    renderPage();
    await pickConcept();
    await screen.findByTestId('itinerary-candidate-radio-X');
    await waitFor(() => expect(isSelected('X')).toBe(true));

    // 실행 — 확정만 누른다.
    fireEvent.press(confirmButton());

    // 단언 — 대상 슬롯(a)이 X 로 바뀐 PUT 1건 → 다음 비고정 슬롯으로 replace 1회.
    await waitFor(() => expect(putCalls).toBe(1));
    expect(putBody?.days[0].slots[0].poiId).toBe('X');
    await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
    expect(JSON.stringify(mockReplace.mock.calls[0][0])).toContain(
      buildSlotKey(DAY1, 'b')
    );
  });
});

describe('TRIP-1073 B3 · 탭한 후보가 새 목록에 있으면 유지된다', () => {
  it('🟢 B3 · Y 를 탭한 뒤 반경을 바꿔 [W, Y] 가 와도 Y 가 선택이고 "B로 선택"이다 (선제 green, ★B-2)', async () => {
    // 준비 — mid=[X,Y,Z], near=[W,Y].
    candidatesScript = byRadius(
      [cand('X'), cand('Y'), cand('Z')],
      [cand('W'), cand('Y')]
    );
    renderPage();
    await pickConcept();
    fireEvent.press(await screen.findByTestId('itinerary-candidate-radio-Y'));
    expect(confirmButton()).toHaveTextContent('B로 선택'); // 앵커 — 탭이 먹었다

    // 실행 — 반경 700m 로 다시 조회.
    fireEvent.press(screen.getByTestId('itinerary-copick-radius-seg-near'));
    await screen.findByTestId('itinerary-candidate-radio-W'); // 새 목록 도착(★B-4)

    // 단언
    await waitFor(() => expect(isSelected('Y')).toBe(true));
    expect(isSelected('W')).toBe(false);
    expect(confirmButton()).toHaveTextContent('B로 선택');
  });

  it('🔴 B3c · Y 를 탭한 뒤 컨셉을 바꿔 [W, Y] 가 와도 Y 가 선택이고 "B로 선택"이다', async () => {
    // 준비 — 전시·문화=[X,Y,Z], 카페=[W,Y].
    candidatesScript = byConcept(
      [cand('X'), cand('Y'), cand('Z')],
      [cand('W'), cand('Y')]
    );
    renderPage();
    await pickConcept('culture');
    fireEvent.press(await screen.findByTestId('itinerary-candidate-radio-Y'));
    expect(confirmButton()).toHaveTextContent('B로 선택');

    // 실행 — 결과 얼굴의 ‹(컨셉 변경) → 카페.
    fireEvent.press(screen.getByTestId('itinerary-copick-slotfill-back'));
    await pickConcept('cafe');
    await screen.findByTestId('itinerary-candidate-radio-W');

    // 단언
    await waitFor(() => expect(isSelected('Y')).toBe(true));
    expect(isSelected('W')).toBe(false);
    expect(confirmButton()).toHaveTextContent('B로 선택');
  });
});

/** 호출 순서대로 목록을 내주는 대본 — 같은 반경이 두 번 불려도 다른 목록을 줄 수 있다. 요청 반경도 적는다. */
function inOrder(
  lists: SlotCandidatesCandidatesItem[][],
  radii: (number | null | undefined)[]
) {
  return (body: SlotCandidatesRequest) => {
    radii.push(body.radiusM);
    return ok(lists[Math.min(radii.length, lists.length) - 1]);
  };
}

type RadiusEntryRow = {
  label: string;
  lists: SlotCandidatesCandidatesItem[][];
  /** Y 를 탭하기 전 — 입구 버튼이 보이는 반경 단계로 옮긴다. */
  beforeTap?: () => Promise<void>;
  /** Y 를 탭한 뒤 — 입구 버튼이 있는 얼굴로 옮긴다. */
  afterTap?: () => Promise<void>;
  entryTestID: string;
  entryLabel: string;
  radiusM: number | null;
};

// it.each = 같은 본문을 표의 행마다 한 번씩 돌린다. 입구만 다르고 기대(Y 유지)는 같아서 쓴다.
describe('TRIP-1073 B3r · 반경 재조회 입구 셋 모두에서 탭한 후보가 유지된다 (03b 경고 1)', () => {
  it.each<RadiusEntryRow>([
    {
      label: '하단바 반경 넓히기 (1.1km → 최대)',
      lists: [
        [cand('X'), cand('Y'), cand('Z')],
        [cand('W'), cand('Y')],
      ],
      entryTestID: 'itinerary-copick-slotfill-radius',
      entryLabel: '반경 넓히기',
      radiusM: null,
    },
    {
      label: '하단바 반경 좁히기 (최대 → 1.1km)',
      lists: [
        [cand('X'), cand('Y'), cand('Z')],
        [cand('V'), cand('Y'), cand('Z')],
        [cand('W'), cand('Y')],
      ],
      beforeTap: async () => {
        fireEvent.press(screen.getByTestId('itinerary-copick-radius-seg-max'));
        await screen.findByTestId('itinerary-candidate-radio-V');
      },
      entryTestID: 'itinerary-copick-slotfill-radius',
      entryLabel: '반경 좁히기',
      radiusM: 1100,
    },
    {
      label: '0건 얼굴 반경 넓히기 (700m 0건 → 1.1km)',
      lists: [[cand('X'), cand('Y'), cand('Z')], [], [cand('W'), cand('Y')]],
      afterTap: async () => {
        fireEvent.press(screen.getByTestId('itinerary-copick-radius-seg-near'));
        await screen.findByTestId('itinerary-copick-zero');
      },
      entryTestID: 'itinerary-copick-zero-radius',
      entryLabel: '반경 넓히기',
      radiusM: 1100,
    },
  ])('$label', async (row) => {
    // 준비 — 호출 순서 대본. Y 를 탭해 "직접 고른 후보"를 만들고, 입구 버튼이 있는 얼굴까지 간다.
    const radii: (number | null | undefined)[] = [];
    candidatesScript = inOrder(row.lists, radii);
    renderPage();
    await pickConcept();
    await screen.findByTestId('itinerary-candidate-radio-X');
    await row.beforeTap?.();
    fireEvent.press(screen.getByTestId('itinerary-candidate-radio-Y'));
    expect(confirmButton()).toHaveTextContent('B로 선택'); // 앵커 — 탭이 먹었다
    await row.afterTap?.();
    const entry = screen.getByTestId(row.entryTestID);
    expect(entry).toHaveTextContent(row.entryLabel); // 앵커 — 누를 버튼이 이 입구다

    // 실행 — 그 입구로 다시 조회.
    fireEvent.press(entry);
    await screen.findByTestId('itinerary-candidate-radio-W'); // 새 목록 도착(★B-4)

    // 단언 — 요청이 그 입구의 반경으로 나갔고, 새 목록 [W, Y] 에서 Y 가 유지된다.
    expect(radii[radii.length - 1]).toBe(row.radiusM);
    await waitFor(() => expect(isSelected('Y')).toBe(true));
    expect(isSelected('W')).toBe(false);
    expect(confirmButton()).toHaveTextContent('B로 선택');
  });
});

describe('🔴 TRIP-1073 B4 · 자동으로 잡힌 A 는 재조회 뒤 새 A 로 바뀐다 (★B-1)', () => {
  it('B4 · 탭 없이 반경을 바꿔 [W, X] 가 오면 옛 A(X)가 아니라 새 A(W)가 선택이다', async () => {
    // 준비 — mid=[X,Y], near=[W,X]. X 는 두 목록에 다 있다.
    candidatesScript = byRadius([cand('X'), cand('Y')], [cand('W'), cand('X')]);
    renderPage();
    await pickConcept();
    await screen.findByTestId('itinerary-candidate-radio-X');
    await waitFor(() => expect(isSelected('X')).toBe(true)); // 앵커 — 자동 A

    // 실행
    fireEvent.press(screen.getByTestId('itinerary-copick-radius-seg-near'));
    await screen.findByTestId('itinerary-candidate-radio-W');

    // 단언 — "지금 선택(자동 포함) 유지"로 구현하면 X 가 남아 red.
    await waitFor(() => expect(isSelected('W')).toBe(true));
    expect(isSelected('X')).toBe(false);
    expect(confirmButton()).toHaveTextContent('A로 선택');
  });

  it('B4c · 탭 없이 컨셉을 바꿔 [W, X] 가 와도 새 A(W)가 선택이다', async () => {
    candidatesScript = byConcept(
      [cand('X'), cand('Y')],
      [cand('W'), cand('X')]
    );
    renderPage();
    await pickConcept('culture');
    await screen.findByTestId('itinerary-candidate-radio-X');
    await waitFor(() => expect(isSelected('X')).toBe(true));

    fireEvent.press(screen.getByTestId('itinerary-copick-slotfill-back'));
    await pickConcept('cafe');
    await screen.findByTestId('itinerary-candidate-radio-W');

    await waitFor(() => expect(isSelected('W')).toBe(true));
    expect(isSelected('X')).toBe(false);
  });
});

describe('🔴 TRIP-1073 B5 · 목록에 없는 후보로 확정되지 않는다 (INV-1)', () => {
  it('B5 · 탭한 Y 가 새 목록 [W, X] 에서 빠지면 W 가 선택되고 확정 PUT 도 W 다', async () => {
    // 준비 — mid=[X,Y,Z], near=[W,X]. Y 는 새 목록에 없다.
    candidatesScript = byRadius(
      [cand('X'), cand('Y'), cand('Z')],
      [cand('W'), cand('X')]
    );
    renderPage();
    await pickConcept();
    fireEvent.press(await screen.findByTestId('itinerary-candidate-radio-Y'));
    expect(confirmButton()).toHaveTextContent('B로 선택');

    // 실행 — 반경을 바꾸고, 새 목록에서 확정.
    fireEvent.press(screen.getByTestId('itinerary-copick-radius-seg-near'));
    await screen.findByTestId('itinerary-candidate-radio-W');
    await waitFor(() => expect(isSelected('W')).toBe(true));
    expect(confirmButton()).toHaveTextContent('A로 선택');
    fireEvent.press(confirmButton());

    // 단언 — 화면 라벨이 아니라 PUT 바디가 최종 증거다(★B-7). 지금 코드는 Y 로 나간다.
    await waitFor(() => expect(putCalls).toBe(1));
    expect(putBody?.days[0].slots[0].poiId).toBe('W');
  });

  it('🟢 B5p · 재조회 중(목록 비움)엔 라디오도 확정 버튼도 없다 (선제 green, ★B-3)', async () => {
    // 준비 — near 응답은 영원히 안 온다.
    candidatesScript = byRadius([cand('X'), cand('Y'), cand('Z')], 'never');
    renderPage();
    await pickConcept();
    fireEvent.press(await screen.findByTestId('itinerary-candidate-radio-Y'));
    expect(confirmButton()).toBeOnTheScreen(); // 앵커 — 조회 전엔 있었다

    // 실행
    fireEvent.press(screen.getByTestId('itinerary-copick-radius-seg-near'));
    await waitFor(() => expect(postCalls).toBe(2));

    // 단언 — 누를 버튼 자체가 없으니 옛 Y 로 PUT 이 나갈 길이 없다.
    expect(
      screen.getByTestId('itinerary-copick-slotfill-root')
    ).toBeOnTheScreen();
    expect(screen.queryAllByTestId(/^itinerary-candidate-radio-/)).toHaveLength(
      0
    );
    expect(
      screen.queryByTestId('itinerary-copick-slotfill-confirm')
    ).toBeNull();
    expect(putCalls).toBe(0);
  });
});

describe('🟢 TRIP-1073 B6 · 후보가 없으면 선택도 확정 버튼도 없다 (선제 green)', () => {
  it.each<[string, () => Response | Promise<Response>, string]>([
    ['후보 0건', () => ok([]), 'itinerary-copick-zero'],
    [
      '조회 실패(500)',
      () =>
        HttpResponse.json(
          { error: { code: 'X', message: 'x' } },
          { status: 500 }
        ),
      'itinerary-copick-candidates-error',
    ],
    [
      '조회 중',
      async () => {
        await delay('infinite');
        return ok([cand('X')]);
      },
      'itinerary-copick-slotfill-root',
    ],
  ])('%s', async (_label, respond, faceTestID) => {
    // 준비
    candidatesScript = respond;

    // 실행
    renderPage();
    await pickConcept();
    await waitFor(() => expect(postCalls).toBe(1));

    // 단언 — 그 얼굴이 떴다(긍정 앵커) + 선택·확정 0.
    expect(await screen.findByTestId(faceTestID)).toBeOnTheScreen();
    expect(screen.queryAllByTestId(/^itinerary-candidate-radio-/)).toHaveLength(
      0
    );
    expect(
      screen.queryByTestId('itinerary-copick-slotfill-confirm')
    ).toBeNull();
  });
});

describe('🔴 TRIP-1073 B7 · 생성 중(PARTIAL)이면 A 는 선택되지만 확정은 잠긴다 (TRIP-978 무회귀)', () => {
  it('X 가 선택이어도 확정은 비활성이고 잠금 사유가 보이며 눌러도 PUT 0 이다', async () => {
    // 준비 — 일정이 생성 중이고 후보는 X 하나.
    itineraryState = 'PARTIAL';
    candidatesScript = () => ok([cand('X')]);
    renderPage();
    await pickConcept();
    await screen.findByTestId('itinerary-candidate-radio-X');

    // 단언 ① 자동 A.
    await waitFor(() => expect(isSelected('X')).toBe(true));
    // 단언 ② 잠금.
    expect(confirmButton().props.accessibilityState?.disabled).toBe(true);
    expect(
      screen.getByTestId('itinerary-copick-confirm-locked')
    ).toHaveTextContent(LOCKED_TEXT);

    // 실행 — 그래도 눌러 본다.
    fireEvent.press(confirmButton());
    await sleep(50);

    // 단언 ③ PUT·이동 0.
    expect(putCalls).toBe(0);
    expect(mockReplace).toHaveBeenCalledTimes(0);
  });
});

/** className 을 공백으로 쪼갠 토큰 — `text-muted-soft` 같은 부분 일치 오탐을 막는다(★D-1). */
const classTokens = (testID: string): string[] =>
  String(screen.getByTestId(testID).props.className ?? '').split(/\s+/);

describe('🟢 TRIP-1073 D · 반경 밖 표지가 없으면 어느 카드도 흐리지 않다 (선제 green)', () => {
  it('거리 문자열이 "약 9.9km" 여도 이름 글자는 흐림 톤(text-muted)이 아니라 기본 톤(text-ink)이다', async () => {
    // 준비 — 계약엔 반경 밖 표지·숫자 거리가 없다. 문자열만 멀어 보인다.
    candidatesScript = () => ok([cand('X', '420m'), cand('D', '약 9.9km')]);

    // 실행
    renderPage();
    await pickConcept();
    await screen.findByTestId('itinerary-candidate-radio-D');

    // 단언 — distanceRange 를 파싱해 흐림을 지어내면 red.
    for (const id of ['X', 'D']) {
      const tokens = classTokens(`itinerary-candidate-name-${id}`);
      expect(tokens).toContain('text-ink');
      expect(tokens).not.toContain('text-muted');
    }
  });
});
