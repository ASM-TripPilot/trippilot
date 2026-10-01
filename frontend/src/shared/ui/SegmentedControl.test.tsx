import { fireEvent, render, screen } from '@testing-library/react-native';

import { SegmentedControl, type SegmentedOption } from './SegmentedControl';

/**
 * N-1 (TRIP-730 · AC-S1) — shared/ui 연결형 세그먼트 컨트롤 유닛.
 *
 * 무엇을 보장하나: 도메인 무관한 세그먼트가 (1) 준 옵션 수만큼 셀을 라벨로 그리고 (2) `value` 와
 * 같은 셀만 선택 상태(`accessibilityState.selected`)로 표시하며 (3) 활성 셀을 누르면 그 key 로
 * `onChange` 를 부르고 (4) `disabled` 셀은 눌러도 `onChange` 를 부르지 않는다.
 *
 * 무엇을 못 보나(6-b/TRIP-831 전용): 흰 알약·그림자·연회색 컨테이너·높이 같은 픽셀은 jest 원리적
 * 사각이다(repo-traps 「stay 등록」 세그 절과 동형). 이 파일은 존재·선택·onChange·disabled 까지만 본다.
 *
 * 셀 선택 판정은 색(fill)이 아니라 **`accessibilityState.selected`** 로 관찰한다 — 선택 셀을 색만
 * 바꾸면 jest 가 못 본다(글리프 fill 사각 계열). disabled 셀 press 무발화는 RN Pressable 계약
 * (동결 `StayRegisterScreen.test.tsx` R-1 이 이미 통과로 증명)에 기댄다.
 */

const OPTIONS: SegmentedOption[] = [
  { key: 'mapsearch', label: '지도 검색' },
  { key: 'linkpaste', label: '링크 붙여넣기', disabled: true },
  { key: 'pin', label: '핀 지정' },
];

describe('N-1 · 세그먼트 컨트롤 (AC-S1)', () => {
  it('준 옵션 수만큼 셀이 라벨로 그려진다', () => {
    render(
      <SegmentedControl
        options={OPTIONS}
        value="mapsearch"
        onChange={jest.fn()}
      />
    );

    expect(screen.getByText('지도 검색')).toBeOnTheScreen();
    expect(screen.getByText('링크 붙여넣기')).toBeOnTheScreen();
    expect(screen.getByText('핀 지정')).toBeOnTheScreen();
  });

  it('value 와 같은 셀만 선택 상태다', () => {
    render(
      <SegmentedControl options={OPTIONS} value="pin" onChange={jest.fn()} />
    );

    // testID 미지정이면 `segmented-${key}` 가 기본이다.
    expect(screen.getByTestId('segmented-pin')).toBeSelected();
    expect(screen.getByTestId('segmented-mapsearch')).not.toBeSelected();
  });

  it('활성 미선택 셀을 누르면 그 key 로 onChange 가 1회 불린다', () => {
    const onChange = jest.fn();
    render(
      <SegmentedControl
        options={OPTIONS}
        value="mapsearch"
        onChange={onChange}
      />
    );

    fireEvent.press(screen.getByTestId('segmented-pin'));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('pin');
  });

  it('disabled 셀은 잠겨 있고, 눌러도 onChange 가 불리지 않는다', () => {
    const onChange = jest.fn();
    render(
      <SegmentedControl
        options={OPTIONS}
        value="mapsearch"
        onChange={onChange}
      />
    );

    const locked = screen.getByTestId('segmented-linkpaste');
    expect(locked).toBeDisabled();
    fireEvent.press(locked);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('옵션이 자기 testID 를 주면 그 값이 셀 testID 가 된다', () => {
    render(
      <SegmentedControl
        options={[
          {
            key: 'mapsearch',
            label: '지도 검색',
            testID: 'stay-register-tab-mapsearch',
          },
        ]}
        value="mapsearch"
        onChange={jest.fn()}
      />
    );

    expect(screen.getByTestId('stay-register-tab-mapsearch')).toBeOnTheScreen();
  });
});
