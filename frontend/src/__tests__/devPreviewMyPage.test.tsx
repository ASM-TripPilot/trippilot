import type { ComponentType } from 'react';
import { render, screen, within } from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';

import { HeartGlyph } from '@/features/settings/ui/SettingsGlyphs';

/**
 * TRIP-775 · AC-10 — `my-page-default` 프리뷰가 Figma l03 default(1602:2388)의 데이터와 같다.
 *
 * 무엇을 보장하나:
 *  - 프로필 카운트가 예정 2 · 진행 중 0 · 종료 3 순서다.
 *  - 여행 카드는 2장(부산 여행 D-12 primary / 제주 여행 D-30 ink)이고 속초 D-60 엣지 카드는 없다.
 *  - 하단 탭바가 합성돼 있고 '마이' 탭이 활성이다(`withShellTabBar(…, 'my')`).
 *  - 예정이 있으므로 "지난 여행" 섹션이 없다. 하트 FAB 도 없다(AC-8).
 *
 * 키 이름·개수 불변은 `devPreviewBandNav`·`devPreviewBandSort`(무수정)가 지킨다.
 * 픽셀(카드 모서리·그림자·폰트)은 jest 가 못 본다 — [검증] 스크린샷 대조 몫.
 *
 * 3동작: 준비(딥링크 state=키) → 실행(DevPreview 렌더) → 단언.
 */

const mockSearchParams: { state?: string | string[] } = {};

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ ...mockSearchParams }),
}));

// 통과형 시트 목 — 다른 devPreview 테스트와 같은 장치(프리뷰 모듈 전체를 로드하므로 필요).
jest.mock('@gorhom/bottom-sheet');

// 지뢰 — 프리뷰가 이 모듈을 (직접이든 전이든) require 하면 즉시 터진다.
jest.mock('@/shared/api', () => {
  throw new Error(
    'l03 프리뷰가 @/shared/api(네트워크 계층)를 런타임에 로드했다'
  );
});

/* eslint-disable @typescript-eslint/no-require-imports */
const DevPreview = require('@/app/_dev/preview').default as ComponentType;
/* eslint-enable @typescript-eslint/no-require-imports */

const CARD_ROOT = /^my-trip-card-/;

function tokens(className: unknown): string[] {
  return typeof className === 'string' ? className.split(/\s+/) : [];
}

/** 배지 글자부터 카드 루트 직전까지, 호스트 요소의 bg-* 토큰. */
function badgeBgTokens(label: string): string[] {
  const out: string[] = [];
  let cur: ReactTestInstance | null = screen.getByText(label);
  while (cur) {
    if (typeof cur.type === 'string') {
      const id = cur.props.testID;
      if (typeof id === 'string' && CARD_ROOT.test(id)) break;
      out.push(...tokens(cur.props.className));
    }
    cur = cur.parent;
  }
  return out.filter((token) => token.startsWith('bg-'));
}

beforeEach(() => {
  mockSearchParams.state = 'my-page-default';
});

describe('TRIP-775 · my-page-default 프리뷰 (AC-10)', () => {
  it('프로필 카운트는 예정 2 · 진행 중 0 · 종료 3 순서다', () => {
    render(<DevPreview />);

    // 호스트 Text 중 숫자만 담은 글자를 위→아래 순서로 모은다(3/0/2 도 숫자 집합은 같아서 존재만 보면 공짜 통과).
    const numbers = screen
      .getByTestId('my-profile-card')
      .findAll(
        (node) =>
          (node.type as string) === 'Text' &&
          /^\d+$/.test(String(node.props.children))
      )
      .map((node) => String(node.props.children));

    expect(numbers).toEqual(['2', '0', '3']);
  });

  it('여행 카드는 부산 여행 · 제주 여행 2장이고 속초 엣지 카드는 없다', () => {
    render(<DevPreview />);

    const cardIds = screen
      .queryAllByTestId(CARD_ROOT)
      .map((node) => String(node.props.testID));
    expect(cardIds).toHaveLength(2);
    expect(screen.getByText('부산 여행')).toBeOnTheScreen();
    expect(screen.getByText('제주 여행')).toBeOnTheScreen();
    expect(screen.queryByText(/속초/)).toBeNull();
  });

  it('D-12 배지는 primary, D-30 배지는 ink 다', () => {
    render(<DevPreview />);

    const near = badgeBgTokens('D-12');
    expect(near).toContain('bg-primary');
    expect(near).not.toContain('bg-ink');

    const far = badgeBgTokens('D-30');
    expect(far).toContain('bg-ink');
    expect(far).not.toContain('bg-primary');
  });

  it('하단 탭바가 합성돼 있고 마이 탭이 활성이다', () => {
    render(<DevPreview />);

    const tabBar = screen.getByTestId('shell-tabbar-root');
    expect(
      within(tabBar).getByTestId('shell-tabbar-icon-my-active')
    ).toBeOnTheScreen();
  });

  it('"지난 여행" 섹션과 하트 FAB 가 없다(예정 2건, AC-8)', () => {
    render(<DevPreview />);

    expect(screen.queryByText('지난 여행')).toBeNull();
    expect(screen.UNSAFE_queryAllByType(HeartGlyph)).toHaveLength(0);
    // 짝 앵커: 화면은 그려졌다.
    expect(screen.getByTestId('my-page-root')).toBeOnTheScreen();
  });
});
