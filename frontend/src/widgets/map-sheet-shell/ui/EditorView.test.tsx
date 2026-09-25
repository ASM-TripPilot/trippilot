import type { ReactElement } from 'react';
import { StyleSheet } from 'react-native';
import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import DraggableFlatList, * as DraggableModule from 'react-native-draggable-flatlist';

import type {
  ItineraryDaysItem,
  ItineraryDaysItemSlotsItem,
} from '@/shared/api/generated/schemas';
import { buildPlanDayTabs } from '@/features/itinerary/model/planState';
import { buildSlotKey } from '@/entities/itinerary-slot/lib/slotKey';
import {
  EDIT_LIST,
  editListData,
  fireEditDragBegin,
  fireEditDragEnd,
} from '@/test-support/editDragList';

import { EditorView } from './EditorView';

/**
 * TRIP-797 · AC-1·2·3·4·5·6·8·9·10·12 (OQ-3) — h12 통일 편집기 **순수 뷰** 구조·배선.
 *
 * OQ-3: features 화면은 widgets(MapSheetShell)를 상향 참조 못 하므로, 편집기는 **pages 층 순수 뷰**가
 * MapSheetShell 을 조립한다(h07/h08 DraftPage·h14/h16 ItineraryPlanPage 선례). 이 뷰는 컨테이너 api
 * 사슬이 없어 preview.tsx 가 그대로 import 한다(TRIP-610 회피). 이 파일이 그 조립 골격·제거 대상
 * 부재·배선 콜백을 잠근다.
 *
 * ⚠️ 원리적 사각(02a ★7 · 6-b 실기 이연): 2스냅 실개폐·딤·롱프레스 드래그 실동작·드롭 삭제·빨강
 * 테두리 색. 여기선 `map-sheet-shell-root`·children·testID 트리·콜백 발화·`isDragging` 표면 전환만.
 *
 * 3동작 뼈대: 준비=days/slots/콜백 주입 렌더 → 실행=렌더/press → 단언=골격·부재·콜백·CTA 상태.
 *
 * **TRIP-921 이동**: 뷰가 `pages/itinerary-edit` → `widgets/map-sheet-shell/ui` 로 승격돼(두 페이지가
 * 같은 뷰를 소비) 이 파일도 따라왔다. 위젯은 features 를 못 물어 헤더 날짜를 **`dateLabel` 문자열로
 * 받는다**(포맷 판정은 페이지 테스트 E0·M1 과 프리뷰 테스트 몫, 02a ★8). 아래 D1~D8 은 드래그 실배선
 * — 리스트 끝 센티널 판정(재정렬 vs 드롭 삭제)·고정/완료 금지·드래그 중 얼굴 — 을 잠근다. 목은 손가락을
 * 못 움직이므로 `@/test-support/editDragList` 가 라이브러리와 같은 배열 이동으로 onDragEnd 를 발화한다.
 */

// 지도는 네이버 네이티브라 jest 에서 못 뜬다 — 관찰 목으로 map-root 를 노출(MapSheetShell.test 조합).
jest.mock('@/shared/map', () => require('@/test-support/mapViewMock'));

const DATE = '2026-06-10';
const DATE2 = '2026-06-11';
const CENTER = { lat: 35.1532, lng: 129.1188 };

type EditorSlot = Omit<ItineraryDaysItemSlotsItem, 'startAt'> & {
  startAt: string | null;
};

function slot(poiId: string, overrides: Partial<EditorSlot> = {}): EditorSlot {
  return {
    poiId,
    startAt: '10:00:00',
    endAt: '11:00:00',
    isFixed: false,
    endsNextDay: false,
    hasViolation: false,
    tags: ['바다'],
    nameKo: `장소-${poiId}`,
    ...overrides,
  };
}

/** 활성 일자 슬롯을 서버 타입 days 로 감싸 PlanDayTab 을 만든다(미지정 null 은 표시용이라 캐스트). */
function daysOf(...dates: string[]): ItineraryDaysItem[] {
  return dates.map((date) => ({ date, slots: [] }));
}

function renderView(
  overrides: Partial<Parameters<typeof EditorView>[0]> = {}
): {
  onSelectDay: jest.Mock;
  onPressTimeChip: jest.Mock;
  onPressAddPlace: jest.Mock;
  onPressAddBetween: jest.Mock;
  onSave: jest.Mock;
  onReorder: jest.Mock;
  onDeleteViaDrag: jest.Mock;
} {
  const cb = {
    onSelectDay: jest.fn(),
    onPressTimeChip: jest.fn(),
    onPressAddPlace: jest.fn(),
    onPressAddBetween: jest.fn(),
    onSave: jest.fn(),
    onReorder: jest.fn(),
    onDeleteViaDrag: jest.fn(),
  };
  render(
    <EditorView
      center={CENTER}
      days={buildPlanDayTabs(daysOf(DATE))}
      slots={[]}
      activeDayIndex={0}
      activeDate={DATE}
      dateLabel="6월 10일(수)"
      onBack={jest.fn()}
      {...cb}
      {...overrides}
    />
  );
  return cb;
}

