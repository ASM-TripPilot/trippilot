import { Text } from 'react-native';
import { render, screen, fireEvent } from '@testing-library/react-native';

import { SavedStayCard } from './SavedStayCard';

/**
 * TRIP-807 · AC-4 — entities/stay/ui/SavedStayCard: 저장 숙소 degrade 카드(e04 세로·g02 시트 행 공용).
 *
 * 무엇을 보장하나(신규 개념 학습 1순위 — **degrade 카드 = 계약 공백을 정직하게 비운다**):
 *  - 🔴 이름 + `subtitle` 슬롯(있으면)만 그린다 — `SavedStay` 계약에 사진 URL·지역·거리·가격이 없어
 *    **가격·거리·₩ 문자열을 발명하지 않는다**(INV-1 · DC6). 사진은 회색 자리.
 *  - 🔴 담김 표식은 `accessibilityState.selected`(색 아님, ★4·★5) — e04 는 항상채움 표시용이라 카드에
 *    fill 토글 상태가 없다(하트는 소비처가 `trailing` 으로 주입 = 카드는 하트 불가지).
 *  - 🔴 `trailing` 슬롯(e04 항상채움 하트 · g02 선택 체크)과 `subtitle` 슬롯이 주입될 때만 렌더된다.
 *
 * `describe.each` 로 두 layout(vertical=e04 · row=g02)을 같은 계약으로 태운다 — 접두·트레일링만 다르고
 * 계약(이름·selected·subtitle·trailing·onPress)은 같다.
 *
 * *(개념)* ReactNode 슬롯 — 카드가 자식 요소를 통째로 받아 그대로 끼워 넣는 자리. 소비처가 무엇을
 *  그릴지 정하고 카드는 위치만 준다(하트든 체크든 카드는 모른다).
 *
 * 3동작 뼈대: 준비=layout·testID·slots → 실행=render/press → 단언=존재·selected·발명 0.
 */

type Layout = 'vertical' | 'row';
const LAYOUTS: Layout[] = ['vertical', 'row'];
const ROOT_ID: Record<Layout, string> = {
  vertical: 'saved-stay-card-ss-1',
  row: 'trip-base-staysheet-cand-ss-1',
};

describe.each(LAYOUTS)('SavedStayCard — layout=%s', (layout) => {
  const rootId = ROOT_ID[layout];

  it('🔴 DC1 · root testID + 이름 + 기본 selected 아님', () => {
    render(
      <SavedStayCard testID={rootId} name="해운대 오션뷰" layout={layout} />
    );

    expect(screen.getByTestId(rootId)).toBeOnTheScreen();
    expect(screen.getByText('해운대 오션뷰')).toBeOnTheScreen();
    expect(screen.getByTestId(rootId)).not.toBeSelected();
  });

  it('🔴 DC2 · selected=true → accessibilityState.selected', () => {
    render(
      <SavedStayCard
        testID={rootId}
        name="해운대 오션뷰"
        layout={layout}
        selected
      />
    );

    expect(screen.getByTestId(rootId)).toBeSelected();
  });

  it('🔴 DC3 · subtitle 슬롯 — 주면 렌더, 미지정이면 부재', () => {
    const { rerender } = render(
      <SavedStayCard
        testID={rootId}
        name="해운대 오션뷰"
        layout={layout}
        subtitle={<Text testID="sub-slot">6.10~6.13</Text>}
      />
    );
    expect(screen.getByTestId('sub-slot')).toBeOnTheScreen();

    rerender(
      <SavedStayCard testID={rootId} name="해운대 오션뷰" layout={layout} />
    );
    expect(screen.queryByTestId('sub-slot')).toBeNull();
  });

  it('🔴 DC4 · trailing 슬롯 — 주면 렌더, 미지정이면 부재', () => {
    const { rerender } = render(
      <SavedStayCard
        testID={rootId}
        name="해운대 오션뷰"
        layout={layout}
        trailing={<Text testID="trailing-slot">✓</Text>}
      />
    );
    expect(screen.getByTestId('trailing-slot')).toBeOnTheScreen();

    rerender(
      <SavedStayCard testID={rootId} name="해운대 오션뷰" layout={layout} />
    );
    expect(screen.queryByTestId('trailing-slot')).toBeNull();
  });

  it('🔴 DC5 · onPress → root press 시 1회', () => {
    const onPress = jest.fn();
    render(
      <SavedStayCard
        testID={rootId}
        name="해운대 오션뷰"
        layout={layout}
        onPress={onPress}
      />
    );

    fireEvent.press(screen.getByTestId(rootId));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('🔴 DC6 · 발명 0 — 이름만 준 카드에 가격·거리·소요시간 문자열이 없다 (INV-1·INV-3)', () => {
    render(
      <SavedStayCard testID={rootId} name="해운대 오션뷰" layout={layout} />
    );

    // 가격(₩·원~)·거리(km·m)·소요시간(분·시간·소요)을 카드가 지어내지 않는다.
    expect(screen.queryAllByText(/₩|원~|km/)).toHaveLength(0);
    expect(screen.queryAllByText(/분|시간|소요/)).toHaveLength(0);
    // 가짜통과 방지 짝 — 카드 자체는 떠 있다(빈 렌더로 "0건"이 초록 되는 것 차단).
    expect(screen.getByText('해운대 오션뷰')).toBeOnTheScreen();
  });
});
