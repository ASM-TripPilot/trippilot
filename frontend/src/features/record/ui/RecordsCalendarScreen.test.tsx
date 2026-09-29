import { fireEvent, render, screen } from '@testing-library/react-native';

import type {
  LegendRow,
  MonthLegends,
  PastTripCardVM,
} from '@/features/record/model/recordsCalendar';
import type { MonthCell } from '@/shared/date/monthGrid';

import {
  RecordsCalendarScreen,
  type RecordsCalendarScreenProps,
} from './RecordsCalendarScreen';

/**
 * TRIP-575 · RecordsCalendarScreen — j07 여행 캘린더 허브(무상태 프레젠테이션).
 *
 * *(개념)* 이 화면은 판정·조회·라우팅을 **모른다**. 계산된 값(월 라벨·그리드·마킹된 날·지난 여행
 * 카드·빈 상태 여부)과 콜백만 받아 그리고, 누름을 콜백으로 잇는다. 그래서 목이 필요 없다 —
 * props를 직접 넣고 렌더 트리를 관찰한다.
 *
 * 무엇을 보장하나:
 *  - AC-1: placeholder가 아니라 캘린더 허브(record-calendar-month)를 그린다.
 *  - AC-2: 마킹된 날은 색(jest 사각)이 아니라 `accessibilityState.selected`로 관찰된다(★D3).
 *  - AC-3: 지난 여행 카드가 제목·기간(+박수)만 그린다(사진·통계 없음, 정직 degrade).
 *  - AC-5: 저장 여행 0건이면 빈 캘린더 대신 안내 + 새 여행 버튼.
 *  - 누름 배선: 카드→onSelectTrip · 월 화살표→onPress{Prev,Next}Month · 새 여행→onPressCreateTrip.
 *
 * 3동작 뼈대: 준비=props → 실행=render/press → 단언=렌더 트리·콜백 호출.
 */

/** 6월 그리드의 앞부분만 든 최소 픽스처(1일·2일 셀 + 앞 패딩 null). */
const GRID: (MonthCell | null)[] = [
  null,
  { date: '2026-06-01', day: 1 },
  { date: '2026-06-02', day: 2 },
];

const JEJU_CARD: PastTripCardVM = {
  tripId: 't1',
  title: '제주 여행',
  dateRangeLabel: '2026.5.1–5.3',
  nightsLabel: '2박 3일',
};

/** 콜백은 전부 jest.fn 스파이로 두고, 지정 안 한 props만 케이스별로 덮어쓴다. */
function baseProps(
  overrides: Partial<RecordsCalendarScreenProps> = {}
): RecordsCalendarScreenProps {
  return {
    monthLabel: '2026년 6월',
    grid: GRID,
    markedDays: ['2026-06-02'],
    pastTrips: [JEJU_CARD],
    isEmpty: false,
    onPressPrevMonth: jest.fn(),
    onPressNextMonth: jest.fn(),
    onSelectTrip: jest.fn(),
    onPressCreateTrip: jest.fn(),
    ...overrides,
  };
}

describe('채운 상태 — 캘린더 허브 + 마킹(AC-1 · AC-2)', () => {
  it('캘린더를 그리고, 빈 상태 안내는 안 뜨며, 월 라벨을 보여준다', () => {
    render(<RecordsCalendarScreen {...baseProps()} />);

    expect(screen.getByTestId('record-calendar-month')).toBeOnTheScreen();
    expect(screen.queryByTestId('record-calendar-empty')).toBeNull();
    expect(screen.getByText('2026년 6월')).toBeOnTheScreen();
  });

  it('마킹된 날 셀은 selected, 마킹 안 된 날 셀은 not selected다', () => {
    render(<RecordsCalendarScreen {...baseProps()} />);

    // 2일은 markedDays에 있어 selected, 1일은 없어 not selected.
    // (색 fill은 jest 원리적 사각 — accessibilityState로 관찰, ★D3)
    expect(screen.getByTestId('record-calendar-day-2026-06-02')).toBeSelected();
    expect(
      screen.getByTestId('record-calendar-day-2026-06-01')
    ).not.toBeSelected();
  });
});

