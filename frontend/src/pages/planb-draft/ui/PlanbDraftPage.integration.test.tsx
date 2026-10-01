import { act, fireEvent, render, screen } from '@testing-library/react-native';

import type { Itinerary, ReplanDiff } from '@/shared/api/generated/schemas';

import { PlanbDraftPage } from './PlanbDraftPage';

/**
 * TRIP-751 · AC-9·AC-10 · E1·E3·E4 · Seed Q6·Q7·Q8 — i06 재계획안 페이지 배선판.
 * TRIP-1007 — DRAFT 의 빈 시트를 서버 초안(`GET …/diff`)으로 채운다(D1~D5).
 *
 * 무엇을 보장하나(세션 판정 1회 → 같은 뷰의 세 상태):
 *  - DRAFT → 초안(`after`) 순서대로 행을 그리고 [직접 수정]/[적용하기]. 초안이 아직 없거나(로딩·
 *    ready=false) 조회가 실패하면 안내를 띄우고 [적용하기]를 잠근다(TRIP-1007 — 옛 "제목만" 계약 반전).
 *  - [적용하기] → 확정 seam `useApplyReplan().mutate({tripId, sessionId}, { onSuccess })` 1회(E1 — diff
 *    확인 페이지를 거치지 않는다). onSuccess → 허브로 `router.replace` + `applied=sessionId`(Q7).
 *  - 확정 요청 중이면 [적용하기] 잠금, 실패면 같은 안내 자리에 "변경을 반영하지 못했어요"(Q6).
 *  - NO_SOLUTION·FAILED → 같은 뷰의 안내 상태. FAILED 에서 옛 manual?variant=error push 는 없다(E3).
 *    [조건 바꿔 다시 짜기]/[다시 시도] → i04(`/trips/{id}/planb`), [직접 수정] → planb/manual.
 *  - SOLVING·closed·미도착 → 아무것도 안 그린다.
 *
 * ★ 뷰를 스텁하지 않고 실제로 그린다(02a ★6) — 잠금·실패 안내를 렌더 결과로 본다. 시트·지도는
 *   루트 `__mocks__` 통과형 목이 받는다.
 * ★ jest.mock 팩토리는 파일 맨 위로 끌어올려져 바깥 변수를 못 본다(이름이 mock 으로 시작하는 것만
 *   예외). 그래서 세션·seam 상태를 mock 접두 홀더에 담고 목이 렌더 때 지연 읽기 한다.
 */

// TRIP-919 — 셸이 지도 실패(jest 엔 env 키가 없다)를 받으면 자기 폴백 바의 [다시 시도]를 띄워, 이 뷰의
// [다시 시도]와 `getByText` 가 두 개로 겹친다. 이 파일의 관심사는 지도가 아니라 뷰 액션이라 얇은 관찰
// 마커로 바꾼다(실패를 발화하지 않는다 — 페이지 통합 테스트 관례).
jest.mock('@/shared/map', () => require('@/test-support/mapViewMock'));

const TRIP_ID = 't1';
const SESSION_ID = 's9';

const mockSession: { data: Record<string, unknown> | undefined } = {
  data: undefined,
};
jest.mock('@/features/planb/model/useReplanSession', () => ({
  useReplanSession: () => ({
    data: mockSession.data,
    isPending: mockSession.data === undefined,
    isError: false,
  }),
}));

const mockMutate = jest.fn();
const mockApply = { isPending: false, isError: false };
jest.mock('@/features/planb/model/useApplyReplan', () => ({
  useApplyReplan: () => ({
    mutate: mockMutate,
    isPending: mockApply.isPending,
    isError: mockApply.isError,
  }),
}));

// TRIP-979 B — 출발 좌표 없는 세션의 지도 중심을 일정에서 고르려고 페이지가 일정을 읽는다.
// 기본은 미도착(undefined) — 기존 케이스는 세션 좌표가 있어 일정과 무관하다.
let mockItinerary: Itinerary | undefined;
jest.mock('@/features/execution/model/useLiveItinerary', () => ({
  useLiveItinerary: () => ({
    data: mockItinerary,
    isPending: mockItinerary === undefined,
    isError: false,
  }),
}));

