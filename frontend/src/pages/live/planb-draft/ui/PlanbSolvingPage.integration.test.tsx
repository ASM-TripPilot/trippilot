import {
  act,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

import type { Itinerary, VisitCheckList } from '@/shared/api/index.schemas';

import { safeAreaPaints } from '@/test-support/safeAreaFace';

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
 *  - ‹ → 이탈 확인부터(TRIP-1007 — 나간 뒤 다시 요청하면 이 결과가 버려진다, INV-U4-06). [나가기]여야
 *    나간다(세션은 살린다, cancel 0 — 뒤가 없으면 허브로 replace, 같은 틱 연타는 1회, TRIP-1291),
 *    [계속 기다리기]면 아무 데도 안 간다.
 *  - 범위가 FULL_DAY 면 캡션이 `{H}시 이후` 가 아니라 오늘 전체 문구다(TRIP-1007).
 *  - DRAFT·NO_SOLUTION·FAILED 면 `planb/draft` 로 replace 정확히 1회(push 아님 — 뒤로가기 무한 루프 방지).
 *  - itinerary 쓰기 훅은 0(INV-U4-05) — 아래 trips 목 팩토리가 cancel·visits 두 훅만 내주므로 페이지가 렌더 중
 *    PUT 훅(`usePutTripsTripIdItinerary`)을 부르면 전 케이스가 TypeError 로 red 다(TRIP-1152 에서 소스 스캔 P8 을
 *    지운 뒤 남는 그물). ⚠ 그물은 그것뿐이다 — raw 함수 `putTripsTripIdItinerary` 를 테스트가 안 타는 분기
 *    (예: cancel `onError`)에서 부르면 green 이다(옛 P8 은 잡던 자리, 5-b 경고-1 실측).
 *
 *  - (TRIP-1277) 어떤 상태에서도 빈 화면이 아니다 — 첫 응답 전은 진행 기본 얼굴, data 없는 실패는 오류 얼굴
 *    ([다시 시도]=재조회만 · [취소]=서버 호출 없이 나가기), 끝난 세션은 종료 얼굴. 90초가 지나면 느림 안내.
 *    취소 요청 실패는 한 줄로 알린다.
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
// TRIP-1007 — 세션 범위. 캐시 키에도 넣는다 — 안 넣으면 FULL_DAY 로 바꿔도 이전 PARTIAL 객체가 나온다(02a ★10).
let mockScope: 'PARTIAL_SLOTS' | 'FULL_DAY' = 'PARTIAL_SLOTS';
// TRIP-979 B — 세션 출발 좌표(nullable). 기본은 좌표가 있는 GPS 세션이고, B4 가 null 로 바꾼다.
let mockOrigin: { lat: number | null; lng: number | null } = {
  lat: 35.1667,
  lng: 129.137,
};
// TRIP-1195 — 세션이 다시 짜는 날(`ReplanSession.targetDate`). null 이면 종전처럼 fromInstant 의 KST 날짜(= 오늘 세션).
let mockTargetDate: string | null = null;
const mockSessionCache = new Map<string, unknown>();
// TRIP-1277 — 세션 조회가 data 없이 실패(mockStatus=null 과 함께 true)·[다시 시도]가 부를 재조회 seam.
let mockSessionError = false;
const mockSessionRefetch = jest.fn();

jest.mock('../model/useReplanSession', () => ({
  useReplanSession: () => {
    if (mockStatus === null) {
      return mockSessionError
        ? {
            data: undefined,
            isPending: false,
            isError: true,
            refetch: mockSessionRefetch,
          }
        : {
            data: undefined,
            isPending: true,
            isError: false,
            refetch: mockSessionRefetch,
          };
    }
    // 5-b 경고-1 — data 가 있어도 재조회가 실패하면 isError=true(TanStack v5 는 data 를 남긴다).
    const key = `${mockStatus}|${mockScope}|${mockFromInstant}|${mockOrigin.lat}|${mockOrigin.lng}|${mockTargetDate}|${mockSessionError}`;
    if (!mockSessionCache.has(key)) {
      mockSessionCache.set(key, {
        data: {
          sessionId: 's9',
          tripId: 't1',
          itineraryId: 'it1',
          scope: mockScope,
          targetDate:
            mockTargetDate ??
            new Date(Date.parse(mockFromInstant) + 9 * 3600 * 1000)
              .toISOString()
              .slice(0, 10),
          fromInstant: mockFromInstant,
          originKind: mockOrigin.lat === null ? 'STAY_ANCHOR' : 'GPS',
          originLat: mockOrigin.lat,
          originLng: mockOrigin.lng,
          originEstimated: mockOrigin.lat === null,
          status: mockStatus,
          createdAt: mockFromInstant,
        },
        isPending: false,
        isError: mockSessionError,
        refetch: mockSessionRefetch,
      });
    }
    return mockSessionCache.get(key);
  },
}));

const mockCancel = jest.fn();
let mockCancelPending = false;
// TRIP-1277 AC13 — 취소 요청이 실패한 뒤(훅 isError). 실패 알림의 판정 근거는 훅 상태다(02a ★6).
let mockCancelError = false;
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
    isError: mockCancelError,
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
  mockCancelError = false;
  mockSessionError = false;
  mockSessionRefetch.mockClear();
  mockVisitsState = 'ok';
  mockStatus = 'SOLVING';
  mockFromInstant = '2026-06-11T04:00:00Z';
  mockScope = 'PARTIAL_SLOTS';
  mockTargetDate = null;
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

// TRIP-1277 — 90초 안내 케이스가 가짜 타이머를 켠다. describe 안에만 걸면 뒤 케이스로 새므로 파일 최상위에서 끈다.
afterEach(() => {
  jest.useRealTimers();
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

// TRIP-1007 — 옛 P7("‹ → back 1회")은 확인 없이 바로 나가는 동작을 굳혀 두었다. 나간 뒤 다시 요청하면 새
// POST 가 이 세션을 CANCELED 로 닫아 이미 나온 결과가 안내 없이 버려진다(QA #062, INV-U4-06). S1~S3 로 교체했다.
// "세션은 살린다(cancel 0) · 앞으로 가지 않는다"는 S2 가 이어받는다.

const LEAVE_CONFIRM = 'planb-solving-leave-confirm';

describe('🔴 S1 · TRIP-1007 AC-8 · QA #062 — ‹ 는 바로 나가지 않고 이탈 확인부터 띄운다', () => {
  it('누르기 전엔 확인이 없고, 누르면 "나가면 결과를 잃을 수 있어요" 확인이 뜨며 back·cancel·이동은 0이다', () => {
    renderPage();
    // "아직 없다" 앵커 — 처음부터 떠 있는 구현을 가른다(02a ★9).
    expect(screen.queryByTestId(LEAVE_CONFIRM)).toBeNull();

    fireEvent.press(screen.getByTestId('generation-progress-back'));

    expect(screen.getByTestId(LEAVE_CONFIRM)).toBeOnTheScreen();
    expect(screen.getByText('나가면 결과를 잃을 수 있어요')).toBeOnTheScreen();
    expect(screen.getByTestId(`${LEAVE_CONFIRM}-stay`)).toHaveTextContent(
      '계속 기다리기'
    );
    expect(screen.getByTestId(`${LEAVE_CONFIRM}-leave`)).toHaveTextContent(
      '나가기'
    );
    expect(mockBack).not.toHaveBeenCalled();
    expect(mockCancel).not.toHaveBeenCalled();
    expect(forwardDestinations()).toEqual([]);
  });
});

describe('🔴 S2 · TRIP-1007 AC-8 · INV-U4-06 — [나가기]를 눌러야 나가고, 세션은 살린다', () => {
  it('back 1회, cancel 0회, 앞으로 가는 이동 0', () => {
    renderPage();
    fireEvent.press(screen.getByTestId('generation-progress-back'));

    fireEvent.press(screen.getByTestId(`${LEAVE_CONFIRM}-leave`));

    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockCancel).not.toHaveBeenCalled();
    expect(forwardDestinations()).toEqual([]);
  });
});

describe('🔴 S3 · TRIP-1007 AC-8 — [계속 기다리기]는 확인만 닫는다', () => {
  it('확인이 사라지고 진행 카드는 그대로, back·cancel·이동 0', () => {
    renderPage();
    fireEvent.press(screen.getByTestId('generation-progress-back'));

    fireEvent.press(screen.getByTestId(`${LEAVE_CONFIRM}-stay`));

    expect(screen.queryByTestId(LEAVE_CONFIRM)).toBeNull();
    expect(screen.getByTestId('generation-progress-card')).toBeOnTheScreen();
    expect(mockBack).not.toHaveBeenCalled();
    expect(mockCancel).not.toHaveBeenCalled();
    expect(forwardDestinations()).toEqual([]);
  });
});

describe('🔴 S4 · TRIP-1007 AC-7 · BR-U4-11 · DEC-U4-3 — FULL_DAY 캡션은 오늘 전체 범위 문구다', () => {
  it('scope=FULL_DAY 면 칸 2 캡션이 정확히 "오늘 일정 다시 짜는 중"이다(시 이후 문구 아님)', () => {
    mockScope = 'FULL_DAY';
    renderPage();

    // 완전 일치 — "13시 이후 다시 짜는 중"이면 여기서 red(PARTIAL 문구는 P1·P2 가 그대로 지킨다).
    expect(
      screen.getByTestId('generation-gauge-cell-2-active')
    ).toHaveTextContent('오늘 일정 다시 짜는 중');
  });
});

describe('🔴 TRIP-1195 · 오늘이 아닌 날 세션 — 일차·날짜·캡션은 세션 targetDate 가 정한다', () => {
  // 세션은 오늘(6/11 13시)에 시작했지만 다시 짜는 날은 3일차(6/12)다. fromInstant 의 날짜로 읽으면 2일차·6/11 이 그려진다.
  function renderFutureSession() {
    mockScope = 'FULL_DAY';
    mockTargetDate = '2026-06-12';
    return renderPage();
  }

  it('F1 헤더는 3일차·6월 12일이고, 오늘(6/11) 방문 완료 행·"방문한 N곳" 은 그리지 않는다', () => {
    renderFutureSession();

    expect(screen.getByTestId('sheet-header-day')).toHaveTextContent('3일차');
    expect(screen.getByTestId('sheet-header-date')).toHaveTextContent(
      '6월 12일(금)'
    );
    expect(screen.getByTestId('sheet-header-meta')).toHaveTextContent('');
    expect(textsOf(/^planb-draft-slot-name-/)).toEqual([]);
  });

  it('F2 캡션은 "오늘" 이 아니라 "3일차 일정 다시 짜는 중"이다(거짓 문구 금지)', () => {
    renderFutureSession();

    expect(
      screen.getByTestId('generation-gauge-cell-2-active')
    ).toHaveTextContent('3일차 일정 다시 짜는 중');
  });

  it('F3 INV-3 — 어떤 라벨에도 소요시간 표현이 없다', () => {
    renderFutureSession();

    expect(
      screen.getByTestId('generation-gauge-cell-2-active')
    ).not.toHaveTextContent(/분|소요/);
  });

  it('F4 targetDate 가 일정에 없으면 일차·날짜는 비우되 캡션은 "일정 다시 짜는 중"으로 거짓 없이 그린다', () => {
    mockScope = 'FULL_DAY';
    mockTargetDate = '2026-06-30';
    renderPage();

    expect(screen.queryByTestId('sheet-header-day')).toBeNull();
    expect(
      screen.getByTestId('generation-gauge-cell-2-active')
    ).toHaveTextContent('일정 다시 짜는 중');
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
    // 커넥터 뿌리(거리·모름 leaf 제외 — TRIP-1274)가 하나 — 광안리→전포 사이엔 아이콘도 글자도 없다.
    expect(
      screen.queryAllByTestId(/^sheet-connector-(?!distance-|unknown-)/)
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

describe('🔴 P17 · TRIP-1079 5-c 경고-1 · AC-6 — 도착 후보가 둘이면 일정 순서가 앞선 곳이 현재 핀이다', () => {
  it('p3·p4 둘 다 도착·미완료이고 기록 목록이 p4 를 앞에 주어도 현재 핀은 p3, p4 는 예정이다', () => {
    mockVisitsByDay = {
      [DAY]: {
        visits: [
          visit('p4', { arrivedAt: '2026-06-11T04:30:00Z' }),
          ...DAY_VISITS.visits,
        ],
      } as unknown as VisitCheckList,
    };

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

// ── TRIP-1277 · INV-4 — 어떤 상태에서도 빈 화면·끝없는 대기로 가두지 않는다 ─────────────────────────
// 근거: 01 브리프 AC1·2·5·6·7·8·13, 01b Q1~Q6·Q13. 문구는 브리프·Seed 가 적은 값만 잠근다(02a §3).

const ERROR_FACE = 'planb-solving-error';
const RETRY = 'planb-solving-retry';
const ERROR_CANCEL = 'planb-solving-error-cancel';
const CLOSED_FACE = 'planb-solving-closed';
const CLOSED_LEAVE = 'planb-solving-closed-leave';
const SLOW = 'planb-solving-slow';
const CANCEL_ERROR = 'planb-solving-cancel-error';
const SLOW_MS = 90_000;
/** INV-3 표기 탐지기(PlanbDraftPage D4 와 같은 정규식) — "시간이 걸리고"처럼 숫자 없는 "시간"은 안 걸린다. */
const DURATION_TEXT = /(\d+\s*분|\d+\s*시간|소요)/;

/** 세션 조회가 data 없이 실패한 상태(404 포함 — 목은 둘을 가리지 않는다). */
function renderSessionError() {
  mockStatus = null;
  mockSessionError = true;
  return renderPage();
}

/**
 * 같은 틱 연타 — 두 번의 누름을 한 act 안에 넣어 그 사이에 다시 그리기가 없게 한다. 그래서 state 잠금은
 * 옛 클로저로 두 번 통과하고(2회), ref 잠금만 1회로 막는다(02a §5 실측).
 */
function pressTwiceSameTick(testID: string): void {
  const target = screen.getByTestId(testID);
  act(() => {
    fireEvent.press(target);
    fireEvent.press(target);
  });
}

function advance(ms: number): void {
  act(() => {
    jest.advanceTimersByTime(ms);
  });
}

describe('TRIP-1277 앵커 — 짜는 중 기본 화면엔 새 얼굴이 하나도 없다', () => {
  it('SOLVING 이면 오류·종료·느림·취소 실패 표면이 0이고 진행 카드는 있다', () => {
    renderPage();

    expect(screen.getByTestId('generation-progress-card')).toBeOnTheScreen();
    for (const id of [ERROR_FACE, CLOSED_FACE, SLOW, CANCEL_ERROR]) {
      expect(screen.queryByTestId(id)).toBeNull();
    }
  });
});

describe('🔴 TRIP-1277 AC7 · Q3 — 첫 응답 전에도 빈 화면이 아니라 진행 기본 얼굴이다', () => {
  it('W1 세션 미도착이면 진행 카드·캡션 "일정 다시 짜는 중"·스켈레톤·[취소]가 있고, 행·일차는 없다', () => {
    mockStatus = null;
    renderPage();

    expect(screen.getByTestId('generation-progress-card')).toBeOnTheScreen();
    expect(
      screen.getByTestId('generation-gauge-cell-2-active')
    ).toHaveTextContent('일정 다시 짜는 중');
    expect(screen.getByTestId('planb-skeleton')).toBeOnTheScreen();
    expect(screen.getByTestId('generation-progress-cancel')).toBeOnTheScreen();
    expect(screen.getByTestId('sheet-header-title')).toHaveTextContent(
      'AI 재계획안'
    );
    expect(screen.queryByTestId('sheet-header-day')).toBeNull();
    expect(screen.queryAllByTestId(/^planb-draft-slot-name-/)).toHaveLength(0);
    expect(screen.queryByTestId(ERROR_FACE)).toBeNull();
  });

  it('W2 미도착이어도 [취소]는 이 세션의 cancel 을 1회 보낸다(tripId·sessionId 만 필요)', () => {
    mockStatus = null;
    renderPage();

    fireEvent.press(screen.getByTestId('generation-progress-cancel'));

    expect(mockCancel).toHaveBeenCalledTimes(1);
    expect(mockCancel.mock.calls[0][0]).toEqual({
      tripId: TRIP_ID,
      sessionId: SESSION_ID,
    });
  });

  it('W3 미도착이어도 ‹ → 이탈 확인 → [나가기]로 나갈 수 있다(back 1 · cancel 0)', () => {
    mockStatus = null;
    renderPage();

    fireEvent.press(screen.getByTestId('generation-progress-back'));
    fireEvent.press(screen.getByTestId(`${LEAVE_CONFIRM}-leave`));

    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockCancel).not.toHaveBeenCalled();
  });
});

describe('🔴 TRIP-1277 AC1 · Q1·Q2 — data 없이 조회가 실패하면 오류 얼굴', () => {
  it('E1 빈 화면 대신 오류 얼굴과 [다시 시도]·[취소]가 보이고, 그리기만으로는 아무 요청·이동도 없다', () => {
    renderSessionError();

    expect(screen.getByTestId(ERROR_FACE)).toBeOnTheScreen();
    expect(screen.getByTestId(RETRY)).toHaveTextContent('다시 시도');
    expect(screen.getByTestId(ERROR_CANCEL)).toHaveTextContent('취소');
    expect(mockSessionRefetch).not.toHaveBeenCalled();
    expect(mockCancel).not.toHaveBeenCalled();
    expect(mockBack).not.toHaveBeenCalled();
    expect(forwardDestinations()).toEqual([]);
  });

  it('E2 [다시 시도]는 세션 GET 재조회(refetch) 1회뿐 — cancel·이동 0', () => {
    renderSessionError();

    fireEvent.press(screen.getByTestId(RETRY));

    expect(mockSessionRefetch).toHaveBeenCalledTimes(1);
    expect(mockCancel).not.toHaveBeenCalled();
    expect(mockBack).not.toHaveBeenCalled();
    expect(forwardDestinations()).toEqual([]);
  });

  it('E3 [취소]는 서버 호출 없이 뒤로 1회(cancel 0)', () => {
    renderSessionError();

    fireEvent.press(screen.getByTestId(ERROR_CANCEL));

    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockCancel).not.toHaveBeenCalled();
    expect(forwardDestinations()).toEqual([]);
  });

  it('E4 뒤로 갈 곳이 없으면(딥링크 착지) [취소]는 허브로 replace 1회(cancel 0)', () => {
    mockCanGoBack = false;
    renderSessionError();

    fireEvent.press(screen.getByTestId(ERROR_CANCEL));

    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith(`/trips/${TRIP_ID}/live`);
    expect(mockBack).not.toHaveBeenCalled();
    expect(mockCancel).not.toHaveBeenCalled();
  });
});

describe('🔴 TRIP-1277 AC8 · Q4 — 끝난 세션(APPLIED·CANCELED)은 종료 얼굴', () => {
  it.each([['APPLIED'], ['CANCELED']])(
    'K1 %s 면 "이미 끝난 재계획이에요"와 [나가기]가 보이고, 그리기만으로는 replace·push 0',
    (status) => {
      mockStatus = status;
      renderPage();

      const face = screen.getByTestId(CLOSED_FACE);
      expect(
        within(face).getByText('이미 끝난 재계획이에요')
      ).toBeOnTheScreen();
      expect(screen.getByTestId(CLOSED_LEAVE)).toHaveTextContent('나가기');
      expect(mockReplace).not.toHaveBeenCalled();
      expect(mockPush).not.toHaveBeenCalled();
    }
  );

  it('K2 [나가기]는 뒤로 1회(cancel 0)', () => {
    mockStatus = 'CANCELED';
    renderPage();

    fireEvent.press(screen.getByTestId(CLOSED_LEAVE));

    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockCancel).not.toHaveBeenCalled();
    expect(forwardDestinations()).toEqual([]);
  });

  it('K3 뒤로 갈 곳이 없으면 [나가기]는 허브로 replace 1회', () => {
    mockStatus = 'APPLIED';
    mockCanGoBack = false;
    renderPage();

    fireEvent.press(screen.getByTestId(CLOSED_LEAVE));

    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith(`/trips/${TRIP_ID}/live`);
    expect(mockBack).not.toHaveBeenCalled();
  });
});

describe('🔴 TRIP-1277 AC2 · 결정1 · Q5·Q6 — 화면에 들어온 지 90초가 지나면 느림 안내', () => {
  it('T1 89,999ms 엔 없고 90,000ms 에 "시간이 걸리고 있어요"·"나가도 원래 일정은 그대로예요"가 뜬다 — 요청·이동은 0', () => {
    jest.useFakeTimers();
    renderPage();

    advance(SLOW_MS - 1);
    expect(screen.queryByTestId(SLOW)).toBeNull();

    advance(1);
    const slow = screen.getByTestId(SLOW);
    expect(within(slow).getByText('시간이 걸리고 있어요')).toBeOnTheScreen();
    expect(
      within(slow).getByText('나가도 원래 일정은 그대로예요')
    ).toBeOnTheScreen();
    expect(mockCancel).not.toHaveBeenCalled();
    expect(mockBack).not.toHaveBeenCalled();
    expect(forwardDestinations()).toEqual([]);
  });

  it('T2 안내가 떠도 [취소]는 그 자리에 있고 누르면 cancel 1회다', () => {
    jest.useFakeTimers();
    renderPage();
    advance(SLOW_MS);
    expect(screen.getByTestId(SLOW)).toBeOnTheScreen();

    fireEvent.press(screen.getByTestId('generation-progress-cancel'));

    expect(mockCancel).toHaveBeenCalledTimes(1);
  });

  it('T3 첫 응답을 기다리는 동안도 센다 — 30초 미도착 → SOLVING 도착 → 진입 90초에 뜬다(도착이 시계를 되돌리지 않는다)', () => {
    jest.useFakeTimers();
    mockStatus = null;
    const { rerender } = renderPage();

    advance(30_000);
    mockStatus = 'SOLVING';
    rerender(<PlanbSolvingPage tripId={TRIP_ID} sessionId={SESSION_ID} />);
    advance(59_999);
    expect(screen.queryByTestId(SLOW)).toBeNull();

    advance(1);
    expect(screen.getByTestId(SLOW)).toBeOnTheScreen();
  });

  it('T4 폴링이 새 응답 객체를 가져와도 시계는 진입부터다 — 45초에 새 응답, 90초에 뜬다', () => {
    jest.useFakeTimers();
    const { rerender } = renderPage();

    advance(45_000);
    // 같은 SOLVING 이지만 새 객체 — 폴링 한 번(캐시를 비워 참조를 바꾼다, 02a ★4).
    mockSessionCache.clear();
    rerender(<PlanbSolvingPage tripId={TRIP_ID} sessionId={SESSION_ID} />);
    advance(44_999);
    expect(screen.queryByTestId(SLOW)).toBeNull();

    advance(1);
    expect(screen.getByTestId(SLOW)).toBeOnTheScreen();
  });
});

describe('🔴 TRIP-1277 AC13 · Q6 — [취소] 요청이 실패하면 무음으로 두지 않는다', () => {
  it('C1 취소 실패면 알림 한 줄이 보이고, ‹ → [나가기] 탈출구는 그대로다(back 1)', () => {
    mockCancelError = true;
    renderPage();

    expect(screen.getByTestId(CANCEL_ERROR)).toHaveTextContent(/\S/);

    fireEvent.press(screen.getByTestId('generation-progress-back'));
    fireEvent.press(screen.getByTestId(`${LEAVE_CONFIRM}-leave`));
    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});

describe('🔴 TRIP-1277 AC6 · Q13 — 이번에 만든 버튼은 연타해도 한 번만', () => {
  it('R1 오류 얼굴 [다시 시도] 같은 틱 2연타 — cancel(POST) 0', () => {
    renderSessionError();

    pressTwiceSameTick(RETRY);

    expect(mockSessionRefetch).toHaveBeenCalled();
    expect(mockCancel).not.toHaveBeenCalled();
  });

  it('R2 오류 얼굴 [취소] 같은 틱 2연타 — 이동 정확히 1회', () => {
    renderSessionError();

    pressTwiceSameTick(ERROR_CANCEL);

    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('R3 종료 얼굴 [나가기] 같은 틱 2연타 — 이동 정확히 1회', () => {
    mockStatus = 'CANCELED';
    renderPage();

    pressTwiceSameTick(CLOSED_LEAVE);

    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockReplace).not.toHaveBeenCalled();
  });
});

// TRIP-1291 · INV-4 · INV-U4-05 — ‹ 확인의 [나가기]도 오류·종료 얼굴의 나가기와 같은 길(뒤가 없으면 허브, 연타 1회).
// 뒤가 있을 때 back 1 · cancel 0 은 S2 가 맡는다. 목 back 은 canGoBack 을 안 보므로 back 0 · replace 1 로 판정한다.
describe('🔴 ‹ 확인 [나가기] — 뒤가 없어도 나가고, 연타해도 한 번만', () => {
  function openLeaveConfirm(): void {
    fireEvent.press(screen.getByTestId('generation-progress-back'));
    expect(screen.getByTestId(LEAVE_CONFIRM)).toBeOnTheScreen();
  }

  it('L1 뒤로 갈 곳이 없으면(딥링크 착지) 허브로 replace 1회 — back·cancel 0', () => {
    mockCanGoBack = false;
    renderPage();
    openLeaveConfirm();

    fireEvent.press(screen.getByTestId(`${LEAVE_CONFIRM}-leave`));

    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith(`/trips/${TRIP_ID}/live`);
    expect(mockBack).not.toHaveBeenCalled();
    expect(mockCancel).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it.each([
    ['뒤가 있으면', true, 1, 0],
    ['뒤가 없으면', false, 0, 1],
  ])(
    'L2 %s(canGoBack=%s) 같은 틱 2연타 — back %i · replace %i(이동 정확히 1회) · cancel 0',
    (_label, canGoBack, backTimes, replaceTimes) => {
      mockCanGoBack = canGoBack;
      renderPage();
      openLeaveConfirm();

      pressTwiceSameTick(`${LEAVE_CONFIRM}-leave`);

      expect(mockBack).toHaveBeenCalledTimes(backTimes);
      expect(mockReplace).toHaveBeenCalledTimes(replaceTimes);
      expect(mockCancel).not.toHaveBeenCalled();
    }
  );

  it('L3 [계속 기다리기]로 닫았다가 다시 ‹ → [나가기]를 누르면 그때 나간다(닫기가 나가기를 잠그지 않는다)', () => {
    renderPage();
    openLeaveConfirm();
    fireEvent.press(screen.getByTestId(`${LEAVE_CONFIRM}-stay`));
    expect(screen.queryByTestId(LEAVE_CONFIRM)).toBeNull();

    openLeaveConfirm();
    fireEvent.press(screen.getByTestId(`${LEAVE_CONFIRM}-leave`));

    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockCancel).not.toHaveBeenCalled();
  });
});

describe('🔴 TRIP-1277 AC5 · INV-3 — 새 얼굴 어디에도 소요시간이 없고, 느림 안내엔 숫자가 없다', () => {
  it('I1 오류 얼굴 — N분·N시간·소요 0(+ 탐지기가 실제 글자를 본다는 앵커)', () => {
    renderSessionError();

    expect(screen.queryAllByText(/다시 시도/)).toHaveLength(1);
    expect(screen.queryAllByText(DURATION_TEXT)).toHaveLength(0);
  });

  it('I2 종료 얼굴 — N분·N시간·소요 0(+ 앵커)', () => {
    mockStatus = 'APPLIED';
    renderPage();

    expect(screen.queryAllByText(/이미 끝난 재계획/)).toHaveLength(1);
    expect(screen.queryAllByText(DURATION_TEXT)).toHaveLength(0);
  });

  it('I3 느림 안내 — 경과·남은 시간 숫자 0("90초째" 같은 카운터 금지), 화면 전체 N분·N시간·소요 0', () => {
    jest.useFakeTimers();
    renderPage();
    advance(SLOW_MS);

    const slow = screen.getByTestId(SLOW);
    expect(slow).toHaveTextContent(/시간이 걸리고/);
    expect(slow).not.toHaveTextContent(/\d/);
    expect(screen.queryAllByText(DURATION_TEXT)).toHaveLength(0);
  });
});

// ── TRIP-1277 5-b 차단 수정 루프 — 03b W-1: "data 는 있는데 재조회 실패" 경계 ──────────────────────
// 근거: 01 브리프 AC1(오류 얼굴은 data 없이 실패할 때만) · INV-4(02a ★15).

describe('🔴 TRIP-1277 5-b 경고-1 · AC1 — 짜는 중을 이미 받았으면 폴링이 실패해도 오류 얼굴로 덮지 않는다', () => {
  it('E5 SOLVING data + isError 면 오류 얼굴 0 · 진행 카드·[취소] 그대로 — 재조회·cancel·이동 0', () => {
    mockSessionError = true;
    renderPage();

    expect(screen.queryByTestId(ERROR_FACE)).toBeNull();
    expect(screen.getByTestId('generation-progress-card')).toBeOnTheScreen();
    expect(screen.getByTestId('generation-progress-cancel')).toBeOnTheScreen();
    expect(mockSessionRefetch).not.toHaveBeenCalled();
    expect(mockCancel).not.toHaveBeenCalled();
    expect(mockBack).not.toHaveBeenCalled();
    expect(forwardDestinations()).toEqual([]);
  });
});

// TRIP-1286 · C-15 · Seed Q3 B안 — 재계획 오류·종료 얼굴(공용 ReplanNoticeFace)도 SafeAreaView 에 배경이 없어 위·아래
// 띠에 회색이 비쳤다. 세 종류(진행 오류·종료·재계획안 오류)가 같은 한 줄 SafeAreaView 를 쓰므로 여기 두 얼굴로 그 줄을
// 잠근다(02a §3-5). 판정은 "SafeAreaView 자신 또는 그 바깥이 bg-canvas" 까지 — 실제 띠 색은 6-b.
describe('🔴 C-15 · 재계획 안내 얼굴의 SafeArea 가 인셋 영역까지 흰 바탕이다 (AC-S3)', () => {
  it('S3a 오류 얼굴 — bg-canvas', () => {
    renderSessionError();

    expect(safeAreaPaints(screen.getByTestId(ERROR_FACE), 'bg-canvas')).toBe(
      true
    );
  });

  it('S3b 종료 얼굴 — bg-canvas', () => {
    mockStatus = 'APPLIED';
    renderPage();

    expect(safeAreaPaints(screen.getByTestId(CLOSED_FACE), 'bg-canvas')).toBe(
      true
    );
  });
});