describe('🔴 EditorView · B4-1 — empty 얼굴(AC-1·AC-8·AC-10·AC-12)', () => {
  it('셸 골격·헤더 0곳·비활성 CTA·점선 장소추가·안내줄을 그린다', () => {
    renderView({ slots: [] });

    expect(screen.getByTestId('map-sheet-shell-root')).toBeOnTheScreen();
    expect(screen.getByTestId('sheet-header-meta')).toHaveTextContent('0곳');
    // CTA "일정 저장하기" 는 0곳이면 비활성(AC-10).
    const cta = screen.getByTestId('sheet-cta-button-0');
    expect(cta).toHaveTextContent('일정 저장하기');
    expect(cta).toBeDisabled();
    // 점선 장소추가(AC-8) + 안내줄(AC-12).
    expect(screen.getByTestId('itinerary-edit-add-place')).toBeOnTheScreen();
    expect(screen.getByTestId('itinerary-edit-guide')).toBeOnTheScreen();
  });
});

describe('🔴 EditorView · B4-2 — filled 얼굴(AC-2)', () => {
  it('슬롯 카드를 그리고 CTA 가 활성이며 헤더 곳수가 맞다', () => {
    renderView({ slots: [slot('a'), slot('b')] });

    expect(
      screen.getByTestId(`slot-stopcard-${buildSlotKey(DATE, 'a')}`)
    ).toBeOnTheScreen();
    expect(
      screen.getByTestId(`slot-stopcard-${buildSlotKey(DATE, 'b')}`)
    ).toBeOnTheScreen();
    expect(screen.getByTestId('sheet-header-meta')).toHaveTextContent('2곳');
    expect(screen.getByTestId('sheet-cta-button-0')).not.toBeDisabled();
  });
});

describe('🔴 EditorView · B4-3 — 제거 대상 부재(AC-3, 긍정 짝 동반)', () => {
  it('히어로·시간대밴드·"Day N"·"지도는 곧"·"다른 후보"·핸들이 없다', () => {
    renderView({ slots: [slot('a'), slot('b')] });

    // 긍정 짝 — 화면 자체는 떠 있다(공허 통과 방지).
    expect(screen.getByTestId('map-sheet-shell-root')).toBeOnTheScreen();

    // 제거 대상 부재.
    expect(screen.queryByText('지도는 곧 제공돼요')).toBeNull();
    expect(screen.queryByText('다른 후보 ›')).toBeNull();
    expect(screen.queryByText('오전')).toBeNull();
    expect(screen.queryByText('점심')).toBeNull();
    expect(screen.queryByText(/^Day \d/)).toBeNull(); // "Day 1" → "1일차" 로 대체
  });
});

describe('🔴 EditorView · B4-4 — day-chip 다일자(AC-4)', () => {
  it('일차 칩 press 가 onSelectDay 를 부르고 헤더가 활성 일자를 반영한다', () => {
    const cb = renderView({
      days: buildPlanDayTabs(daysOf(DATE, DATE2)),
      slots: [slot('a')],
    });

    fireEvent.press(screen.getByTestId('itinerary-edit-day-2'));
    expect(cb.onSelectDay).toHaveBeenCalledTimes(1);
    expect(cb.onSelectDay).toHaveBeenCalledWith(1);
    // 헤더는 선택 일자(activeDayIndex 0 = 1일차) 반영.
    expect(screen.getByTestId('sheet-header-day')).toHaveTextContent('1일차');
  });
});

describe('🔴 EditorView · B4-5 — 시각칩 → 시트 콜백(AC-5 · INV-U3-03)', () => {
  it('비고정 카드 시각칩 press 는 slotKey 로 콜백, 고정 카드는 누름 칩이 없다', () => {
    const keyA = buildSlotKey(DATE, 'a');
    const keyFix = buildSlotKey(DATE, 'fix');
    const cb = renderView({
      slots: [slot('a'), slot('fix', { isFixed: true })],
    });

    fireEvent.press(screen.getByTestId(`slot-stopcard-timechip-${keyA}`));
    expect(cb.onPressTimeChip).toHaveBeenCalledWith(keyA);

    // 고정 슬롯은 시각 불변(INV-U3-03) — 편집 어포던스 미부착.
    expect(screen.queryByTestId(`slot-stopcard-timechip-${keyFix}`)).toBeNull();
  });
});

describe('🔴 EditorView · B4-6 — 미지정 칩(AC-6)', () => {
  it('startAt 이 null 인 슬롯은 "시간대 설정" 칩으로 뜬다', () => {
    renderView({ slots: [slot('u', { startAt: null })] });
    expect(screen.getByText('시간대 설정')).toBeOnTheScreen();
  });
});

describe('🔴 EditorView · B4-7 — 카드 사이 + 삽입(AC-7 배선)', () => {
  it('카드 사이 + press 가 선행 슬롯 index 로 onPressAddBetween 을 부른다', () => {
    const cb = renderView({ slots: [slot('a'), slot('b')] });
    fireEvent.press(screen.getByTestId('itinerary-edit-insert-0'));
    expect(cb.onPressAddBetween).toHaveBeenCalledWith(0);
  });
});

