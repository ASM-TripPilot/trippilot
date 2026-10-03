import { render, screen } from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';

import tailwindConfig from '../../../../tailwind.config.js';
import {
  HOME_DEFAULT_PROPS,
  HOME_PLANNING_PROPS,
  HOME_TRAVELING_PROPS,
} from '../model/homeFixtures';
import type { HomeScreenProps } from '../model/homeTypes';
import { HomeScreen } from './HomeScreen';

/**
 * TRIP-1019 #006 — 홈 히어로 페이지 도트가 태그 칩 글자를 가린다(QA). Figma a01(2091:1371)은 도트
 * 5개를 **칩 줄 아래 별도 줄**(좌측)에 둔다.
 *
 * 무엇을 보장하나: 캐러셀의 매 페이지에서 "본문 기둥의 하단 여백"이 "도트 오버레이가 차지하는 높이
 * (하단 오프셋 + 도트 높이) + 최소 간격 8px(spacing.sm)" 이상이다 — 즉 칩 줄이 끝나는 선이 도트
 * 줄보다 위에 있다. 지금 매거진 페이지는 여백 20px(pb-xl)인데 도트는 바닥에서 24~30px 에 떠 있어
 * 칩과 겹친다. page0 통합 트립 히어로(pb-[44px])는 이미 비켜 있어 무회귀 앵커가 된다.
 *
 * 왜 className 으로 재나: jest 는 레이아웃을 계산하지 않아 absolute 겹침을 원리적으로 못 본다
 * (브리프 AC-006 "판정 주체는 6-b"). 대신 NativeWind `className` 은 렌더 트리에 평문 prop 으로
 * 남으므로(HomeScreen.test 벨·배지 선례) 두 값을 px 로 풀어 **관계**만 잰다 — 실제 픽셀·Figma
 * 간격(≈13px) 일치는 6-b 육안 몫이다.
 *
 * 전제(계약): ① 도트는 지금처럼 캐러셀이 소유한 `absolute` 오버레이 1벌이다(traps-home "도트 1벌").
 * ② 각 페이지의 본문 기둥은 `flex-1` + `justify-between` 을 가진 호스트 노드 정확히 1개다
 * (MagazineHero·IntegratedTripHero 공통 구조 — 이번 수정 범위 밖).
 *
 * ★ 페이지 수의 앵커는 `home-hero-page-N` 컨테이너다(도트는 위조 가능, traps-home).
 * ★ 부재·불일치 목록을 `toEqual([])` 로 재면 대상이 0개일 때 거짓 초록이 된다 — 페이지별 판정
 *   배열을 기대 길이와 함께 `toEqual([true × N])` 으로 잰다.
 */

const SPACING = (
  tailwindConfig as unknown as {
    theme: { extend: { spacing: Record<string, string> } };
  }
).theme.extend.spacing;

function classTokens(node: ReactTestInstance): string[] {
  return String(node.props.className ?? '')
    .split(/\s+/)
    .filter(Boolean);
}

/** `pb-[44px]`·`pb-xl`(→ tailwind spacing) 같은 토큰을 px 숫자로. 없으면 null. */
function tokenPx(tokens: string[], prefixes: string[]): number | null {
  for (const prefix of prefixes) {
    for (const token of tokens) {
      if (!token.startsWith(`${prefix}-`)) continue;
      const value = token.slice(prefix.length + 1);
      const arbitrary = /^\[(\d+(?:\.\d+)?)px\]$/.exec(value);
      if (arbitrary) return Number(arbitrary[1]);
      const scale = SPACING[value];
      if (scale !== undefined) return parseFloat(scale);
    }
  }
  return null;
}

/** 도트 0 에서 위로 올라가 처음 만나는 `absolute` 호스트 = 도트 오버레이. */
function dotOverlay(): ReactTestInstance {
  let node: ReactTestInstance | null = screen.getByTestId('home-hero-dot-0');
  while (node) {
    if (typeof node.type === 'string' && classTokens(node).includes('absolute'))
      return node;
    node = node.parent;
  }
  throw new Error('도트 오버레이(absolute 조상)를 찾지 못했다');
}

/** 페이지 안 본문 기둥(`flex-1`+`justify-between` 호스트) — 정확히 1개여야 한다. */
function bodyColumn(page: ReactTestInstance): ReactTestInstance {
  const columns = page.findAll(
    (node) =>
      typeof node.type === 'string' &&
      classTokens(node).includes('flex-1') &&
      classTokens(node).includes('justify-between')
  );
  if (columns.length !== 1) {
    throw new Error(`본문 기둥이 ${columns.length}개다(기대 1)`);
  }
  return columns[0];
}

const FACES: { name: string; props: HomeScreenProps }[] = [
  { name: '여행 없음(discovery)', props: HOME_DEFAULT_PROPS },
  { name: '계획 중(planning)', props: HOME_PLANNING_PROPS },
  { name: '여행 중(traveling)', props: HOME_TRAVELING_PROPS },
];

const PAGE_COUNT = 5;
const MIN_GAP_PX = parseFloat(SPACING.sm); // 칩 줄과 도트 줄 사이 최소 한 칸(8px)

describe('🔴 TRIP-1019 #006 · 히어로 도트가 칩 줄 아래에 있다 (Figma a01 · US-SHELL-02)', () => {
  it.each(FACES)(
    '$name — 5페이지 모두 본문 하단 여백이 도트 오버레이 높이 + 8px 이상이다',
    ({ props }) => {
      render(<HomeScreen {...props} />);

      // 앵커 — 페이지 5개·도트 5개(구조 무회귀, 기존 TRIP-694/696 계약).
      const pages = Array.from({ length: PAGE_COUNT }, (_, i) =>
        screen.getByTestId(`home-hero-page-${i}`)
      );
      expect(screen.queryByTestId(`home-hero-page-${PAGE_COUNT}`)).toBeNull();
      expect(
        screen.getByTestId(`home-hero-dot-${PAGE_COUNT - 1}`)
      ).toBeOnTheScreen();

      // 도트 오버레이가 바닥에서 차지하는 높이 = 하단 오프셋 + 도트 높이.
      const overlay = dotOverlay();
      const bottom = tokenPx(classTokens(overlay), ['bottom']);
      const dotHeight = tokenPx(
        classTokens(screen.getByTestId('home-hero-dot-0')),
        ['h']
      );
      // 값이 안 풀리면 아래 비교가 NaN 으로 조용히 false 가 되므로 먼저 숫자임을 못 박는다.
      expect({ bottom, dotHeight }).toEqual({
        bottom: expect.any(Number),
        dotHeight: expect.any(Number),
      });
      const needed = (bottom as number) + (dotHeight as number) + MIN_GAP_PX;

      const clears = pages.map((page) => {
        const padding = tokenPx(classTokens(bodyColumn(page)), [
          'pb',
          'py',
          'p',
        ]);
        return padding !== null && padding >= needed;
      });
      expect(clears).toEqual(Array.from({ length: PAGE_COUNT }, () => true));
    }
  );
});
