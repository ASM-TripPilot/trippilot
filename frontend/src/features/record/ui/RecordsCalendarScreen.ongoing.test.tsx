import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

import type {
  LegendRow,
  MonthLegends,
  OngoingTripCardVM,
  PastTripCardVM,
} from '@/features/record/model/recordsCalendar';
import type { MonthCell } from '@/shared/date/monthGrid';

import {
  RecordsCalendarScreen,
  type RecordsCalendarScreenProps,
} from './RecordsCalendarScreen';

/**
 * TRIP-1120 · j07 진행 중 여행 카드 + legend 줄 `›` — 화면(props 만, 목 없음).
 *
 * 화면은 판정을 모른다. 페이지가 고른 카드 한 장(`ongoingTrip`)과 "누르면 이동하는 여행" 집합
 * (`openableTripIds`)을 받아 그리기만 한다. Figma 4761:2930(default) · 4761:3107(접힘) · 4761:3301(펼침).
 *
 * 무엇을 보장하나:
 *  - AC-7 카드가 앱바 아래·캘린더 위에 제목·`여행 중`·`기간 · N일차` 로 뜬다. 안 주면 카드 없이 기존 화면 그대로.
 *  - AC-8 두 버튼이 각자 자기 콜백만 부른다(서로 바뀌면 j01·i01 이 뒤바뀐다).
 *  - AC-9 `›` 는 누르면 이동하는 줄에만 — 미래 줄·미래 묶음에는 없다(INV-4). 집합을 안 주면 어디에도 없다.
 *
 * 3동작 뼈대: 준비 = props → 실행 = render/press → 단언 = 렌더 트리·콜백.
 */

const GRID: (MonthCell | null)[] = [null, { date: '2026-06-01', day: 1 }];

const ONGOING: OngoingTripCardVM = {
  tripId: 't-now',
  title: '부산 여행',
  dateRangeLabel: '2026.6.10–6.12',
  dayLabel: '2일차',
};

function card(tripId: string, title: string, range: string): PastTripCardVM {
  return { tripId, title, dateRangeLabel: range, nightsLabel: '2박 3일' };
}

const tripRow = (c: PastTripCardVM): LegendRow => ({ kind: 'trip', ...c });

function groupRow(
  key: string,
  range: string,
  members: PastTripCardVM[]
): LegendRow {
  return {
    kind: 'group',
    key,
    representativeTitle: members[0].title,
    dateRangeLabel: range,
    nightsLabel: '2박 3일',
    members,
  };
}

const PAST_KEY = '2026-06-01_2026-06-03';
const FUT_KEY = '2026-06-20_2026-06-22';

/** 지난·진행·미래 개별 줄 + 지난 묶음 + 미래 묶음. 화면은 받은 대로 전부 그린다(hiddenCount 0). */
const LEGENDS: MonthLegends = {
  rows: [
    groupRow(FUT_KEY, '6.20–6.22', [
      card('gf1', '제주 여행', '6.20–6.22'),
      card('gf2', '서귀포 여행', '6.20–6.22'),
    ]),
    tripRow(card('t-fut', '강릉 여행', '6.15–6.17')),
    tripRow(card('t-now', '부산 여행', '6.10–6.12')),
    groupRow(PAST_KEY, '6.1–6.3', [
      card('gp1', '속초 여행', '6.1–6.3'),
      card('gp2', '양양 여행', '6.1–6.3'),
    ]),
    tripRow(card('t-past', '여수 여행', '5.30–5.31')),
  ],
  hiddenCount: 0,
};

const OPENABLE: ReadonlySet<string> = new Set([
  't-now',
  't-past',
  'gp1',
  'gp2',
]);

function baseProps(
  overrides: Partial<RecordsCalendarScreenProps> = {}
): RecordsCalendarScreenProps {
  return {
    monthLabel: '2026년 6월',
    grid: GRID,
    markedDays: [],
    pastTrips: [],
    isEmpty: false,
    onPressPrevMonth: jest.fn(),
    onPressNextMonth: jest.fn(),
    onSelectTrip: jest.fn(),
    onPressCreateTrip: jest.fn(),
    ...overrides,
  };
}