// TRIP-1007 — 서버 초안 조회 seam. 기본은 "초안 도착"(beforeEach) — 적용·잠금 회귀 테스트가 활성
// [적용하기]를 전제로 하기 때문이다(02a ★8).
// 5-b 차단-1 — 목이 호출 인자를 기록하고(D6·P6~P8 이 단언), 꺼진 조회에는 데이터를 주지 않는다.
// 실제 react-query 에서 enabled:false 쿼리는 요청을 안 보내 data undefined·isPending true 로 머문다 —
// 이걸 흉내내지 않으면 대안 없음·실패 테스트가 실제로는 나올 수 없는 "초안 행이 섞인" 화면을 판정한다.
const mockDiff: {
  state: 'ok' | 'pending' | 'error';
  data: ReplanDiff | undefined;
  calls: [string, string, { enabled?: boolean } | undefined][];
} = { state: 'ok', data: undefined, calls: [] };
jest.mock('@/features/planb/model/useReplanDiff', () => ({
  useReplanDiff: (
    tripId: string,
    sessionId: string,
    options?: { enabled?: boolean }
  ) => {
    mockDiff.calls.push([tripId, sessionId, options]);
    if ((options?.enabled ?? true) === false || mockDiff.state === 'pending') {
      return { data: undefined, isPending: true, isError: false };
    }
    return mockDiff.state === 'error'
      ? { data: undefined, isPending: false, isError: true }
      : { data: mockDiff.data, isPending: false, isError: false };
  },
}));

const mockPush = jest.fn();
const mockBack = jest.fn();
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: mockBack, replace: mockReplace }),
}));

function session(
  status: string,
  over: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    sessionId: SESSION_ID,
    tripId: TRIP_ID,
    itineraryId: 'it1',
    scope: 'PARTIAL_SLOTS',
    fromInstant: '2026-06-11T06:00:00Z',
    originKind: 'GPS',
    originLat: 35.1587,
    originLng: 129.1604,
    originEstimated: false,
    status,
    createdAt: '2026-06-11T05:59:00Z',
    ...over,
  };
}

// ── TRIP-1007 픽스처 ─────────────────────────────────────────────────────────────────────────
const DAY = '2026-06-11';
const key = (poiId: string) => `${DAY}#${poiId}`;

const cachedSlot = (poiId: string, nameKo: string, startAt: string) => ({
  poiId,
  nameKo,
  startAt,
  endAt: '18:00:00',
  isFixed: false,
  endsNextDay: false,
  hasViolation: false,
  tags: [],
  imageUrl: null,
  // 라이브 캐시의 거리는 "옛 순서의 바로 앞 슬롯"에서 잰 값이라 초안 행에 쓰면 거짓이다(01 맹점①).
  distanceRange: '9.9km',
  lat: null,
  lng: null,
});

/** 라이브 일정 — 6/11 이 2일차. px 는 여기 없다(이름 폴백 · 02a ★3). */
const DRAFT_ITINERARY = {
  itineraryId: 'it1',
  tripId: TRIP_ID,
  status: 'CONFIRMED',
  solveMode: 'FULL',
  generationMode: 'AI',
  isFallback: false,
  generationState: 'COMPLETE',
  days: [
    {
      date: '2026-06-10',
      slots: [cachedSlot('p0', '태종대', '10:00:00')],
    },
    {
      date: DAY,
      slots: [
        cachedSlot('p1', '감천문화마을', '09:30:00'),
        cachedSlot('p2', '광안리 해변', '11:00:00'),
        cachedSlot('p3', '부산시립미술관', '13:00:00'),
        cachedSlot('p4', '디키디키', '15:00:00'),
      ],
    },
  ],
} as unknown as Itinerary;

const diffSlot = (poiId: string, startAt: string, endAt: string) => ({
  slotKey: key(poiId),
  startAt,
  endAt,
  isFixed: false,
  endsNextDay: false,
});

