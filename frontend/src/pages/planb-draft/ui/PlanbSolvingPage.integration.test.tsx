import fs from 'fs';
import path from 'path';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import type { Itinerary, VisitCheckList } from '@/shared/api/generated/schemas';

import { PlanbSolvingPage } from './PlanbSolvingPage';

/**
 * TRIP-752 · AC-5·6·7·8·9·11 — i05 "다시 짜는 중" 페이지 배선판. 세션 폴링 → 판정 → (짜는 중이면)
 * 진행 카드 + 오늘 방문 완료 행을 그리고, 결과가 나오면 i06 로 **갈아 끼운다**.
 * (TRIP-440 i12 배선 테스트와 TRIP-443 FAILED 폴백 테스트를 재작성·흡수 — FAILED 는 이제 i06 로 간다, E3.)
 *
 * 무엇을 보장하나:
 *  - 짜는 중이면 진행 카드 캡션 `{KST 시}시 이후 다시 짜는 중`, 헤더 `N일차 · M월 D일(요일)` + `방문한 K곳 그대로`,
 *    그날 방문 완료 행(일정 순서)을 그린다. 그날은 fromInstant 의 **KST 날짜**다(Q5).
 *  - [취소] → cancel 1회. **성공한 뒤에만** 뒤로(또는 허브로 replace) 간다.
 *  - ‹ → back 만(세션은 살린다).
 *  - DRAFT·NO_SOLUTION·FAILED 면 `planb/draft` 로 replace 정확히 1회(push 아님 — 뒤로가기 무한 루프 방지).
 *  - itinerary 쓰기 훅은 0(INV-U4-05).
 *
 *  - (5-b 후속) 취소 요청 중엔 [취소]가 잠긴다 · 원 일정에서 이웃하지 않는 두 완료 행 사이엔 커넥터가 없다 ·
 *    방문 기록을 모르면(로딩·실패) 곳 수를 비운다 · 지도 핀은 그날 슬롯 전부를 진행 상태별로 넘긴다.
 *
 * seam 목: 세션 폴링·cancel·방문 기록 조회(codegen)·일정 조회·라우터·지도(`mapViewMock` — `map-root` 의
 * `props.pins` 를 읽는다). 판정·도출 함수와 뷰는 실물이다(02a ★10).
 * 목 데이터와 라우터는 같은 참조를 돌려준다(TanStack 구조 공유·expo-router 와 같다 — 02a ★3·★4).
 * jest.mock 팩토리는 `mock` 접두 변수만 볼 수 있다(호이스팅).
 */

const TRIP_ID = 't1';
const SESSION_ID = 's9';
const DAY = '2026-06-11';

let mockStatus: string | null = 'SOLVING';
let mockFromInstant = '2026-06-11T04:00:00Z';
// TRIP-979 B — 세션 출발 좌표(nullable). 기본은 좌표가 있는 GPS 세션이고, B4 가 null 로 바꾼다.
let mockOrigin: { lat: number | null; lng: number | null } = {
  lat: 35.1667,
  lng: 129.137,
};
const mockSessionCache = new Map<string, unknown>();

jest.mock('@/features/planb/model/useReplanSession', () => ({
  useReplanSession: () => {
    if (mockStatus === null) {
      return { data: undefined, isPending: true, isError: false };
    }
    const key = `${mockStatus}|${mockFromInstant}|${mockOrigin.lat}|${mockOrigin.lng}`;
    if (!mockSessionCache.has(key)) {
      mockSessionCache.set(key, {
        data: {
          sessionId: 's9',
          tripId: 't1',
          itineraryId: 'it1',
          scope: 'PARTIAL_SLOTS',
          fromInstant: mockFromInstant,
          originKind: mockOrigin.lat === null ? 'STAY_ANCHOR' : 'GPS',
          originLat: mockOrigin.lat,
          originLng: mockOrigin.lng,
          originEstimated: mockOrigin.lat === null,
          status: mockStatus,
          createdAt: mockFromInstant,
        },
        isPending: false,
        isError: false,
      });
    }
    return mockSessionCache.get(key);
  },
}));

