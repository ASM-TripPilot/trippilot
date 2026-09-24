import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { DELETION_SCOPE } from '../model/deletionScope';
import { DeleteAccountDialog } from './DeleteAccountDialog';

/**
 * TRIP-779 · l05 계정 삭제 다이얼로그 — 라이브 Figma(1단 1608:2440 · 2단 4531:3018) 값 정렬(A안).
 *
 * 무엇을 보장하나:
 *  - AC-4: 1단 불릿 한 줄 = `•` 글리프 + 항목, 둘 다 ink 색.
 *  - AC-5(구조로 잡히는 몫): 불릿 간격 6, 9항목(228)이 목록 높이 상한에 잘리지 않음, 버튼 h52·라벨 16,
 *    목록→버튼 20. AC-6: 2단도 버튼 h52·라벨 16, 본문→버튼 20.
 *  - A안 톤 유지: 1단 [계속] ink, 2단 [계정 삭제] primary.
 *
 * 2단 게이트(AC-12)와 문안(Q7)은 `DeleteAccountDialog.test.tsx`·`SettingsPage.test.tsx`(무수정)가 잠근다.
 * 카드 그림자·실제 잘림·딤 덮임은 jest 사각 — [검증] 스크린샷·6-b 몫.
 */

const LINE_HEIGHT = 20; // text-body = 14/20
const BULLET_GAP = 6;
const LIST_HEIGHT =
  DELETION_SCOPE.length * LINE_HEIGHT +
  (DELETION_SCOPE.length - 1) * BULLET_GAP; // 228

function renderDialog() {
  render(
    <DeleteAccountDialog onCancel={jest.fn()} onConfirmDeletion={jest.fn()} />
  );
}

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

/**
 * 노드에서 카드(`w-[330px]`)까지 올라가며 높이 상한을 모은다 — className `max-h-[Npx]`·`h-[Npx]` 와
 * 인라인 style `maxHeight`·`height` 둘 다(상한을 style 로 옮겨도 잡힌다). 카드가 없으면 루트까지.
 * 그 밖의 `max-h-*`·`h-*` 표기는 숫자를 모르므로 throw 한다.
 */
function heightCapsAbove(node: ReactTestInstance): number[] {
  const caps = new Set<number>();
  for (const n of ancestorsOf(node)) {
    for (const t of tokens(n)) {
      const m = /^(?:max-h|h)-\[(\d+(?:\.\d+)?)px\]$/.exec(t);
      if (m) caps.add(Number(m[1]));
      // 숫자를 못 읽는 높이 표기(`max-h-52`·`max-h-3xl` 등)는 통과시키지 않는다 — 놓치면 단언이 빈 배열로 green.
      else if (/^(?:[\w-]+:)*(?:max-h|h)-/.test(t))
        throw new Error(`높이 상한 표기를 읽을 수 없다: ${t}`);
    }
    const style = (StyleSheet.flatten(n.props.style) ?? {}) as {
      maxHeight?: unknown;
      height?: unknown;
    };
    for (const v of [style.maxHeight, style.height]) {
      if (typeof v === 'number') caps.add(v);
    }
    if (tokens(n).includes('w-[330px]')) break;
  }
  return [...caps];
}

function expectButtonSize(testID: string, label: string) {
  const button = screen.getByTestId(testID);
  expect(tokens(button)).toContain('h-[52px]');
  expect(tokens(button)).not.toContain('h-12');
  const text = within(button).getByText(label);
  expect(tokens(text)).toContain('text-[16px]');
  expect(tokens(text)).not.toContain('text-card-title');
}

function expectRowTopGap20(confirmTestID: string) {
  const row = nearestCommonHost(
    screen.getByTestId('settings-delete-cancel'),
    screen.getByTestId(confirmTestID)
  );
  const rowTokens = tokens(row);
  expect(rowTokens.includes('mt-xl') || rowTokens.includes('mt-[20px]')).toBe(
    true
  );
  expect(rowTokens).not.toContain('mt-2xl');
}

describe('🔴 TRIP-779 · l05 삭제 다이얼로그 1단 — 불릿 목록 (AC-4 · AC-5)', () => {
  it('불릿 한 줄은 `•` 글리프와 항목이고, 둘 다 ink 색이다(옛 `·` 글리프 없음)', () => {
    renderDialog();

    const glyphs = screen.getAllByText('•');
    expect(glyphs).toHaveLength(DELETION_SCOPE.length);
    glyphs.forEach((glyph) => expect(tokens(glyph)).toContain('text-ink'));
    DELETION_SCOPE.forEach((item) => {
      expect(tokens(screen.getByText(item))).toContain('text-ink');
    });
    expect(screen.queryAllByText('·')).toHaveLength(0);
  });

  it('불릿 사이 간격은 6이다', () => {
    renderDialog();

    const list = nearestCommonHost(
      screen.getByText(DELETION_SCOPE[0] as string),
      screen.getByText(DELETION_SCOPE[DELETION_SCOPE.length - 1] as string)
    );
    expect(tokens(list)).toContain(`gap-[${BULLET_GAP}px]`);
    expect(tokens(list)).not.toContain('gap-xs');
  });

  it(`9항목 전체 높이(${LIST_HEIGHT})가 목록 높이 상한에 잘리지 않는다`, () => {
    renderDialog();

    const caps = heightCapsAbove(screen.getByText(DELETION_SCOPE[0] as string));
    caps.forEach((cap) => expect(cap).toBeGreaterThanOrEqual(LIST_HEIGHT));
  });

  it('자가검사: 높이 상한 탐지기는 ScrollView 의 max-h 를 실제로 읽는다', () => {
    render(
      <ScrollView className="max-h-[220px]">
        <View>
          <Text>probe</Text>
        </View>
      </ScrollView>
    );

    expect(heightCapsAbove(screen.getByText('probe'))).toEqual([220]);
  });

  it('자가검사: 숫자를 못 읽는 토큰 표기 상한은 통과가 아니라 실패다', () => {
    for (const cap of ['max-h-52', 'max-h-3xl']) {
      render(
        <ScrollView className={cap}>
          <View>
            <Text>{cap}</Text>
          </View>
        </ScrollView>
      );

      expect(() => heightCapsAbove(screen.getByText(cap))).toThrow(cap);
    }
  });

  it('1단 버튼은 높이 52 · 라벨 16 이고, 버튼 줄은 목록과 20 떨어진다', () => {
    renderDialog();

    expectButtonSize('settings-delete-cancel', '취소');
    expectButtonSize('settings-delete-confirm', '계속');
    expectRowTopGap20('settings-delete-confirm');
  });
});

describe('🔴 TRIP-779 · l05 삭제 다이얼로그 2단 — 최종 확인 (AC-6)', () => {
  it('2단 버튼도 높이 52 · 라벨 16 이고, 버튼 줄은 본문과 20 떨어진다', () => {
    renderDialog();

    fireEvent.press(screen.getByTestId('settings-delete-confirm'));

    expectButtonSize('settings-delete-cancel', '취소');
    expectButtonSize('settings-delete-confirm-final', '계정 삭제');
    expectRowTopGap20('settings-delete-confirm-final');
  });

  it('A안 톤 유지: 1단 [계속]은 ink, 2단 [계정 삭제]는 primary(핑크)다', () => {
    renderDialog();

    expect(tokens(screen.getByTestId('settings-delete-confirm'))).toContain(
      'bg-ink'
    );

    fireEvent.press(screen.getByTestId('settings-delete-confirm'));

    expect(
      tokens(screen.getByTestId('settings-delete-confirm-final'))
    ).toContain('bg-primary');
  });
});