describe('🔴 EditorView · B4-8 — CTA 저장(AC-10)', () => {
  it('채운 상태에서 저장 CTA press 가 onSave 를 부른다', () => {
    const cb = renderView({ slots: [slot('a')] });
    fireEvent.press(screen.getByTestId('sheet-cta-button-0'));
    expect(cb.onSave).toHaveBeenCalledTimes(1);
  });
});

describe('🔴 EditorView · B4-9 — dragging 얼굴(AC-9)', () => {
  it('isDragging 이면 드롭존이 CTA 자리를 대체한다', () => {
    renderView({ slots: [slot('a'), slot('b')], isDragging: true });

    expect(screen.getByTestId('itinerary-edit-dropzone')).toBeOnTheScreen();
    expect(
      screen.getByTestId('itinerary-edit-dropzone-active')
    ).toBeOnTheScreen();
    // 드래그 중엔 저장 CTA 자리가 드롭존으로 대체된다.
    expect(screen.queryByTestId('sheet-cta-button-0')).toBeNull();
  });
});

// ── TRIP-753 · i07 일정 편집(inTrip) — h12 편집기를 여행 중 편집으로 재사용 ──────────────────────
//
// Figma 4313:2100 픽스처: 2일차(6/11) 5곳, 앞 두 곳은 방문 완료, 행 3 은 위반. 완료·위반은 모드가
// 아니라 데이터(completedSlotKeys·hasViolation)가 정한다 — inTrip 이 끄는 것은 카드 사이 + 와 안내
// 문구 둘뿐이다(Q5). 드래그·시트 실개폐는 jest 사각(02a ★8) — 콜백·트리 모양까지만 본다.

const I07_DATE = '2026-06-11';

const I07_SLOTS: EditorSlot[] = [
  slot('p1', {
    startAt: '09:30:00',
    endAt: '10:30:00',
    nameKo: '감천문화마을',
    tags: ['마을', '벽화'],
  }),
  slot('p2', {
    startAt: '11:00:00',
    endAt: '12:00:00',
    nameKo: '광안리 해변',
    tags: ['바다', '산책'],
  }),
  slot('p3', {
    startAt: '13:00:00',
    endAt: '14:30:00',
    nameKo: '부산시립미술관',
    tags: ['미술', '실내'],
    hasViolation: true,
    violationReason: '숙소 고정 충돌',
  }),
  slot('p4', {
    startAt: '15:00:00',
    endAt: '16:30:00',
    nameKo: '전포 카페거리',
    tags: ['카페', '실내'],
  }),
  slot('p5', {
    startAt: '17:00:00',
    endAt: '18:30:00',
    nameKo: '해운대 해변',
    tags: ['바다', '해변'],
  }),
];

const k = (poiId: string): string => buildSlotKey(I07_DATE, poiId);
const I07_KEYS = ['p1', 'p2', 'p3', 'p4', 'p5'].map(k);

const I07_GUIDE =
  '방문한 곳은 그대로 두고, 길게 눌러 순서를 바꾸거나 아래로 끌어 삭제해요';
const H12_GUIDE = '길게 눌러 순서를 바꾸거나, 아래로 끌어 삭제해요';

function renderI07(
  overrides: Partial<Parameters<typeof EditorView>[0]> = {}
): ReturnType<typeof renderView> {
  return renderView({
    days: buildPlanDayTabs(daysOf('2026-06-10', I07_DATE, '2026-06-12')),
    slots: I07_SLOTS,
    activeDayIndex: 1,
    activeDate: I07_DATE,
    // TRIP-921 — 위젯은 포맷터(features)를 못 물어 페이지가 만든 문자열을 받는다(02a D-2).
    dateLabel: '6월 11일(목)',
    completedSlotKeys: [k('p1'), k('p2')],
    ...overrides,
  });
}

/** className 을 공백으로 쪼갠 토큰 — `bg-primary` 가 `bg-primary-pale` 에 걸리지 않게 원소로 비교한다. */
function classTokens(testID: string): string[] {
  return String(screen.getByTestId(testID).props.className ?? '').split(/\s+/);
}

/** 트리 전위 순회 순서의 testID 목록(composite·host 중복 — 첫 등장 index 로 비교한다, 02a ★6). */
function treeOrder(): string[] {
  return screen.root
    .findAll((node) => typeof node.props?.testID === 'string')
    .map((node) => node.props.testID as string);
}

/** 셸이 BottomSheet 목에 넘긴 초기 스냅 **칸 값**들 — snapPoints[index]. TRIP-920 이 셸 기본 배열 앞에
 *  닫힘(28)을 끼워 숫자 index 의 뜻이 밀렸다: 숫자만 보면 green 인 채로 "펼침→peek" 가 된다(02a ★1). */
function sheetSnapValues(): unknown[] {
  return screen.root
    .findAll(
      (node) =>
        typeof node.props?.index === 'number' &&
        Array.isArray(node.props?.snapPoints)
    )
    .map(
      (node) => (node.props.snapPoints as unknown[])[node.props.index as number]
    );
}

