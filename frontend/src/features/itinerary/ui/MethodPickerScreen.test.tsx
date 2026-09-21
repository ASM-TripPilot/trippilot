import { fireEvent, render, screen } from '@testing-library/react-native';

import { MethodPickerScreen } from './MethodPickerScreen';

/**
 * h01 시작 방법 화면 테스트.
 *
 * ── TRIP-404 · 동시 생성 차단 스텁 (AC-6 무회귀) ──
 * 서버 판정면(`activeGeneration`)으로만 차단을 그린다(권한은 서버). 미차단=완전AI 콜백 정상,
 * 차단=완전AI 콜백 억제 + 사유 표시(BR-U3-01). TRIP-784 로 `onPressManual`·`onPressCoPick` 이
 * 필수 prop 이 되어(showSoon 폴백 소멸) 모든 render 가 두 콜백을 넘긴다.
 *
 * ── TRIP-784 · h01 Figma 재정합 ──
 * 진행 표시(점 4개·3채움 + "3 / 4") 추가 · 서브카피/하단안내 Figma 문구 교체 · 추천 배지 제거 ·
 * soon 폴백 소멸(콜백 필수화). 채움/빈 점은 **서로 다른 testID** 로 세어, SVG 한 장 fill 색만 바꾼
 * 거짓 통과를 막는다(repo-traps 글리프 fill 사각).
 *
 * 3동작 뼈대: 준비=콜백 목·prop → 실행=렌더/카드 press → 단언=콜백 호출·보이는 것.
 */

const noop = () => {};

