import { render, screen } from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';

import { VisitRecordCard } from './VisitRecordCard';

/**
 * TRIP-1086 · AC-8 — 방문 카드 머리 행: 긴 이름이 한 줄에서 줄어들고, 시각·버튼 묶음과 붙지 않는다.
 *
 * 무엇을 보장하나(jest 가 볼 수 있는 몫):
 *  - 이름 Text 는 `numberOfLines=1` 이고 스스로 줄어들 수 있다(`shrink` 또는 `flex-1`).
 *  - 이름이 든 왼쪽 묶음은 남은 폭을 차지하고 줄어들 수 있다(`flex-1`·`min-w-0`).
 *  - 바깥 행은 두 묶음 사이에 간격 `gap-sm` 을 둔다(01b 판단 2).
 *
 * 볼 수 없는 몫(6-b 육안): 실제 말줄임 '…' · 겹침 · 간격 픽셀. RN 은 flexShrink 기본값이 0 이라
 * 토큰이 맞아도 기기에서만 확인된다(02a §4-★6).
 *
 * (개념) className 은 NativeWind 가 렌더 트리 host 노드에 prop 으로 남긴다 — 토큰 배열로 잘라 비교한다.
 */

type Card = React.ComponentProps<typeof VisitRecordCard>['card'];

const LONG_NAME = '150년 수령 느티나무';
const T = '2026-09-29T05:30:00';

function card(over: Partial<Card> = {}): Card {
  return {
    visitCheckId: 'v1',
    poiId: 'p1',
    nameKo: LONG_NAME,
    slotKey: null,
    arrivedAt: null,
    completedAt: null,
    skippedAt: null,
    arrivedLabel: null,
    ...over,
  };
}

/** className 을 토큰 배열로 — 부분 문자열 비교(`h-12` ⊂ `h-120`)를 피한다. */
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

/** 두 노드를 모두 품는 가장 가까운 host 조상 — "몇 칸 위"로 세지 않아 래퍼 하나에 안 깨진다. */
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

/** QA 재현 상태 — 도착만 한 IN_PROGRESS + 시각 + 시각 수정 + 건너뛰기(오른쪽 묶음이 가장 넓다). */
function renderWidest() {
  render(
    <VisitRecordCard
      card={card({ arrivedAt: T, arrivedLabel: '05:30' })}
      onPressEditTime={jest.fn()}
      onPressSkip={jest.fn()}
      onPressComplete={jest.fn()}
    />
  );
}

describe('🔴 AC-8 · 긴 이름 — 한 줄 말줄임 + 두 묶음 사이 간격', () => {
  it('이름 Text 는 한 줄(numberOfLines=1)이다', () => {
    renderWidest();

    expect(screen.getByText(LONG_NAME).props.numberOfLines).toBe(1);
  });

  it('이름 Text 자체가 줄어들 수 있다(shrink 또는 flex-1 — RN flexShrink 기본 0)', () => {
    renderWidest();

    const nameTokens = tokens(screen.getByText(LONG_NAME));
    expect(nameTokens.includes('shrink') || nameTokens.includes('flex-1')).toBe(
      true
    );
  });

  it('이름과 상태 원을 품은 왼쪽 묶음은 flex-1 · min-w-0 이다', () => {
    renderWidest();

    const left = nearestCommonHost(
      screen.getByText(LONG_NAME),
      screen.getByTestId('record-visit-check-active-v1')
    );
    expect(tokens(left)).toEqual(expect.arrayContaining(['flex-1', 'min-w-0']));
  });

  it('이름과 시각을 품은 바깥 행은 가로 양끝 정렬 + 사이 간격 gap-sm 이다', () => {
    renderWidest();

    const row = nearestCommonHost(
      screen.getByText(LONG_NAME),
      screen.getByText('05:30')
    );
    expect(tokens(row)).toEqual(
      expect.arrayContaining(['flex-row', 'justify-between', 'gap-sm'])
    );
  });
});

describe('🔴 AC-8 · 4상태 모두 이름은 한 줄', () => {
  it.each<[string, Partial<Card>]>([
    ['COMPLETED', { arrivedAt: T, completedAt: T }],
    ['IN_PROGRESS', { arrivedAt: T }],
    ['UPCOMING', {}],
    ['SKIPPED', { skippedAt: T }],
  ])('%s 카드', (_label, over) => {
    render(<VisitRecordCard card={card(over)} />);

    expect(screen.getByText(LONG_NAME).props.numberOfLines).toBe(1);
  });
});