/**
 * 서버 초안. 시각은 초까지 온다(서버 LocalTime — 02a ★2). entries 는 일부러 순서를 뒤섞었다 —
 * REMOVED 가 맨 앞, 나머지는 after 역순. 행 순서의 정본은 `after` 다(02a ★1).
 * `returnTimeDeltaMinutes` 는 소요시간 표기를 유혹하는 값이다(D4).
 */
const READY_DIFF: ReplanDiff = {
  ready: true,
  status: 'DRAFT',
  date: DAY,
  before: [
    diffSlot('p1', '09:30:00', '10:30:00'),
    diffSlot('p2', '11:00:00', '12:00:00'),
    diffSlot('p3', '13:00:00', '14:30:00'),
    diffSlot('p4', '15:00:00', '16:30:00'),
  ],
  after: [
    diffSlot('p1', '09:30:00', '10:30:00'),
    diffSlot('p3', '11:00:00', '12:30:00'),
    diffSlot('px', '13:10:00', '14:00:00'),
    diffSlot('p2', '15:00:00', '16:00:00'),
  ],
  entries: [
    {
      slotKey: key('p4'),
      change: 'REMOVED',
      beforeStart: '15:00:00',
      afterStart: null,
    },
    {
      slotKey: key('p2'),
      change: 'MOVED',
      beforeStart: '11:00:00',
      afterStart: '15:00:00',
    },
    {
      slotKey: key('px'),
      change: 'ADDED',
      beforeStart: null,
      afterStart: '13:10:00',
    },
    {
      slotKey: key('p3'),
      change: 'MOVED',
      beforeStart: '13:00:00',
      afterStart: '11:00:00',
    },
    {
      slotKey: key('p1'),
      change: 'UNCHANGED',
      beforeStart: '09:30:00',
      afterStart: '09:30:00',
    },
  ],
  impact: {
    visitCountDelta: 0,
    returnTimeDeltaMinutes: 30,
    totalDistanceDeltaM: null,
    totalDistanceKm: 6.3,
  },
};

/** 초안이 아직 없을 때 서버는 404 가 아니라 ready=false 로 비워서 준다(openapi /diff). */
const NOT_READY_DIFF: ReplanDiff = {
  ready: false,
  status: 'DRAFT',
  date: null,
  before: [],
  after: [],
  entries: [],
  impact: null,
};

/** INV-3 표기 탐지기(planbReplanDraftStructure G3 와 같은 정규식). */
const DURATION_TEXT = /(\d+\s*분|\d+\s*시간|소요)/;

function textsOf(pattern: RegExp): string[] {
  return screen
    .queryAllByTestId(pattern)
    .map((node) => String(node.props.children));
}

function renderDraft(diff: ReplanDiff = READY_DIFF) {
  mockItinerary = DRAFT_ITINERARY;
  mockSession.data = session('DRAFT');
  mockDiff.data = diff;
  renderPage();
}

const MANUAL_HREF = {
  pathname: '/trips/[tripId]/planb/manual',
  params: { tripId: TRIP_ID },
};
const REQUEST_HREF = `/trips/${TRIP_ID}/planb`;

beforeEach(() => {
  mockPush.mockClear();
  mockBack.mockClear();
  mockReplace.mockClear();
  mockMutate.mockClear();
  mockApply.isPending = false;
  mockApply.isError = false;
  mockSession.data = undefined;
  mockItinerary = undefined;
  mockDiff.state = 'ok';
  mockDiff.data = READY_DIFF;
  mockDiff.calls = [];
});

/** 페이지가 초안 seam 을 마지막으로 부른 인자. 호출이 0 이면 undefined 라 단언이 공허하게 통과하지 않는다. */
function lastDiffCall() {
  return mockDiff.calls[mockDiff.calls.length - 1];
}

/** 이 얼굴에서는 조회가 한 번도 켜지지 않았다 — 호출은 있었고(앵커), 전부 enabled:false 다. */
function expectDiffNeverEnabled() {
  expect(mockDiff.calls.length).toBeGreaterThan(0);
  for (const [tripId, sessionId, options] of mockDiff.calls) {
    expect([tripId, sessionId]).toEqual([TRIP_ID, SESSION_ID]);
    expect(options).toEqual({ enabled: false });
  }
}