describe('TRIP-404 · 동시 생성 차단 스텁 (AC-6 무회귀)', () => {
  it('미차단(기본) — 완전AI 탭이 onPressFullAi 를 부르고, 사유·안내는 없다', () => {
    // 준비: activeGeneration 미전달(기본 = 낙관적 미차단). 세 방식 콜백은 이제 필수라 다 넘긴다.
    const onPressFullAi = jest.fn();
    render(
      <MethodPickerScreen
        onBack={noop}
        onPressFullAi={onPressFullAi}
        onPressManual={noop}
        onPressCoPick={noop}
      />
    );

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

  it('차단 — 완전AI 를 눌러도 onPressFullAi 가 안 불리고 사유가 보인다(BR-U3-01)', () => {
    // 준비: 다른 여행이 생성 중이라는 판정면을 주입.
    const onPressFullAi = jest.fn();
    render(
      <MethodPickerScreen
        onBack={noop}
        onPressFullAi={onPressFullAi}
        onPressManual={noop}
        onPressCoPick={noop}
        activeGeneration={{ tripId: 'other-1', label: '부산 3일' }}
        onPressActiveGeneration={noop}
      />
    );

    // 실행: 차단 상태에서 완전AI 카드를 누른다.
    fireEvent.press(screen.getByTestId('itinerary-method-fullai'));

    // 단언(없어야 한다): 진입이 막혀 콜백이 한 번도 안 불린다.
    expect(onPressFullAi).not.toHaveBeenCalled();
    // 단언: 카드가 접근성상으로도 비활성이다 — 딤 없이 무반응인 죽은 버튼 방지.
    expect(screen.getByTestId('itinerary-method-fullai')).toBeDisabled();
    // 단언(있어야 한다): 비활성만 하지 않고 **실제 사유 문구**를 표시한다(빈 사유는 BR-U3-01 위반).
    expect(
      screen.getByTestId('itinerary-method-blocked-reason')
    ).toBeOnTheScreen();
    expect(screen.getByText(/한 번에 하나만 만들 수 있어요/)).toBeOnTheScreen();
  });

  it('안내 — 차단 시 "진행 중인 여행으로 가기" 가 보이고 누르면 콜백이 오른다', () => {
    // 준비: 차단 + 이동 콜백 목.
    const onPressActiveGeneration = jest.fn();
    render(
      <MethodPickerScreen
        onBack={noop}
        onPressFullAi={noop}
        onPressManual={noop}
        onPressCoPick={noop}
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

  it('회귀 — 차단은 완전AI 에만 걸린다. 뒤로가기·copick 은 그대로 콜백을 부른다', () => {
    // 준비: 차단 상태 + 뒤로가기·copick 목.
    const onBack = jest.fn();
    const onPressCoPick = jest.fn();
    render(
      <MethodPickerScreen
        onBack={onBack}
        onPressFullAi={noop}
        onPressManual={noop}
        onPressCoPick={onPressCoPick}
        activeGeneration={{ tripId: 'other-1' }}
        onPressActiveGeneration={noop}
      />
    );

    // 실행+단언: 뒤로가기는 여전히 동작한다.
    fireEvent.press(screen.getByTestId('itinerary-method-back'));
    expect(onBack).toHaveBeenCalledTimes(1);

    // 실행+단언: 차단 중에도 copick 은 콜백을 그대로 부른다(차단은 완전AI 전용). TRIP-784 로
    // soon 폴백은 소멸했으므로 press 로도 안 뜬다(옛 계약: copick→"준비 중" 안내).
    fireEvent.press(screen.getByTestId('itinerary-method-copick'));
    expect(onPressCoPick).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('itinerary-method-soon')).toBeNull();
  });
});

describe('TRIP-784 · h01 시작 방법 Figma 재정합', () => {
  it('AC-1 · 진행 표시 — "3 / 4" 텍스트 + 채움 점 3개·빈 점 1개', () => {
    render(
      <MethodPickerScreen
        onBack={noop}
        onPressFullAi={noop}
        onPressManual={noop}
        onPressCoPick={noop}
      />
    );

    // "3 / 4" 진행 텍스트 — getByText(문자열) 은 노드 텍스트 완전 일치.
    expect(screen.getByText('3 / 4')).toBeOnTheScreen();

    // 채움/빈을 **서로 다른 testID** 로 세어 SVG 한 장 fill 색만 바꾼 거짓 통과를 막는다(repo-traps).
    // getAllByTestId(문자열) = testID 완전 일치 전량(0건이면 throw → 현행 red).
    expect(
      screen.getAllByTestId('itinerary-method-progress-dot-filled')
    ).toHaveLength(3);
    expect(
      screen.getAllByTestId('itinerary-method-progress-dot-empty')
    ).toHaveLength(1);
  });

  it('AC-2 · 서브카피가 Figma 문구다(옛 문구 부재)', () => {
    render(
      <MethodPickerScreen
        onBack={noop}
        onPressFullAi={noop}
        onPressManual={noop}
        onPressCoPick={noop}
      />
    );

    expect(screen.getByText('마음에 드는 방식을 골라주세요')).toBeOnTheScreen();
    // 짝 — 옛 서브카피는 사라진다(교체이지 병기가 아니다).
    expect(
      screen.queryByText('설정한 취향·거리는 세 방법 모두에 적용돼요')
    ).toBeNull();
  });

  it('AC-3 · 하단 안내가 Figma 문구다(옛 문구 부재)', () => {
    render(
      <MethodPickerScreen
        onBack={noop}
        onPressFullAi={noop}
        onPressManual={noop}
        onPressCoPick={noop}
      />
    );

    expect(
      screen.getByText('어떤 방식이든 마지막엔 직접 고칠 수 있어요')
    ).toBeOnTheScreen();
    // 짝 — 옛 하단 안내는 사라진다.
    expect(
      screen.queryByText('세 방법은 언제든 서로 전환할 수 있어요')
    ).toBeNull();
  });

  it('AC-4 · 추천 배지가 0개다(copick 제목·설명·빨강테두리는 유지)', () => {
    render(
      <MethodPickerScreen
        onBack={noop}
        onPressFullAi={noop}
        onPressManual={noop}
        onPressCoPick={noop}
      />
    );

    // 배지 소멸 — testID 와 '추천' 텍스트 둘 다 0. queryByText(문자열) 은 완전 일치라
    // 설명 속 "AI 추천 위에서…" 에는 안 걸린다(그건 배지가 아니라 본문).
    expect(screen.queryByTestId('itinerary-method-copick-badge')).toBeNull();
    expect(screen.queryByText('추천')).toBeNull();

    // 짝 — copick 카드의 제목·설명·빨강 테두리 강조는 유지된다(배지만 뗀다). 설명 안의
    // "AI 추천" 은 배지가 아니라 본문이라 살아남는다(Seed AC-4 · 지우지 말 것).
    expect(screen.getByText('AI와 같이 짜기')).toBeOnTheScreen();
    expect(screen.getByText('AI 추천 위에서 골라가며 완성')).toBeOnTheScreen();
    // className 은 jest 렌더 트리에 평문 prop 으로 남는다(loginVisual 선례) — 강조 테두리 회귀 앵커.
    expect(
      screen.getByTestId('itinerary-method-copick').props.className
    ).toContain('border-primary');
  });

  it('AC-5 · copick·manual press 가 각 콜백을 1회 부르고 soon 폴백은 없다', () => {
    // 준비: 세 방식 콜백은 필수 prop — 목을 준다.
    const onPressCoPick = jest.fn();
    const onPressManual = jest.fn();
    render(
      <MethodPickerScreen
        onBack={noop}
        onPressFullAi={noop}
        onPressManual={onPressManual}
        onPressCoPick={onPressCoPick}
      />
    );

    // 실행+단언: 각 카드가 그 콜백을 정확히 한 번 부른다.
    fireEvent.press(screen.getByTestId('itinerary-method-copick'));
    expect(onPressCoPick).toHaveBeenCalledTimes(1);

    fireEvent.press(screen.getByTestId('itinerary-method-manual'));
    expect(onPressManual).toHaveBeenCalledTimes(1);

    // 콜백이 필수라 폴백 경로가 없다 — 어떤 press 로도 soon 이 안 뜬다(showSoon 소멸).
    expect(screen.queryByTestId('itinerary-method-soon')).toBeNull();
  });
});
