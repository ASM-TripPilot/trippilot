import { render, screen } from '@testing-library/react-native';
import { Circle } from 'react-native-svg';

import { WatermarkLogoGlyph } from './ShareCardGlyphs';

/**
 * TRIP-766 · AC-1 — j06 워터마크 로고 배지 교체(물방울 → 종이비행기).
 *
 * 무엇을 보장하나(계약):
 *  - 🔴 코랄 사각 안에 **흰 종이비행기**(신규 testID `share-card-logo-plane`)가 그려진다.
 *  - 🔴 옛 **물방울 마커의 중심 원(Circle)이 사라진다**(현재 1개 → 0개).
 *
 * ★ fill 사각 회피: `*Glyphs.tsx` 는 raw-hex 스캔 제외 관례(SVG stroke/fill 은 className 을 못 받는다).
 *   그래서 이 테스트는 **색·픽셀을 안 본다** — 코랄 사각 색·종이비행기 모양 충실도는 6-b(스크린샷) 몫이고,
 *   여기서는 **testID 실재 + Circle 카운트**(구조)만 굳힌다(repo-traps 글리프 fill 사각 항목).
 *
 * (개념) `UNSAFE_queryAllByType(Circle)` = 렌더 트리에서 react-native-svg `Circle` 요소를 타입으로
 *   전부 찾는다(개수 판독). `getByTestId` 는 SVG Path 에도 붙는다(§5 실검증 — svg 목 없음, 프로브 확인).
 *
 * 3동작 뼈대: 준비(글리프 격리 렌더) → 실행/단언(testID 조회 · Circle 카운트).
 */

describe('🔴 AC-1 · WatermarkLogoGlyph — 종이비행기 교체 · 물방울 폐기', () => {
  it('종이비행기 Path(testID)가 있고, 물방울 중심 원(Circle)은 0개다', () => {
    // 준비: 로고 글리프를 격리 렌더한다(순수 SVG, 프로바이더 불요).
    render(<WatermarkLogoGlyph />);

    // 단언 ① 긍정 — 종이비행기 요소가 실재한다(현 글리프엔 이 testID 없음 → red).
    expect(screen.getByTestId('share-card-logo-plane')).toBeOnTheScreen();

    // 단언 ② 부정 — 물방울 중심 원(Circle)이 사라진다(현재 1개 → red).
    expect(screen.UNSAFE_queryAllByType(Circle)).toHaveLength(0);
  });
});
