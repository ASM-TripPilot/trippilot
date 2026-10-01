import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';

import { GenerationProgressCard } from './GenerationProgressCard';
import type { GenerationProgressCell } from './GenerationProgressCard';

/**
 * TRIP-790 · AC-7 — h07 부분 결과의 상단 진행 카드(widgets · presentation-only).
 *
 * 무엇을 보장하나:
 *  - 셀은 **주입받는다**(`{status, label}[]`). 위젯은 features(`buildGenerationGauge`)를 못 물어
 *    판단을 안 한다 — 받은 status 로 톤을, 받은 label 로 글자를 그릴 뿐이다([[presentation-only
 *    위젯 — 판단은 소비처로]]).
 *  - done=primary 트랙 / active·waiting=회색 트랙 3톤 + onBack + **퍼센트·캡션 없음**(계약).
 *  - TRIP-752: 선택형 `title`·`onCancel` — i05 는 제목을 바꾸고 [취소]를 단다(GP5). 안 주면 h07 그대로(GP6).
 *
 * 3동작 뼈대: 준비=cells 3종+onBack 주입 → 실행=렌더/back press → 단언=testID·라벨·톤·콜백.
 *
 * ⚠️ 원리적 사각(6-b): ✦(FullAi)·✓(Check) 글리프는 SVG stroke/fill 이라 jest 가 못 본다.
 *   active 트랙 내부 primary 부분채움·active 라벨 붉은색도 픽셀이라 6-b 육안(02a §7). 여기선
 *   트랙 **배경 톤**(className)까지만 잠근다.
 */

const CELLS = [
  { status: 'done' as const, label: '1일차 완성' },
  { status: 'active' as const, label: '2일차 생성 중' },
  { status: 'waiting' as const, label: '3일차 대기' },
];

// className 토큰 포함 여부 — 부분 문자열 오탐을 피해 공백 분할 후 정확 토큰으로 본다
// (TimelineScreen.placeholder PH1 선례, className 은 jest 렌더 트리에 평문 prop 으로 남는다).
function classTokens(testID: string): string[] {
  return String(screen.getByTestId(testID).props.className).split(/\s+/);
}

describe('🔴 GenerationProgressCard · GP1 — 조립·셀·라벨 (AC-7)', () => {
  it('카드·3셀(상태별 testID)·주입 라벨이 그려진다', () => {
    render(<GenerationProgressCard cells={CELLS} onBack={jest.fn()} />);

    expect(screen.getByTestId('generation-progress-card')).toBeOnTheScreen();
    // 상태를 testID 로 구분 — done/active/waiting 각 하나.
    expect(
      screen.getByTestId('generation-gauge-cell-1-done')
    ).toBeOnTheScreen();
    expect(
      screen.getByTestId('generation-gauge-cell-2-active')
    ).toBeOnTheScreen();
    expect(
      screen.getByTestId('generation-gauge-cell-3-waiting')
    ).toBeOnTheScreen();
    // 라벨은 주입값 그대로 — getByText 는 text 노드 완전일치.
    expect(screen.getByText('1일차 완성')).toBeOnTheScreen();
    expect(screen.getByText('2일차 생성 중')).toBeOnTheScreen();
    expect(screen.getByText('3일차 대기')).toBeOnTheScreen();
  });
});

describe('🔴 GenerationProgressCard · GP2 — 3톤 트랙 (className)', () => {
  it('done 트랙은 bg-primary, active·waiting 트랙은 bg-surface-strong 이다', () => {
    render(<GenerationProgressCard cells={CELLS} onBack={jest.fn()} />);

    // done = 브랜드 채움.
    expect(classTokens('generation-gauge-track-1')).toContain('bg-primary');
    // active·waiting = 회색 트랙(부분채움·라벨색은 6-b 육안 · 02a §7).
    expect(classTokens('generation-gauge-track-2')).toContain(
      'bg-surface-strong'
    );
    expect(classTokens('generation-gauge-track-3')).toContain(
      'bg-surface-strong'
    );
    // done 과 구분 — active 트랙에 primary 채움이 새면 "전부 완성" 가짜 진척이 된다.
    expect(classTokens('generation-gauge-track-2')).not.toContain('bg-primary');
  });
});

