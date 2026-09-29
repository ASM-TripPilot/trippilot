import {
  act,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

import { View } from 'react-native';

import { MemoInline } from '@/features/record/ui/MemoInline';
import type { VisitRecordCardVM } from '@/features/record/ui/VisitRecordCard';
import type { MapCenter, MapPin } from '@/shared/map';
import {
  closestAncestor,
  isInsideSheet,
  renderedText,
  sheetScrollOf,
  treeIndexOf,
} from '@/test-support/sheetTree';

import { TripRecordsView, type TripRecordsViewProps } from './TripRecordsView';

// 셸이 네이버 네이티브 MapView 를 태우므로 관찰 목으로 갈아끼운다(LiveHubView·옛 TripRecordsScreen 선례).
// 시트는 `__mocks__/@gorhom/bottom-sheet` 통과형 목이 자동으로 쓰인다.
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/shared/map', () => require('@/test-support/mapViewMock'));

/**
 * TRIP-1085 · j01 방문 기록 **순수 뷰**(pages · 셸 조립) — 전면 지도 + 바텀시트(MapSheetShell).
 *
 * 무엇을 보장하나:
 *  - 골격(AC-1): 셸 지도 하나가 시트 뒤에 있고 카드는 시트 안이다. 하단 탭바·옛 250px 지도 블록은 없다.
 *  - 시트 헤더(AC-12): "여행명 · N일차 · M월 D일(요일) · N곳" 한 줄. 여행명이 없으면 그 조각만 빠진다.
 *  - 일차 칩·뒤로(AC-2·3): 셸 칩(`sheet-daychip-{index}`)이 일자를, `sheet-daychip-back` 이 뒤로를 올린다.
 *  - 키보드(AC-9): 카드·계획 행·[방문 추가]가 `keyboardShouldPersistTaps="handled"` 스크롤 안에 있다.
 *  - 순서(Figma 4705:2756): 헤더 → 귀속 → 안내문 → 카드 → 계획 행 → [방문 추가].
 *  - 지도 실패(AC-7): 지도 자리만 폴백 바로 바뀌고 헤더·카드·칩은 그대로다.
 *  - 지도 prop(결정 2(a)·3(c)): 잠금(viewOnly) · 핀 전부 맞추기(fitPins) · 받은 핀 그대로.
 *  - 옮겨 온 무회귀: 귀속 헤더(TRIP-569) · 즉석 추가·하트 FAB 부재(TRIP-759) · 안내문 분기(TRIP-760).
 *
 * ⚠️ 원리적 사각: 시트 실제 스냅·딤·키보드가 시트를 밀어 올리는지·지도 제스처는 통과형 목이 못 본다
 *   (6-b). 여기서는 testID 트리·prop 전달·콜백까지만 잠근다.
 *
 * (개념) `UNSAFE_root` = 렌더 트리 맨 위 노드(조상 탐색·순서 비교용) · `toBeSelected()` = 그 노드의
 *   `accessibilityState.selected` 가 true · `toHaveTextContent('문자열')` = 글자 **전체**가 정확히 같다.
 * 3동작: 준비(3일 여행·카드 2·계획 행 2) → 실행(렌더·press) → 단언(testID·글자·콜백·prop).
 */

const CENTER: MapCenter = { lat: 35.1532, lng: 129.1187 };
const PINS: MapPin[] = [
  { number: 1, lat: 35.1532, lng: 129.1187 },
  { number: 2, lat: 35.1555, lng: 129.1216 },
];
const DEFAULT_COPY = '오늘의 동선 · 방문한 곳을 사진과 메모로 남겨요';
const ERROR_COPY = '오늘 방문한 곳 — 핀은 방문 완료, 빈 핀은 예정';

type PlanRow = NonNullable<TripRecordsViewProps['planRows']>[number];

const DONE_CARD: VisitRecordCardVM = {
  visitCheckId: 'v-a',
  slotKey: '2026-06-11#p1',
  poiId: 'p1',
  nameKo: '광안리 해변',
  arrivedAt: '2026-06-11T14:20:00',
  completedAt: '2026-06-11T15:20:00',
  skippedAt: null,
  arrivedLabel: '14:20',
};
const UPCOMING_CARD: VisitRecordCardVM = {
  visitCheckId: 'v-b',
  slotKey: '2026-06-11#p2',
  poiId: 'p2',
  nameKo: '부산시립미술관',
  arrivedAt: null,
  completedAt: null,
  skippedAt: null,
  arrivedLabel: null,
};
const ROW_P3: PlanRow = {
  slotKey: '2026-06-11#p3',
  poiId: 'p3',
  nameKo: '○○ 카페',
};
const ROW_P4: PlanRow = {
  slotKey: '2026-06-11#p4',
  poiId: 'p4',
  nameKo: '△△ 시장',
};

function baseProps(): TripRecordsViewProps {
  return {
    tripTitle: '부산 여행',
    dayTabs: [
      { day: '2026-06-10', label: '1일차' },
      { day: '2026-06-11', label: '2일차' },
      { day: '2026-06-12', label: '3일차' },
    ],
    activeDay: '2026-06-11',
    onSelectDay: jest.fn(),
    onPressBack: jest.fn(),
    mapCenter: CENTER,
    mapPins: PINS,
    cards: [DONE_CARD, UPCOMING_CARD],
    planRows: [ROW_P3, ROW_P4],
    onPressComplete: jest.fn(),
    onPressSkip: jest.fn(),
    onPressSpontaneous: jest.fn(),
  };
}

function renderView(overrides: Partial<TripRecordsViewProps> = {}) {
  const props = { ...baseProps(), ...overrides };
  render(<TripRecordsView {...props} />);
  return props;
}

describe('🔴 TRIP-1085 AC-1 · 전면 지도 + 바텀시트 골격', () => {
  it('V1 셸 지도 하나가 시트 밖에 있고, 카드는 시트 안이며, 하단 탭바는 없다', () => {
    renderView();

    const root = screen.getByTestId('record-trip-view');
    expect(within(root).getByTestId('map-sheet-shell-root')).toBeOnTheScreen();
    // 지도는 셸의 것 하나뿐 — 옛 250px 히어로가 남으면 2개가 된다.
    expect(screen.getAllByTestId('map-root')).toHaveLength(1);
    expect(isInsideSheet(screen.getByTestId('map-root'))).toBe(false);
    expect(
      isInsideSheet(screen.getByTestId('record-trip-visit-card-v-a'))
    ).toBe(true);
    // 결정 1(b) — 탭바 없음.
    expect(screen.queryByTestId('shell-tabbar-root')).toBeNull();
  });
});

describe('🔴 TRIP-1085 AC-12 · 시트 헤더 한 줄', () => {
  it('V2 "부산 여행 · 2일차 · 6월 11일(목) · 4곳"(카드 2 + 계획 행 2)이 시트 안에 한 줄로 선다', () => {
    renderView();

    const header = screen.getByTestId('record-trip-sheet-header');
    expect(header).toHaveTextContent('부산 여행 · 2일차 · 6월 11일(목) · 4곳');
    expect(isInsideSheet(header)).toBe(true);
  });

  it.each([
    ['여행명 없음', undefined],
    ['여행명 빈 문자열', ''],
  ])('V2b %s → 여행명 조각만 빠진다 (INV-4)', (_label, tripTitle) => {
    renderView({ tripTitle });

    expect(screen.getByTestId('record-trip-sheet-header')).toHaveTextContent(
      '2일차 · 6월 11일(목) · 4곳'
    );
  });
});

describe('🔴 TRIP-1085 AC-2·AC-3 · 셸 일차 칩과 뒤로', () => {
  it('V3 칩 3개에 라벨이 서고 활성 일자가 선택돼 있으며, 3일차 칩을 누르면 그 날짜가 1회 올라간다', () => {
    const props = renderView();

    expect(
      within(screen.getByTestId('sheet-daychip-0')).getByText('1일차')
    ).toBeOnTheScreen();
    expect(
      within(screen.getByTestId('sheet-daychip-2')).getByText('3일차')
    ).toBeOnTheScreen();
    expect(screen.getByTestId('sheet-daychip-1')).toBeSelected();
    expect(screen.getByTestId('sheet-daychip-0')).not.toBeSelected();

    fireEvent.press(screen.getByTestId('sheet-daychip-2'));

    expect(props.onSelectDay).toHaveBeenCalledTimes(1);
    expect(props.onSelectDay).toHaveBeenCalledWith('2026-06-12');
    // 옛 일자 탭은 사라졌다.
    expect(screen.queryAllByTestId(/^record-trip-day-tab-/)).toHaveLength(0);
  });

  it('V4 ‹(sheet-daychip-back)를 누르면 onPressBack 이 1회 불리고, 옛 record-trip-back 은 없다', () => {
    const props = renderView();

    fireEvent.press(screen.getByTestId('sheet-daychip-back'));

    expect(props.onPressBack).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('record-trip-back')).toBeNull();
  });
});

