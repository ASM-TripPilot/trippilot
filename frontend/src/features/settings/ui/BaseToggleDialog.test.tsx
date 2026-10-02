import { render, screen, within } from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';

import { BaseToggleDialog } from './BaseToggleDialog';

/**
 * TRIP-777 · l04 출발점 다이얼로그(라이브 Figma dialog 1606:2440) 값 정렬 — 딤 55%·카드 330·제목 19·본문 body색·버튼 h44.
 *
 * TRIP-1076 부터 l04 화면은 이 다이얼로그를 열지 않는다 — 프리뷰 키(`my-stays-dialog`)만 쓰는 고아 컴포넌트라
 * 직접 렌더해 잠근다(정리는 새 티켓 후보). 옛 `MyStaysScreen.l04parity.test.tsx` AC-4 describe 를 소스 옆으로
 * 옮겼다(TRIP-1148 · 01b Q4 — 화면 테스트가 이사 가도 이 컴포넌트는 features/settings 에 남는다).
 * 딤 실제 덮임·중앙 정렬은 jest 사각 — 6-b 몫.
 */

/** className 을 토큰 배열로 — 부분 문자열 비교(`h-12` ⊂ `h-120`)를 피한다. */
function tokens(el: { props: { className?: unknown } }): string[] {
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

/** 두 노드를 모두 품는 가장 가까운 host 조상 — "몇 칸 위"로 세지 않아 wrapper 하나에 안 깨진다. */
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

describe('🔴 TRIP-777 · l04 출발점 다이얼로그 (AC-4)', () => {
  // TRIP-1076: 화면 press 로는 더 이상 안 열린다 — 컴포넌트를 직접 그린다(프리뷰 키와 같은 합성).
  function openDialog() {
    render(<BaseToggleDialog onCancel={jest.fn()} onConfirm={jest.fn()} />);
  }

  it('딤은 화면 전체를 덮는 검정 55% 오버레이다', () => {
    openDialog();

    const dim = screen.getByTestId('my-stays-base-dialog');
    expect(tokens(dim)).toEqual(
      expect.arrayContaining(['absolute', 'inset-0', 'bg-scrim/55'])
    );
    expect(tokens(dim)).not.toContain('bg-scrim/40');
  });

  it('카드는 폭 330 · 모서리 20 이다', () => {
    openDialog();

    const card = nearestCommonHost(
      screen.getByText('출발점을 해제할까요?'),
      screen.getByTestId('my-stays-base-cancel')
    );
    expect(tokens(card)).toEqual(
      expect.arrayContaining(['w-[330px]', 'rounded-[20px]'])
    );
    expect(tokens(card)).not.toContain('w-[320px]');
  });

  it('제목은 19 Bold ink 이고, 본문은 body색(muted 아님)이다', () => {
    openDialog();

    const title = screen.getByText('출발점을 해제할까요?');
    expect(tokens(title)).toEqual(
      expect.arrayContaining(['text-[19px]', 'font-noto-bold', 'text-ink'])
    );
    expect(tokens(title)).not.toContain('text-[18px]');

    const body = screen.getByText('일정은 그대로예요.');
    expect(tokens(body)).toContain('text-body');
    expect(tokens(body)).not.toContain('text-muted');
  });

  it('버튼 둘은 높이 44 이고, 취소 글자는 body색 · 확정 글자는 흰색이다', () => {
    openDialog();

    for (const id of ['my-stays-base-cancel', 'my-stays-base-confirm']) {
      const button = screen.getByTestId(id);
      expect(tokens(button)).toContain('h-[44px]');
      expect(tokens(button)).not.toContain('h-12');
    }

    const cancel = within(screen.getByTestId('my-stays-base-cancel')).getByText(
      '취소'
    );
    expect(tokens(cancel)).toContain('text-body');
    expect(tokens(cancel)).not.toContain('text-ink');

    const confirm = within(
      screen.getByTestId('my-stays-base-confirm')
    ).getByText('해제');
    expect(tokens(confirm)).toContain('text-on-primary');
  });
});