describe('🔴 EditorView · V1 — 헤더 날짜 괄호형 + 시트 펼침 (TRIP-753 AC-2)', () => {
  it('2일차 6/11 헤더를 "일정 편집 · 2일차 · 6월 11일(목) · 5곳" 조각으로 그리고 시트를 펼침(88%) 칸으로 연다', () => {
    renderI07();

    expect(screen.getByTestId('sheet-header-title')).toHaveTextContent(
      '일정 편집'
    );
    expect(screen.getByTestId('sheet-header-day')).toHaveTextContent('2일차');
    expect(screen.getByTestId('sheet-header-date')).toHaveTextContent(
      '6월 11일(목)'
    );
    expect(screen.getByTestId('sheet-header-meta')).toHaveTextContent('5곳');

    // TRIP-920 심판 수정 — 숫자 index 가 아니라 그 index 가 가리키는 칸 값(펼침 = 88%).
    const values = sheetSnapValues();
    expect(values.length).toBeGreaterThan(0);
    values.forEach((value) => expect(value).toBe('88%'));
  });
});

describe('🔴 EditorView · V2 — 번호 원은 카드 밖, 완료는 초록·예정은 빨강 (TRIP-753 AC-3)', () => {
  it('번호 1~5 가 각 카드의 자손이 아니고, 톤이 [success,success,primary,primary,primary] 다', () => {
    renderI07();

    I07_KEYS.forEach((key, index) => {
      const number = `slot-stopcard-number-${key}`;
      // 긍정 — 번호는 화면에 있고 순번 글자를 가진다.
      expect(screen.getByTestId(number)).toHaveTextContent(String(index + 1));
      // 부정 — 흰 카드(카드 루트) 안에는 없다("카드 밖"을 기계로 보는 방법).
      const card = screen.getByTestId(`slot-stopcard-${key}`);
      expect(within(card).queryByTestId(number)).toBeNull();
    });

    expect(
      I07_KEYS.map((key) => {
        const tokens = classTokens(`slot-stopcard-number-${key}`);
        if (tokens.includes('bg-success')) return 'success';
        if (tokens.includes('bg-primary')) return 'primary';
        return 'none';
      })
    ).toEqual(['success', 'success', 'primary', 'primary', 'primary']);
  });
});

describe('🔴 EditorView · V3 — 방문 완료 행은 회색 알약만, 자물쇠 배지 없음 (TRIP-753 AC-4)', () => {
  it('완료 행은 누름 칩 없이 muted 알약에 시각을 그리고, 잠금 표식은 그 알약 자체다', () => {
    renderI07();

    [
      [k('p1'), '09:30–10:30'],
      [k('p2'), '11:00–12:00'],
    ].forEach(([key, label]) => {
      expect(screen.queryByTestId(`slot-stopcard-timechip-${key}`)).toBeNull();
      expect(screen.getByTestId(`slot-stopcard-time-${key}`)).toHaveTextContent(
        label
      );
      expect(classTokens(`slot-stopcard-time-${key}`)).toContain('text-muted');

      const locked = screen.getByTestId(`slot-stopcard-locked-${key}`);
      expect(classTokens(`slot-stopcard-locked-${key}`)).toContain(
        'border-muted-soft'
      );
      expect(
        within(locked).getByTestId(`slot-stopcard-time-${key}`)
      ).toBeOnTheScreen();
    });

    // 보이는 "방문 완료" 배지는 없다(잠금은 모양이 아니라 동작으로만).
    expect(screen.queryByText('방문 완료')).toBeNull();

    // 짝 — 예정 행은 누를 수 있는 ink 알약이다.
    expect(
      screen.getByTestId(`slot-stopcard-timechip-${k('p3')}`)
    ).toBeOnTheScreen();
    expect(classTokens(`slot-stopcard-time-${k('p3')}`)).toContain('text-ink');
  });

  it('완료 알약을 눌러도 onPressTimeChip 이 불리지 않고, 예정 칩은 같은 콜백을 1회 부른다 (03b 경고-1)', () => {
    const cb = renderI07();

    // fireEvent.press 는 눌린 요소부터 부모로 올라가며 onPress 를 찾는다(RNTL findEventHandler) —
    // 완료 알약과 그 조상 어디에도 시각 편집 onPress 가 없어야 0회다.
    fireEvent.press(screen.getByTestId(`slot-stopcard-locked-${k('p1')}`));
    fireEvent.press(screen.getByTestId(`slot-stopcard-locked-${k('p2')}`));
    expect(cb.onPressTimeChip).not.toHaveBeenCalled();

    // 짝 — 같은 콜백이 배선돼 있다(공허 통과 방지): 예정 칩 press 는 정확히 1회.
    fireEvent.press(screen.getByTestId(`slot-stopcard-timechip-${k('p3')}`));
    expect(cb.onPressTimeChip).toHaveBeenCalledTimes(1);
    expect(cb.onPressTimeChip).toHaveBeenCalledWith(k('p3'));
  });
});