const mockCancel = jest.fn();
let mockCancelPending = false;
let mockVisitsByDay: Record<string, VisitCheckList> = {};
let mockVisitsState: 'ok' | 'pending' | 'error' = 'ok';
const mockVisitsEmpty = { data: { visits: [] }, isPending: false };
const mockVisitsPending = { data: undefined, isPending: true, isError: false };
const mockVisitsError = { data: undefined, isPending: false, isError: true };
const mockVisitsCache = new Map<string, unknown>();

jest.mock('@/shared/api/generated/trips/trips', () => ({
  usePostTripsTripIdReplanSessionsSessionIdCancel: () => ({
    mutate: mockCancel,
    isPending: mockCancelPending,
    isError: false,
  }),
  // 방문 기록은 날짜를 가린다 — 6/11 만 기록이 있다(02a ★5).
  useGetTripsTripIdVisitsDaysDay: (_tripId: string, day: string) => {
    if (mockVisitsState === 'pending') return mockVisitsPending;
    if (mockVisitsState === 'error') return mockVisitsError;
    const list = mockVisitsByDay[day];
    if (list === undefined) return mockVisitsEmpty;
    if (!mockVisitsCache.has(day)) {
      mockVisitsCache.set(day, { data: list, isPending: false });
    }
    return mockVisitsCache.get(day);
  },
}));

let mockItinerary: { data: Itinerary | undefined; isPending: boolean };

jest.mock('@/features/execution/model/useLiveItinerary', () => ({
  useLiveItinerary: () => mockItinerary,
}));

const mockBack = jest.fn();
const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockNavigate = jest.fn();
let mockCanGoBack = true;

// 지도 관찰 목 — 핀·중심을 host prop 으로 노출한다(리포 관례, MustVisitListPage 선례 · 02a ★20).
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/shared/map', () => require('@/test-support/mapViewMock'));

jest.mock('expo-router', () => {
  const routerMock = {
    back: (...args: unknown[]) => mockBack(...args),
    push: (...args: unknown[]) => mockPush(...args),
    replace: (...args: unknown[]) => mockReplace(...args),
    navigate: (...args: unknown[]) => mockNavigate(...args),
    canGoBack: () => mockCanGoBack,
  };
  return { useRouter: () => routerMock, router: routerMock };
});

const baseSlot = {
  endAt: '18:00:00',
  isFixed: false,
  endsNextDay: false,
  hasViolation: false,
  category: null,
  openingHours: null,
  imageUrl: null,
  tags: [],
};

const slot = (
  poiId: string,
  nameKo: string,
  startAt: string,
  distanceRange: string | null,
  coords: { lat: number; lng: number } | null = null
) => ({
  ...baseSlot,
  poiId,
  nameKo,
  startAt,
  distanceRange,
  lat: coords?.lat ?? null,
  lng: coords?.lng ?? null,
});

const P1 = { lat: 35.0975, lng: 129.0106 };
const P2 = { lat: 35.1532, lng: 129.1186 };
const P3 = { lat: 35.1667, lng: 129.137 };
const P4 = { lat: 35.1555, lng: 129.0636 };
const P5 = { lat: 35.1587, lng: 129.1604 };

const ITINERARY = {
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
      slots: [slot('p0', '태종대', '10:00:00', null)],
    },
    {
      date: DAY,
      slots: [
        slot('p1', '감천문화마을', '09:30:00', null, P1),
        slot('p2', '광안리 해변', '11:00:00', '1.4km', P2),
        slot('p3', '부산시립미술관', '13:00:00', '3.2km', P3),
        slot('p4', '전포 카페거리', '15:00:00', '600m', P4),
        slot('p5', '해운대 해변', '17:00:00', '1.1km', P5),
      ],
    },
    {
      date: '2026-06-12',
      slots: [slot('p9', '해동용궁사', '10:00:00', null)],
    },
  ],
} as unknown as Itinerary;

