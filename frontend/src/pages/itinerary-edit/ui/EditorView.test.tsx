import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

import type {
  ItineraryDaysItem,
  ItineraryDaysItemSlotsItem,
} from '@/shared/api/generated/schemas';
import { buildPlanDayTabs } from '@/features/itinerary/model/planState';
import { buildSlotKey } from '@/entities/itinerary-slot/lib/slotKey';

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
} {
  const cb = {
    onSelectDay: jest.fn(),
    onPressTimeChip: jest.fn(),
    onPressAddPlace: jest.fn(),
    onPressAddBetween: jest.fn(),
    onSave: jest.fn(),
  };
  render(
    <EditorView
      center={CENTER}
      days={buildPlanDayTabs(daysOf(DATE))}
      slots={[]}
      activeDayIndex={0}
      activeDate={DATE}
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
