import { fireEvent, render, screen } from '@testing-library/react-native';
import { TextInput } from 'react-native';

import { MemoSheet } from './MemoSheet';

/**
 * TRIP-1503 — 입력 상자 어디를 눌러도 입력에 포커스를 넘긴다(구조 단언 + 포커스 위임).
 * 준비: 시트를 그린다 → 실행: 상자(live-memo-box)를 누른다 → 단언: 입력의 focus() 가 불린다.
 * 실제 키보드 노출은 통과형 바텀시트 목이라 jest 사각 — 6-b 실기 몫.
 */
describe('MemoSheet 입력 상자 탭 → 포커스 (TRIP-1503)', () => {
  it('상자(live-memo-box)를 누르면 입력의 focus() 가 1회 불린다', () => {
    render(
      <MemoSheet placeName="장소" onSubmit={jest.fn()} onClose={jest.fn()} />
    );
    const input = screen.UNSAFE_getByType(TextInput);
    const focus = jest.spyOn(input.instance, 'focus');

    fireEvent.press(screen.getByTestId('live-memo-box'));

    expect(focus).toHaveBeenCalledTimes(1);
  });
});