const CARD = 'record-calendar-ongoing';
const RECORDS_BTN = 'record-calendar-ongoing-records';
const HUB_BTN = 'record-calendar-ongoing-hub';
const legend = (suffix: string) => `record-calendar-legend-${suffix}`;
const chevron = (tripId: string) => `record-calendar-legend-chevron-${tripId}`;
const groupChevron = (key: string) =>
  `record-calendar-legend-group-chevron-${key}`;

/** legend 줄 testID(트리 순서). 같은 접두의 더 보기·묶음 개수·`›` 는 뺀다. */
function legendRowIds(): string[] {
  return screen
    .queryAllByTestId(
      /^record-calendar-legend-(?!more)(?!group-count-)(?!chevron-)(?!group-chevron-)/
    )
    .map((el) => el.props.testID as string);
}

/** 화면의 모든 `›`(개별·묶음). 더 보기 chevron(`-more-chevron`)은 접두가 달라 안 걸린다. */
function allChevronIds(): string[] {
  return screen
    .queryAllByTestId(/^record-calendar-legend-(group-)?chevron-/)
    .map((el) => el.props.testID as string);
}

describe('🔴 TRIP-1120 · 진행 중 카드 — 앱바 아래·캘린더 위 (AC-7)', () => {
  it('제목·"여행 중"·"기간 · N일차"와 두 버튼을 그리고, 월 캘린더보다 앞에 놓인다', () => {
    // 준비 / 실행
    render(<RecordsCalendarScreen {...baseProps({ ongoingTrip: ONGOING })} />);

    // 단언 ① 카드 안 글자(toHaveTextContent 는 완전 일치라 조각은 getByText 로).
    const cardEl = screen.getByTestId(CARD);
    expect(within(cardEl).getByText('부산 여행')).toBeOnTheScreen();
    expect(within(cardEl).getByText('여행 중')).toBeOnTheScreen();
    expect(
      within(cardEl).getByText('2026.6.10–6.12 · 2일차')
    ).toBeOnTheScreen();
    expect(within(cardEl).getByTestId(RECORDS_BTN)).toHaveTextContent(
      '오늘 기록 보기'
    );
    expect(within(cardEl).getByTestId(HUB_BTN)).toHaveTextContent(
      '일정 허브로'
    );

    // 단언 ② 배치 — 트리 순서상 카드가 월 캘린더 앞(캘린더 위).
    expect(
      screen
        .queryAllByTestId(/^record-calendar-(ongoing|month)$/)
        .map((el) => el.props.testID)
    ).toEqual([CARD, 'record-calendar-month']);

    // 단언 ③ INV-3 — 카드 어디에도 소요시간이 없다(N일차는 순번).
    const texts = within(cardEl)
      .queryAllByText(/.+/)
      .map((el) => String(el.props.children));
    expect(texts.some((t) => /\d+\s*(분|시간)|소요/.test(t))).toBe(false);
  });

  it.each([
    ['null', null],
    ['미지정', undefined],
  ])(
    'ongoingTrip 이 %s 이면 카드가 없고 캘린더·legend 는 그대로다',
    (_l, ongoingTrip) => {
      render(
        <RecordsCalendarScreen
          {...baseProps({ ongoingTrip, monthLegends: LEGENDS })}
        />
      );

      expect(screen.queryByTestId(CARD)).toBeNull();
      expect(screen.queryByTestId(RECORDS_BTN)).toBeNull();
      expect(screen.queryByTestId(HUB_BTN)).toBeNull();
      // 긍정 짝 — 나머지 화면은 살아 있다.
      expect(screen.getByTestId('record-calendar-month')).toBeOnTheScreen();
      expect(legendRowIds()).toHaveLength(5);
    }
  );
});

