import { render, screen } from '@testing-library/react-native';

import { OutOfScopeNotice } from './OutOfScopeNotice';

/**
 * TRIP-439 · AC-4 — 서버가 "이 여행에서 바꿀 수 없는 요청"으로 판정했을 때 시트 안에 뜨는
 * 인라인 안내(전체화면 교체 아님). 이 컴포넌트는 **표시만** 한다(BR-U4-14).
 *
 * 무엇을 보장하나:
 *  - 🔴 규약 testID(`planb-request-out-of-scope`)로 안내 제목을 그린다.
 *  - 🔴 인터랙션이 없다 — 클라가 내용을 재판정·재해석하지 않는다(BR-U4-13). 콜백 prop 없는 순수 표시.
 *
 * ★3 안내는 제목+부제 두 텍스트라 문자열 완전일치는 브리틀 → 정규식 부분포함으로 제목만 잠근다.
 * 도시명(부산)은 여행별 값이라 **안 잠근다**(브리프 관측: 서버/여행 종속).
 */

describe('🔴 N1 · OutOfScope 안내 표시 (AC-4 · 표시만)', () => {
  it('안내 블록이 제목과 함께 뜬다', () => {
    render(<OutOfScopeNotice />);

    expect(screen.getByTestId('planb-request-out-of-scope')).toHaveTextContent(
      /바꿀 수 있는 요청이 아니에요/
    );
  });
});

describe('🔴 N2 · 표시만 — 클라 무해석 (BR-U4-13)', () => {
  it('안내 안에 누를 수 있는 요소가 없다(재판정/재해석 표면 0)', () => {
    render(<OutOfScopeNotice />);

    // 표시 전용 — 버튼/링크가 없어야 한다.
    expect(screen.queryByRole('button')).toBeNull();
  });
});
