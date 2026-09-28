import { fireEvent, render, screen } from '@testing-library/react-native';

import { BaseRegenerateDialog } from './BaseRegenerateDialog';

/**
 * TRIP-1082 · 편집 후 묻기 다이얼로그(Figma `4700:2747`, BR-U6-21) — **뷰 전용** 심판.
 *
 * 무엇을 보장하나:
 *  - 문구가 Figma 그대로다(제목·본문·버튼 두 개, 완전 일치).
 *  - [그대로 두기]는 `onKeep`, [일정 다시 만들기]는 `onRegenerate` 만 부른다(서로 새지 않는다).
 *  - 강조(코랄)는 **[그대로 두기]**(오른쪽, 기본·안전)이고 [일정 다시 만들기]는 아웃라인(왼쪽, 파괴적) — 01b Q2.
 *  - 레이아웃 토큰은 형제 `BaseToggleDialog`(딤 55%·카드 330/20·제목 19 Bold·버튼 44)와 같다.
 *
 * 커버하지 않는 것: 딤이 실제로 화면을 덮는지·중앙 정렬·터치 차단(조건부 렌더 오버레이의 jest 사각 — 6-b).
 * 언제 열리는지·누른 뒤 어디로 가는지는 페이지 통합 테스트(`TripBasesPage.editMode.integration`) 몫.
 *
 * ⚠️ `toHaveTextContent(문자열)`·`getByText(문자열)`은 완전 일치다(RNTL 13.3.3 `build/matches.js`).
 *
 * 3동작: 준비(jest.fn 콜백) → 실행(render + press) → 단언(텍스트·콜백·토큰).
 */

const TITLE = '일정도 다시 만들까요?';
const BODY =
  '거점 숙소가 바뀌었어요. 일정은 그대로 둘 수 있어요. 다시 만들면 직접 고친 내용은 사라질 수 있어요.';

function tokens(el: { props: { className?: unknown } }): string[] {
  return String(el.props.className ?? '')
    .split(/\s+/)
    .filter(Boolean);
}

function renderDialog() {
  const onKeep = jest.fn();
  const onRegenerate = jest.fn();
  render(<BaseRegenerateDialog onKeep={onKeep} onRegenerate={onRegenerate} />);
  return { onKeep, onRegenerate };
}

describe('편집 후 묻기 다이얼로그 · 문구 (Figma 4700:2747)', () => {
  it('제목·본문·두 버튼 라벨이 Figma 문구와 완전히 같다', () => {
    renderDialog();

    expect(screen.getByTestId('trip-base-regen-dialog')).toBeOnTheScreen();
    expect(screen.getByText(TITLE)).toBeOnTheScreen();
    expect(screen.getByText(BODY)).toBeOnTheScreen();
    expect(screen.getByTestId('trip-base-regen-confirm')).toHaveTextContent(
      '일정 다시 만들기'
    );
    expect(screen.getByTestId('trip-base-regen-keep')).toHaveTextContent(
      '그대로 두기'
    );
  });
});

describe('편집 후 묻기 다이얼로그 · 버튼 (BR-U6-21 조용히 재생성 금지)', () => {
  it('[그대로 두기]를 누르면 onKeep 만 한 번 부른다', () => {
    const { onKeep, onRegenerate } = renderDialog();

    fireEvent.press(screen.getByTestId('trip-base-regen-keep'));

    expect(onKeep).toHaveBeenCalledTimes(1);
    expect(onRegenerate).not.toHaveBeenCalled();
  });

  it('[일정 다시 만들기]를 누르면 onRegenerate 만 한 번 부른다', () => {
    const { onKeep, onRegenerate } = renderDialog();

    fireEvent.press(screen.getByTestId('trip-base-regen-confirm'));

    expect(onRegenerate).toHaveBeenCalledTimes(1);
    expect(onKeep).not.toHaveBeenCalled();
  });

  it('버튼은 왼쪽 [일정 다시 만들기] · 오른쪽 [그대로 두기] 순서다', () => {
    renderDialog();

    const order = screen
      .getAllByRole('button')
      .map((button) => button.props.testID);

    expect(order).toEqual(['trip-base-regen-confirm', 'trip-base-regen-keep']);
  });

  it('코랄(주 강조)은 [그대로 두기]이고, [일정 다시 만들기]는 아웃라인이다 (01b Q2)', () => {
    renderDialog();

    const keep = screen.getByTestId('trip-base-regen-keep');
    expect(tokens(keep)).toContain('bg-primary');
    expect(tokens(screen.getByText('그대로 두기'))).toContain(
      'text-on-primary'
    );

    const confirm = screen.getByTestId('trip-base-regen-confirm');
    expect(tokens(confirm)).not.toContain('bg-primary');
    expect(tokens(confirm)).toContain('border-hairline-strong');
    expect(tokens(screen.getByText('일정 다시 만들기'))).toContain('text-body');
  });
});

describe('편집 후 묻기 다이얼로그 · 레이아웃 토큰 (BaseToggleDialog 동형)', () => {
  it('딤 55% 전면 · 카드 330/20 · 제목 19 Bold ink · 버튼 높이 44', () => {
    renderDialog();

    expect(tokens(screen.getByTestId('trip-base-regen-dialog'))).toEqual(
      expect.arrayContaining(['absolute', 'inset-0', 'bg-scrim/55'])
    );
    expect(tokens(screen.getByTestId('trip-base-regen-card'))).toEqual(
      expect.arrayContaining(['w-[330px]', 'rounded-[20px]'])
    );
    expect(tokens(screen.getByText(TITLE))).toEqual(
      expect.arrayContaining(['text-[19px]', 'font-noto-bold', 'text-ink'])
    );
    for (const id of ['trip-base-regen-confirm', 'trip-base-regen-keep']) {
      expect(tokens(screen.getByTestId(id))).toEqual(
        expect.arrayContaining(['h-[44px]', 'rounded-button'])
      );
    }
  });
});
