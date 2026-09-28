import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';

import {
  SavedPlaceListScreen,
  type SavedPlaceListScreenProps,
} from './SavedPlaceListScreen';

/**
 * TRIP-1086 · AC-10·AC-11 — d02 앱바 위 여백을 e04 와 같은 8 로 맞춘다(결정 3(a)).
 *
 * 무엇을 보장하나:
 *  - 🔴 AC-10: 어느 얼굴이든 앱바 컨테이너에 위 여백 8 이 있다. 아래 8 · 왼쪽 10 · 오른쪽 16 · 뒤로-제목
 *    간격 4 는 d02 Figma 그대로 유지(가로를 e04 로 옮기지 않는다).
 *  - AC-11: 뒤로를 누르면 onBack 이 1회.
 *
 * 볼 수 없는 몫(6-b 육안): 실제 앱바 높이와 d02·e04 빈 상태 콜라주·제목의 y 가 같은지.
 *
 * (개념) 앱바에는 testID 가 없다 — 뒤로 버튼과 제목 '담은 장소' 를 함께 품는 가장 가까운 host 상자를 앱바로 본다.
 */

/** 위·아래 8 을 뜻하는 토큰(tailwind spacing sm = 8px). `py-*` 는 위아래를 함께 준다. */
const TOP_8 = ['pt-sm', 'pt-[8px]', 'py-sm', 'py-[8px]'];
const BOTTOM_8 = ['pb-sm', 'pb-[8px]', 'py-sm', 'py-[8px]'];

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

function appBar(): ReactTestInstance {
  return nearestCommonHost(
    screen.getByTestId('explore-saved-back'),
    screen.getByText('담은 장소')
  );
}

const onBack = jest.fn();

function renderScreen(overrides: Partial<SavedPlaceListScreenProps> = {}) {
  render(
    <SavedPlaceListScreen
      savedPlaces={[]}
      onPressRemove={jest.fn()}
      onPressCreateTrip={jest.fn()}
      onPressBrowse={jest.fn()}
      onBack={onBack}
      {...overrides}
    />
  );
}

beforeEach(() => {
  onBack.mockClear();
});

describe('🔴 AC-10 · d02 앱바 위 여백 8 (얼굴 공통)', () => {
  it.each<[string, Partial<SavedPlaceListScreenProps>]>([
    ['empty', { state: { kind: 'empty' } }],
    ['results', {}],
    ['loading', { state: { kind: 'loading' } }],
    ['error', { state: { kind: 'error' } }],
    ['guest', { isGuest: true }],
  ])('%s 얼굴', (_face, overrides) => {
    renderScreen(overrides);

    const bar = tokens(appBar());
    const vertical = (prefix: RegExp) => bar.filter((t) => prefix.test(t));

    // 위 여백 — 8 계열 토큰이 있고, 다른 값의 위 여백 토큰은 섞이지 않는다.
    const top = vertical(/^(pt|py|p)-/);
    expect(top.length).toBeGreaterThan(0);
    expect(top.filter((t) => !TOP_8.includes(t))).toEqual([]);
    // 아래 여백 8 유지.
    const bottom = vertical(/^(pb|py|p)-/);
    expect(bottom.length).toBeGreaterThan(0);
    expect(bottom.filter((t) => !BOTTOM_8.includes(t))).toEqual([]);
    // 가로는 d02 Figma 그대로(e04 가로를 옮기지 않는다).
    expect(bar).toEqual(
      expect.arrayContaining(['pl-[10px]', 'pr-lg', 'gap-xs'])
    );
  });
});

describe('AC-11 · d02 뒤로 무회귀', () => {
  it('뒤로를 누르면 onBack 이 1회 불린다', () => {
    renderScreen({ state: { kind: 'empty' } });

    fireEvent.press(screen.getByTestId('explore-saved-back'));

    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
