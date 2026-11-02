import { act, render, screen } from '@testing-library/react-native';

import { FaultInjectionBadge } from './FaultInjectionBadge';
import { faultStore } from './store';

/**
 * 「실패 주입 켜짐」 표시 — 규칙이 없으면 아무것도 그리지 않고, 딥링크로 규칙이 생기면 그 자리에서 나타난다.
 * 재시작 뒤 저장값 복원은 store.test 가 본다. 위치·크기는 실화면 QA 몫(README 판정 4).
 */

jest.mock('@/shared/storage/stringValue', () => ({
  readStringValue: async () => null,
  writeStringValue: async () => undefined,
}));

describe('FaultInjectionBadge', () => {
  it('규칙이 없으면 없고, 규칙이 생기면 켜짐 표시와 규칙 수를 보인다', async () => {
    render(<FaultInjectionBadge />);
    await act(() => faultStore.ready());
    expect(screen.queryByTestId('dev-fault-badge')).toBeNull();

    await act(async () => {
      await faultStore.apply({ path: '/a', status: '500' });
    });

    expect(screen.getByText('실패 주입 켜짐 · 1')).toBeOnTheScreen();
  });
});
