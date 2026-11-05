import { fireEvent, render, screen } from '@testing-library/react-native';

import type { Place } from '@/shared/api/index.schemas';

import { PlaceAddRow } from './PlaceAddScreen';

/**
 * TRIP-1794 · h13 장소 추가 후보 행(`PlaceAddRow`)의 "여러 곳 체크" 표면 — props 만 받는 순수 뷰의 계약.
 * 페이지가 체크 상태·담기 흐름을 쥐고, 이 행은 (1) 체크 원을 그리고 (2) 체크가 하나라도 있으면 한 곳씩 「추가」를 숨기는 표면만 낸다.
 *
 * 무엇을 보장하나(AC 번호는 01b Seed — 02a §3 신규 prop 계약):
 *  - 옵셔널 `check?: { checked, onToggle }` — 안 주면 체크 원이 없다. 그래서 같은 행을 쓰는 다른 소비처(프리뷰)는 무변경이다(AC-6).
 *  - 체크 원은 `place-add-check-{poiId}` · role=checkbox · `accessibilityState.checked`(색이 아니라 상태로 잰다 — 생김새 단언 금지).
 *  - 옵셔널 `showAdd?`(기본 true) — false 면 「추가」 버튼(`itinerary-place-add-{poiId}`)이 없다. 체크가 ≥1 이면 페이지가 false 를 준다(D1·AC-6).
 *  - 이미 담은 행(`added`)은 체크 원도 「추가」도 없이 「추가됨」만 — 같은 곳을 또 체크해 중복 PUT 하는 길이 없다(AC-5e).
 *  - 체크됨이면 카드(`PlaceRowCard`)가 선택 상태로 표시된다(`accessibilityState.selected` — 색은 6-b 실기).
 *
 * 매처 근거: `toBeChecked()` 는 host `Switch` 이거나 role 이 checkbox·radio·switch 인 접근성 요소에만 쓸 수 있다(RNTL to-be-checked.js 확인) —
 * 그래서 체크 원이 `accessibilityRole="checkbox"` 여야 한다. `toBeSelected()` 는 아무 host 에 `accessibilityState.selected` 만 읽는다.
 *
 * 3동작 뼈대: 준비=place+props → 실행=렌더/press → 단언=testID 유무·접근성 상태·콜백.
 */

const PLACE: Place = {
  poiId: 'p1',
  nameKo: '감천문화마을',
  category: '명소',
  lat: 35.1587,
  lng: 129.1604,
  region: '부산',
  openingHours: null,
  imageUrl: null,
  tags: [],
  savedCount: 12,
  dataStatus: 'ACTIVE',
};

const CHECK = 'place-add-check-p1';
const ADD = 'itinerary-place-add-p1';
const ADDED = 'itinerary-place-added-p1';
const CARD = 'itinerary-place-card-p1';

describe('PlaceAddRow — 체크 원 · 추가 버튼 (TRIP-1794)', () => {
  it('R1 · check 를 안 주면 체크 원이 없고 「추가」가 있다 — 다른 소비처 무변경', () => {
    render(<PlaceAddRow place={PLACE} added={false} onPressAdd={jest.fn()} />);

    expect(screen.getByTestId(ADD)).toBeOnTheScreen();
    expect(screen.queryByTestId(CHECK)).toBeNull();
    // 카드는 선택 개념이 없다 — 접근성 상태 자체가 없다.
    expect(screen.getByTestId(CARD).props.accessibilityState).toBeUndefined();
  });

  it('R2 · check.checked=false 면 체크 원(checkbox, 안 체크)과 「추가」가 함께 보이고 카드는 선택 아님이다', () => {
    render(
      <PlaceAddRow
        place={PLACE}
        added={false}
        onPressAdd={jest.fn()}
        check={{ checked: false, onToggle: jest.fn() }}
      />
    );

    expect(screen.getByTestId(CHECK)).not.toBeChecked();
    expect(screen.getByTestId(ADD)).toBeOnTheScreen();
    expect(screen.getByTestId(CARD)).not.toBeSelected();
  });

  it('R3 · check.checked=true 면 체크 원이 체크됨이고 카드가 선택됨이다', () => {
    render(
      <PlaceAddRow
        place={PLACE}
        added={false}
        onPressAdd={jest.fn()}
        check={{ checked: true, onToggle: jest.fn() }}
      />
    );

    expect(screen.getByTestId(CHECK)).toBeChecked();
    expect(screen.getByTestId(CARD)).toBeSelected();
  });

  it('R4 · 체크 원을 누르면 onToggle 1회, 「추가」는 안 불린다 / 「추가」를 누르면 onPressAdd 1회, onToggle 은 안 불린다', () => {
    const onToggle = jest.fn();
    const onPressAdd = jest.fn();
    render(
      <PlaceAddRow
        place={PLACE}
        added={false}
        onPressAdd={onPressAdd}
        check={{ checked: false, onToggle }}
      />
    );

    fireEvent.press(screen.getByTestId(CHECK));
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onPressAdd).not.toHaveBeenCalled();

    fireEvent.press(screen.getByTestId(ADD));
    expect(onPressAdd).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('R5 · showAdd=false 면 「추가」가 없고 체크 원은 남는다 (체크가 하나라도 있을 때 페이지가 주는 값)', () => {
    render(
      <PlaceAddRow
        place={PLACE}
        added={false}
        showAdd={false}
        onPressAdd={jest.fn()}
        check={{ checked: true, onToggle: jest.fn() }}
      />
    );

    expect(screen.queryByTestId(ADD)).toBeNull();
    expect(screen.getByTestId(CHECK)).toBeOnTheScreen();
  });

  it('R5b · showAdd 를 안 주면 기본은 보임이다 (옵셔널 — 다른 소비처 무변경)', () => {
    render(<PlaceAddRow place={PLACE} added={false} onPressAdd={jest.fn()} />);
    expect(screen.getByTestId(ADD)).toBeOnTheScreen();
  });

  it('R6 · 이미 담은 행(added)은 「추가됨」만 — check 를 줘도 체크 원이 없고 「추가」도 없다', () => {
    render(
      <PlaceAddRow
        place={PLACE}
        added
        onPressAdd={jest.fn()}
        check={{ checked: false, onToggle: jest.fn() }}
      />
    );

    expect(screen.getByTestId(ADDED)).toBeOnTheScreen();
    expect(screen.queryByTestId(CHECK)).toBeNull();
    expect(screen.queryByTestId(ADD)).toBeNull();
  });

  it('R7 · showAdd=false 여도 담은 행의 「추가됨」은 그대로 보인다 (숨기는 건 「추가」 버튼뿐)', () => {
    render(
      <PlaceAddRow
        place={PLACE}
        added
        showAdd={false}
        onPressAdd={jest.fn()}
        check={{ checked: false, onToggle: jest.fn() }}
      />
    );

    expect(screen.getByTestId(ADDED)).toBeOnTheScreen();
  });
});
