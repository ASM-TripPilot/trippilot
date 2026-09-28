import { fireEvent, render, screen } from '@testing-library/react-native';

import type { Trip } from '@/shared/api/generated/schemas';
import { useTripWizardStore } from '@/features/trip/model/tripWizardStore';
import {
  captureDraftAtNextCall,
  freshWizardDraft,
  leavePreviousTripDraft,
  resetWizardDraft,
  wizardDraftData,
} from '@/test-support/wizardDraftFixture';

/**
 * TRIP-575 · (tabs)/records.tsx — 기록 탭 허브 라우트 배선(항법).
 *
 * *(개념)* `tabsHomeRoute.test.tsx` 선례와 같은 자리다 — 라우트를 직접 렌더해 실제 네비게이션을
 * 관찰한다. 라우트→페이지가 `useGetTrips`(조회)와 `useRouter().push`(항법)를 물므로, 그 둘을
 * 파일-로컬 목으로 통제해 QueryClientProvider 없이 렌더한다.
 *
 * 무엇을 보장하나:
 *  - AC-4: 지난 여행 카드를 누르면 그 여행의 요약으로 push('/trips/{id}/records/summary').
 *    (j02 기록 비교 삭제 — TRIP-769. 최종 목적지 `/records`→`/records/summary`(j04) 재지정 — TRIP-767.)
 *  - AC-5: 저장 여행 0건이면 빈 상태 + 새 여행 버튼이 push('/trips/new/step1') · placeholder 소멸.
 *  - AC-6: 이전/다음 월 화살표가 월 상태를 shiftMonth 기반으로 바꾼다(라벨 상대 변화·원복).
 *
 * 3동작 뼈대: 준비=trips 목 + push 스파이 → 실행=render/press → 단언=push 인자·라벨 전이.
 */

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}));

