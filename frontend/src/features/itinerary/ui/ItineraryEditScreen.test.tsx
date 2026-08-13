import { act, fireEvent, render, screen } from '@testing-library/react-native';

import type { ItineraryDaysItemSlotsItem } from '@/shared/api/generated/schemas';

import type { PlanDayTab } from '../model/planState';
import { buildSlotKey } from '../model/slotKey';
import { ItineraryEditScreen } from './ItineraryEditScreen';

/**
 * TRIP-302 · h24 편집 화면의 **렌더 계약**(슬라이스1). 화면은 데이터를 모르는 순수 컴포넌트 —
 * props(활성 날 슬롯)를 그리고 콜백을 발화할 뿐, 조회·판정·스토어를 모른다(TimelineScreen 배치).
 *
 * 무엇을 보장하나:
 *  - 🔴 **카드 2형태**(AC2). `isFixed` → 고정 칩 · 휴지통/핸들/다른후보 **없음** · 부제 '체크아웃…'.
 *    비고정 → 휴지통·핸들·'다른 후보 ›' 있음 · 해시태그 부제. 필수(must-visit) 형태는 안 만든다(엣지4).
 *  - 🔴 **삭제**(AC3). 비고정 휴지통 press → `onDeleteSlot(poiId)`. 고정엔 휴지통이 없다.
 *  - 🔴 **드래그 배선**(AC4). DraggableFlatList `onDragEnd({data})` → `onReorder(data)` 포워딩.
 *    제스처 자체는 jest 로 못 태우니(reanimated 네이티브) 목 호스트의 onDragEnd 를 직접 발화한다(02a ★1·★5).
 *  - 🔴 **자리만 무동작**(AC6). 저장하기·장소추가·시각칩·다른후보는 렌더되되 press 가 아무 콜백도
 *    안 부른다 — 콜백 prop 을 아예 안 받는다(02a ★8). 짝: 뒤로는 `onBack` 을 부른다(press 배선 생존).
 *  - 🔴 **위반 배지 읽기**(AC7). `hasViolation` → `itinerary-edit-violation-{slotKey}` + 사유(h25 계약 재현).
 *
 * *(개념)* **testID** — 화면 요소의 테스트 전용 이름표. `getByTestId` 는 그 요소를 집어 오고,
 * `queryAllByTestId(...).toEqual([])` 는 "없음"을 잰다(`getAllBy*` 는 무매칭 시 throw 라 부재에 못 씀).
 *
 * 3동작 뼈대: 준비=슬롯 3장으로 렌더 → 실행=press/onDragEnd → 단언=보이는 것·불린 콜백.
 */

// react-native-draggable-flatlist 는 reanimated/gesture 네이티브 런타임에 의존 → 수동 목 활성
// (node_modules 스코프 패키지라 @gorhom 처럼 명시 호출, 02a ★4·§5-E).
jest.mock('react-native-draggable-flatlist');

type Slot = ItineraryDaysItemSlotsItem;

const DAY1 = '2026-06-10';

function slot(over: Partial<Slot> & { poiId: string }): Slot {
  return {
    startAt: '09:30:00',
    endAt: '11:00:00',
    isFixed: false,
    endsNextDay: false,
    hasViolation: false,
    tags: [],
    ...over,
  };
}

// 세 형태: 고정 / 일반(비고정) / 위반(비고정 + hasViolation).
const FIXED = slot({
  poiId: 'poi-fixed',
  isFixed: true,
  nameKo: '제주 신라스테이',
});
const NORMAL = slot({
  poiId: 'poi-normal',
  isFixed: false,
  nameKo: '해운대 해수욕장',
  tags: ['바다', '산책'],
});
const VIOL = slot({
  poiId: 'poi-viol',
  isFixed: false,
  hasViolation: true,
  violationReason: '시간이 겹쳐요',
  nameKo: '광안리',
});

const SLOTS: Slot[] = [FIXED, NORMAL, VIOL];