describe('지난 여행 카드 — 제목·기간·박수만(AC-3)', () => {
  it('카드가 제목·날짜범위·박수 라벨을 그린다', () => {
    render(<RecordsCalendarScreen {...baseProps()} />);

    expect(
      screen.getByTestId('record-calendar-past-trip-t1')
    ).toBeOnTheScreen();
    expect(screen.getByText('제주 여행')).toBeOnTheScreen();
    expect(screen.getByText('2026.5.1–5.3')).toBeOnTheScreen();
    expect(screen.getByText('2박 3일')).toBeOnTheScreen();
  });

  it('라벨이 null이면 가짜 박수를 만들지 않고 제목만 그린다(정직 degrade)', () => {
    render(
      <RecordsCalendarScreen
        {...baseProps({
          pastTrips: [
            {
              tripId: 't2',
              title: '주말 나들이',
              dateRangeLabel: null,
              nightsLabel: null,
            },
          ],
        })}
      />
    );

    expect(
      screen.getByTestId('record-calendar-past-trip-t2')
    ).toBeOnTheScreen();
    expect(screen.getByText('주말 나들이')).toBeOnTheScreen();
    // 부재 단언은 queryByText(정규식) — getByText는 못 찾으면 throw라 못 쓴다.
    expect(screen.queryByText(/\d+박/)).toBeNull();
  });
});

describe('빈 상태 — 저장 여행 0건(AC-5)', () => {
  it('빈 캘린더 대신 안내 + 새 여행 버튼을 그리고, 캘린더는 안 그린다', () => {
    render(
      <RecordsCalendarScreen
        {...baseProps({
          isEmpty: true,
          grid: [],
          markedDays: [],
          pastTrips: [],
        })}
      />
    );

    expect(screen.getByTestId('record-calendar-empty')).toBeOnTheScreen();
    expect(screen.queryByTestId('record-calendar-month')).toBeNull();
    expect(
      screen.getByTestId('record-calendar-empty-create')
    ).toBeOnTheScreen();
  });

  it('새 여행 버튼을 누르면 onPressCreateTrip이 불린다', () => {
    const onPressCreateTrip = jest.fn();
    render(
      <RecordsCalendarScreen
        {...baseProps({
          isEmpty: true,
          grid: [],
          markedDays: [],
          pastTrips: [],
          onPressCreateTrip,
        })}
      />
    );

    fireEvent.press(screen.getByTestId('record-calendar-empty-create'));

    expect(onPressCreateTrip).toHaveBeenCalledTimes(1);
  });
});

describe('누름 배선 — 월 이동·카드 선택(AC-4 · AC-6)', () => {
  it('이전/다음 월 화살표를 누르면 각 콜백이 한 번씩 불린다', () => {
    const onPressPrevMonth = jest.fn();
    const onPressNextMonth = jest.fn();
    render(
      <RecordsCalendarScreen
        {...baseProps({ onPressPrevMonth, onPressNextMonth })}
      />
    );

    fireEvent.press(screen.getByTestId('record-calendar-prev'));
    fireEvent.press(screen.getByTestId('record-calendar-next'));

    expect(onPressPrevMonth).toHaveBeenCalledTimes(1);
    expect(onPressNextMonth).toHaveBeenCalledTimes(1);
  });

  it('지난 여행 카드를 누르면 그 tripId로 onSelectTrip이 불린다', () => {
    const onSelectTrip = jest.fn();
    render(<RecordsCalendarScreen {...baseProps({ onSelectTrip })} />);

    fireEvent.press(screen.getByTestId('record-calendar-past-trip-t1'));

    expect(onSelectTrip).toHaveBeenCalledWith('t1');
  });
});

// ── TRIP-1084 · legend 최대 3줄 + 더 보기 · 같은 기간 묶음 (사용자 요청 R2 · INV-4 · Figma 4699:2630/2803) ──
// 화면은 `buildMonthLegends` 결과(`MonthLegends` = 묶음·정렬 끝난 전체 줄 + 숨긴 줄 수)를 props 로 받아
// 앞 줄만 그리고, '더 보기 N'·묶음 줄 누름으로 **같은 자리에서** 펼친다. 펼침 상태는 화면 로컬이고
// 월이 바뀌면 처음으로 돌아간다(Seed Q1·Q2·Q6).

const SEOUL = '서울특별시 여행';

function card(
  tripId: string,
  title: string,
  dateRangeLabel: string,
  nightsLabel: string
): PastTripCardVM {
  return { tripId, title, dateRangeLabel, nightsLabel };
}

function tripRow(c: PastTripCardVM): LegendRow {
  return { kind: 'trip', ...c };
}

function groupRow(
  key: string,
  dateRangeLabel: string,
  nightsLabel: string,
  members: PastTripCardVM[]
): LegendRow {
  return {
    kind: 'group',
    key,
    representativeTitle: members[0].title,
    dateRangeLabel,
    nightsLabel,
    members,
  };
}