describe('EditorView · V4 — 예정 행 ⌄ 한 번 누름 = 콜백 한 번 (TRIP-753 AC-5)', () => {
  it('행 3 시각칩 press 가 onPressTimeChip 을 그 slotKey 로 정확히 1회 부른다', () => {
    const cb = renderI07();

    fireEvent.press(screen.getByTestId(`slot-stopcard-timechip-${k('p3')}`));

    expect(cb.onPressTimeChip).toHaveBeenCalledTimes(1);
    expect(cb.onPressTimeChip).toHaveBeenCalledWith(k('p3'));
  });
});

describe('🔴 EditorView · V5 — 위반 배지는 카테고리 아래 연분홍 알약 (TRIP-753 AC-6)', () => {
  it('행 3 에만 "숙소 고정 충돌" 배지를 primary-pale 로 그린다', () => {
    renderI07();

    const badges = screen.getAllByTestId(/^slot-stopcard-violation-/);
    expect(badges).toHaveLength(1);
    expect(
      screen.getByTestId(`slot-stopcard-violation-${k('p3')}`)
    ).toHaveTextContent('숙소 고정 충돌');
    expect(classTokens(`slot-stopcard-violation-${k('p3')}`)).toContain(
      'bg-primary-pale'
    );
  });

  it('사유가 null 이면 지어내지 않고 "일정 충돌" 로 그린다', () => {
    renderI07({
      slots: I07_SLOTS.map((s) =>
        s.poiId === 'p3' ? { ...s, violationReason: null } : s
      ),
    });

    expect(
      screen.getByTestId(`slot-stopcard-violation-${k('p3')}`)
    ).toHaveTextContent('일정 충돌');
  });

  it('hasViolation 이 false 면 사유 문자열이 있어도 배지가 없다', () => {
    renderI07({
      slots: I07_SLOTS.map((s) =>
        s.poiId === 'p3' ? { ...s, hasViolation: false } : s
      ),
    });

    // 긍정 짝 — 카드는 다섯 장 다 떠 있다(공허 통과 방지).
    I07_KEYS.forEach((key) =>
      expect(screen.getByTestId(`slot-stopcard-${key}`)).toBeOnTheScreen()
    );
    expect(screen.queryAllByTestId(/^slot-stopcard-violation-/)).toHaveLength(
      0
    );
  });
});

describe('🔴 EditorView · V6 — inTrip 이면 카드 사이 + 가 없고 i07 안내가 장소 추가 아래 (TRIP-753 AC-7)', () => {
  it('insert 0개 · 안내 문구 i07 완전일치 · 트리 순서 add-place → guide', () => {
    renderI07({ inTrip: true });

    expect(screen.queryAllByTestId(/^itinerary-edit-insert-/)).toHaveLength(0);
    expect(screen.getByTestId('itinerary-edit-guide')).toHaveTextContent(
      I07_GUIDE
    );

    const order = treeOrder();
    expect(order.indexOf('itinerary-edit-add-place')).toBeGreaterThan(-1);
    expect(order.indexOf('itinerary-edit-guide')).toBeGreaterThan(
      order.indexOf('itinerary-edit-add-place')
    );
  });
});

describe('🔴 EditorView · V7 — 플래그 없으면(h12) + 와 h12 안내 그대로, 안내 위치만 아래로 (TRIP-753 AC-7 · Q5)', () => {
  it('insert 4개 · 안내 문구 h12 완전일치 · 트리 순서 add-place → guide', () => {
    renderI07();

    expect(screen.getAllByTestId(/^itinerary-edit-insert-/)).toHaveLength(4);
    expect(screen.getByTestId('itinerary-edit-guide')).toHaveTextContent(
      H12_GUIDE
    );

    const order = treeOrder();
    expect(order.indexOf('itinerary-edit-add-place')).toBeGreaterThan(-1);
    expect(order.indexOf('itinerary-edit-guide')).toBeGreaterThan(
      order.indexOf('itinerary-edit-add-place')
    );
  });
});

// ── TRIP-921 · 드래그 실배선 — 리스트 끝 센티널(3-a) ─────────────────────────────────────────────
//
// data = 슬롯 n개 + 맨 끝 센티널(드롭존). 끈 카드가 새 data 에서 센티널 **뒤**면 삭제, 아니면 재정렬.
// 경계는 "to = n" 하나다: [a,b,c,S] 에서 0→2 는 [b,c,a,S](센티널 바로 앞 = 맨 끝 재정렬), 0→3·2→3 은
// [..,S,x](센티널 뒤 = 삭제). 목은 isActive 가 늘 false · 손가락 이동 없음(02a ★4·★5).

const ACTIVE = 'itinerary-edit-dropzone-active';
const CTA = 'sheet-cta-button-0';

