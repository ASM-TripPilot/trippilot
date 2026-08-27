import { act, render, screen } from '@testing-library/react-native';

import type {
  ItineraryDaysItem,
  ItineraryDaysItemSlotsItem,
} from '@/shared/api/generated/schemas';

import { ManualEditScreen } from './ManualEditScreen';

/**
 * TRIP-577 · i15·i22 편집 상호작용 실배선 — **렌더 계약**(드래그 배선·시각 표시 prop).
 * 기존 `ManualEditScreen.test.tsx`(TRIP-443 동결: 얼굴 동치·잠금 어포던스·위반 배지)는 안 건드리고,
 * 이 사이클이 새로 세우는 두 축만 별 파일로 잠근다.
 *
 * 무엇을 보장하나:
 *  - 🔴 **R1(AC-1·AC-2)**: 비잠금 슬롯에만 드래그 핸들(`planb-manual-drag-{slotKey}`)이 붙고,
 *    고정(isFixed)·잠금(lockedSlotKeys) 슬롯엔 요소 자체가 없다(자리 잠금 = 구조적 보장, BR-U4-18).
 *  - 🔴 **R2(AC-1)**: 드래그 리스트(`planb-manual-list`)의 `onDragEnd({data})` → `onReorder(data)` 포워딩.
 *    제스처는 jest 로 못 태우니 수동 목이 호스트 View prop 으로 남긴 `onDragEnd` 를 직접 발화한다(02a ★3·§5-B).
 *  - 🔴 **R3(AC-3)**: 셸 additive prop `timeConfirmedSlotKeys`. 집합에 없으면 폴백 카드가
 *    `--:-- · 도착 시각 직접 입력`, 집합에 들면 실제 `startAt–endAt`(결정 b — 입력/미입력 구분).
 *
 * *(개념)* **수동 목** — `react-native-draggable-flatlist` 는 reanimated 네이티브 런타임에 기대 jest 가
 *   제스처를 못 발화한다. `__mocks__/react-native-draggable-flatlist.tsx` 가 (a) `renderItem` 을 data 마다
 *   태워 카드를 렌더하고 (b) `onDragEnd` 를 호스트 `<View>` 의 prop 으로 남긴다. `jest.mock(모듈명)`(팩토리
 *   없이)로 켠다 — 인라인 팩토리는 NativeWind babel 스코프 함정에 걸린다(@gorhom·webview 목과 동형).
 *
 * *(개념)* **매처** — `toBeOnTheScreen()` 은 요소가 렌더 트리에 붙어 있음(존재). `queryByTestId(...)` +
 *   `toBeNull()` 은 부재(무매칭). `toHaveTextContent(/정규식/)` 은 부분 포함(문자열 인자는 완전일치라
 *   컨테이너엔 못 씀 — 02a §5-A 실측). slotKey = `${date}#${poiId}`(planb 는 buildSlotKey import 불가).
 *
 * 3동작 뼈대: 준비=슬롯 렌더 → 실행=onDragEnd 발화/prop 전환 → 단언=핸들 유무·onReorder·카드 텍스트.
 */

// react-native-draggable-flatlist 수동 목 활성(02a ★3·§5-B). 구현 전엔 셸이 slots.map 이라 무해.
jest.mock('react-native-draggable-flatlist');

const DATE = '2026-06-11';
const key = (poiId: string): string => `${DATE}#${poiId}`;

type Slot = ItineraryDaysItemSlotsItem;

function slot(poiId: string, over: Partial<Slot> = {}): Slot {
  return {
    poiId,
    startAt: '13:00:00',
    endAt: '14:30:00',
    isFixed: false,
    endsNextDay: false,
    hasViolation: false,
    nameKo: '부산시립미술관',
    tags: [],
    ...over,
  };
}

const SLOT_A = slot('poi-a');
const SLOT_HOTEL = slot('poi-hotel', { isFixed: true, startAt: '17:30:00' });
const SLOT_C = slot('poi-c');

/** 3슬롯: A(비고정·비잠금) · H(isFixed 호텔 체크인) · C(비고정이나 lockedSlotKeys). */
const DAYS: ItineraryDaysItem[] = [
  { date: DATE, slots: [SLOT_A, SLOT_HOTEL, SLOT_C] },
];
const LOCKED = [key('poi-c')];

