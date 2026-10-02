import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import Svg, { Path } from 'react-native-svg';

import { MyTripsSortSheet } from './MyTripsSortSheet';

/**
 * TRIP-1122 · AC-3~AC-6 — h06 정렬 시트(Figma 4750:2946)의 렌더·배선 계약.
 *
 * 무엇을 보장하나:
 *  - 제목 `정렬`, 옵션 3개(최신순·출발일순·이름순)가 이 순서, 보조 문구는 앞 둘에만.
 *  - 지금 기준만 선택(`accessibilityState.selected`)이고 체크도 그 행 안에만 있다.
 *  - 옵션을 누르면 그 기준으로 `onSelect` 1회 — 적용 버튼 없음. 스크림 탭·끌어내리기는 `onClose`.
 *  - 선택 라벨은 primary Bold, 비선택은 body Regular. 체크는 primary·굵기 3·22(기존 CheckGlyph 아님).
 *
 * 완전 제어 — 선택·열림은 페이지가 쥔다(StayPriceSheet 선례). gorhom 목이 통과형이라 실제 열림·딤
 * 덮임·끌기 제스처는 무심판(6-b 실기, 02a ★1).
 *
 * *(개념 — toBeSelected)* `accessibilityState.selected`(스크린리더의 "선택됨")를 읽는다. 색은 jest 가
 *   못 보므로 선택 여부는 이 값으로 잰다.
 */

function noop(): void {}

const OPTION_ID = /^my-trips-sort-option-(recent|start|title)$/;
const KEYS = ['recent', 'start', 'title'] as const;

/** className 을 토큰 배열로 — 부분 문자열 오탐 차단(02a ★10). */
function tokens(node: { props: { className?: unknown } }): string[] {
  return String(node.props.className ?? '').split(/\s+/);
}

describe('🔴 T1 · 구조 — 제목 · 옵션 3개 순서 · 보조 문구 (AC-3)', () => {
  it('정렬 제목과 최신순→출발일순→이름순, 보조 문구는 앞 둘에만', () => {
    // 준비·실행
    render(
      <MyTripsSortSheet selected="recent" onSelect={noop} onClose={noop} />
    );

    // 단언 — 시트·제목
    expect(screen.getByTestId('my-trips-sort-sheet')).toBeOnTheScreen();
    expect(screen.getByText('정렬')).toBeOnTheScreen();

    // 단언 — 옵션 순서(트리 순서)
    expect(
      screen.getAllByTestId(OPTION_ID).map((node) => String(node.props.testID))
    ).toEqual([
      'my-trips-sort-option-recent',
      'my-trips-sort-option-start',
      'my-trips-sort-option-title',
    ]);

    // 단언 — 라벨·보조 문구는 각 옵션 안에
    const recent = screen.getByTestId('my-trips-sort-option-recent');
    const start = screen.getByTestId('my-trips-sort-option-start');
    const title = screen.getByTestId('my-trips-sort-option-title');
    expect(within(recent).getByText('최신순')).toBeOnTheScreen();
    expect(within(recent).getByText('최근에 고친 여행부터')).toBeOnTheScreen();
    expect(within(start).getByText('출발일순')).toBeOnTheScreen();
    expect(within(start).getByText('가까운 출발일부터')).toBeOnTheScreen();
    // 이름순은 보조 문구 없음 — 옵션 글자 전체가 라벨과 완전 일치(02a ★11)
    expect(title).toHaveTextContent('이름순');
  });
});

describe('🔴 T2 · 지금 기준만 선택 · 체크는 그 행 안에만 (AC-3 · 02a ★12)', () => {
  it.each(KEYS)('selected=%s', (selected) => {
    render(
      <MyTripsSortSheet selected={selected} onSelect={noop} onClose={noop} />
    );

    for (const key of KEYS) {
      const option = screen.getByTestId(`my-trips-sort-option-${key}`);
      if (key === selected) {
        expect(option).toBeSelected();
        expect(
          within(option).getByTestId(`my-trips-sort-check-${key}`)
        ).toBeOnTheScreen();
      } else {
        expect(option).not.toBeSelected();
        expect(screen.queryByTestId(`my-trips-sort-check-${key}`)).toBeNull();
      }
    }
  });
});