const G30 = '2026-09-28_2026-09-30';
const G29 = '2026-09-28_2026-09-29';
const SEOUL_30 = ['s1', 's2', 's3', 's4', 's5', 's6'].map((id) =>
  card(id, SEOUL, '9.28–9.30', '2박 3일')
);
const SEOUL_29 = [
  card('k1', SEOUL, '9.28–9.29', '1박 2일'),
  card('k2', '강진군 여행', '9.28–9.29', '1박 2일'),
  card('k3', SEOUL, '9.28–9.29', '1박 2일'),
  card('k4', SEOUL, '9.28–9.29', '1박 2일'),
];
const BUSAN = card('bs', '부산 여행', '9.12–9.14', '2박 3일');
const JEJU = card('jj', '제주 여행', '9.3–9.5', '2박 3일');
const GANGNEUNG = card('gn', '강릉 여행', '9.1–9.2', '1박 2일');

/** Figma 4699:2630 — 묶음 2줄 + 개별 3줄 = 5줄, 앞 3줄 뒤 2줄이 숨는다. */
const FIGMA_LEGENDS: MonthLegends = {
  rows: [
    groupRow(G30, '9.28–9.30', '2박 3일', SEOUL_30),
    groupRow(G29, '9.28–9.29', '1박 2일', SEOUL_29),
    tripRow(BUSAN),
    tripRow(JEJU),
    tripRow(GANGNEUNG),
  ],
  hiddenCount: 2,
};

const id = (suffix: string) => `record-calendar-legend-${suffix}`;
const MORE = 'record-calendar-legend-more';

/**
 * 화면에 보이는 legend 줄(개별·묶음·펼친 구성원)의 testID 를 **트리 순서대로**.
 * 같은 접두를 쓰는 더 보기(`-more`, `-more-chevron`)·묶음 개수(`-group-count-`)·줄 끝 `›`
 * (`-chevron-`, `-group-chevron-`, TRIP-1120)는 뺀다.
 */
function legendRowIds(): string[] {
  return screen
    .queryAllByTestId(
      /^record-calendar-legend-(?!more)(?!group-count-)(?!chevron-)(?!group-chevron-)/
    )
    .map((el) => el.props.testID as string);
}

const COLLAPSED_IDS = [id(`group-${G30}`), id(`group-${G29}`), id('bs')];

describe('🔴 TRIP-1084 · legend 3줄 이하 — 더 보기 없음 (AC-8)', () => {
  it('서로 다른 기간 3줄이면 3줄 전부 보이고 더 보기 줄은 없다', () => {
    // 준비
    const monthLegends: MonthLegends = {
      rows: [tripRow(BUSAN), tripRow(JEJU), tripRow(GANGNEUNG)],
      hiddenCount: 0,
    };

    // 실행
    render(<RecordsCalendarScreen {...baseProps({ monthLegends })} />);

    // 단언
    expect(legendRowIds()).toEqual([id('bs'), id('jj'), id('gn')]);
    expect(screen.getByTestId(id('bs'))).toHaveTextContent(
      '부산 여행 · 9.12–9.14 · 2박 3일'
    );
    expect(screen.queryByTestId(MORE)).toBeNull();
  });

  it('monthLegends 가 없거나 줄이 0개면 legend 도 더 보기도 그리지 않는다', () => {
    render(<RecordsCalendarScreen {...baseProps()} />);
    expect(legendRowIds()).toEqual([]);
    expect(screen.queryByTestId(MORE)).toBeNull();

    render(
      <RecordsCalendarScreen
        {...baseProps({ monthLegends: { rows: [], hiddenCount: 0 } })}
      />
    );
    expect(legendRowIds()).toEqual([]);
    expect(screen.queryByTestId(MORE)).toBeNull();
  });
});

