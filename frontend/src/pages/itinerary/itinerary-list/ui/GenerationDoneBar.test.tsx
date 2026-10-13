import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import type { ReactTestInstance } from 'react-test-renderer';

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

// TRIP-1297 — 큰 글자에서 페이지가 배너를 목록 맨 위에 카드처럼 놓을 때 쓰는 `inline` 모양.
// 배너는 배율을 모른다(배율 판정은 페이지 한 곳) — 그래서 이 파일은 Dimensions 를 고정하지 않는다.

/** 기본(도킹) 모양의 루트 className — 기본 글자 크기에서는 한 글자도 바뀌면 안 된다(02a ★3). */
const DOCKED_CLASS =
  'absolute bottom-[108px] left-[16px] min-h-[52px] w-[358px] flex-row items-center gap-[12px] rounded-card border border-hairline bg-canvas px-lg py-[12px]';

const ALL_IDS = [
  'generation-done-bar-check',
  'generation-done-bar-text',
  'generation-done-bar-view',
  'generation-done-bar-close',
];

function classTokens(node: ReactTestInstance): string[] {
  const cn: unknown = node.props.className;
  return typeof cn === 'string' ? cn.split(/\s+/).filter(Boolean) : [];
}

/** 루트 안 자식 testID 를 트리 순서대로. */
function childIds(): string[] {
  return screen
    .queryAllByTestId(/^generation-done-bar-/)
    .map((n) => n.props.testID as string);
}

describe('🔴 inline · 떠 있지 않은 모양 (기본은 지금 도킹 그대로)', () => {
  it.each([undefined, false])(
    'inline=%s 이면 루트 className 이 지금 도킹 문자열과 완전히 같고 자식 순서는 체크→문구→보기→✕',
    (inline) => {
      // 준비·실행 — ✕ 까지 순서에 넣으려고 onPressClose 도 준다.
      render(
        <GenerationDoneBar
          tripName="제주 여행"
          onPressView={noop}
          onPressClose={noop}
          inline={inline}
        />
      );

      // 단언
      expect(screen.getByTestId('generation-done-bar').props.className).toBe(
        DOCKED_CLASS
      );
      expect(childIds()).toEqual(ALL_IDS);
    }
  );

  it('inline 이면 absolute·위치 토큰이 없고, 안쪽 가로 줄·카드 겉모양은 그대로다', () => {
    render(
      <GenerationDoneBar
        tripName="제주 여행"
        onPressView={noop}
        onPressClose={noop}
        inline
      />
    );
    const root = screen.getByTestId('generation-done-bar');
    const tokens = classTokens(root);

    // 단언 ① 떠 있지 않다 — 토큰으로도, style 로도(02a ★8).
    expect(tokens).not.toContain('absolute');
    expect(
      tokens.filter((t) =>
        /^-?(inset|top|bottom|left|right|start|end)-/.test(t)
      )
    ).toEqual([]);
    expect(StyleSheet.flatten(root.props.style)?.position).not.toBe('absolute');
    // 단언 ② 안쪽은 가로 한 줄, 겉모양은 흰 카드 그대로(Seed "B 만" — 02a ★9).
    expect(tokens).toEqual(
      expect.arrayContaining([
        'flex-row',
        'items-center',
        'rounded-card',
        'border',
        'border-hairline',
        'bg-canvas',
      ])
    );
  });

  it.each([false, true])(
    'inline=%s 에서도 문구·testID 가 그대로이고, 말줄임·글자 상한이 없다',
    (inline) => {
      render(
        <GenerationDoneBar
          tripName="제주 여행"
          onPressView={noop}
          onPressClose={noop}
          inline={inline}
        />
      );
      const root = screen.getByTestId('generation-done-bar');

      expect(screen.getByTestId('generation-done-bar-text')).toHaveTextContent(
        '제주 여행 일정이 완성됐어요'
      );
      expect(childIds()).toEqual(ALL_IDS);
      // 호스트 Text 만 모은다 — 문구·보기 2개 이상이 앵커(빈 배열이면 "전부 없음"이 공짜로 참, 02a ★12).
      const texts = root.findAll((n) => String(n.type) === 'Text');
      expect(texts.length).toBeGreaterThanOrEqual(2);
      for (const t of texts) {
        expect(Boolean(t.props.numberOfLines)).toBe(false);
        expect(t.props.maxFontSizeMultiplier).toBeUndefined();
      }
    }
  );

  it('inline 이어도 보기·✕ 는 기본 모양과 똑같이 제 콜백을 한 번씩 부른다', () => {
    const onPressView = jest.fn();
    const onPressClose = jest.fn();
    render(
      <GenerationDoneBar
        tripName="제주 여행"
        onPressView={onPressView}
        onPressClose={onPressClose}
        inline
      />
    );

    fireEvent.press(screen.getByTestId('generation-done-bar-view'));
    expect(onPressView).toHaveBeenCalledTimes(1);
    expect(onPressClose).not.toHaveBeenCalled();

    fireEvent.press(screen.getByTestId('generation-done-bar-close'));
    expect(onPressView).toHaveBeenCalledTimes(1);
    expect(onPressClose).toHaveBeenCalledTimes(1);
  });
});
