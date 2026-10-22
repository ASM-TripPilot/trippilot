import { fireEvent, render, screen } from '@testing-library/react-native';

import { resetToast } from '@/test-support/toastHarness';
import { getToastBottoms } from '@/shared/ui/toastBottom';

import {
  DONE_BAR_BOTTOM,
  DONE_BAR_MIN_HEIGHT,
  GenerationDoneBar,
} from './GenerationDoneBar';

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

// 토스트 바닥 레지스트리는 모듈 싱글턴 — 파일 최상위에서 리셋한다(describe 안에만 걸면 앞 케이스의 도킹 신고가 샌다).
afterEach(() => resetToast());

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

describe('🔴 inline · 떠 있지 않은 모양 (기본은 지금 도킹 그대로)', () => {
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

// TRIP-1556 — 도킹이면 토스트 바닥 레지스트리에 바 윗변을 신고한다(안 하면 토스트가 바와 겹친다).
// 바의 위치·폭(className/style)은 jest 로 잠그지 않는다 — 6-b(402·390 기기에서 아랫변이 탭 바 알약 윗변 바로 위인지).

describe('🔴 TRIP-1556 · 도킹 바가 토스트 바닥을 신고한다', () => {
  it('앵커: 아직 아무것도 안 그렸으면 신고가 없다(앞 케이스의 신고가 새지 않는다)', () => {
    expect(getToastBottoms()).toEqual([]);
  });

  it('도킹이면 바 윗변(아랫변 + 최소 높이) 1건을 신고한다', () => {
    // 준비·실행 — 기본(도킹) 렌더.
    render(<GenerationDoneBar tripName="제주 여행" onPressView={noop} />);

    // 단언 — 상수끼리 비교라 값 자체(82·52)는 6-b 가 본다. 정확히 1건(누적이면 길이가 늘어 red).
    expect(getToastBottoms()).toEqual([DONE_BAR_BOTTOM + DONE_BAR_MIN_HEIGHT]);
  });

  it('inline 이면 신고하지 않는다(값 0 신고도 아님)', () => {
    render(
      <GenerationDoneBar tripName="제주 여행" onPressView={noop} inline />
    );

    expect(getToastBottoms()).toEqual([]);
  });

  it('도킹 바가 사라지면 신고가 해제된다', () => {
    const view = render(
      <GenerationDoneBar tripName="제주 여행" onPressView={noop} />
    );
    expect(getToastBottoms()).toHaveLength(1); // 앵커 — 해제 전엔 있다.

    view.unmount();

    expect(getToastBottoms()).toEqual([]);
  });

  it('inline 이 바뀌면 신고가 따라가고, 다시 그려도 늘어나지 않는다', () => {
    const view = render(
      <GenerationDoneBar tripName="제주 여행" onPressView={noop} />
    );
    expect(getToastBottoms()).toHaveLength(1);

    view.rerender(
      <GenerationDoneBar tripName="제주 여행" onPressView={noop} inline />
    );
    expect(getToastBottoms()).toEqual([]);

    view.rerender(
      <GenerationDoneBar tripName="부산 여행" onPressView={noop} />
    );
    expect(getToastBottoms()).toHaveLength(1);
  });
});