function renderPage() {
  render(<PlanbDraftPage tripId={TRIP_ID} sessionId={SESSION_ID} />);
}

// TRIP-1007 — 옛 P1("DRAFT 는 제목만: 곳 수 빈칸·행 없음")은 QA #061 의 버그(빈 시트 + 활성 [적용하기])를
// 계약으로 굳혀 두었던 테스트라 D1~D5 로 교체했다. 버튼 두 개·렌더만으로 라우터·확정 0 은 D1 이 이어받는다.

describe('🔴 D1 · TRIP-1007 AC-1·AC-4 · US-PLANB-08 · INV-2 — 초안 행은 after 순서, 시각은 서버 값을 잘라 쓴다', () => {
  it('이름은 [감천문화마을, 부산시립미술관, 이름 준비 중, 광안리 해변], 시각은 HH:mm–HH:mm, 전부 예정 톤, 커넥터 없음', () => {
    renderDraft();

    // after 순서(entries 순서도, 원 일정 순서도 아니다). px 는 캐시에 없어 폴백 — poiId 를 이름으로 쓰지 않는다.
    expect(textsOf(/^planb-draft-slot-name-/)).toEqual([
      '감천문화마을',
      '부산시립미술관',
      '이름 준비 중',
      '광안리 해변',
    ]);
    // 초까지 온 서버 시각을 분까지만 잘라 쓴다 — 다시 계산하지 않는다(INV-2).
    const times = screen.getAllByTestId(/^planb-draft-slot-time-/);
    expect(times).toHaveLength(4);
    expect(times[0]).toHaveTextContent('09:30–10:30');
    expect(times[1]).toHaveTextContent('11:00–12:30');
    expect(times[2]).toHaveTextContent('13:10–14:00');
    expect(times[3]).toHaveTextContent('15:00–16:00');
    // diff 엔 방문 여부가 없다 — 전 행 예정 톤(Seed Q6).
    const numbers = screen.getAllByTestId(/^planb-draft-slot-number-/);
    expect(numbers).toHaveLength(4);
    numbers.forEach((node) =>
      expect(String(node.props.className).split(/\s+/)).toContain('bg-primary')
    );
    // 행 사이 거리는 계약에 없다 — 캐시의 옛 순서 거리(9.9km)도, "계산 중"도 그리지 않는다(Seed Q2).
    expect(screen.queryAllByTestId(/^sheet-connector-/)).toHaveLength(0);

    expect(screen.getByTestId('sheet-cta-button-0')).toHaveTextContent(
      '직접 수정'
    );
    expect(screen.getByTestId('sheet-cta-button-1')).toHaveTextContent(
      '적용하기'
    );
    expect(screen.getByTestId('sheet-cta-button-1')).not.toBeDisabled();
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockMutate).not.toHaveBeenCalled();
  });
});

describe('🔴 D2 · TRIP-1007 AC-6 — 헤더는 일차·날짜·{곳 수} · {총거리}km', () => {
  it('diff date 가 일정의 두 번째 날이면 2일차 · 6월 11일(목), meta 는 4곳 · 6.3km', () => {
    renderDraft();

    expect(screen.getByTestId('sheet-header-title')).toHaveTextContent(
      'AI 재계획안'
    );
    expect(screen.getByTestId('sheet-header-day')).toHaveTextContent('2일차');
    expect(screen.getByTestId('sheet-header-date')).toHaveTextContent(
      '6월 11일(목)'
    );
    expect(screen.getByTestId('sheet-header-meta')).toHaveTextContent(
      '4곳 · 6.3km'
    );
  });

  it.each([
    [
      'totalDistanceKm 이 null',
      {
        visitCountDelta: 0,
        returnTimeDeltaMinutes: 30,
        totalDistanceDeltaM: null,
        totalDistanceKm: null,
      },
    ],
    ['impact 자체가 null', null],
  ])('%s 이면 meta 는 곳 수만(0km 로 채우지 않는다)', (_label, impact) => {
    renderDraft({ ...READY_DIFF, impact });

    // 완전 일치 — "4곳 · 0km"·"4곳 · km" 가 여기서 red 다(02a ★7).
    expect(screen.getByTestId('sheet-header-meta')).toHaveTextContent('4곳');
  });
});