describe('🔴 T3 · 비주얼 — 선택 라벨 primary Bold · 비선택 body · 체크 primary 굵기 3 (AC-6 · 02a ★13)', () => {
  it('selected=start 이면 출발일순 라벨이 primary Bold, 최신순 라벨은 body Regular', () => {
    render(
      <MyTripsSortSheet selected="start" onSelect={noop} onClose={noop} />
    );

    const picked = within(
      screen.getByTestId('my-trips-sort-option-start')
    ).getByText('출발일순');
    expect(tokens(picked)).toEqual(
      expect.arrayContaining(['font-noto-bold', 'text-primary'])
    );

    const other = within(
      screen.getByTestId('my-trips-sort-option-recent')
    ).getByText('최신순');
    expect(tokens(other)).toContain('text-body');
    expect(tokens(other)).not.toContain('text-primary');
    expect(tokens(other)).not.toContain('font-noto-bold');
    expect(tokens(other)).not.toContain('font-bold');
  });

  it('체크는 Figma 값 그대로 — stroke #FF385C · 굵기 3 · 22', () => {
    render(
      <MyTripsSortSheet selected="start" onSelect={noop} onClose={noop} />
    );

    const check = screen.getByTestId('my-trips-sort-check-start');
    const path = within(check).UNSAFE_getByType(Path);
    expect(path.props.stroke).toBe('#FF385C');
    expect(path.props.strokeWidth).toBe(3);
    // 폭 — 선택 행 안의 Svg 는 체크 하나뿐이다(testID 가 Svg 에 붙었든 감싼 View 에 붙었든 같은 답).
    const svgs = within(
      screen.getByTestId('my-trips-sort-option-start')
    ).UNSAFE_getAllByType(Svg);
    expect(svgs).toHaveLength(1);
    expect(svgs[0].props.width).toBe(22);
  });
});

describe('🔴 T4 · 옵션 탭 = 그 기준으로 onSelect 1회, 적용 버튼 없음 (AC-4 · 02a ★9)', () => {
  it('이름순을 누르면 onSelect("title") 1회', () => {
    const onSelect = jest.fn();
    render(
      <MyTripsSortSheet selected="recent" onSelect={onSelect} onClose={noop} />
    );

    fireEvent.press(screen.getByTestId('my-trips-sort-option-title'));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('title');
    expect(screen.queryByText('적용')).toBeNull();
  });
});

describe('🔴 T5 · 스크림 — scrim/40 · 탭하면 onClose 만 (AC-5)', () => {
  it('스크림을 누르면 onClose 1회, onSelect 0회', () => {
    const onSelect = jest.fn();
    const onClose = jest.fn();
    render(
      <MyTripsSortSheet
        selected="recent"
        onSelect={onSelect}
        onClose={onClose}
      />
    );

    const scrim = screen.getByTestId('my-trips-sort-scrim');
    expect(tokens(scrim)).toContain('bg-scrim/40');

    fireEvent.press(scrim);

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe('🔴 T6 · 끌어내려 닫기 — 라이브러리가 부르는 onClose 가 그대로 이어진다 (AC-5)', () => {
  it('enablePanDownToClose 가 켜져 있고 그 노드의 onClose 가 onClose 를 부른다', () => {
    const onClose = jest.fn();
    render(
      <MyTripsSortSheet selected="recent" onSelect={noop} onClose={onClose} />
    );

    // 통과형 목은 BottomSheet prop 을 노드에 그대로 싣는다(StayPriceSheet P3 선례). 실제 끌기는 6-b.
    const panNodes = screen.UNSAFE_root.findAll(
      (node) => node.props?.enablePanDownToClose === true
    );
    expect(panNodes.length).toBeGreaterThan(0);
    (panNodes[panNodes.length - 1].props.onClose as () => void)();

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

/** 주석 제거 — 줄 주석은 바로 앞이 `:` 이면 보존(`https://`, 리포 관례). */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('🔴 T7 · 시트 파일에 raw hex 0 — 색은 토큰으로, hex 는 *Glyphs.tsx 에만 (AC-6)', () => {
  it('주석을 걷은 MyTripsSortSheet.tsx 에 #RGB·#RRGGBB 가 없다', () => {
    const source = readFileSync(
      resolve('src/pages/itinerary-list/ui/MyTripsSortSheet.tsx'),
      'utf8'
    );

    // 정체성 앵커 — 이 파일이 그 시트다(파일이 비어 공짜 통과하는 것 차단).
    expect(source).toContain('my-trips-sort-sheet');
    expect(stripComments(source).match(/#[0-9A-Fa-f]{3,8}\b/g)).toBeNull();
  });
});