const noop = (): void => {};

describe('🔴 R1 · AC-1·AC-2 — 드래그 핸들은 비잠금 슬롯에만 붙는다 (부정+긍정+루트 짝)', () => {
  it('비고정 A 엔 핸들, 고정 H·잠금 C 엔 핸들 부재(자리 잠금)', () => {
    render(
      <ManualEditScreen
        days={DAYS}
        lockedSlotKeys={LOCKED}
        onBack={noop}
        onSave={noop}
        onReorder={noop}
      />
    );

    // ★2 루트 존재 짝 — 화면이 실제 렌더됐다(오타 testID 공허통과 차단).
    expect(screen.getByTestId('planb-manual-root')).toBeOnTheScreen();

    // 긍정 — 비잠금 슬롯엔 드래그 핸들.
    expect(
      screen.getByTestId(`planb-manual-drag-${key('poi-a')}`)
    ).toBeOnTheScreen();

    // 부정 — 고정(isFixed)·잠금(lockedSlotKeys) 슬롯엔 핸들 자체가 없다(BR-U4-18).
    expect(
      screen.queryByTestId(`planb-manual-drag-${key('poi-hotel')}`)
    ).toBeNull();
    expect(
      screen.queryByTestId(`planb-manual-drag-${key('poi-c')}`)
    ).toBeNull();
  });
});

describe('🔴 R2 · AC-1 — onDragEnd({data}) → onReorder(data) 포워딩', () => {
  it('리스트의 onDragEnd 를 직접 발화하면 그 data 로 onReorder 가 불린다', () => {
    const onReorder = jest.fn();
    render(
      <ManualEditScreen
        days={DAYS}
        lockedSlotKeys={LOCKED}
        onBack={noop}
        onSave={noop}
        onReorder={onReorder}
      />
    );

    // 렌더 시점엔 재정렬이 없다(발화는 onDragEnd 에서만) — 짝.
    expect(onReorder).not.toHaveBeenCalled();

    // 제스처를 못 태우니 목 호스트의 onDragEnd 를 직접 발화(02a §5-B).
    const reordered = [SLOT_C, SLOT_A, SLOT_HOTEL];
    const list = screen.getByTestId('planb-manual-list');
    act(() => {
      (list.props as { onDragEnd: (p: unknown) => void }).onDragEnd({
        data: reordered,
        from: 2,
        to: 0,
      });
    });

    expect(onReorder).toHaveBeenCalledTimes(1);
    expect(onReorder).toHaveBeenCalledWith(reordered);
  });
});

describe('🔴 R3 · AC-3 — timeConfirmedSlotKeys 표시 계약 (폴백 모드, 루트 짝)', () => {
  it('집합에 없으면 "--:-- · 도착 시각 직접 입력", 집합에 들면 실제 시각(startAt–endAt)', () => {
    const onlyA: ItineraryDaysItem[] = [{ date: DATE, slots: [SLOT_A] }];

    const { rerender } = render(
      <ManualEditScreen
        variant="error"
        days={onlyA}
        onBack={noop}
        onSave={noop}
      />
    );

    // 입력 전(현행 폴백) — 카드가 도착 시각 재입력을 유도한다.
    expect(screen.getByTestId('planb-manual-root')).toBeOnTheScreen();
    expect(
      screen.getByTestId(`planb-manual-slot-${key('poi-a')}`)
    ).toHaveTextContent(/도착 시각 직접 입력/);

    // 시각 입력이 적용된 슬롯 집합을 내리면 그 카드는 실제 시각을 보인다(결정 b).
    rerender(
      <ManualEditScreen
        variant="error"
        days={onlyA}
        timeConfirmedSlotKeys={[key('poi-a')]}
        onBack={noop}
        onSave={noop}
      />
    );

    expect(screen.getByTestId('planb-manual-root')).toBeOnTheScreen();
    const card = screen.getByTestId(`planb-manual-slot-${key('poi-a')}`);
    expect(card).toHaveTextContent(/13:00/);
    expect(card).not.toHaveTextContent(/도착 시각 직접 입력/);
  });
});