describe('🔴 D3 · TRIP-1007 AC-3 · BR-U4-25 — 빠지는 곳은 확정 전에 따로 보인다', () => {
  it('"이번 계획에서 빠지는 곳 1" 아래 디키디키 · 원래 15:00, 초안 행(번호 원)으로는 그리지 않는다', () => {
    renderDraft();

    expect(screen.getByText('이번 계획에서 빠지는 곳 1')).toBeOnTheScreen();
    const removed = screen.getByTestId(`planb-draft-removed-${key('p4')}`);
    expect(removed).toHaveTextContent(/디키디키/);
    expect(removed).toHaveTextContent(/원래 15:00/);
    expect(screen.queryAllByTestId(/^planb-draft-removed-/)).toHaveLength(1);

    // 초안 행과 구분 — 같은 키의 초안 행·번호 원이 없고, 초안 이름 목록에도 없다.
    expect(screen.queryByTestId(`planb-draft-slot-${key('p4')}`)).toBeNull();
    expect(textsOf(/^planb-draft-slot-name-/)).not.toContain('디키디키');
  });

  it('REMOVED 가 없으면 빠지는 곳 영역을 그리지 않는다', () => {
    renderDraft({
      ...READY_DIFF,
      entries: READY_DIFF.entries.filter((entry) => entry.change !== 'REMOVED'),
    });

    expect(screen.queryAllByTestId(/^planb-draft-removed-/)).toHaveLength(0);
    expect(screen.queryAllByText(/빠지는 곳/)).toHaveLength(0);
    expect(textsOf(/^planb-draft-slot-name-/)).toHaveLength(4);
  });
});

describe('🔴 D4 · TRIP-1007 AC-5 · INV-3 — 초안 화면 어디에도 소요시간 표기가 없다', () => {
  it('복귀 +30분 값이 와도 화면 글자에 N분·N시간·소요가 0건이다(+ 탐지기가 실제 글자를 본다는 앵커)', () => {
    renderDraft();

    // 앵커 — 같은 쿼리가 행 시각을 실제로 잡는다(빈 화면에서 공허하게 통과하지 않게).
    expect(screen.queryAllByText(/09:30–10:30/)).toHaveLength(1);
    // 한 Text 의 자식을 이어 붙여 판정한다 — {30}{'분'} 처럼 쪼개 써도 잡힌다(02a ★5).
    expect(screen.queryAllByText(DURATION_TEXT)).toHaveLength(0);
  });
});

describe('🔴 D5 · TRIP-1007 AC-2 · INV-4 — 초안이 안 왔거나 못 불러오면 안내 + [적용하기] 잠금', () => {
  it.each([
    ['조회 중', 'pending', undefined, '재계획안을 불러오는 중이에요'],
    [
      'ready=false(아직 산출 전)',
      'ok',
      NOT_READY_DIFF,
      '재계획안을 불러오는 중이에요',
    ],
    ['조회 실패', 'error', undefined, '재계획안을 불러오지 못했어요'],
  ] as const)(
    '%s — 안내 제목이 뜨고, 행이 없고, [적용하기]는 disabled 라 눌러도 확정 0회',
    (_label, state, diff, title) => {
      mockItinerary = DRAFT_ITINERARY;
      mockSession.data = session('DRAFT');
      mockDiff.state = state;
      mockDiff.data = diff;
      renderPage();

      expect(screen.getByTestId('planb-draft-notice-title')).toHaveTextContent(
        title
      );
      expect(screen.queryAllByTestId(/^planb-draft-slot-name-/)).toHaveLength(
        0
      );
      const apply = screen.getByTestId('sheet-cta-button-1');
      expect(apply).toHaveTextContent('적용하기');
      expect(apply).toBeDisabled();
      fireEvent.press(apply);
      expect(mockMutate).not.toHaveBeenCalled();
    }
  );

  it('조회 실패의 설명은 "잠시 후 다시 시도해 주세요"', () => {
    mockItinerary = DRAFT_ITINERARY;
    mockSession.data = session('DRAFT');
    mockDiff.state = 'error';
    renderPage();

    expect(
      screen.getByTestId('planb-draft-notice-description')
    ).toHaveTextContent('잠시 후 다시 시도해 주세요');
  });
});

