import { fireEvent, render, screen } from '@testing-library/react-native';

import { MethodPickerScreen } from './MethodPickerScreen';

/**
 * TRIP-404 — 동시 생성 제한 표면화(**낙관적 UI 스텁**).
 *
 * 배경: 서버에 "다른 여행이 생성 중"을 알리는 판정면이 아직 없다(선행 BE 칸 미신설,
 * `POST /trips/{id}/itinerary` 는 상태 제한 없음). 그래서 이 화면은 **주입받은 prop**
 * (`activeGeneration`)으로만 차단을 그린다 — 스스로 coverage 를 세지 않는다(권한은 서버, 티켓 금지).
 *
 * 무엇을 보장하나:
 *  - 미차단(기본): 완전AI 탭이 지금처럼 `onPressFullAi` 를 부른다. 사유·안내는 화면에 없다.
 *  - 차단: 완전AI 탭을 눌러도 `onPressFullAi` 가 **안 불린다** + **사유**가 보인다(BR-U3-01: 사유
 *    없는 비활성은 위반).
 *  - 차단 중에도 "진행 중인 여행으로 가기" 안내가 있어 갈 곳을 준다.
 *
 * 3동작 뼈대: 준비=콜백 목·prop → 실행=렌더/카드 press → 단언=콜백 호출·보이는 것.
 */

const noop = () => {};

describe('TRIP-404 · h04 동시 생성 차단 스텁', () => {
  it('AC-1 미차단(기본) — 완전AI 탭이 onPressFullAi 를 부르고, 사유·안내는 없다', () => {
    // 준비: activeGeneration 미전달(기본 = 낙관적 미차단).
    const onPressFullAi = jest.fn();
    render(<MethodPickerScreen onBack={noop} onPressFullAi={onPressFullAi} />);

    // 실행: 완전AI 카드를 누른다.
    fireEvent.press(screen.getByTestId('itinerary-method-fullai'));

    // 단언(있어야 한다): 현행 그대로 콜백이 정확히 한 번.
    expect(onPressFullAi).toHaveBeenCalledTimes(1);
    // 단언: 완전AI 카드가 접근성상 활성이다(미차단이면 비활성 표식이 붙으면 안 됨).
    expect(screen.getByTestId('itinerary-method-fullai')).not.toBeDisabled();
    // 단언(없어야 한다): 사유·안내 표면이 아예 없다.
    expect(screen.queryByTestId('itinerary-method-blocked-reason')).toBeNull();
    expect(screen.queryByTestId('itinerary-method-goto-active')).toBeNull();
  });

  it('AC-2 차단 — 완전AI 를 눌러도 onPressFullAi 가 안 불리고 사유가 보인다(BR-U3-01)', () => {
    // 준비: 다른 여행이 생성 중이라는 판정면을 주입.
    const onPressFullAi = jest.fn();
    render(
      <MethodPickerScreen
        onBack={noop}
        onPressFullAi={onPressFullAi}
        activeGeneration={{ tripId: 'other-1', label: '부산 3일' }}
        onPressActiveGeneration={noop}
      />
    );

    // 실행: 차단 상태에서 완전AI 카드를 누른다.
    fireEvent.press(screen.getByTestId('itinerary-method-fullai'));

    // 단언(없어야 한다): 진입이 막혀 콜백이 한 번도 안 불린다.
    expect(onPressFullAi).not.toHaveBeenCalled();
    // 단언: 카드가 접근성상으로도 비활성이다 — 딤 없이 무반응인 죽은 버튼 방지(disabled prop 제거 시 red).
    expect(screen.getByTestId('itinerary-method-fullai')).toBeDisabled();
    // 단언(있어야 한다): 비활성만 하지 않고 **실제 사유 문구**를 표시한다. 빈 사유는 BR-U3-01 위반이므로
    // 컨테이너 존재가 아니라 문구 내용을 잠근다.
    expect(
      screen.getByTestId('itinerary-method-blocked-reason')
    ).toBeOnTheScreen();
    expect(screen.getByText(/한 번에 하나만 만들 수 있어요/)).toBeOnTheScreen();
  });

  it('AC-3 안내 — 차단 시 "진행 중인 여행으로 가기" 가 보이고 누르면 콜백이 오른다', () => {
    // 준비: 차단 + 이동 콜백 목.
    const onPressActiveGeneration = jest.fn();
    render(
      <MethodPickerScreen
        onBack={noop}
        onPressFullAi={noop}
        activeGeneration={{ tripId: 'other-1' }}
        onPressActiveGeneration={onPressActiveGeneration}
      />
    );

    // 단언(있어야 한다): 안내가 실제 문구를 담아 갈 곳을 말한다(빈 라벨은 안내가 아니다).
    expect(screen.getByText(/진행 중인 여행으로 가기/)).toBeOnTheScreen();

    // 실행: 안내 액션을 누른다.
    fireEvent.press(screen.getByTestId('itinerary-method-goto-active'));

    // 단언: 진행 중인 여행으로 가는 콜백이 정확히 한 번.
    expect(onPressActiveGeneration).toHaveBeenCalledTimes(1);
  });

  it('AC-4 회귀 — 차단은 완전AI 에만 걸린다. 뒤로가기·다른 방식은 그대로', () => {
    // 준비: 차단 상태.
    const onBack = jest.fn();
    render(
      <MethodPickerScreen
        onBack={onBack}
        onPressFullAi={noop}
        activeGeneration={{ tripId: 'other-1' }}
        onPressActiveGeneration={noop}
      />
    );

    // 실행+단언: 뒤로가기는 여전히 동작한다.
    fireEvent.press(screen.getByTestId('itinerary-method-back'));
    expect(onBack).toHaveBeenCalledTimes(1);

    // 실행+단언: 다른 방식 카드는 여전히 "준비 중" 안내를 낸다(차단 무관).
    fireEvent.press(screen.getByTestId('itinerary-method-copick'));
    expect(screen.getByTestId('itinerary-method-soon')).toBeOnTheScreen();
  });
});
