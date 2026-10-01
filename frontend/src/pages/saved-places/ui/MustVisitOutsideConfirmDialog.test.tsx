import { fireEvent, render, screen } from '@testing-library/react-native';

import { MustVisitOutsideConfirmDialog } from './MustVisitOutsideConfirmDialog';

/**
 * TRIP-1106 · 꼭 갈 곳 고르기(위저드) 완료 때 지역 밖 선택이 섞여 있으면 띄우는 확인 — **뷰 전용** 심판.
 *
 * 무엇을 보장하나:
 *  - 제목은 「이 여행 지역 밖 N곳이 함께 들어가요」 한 줄이고 N 은 `count` 에서 온다(결정 2, 본문 줄 없음).
 *  - 버튼은 정확히 둘: 왼쪽 외곽선 [빼고 완료] · 오른쪽 코랄 [그대로 넣기]. 각 버튼은 제 콜백만 부른다.
 *  - 레이아웃 토큰은 SaveConflictDialog·TripDeleteDialog 계열이다(발명 최소).
 *
 * 커버하지 않는 것: 딤 실제 덮임·중앙 정렬·터치 차단(조건부 렌더 오버레이의 jest 사각 — 6-b 프리뷰
 * `saved-places-select-outside-confirm`). 언제 뜨고 누른 뒤 무엇이 심기는지는
 * `SavedPlacesPage.integration.test.tsx` 의 `select › 위저드` TRIP-1106 절 몫.
 */

const GATE = 'mustvisit-pick-outside-confirm';
const CARD = 'mustvisit-pick-outside-confirm-card';
const EXCLUDE = 'mustvisit-pick-outside-exclude';
const KEEP = 'mustvisit-pick-outside-keep';

function tokens(el: { props: { className?: unknown } }): string[] {
  return String(el.props.className ?? '')
    .split(/\s+/)
    .filter(Boolean);
}

function renderDialog(count = 1) {
  const onExclude = jest.fn();
  const onKeep = jest.fn();
  render(
    <MustVisitOutsideConfirmDialog
      count={count}
      onExclude={onExclude}
      onKeep={onKeep}
    />
  );
  return { onExclude, onKeep };
}

describe('🔴 TRIP-1106 · 지역 밖 확인 다이얼로그 문구 (결정 2)', () => {
  it('OD1 · count=2 면 제목이 「이 여행 지역 밖 2곳이 함께 들어가요」와 완전히 같다', () => {
    renderDialog(2);

    expect(screen.getByTestId(GATE)).toBeOnTheScreen();
    expect(
      screen.getByText('이 여행 지역 밖 2곳이 함께 들어가요')
    ).toBeOnTheScreen();
  });

  it('OD2 · count=1 이면 1곳이고 다른 수는 없다 (수는 prop 에서 온다)', () => {
    renderDialog(1);

    expect(
      screen.getByText('이 여행 지역 밖 1곳이 함께 들어가요')
    ).toBeOnTheScreen();
    expect(
      screen.queryByText('이 여행 지역 밖 2곳이 함께 들어가요')
    ).toBeNull();
  });

  it('OD7 · 소요시간 표기가 없다 (INV-3)', () => {
    renderDialog(2);

    // 긍정 앵커 — 정규식이 이 다이얼로그의 글자를 실제로 읽는다.
    expect(screen.queryAllByText(/지역 밖/).length).toBeGreaterThan(0);
    expect(screen.queryAllByText(/\d+\s*분|\d+\s*시간|소요/)).toHaveLength(0);
  });
});

describe('🔴 TRIP-1106 · 지역 밖 확인 다이얼로그 버튼 (결정 2 — 두 갈래)', () => {
  it('OD3 · 버튼은 정확히 둘이고 왼쪽 [빼고 완료] · 오른쪽 [그대로 넣기] 순서다', () => {
    renderDialog();

    const order = screen
      .getAllByRole('button')
      .map((button) => button.props.testID);

    expect(order).toEqual([EXCLUDE, KEEP]);
    expect(screen.getByTestId(EXCLUDE)).toHaveTextContent('빼고 완료');
    expect(screen.getByTestId(KEEP)).toHaveTextContent('그대로 넣기');
  });

  it('OD4 · [빼고 완료]를 누르면 onExclude 만 한 번 부른다', () => {
    const { onExclude, onKeep } = renderDialog();

    fireEvent.press(screen.getByTestId(EXCLUDE));

    expect(onExclude).toHaveBeenCalledTimes(1);
    expect(onKeep).not.toHaveBeenCalled();
  });

  it('OD5 · [그대로 넣기]를 누르면 onKeep 만 한 번 부른다', () => {
    const { onExclude, onKeep } = renderDialog();

    fireEvent.press(screen.getByTestId(KEEP));

    expect(onKeep).toHaveBeenCalledTimes(1);
    expect(onExclude).not.toHaveBeenCalled();
  });
});

describe('🔴 TRIP-1106 · 지역 밖 확인 다이얼로그 레이아웃 토큰 (SaveConflictDialog 계열)', () => {
  it('OD6 · 딤 55% 전면 · 카드 330/20 캔버스 · 제목 19 Bold ink · 버튼 52 · 오른쪽만 코랄', () => {
    renderDialog(3);

    expect(tokens(screen.getByTestId(GATE))).toEqual(
      expect.arrayContaining(['absolute', 'inset-0', 'bg-scrim/55'])
    );
    expect(tokens(screen.getByTestId(CARD))).toEqual(
      expect.arrayContaining(['w-[330px]', 'rounded-[20px]', 'bg-canvas'])
    );
    expect(
      tokens(screen.getByText('이 여행 지역 밖 3곳이 함께 들어가요'))
    ).toEqual(
      expect.arrayContaining(['font-noto-bold', 'text-[19px]', 'text-ink'])
    );
    for (const id of [EXCLUDE, KEEP]) {
      expect(tokens(screen.getByTestId(id))).toEqual(
        expect.arrayContaining(['h-[52px]', 'rounded-button'])
      );
    }
    expect(tokens(screen.getByTestId(KEEP))).toContain('bg-primary');
    expect(tokens(screen.getByTestId(EXCLUDE))).toContain(
      'border-hairline-strong'
    );
    expect(tokens(screen.getByTestId(EXCLUDE))).not.toContain('bg-primary');
  });
});