describe('🔴 D6 · TRIP-1007 AC-1 · 5-b 차단-1 — 초안 얼굴은 이 세션의 diff 를 켜서 조회한다', () => {
  it('DRAFT 면 seam 을 (tripId, sessionId, { enabled: true }) 순서로 부른다', () => {
    renderDraft();

    // 앵커 — 초안이 실제로 그려졌다(가짜가 enabled 를 존중하므로 꺼졌으면 행이 0 이다).
    expect(screen.queryAllByTestId(/^planb-draft-slot-name-/)).toHaveLength(4);
    expect(lastDiffCall()).toEqual([TRIP_ID, SESSION_ID, { enabled: true }]);
  });
});

describe('🔴 P2·P3 · AC-9(b)(c) · E1·Q7 — [적용하기]는 바로 확정하고 성공하면 허브로 바꿔 끼운다', () => {
  it('누르면 seam mutate 가 {tripId, sessionId} + onSuccess 로 1회, diff 로 가는 push 는 없다', () => {
    mockSession.data = session('DRAFT');
    renderPage();

    fireEvent.press(screen.getByText('적용하기'));

    expect(mockMutate).toHaveBeenCalledTimes(1);
    expect(mockMutate).toHaveBeenCalledWith(
      { tripId: TRIP_ID, sessionId: SESSION_ID },
      expect.objectContaining({ onSuccess: expect.any(Function) })
    );
    expect(mockPush).not.toHaveBeenCalled();
    // 5-b 차단-1 — 성공 콜백 전에는 이동하지 않는다(P3 와 짝: "성공 뒤에만" replace).
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('onSuccess 가 불리면 router.replace 가 허브 + applied=sessionId 로 1회', () => {
    mockSession.data = session('DRAFT');
    renderPage();
    fireEvent.press(screen.getByText('적용하기'));

    const options = mockMutate.mock.calls[0]?.[1] as { onSuccess: () => void };
    act(() => options.onSuccess());

    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith({
      pathname: '/trips/[tripId]/live',
      params: { tripId: TRIP_ID, applied: SESSION_ID },
    });
    expect(mockPush).not.toHaveBeenCalled();
  });
});

describe('🔴 P4 · AC-9(d) — 확정 요청 중에는 [적용하기]가 잠긴다', () => {
  it('seam isPending 이면 버튼이 disabled 이고 눌러도 mutate 가 안 불린다(이중 POST → 409 차단)', () => {
    mockSession.data = session('DRAFT');
    mockApply.isPending = true;
    renderPage();

    const apply = screen.getByTestId('sheet-cta-button-1');
    expect(apply).toHaveTextContent('적용하기');
    expect(apply).toBeDisabled();
    fireEvent.press(apply);
    expect(mockMutate).not.toHaveBeenCalled();
  });
});

describe('🔴 P4b · 5-b 경고-1 — 확정 요청 중에는 [직접 수정]도 잠긴다(교차 잠금)', () => {
  it('seam isPending 이면 [직접 수정]이 disabled 이고 눌러도 push 가 없다(밑에 남은 초안의 onSuccess 가 편집 화면을 갈아 끼우는 경로 차단)', () => {
    mockSession.data = session('DRAFT');
    mockApply.isPending = true;
    renderPage();

    const manual = screen.getByTestId('sheet-cta-button-0');
    expect(manual).toHaveTextContent('직접 수정');
    expect(manual).toBeDisabled();
    fireEvent.press(manual);
    expect(mockPush).not.toHaveBeenCalled();
  });
});

describe('🔴 P5 · AC-9(e) · Q6 — 확정 실패는 같은 안내 자리에', () => {
  it('seam isError 면 실패 안내가 뜨고 replace 는 없으며, [적용하기]가 그대로 재시도다', () => {
    mockSession.data = session('DRAFT');
    mockApply.isError = true;
    renderPage();

    expect(screen.getByTestId('planb-draft-notice-title')).toHaveTextContent(
      '변경을 반영하지 못했어요'
    );
    expect(
      screen.getByTestId('planb-draft-notice-description')
    ).toHaveTextContent(
      '원래 일정은 그대로 있어요. 잠시 후 다시 시도해 주세요.'
    );
    expect(mockReplace).not.toHaveBeenCalled();

    fireEvent.press(screen.getByText('적용하기'));
    expect(mockMutate).toHaveBeenCalledTimes(1);
    // 5-b 차단-1 — 재시도를 눌러도 성공 전에는 이동하지 않는다.
    expect(mockReplace).not.toHaveBeenCalled();
  });
});

describe('🔴 P6 · AC-10 · Q4 — NO_SOLUTION 은 같은 뷰의 대안 없음 상태', () => {
  it('안내 2줄(사유를 지어내지 않는 뒤 절만), 렌더만으로 push 0, 두 버튼이 i04·manual 로 간다', () => {
    mockSession.data = session('NO_SOLUTION');
    renderPage();

    expect(screen.getByTestId('planb-draft-notice-title')).toHaveTextContent(
      '대안을 찾지 못했어요'
    );
    expect(
      screen.getByTestId('planb-draft-notice-description')
    ).toHaveTextContent('조건을 줄이거나 직접 고쳐 주세요');
    expect(mockPush).not.toHaveBeenCalled();
    // 5-b 차단-1 — 대안 없음 얼굴에서는 초안을 조회하지 않고, 그래서 초안 행도 없다.
    expectDiffNeverEnabled();
    expect(screen.queryAllByTestId(/^planb-draft-slot-name-/)).toHaveLength(0);

    fireEvent.press(screen.getByText('조건 바꿔 다시 짜기'));
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenLastCalledWith(REQUEST_HREF);

    fireEvent.press(screen.getByText('직접 수정'));
    expect(mockPush).toHaveBeenCalledTimes(2);
    expect(mockPush).toHaveBeenLastCalledWith(MANUAL_HREF);
    expect(mockMutate).not.toHaveBeenCalled();
  });
});

describe('🔴 P7 · AC-10 · E3 — FAILED 도 같은 뷰에 착지한다(옛 variant=error push 반전)', () => {
  it('안내 "다시 짜지 못했어요", 렌더만으로 push 0, [다시 시도]→i04 · [직접 수정]→manual(variant 없음)', () => {
    mockSession.data = session('FAILED');
    renderPage();

    expect(screen.getByTestId('planb-draft-notice-title')).toHaveTextContent(
      '다시 짜지 못했어요'
    );
    expect(
      screen.getByTestId('planb-draft-notice-description')
    ).toHaveTextContent('잠시 후 다시 시도하거나 직접 고쳐 주세요');
    expect(mockPush).not.toHaveBeenCalled();
    // 5-b 차단-1 — 실패 얼굴에서도 초안 조회는 꺼져 있고 초안 행이 없다.
    expectDiffNeverEnabled();
    expect(screen.queryAllByTestId(/^planb-draft-slot-name-/)).toHaveLength(0);

    fireEvent.press(screen.getByText('다시 시도'));
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenLastCalledWith(REQUEST_HREF);

    fireEvent.press(screen.getByText('직접 수정'));
    expect(mockPush).toHaveBeenCalledTimes(2);
    expect(mockPush).toHaveBeenLastCalledWith(MANUAL_HREF);
  });
});

describe('🔴 P8 · AC-10 — SOLVING·closed·미도착은 아무것도 그리지 않는다', () => {
  it.each([['SOLVING'], ['APPLIED'], ['CANCELED']])(
    '%s 이면 렌더 없음 + 라우터·확정 호출 0',
    (status) => {
      mockSession.data = session(status);
      renderPage();

      expect(screen.toJSON()).toBeNull();
      expect(mockPush).not.toHaveBeenCalled();
      expect(mockReplace).not.toHaveBeenCalled();
      expect(mockMutate).not.toHaveBeenCalled();
      expectDiffNeverEnabled();
    }
  );

  it('세션 미도착(data undefined)이면 렌더 없음 + 라우터 호출 0', () => {
    renderPage();

    expect(screen.toJSON()).toBeNull();
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
    expectDiffNeverEnabled();
  });
});

describe('🔴 P9 · Q8 — 뒤로가기', () => {
  it('지도 위 뒤로가기는 router.back 을 1회 부른다', () => {
    mockSession.data = session('DRAFT');
    renderPage();

    fireEvent.press(screen.getByTestId('sheet-daychip-back'));
    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockPush).not.toHaveBeenCalled();
  });
});

// ── TRIP-979 B · AC-B4 — 세션 좌표가 없으면 지도 중심을 이 여행에서 고른다(부산 상수 제거) ──────────

const seoulSlot = (
  poiId: string,
  nameKo: string,
  coords: { lat: number; lng: number } | null
) => ({
  poiId,
  nameKo,
  startAt: '10:00:00',
  endAt: '11:00:00',
  isFixed: false,
  endsNextDay: false,
  hasViolation: false,
  tags: [],
  lat: coords?.lat ?? null,
  lng: coords?.lng ?? null,
});

// fromInstant '2026-06-11T06:00:00Z' = KST 6/11 15시. 그날 첫 슬롯은 좌표가 없고 그 뒤가 경복궁,
// 일정 전체 첫 좌표는 남산(6/10).
const SEOUL_ITINERARY = {
  itineraryId: 'it1',
  tripId: TRIP_ID,
  status: 'CONFIRMED',
  solveMode: 'FULL',
  generationMode: 'AI',
  isFallback: false,
  generationState: 'COMPLETE',
  days: [
    {
      date: '2026-06-10',
      slots: [seoulSlot('s0', '남산서울타워', { lat: 37.5512, lng: 126.9882 })],
    },
    {
      date: '2026-06-11',
      slots: [
        seoulSlot('s1', '좌표 없는 곳', null),
        seoulSlot('s2', '경복궁', { lat: 37.5796, lng: 126.977 }),
      ],
    },
  ],
} as unknown as Itinerary;

const NO_ORIGIN = {
  originKind: 'STAY_ANCHOR',
  originLat: null,
  originLng: null,
  originEstimated: true,
};

describe('🔴 B4 · AC-B4 · Q5 — 출발 좌표 없는 세션의 지도 중심은 여행에서 유도한다', () => {
  it.each([['DRAFT'], ['NO_SOLUTION'], ['FAILED']])(
    '%s — fromInstant 날(KST 6/11)의 첫 좌표 슬롯(좌표 없는 앞 슬롯은 건너뜀)',
    (status) => {
      mockItinerary = SEOUL_ITINERARY;
      mockSession.data = session(status, NO_ORIGIN);
      renderPage();

      expect(screen.getByTestId('map-root')).toHaveTextContent(
        '37.5796,126.977'
      );
    }
  );

  it('그날이 일정에 없으면 일정 전체의 첫 좌표 슬롯', () => {
    mockItinerary = SEOUL_ITINERARY;
    mockSession.data = session('FAILED', {
      ...NO_ORIGIN,
      fromInstant: '2026-06-20T06:00:00Z',
    });
    renderPage();

    expect(screen.getByTestId('map-root')).toHaveTextContent(
      '37.5512,126.9882'
    );
  });

  it('일정이 아직 안 왔으면 서울시청 상수(부산 아님)', () => {
    mockSession.data = session('FAILED', NO_ORIGIN);
    renderPage();

    expect(screen.getByTestId('map-root')).toHaveTextContent('37.5665,126.978');
  });

  it('세션 좌표가 있으면 일정보다 세션 좌표가 먼저다(무회귀)', () => {
    mockItinerary = SEOUL_ITINERARY;
    mockSession.data = session('DRAFT', {
      originLat: 37.4979,
      originLng: 127.0276,
    });
    renderPage();

    expect(screen.getByTestId('map-root')).toHaveTextContent(
      '37.4979,127.0276'
    );
  });
});
