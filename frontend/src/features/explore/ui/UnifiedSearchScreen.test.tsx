import { fireEvent, render, screen } from '@testing-library/react-native';

import { UnifiedSearchScreen } from './UnifiedSearchScreen';

/**
 * TRIP-469 — d05 통합 검색 화면을 RegionPickerScreen 과 패턴 통일한 두 지점.
 *
 * 무엇을 보장하나:
 *  · 앱바 뒤로가기(explore-search-back)가 onBack 을 부른다(예전엔 back 버튼 자체가 없었다).
 *  · 여행지 섹션이 0건이면(검색 결과 없음) 빈 상태 문구를 낸다(불릴 목록 없이 침묵하지 않는다).
 */

const noop = () => {};

function baseProps() {
  return {
    onBack: noop,
    searchText: '',
    onChangeSearch: noop,
    heading: '여행지 · 장소 · 숙소 검색',
    region: { error: false, rows: [], onRetry: noop },
    place: { error: false, cards: [], onRetry: noop },
    stay: { noRegion: true, error: false, cards: [], onRetry: noop },
  };
}

describe('UnifiedSearchScreen — 뒤로가기(TRIP-469)', () => {
  it('explore-search-back 을 누르면 onBack 이 불린다', () => {
    const onBack = jest.fn();
    render(<UnifiedSearchScreen {...baseProps()} onBack={onBack} />);

    fireEvent.press(screen.getByTestId('explore-search-back'));

    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

describe('UnifiedSearchScreen — 여행지 빈 상태(TRIP-469)', () => {
  it('rows 가 0건이고 오류가 아니면 "검색 결과가 없어요"를 낸다', () => {
    render(
      <UnifiedSearchScreen
        {...baseProps()}
        region={{ error: false, rows: [], onRetry: noop }}
      />
    );

    expect(screen.getByTestId('explore-search-region-empty')).toBeOnTheScreen();
  });

  it('rows 가 있으면 빈 상태가 아니라 행을 그린다', () => {
    render(
      <UnifiedSearchScreen
        {...baseProps()}
        region={{
          error: false,
          rows: [{ code: '26', name: '부산', onPress: noop }],
          onRetry: noop,
        }}
      />
    );

    expect(screen.queryByTestId('explore-search-region-empty')).toBeNull();
    expect(screen.getByTestId('explore-search-region-26')).toBeOnTheScreen();
  });
});