describe('🔴 TRIP-1084 · 4줄 이상 — 앞 3줄 + 더 보기 N, 같은 자리 펼침/접기 (AC-9 · INV-4)', () => {
  it('5줄이면 앞 3줄과 "더 보기 2"(chevron 포함)만 보인다', () => {
    render(
      <RecordsCalendarScreen {...baseProps({ monthLegends: FIGMA_LEGENDS })} />
    );

    expect(legendRowIds()).toEqual(COLLAPSED_IDS);
    expect(screen.queryByTestId(id('jj'))).toBeNull();
    expect(screen.queryByTestId(id('gn'))).toBeNull();
    // toHaveTextContent(문자열)는 완전 일치다 — '더 보기' 와 숫자가 한 줄에 공백 1칸으로.
    expect(screen.getByTestId(MORE)).toHaveTextContent('더 보기 2');
    expect(
      screen.getByTestId('record-calendar-legend-more-chevron')
    ).toBeOnTheScreen();
  });

  it('더 보기를 누르면 5줄 전부와 "접기", 다시 누르면 3줄과 "더 보기 2"로 돌아간다', () => {
    render(
      <RecordsCalendarScreen {...baseProps({ monthLegends: FIGMA_LEGENDS })} />
    );

    // 실행 ① 펼치기
    fireEvent.press(screen.getByTestId(MORE));

    // 단언 ① 숨었던 두 줄이 같은 자리 뒤에 붙고, 버튼은 접기로.
    expect(legendRowIds()).toEqual([...COLLAPSED_IDS, id('jj'), id('gn')]);
    expect(screen.getByTestId(MORE)).toHaveTextContent('접기');
    expect(
      screen.getByTestId('record-calendar-legend-more-chevron')
    ).toBeOnTheScreen();

    // 실행 ② 접기
    fireEvent.press(screen.getByTestId(MORE));

    // 단언 ② 처음 모양
    expect(legendRowIds()).toEqual(COLLAPSED_IDS);
    expect(screen.getByTestId(MORE)).toHaveTextContent('더 보기 2');
  });
});

describe('🔴 TRIP-1084 · 같은 기간 묶음 줄 — "외 N" 한 줄, 누르면 구성원 (AC-10 · AC-11 · AC-12)', () => {
  it('묶음은 "대표 외 N · 기간 · 박수" 한 줄이고, 개수는 중첩 텍스트, 구성원 줄은 아직 없다', () => {
    render(
      <RecordsCalendarScreen {...baseProps({ monthLegends: FIGMA_LEGENDS })} />
    );

    expect(screen.getByTestId(id(`group-${G30}`))).toHaveTextContent(
      '서울특별시 여행 외 5 · 9.28–9.30 · 2박 3일'
    );
    expect(screen.getByTestId(id(`group-count-${G30}`))).toHaveTextContent(
      '외 5'
    );
    // 서울 4건 + 강진 1건 → 대표 서울 '외 3'.
    expect(screen.getByTestId(id(`group-${G29}`))).toHaveTextContent(
      '서울특별시 여행 외 3 · 9.28–9.29 · 1박 2일'
    );
    expect(screen.getByTestId(id(`group-count-${G29}`))).toHaveTextContent(
      '외 3'
    );
    // 같은 기간이 6줄로 반복되지 않는다(접힌 상태).
    SEOUL_30.forEach((m) => {
      expect(screen.queryByTestId(id(m.tripId))).toBeNull();
    });
  });

  it('묶음을 누르면 바로 아래에 구성원이 일반 줄 모양으로 펼쳐지고, 다른 줄은 밀려나지 않는다', () => {
    const onPressLegend = jest.fn();
    render(
      <RecordsCalendarScreen
        {...baseProps({ monthLegends: FIGMA_LEGENDS, onPressLegend })}
      />
    );

    // 실행 ① 묶음 줄 누름
    fireEvent.press(screen.getByTestId(id(`group-${G30}`)));

    // 단언 ① 묶음 줄은 남고 그 바로 아래 구성원 6줄, 이어서 원래 2·3번째 줄(3줄 제한은 최상위 줄 기준).
    expect(legendRowIds()).toEqual([
      id(`group-${G30}`),
      ...SEOUL_30.map((m) => id(m.tripId)),
      id(`group-${G29}`),
      id('bs'),
    ]);
    expect(screen.getByTestId(MORE)).toHaveTextContent('더 보기 2');
    expect(screen.getByTestId(id('s3'))).toHaveTextContent(
      '서울특별시 여행 · 9.28–9.30 · 2박 3일'
    );
    // 묶음은 여행 하나로 갈 수 없다 — 펼치기만 하고 이동 콜백은 안 부른다(결정 2(가)).
    expect(onPressLegend).not.toHaveBeenCalled();

    // 실행 ② 구성원 줄 누름 → 그 여행으로.
    fireEvent.press(screen.getByTestId(id('s3')));
    expect(onPressLegend.mock.calls).toEqual([['s3']]);

    // 실행 ③ 묶음 줄 다시 누름 → 구성원이 접힌다.
    fireEvent.press(screen.getByTestId(id(`group-${G30}`)));
    expect(legendRowIds()).toEqual(COLLAPSED_IDS);
    expect(onPressLegend).toHaveBeenCalledTimes(1);
  });

  it('숨은 영역에 있던 묶음도 더 보기 뒤에 펼칠 수 있다', () => {
    // 준비: 묶음이 4번째 줄(숨은 영역)에 있다.
    const monthLegends: MonthLegends = {
      rows: [
        tripRow(BUSAN),
        tripRow(JEJU),
        tripRow(GANGNEUNG),
        groupRow('2026-08-30_2026-09-01', '8.30–9.1', '2박 3일', [
          card('e1', '경계 여행', '8.30–9.1', '2박 3일'),
          card('e2', '경계 여행', '8.30–9.1', '2박 3일'),
        ]),
      ],
      hiddenCount: 1,
    };
    render(<RecordsCalendarScreen {...baseProps({ monthLegends })} />);
    expect(screen.getByTestId(MORE)).toHaveTextContent('더 보기 1');

    // 실행
    fireEvent.press(screen.getByTestId(MORE));
    fireEvent.press(screen.getByTestId(id('group-2026-08-30_2026-09-01')));

    // 단언
    expect(legendRowIds()).toEqual([
      id('bs'),
      id('jj'),
      id('gn'),
      id('group-2026-08-30_2026-09-01'),
      id('e1'),
      id('e2'),
    ]);
  });

  it('두 펼침은 서로 독립이다 — 더 보기 펼쳤다 접어도 펼친 묶음은 그대로다', () => {
    render(
      <RecordsCalendarScreen {...baseProps({ monthLegends: FIGMA_LEGENDS })} />
    );

    // 실행: 묶음 펼침 → 더 보기 → 접기
    fireEvent.press(screen.getByTestId(id(`group-${G30}`)));
    fireEvent.press(screen.getByTestId(MORE));
    fireEvent.press(screen.getByTestId(MORE));

    // 단언: 더 보기만 접혔고 묶음 구성원은 남는다.
    expect(legendRowIds()).toEqual([
      id(`group-${G30}`),
      ...SEOUL_30.map((m) => id(m.tripId)),
      id(`group-${G29}`),
      id('bs'),
    ]);
    expect(screen.getByTestId(MORE)).toHaveTextContent('더 보기 2');
  });
});

