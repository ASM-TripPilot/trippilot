import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';

import { SavedStayListScreen } from './SavedStayListScreen';

/**
 * TRIP-1086 · AC-11 — e04 앱바는 d02 가 맞춰 갈 기준이라 이번 변경에서 바뀌지 않는다.
 *
 * 무엇을 보장하나: 앱바 컨테이너 className 이 `w-full gap-xs px-[24px] pb-[8px] pt-[8px]` 그대로이고,
 * 뒤로를 누르면 onBack 이 1회. (d02 쪽 위 여백 8 은 `SavedPlaceListScreen.test.tsx` `앱바`.)
 *
 * (개념) 앱바에는 testID 가 없다 — 뒤로 버튼과 제목 '저장한 숙소' 가 든 행을 찾고, 그 행을 감싼
 * 바로 위 host 상자를 앱바 컨테이너로 본다(e04 는 부제가 행 아래 별도 줄이라 두 겹이다).
 */

function tokens(el: ReactTestInstance): string[] {
  return String(el.props.className ?? '')
    .split(/\s+/)
    .filter(Boolean);
}

function ancestorsOf(node: ReactTestInstance): ReactTestInstance[] {
  const out: ReactTestInstance[] = [];
  let cur = node.parent;
  while (cur) {
    out.push(cur);
    cur = cur.parent;
  }
  return out;
}

function nearestCommonHost(
  a: ReactTestInstance,
  b: ReactTestInstance
): ReactTestInstance {
  const ofB = new Set(ancestorsOf(b));
  const found = ancestorsOf(a).find(
    (n) => typeof n.type === 'string' && ofB.has(n)
  );
  if (!found) throw new Error('공통 host 조상이 없다');
  return found;
}

describe('AC-11 · e04 앱바 무변경 잠금', () => {
  it('empty 얼굴의 앱바 컨테이너 className 이 그대로다(위·아래 8)', () => {
    render(<SavedStayListScreen savedStays={[]} face="empty" />);

    const row = nearestCommonHost(
      screen.getByTestId('saved-stay-back'),
      screen.getByText('저장한 숙소')
    );
    const container = ancestorsOf(row).find((n) => typeof n.type === 'string');
    if (!container) throw new Error('앱바 컨테이너가 없다');

    expect([...tokens(container)].sort()).toEqual(
      ['w-full', 'gap-xs', 'px-[24px]', 'pb-[8px]', 'pt-[8px]'].sort()
    );
  });

  it('뒤로를 누르면 onBack 이 1회 불린다', () => {
    const onBack = jest.fn();
    render(
      <SavedStayListScreen savedStays={[]} face="empty" onBack={onBack} />
    );

    fireEvent.press(screen.getByTestId('saved-stay-back'));

    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