describe('🔴 GenerationProgressCard · GP3 — onBack 콜백', () => {
  it('back 을 누르면 onBack 이 정확히 한 번 불린다', () => {
    const onBack = jest.fn();
    render(<GenerationProgressCard cells={CELLS} onBack={onBack} />);

    fireEvent.press(screen.getByTestId('generation-progress-back'));

    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

describe('🔴 GenerationProgressCard · GP5 — i05 제목 주입 + [취소] (TRIP-752 AC-2)', () => {
  it('주입한 제목을 그리고, [취소]는 onCancel 만·back 은 onBack 만 부른다', () => {
    const onBack = jest.fn();
    const onCancel = jest.fn();
    render(
      <GenerationProgressCard
        title="AI가 일정을 다시 짜고 있어요"
        cells={[
          { status: 'done', label: '방문한 곳 그대로' },
          { status: 'active', label: '17시 이후 다시 짜는 중' },
        ]}
        onBack={onBack}
        onCancel={onCancel}
      />
    );

    expect(screen.getByText('AI가 일정을 다시 짜고 있어요')).toBeOnTheScreen();
    expect(screen.queryByText('AI가 일정을 짜고 있어요')).toBeNull();
    const cancel = screen.getByTestId('generation-progress-cancel');
    expect(cancel).toHaveTextContent('취소');

    fireEvent.press(cancel);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onBack).not.toHaveBeenCalled();

    fireEvent.press(screen.getByTestId('generation-progress-back'));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe('GenerationProgressCard · GP6 — h07 무회귀: 새 prop 을 안 주면 예전 그대로 (TRIP-752 AC-2)', () => {
  it('제목은 기본 문구이고 [취소]는 없다', () => {
    render(<GenerationProgressCard cells={CELLS} onBack={jest.fn()} />);

    expect(screen.getByText('AI가 일정을 짜고 있어요')).toBeOnTheScreen();
    expect(screen.queryByTestId('generation-progress-cancel')).toBeNull();
    expect(screen.queryByText('취소')).toBeNull();
  });
});

describe('🔴 GenerationProgressCard · GP4 — 퍼센트·캡션 없음 (계약 · INV-3)', () => {
  it('% 와 진행 수치·소요/캡션 어휘가 0건이다', () => {
    render(<GenerationProgressCard cells={CELLS} onBack={jest.fn()} />);

    // generationState 는 3값 열거뿐 — 진행 수치가 계약에 없다(Figma 67% 는 안 그린다).
    expect(screen.queryAllByText(/%/)).toEqual([]);
    // 옛 인라인 카드 캡션("…계산 중 · 곧 완성돼요")·소요시간 어휘도 안 그린다(INV-3).
    expect(screen.queryAllByText(/계산|곧 완성|소요|분|시간/)).toEqual([]);
  });
});

// ── TRIP-1040 · 칸 상한·접기 칸·라벨 1줄 ────────────────────────────────────────
//
// 위젯은 접기를 **판단하지 않는다** — 소비처(DraftPage)가 `foldGenerationGauge` 로 고른 칸을 받아
// 받은 자리 그대로 그릴 뿐이다. 접기 칸은 `{ status: 'more' }`(label 없음)이고 testID 는
// `generation-gauge-cell-more`, 일차 칸 testID 의 n 은 **일차가 아니라 칸 위치**다(02a ★1).

/** 칸 testID 를 렌더 트리 순서(전위순회)대로 — 트랙(`generation-gauge-track-*`)은 안 잡힌다. */
function cellOrder(): string[] {
  return screen
    .getAllByTestId(/^generation-gauge-cell-/)
    .map((node) => String(node.props.testID));
}

/** 라벨 `Text` 를 감싼 행 — 가장 가까운 host View 조상(래퍼 composite 를 건너뛴다 · 02a ★8). */
function labelRowOf(text: ReactTestInstance): ReactTestInstance | null {
  let node = text.parent;
  // host 요소의 type 은 문자열('View')이다 — ElementType 타입이라 unknown 으로 비교한다.
  while (node !== null && (node.type as unknown) !== 'View') node = node.parent;
  return node;
}

function tokensOf(node: ReactTestInstance | null): string[] {
  return String(node?.props.className ?? '').split(/\s+/);
}

describe('🔴 GenerationProgressCard · GP7 — 라벨은 한 줄, 넘치면 말줄임 (TRIP-1040 AC-6)', () => {
  it('모든 라벨 Text 가 numberOfLines=1·ellipsizeMode=tail·shrink 이고, 라벨 행은 min-w-0 이다', () => {
    render(<GenerationProgressCard cells={CELLS} onBack={jest.fn()} />);

    for (const { label } of CELLS) {
      const text = screen.getByText(label);
      expect(text.props.numberOfLines).toBe(1);
      expect(text.props.ellipsizeMode).toBe('tail');
      // 가로 행 안 Text 는 기본 flexShrink 0 이라 shrink 가 있어야 행 폭 안에서 잘린다(02a §3.2).
      expect(tokensOf(text)).toContain('shrink');
      expect(tokensOf(labelRowOf(text))).toContain('min-w-0');
    }
  });
});

describe('🔴 GenerationProgressCard · GP8 — 뒤 접기 칸은 받은 자리(끝)에, 트랙·숫자 없이 흐린 … 로 (TRIP-1040 AC-2·AC-7)', () => {
  it('[완성, 생성 중, 대기, …] 순서로 그리고, 접기 칸은 글자 … 뿐이며 트랙이 없다', () => {
    const cells: GenerationProgressCell[] = [...CELLS, { status: 'more' }];
    render(<GenerationProgressCard cells={cells} onBack={jest.fn()} />);

    expect(cellOrder()).toEqual([
      'generation-gauge-cell-1-done',
      'generation-gauge-cell-2-active',
      'generation-gauge-cell-3-waiting',
      'generation-gauge-cell-more',
    ]);

    const more = screen.getByTestId('generation-gauge-cell-more');
    // toHaveTextContent(문자열) = 완전 일치 — 숫자·"남음"이 한 글자라도 붙으면 red.
    expect(more).toHaveTextContent('…');
    // 트랙 톤은 "완성/미완성" 주장이라 접기 칸엔 트랙이 없다(Q2). 트랙은 일차 칸 3개뿐.
    expect(within(more).queryAllByTestId(/^generation-gauge-track-/)).toEqual(
      []
    );
    expect(screen.getAllByTestId(/^generation-gauge-track-/)).toHaveLength(3);
    // 흐린 … (Seed) — 색 토큰은 className 평문으로 남는다.
    expect(tokensOf(within(more).getByText('…'))).toContain('text-muted');
    // 카드 어디에도 남은 개수·퍼센트가 없다(BR-U3-05 ⚑C).
    expect(screen.queryAllByText(/남음|%/)).toEqual([]);
  });
});

describe('🔴 GenerationProgressCard · GP9 — 앞 접기도 받은 자리(처음) 그대로, n 은 칸 위치 (TRIP-1040 AC-3·AC-8)', () => {
  it('[…, 3일차 완성, 4일차 완성, 5일차 생성 중] 이면 일차 칸 testID 는 cell-2 부터이고 글자가 일차를 말한다', () => {
    const cells: GenerationProgressCell[] = [
      { status: 'more' },
      { status: 'done', label: '3일차 완성' },
      { status: 'done', label: '4일차 완성' },
      { status: 'active', label: '5일차 생성 중' },
    ];
    render(<GenerationProgressCard cells={cells} onBack={jest.fn()} />);

    expect(cellOrder()).toEqual([
      'generation-gauge-cell-more',
      'generation-gauge-cell-2-done',
      'generation-gauge-cell-3-done',
      'generation-gauge-cell-4-active',
    ]);
    // ★ n 은 일차가 아니다 — cell-2 의 글자가 "3일차 완성"이다. 일차는 글자로 읽는다.
    expect(
      screen.getByTestId('generation-gauge-cell-2-done')
    ).toHaveTextContent('3일차 완성');
    expect(
      screen.getByTestId('generation-gauge-cell-4-active')
    ).toHaveTextContent('5일차 생성 중');
    // 트랙도 칸 위치를 따른다 — 1번 자리(접기 칸)엔 트랙이 없다.
    expect(screen.queryByTestId('generation-gauge-track-1')).toBeNull();
    for (const n of [2, 3, 4]) {
      expect(
        screen.getByTestId(`generation-gauge-track-${n}`)
      ).toBeOnTheScreen();
    }
  });
});

describe('GenerationProgressCard · GP10 — 위젯은 스스로 자르지 않는다 (TRIP-1040 AC-8 · 선제 green)', () => {
  it('일차 칸 6개를 주면 6개를 전부 그리고 접기 칸을 만들지 않는다', () => {
    const six: GenerationProgressCell[] = [1, 2, 3, 4, 5, 6].map((day) => ({
      status: day === 1 ? 'done' : day === 2 ? 'active' : 'waiting',
      label: `${day}일차`,
    }));
    render(<GenerationProgressCard cells={six} onBack={jest.fn()} />);

    // 상한 판단은 소비처 몫 — 위젯에 상한이 새면 여기서 6 이 4 로 줄어 red.
    expect(screen.getAllByTestId(/^generation-gauge-cell-\d+-/)).toHaveLength(
      6
    );
    expect(screen.queryByTestId('generation-gauge-cell-more')).toBeNull();
  });
});

describe('🔴 GenerationProgressCard · GP11 — 접기 칸 타입엔 label 통로가 없다 (TRIP-1040 AC-7 · tsc 판정)', () => {
  it('{ status: "more" } 는 칸이 되고, 거기에 label 을 붙이면 타입 오류다', () => {
    // 양성 — 접기 칸은 label 없이 셀이 된다(구현 전엔 'more' 가 없어 tsc red).
    const more: GenerationProgressCell = { status: 'more' };
    // 음성 — 소비처가 접기 칸에 숫자 문구를 끼울 통로가 타입에서 막혀 있어야 한다. label 을
    //   선택 필드로 열면 이 지시문이 "쓰이지 않음"(TS2578)이 되어 `pnpm tsc` 가 red 다(02a ★9).
    // @ts-expect-error — 접기 칸에는 label 이 없다.
    const leaky: GenerationProgressCell = { status: 'more', label: '3개 남음' };

    // 런타임에서는 값만 확인한다(판정은 tsc 몫).
    expect(more).toEqual({ status: 'more' });
    expect(leaky).toBeDefined();
  });
});