const DAYS: PlanDayTab[] = [
  { dayIndex: 1, date: DAY1, count: SLOTS.length },
  { dayIndex: 2, date: '2026-06-11', count: 1 },
];

const key = (poiId: string) => buildSlotKey(DAY1, poiId);

const onSelectDay = jest.fn();
const onBack = jest.fn();
const onDeleteSlot = jest.fn();
const onReorder = jest.fn();

function renderScreen(
  over: Partial<Parameters<typeof ItineraryEditScreen>[0]> = {}
) {
  return render(
    <ItineraryEditScreen
      days={DAYS}
      slots={SLOTS}
      activeDayIndex={0}
      onSelectDay={onSelectDay}
      onBack={onBack}
      onDeleteSlot={onDeleteSlot}
      onReorder={onReorder}
      {...over}
    />
  );
}

beforeEach(() => {
  onSelectDay.mockClear();
  onBack.mockClear();
  onDeleteSlot.mockClear();
  onReorder.mockClear();
});

describe('🔴 C1 · AC1 — 활성 날 슬롯을 카드로 나열한다', () => {
  it('슬롯마다 번호·시각·장소명 카드가 뜨고 날 헤더에 곳 수가 나온다', () => {
    renderScreen();

    SLOTS.forEach((s, index) => {
      expect(
        screen.getByTestId(`itinerary-edit-slot-${key(s.poiId)}`)
      ).toBeOnTheScreen();
      expect(
        screen.getByTestId(`itinerary-edit-slot-no-${key(s.poiId)}`)
      ).toHaveTextContent(String(index + 1));
    });

    // 시각 칩은 시작 시각을 담고(정규식 부분 포함), 이름도 보인다.
    expect(
      screen.getByTestId(`itinerary-edit-slot-time-${key('poi-normal')}`)
    ).toHaveTextContent(/09:30/);
    expect(
      screen.getByTestId(`itinerary-edit-slot-name-${key('poi-normal')}`)
    ).toHaveTextContent(/해운대 해수욕장/);

    // 곳 수 — 활성 날 슬롯 3장.
    expect(screen.getByTestId('itinerary-edit-day-count')).toHaveTextContent(
      /3곳/
    );
  });
});

describe('🔴 C2 · AC2 — 카드 2형태(고정/일반) (부정+긍정 짝)', () => {
  it('고정 카드는 고정 칩·"삭제 불가" 부제만, 휴지통/핸들/다른후보는 없다', () => {
    renderScreen();
    const k = key('poi-fixed');

    // 긍정 — 고정 칩과 부제.
    expect(
      screen.getByTestId(`itinerary-edit-slot-fixed-${k}`)
    ).toBeOnTheScreen();
    expect(screen.getByTestId(`itinerary-edit-slot-${k}`)).toHaveTextContent(
      '체크아웃 · 변경·삭제 불가'
    );

    // 부정 — 편집 어포던스가 없다(삭제·드래그·교체 잠금).
    expect(screen.queryAllByTestId(`itinerary-edit-slot-delete-${k}`)).toEqual(
      []
    );
    expect(screen.queryAllByTestId(`itinerary-edit-slot-handle-${k}`)).toEqual(
      []
    );
    expect(screen.queryAllByTestId(`itinerary-edit-slot-alt-${k}`)).toEqual([]);
  });

  it('일반 카드는 휴지통·핸들·"다른 후보 ›"·해시태그를 갖고 고정 칩은 없다', () => {
    renderScreen();
    const k = key('poi-normal');

    // 긍정 — 편집 어포던스 3종 + 해시태그 부제.
    expect(
      screen.getByTestId(`itinerary-edit-slot-delete-${k}`)
    ).toBeOnTheScreen();
    expect(
      screen.getByTestId(`itinerary-edit-slot-handle-${k}`)
    ).toBeOnTheScreen();
    expect(
      screen.getByTestId(`itinerary-edit-slot-alt-${k}`)
    ).toBeOnTheScreen();
    expect(screen.getByTestId(`itinerary-edit-slot-${k}`)).toHaveTextContent(
      /바다/
    );

    // 부정 — 고정 칩은 없다.
    expect(screen.queryAllByTestId(`itinerary-edit-slot-fixed-${k}`)).toEqual(
      []
    );
  });
});