/**
 * 5-b 경고-1 — 끌기 중 카드 사이 "+" 계약: **마운트·레이아웃은 그대로, 보이지 않고 누를 수 없다.**
 * 라이브러리는 끌기 시작 순간 끄는 카드 위치를 스냅샷으로 적고 다시 안 잰다. 그 직후 "+" 줄(36px)이
 * 빠지면 스냅샷이 아래로 어긋나 롱프레스만으로 드롭존(삭제) 판정이 난다 — 레이아웃 불변이 드롭 판정의
 * 전제다(02a ★16). 관측(02a §5-H 실측):
 *  ① 개수 — 숨긴 요소도 세도록 `includeHiddenElements:true`(RNTL 13 기본값은 접근성 숨김을 뺀다).
 *  ② 안 보임 — `not.toBeVisible()`(style opacity 0 · display none · 접근성 숨김, 자신·조상 포함).
 *     ⚠️ NativeWind className(`opacity-0`)은 jest 에서 style 로 안 바뀌어 여기 안 잡힌다 → style/접근성으로.
 *  ③ 자리 유지 — 자신·조상(리스트까지)에 `display:'none'` style·`hidden` className 토큰 0(레이아웃 소멸 금지).
 *  ④ 누름 불가 — press 해도 onPressAddBetween 0회(pointerEvents none·disabled 모두 RNTL 이 막는다).
 */
function expectInsertsHeldButInert(
  cb: { onPressAddBetween: jest.Mock },
  count: number
): void {
  const inserts = screen.getAllByTestId(/^itinerary-edit-insert-/, {
    includeHiddenElements: true,
  });
  expect(inserts).toHaveLength(count);
  const list = screen.getByTestId(EDIT_LIST);
  inserts.forEach((node) => {
    expect(node).not.toBeVisible();
    for (
      let cur: typeof node | null = node;
      cur !== null && cur !== list;
      cur = cur.parent
    ) {
      const flat = StyleSheet.flatten(cur.props.style) as
        { display?: string } | undefined;
      expect(flat?.display).not.toBe('none');
      expect(String(cur.props.className ?? '').split(/\s+/)).not.toContain(
        'hidden'
      );
    }
    fireEvent.press(node);
  });
  expect(cb.onPressAddBetween).not.toHaveBeenCalled();
}

/** onReorder 첫 호출 인자의 poiId 순서. */
function reorderedIds(mock: jest.Mock): string[] {
  return (mock.mock.calls[0][0] as EditorSlot[]).map((s) => s.poiId);
}

describe('🔴 EditorView · D1 — 드래그 리스트 계약: 슬롯 n개 + 끝 센티널 1개 (TRIP-921 AC-1·AC-2 전제)', () => {
  it('itinerary-edit-list 의 data 는 [a,b,c] 뒤에 슬롯 아닌 항목 하나, 키는 모두 다르다', () => {
    renderView({ slots: [slot('a'), slot('b'), slot('c')] });

    expect(screen.getByTestId(EDIT_LIST)).toBeOnTheScreen();

    const data = editListData();
    expect(data).toHaveLength(4);
    expect(data.slice(0, 3).map((item) => (item as EditorSlot).poiId)).toEqual([
      'a',
      'b',
      'c',
    ]);
    // 센티널 — 모양은 계약하지 않고 "슬롯이 아니다"만 본다(02a ★1).
    const last = data[3] as { poiId?: unknown } | null;
    expect(['a', 'b', 'c']).not.toContain(last?.poiId);

    const keyExtractor = (
      screen.UNSAFE_getByType(DraggableFlatList).props as {
        keyExtractor: (item: unknown, index: number) => string;
      }
    ).keyExtractor;
    expect(new Set(data.map((item, i) => keyExtractor(item, i))).size).toBe(4);
  });
});

describe('🔴 EditorView · D2 — 센티널 앞에 놓으면 재정렬 (TRIP-921 AC-1)', () => {
  it('b 를 맨 앞(1→0)에 놓으면 onReorder 가 센티널 뺀 [b,a,c] 로 1회, 삭제는 0회', () => {
    const cb = renderView({ slots: [slot('a'), slot('b'), slot('c')] });

    fireEditDragEnd(1, 0);

    expect(cb.onReorder).toHaveBeenCalledTimes(1);
    expect(reorderedIds(cb.onReorder)).toEqual(['b', 'a', 'c']);
    expect(cb.onDeleteViaDrag).not.toHaveBeenCalled();
  });

  it('★경계 — 센티널 바로 앞(0→2, [b,c,a,S])은 맨 끝으로 재정렬이지 삭제가 아니다', () => {
    const cb = renderView({ slots: [slot('a'), slot('b'), slot('c')] });

    fireEditDragEnd(0, 2);

    expect(cb.onReorder).toHaveBeenCalledTimes(1);
    expect(reorderedIds(cb.onReorder)).toEqual(['b', 'c', 'a']);
    expect(cb.onDeleteViaDrag).not.toHaveBeenCalled();
  });
});

