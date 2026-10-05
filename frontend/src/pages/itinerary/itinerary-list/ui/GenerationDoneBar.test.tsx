import { fireEvent, render, screen } from '@testing-library/react-native';

import { GenerationDoneBar } from './GenerationDoneBar';

/**
 * TRIP-788 · AC-7 — GenerationDoneBar: BottomTab 위 완료 도킹 배너(신규 widgets, prop-driven).
 *
 * 표시 조건(마지막 확인 이후 완성된 여행 = last-seen 영속)은 **이번 범위 밖** — 이 위젯은
 * prop(여행명 + onPressView)만 받아 그리고, 실배선은 후속(이번 소비처는 프리뷰 h05-my-trips-done-bar 뿐).
 *
 * 무엇을 보장하나:
 *  - 🔴 체크 글리프 + '{여행명} 일정이 완성됐어요' + '보기'(Pressable) 를 그린다.
 *  - 🔴 여행명은 **보간**된다(하드코딩 아님) — 이름을 바꾸면 문구도 바뀐다.
 *  - 🔴 '보기' press → onPressView 콜백 1회.
 *
 * *(jest 사각 — 6-b 육안)* 체크 글리프 색(success)·BottomTab 위 절대배치·화면 덮음·border(그림자 없음,
 *   Figma)은 jest 원리적 사각. 여기선 **구조(testID 트리)·텍스트 leaf·콜백 배선**까지만.
 */

const noop = () => {};

describe('🔴 AC-7 · GenerationDoneBar — 체크 + 완성 문구 + 보기', () => {
  it('구조·문구·콜백: "{여행명} 일정이 완성됐어요" + 보기 press → onPressView 1회', () => {
    // 준비 — 여행명 + 콜백.
    const onPressView = jest.fn();
    render(
      <GenerationDoneBar tripName="제주 여행" onPressView={onPressView} />
    );

    // 루트·체크 글리프 존재(구조 심판 — 색은 6-b).
    expect(screen.getByTestId('generation-done-bar')).toBeOnTheScreen();
    expect(screen.getByTestId('generation-done-bar-check')).toBeOnTheScreen();

    // 중앙 문구 — 여행명 보간 완전일치('{여행명}' 미치환·문구 오기면 red).
    expect(screen.getByTestId('generation-done-bar-text')).toHaveTextContent(
      '제주 여행 일정이 완성됐어요'
    );

    // '보기' 링크 문구 + 콜백 배선.
    expect(screen.getByTestId('generation-done-bar-view')).toHaveTextContent(
      '보기'
    );
    fireEvent.press(screen.getByTestId('generation-done-bar-view'));
    expect(onPressView).toHaveBeenCalledTimes(1);
  });

  it('여행명이 바뀌면 문구도 그 이름으로 바뀐다(하드코딩 아님)', () => {
    render(<GenerationDoneBar tripName="부산 2박3일" onPressView={noop} />);

    expect(screen.getByTestId('generation-done-bar-text')).toHaveTextContent(
      '부산 2박3일 일정이 완성됐어요'
    );
  });
});

describe('🔴 TRIP-1241 · 닫기(✕) 컨트롤', () => {
  it('onPressClose 를 주면 "닫기" 버튼이 있고 누르면 1회 호출되며, 보기는 그대로 onPressView 만 부른다', () => {
    const onPressView = jest.fn();
    const onPressClose = jest.fn();
    render(
      <GenerationDoneBar
        tripName="제주 여행"
        onPressView={onPressView}
        onPressClose={onPressClose}
      />
    );
    const close = screen.getByTestId('generation-done-bar-close');
    expect(close.props.accessibilityRole).toBe('button');
    expect(close.props.accessibilityLabel).toBe('닫기');
    fireEvent.press(close);
    expect(onPressClose).toHaveBeenCalledTimes(1);
    expect(onPressView).not.toHaveBeenCalled();

    fireEvent.press(screen.getByTestId('generation-done-bar-view'));
    expect(onPressView).toHaveBeenCalledTimes(1);
    expect(onPressClose).toHaveBeenCalledTimes(1);
  });

  it('onPressClose 가 없으면 닫기 컨트롤이 없다(기존 모양 불변)', () => {
    render(<GenerationDoneBar tripName="제주 여행" onPressView={noop} />);
    expect(screen.queryByTestId('generation-done-bar-close')).toBeNull();
  });
});