const visit = (
  poiId: string,
  over: {
    arrivedAt?: string | null;
    completedAt?: string | null;
    skippedAt?: string | null;
  }
) => ({
  visitCheckId: `vc-${poiId}`,
  slotKey: `${DAY}#${poiId}`,
  poiId,
  arrivedAt: null,
  completedAt: null,
  skippedAt: null,
  source: 'MANUAL',
  spontaneous: false,
  updatedAt: '2026-06-11T04:00:00Z',
  ...over,
});

// 일정 순서와 반대로 넣었다 — 행 순서의 권위는 일정이다(02a ★9). p3 는 도착(진행 중)이라 행이 아니다(★8).
const DAY_VISITS = {
  visits: [
    visit('p2', {
      arrivedAt: '2026-06-11T02:00:00Z',
      completedAt: '2026-06-11T03:10:00Z',
    }),
    visit('p1', {
      arrivedAt: '2026-06-11T00:30:00Z',
      completedAt: '2026-06-11T01:50:00Z',
    }),
    visit('p3', { arrivedAt: '2026-06-11T04:05:00Z' }),
  ],
} as unknown as VisitCheckList;

/** 옛 i12 화면에만 있던 문구(AC-5). */
const REMOVED_TEXTS = [
  '백그라운드로',
  '5초쯤',
  '비 예보·남은 시간 반영',
  '대안 후보 거리·동선 계산',
  '대안 영업시간 확인 중',
  '새 동선 완성',
  '바뀌는 건 남은 일정 뿐',
];

const DRAFT_HREF = {
  pathname: '/trips/[tripId]/planb/draft',
  params: { tripId: TRIP_ID, sessionId: SESSION_ID },
};

beforeEach(() => {
  mockCancelPending = false;
  mockVisitsState = 'ok';
  mockStatus = 'SOLVING';
  mockFromInstant = '2026-06-11T04:00:00Z';
  mockOrigin = { lat: 35.1667, lng: 129.137 };
  mockSessionCache.clear();
  mockVisitsCache.clear();
  mockVisitsByDay = { [DAY]: DAY_VISITS };
  mockItinerary = { data: ITINERARY, isPending: false };
  mockCanGoBack = true;
  mockCancel.mockClear();
  mockBack.mockClear();
  mockPush.mockClear();
  mockReplace.mockClear();
  mockNavigate.mockClear();
});

function renderPage() {
  return render(<PlanbSolvingPage tripId={TRIP_ID} sessionId={SESSION_ID} />);
}

function textsOf(pattern: RegExp): string[] {
  return screen
    .queryAllByTestId(pattern)
    .map((node) => String(node.props.children));
}

function forwardDestinations(): string[] {
  return [mockPush, mockReplace, mockNavigate]
    .flatMap((fn) => fn.mock.calls)
    .map((call) => JSON.stringify(call[0]));
}

/** [취소]를 누른 뒤 cancel mutate 가 받은 성공 콜백을 꺼낸다(02a ★2). */
function pressCancelAndCaptureSuccess(): () => void {
  fireEvent.press(screen.getByTestId('generation-progress-cancel'));
  expect(mockCancel).toHaveBeenCalledTimes(1);
  const options = mockCancel.mock.calls[0][1] as
    { onSuccess?: () => void } | undefined;
  expect(typeof options?.onSuccess).toBe('function');
  return options?.onSuccess as () => void;
}

