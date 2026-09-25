import { fireEvent, render, screen } from '@testing-library/react-native';

import { GenerationProgressCard } from './GenerationProgressCard';

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
