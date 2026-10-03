import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import { DeleteAccountDialog } from './DeleteAccountDialog';
import type { ReactTestInstance } from 'react-test-renderer';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { DELETION_SCOPE } from '../model/deletionScope';

/**
 * l05 계정 삭제 다이얼로그 단위 테스트(2단 게이트 · 고지 목록 · Figma 값).
 *
 * 한 파일로 합친 기록(TRIP-1154): 옛 `DeleteAccountDialog{,.l05parity}.test.tsx` 2개를 각자의 바깥 describe 로 옮겼다.
 */

// TRIP-935
describe('고지 문구 (옛 .test)', () => {
  /**
   * TRIP-935 Q7 — 삭제 다이얼로그 고지 문구가 실제 동작(30일 유예 · 그 안에 철회 가능)과 맞는다.
   *
   * 무엇을 보장하나:
   *  - 1단·2단 어디에도 "되돌릴 수 없다"는 고지가 없다 — 서버는 30일 유예로 들어가고 그동안 철회할
   *    수 있다(BR-U0-23 · BR-U6-26).
   *  - 최종 확인(2단)이 30일 유예와 그 전 취소/철회 가능을 알린다. 정확한 자구는 구현 재량(부분포함).
   *  - 2단 게이트(1단 [계속]은 콜백 0, 2단 [계정 삭제]만 1회)는 문구를 바꿔도 그대로다.
   *
   * 오버레이의 실제 덮임·열림은 jest 사각(repo-traps) — 여기선 그려진 글자와 콜백만 본다.
   */

  function renderDialog() {
    const onCancel = jest.fn();
    const onConfirmDeletion = jest.fn();
    render(
      <DeleteAccountDialog
        onCancel={onCancel}
        onConfirmDeletion={onConfirmDeletion}
      />
    );
    return { onCancel, onConfirmDeletion };
  }

  describe('🔴 TRIP-935 Q7 · 삭제 고지는 30일 유예와 맞는다', () => {
    it('1단: "되돌릴 수 없" 고지가 없다', () => {
      renderDialog();

      // 앵커 — 1단이 그려졌다.
      expect(screen.getByTestId('settings-delete-confirm')).toBeOnTheScreen();
      expect(screen.queryAllByText(/되돌릴 수 없/)).toHaveLength(0);
    });

    it('2단: "되돌릴 수 없" 대신 30일 유예와 그 전 취소 가능을 알린다', () => {
      renderDialog();

      fireEvent.press(screen.getByTestId('settings-delete-confirm'));

      // 앵커 — 2단(최종 확인)으로 넘어왔다.
      expect(
        screen.getByTestId('settings-delete-confirm-final')
      ).toBeOnTheScreen();
      expect(screen.queryAllByText(/되돌릴 수 없/)).toHaveLength(0);
      expect(screen.getAllByText(/30일/).length).toBeGreaterThanOrEqual(1);
      expect(
        screen.getAllByText(/(취소|철회)할 수 있/).length
      ).toBeGreaterThanOrEqual(1);
    });

    it('짝: 문구가 바뀌어도 2단 게이트는 그대로 — 1단 [계속]은 콜백 0, 2단 [계정 삭제]가 1회', () => {
      const { onConfirmDeletion } = renderDialog();

      fireEvent.press(screen.getByTestId('settings-delete-confirm'));
      expect(onConfirmDeletion).not.toHaveBeenCalled();

      fireEvent.press(screen.getByTestId('settings-delete-confirm-final'));
      expect(onConfirmDeletion).toHaveBeenCalledTimes(1);
    });
  });

  // TRIP-772 · 맹점 ② — 2단 프리뷰 키가 생겨도 게이트의 기본 얼굴은 1단이다.
  // 무엇을 보장하나: 필수 두 prop 만 주면 삭제 범위 고지(1단)부터 열리고, 최종 확인(2단)은 없다.
  // 프로덕션이 두 prop 만 넘긴다는 사용처 잠금은 eslint `no-restricted-syntax`(TRIP-1145 · `importBoundaryLayers` 탐침).
  describe('TRIP-772 · 기본 렌더는 1단부터', () => {
    it('필수 prop 만 주면 1단 [계속]이 있고 2단 [계정 삭제]는 없다', () => {
      // 준비·실행: 필수 prop 두 개만으로 렌더.
      const { onConfirmDeletion } = renderDialog();

      // 단언: 1단 얼굴, 2단 최종 버튼 부재, 삭제 콜백 0회.
      expect(screen.getByTestId('settings-delete-confirm')).toBeOnTheScreen();
      expect(screen.queryByTestId('settings-delete-confirm-final')).toBeNull();
      expect(onConfirmDeletion).not.toHaveBeenCalled();
    });
  });
});

// TRIP-779
describe('Figma 정합 · 목록 높이 상한 (옛 .l05parity)', () => {
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

      const caps = heightCapsAbove(
        screen.getByText(DELETION_SCOPE[0] as string)
      );
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
});