describe('🔴 C3 · AC3 — 삭제 (부정+긍정 짝)', () => {
  it('비고정 휴지통 press → onDeleteSlot(poiId), 고정 카드엔 휴지통이 없다', () => {
    renderScreen();

    fireEvent.press(
      screen.getByTestId(`itinerary-edit-slot-delete-${key('poi-normal')}`)
    );
    expect(onDeleteSlot).toHaveBeenCalledTimes(1);
    expect(onDeleteSlot).toHaveBeenCalledWith('poi-normal');

    // 짝 — 고정 슬롯은 삭제 불가(휴지통 부재).
    expect(
      screen.queryAllByTestId(`itinerary-edit-slot-delete-${key('poi-fixed')}`)
    ).toEqual([]);
  });
});

describe('🔴 C4 · AC4 — 드래그 재정렬 배선', () => {
  it('DraggableFlatList onDragEnd({data}) → onReorder(data) 로 포워딩한다', () => {
    renderScreen();

    // 렌더 시점엔 재정렬이 없다(발화는 onDragEnd 에서만).
    expect(onReorder).not.toHaveBeenCalled();

    // 제스처는 못 태우니 목 호스트의 onDragEnd 를 직접 발화(02a ★1·★5).
    const reordered = [NORMAL, FIXED, VIOL];
    const list = screen.getByTestId('itinerary-edit-list');
    act(() => {
      (list.props as { onDragEnd: (p: unknown) => void }).onDragEnd({
        data: reordered,
        from: 1,
        to: 0,
      });
    });

    expect(onReorder).toHaveBeenCalledTimes(1);
    expect(onReorder).toHaveBeenCalledWith(reordered);
  });
});

describe('🔴 C5 · AC6 — 자리만 어포던스 무동작 (부정+긍정 짝)', () => {
  it('저장/장소추가/시각칩/다른후보 press 는 어떤 편집 콜백도 안 부른다', () => {
    renderScreen();

    // 넷 다 렌더되고(존재), press 해도 무해하다.
    fireEvent.press(screen.getByTestId('itinerary-edit-save'));
    fireEvent.press(screen.getByTestId('itinerary-edit-add-place'));
    fireEvent.press(
      screen.getByTestId(`itinerary-edit-slot-time-${key('poi-normal')}`)
    );
    fireEvent.press(
      screen.getByTestId(`itinerary-edit-slot-alt-${key('poi-normal')}`)
    );

    expect(onDeleteSlot).not.toHaveBeenCalled();
    expect(onReorder).not.toHaveBeenCalled();

    // 짝 — press 배선 자체는 살아 있다(뒤로는 onBack 을 부른다). 죽은 화면과 구별.
    fireEvent.press(screen.getByTestId('itinerary-edit-back'));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

describe('🔴 C6 · AC7 — 위반 배지 읽기 (부정+긍정 짝)', () => {
  it('hasViolation 슬롯에 배지+사유가 뜨고, 비위반 슬롯엔 없다', () => {
    renderScreen();

    // 긍정 — h25 계약 재현: itinerary-edit-violation-{slotKey} + 사유.
    const badge = screen.getByTestId(
      `itinerary-edit-violation-${key('poi-viol')}`
    );
    expect(badge).toBeOnTheScreen();
    expect(badge).toHaveTextContent(/시간이 겹쳐요/);

    // 짝 — 비위반 카드엔 배지가 없다.
    expect(
      screen.queryAllByTestId(`itinerary-edit-violation-${key('poi-normal')}`)
    ).toEqual([]);
    expect(
      screen.queryAllByTestId(`itinerary-edit-violation-${key('poi-fixed')}`)
    ).toEqual([]);
  });
});
