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
