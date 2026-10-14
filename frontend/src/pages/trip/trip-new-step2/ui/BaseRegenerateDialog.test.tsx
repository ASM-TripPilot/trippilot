import { fireEvent, render, screen } from '@testing-library/react-native';

import { BaseRegenerateDialog } from './BaseRegenerateDialog';

/**
 * TRIP-1082 · 편집 후 묻기 다이얼로그(Figma `4700:2747`, BR-U6-21) — **뷰 전용** 심판.
 *
 * 무엇을 보장하나:
 *  - 문구가 Figma 그대로다(제목·본문·버튼 두 개, 완전 일치).
 *  - [그대로 두기]는 `onKeep`, [일정 다시 만들기]는 `onRegenerate` 만 부른다(서로 새지 않는다).
 *
 * 커버하지 않는 것: 딤이 실제로 화면을 덮는지·중앙 정렬·터치 차단(조건부 렌더 오버레이의 jest 사각 — 6-b).
 * 언제 열리는지·누른 뒤 어디로 가는지는 페이지 통합 테스트(`TripBasesPage.integration` 「편집 모드」) 몫.
 *
 * ⚠️ `toHaveTextContent(문자열)`·`getByText(문자열)`은 완전 일치다(RNTL 13.3.3 `build/matches.js`).
 *
 * 3동작: 준비(jest.fn 콜백) → 실행(render + press) → 단언(텍스트·콜백).
 */

const TITLE = '일정도 다시 만들까요?';
const BODY =
  '거점 숙소가 바뀌었어요. 일정은 그대로 둘 수 있어요. 다시 만들면 직접 고친 내용은 사라질 수 있어요.';

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
});