describe('🔴 EditorView · D3 — 센티널 뒤에 놓으면 삭제 (TRIP-921 AC-2)', () => {
  it('b 를 센티널 뒤(1→3, [a,c,S,b])에 놓으면 onDeleteViaDrag("b") 1회, 재정렬 0회', () => {
    const cb = renderView({ slots: [slot('a'), slot('b'), slot('c')] });

    fireEditDragEnd(1, 3);

    expect(cb.onDeleteViaDrag).toHaveBeenCalledTimes(1);
    expect(cb.onDeleteViaDrag).toHaveBeenCalledWith('b');
    expect(cb.onReorder).not.toHaveBeenCalled();
  });

  it('★경계 — 마지막 카드 c 를 한 칸만 내려도(2→3, [a,b,S,c]) 센티널을 넘었으니 삭제다', () => {
    const cb = renderView({ slots: [slot('a'), slot('b'), slot('c')] });

    fireEditDragEnd(2, 3);

    expect(cb.onDeleteViaDrag).toHaveBeenCalledTimes(1);
    expect(cb.onDeleteViaDrag).toHaveBeenCalledWith('c');
    expect(cb.onReorder).not.toHaveBeenCalled();
  });
});

describe('🔴 EditorView · D4 — 고정·완료 카드는 드롭존에 놓여도 안 지워진다 (TRIP-921 AC-3 ② 심층 방어)', () => {
  it('고정 카드를 센티널 뒤로 강제 발화하면 두 콜백 0회 — 짝: 같은 화면의 예정 카드는 지워진다', () => {
    const cb = renderView({
      slots: [slot('a'), slot('fix', { isFixed: true }), slot('b')],
    });

    // 제스처로는 못 끄는 카드지만, 판정 단계에서 한 번 더 거른다(스토어 deleteSlot 은 고정을 안 본다).
    fireEditDragEnd(1, 3);
    expect(cb.onDeleteViaDrag).not.toHaveBeenCalled();
    expect(cb.onReorder).not.toHaveBeenCalled();

    // 짝(공허 통과 방지) — 콜백 배선 자체는 살아 있다.
    fireEditDragEnd(2, 3);
    expect(cb.onDeleteViaDrag).toHaveBeenCalledTimes(1);
    expect(cb.onDeleteViaDrag).toHaveBeenCalledWith('b');
  });

  it('방문 완료 카드(p1)를 센티널 뒤로 강제 발화하면 두 콜백 0회 — 짝: 예정 p3 는 지워진다', () => {
    const cb = renderI07();

    fireEditDragEnd(0, 5);
    expect(cb.onDeleteViaDrag).not.toHaveBeenCalled();
    expect(cb.onReorder).not.toHaveBeenCalled();

    fireEditDragEnd(2, 5);
    expect(cb.onDeleteViaDrag).toHaveBeenCalledTimes(1);
    expect(cb.onDeleteViaDrag).toHaveBeenCalledWith('p3');
  });
});

describe('🔴 EditorView · D5 — 고정·완료 카드엔 롱프레스 끌기가 안 걸린다 (TRIP-921 AC-3 ①)', () => {
  it('완료 p1·고정 p4 롱프레스는 끌기를 시작하지 않고, 예정 p3 롱프레스는 시작한다', () => {
    renderI07({
      slots: I07_SLOTS.map((s) =>
        s.poiId === 'p4' ? { ...s, isFixed: true } : s
      ),
    });

    // 목의 drag() 는 실물처럼 onDragBegin(index) 로 이어진다 → 끌기가 시작되면 드롭존 활성 표식이 뜬다.
    fireEvent(screen.getByTestId(`slot-stopcard-${k('p1')}`), 'longPress');
    fireEvent(screen.getByTestId(`slot-stopcard-${k('p4')}`), 'longPress');
    expect(screen.queryByTestId(ACTIVE)).toBeNull();

    // 짝 — 움직일 수 있는 카드는 롱프레스가 끌기로 이어진다(핸들 배선 존재).
    fireEvent(screen.getByTestId(`slot-stopcard-${k('p3')}`), 'longPress');
    expect(screen.getByTestId(ACTIVE)).toBeOnTheScreen();
  });
});

describe('🔴 EditorView · D5b — 롱프레스는 라이브러리 drag() 를 실제로 부른다 (TRIP-921 AC-3 ① · 5-b 경고-2)', () => {
  it('완료 p1·고정 p4 롱프레스는 drag 기록 0, 예정 p3 롱프레스는 그 칸(2)으로 drag 1회', () => {
    // 목이 drag() 호출을 기록한다 — 뷰가 상태만 켜고 drag 를 안 부르면 실기에선 카드가 안 들리고
    // onDragEnd 도 안 와 편집기가 드래그 얼굴로 굳는다(드롭존 표식만 보는 D5 는 이걸 못 가른다).
    const { __dragLog } = DraggableModule as unknown as {
      __dragLog: number[];
    };
    __dragLog.length = 0;
    renderI07({
      slots: I07_SLOTS.map((s) =>
        s.poiId === 'p4' ? { ...s, isFixed: true } : s
      ),
    });

    fireEvent(screen.getByTestId(`slot-stopcard-${k('p1')}`), 'longPress');
    fireEvent(screen.getByTestId(`slot-stopcard-${k('p4')}`), 'longPress');
    expect(__dragLog).toEqual([]);

    fireEvent(screen.getByTestId(`slot-stopcard-${k('p3')}`), 'longPress');
    expect(__dragLog).toEqual([2]);
  });
});