describe('🔴 P1 · AC-6(a)·9·11 — 짜는 중: 진행 카드 + 오늘 방문 완료 행', () => {
  it('캡션은 KST 13시, 헤더는 2일차·6월 11일(목)·방문한 3곳, 행은 완료 2곳을 일정 순서로 그린다', () => {
    renderPage();

    expect(screen.getByTestId('generation-progress-card')).toBeOnTheScreen();
    expect(screen.getByText('AI가 일정을 다시 짜고 있어요')).toBeOnTheScreen();
    expect(
      screen.getByTestId('generation-gauge-cell-2-active')
    ).toHaveTextContent('13시 이후 다시 짜는 중');

    expect(screen.getByTestId('sheet-header-title')).toHaveTextContent(
      'AI 재계획안'
    );
    expect(screen.getByTestId('sheet-header-day')).toHaveTextContent('2일차');
    expect(screen.getByTestId('sheet-header-date')).toHaveTextContent(
      '6월 11일(목)'
    );
    // 완료 2 + 진행 중 1 — 기준 시각 이전이라 둘 다 그대로 둔다(Q4, BR-U4-17·18).
    expect(screen.getByTestId('sheet-header-meta')).toHaveTextContent(
      '방문한 3곳 그대로'
    );

    expect(textsOf(/^planb-draft-slot-name-/)).toEqual([
      '감천문화마을',
      '광안리 해변',
    ]);
    const times = screen.getAllByTestId(/^planb-draft-slot-time-/);
    expect(times).toHaveLength(2);
    expect(times[0]).toHaveTextContent('09:30 방문');
    expect(times[1]).toHaveTextContent('11:00 방문');
    screen
      .getAllByTestId(/^planb-draft-slot-number-/)
      .forEach((node) =>
        expect(String(node.props.className).split(/\s+/)).toContain(
          'bg-success'
        )
      );
    // 커넥터 거리는 서버 distanceRange 를 그대로 흘린다(INV-2·INV-3).
    expect(textsOf(/^sheet-connector-distance-/)).toEqual(['1.4km']);
    expect(screen.queryAllByTestId(/^sheet-cta/)).toHaveLength(0);
  });
});

describe('🔴 P2 · AC-9·11 · Q5 — 어느 날인가는 fromInstant 의 KST 날짜다', () => {
  it('UTC 6/10 16:00(KST 6/11 01시)이면 캡션 1시·헤더 6월 11일·그날 방문 행 2개다', () => {
    mockFromInstant = '2026-06-10T16:00:00Z';
    renderPage();

    expect(
      screen.getByTestId('generation-gauge-cell-2-active')
    ).toHaveTextContent('1시 이후 다시 짜는 중');
    expect(screen.getByTestId('sheet-header-day')).toHaveTextContent('2일차');
    expect(screen.getByTestId('sheet-header-date')).toHaveTextContent(
      '6월 11일(목)'
    );
    expect(textsOf(/^planb-draft-slot-name-/)).toEqual([
      '감천문화마을',
      '광안리 해변',
    ]);
  });
});

describe('🔴 P3 · AC-9 — 일정을 모르면 제목만 남기고 화면은 그대로 그린다', () => {
  it.each([
    ['일정이 아직 안 왔을 때', undefined, '2026-06-11T04:00:00Z'],
    ['그날이 일정에 없을 때', ITINERARY, '2026-06-20T04:00:00Z'],
  ])(
    '%s — 행 0 · 일차·날짜 없음 · meta 비움 · 진행 카드와 [취소]는 있음',
    (_label, itinerary, fromInstant) => {
      mockItinerary = { data: itinerary, isPending: itinerary === undefined };
      mockFromInstant = fromInstant;
      renderPage();

      expect(screen.queryAllByTestId(/^planb-draft-slot-name-/)).toHaveLength(
        0
      );
      expect(screen.getByTestId('sheet-header-title')).toHaveTextContent(
        'AI 재계획안'
      );
      expect(screen.queryByTestId('sheet-header-day')).toBeNull();
      expect(screen.queryByTestId('sheet-header-date')).toBeNull();
      expect(screen.getByTestId('sheet-header-meta')).toHaveTextContent('');
      expect(screen.getByTestId('generation-progress-card')).toBeOnTheScreen();
      expect(
        screen.getByTestId('generation-progress-cancel')
      ).toBeOnTheScreen();
    }
  );
});

