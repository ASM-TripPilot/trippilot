import { render, screen } from '@testing-library/react-native';
import Svg, { Path } from 'react-native-svg';

import { BackArrowGlyph } from './RecordGlyphs';

/**
 * TRIP-767 · AC-5 — BackArrowGlyph 의 신규 `color` prop(월 캘린더 chevron 을 회색으로 그리기 위함).
 *
 * 무엇을 보장하나(계약):
 *  - 🔴 `color` prop 을 주면 Path `stroke` 가 그 값으로 그려진다(현재는 `INK` 하드코딩이라 무시 → red).
 *  - 🔴 미지정(하위호환)이면 옛 색 `INK`(#222222) 그대로 — 이 글리프의 기존 소비처가 안 깨진다.
 *
 * ★ 글리프 색 사각(repo-traps 글리프·심판 사정거리): SVG stroke/fill 은 className 을 못 받아 prop 으로
 *   받는다. 여기 sentinel `#1188ff` 는 **색 값이 아니라 prop 배선**을 잠그는 임의값이다 — "회색이 옳은가"는
 *   6-b 몫이고, 이 테스트는 "준 색이 그대로 stroke 로 나온다(=prop 이 배선됐다)"까지만 굳힌다.
 *
 * *(개념 — UNSAFE_getByType)* 렌더 트리에서 react-native-svg 요소를 **타입으로** 집는다(§5 실검증 —
 *  svg 목 없음, 프로브로 width/stroke 판독 확인). BackArrowGlyph 는 Svg 1개·Path 1개라 getByType 단수 OK.
 *
 * 3동작 뼈대: 준비(글리프 격리 렌더) → 실행/단언(Path stroke·Svg width 판독).
 */

describe('🔴 AC-5 · BackArrowGlyph color prop 배선 + INK 하위호환', () => {
  it('color 를 주면 Path stroke 가 그 색이 된다(현재 INK 고정 → red)', () => {
    // sentinel — 디자인 회색이 아니라 prop 배선을 잠그는 임의값.
    render(<BackArrowGlyph color="#1188ff" />);

    const path = screen.UNSAFE_getByType(Path);
    expect(path.props.stroke).toBe('#1188ff');
  });

  it('color 미지정이면 옛 색 INK(#222222)·기본 크기 24 그대로(하위호환 회귀)', () => {
    render(<BackArrowGlyph />);

    expect(screen.UNSAFE_getByType(Path).props.stroke).toBe('#222222');
    expect(screen.UNSAFE_getByType(Svg).props.width).toBe(24);
  });
});