describe('🔴 TRIP-1120 · 카드 두 버튼 — 각자 자기 콜백만 (AC-8)', () => {
  it('[오늘 기록 보기]는 records 콜백만, [일정 허브로]는 hub 콜백만 tripId 로 1회 부른다', () => {
    // 준비
    const onPressOngoingRecords = jest.fn();
    const onPressOngoingHub = jest.fn();
    render(
      <RecordsCalendarScreen
        {...baseProps({
          ongoingTrip: ONGOING,
          onPressOngoingRecords,
          onPressOngoingHub,
        })}
      />
    );

    // 실행 ① → 단언 ①
    fireEvent.press(screen.getByTestId(RECORDS_BTN));
    expect(onPressOngoingRecords.mock.calls).toEqual([['t-now']]);
    expect(onPressOngoingHub).not.toHaveBeenCalled();

    // 실행 ② → 단언 ②
    fireEvent.press(screen.getByTestId(HUB_BTN));
    expect(onPressOngoingHub.mock.calls).toEqual([['t-now']]);
    expect(onPressOngoingRecords).toHaveBeenCalledTimes(1);
  });
});

describe('🔴 TRIP-1120 · legend `›` — 누르면 이동하는 줄에만 (AC-9 · INV-4)', () => {
  it('지난·진행 줄과 지난 묶음에는 그 줄 안에 `›`, 미래 줄·미래 묶음에는 없다. 줄 목록은 그대로다', () => {
    // 준비 / 실행
    render(
      <RecordsCalendarScreen
        {...baseProps({ monthLegends: LEGENDS, openableTripIds: OPENABLE })}
      />
    );

    // 단언 ① `›` 가 줄 목록에 끼어들지 않는다(정규식 보강 + 순서 무변).
    expect(legendRowIds()).toEqual([
      legend(`group-${FUT_KEY}`),
      legend('t-fut'),
      legend('t-now'),
      legend(`group-${PAST_KEY}`),
      legend('t-past'),
    ]);

    // 단언 ② 있는 쪽 — 각 `›` 가 자기 줄(Pressable) 안에 있다.
    expect(
      within(screen.getByTestId(legend('t-now'))).getByTestId(chevron('t-now'))
    ).toBeOnTheScreen();
    expect(
      within(screen.getByTestId(legend('t-past'))).getByTestId(
        chevron('t-past')
      )
    ).toBeOnTheScreen();
    expect(
      within(screen.getByTestId(legend(`group-${PAST_KEY}`))).getByTestId(
        groupChevron(PAST_KEY)
      )
    ).toBeOnTheScreen();

    // 단언 ③ 없는 쪽 — 미래 줄·미래 묶음(줄 자체는 위 ①에서 있음을 확인).
    expect(screen.queryByTestId(chevron('t-fut'))).toBeNull();
    expect(screen.queryByTestId(groupChevron(FUT_KEY))).toBeNull();
    expect(allChevronIds().sort()).toEqual(
      [chevron('t-now'), chevron('t-past'), groupChevron(PAST_KEY)].sort()
    );
  });

  it('묶음을 펼치면 구성원 줄도 같은 규칙 — 지난 묶음 구성원엔 `›`, 미래 묶음 구성원엔 없다', () => {
    render(
      <RecordsCalendarScreen
        {...baseProps({ monthLegends: LEGENDS, openableTripIds: OPENABLE })}
      />
    );

    // 실행 — 두 묶음 모두 펼친다.
    fireEvent.press(screen.getByTestId(legend(`group-${PAST_KEY}`)));
    fireEvent.press(screen.getByTestId(legend(`group-${FUT_KEY}`)));

    // 단언 — 구성원 줄이 실재하고(앵커), `›` 는 지난 쪽만.
    expect(
      within(screen.getByTestId(legend('gp1'))).getByTestId(chevron('gp1'))
    ).toBeOnTheScreen();
    expect(
      within(screen.getByTestId(legend('gp2'))).getByTestId(chevron('gp2'))
    ).toBeOnTheScreen();
    expect(screen.getByTestId(legend('gf1'))).toBeOnTheScreen();
    expect(screen.queryByTestId(chevron('gf1'))).toBeNull();
    expect(screen.queryByTestId(chevron('gf2'))).toBeNull();
  });

  it('openableTripIds 를 안 주면 줄은 그대로 있고 `›` 는 어디에도 없다(기존 화면·프리뷰 무변화)', () => {
    render(<RecordsCalendarScreen {...baseProps({ monthLegends: LEGENDS })} />);

    expect(legendRowIds()).toHaveLength(5);
    expect(allChevronIds()).toEqual([]);
  });
});
