import { fireEvent, render, screen } from '@testing-library/react-native';

import type { StayFilterOption } from '../model/stayFilterOptions';
import { StayFilterSheet } from './StayFilterSheet';

/**
 * TRIP-415 — e02 필터 시트(편의시설·숙소유형 다중 선택).
 *
 * 무엇을 보장하나: 옵션을 토글 칩으로 그리고(선택 상태를 accessibilityState 로 드러냄), 칩을
 * 누르면 그 값으로 토글 콜백이, [적용]·[닫기]는 각 콜백이 불린다. 선택 초안·적용은 페이지가
 * 지므로(완전 제어) 여기선 이벤트가 위로 올라가는지만 잰다.
 *
 * ⚠️ 시트 실제 열림/닫힘(gorhom 런타임)은 목이 children 을 무조건 렌더하므로 jest 가 못 본다
 * (repo-trap 바텀시트 계열) — 실기 스모크 몫.
 */

const AMENITIES: StayFilterOption[] = [
  { value: 'ocean', selected: true },
  { value: 'wifi', selected: false },
];
const STAY_TYPES: StayFilterOption[] = [{ value: 'HOTEL', selected: false }];

function renderSheet(
  overrides: Partial<React.ComponentProps<typeof StayFilterSheet>> = {}
) {
  const props = {
    amenities: AMENITIES,
    stayTypes: STAY_TYPES,
    onToggleAmenity: jest.fn(),
    onToggleStayType: jest.fn(),
    onApply: jest.fn(),
    onClose: jest.fn(),
    ...overrides,
  };
  render(<StayFilterSheet {...props} />);
  return props;
}

describe('StayFilterSheet (TRIP-415)', () => {
  it('편의시설·숙소유형 옵션을 그리고 선택 상태를 표시한다', () => {
    renderSheet();

    expect(screen.getByTestId('stay-filter-amenity-ocean')).toBeSelected();
    expect(screen.getByTestId('stay-filter-amenity-wifi')).not.toBeSelected();
    expect(screen.getByTestId('stay-filter-staytype-HOTEL')).toBeOnTheScreen();
  });

  it('칩을 누르면 그 값으로 토글 콜백이 불린다', () => {
    const props = renderSheet();

    fireEvent.press(screen.getByTestId('stay-filter-amenity-wifi'));
    fireEvent.press(screen.getByTestId('stay-filter-staytype-HOTEL'));

    expect(props.onToggleAmenity).toHaveBeenCalledWith('wifi');
    expect(props.onToggleStayType).toHaveBeenCalledWith('HOTEL');
  });

  it('[적용]·[닫기]는 각 콜백을 부른다', () => {
    const props = renderSheet();

    fireEvent.press(screen.getByTestId('stay-filter-apply'));
    fireEvent.press(screen.getByTestId('stay-filter-close'));

    expect(props.onApply).toHaveBeenCalledTimes(1);
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('걸 수 있는 필터가 없으면 안내만 그린다(옵션 0)', () => {
    renderSheet({ amenities: [], stayTypes: [] });

    expect(screen.getByTestId('stay-filter-sheet')).toHaveTextContent(
      /필터가 없어요/
    );
    expect(screen.queryByTestId('stay-filter-amenity-ocean')).toBeNull();
  });
});
