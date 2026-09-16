import { render, screen } from '@testing-library/react-native';

import { SheetHeader } from './SheetHeader';

/**
 * TRIP-783 · AC-3 — 시트 헤더(widgets, presentation-only). `title·dayLabel·dateLabel·meta`
 * 4문자열을 소비처가 조립해 주입하고, 헤더는 각각 값 하나만 담는 leaf 로 그린다(합산·날짜 포맷은
 * 소비처 몫 — 셸을 presentation-only 로 유지, 01b Q3 결정). 각 leaf 는 `toHaveTextContent(문자열)`
 * **완전일치**로 잠근다(가운뎃점 구분자는 testID 없는 별도 Text, 02a §5 실검증).
 *
 * 3동작 뼈대: 준비=4문자열 주입 렌더 → 실행=렌더만 → 단언=leaf 완전일치.
 */

describe('🔴 SheetHeader · SHH1 — 4 leaf 완전일치(AC-3)', () => {
  it('title·dayLabel·dateLabel·meta 가 각각 값 하나만 담는 leaf 로 그려진다', () => {
    render(
      <SheetHeader
        title="AI 추천안"
        dayLabel="1일차"
        dateLabel="6월 10일(수)"
        meta="4곳 · 3.5km"
      />
    );

    expect(screen.getByTestId('sheet-header-title')).toHaveTextContent(
      'AI 추천안'
    );
    expect(screen.getByTestId('sheet-header-day')).toHaveTextContent('1일차');
    expect(screen.getByTestId('sheet-header-date')).toHaveTextContent(
      '6월 10일(수)'
    );
    expect(screen.getByTestId('sheet-header-meta')).toHaveTextContent(
      '4곳 · 3.5km'
    );

    // 완전일치 잠금(02a ★1) — meta 는 한 leaf 에 조립 문자열 전체를 담는다(부분포함이면 통과).
    expect(screen.getByTestId('sheet-header-meta')).not.toHaveTextContent(
      '4곳'
    );
  });
});
