import { fireEvent, render, screen } from '@testing-library/react-native';

import { LocationAlwaysExplainer } from './LocationAlwaysExplainer';

/**
 * TRIP-1339 · 승격 설명(DEC-U10-11 · BR-U10-05·06·08 · Figma u10a 4857:2795). props 만 받는 뷰 —
 * OS 대화상자를 직접 부르지 않는다(콜백만). 실제 덮임·열림은 6-b(오버레이 다이얼로그 사각, repo-traps).
 * 3동작 뼈대: 준비=날짜 라벨·콜백 → 실행=렌더·탭 → 단언=카피·콜백.
 */
describe('LocationAlwaysExplainer', () => {
  const renderIt = () => {
    const onEnable = jest.fn();
    const onLater = jest.fn();
    render(
      <LocationAlwaysExplainer
        dateRangeLabel="10월 14일~16일"
        onEnable={onEnable}
        onLater={onLater}
      />
    );
    return { onEnable, onLater };
  };

  it('LX1 무엇을·언제만·보이는 것·끄는 법 4행 + 제목', () => {
    renderIt();
    expect(screen.getByTestId('location-explainer-title')).toHaveTextContent(
      '앱을 닫아도 방문을 자동으로 기록할까요?'
    );
    expect(screen.getByText('무엇을')).toBeTruthy();
    expect(screen.getByText(/여행 날짜\(10월 14일~16일\) 동안만/)).toBeTruthy();
    expect(
      screen.getByTestId('location-explainer-indicator-note')
    ).toHaveTextContent(
      '기록하는 동안 화면 위 상태바에 위치 사용 표시가 떠요.'
    );
    expect(
      screen.getByText('설정 › 위치정보 동의에서 언제든 끌 수 있어요.')
    ).toBeTruthy();
  });

  it('LX2 [자동 기록 켜기]·[나중에] 는 각자 콜백 1회', () => {
    const { onEnable, onLater } = renderIt();
    fireEvent.press(screen.getByTestId('location-explainer-enable'));
    fireEvent.press(screen.getByTestId('location-explainer-later'));
    expect(onEnable).toHaveBeenCalledTimes(1);
    expect(onLater).toHaveBeenCalledTimes(1);
  });

  it('LX3 "허용"·소요시간·속도·체류 시간·걸음 수 문구가 없다(심사 문구 · INV-3)', () => {
    renderIt();
    const text = JSON.stringify(screen.toJSON());
    expect(text).not.toMatch(/허용|소요|이동 시간|속도|체류|걸음/);
  });
});