describe('🔴 P4~P6 · AC-6(b)·7 — [취소]는 cancel 1회, 이동은 성공한 뒤에만', () => {
  it('P4 누르면 cancel 이 {tripId, sessionId} 로 1회 나가고, 누른 직후에는 아무 데도 가지 않는다', () => {
    renderPage();

    pressCancelAndCaptureSuccess();

    expect(mockCancel.mock.calls[0][0]).toEqual({
      tripId: TRIP_ID,
      sessionId: SESSION_ID,
    });
    expect(mockBack).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
    // navigate 까지 — 이동 4가지 모두 0(5-b 경고-1).
    expect(forwardDestinations()).toEqual([]);
  });

  it('P5 취소가 성공하면 뒤로 간다(뒤로 갈 곳이 있을 때)', () => {
    renderPage();
    const onSuccess = pressCancelAndCaptureSuccess();

    act(() => onSuccess());

    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('P6 뒤로 갈 곳이 없으면(딥링크 착지) 성공 뒤 허브로 replace 한다', () => {
    mockCanGoBack = false;
    renderPage();
    const onSuccess = pressCancelAndCaptureSuccess();
    expect(mockReplace).not.toHaveBeenCalled();

    act(() => onSuccess());

    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith(`/trips/${TRIP_ID}/live`);
    expect(mockBack).not.toHaveBeenCalled();
  });
});

describe('🔴 P7 · AC-6(c) — ‹ 는 세션을 살린 채 나간다', () => {
  it('back 1회, cancel 0회, replace 0회', () => {
    renderPage();

    fireEvent.press(screen.getByTestId('generation-progress-back'));

    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockCancel).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
    // 뒤로만 간다 — push·replace·navigate 어디로도 앞으로 가지 않는다(5-b 경고-1).
    expect(forwardDestinations()).toEqual([]);
  });
});

describe('P8 · AC-6(d) · INV-U4-05 — 원 일정은 건드리지 않는다(소스)', () => {
  it('★구조 — 페이지 소스에 itinerary 쓰기 훅이 0건이고 cancel 훅은 있다', () => {
    const source = fs.readFileSync(
      path.resolve('src/pages/planb-draft/ui/PlanbSolvingPage.tsx'),
      'utf8'
    );
    expect(source).not.toContain('usePutTripsTripIdItinerary');
    expect(source).not.toContain('putTripsTripIdItinerary');
    expect(source).toContain('usePostTripsTripIdReplanSessionsSessionIdCancel');
  });
});

describe('🔴 P9 · AC-8 · E3 — 결과가 나오면 i06 로 갈아 끼운다(replace 1회)', () => {
  it.each(['DRAFT', 'NO_SOLUTION', 'FAILED'])(
    '%s 면 planb/draft 로 replace 가 정확히 1회, push 는 0, 수동 편집으로는 안 간다',
    (status) => {
      mockStatus = status;
      const { rerender } = renderPage();
      // 폴링으로 같은 결과가 다시 와도 두 번 가지 않는다(02a ★4).
      rerender(<PlanbSolvingPage tripId={TRIP_ID} sessionId={SESSION_ID} />);
      rerender(<PlanbSolvingPage tripId={TRIP_ID} sessionId={SESSION_ID} />);

      expect(mockReplace).toHaveBeenCalledTimes(1);
      expect(mockReplace).toHaveBeenCalledWith(DRAFT_HREF);
      expect(mockPush).not.toHaveBeenCalled();
      expect(
        forwardDestinations().filter((dest) => dest.includes('planb/manual'))
      ).toEqual([]);
    }
  );
});

describe('🔴 P10 · AC-8 — 폴링 흐름: 짜는 중이다가 초안이 오면 그때 한 번', () => {
  it('SOLVING 동안 replace 0 → DRAFT 로 바뀌면 1 → 다시 그려도 1', () => {
    const { rerender } = renderPage();
    expect(mockReplace).not.toHaveBeenCalled();

    mockStatus = 'DRAFT';
    rerender(<PlanbSolvingPage tripId={TRIP_ID} sessionId={SESSION_ID} />);
    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith(DRAFT_HREF);

    rerender(<PlanbSolvingPage tripId={TRIP_ID} sessionId={SESSION_ID} />);
    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(mockPush).not.toHaveBeenCalled();
  });
});

describe('P11 · AC-8 — 결과가 아니면 이동하지 않는다', () => {
  it.each([['COLLECTING'], ['SOLVING'], ['APPLIED'], ['CANCELED'], [null]])(
    'status %s 면 replace·push 가 0이다',
    (status) => {
      mockStatus = status;
      renderPage();

      expect(mockReplace).not.toHaveBeenCalled();
      expect(mockPush).not.toHaveBeenCalled();
    }
  );
});

describe('🔴 P12 · AC-5 — 옛 i12 표면이 페이지 트리에 없다', () => {
  it('옛 testID 3종과 옛 문구가 0건이다', () => {
    renderPage();

    for (const id of [
      'planb-solving-background',
      'planb-solving-progress',
      'planb-solving-cancel',
    ]) {
      expect(screen.queryByTestId(id)).toBeNull();
    }
    const tree = JSON.stringify(screen.toJSON());
    for (const text of REMOVED_TEXTS) {
      expect(tree).not.toContain(text);
    }
  });
});

// ── 5-b 후속(03b 경고-2·3 · 참고-1·3) ─────────────────────────────────────────

describe('🔴 P13 · 5-b 경고-3 — 취소 요청 중에는 [취소]가 잠긴다', () => {
  it('처음엔 눌리고, 요청이 나가 대기 중이 되면 잠겨서 다시 눌러도 요청이 더 나가지 않는다', () => {
    const { rerender } = renderPage();
    const first = screen.getByTestId('generation-progress-cancel');
    expect(first).not.toBeDisabled();
    fireEvent.press(first);
    expect(mockCancel).toHaveBeenCalledTimes(1);

    mockCancelPending = true;
    rerender(<PlanbSolvingPage tripId={TRIP_ID} sessionId={SESSION_ID} />);

    const again = screen.getByTestId('generation-progress-cancel');
    expect(again).toBeDisabled();
    fireEvent.press(again);
    expect(mockCancel).toHaveBeenCalledTimes(1);
  });
});

describe('🔴 P14 · 5-b 경고-2 — 원 일정에서 이웃하지 않는 두 완료 행 사이엔 거리를 그리지 않는다', () => {
  it('p1·p2 완료, p3 건너뜀, p4 완료면 행은 3개, 커넥터는 p1→p2 하나(1.4km)뿐이다', () => {
    mockVisitsByDay = {
      [DAY]: {
        visits: [
          visit('p1', {
            arrivedAt: '2026-06-11T00:30:00Z',
            completedAt: '2026-06-11T01:50:00Z',
          }),
          visit('p2', {
            arrivedAt: '2026-06-11T02:00:00Z',
            completedAt: '2026-06-11T03:10:00Z',
          }),
          visit('p3', {
            arrivedAt: '2026-06-11T04:05:00Z',
            skippedAt: '2026-06-11T04:10:00Z',
          }),
          visit('p4', {
            arrivedAt: '2026-06-11T06:00:00Z',
            completedAt: '2026-06-11T06:40:00Z',
          }),
        ],
      } as unknown as VisitCheckList,
    };
    renderPage();

    expect(textsOf(/^planb-draft-slot-name-/)).toEqual([
      '감천문화마을',
      '광안리 해변',
      '전포 카페거리',
    ]);
    // 커넥터 뿌리(거리 leaf 제외)가 하나 — 광안리→전포 사이엔 아이콘도 글자도 없다.
    expect(
      screen.queryAllByTestId(/^sheet-connector-(?!distance-)/)
    ).toHaveLength(1);
    expect(textsOf(/^sheet-connector-distance-/)).toEqual(['1.4km']);
    expect(screen.queryByText('600m')).toBeNull();
  });
});

describe('🔴 P15 · 5-b 참고-3 — 방문 기록을 모르면 곳 수를 비운다(거짓 0곳 금지)', () => {
  it.each([['pending'], ['error']] as const)(
    '방문 조회가 %s 이면 meta 는 비고 행은 0, 일차·날짜는 그대로다',
    (state) => {
      mockVisitsState = state;
      renderPage();

      expect(screen.getByTestId('sheet-header-meta')).toHaveTextContent('');
      expect(screen.queryByText(/방문한 \d+곳/)).toBeNull();
      expect(screen.queryAllByTestId(/^planb-draft-slot-name-/)).toHaveLength(
        0
      );
      expect(screen.getByTestId('sheet-header-day')).toHaveTextContent('2일차');
      expect(screen.getByTestId('sheet-header-date')).toHaveTextContent(
        '6월 11일(목)'
      );
    }
  );
});

describe('🔴 P16 · 5-b 참고-1 — 지도 핀은 그날 슬롯 전부를 진행 상태별로 넘긴다', () => {
  it('완료 2·현재 1·예정 2 핀이 일정 순서·번호·좌표로 지도에 간다', () => {
    renderPage();

    expect(screen.getByTestId('map-root').props.pins).toEqual([
      { number: 1, ...P1, state: 'done' },
      { number: 2, ...P2, state: 'done' },
      { number: 3, ...P3, state: 'current' },
      { number: 4, ...P4, state: 'upcoming' },
      { number: 5, ...P5, state: 'upcoming' },
    ]);
  });
});

// ── TRIP-979 B · AC-B4 — 세션 좌표가 없으면 지도 중심을 이 여행에서 고른다(부산 상수 제거) ──────────

const SEOUL_SLOT = (
  poiId: string,
  nameKo: string,
  coords: { lat: number; lng: number } | null
) => slot(poiId, nameKo, '10:00:00', null, coords);
const NAMSAN = { lat: 37.5512, lng: 126.9882 };
const GYEONGBOK = { lat: 37.5796, lng: 126.977 };

// 서울 일정 — fromInstant 날(6/11)의 첫 슬롯은 좌표가 없고 그 뒤가 경복궁. 일정 전체 첫 좌표는 남산(6/10).
const SEOUL_ITINERARY = {
  ...ITINERARY,
  days: [
    { date: '2026-06-10', slots: [SEOUL_SLOT('s0', '남산서울타워', NAMSAN)] },
    {
      date: DAY,
      slots: [
        SEOUL_SLOT('s1', '좌표 없는 곳', null),
        SEOUL_SLOT('s2', '경복궁', GYEONGBOK),
      ],
    },
  ],
} as unknown as Itinerary;

describe('🔴 B4 · AC-B4 · Q5 — 출발 좌표 없는 세션의 지도 중심은 여행에서 유도한다', () => {
  beforeEach(() => {
    mockOrigin = { lat: null, lng: null };
    mockItinerary = { data: SEOUL_ITINERARY, isPending: false };
    mockVisitsByDay = {};
  });

  it('fromInstant 날(KST 6/11)의 첫 좌표 슬롯 — 좌표 없는 앞 슬롯은 건너뛴다', () => {
    renderPage();

    expect(screen.getByTestId('map-root')).toHaveTextContent('37.5796,126.977');
  });

  it('그날이 일정에 없으면 일정 전체의 첫 좌표 슬롯', () => {
    mockFromInstant = '2026-06-20T04:00:00Z';
    renderPage();

    expect(screen.getByTestId('map-root')).toHaveTextContent(
      '37.5512,126.9882'
    );
  });

  it('일정이 아직 안 왔으면 서울시청 상수(부산 아님)', () => {
    mockItinerary = { data: undefined, isPending: true };
    renderPage();

    expect(screen.getByTestId('map-root')).toHaveTextContent('37.5665,126.978');
  });

  it('세션 좌표가 있으면 일정보다 세션 좌표가 먼저다(무회귀)', () => {
    mockOrigin = { lat: 37.4979, lng: 127.0276 };
    renderPage();

    expect(screen.getByTestId('map-root')).toHaveTextContent(
      '37.4979,127.0276'
    );
  });
});