describe('🔴 EditorView · D6 — 드래그 중 얼굴과 놓은 뒤 복귀 (TRIP-921 AC-4)', () => {
  it('끌기 시작하면 드롭존 활성·CTA 없음·카드 사이 + 는 자리만 남고(2개) 숨김·누름 불가, 재정렬로 놓으면 원래 얼굴', () => {
    const cb = renderView({ slots: [slot('a'), slot('b'), slot('c')] });

    // 준비 확인 — 평소 얼굴.
    expect(screen.queryByTestId(ACTIVE)).toBeNull();
    expect(screen.getByTestId(CTA)).toBeOnTheScreen();
    expect(screen.getAllByTestId(/^itinerary-edit-insert-/)).toHaveLength(2);

    fireEditDragBegin(0);
    expect(screen.getByTestId(ACTIVE)).toBeOnTheScreen();
    expect(screen.queryByTestId(CTA)).toBeNull();
    // 5-b 경고-1 계약 변경 — "+" 줄은 끌기 중에도 **자리(레이아웃)를 지키되** 안 보이고 안 눌린다.
    expectInsertsHeldButInert(cb, 2);

    fireEditDragEnd(0, 1);
    expect(screen.queryByTestId(ACTIVE)).toBeNull();
    expect(screen.getByTestId(CTA)).toBeOnTheScreen();
    expect(screen.getAllByTestId(/^itinerary-edit-insert-/)).toHaveLength(2);
    // 복귀 짝 — 놓은 뒤엔 다시 보이고 눌린다.
    screen
      .getAllByTestId(/^itinerary-edit-insert-/)
      .forEach((node) => expect(node).toBeVisible());
    fireEvent.press(screen.getByTestId('itinerary-edit-insert-0'));
    expect(cb.onPressAddBetween).toHaveBeenCalledTimes(1);
  });

  it('드롭존에 놓아 삭제로 끝나도 원래 얼굴로 돌아온다', () => {
    renderView({ slots: [slot('a'), slot('b'), slot('c')] });

    fireEditDragBegin(1);
    expect(screen.getByTestId(ACTIVE)).toBeOnTheScreen();

    fireEditDragEnd(1, 3);
    expect(screen.queryByTestId(ACTIVE)).toBeNull();
    expect(screen.getByTestId(CTA)).toBeOnTheScreen();
  });

  it('★제자리 놓기(from=to)도 onDragEnd 가 오므로 원래 얼굴로 돌아온다', () => {
    renderView({ slots: [slot('a'), slot('b'), slot('c')] });

    fireEditDragBegin(0);
    expect(screen.getByTestId(ACTIVE)).toBeOnTheScreen();

    fireEditDragEnd(0, 0);
    expect(screen.queryByTestId(ACTIVE)).toBeNull();
    expect(screen.getByTestId(CTA)).toBeOnTheScreen();
  });
});

describe('🔴 EditorView · D7 — isDragging prop 만으로 드래그 중 얼굴 (TRIP-921 AC-5)', () => {
  it('제스처 없이 prop 을 주면 드롭존 활성·CTA 없음·카드 사이 + 는 자리만 남고(1개) 숨김·누름 불가', () => {
    const cb = renderView({ slots: [slot('a'), slot('b')], isDragging: true });

    expect(screen.getByTestId(ACTIVE)).toBeOnTheScreen();
    expect(screen.queryByTestId(CTA)).toBeNull();
    expectInsertsHeldButInert(cb, 1);
  });
});

describe('🔴 EditorView · D8 — 끌리는 카드는 떠 있는 얼굴(빨강 테두리) (TRIP-921 AC-14 구조 절반)', () => {
  it('renderItem 에 isActive:true 를 주면 그 카드 루트가 border-primary, false 면 border-hairline', () => {
    renderView({ slots: [slot('a'), slot('b')] });
    const keyA = buildSlotKey(DATE, 'a');
    const renderItem = (
      screen.UNSAFE_getByType(DraggableFlatList).props as {
        renderItem: (p: {
          item: unknown;
          getIndex: () => number;
          drag: () => void;
          isActive: boolean;
        }) => ReactElement;
      }
    ).renderItem;
    const first = editListData()[0];

    // 목은 isActive 를 늘 false 로 주므로(02a ★5) renderItem 을 직접 불러 그 결과만 따로 그린다.
    render(
      renderItem({
        item: first,
        getIndex: () => 0,
        drag: () => {},
        isActive: true,
      })
    );
    expect(classTokens(`slot-stopcard-${keyA}`)).toContain('border-primary');
    expect(classTokens(`slot-stopcard-${keyA}`)).not.toContain(
      'border-hairline'
    );

    render(
      renderItem({
        item: first,
        getIndex: () => 0,
        drag: () => {},
        isActive: false,
      })
    );
    expect(classTokens(`slot-stopcard-${keyA}`)).toContain('border-hairline');
    expect(classTokens(`slot-stopcard-${keyA}`)).not.toContain(
      'border-primary'
    );
  });
});
