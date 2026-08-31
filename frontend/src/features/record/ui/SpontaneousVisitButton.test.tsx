import { fireEvent, render, screen } from '@testing-library/react-native';

import { SpontaneousVisitButton } from './SpontaneousVisitButton';

/**
 * TRIP-565 · AC-5(UI 반) — 즉석 방문 추가 버튼(순수 프레젠테이션).
 *
 * 무엇을 보장하나: testID `record-trip-spontaneous-add` 로 렌더되고, press 하면 onPress 가 1회 불린다.
 * 즉석 방문의 실제 적재(slotKey=null·MANUAL·2건 append)는 훅 레벨(useVisitCheck.integration.test)이 잠근다.
 */

describe('AC-5(UI) · 즉석 방문 추가 버튼', () => {
  it('record-trip-spontaneous-add press → onPress 1회', () => {
    const onPress = jest.fn();
    render(<SpontaneousVisitButton onPress={onPress} />);

    fireEvent.press(screen.getByTestId('record-trip-spontaneous-add'));

    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