const mockUseGetTrips = jest.fn();
jest.mock('@/shared/api/generated/trips/trips', () => ({
  useGetTrips: (...args: unknown[]) => mockUseGetTrips(...args),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const RecordsRoute = require('@/app/(tabs)/records').default;

/** required 10필드를 채운 최소 Trip — 테스트가 보는 축만 덮어쓴다. */
function trip(
  overrides: Pick<Trip, 'tripId' | 'title' | 'startDate' | 'endDate' | 'status'>
): Trip {
  return {
    party: 2,
    destinations: [],
    preferenceSnapshot: {},
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  } as unknown as Trip;
}

function setTrips(data: Trip[]): void {
  mockUseGetTrips.mockReturnValue({
    data,
    isPending: false,
    isError: false,
  });
}

beforeEach(() => {
  mockPush.mockClear();
  mockUseGetTrips.mockReset();
});

describe('지난 여행 선택 → 여행 요약 (AC-4)', () => {
  it('카드를 누르면 그 여행의 records/summary(j04)로 push한다', () => {
    // 준비: status ENDED 여행 하나(오늘과 무관하게 "지난 여행"이라 결정론).
    setTrips([
      trip({
        tripId: 't9',
        title: '부산 여행',
        startDate: '2026-05-10',
        endDate: '2026-05-12',
        status: 'ENDED',
      }),
    ]);

    render(<RecordsRoute />);
    fireEvent.press(screen.getByTestId('record-calendar-past-trip-t9'));

    expect(mockPush).toHaveBeenCalledWith('/trips/t9/records/summary');
  });
});

describe('빈 상태 → 새 여행 (AC-5 · AC-1)', () => {
  it('저장 여행 0건이면 placeholder가 사라지고 새 여행 버튼이 위저드로 push한다', () => {
    setTrips([]);

    render(<RecordsRoute />);

    // placeholder 계약 종료(셸 교체).
    expect(screen.queryByTestId('shell-tab-placeholder-records')).toBeNull();

    fireEvent.press(screen.getByTestId('record-calendar-empty-create'));

    expect(mockPush).toHaveBeenCalledWith('/trips/new/step1');
  });
});

describe('월 이동 상태 전이 (AC-6)', () => {
  it('다음을 누르면 월 라벨이 바뀌고, 이전을 누르면 원래대로 돌아온다', () => {
    setTrips([
      trip({
        tripId: 't1',
        title: '여행',
        startDate: '2026-05-10',
        endDate: '2026-05-12',
        status: 'ENDED',
      }),
    ]);

    render(<RecordsRoute />);

    // 현재 달 라벨은 시계값이라 모르지만, 상대 변화만으로 shiftMonth 배선을 결정론적으로 잰다.
    const before = screen.getByTestId('record-calendar-month-label').props
      .children;

    fireEvent.press(screen.getByTestId('record-calendar-next'));
    const afterNext = screen.getByTestId('record-calendar-month-label').props
      .children;
    expect(afterNext).not.toBe(before);

    fireEvent.press(screen.getByTestId('record-calendar-prev'));
    const afterPrev = screen.getByTestId('record-calendar-month-label').props
      .children;
    expect(afterPrev).toBe(before);
  });
});

// ── TRIP-1012 B1 · 새 진입점은 이동 직전 위저드 드래프트를 비운다 (#074 · D9) ─────────────
// 직전 여행이 남긴 드래프트(여행지·기간·인원·동반·예산·취향·만든 여행 id·꼭 갈 곳)가 새 여행으로
// 새지 않게, push 가 불리는 **그 순간** 드래프트가 새 여행의 얼굴(스토어 초기값)인지 잰다.
// 위저드 안 왕복(더 담기 완료·2/4 '처음부터')은 비우지 않는다 — `tripWizardEntryCensus` 참고.
afterEach(resetWizardDraft);

describe('🔴 1012-B1 · 기록 빈 상태 [새 여행] 은 직전 드래프트를 비우고 위저드로 간다', () => {
  it('저장 여행 0건에서 누르면 push 시점의 드래프트가 새 여행의 초기값이고, push 는 step1 로 1회다', () => {
    leavePreviousTripDraft();
    // 앵커 — 아직 안 비었다(픽스처가 조용히 망가지면 아래 단언이 공짜로 통과한다).
    expect(wizardDraftData()).not.toEqual(freshWizardDraft());
    expect(useTripWizardStore.getState().destinations).toHaveLength(1);
    const draftAtPush = captureDraftAtNextCall(mockPush);

    setTrips([]);
    render(<RecordsRoute />);

    fireEvent.press(screen.getByTestId('record-calendar-empty-create'));

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(String(mockPush.mock.calls[0][0])).toBe('/trips/new/step1');
    expect(draftAtPush()).toEqual(freshWizardDraft());
  });
});

// ── TRIP-1015 C · 마킹 날짜·범례를 누르면 그 여행의 방문 기록으로 (US-REC-14 · BR-U5-49 · 결정 2) ──
// 페이지 조립(범례 목록·콜백 배선)은 이 라우트 렌더가 유일한 jest 심판이다 — 화면 콜백만 잠그면 페이지의
// 목적지 문자열 회귀를 못 본다(브리프 맹점 ①). 그래서 라우트를 통째 렌더해 실제 push 인자를 본다.
//
// "오늘"은 페이지가 `seoulDate(new Date())` 로 읽는다 → Date 만 가짜로 고정한다(타이머는 진짜 그대로 —
// 렌더·press 는 동기라 타이머가 필요 없고, 타이머까지 가짜로 바꾸면 다른 describe 에 새기 쉽다).
// 2026-06-11T03:00Z = KST 2026-06-11 12:00.
describe('🔴 1015-C · 기록 캘린더 마킹 날짜·범례 → 그 여행의 방문 기록', () => {
  const NOW = trip({
    tripId: 't-now',
    title: '진행 중 여행',
    startDate: '2026-06-10',
    endDate: '2026-06-12',
    status: 'ACTIVE',
  });
  const PAST = trip({
    tripId: 't-past',
    title: '지난 여행',
    startDate: '2026-06-01',
    endDate: '2026-06-03',
    status: 'ENDED',
  });
  const FUTURE = trip({
    tripId: 't-fut',
    title: '미래 여행',
    startDate: '2026-06-20',
    endDate: '2026-06-22',
    status: 'PLANNED',
  });

  beforeEach(() => {
    jest.useFakeTimers({
      now: new Date('2026-06-11T03:00:00Z'),
      doNotFake: [
        'hrtime',
        'nextTick',
        'performance',
        'queueMicrotask',
        'requestAnimationFrame',
        'cancelAnimationFrame',
        'requestIdleCallback',
        'cancelIdleCallback',
        'setImmediate',
        'clearImmediate',
        'setInterval',
        'clearInterval',
        'setTimeout',
        'clearTimeout',
      ],
    });
    setTrips([NOW, PAST, FUTURE]);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('앵커 — 오늘이 고정돼 6월이 떠 있고, 세 여행의 기간이 마킹돼 있다(마킹 표시는 무회귀)', () => {
    render(<RecordsRoute />);

    expect(screen.getByTestId('record-calendar-month-label')).toHaveTextContent(
      '2026년 6월'
    );
    expect(screen.getByTestId('record-calendar-day-2026-06-11')).toBeSelected();
    expect(screen.getByTestId('record-calendar-day-2026-06-02')).toBeSelected();
    expect(screen.getByTestId('record-calendar-day-2026-06-21')).toBeSelected();
    expect(
      screen.getByTestId('record-calendar-day-2026-06-15')
    ).not.toBeSelected();
    // 누르기 전엔 아무 데도 안 갔다.
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('진행 중 여행의 마킹 날짜를 누르면 /trips/{id}/records 로 1회 간다', () => {
    render(<RecordsRoute />);

    fireEvent.press(screen.getByTestId('record-calendar-day-2026-06-11'));

    expect(mockPush.mock.calls).toEqual([['/trips/t-now/records']]);
  });

  it('지난 여행의 마킹 날짜를 누르면 그 여행의 /records 로 1회 간다(요약 summary 아님)', () => {
    render(<RecordsRoute />);

    fireEvent.press(screen.getByTestId('record-calendar-day-2026-06-02'));

    expect(mockPush.mock.calls).toEqual([['/trips/t-past/records']]);
  });

  it.each([
    ['t-now', '/trips/t-now/records'],
    ['t-past', '/trips/t-past/records'],
  ])('범례 %s 를 누르면 %s 로 1회 간다', (tripId, href) => {
    render(<RecordsRoute />);

    fireEvent.press(screen.getByTestId(`record-calendar-legend-${tripId}`));

    expect(mockPush.mock.calls).toEqual([[href]]);
  });

  it('미래 여행의 마킹 날짜·범례, 마킹 없는 날짜를 눌러도 아무 데도 안 간다', () => {
    render(<RecordsRoute />);
    // 앵커 — 누를 대상이 실재한다(없으면 getByTestId 가 던져 공짜 통과를 막는다).
    const futureDay = screen.getByTestId('record-calendar-day-2026-06-21');
    const futureLegend = screen.getByTestId('record-calendar-legend-t-fut');
    const emptyDay = screen.getByTestId('record-calendar-day-2026-06-15');

    fireEvent.press(futureDay);
    fireEvent.press(futureLegend);
    fireEvent.press(emptyDay);

    expect(mockPush).not.toHaveBeenCalled();
  });

  it('지난 여행 목록 카드는 계속 요약(/records/summary)으로 간다 (무회귀 · TRIP-767)', () => {
    render(<RecordsRoute />);

    fireEvent.press(screen.getByTestId('record-calendar-past-trip-t-past'));

    expect(mockPush.mock.calls).toEqual([['/trips/t-past/records/summary']]);
  });
});

// ── TRIP-1084 · legend 파생이 페이지에서 buildMonthLegends 로 배선된다 (사용자 요청 R2 · 결정 1·2·3) ──
// 순수 함수·화면은 각자 단위 테스트가 잠근다. 여기선 **페이지가 그 둘을 실제로 잇는지**만 본다 —
// 인라인 식이 남아 있으면 작성중 여행이 legend 에 나오고, 묶음·더 보기가 안 생긴다.
// 오늘 = KST 2026-06-11(1015-C 와 같은 고정). `itineraryDayCount` 를 명시한다 — 0 은 작성중(제외).
describe('🔴 TRIP-1084 · 기록 캘린더 legend — 제외·묶음·3줄+더 보기 배선', () => {
  function withDays(t: Trip, itineraryDayCount: number): Trip {
    return { ...t, itineraryDayCount };
  }
  const JUNE_TRIPS: Trip[] = [
    withDays(
      trip({
        tripId: 't-d',
        title: '속초 여행',
        startDate: '2026-06-01',
        endDate: '2026-06-02',
        status: 'ENDED',
      }),
      2
    ),
    withDays(
      trip({
        tripId: 't-b1',
        title: '제주 여행',
        startDate: '2026-06-15',
        endDate: '2026-06-16',
        status: 'PLANNED',
      }),
      2
    ),
    withDays(
      trip({
        tripId: 't-draft',
        title: '작성중 여행',
        startDate: '2026-06-25',
        endDate: '2026-06-27',
        status: 'PLANNED',
      }),
      0
    ),
    withDays(
      trip({
        tripId: 't-a',
        title: '부산 여행',
        startDate: '2026-06-20',
        endDate: '2026-06-22',
        status: 'PLANNED',
      }),
      3
    ),
    withDays(
      trip({
        tripId: 't-b2',
        title: '서귀포 여행',
        startDate: '2026-06-15',
        endDate: '2026-06-16',
        status: 'PLANNED',
      }),
      2
    ),
    withDays(
      trip({
        tripId: 't-c',
        title: '강릉 여행',
        startDate: '2026-06-05',
        endDate: '2026-06-07',
        status: 'ENDED',
      }),
      2
    ),
  ];
  const GROUP = 'record-calendar-legend-group-2026-06-15_2026-06-16';

  beforeEach(() => {
    jest.useFakeTimers({
      now: new Date('2026-06-11T03:00:00Z'),
      doNotFake: [
        'hrtime',
        'nextTick',
        'performance',
        'queueMicrotask',
        'requestAnimationFrame',
        'cancelAnimationFrame',
        'requestIdleCallback',
        'cancelIdleCallback',
        'setImmediate',
        'clearImmediate',
        'setInterval',
        'clearInterval',
        'setTimeout',
        'clearTimeout',
      ],
    });
    setTrips(JUNE_TRIPS);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('작성중 여행은 legend 에서 빠지되 마킹은 남고, 같은 기간은 한 줄, 앞 3줄 + "더 보기 1" → 펼쳐 숨은 지난 여행으로 간다', () => {
    // 준비 / 실행
    render(<RecordsRoute />);

    // 단언 ① 제외(결정 1) — legend 줄은 없고 그 날짜 마킹은 그대로(BR-U5-49).
    expect(screen.getByTestId('record-calendar-month-label')).toHaveTextContent(
      '2026년 6월'
    );
    expect(screen.queryByTestId('record-calendar-legend-t-draft')).toBeNull();
    expect(screen.getByTestId('record-calendar-day-2026-06-26')).toBeSelected();

    // 단언 ② 묶음(결정 2) — 6.15–6.16 두 여행이 한 줄, 대표는 입력 순서 첫째(제주).
    expect(screen.getByTestId(GROUP)).toHaveTextContent(
      '제주 여행 외 1 · 6.15–6.16 · 1박 2일'
    );
    expect(screen.queryByTestId('record-calendar-legend-t-b1')).toBeNull();

    // 단언 ③ 정렬·자르기 — 시작일 내림차순 앞 3줄, 속초(6.1)는 숨고 '더 보기 1'.
    expect(screen.getByTestId('record-calendar-legend-t-a')).toBeOnTheScreen();
    expect(screen.getByTestId('record-calendar-legend-t-c')).toBeOnTheScreen();
    expect(screen.queryByTestId('record-calendar-legend-t-d')).toBeNull();
    expect(screen.getByTestId('record-calendar-legend-more')).toHaveTextContent(
      '더 보기 1'
    );

    // 실행 ② 더 보기 → 숨었던 지난 여행 줄을 누른다(결정 3 제자리 펼침).
    fireEvent.press(screen.getByTestId('record-calendar-legend-more'));
    fireEvent.press(screen.getByTestId('record-calendar-legend-t-d'));

    // 단언 ④ 펼친 줄도 같은 누름 배선(열 수 있는 여행 → 방문 기록).
    expect(mockPush.mock.calls).toEqual([['/trips/t-d/records']]);
  });

  it('묶음 줄을 누르면 어디로도 가지 않고 구성원 줄이 나타난다', () => {
    render(<RecordsRoute />);
    // 앵커 — 누르기 전엔 구성원 줄이 없다.
    expect(screen.queryByTestId('record-calendar-legend-t-b2')).toBeNull();

    fireEvent.press(screen.getByTestId(GROUP));

    expect(mockPush).not.toHaveBeenCalled();
    expect(screen.getByTestId('record-calendar-legend-t-b1')).toBeOnTheScreen();
    expect(screen.getByTestId('record-calendar-legend-t-b2')).toBeOnTheScreen();
  });

  // 5-b 경고 1 보강(오케) — 페이지가 legend 를 **보고 있는 달**로 만드는지 잠근다. 오늘 달(6월)로
  // 만들면 7월로 넘겨도 6월 여행 줄이 남는데, 위 두 케이스는 6월에서만 렌더해 그걸 못 본다.
  it('다음 달로 넘기면 6월 여행 legend 줄이 사라진다(legend 는 보고 있는 달 기준)', () => {
    // 준비 — 6월 앵커: 부산 줄이 보인다.
    render(<RecordsRoute />);
    expect(screen.getByTestId('record-calendar-legend-t-a')).toBeOnTheScreen();

    // 실행 — 다음 달.
    fireEvent.press(screen.getByTestId('record-calendar-next'));

    // 단언 — 7월 라벨이고, 6월에만 걸친 여행 줄·묶음·더 보기가 없다.
    expect(screen.getByTestId('record-calendar-month-label')).toHaveTextContent(
      '2026년 7월'
    );
    expect(screen.queryByTestId('record-calendar-legend-t-a')).toBeNull();
    expect(screen.queryByTestId(GROUP)).toBeNull();
    expect(screen.queryByTestId('record-calendar-legend-more')).toBeNull();
  });
});