describe('🔴 TRIP-1085 AC-9 · 키보드가 떠 있어도 시트 안 첫 탭이 버튼으로 간다', () => {
  it('V5 카드·계획 행·[방문 추가]를 감싼 시트 스크롤의 keyboardShouldPersistTaps 가 "handled"다', () => {
    renderView();

    const targets = [
      screen.getByTestId('record-trip-visit-card-v-a'),
      screen.getByTestId('record-trip-visit-card-v-b'),
      screen.getByTestId(`record-trip-plan-row-${ROW_P3.slotKey}`),
      screen.getByTestId('record-trip-spontaneous-add'),
    ];
    targets.forEach((node) => {
      const scroll = sheetScrollOf(node);
      expect(scroll).not.toBeNull();
      expect(scroll?.props.keyboardShouldPersistTaps).toBe('handled');
    });
  });
});

describe('🔴 TRIP-1085 · 시트 본문 순서 (Figma 4705:2756)', () => {
  it('V6 헤더 → 귀속 → 안내문 → 카드 → 계획 행 → [방문 추가] 순으로 그려진다', () => {
    renderView({
      attribution: { stayName: '해운대 그랜드 호텔', dayLabel: '2일차' },
    });

    const at = (node: Parameters<typeof treeIndexOf>[1]) =>
      treeIndexOf(screen.UNSAFE_root, node);
    const order = [
      at(screen.getByTestId('record-trip-sheet-header')),
      at(screen.getByTestId('record-trip-attribution-stay')),
      at(screen.getByText(DEFAULT_COPY)),
      at(screen.getByTestId('record-trip-visit-card-v-a')),
      at(screen.getByTestId(`record-trip-plan-row-${ROW_P3.slotKey}`)),
      at(screen.getByTestId('record-trip-spontaneous-add')),
    ];

    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});

describe('🔴 TRIP-1085 AC-7 · 지도 로드 실패 (INV-4)', () => {
  it('V7 지도가 실패를 알리면 지도 자리만 폴백 바가 되고 헤더·카드·일차 칩은 그대로다', () => {
    renderView();

    act(() => {
      screen.getByTestId('map-root').props.onLoadFailed();
    });

    expect(screen.getByTestId('map-sheet-fallback')).toBeOnTheScreen();
    expect(screen.queryByTestId('map-root')).toBeNull();
    expect(screen.getByTestId('record-trip-sheet-header')).toBeOnTheScreen();
    expect(screen.getByTestId('record-trip-visit-card-v-a')).toBeOnTheScreen();
    expect(screen.getByTestId('sheet-daychip-1')).toBeOnTheScreen();
  });
});

describe('🔴 TRIP-1085 결정 2(a)·3(c) · 지도 prop', () => {
  it('V8 지도는 잠겨 있고(viewOnly) 핀 전부 맞추기(fitPins)가 켜져 있으며, 받은 핀을 그대로 넘긴다', () => {
    renderView();

    const map = screen.getByTestId('map-root');
    expect(map.props.viewOnly).toBe(true);
    expect(map.props.fitPins).toBe(true);
    expect(map.props.pins).toEqual(PINS);
  });
});

describe('🔴 TRIP-1085 AC-6 · 빈 상태·조회 실패 표면도 시트 안', () => {
  it('V9a 방문 0건이면 record-trip-empty 가 시트 안에 선다', () => {
    renderView({ cards: [], planRows: [] });

    expect(isInsideSheet(screen.getByTestId('record-trip-empty'))).toBe(true);
  });

  it('V9b 조회 실패면 record-trip-error 가 시트 안에 선다', () => {
    renderView({ cards: [], planRows: [], recordsStatus: 'error' });

    expect(isInsideSheet(screen.getByTestId('record-trip-error'))).toBe(true);
  });
});

describe('🔴 TRIP-1085 AC-14 · 체류·소요 시간 0 (BR-U5-08 · INV-3)', () => {
  it('V10 헤더·카드·계획 행 어디에도 N분·N시간·소요·체류가 없다', () => {
    renderView();

    const text = renderedText(screen.UNSAFE_root);
    // 짝 — 렌더가 비지 않았다(장소명·헤더가 있다).
    expect(text).toContain('광안리 해변');
    expect(text).toContain('6월 11일(목)');
    expect(/(\d+\s*분|\d+\s*시간|소요|체류)/.test(text)).toBe(false);
  });
});

/**
 * TRIP-569 · US-REC-05 · AC-7 — 일자별 귀속 그룹 헤더(옛 TripRecordsScreen.test 에서 옮김, 단언 무수정).
 * 숙소 있는 날만 testID(-stay) 줄이 선다 — 숙소 없는 날은 줄 자체가 없다(TRIP-1097, 아래 describe).
 * 숙소명·라벨은 각자 별 Text leaf 라 `getByText(문자열)` 완전 일치로 찾는다.
 */
/**
 * 🔴 TRIP-1085 5-b 보강(code-critic 경고 1) — 카드 이름표(key)는 방문 id 다. 같은 날 순서가 바뀌어도 메모
 * 초안은 제 방문을 따라간다.
 *
 * 왜: `MemoInline` 은 초안을 **첫 마운트 때 한 번만** 심는다(seed-once). 리스트가 자리 번호(index)를 key 로
 * 쓰면, 같은 날 안에서 순서만 바뀔 때(시각 수정 → 도착순 재정렬) 0번 자리 컴포넌트가 그대로 살아 다른 방문을
 * 받는다 → A 에 쓰던 초안이 B 칸에 남고, blur 되면 **A 의 메모가 B 로 저장된다**. 날짜 전환 테스트(통합
 * seed-once)는 로딩 동안 목록이 비워져 key 와 무관하게 새로 마운트되므로 이 경로를 못 잡는다.
 *
 * (개념) `rerender(ui)` = 같은 화면을 새 props 로 다시 그린다(마운트 유지 — 상태가 남는지 볼 수 있다).
 * 3동작: 준비(카드 A·B + 카드마다 메모 칸) → 실행(A 에 초안 입력 → 순서만 [B, A] 로 다시 그림) →
 *   단언(B 칸 = B 의 값, A 칸 = A 의 초안).
 */
describe('🔴 TRIP-1085 5-b · 같은 날 재정렬에도 메모 초안이 제 방문을 따라간다 (key = 방문 id)', () => {
  it('V11 A 에 초안을 쓰고 카드 순서가 [B, A] 로 바뀌면, B 칸은 B 값·A 칸은 A 초안 그대로다', () => {
    const cardA: VisitRecordCardVM = { ...DONE_CARD, visitCheckId: 'v-a' };
    const cardB: VisitRecordCardVM = {
      ...DONE_CARD,
      visitCheckId: 'v-b',
      slotKey: '2026-06-11#p2',
      poiId: 'p2',
      nameKo: '부산시립미술관',
    };
    const renderCard = (card: VisitRecordCardVM) => (
      <View testID={`wrap-${card.visitCheckId}`}>
        <MemoInline text={`memo-${card.visitCheckId}`} />
      </View>
    );
    const memoOf = (id: string) =>
      within(screen.getByTestId(`wrap-${id}`)).getByTestId(
        'record-trip-memo-input'
      ).props.value;

    // 준비 — A·B 순서로 그리고 A 칸에 초안을 입력한다.
    const { rerender } = render(
      <TripRecordsView
        {...baseProps()}
        planRows={[]}
        cards={[cardA, cardB]}
        renderCard={renderCard}
      />
    );
    fireEvent.changeText(
      within(screen.getByTestId('wrap-v-a')).getByTestId(
        'record-trip-memo-input'
      ),
      'draft-A'
    );

    // 실행 — 같은 날 안에서 순서만 뒤집는다(시각 수정 → 도착순 재정렬과 같은 모양).
    rerender(
      <TripRecordsView
        {...baseProps()}
        planRows={[]}
        cards={[cardB, cardA]}
        renderCard={renderCard}
      />
    );

    // 단언 — 초안은 자리 번호가 아니라 방문을 따라간다.
    expect(memoOf('v-b')).toBe('memo-v-b');
    expect(memoOf('v-a')).toBe('draft-A');
  });
});

describe('AC-7 · 숙소 있는 날 — 숙소명 + 날짜 귀속 헤더', () => {
  it('record-trip-attribution-stay 에 숙소명·라벨이 뜨고 date-only 헤더는 없다', () => {
    renderView({ attribution: { stayName: '충무로 호텔', dayLabel: '2일차' } });

    expect(screen.getByTestId('record-trip-attribution-stay')).toBeTruthy();
    expect(screen.queryByTestId('record-trip-attribution-date')).toBeNull();
    expect(screen.getByText('충무로 호텔')).toBeTruthy();
    expect(
      within(screen.getByTestId('record-trip-attribution-stay')).getByText(
        '2일차'
      )
    ).toBeTruthy();
  });
});

/**
 * TRIP-1097 결정 1 — 숙소 없는 날(당일치기·이동일)은 귀속 줄을 그리지 않는다. 일차·날짜는 시트 헤더
 * 한 줄이 이미 보이므로 BR-U5-26 "날짜만으로 묶는다"는 헤더가 맡는다(옛 date-only 줄은 헤더와 중복).
 * 3동작: 준비(숙소 null · 2일차) → 실행(렌더) → 단언(귀속 줄 둘 다 없음 · 헤더 그대로 · 일차 칩 밖에
 * 딱 "2일차"만 적힌 글자 없음 · 안내문은 헤더 뒤 그대로).
 */
describe('🔴 TRIP-1097 · 숙소 없는 날 — 귀속 줄 없음(헤더가 날짜 귀속)', () => {
  it('귀속 줄이 없고, 헤더는 그대로이며, "2일차" 단독 글자는 일차 칩뿐이다', () => {
    renderView({ attribution: { stayName: null, dayLabel: '2일차' } });

    expect(screen.queryByTestId('record-trip-attribution-date')).toBeNull();
    expect(screen.queryByTestId('record-trip-attribution-stay')).toBeNull();
    expect(screen.getByTestId('record-trip-sheet-header')).toHaveTextContent(
      '부산 여행 · 2일차 · 6월 11일(목) · 4곳'
    );
    // getAllByText('2일차') = 글자 전체가 정확히 "2일차"인 Text 전부(헤더 한 줄은 긴 문자열이라 안 걸린다).
    // 일차 칩(sheet-daychip-*) 안의 것을 빼면 0개여야 한다 — 귀속 줄이 되살아나면 1개가 된다.
    const outsideChips = screen
      .getAllByText('2일차')
      .filter(
        (node) =>
          closestAncestor(node, (candidate) =>
            /^sheet-daychip-/.test(String(candidate.props.testID ?? ''))
          ) === null
      );
    expect(outsideChips).toHaveLength(0);
    // 무회귀 — 안내문은 헤더 뒤에 그대로 선다.
    const at = (node: Parameters<typeof treeIndexOf>[1]) =>
      treeIndexOf(screen.UNSAFE_root, node);
    expect(at(screen.getByTestId('record-trip-sheet-header'))).toBeLessThan(
      at(screen.getByText(DEFAULT_COPY))
    );
  });
});

describe('🔴 TRIP-759 · 귀속 헤더·일자 칩·즉석 추가 유지 + 하트 FAB 제거', () => {
  it('일자 칩·즉석 추가는 헤더와 함께 남고, record-trip-saved-fab 는 사라진다', () => {
    renderView({ attribution: { stayName: '충무로 호텔', dayLabel: '2일차' } });

    // TRIP-1085 — 일자 탭은 셸 칩(sheet-daychip-{index})으로 옮겨 갔다.
    expect(screen.getByTestId('sheet-daychip-0')).toBeTruthy();
    expect(screen.getByTestId('record-trip-spontaneous-add')).toBeTruthy();
    expect(screen.queryByTestId('record-trip-saved-fab')).toBeNull();
  });
});

/**
 * TRIP-760 · AC-6 — 안내문 카피 prop 분기(옮김). 주면 그 문자열, 안 주면 default.
 * error 카피의 `—` 는 EM DASH(U+2014), default 의 `·` 는 U+00B7.
 */
describe('🔴 TRIP-760 · AC-6 · 안내문 카피 prop 분기', () => {
  it('A6a · noticeCopy 주입 → error 카피로 대체(default 문자열 부재)', () => {
    renderView({ noticeCopy: ERROR_COPY });

    expect(screen.getByText(ERROR_COPY)).toBeTruthy();
    expect(screen.queryByText(DEFAULT_COPY)).toBeNull();
  });

  it('A6b · noticeCopy 미주입 → 현행 default 문자열 유지(무회귀 짝)', () => {
    renderView();

    expect(screen.getByText(DEFAULT_COPY)).toBeTruthy();
  });
});