describe('🔴 TRIP-1084 · 월을 바꾸면 펼침이 처음으로 (Seed Q6)', () => {
  it('같은 달로 다시 그려지면 펼침이 유지되고, 다른 달이 되면 더 보기·묶음 펼침이 모두 접힌다', () => {
    // 준비: 9월, 더 보기와 묶음을 둘 다 펼친다.
    const { rerender } = render(
      <RecordsCalendarScreen
        {...baseProps({
          monthLabel: '2026년 9월',
          monthLegends: FIGMA_LEGENDS,
        })}
      />
    );
    fireEvent.press(screen.getByTestId(MORE));
    fireEvent.press(screen.getByTestId(id(`group-${G30}`)));
    // 앵커 — 리셋 전에 실제로 펼쳐져 있다(안 펼쳐졌으면 아래 리셋 단언이 공짜로 통과한다).
    expect(screen.getByTestId(MORE)).toHaveTextContent('접기');
    expect(screen.getByTestId(id('s1'))).toBeOnTheScreen();

    // 실행 ① 같은 달 · 새 객체로 다시 그림(페이지는 렌더마다 새 객체를 만든다).
    rerender(
      <RecordsCalendarScreen
        {...baseProps({
          monthLabel: '2026년 9월',
          monthLegends: { ...FIGMA_LEGENDS, rows: [...FIGMA_LEGENDS.rows] },
        })}
      />
    );
    // 단언 ① 유지
    expect(screen.getByTestId(MORE)).toHaveTextContent('접기');
    expect(screen.getByTestId(id('s1'))).toBeOnTheScreen();

    // 실행 ② 다음 달 — 같은 줄 데이터를 그대로 두어 "달이 바뀌어서" 접혔음을 가른다.
    rerender(
      <RecordsCalendarScreen
        {...baseProps({
          monthLabel: '2026년 10월',
          monthLegends: FIGMA_LEGENDS,
        })}
      />
    );

    // 단언 ② 둘 다 처음 모양
    expect(legendRowIds()).toEqual(COLLAPSED_IDS);
    expect(screen.getByTestId(MORE)).toHaveTextContent('더 보기 2');
  });
});
