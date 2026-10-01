import type { ComponentType } from 'react';
import { render, screen, within } from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';

import { HeartGlyph } from '@/features/settings/ui/SettingsGlyphs';

/**
 * TRIP-775 · AC-10 — `my-page-default` 프리뷰가 Figma l03 default 의 데이터와 같다.
 * TRIP-1123 — Figma 채택본 default `4755:2930` · empty `4755:3123` 로 교체: 세그·여행 카드·[새 여행 만들기]·
 * 빈 문구가 사라지고, 숫자 칸마다 라벨 뒤 회색 › 가 붙었다(프리뷰도 누를 곳을 넘겨 › 를 그린다).
 *
 * 무엇을 보장하나:
 *  - 프로필 카운트가 예정 2 · 진행 중 0 · 종료 3 순서다.
 *  - 🔴 1123 세그·여행 카드·CTA 가 없고, 숫자 칸 3개에 › 가 하나씩 있다.
 *  - 하단 탭바가 합성돼 있고 '마이' 탭이 활성이다(`withShellTabBar(…, 'my')`).
 *  - 예정이 있으므로 "지난 여행" 섹션이 없다. 하트 FAB 도 없다(AC-8).
 *
 * 키 이름·개수 불변은 `devPreviewBandNav`·`devPreviewBandSort`(무수정)가 지킨다 — 모름(`–`) 상태는 Figma 프레임이
 * 없어 l 밴드 25키 1:1 잠금에 새 키를 넣지 않는다(02 판정).
 * 픽셀(카드 모서리·그림자·폰트·› 세로 정렬)은 jest 가 못 본다 — [검증] 스크린샷 대조 몫.
 *
 * TRIP-776 · AC-8 — `my-page-empty` 프리뷰가 Figma l03 empty 의 데이터와 같다(아래 두 번째 describe).
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
const PREVIEW_STATES = require('@/app/_dev/preview').PREVIEW_STATES as {
  key: string;
  label: string;
}[];
/* eslint-enable @typescript-eslint/no-require-imports */

const CARD_ROOT = /^my-trip-card-/;

/** 프로필 카드 숫자 칸 안의 › (host Text, 글자 완전 일치) 개수. */
function chevronCountIn(cellTestID: string): number {
  return screen
    .getByTestId(cellTestID)
    .findAll((n) => (n.type as string) === 'Text' && n.props.children === '›')
    .length;
}

const COUNT_CELLS = [
  'my-profile-count-upcoming',
  'my-profile-count-active',
  'my-profile-count-ended',
];

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

  it('🔴 1123 · 세그·여행 카드·[새 여행 만들기]가 없고, 숫자 칸마다 › 가 하나씩 있다', () => {
    render(<DevPreview />);

    // 단언(부재) — Figma 4755:2930 엔 목록이 없다.
    expect(screen.queryAllByTestId(/^my-trip-segment/)).toHaveLength(0);
    expect(screen.queryAllByTestId(CARD_ROOT)).toHaveLength(0);
    expect(screen.queryByTestId('my-create-trip')).toBeNull();
    expect(screen.queryByText('부산 여행')).toBeNull();
    // 단언(존재) — 숫자 칸 3개, 각 칸에 › 하나.
    COUNT_CELLS.forEach((id) => {
      expect(chevronCountIn(id)).toBe(1);
    });
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

/** 지난 여행 카드 루트 — `my-trip-reflection-{id}` 이되 썸네일·사진 하위 testID 는 뺀다. */
function pastCardRoots(): ReactTestInstance[] {
  return screen
    .queryAllByTestId(/^my-trip-reflection-/)
    .filter((node) => !/-(thumb|photo)$/.test(String(node.props.testID)));
}

describe('TRIP-776 · my-page-empty 프리뷰 (AC-8)', () => {
  beforeEach(() => {
    mockSearchParams.state = 'my-page-empty';
  });

  it('프로필 카운트는 예정 0 · 진행 중 0 · 종료 3 순서다', () => {
    render(<DevPreview />);

    const numbers = screen
      .getByTestId('my-profile-card')
      .findAll(
        (node) =>
          (node.type as string) === 'Text' &&
          /^\d+$/.test(String(node.props.children))
      )
      .map((node) => String(node.props.children));

    expect(numbers).toEqual(['0', '0', '3']);
  });

  it('프로필 태그는 #바다 · #미식 · #느긋 이고, 스타일 카드는 없다(Figma empty)', () => {
    render(<DevPreview />);

    const tags = within(screen.getByTestId('my-profile-card'))
      .getAllByTestId('my-profile-tag')
      .map((node) => node.findAll((n) => (n.type as string) === 'Text'))
      .map((texts) => texts.map((t) => String(t.props.children)).join(''));
    expect(tags).toEqual(['#바다', '#미식', '#느긋']);
    expect(screen.queryByTestId('my-style-card')).toBeNull();
  });

  it('🔴 1123 · 빈 문구·[새 여행 만들기]·세그·칩 카드가 없고, 숫자 칸마다 › 가 있다(Figma 4755:3123)', () => {
    render(<DevPreview />);

    expect(screen.queryAllByText(/예정된 여행이 없어요/)).toHaveLength(0);
    expect(screen.queryByTestId('my-create-trip')).toBeNull();
    expect(screen.queryByText('새 여행 만들기')).toBeNull();
    expect(screen.queryAllByTestId(/^my-trip-segment/)).toHaveLength(0);
    expect(screen.queryAllByTestId(CARD_ROOT)).toHaveLength(0);
    COUNT_CELLS.forEach((id) => {
      expect(chevronCountIn(id)).toBe(1);
    });
  });

  it('지난 여행은 썸네일 카드 3장 — 제주 · 강릉 · 부산 순서, 날짜와 사진 수가 Figma 와 같다', () => {
    render(<DevPreview />);

    expect(screen.getByText('지난 여행')).toBeOnTheScreen();
    expect(screen.getByTestId('my-past-calendar')).toBeOnTheScreen();

    const cards = pastCardRoots();
    expect(cards).toHaveLength(3);
    const expected = [
      ['제주 여행', '2026.5.1–5.3', '사진 24'],
      ['강릉 여행', '2026.4.18–4.20', '사진 16'],
      ['부산 여행', '2025.10.3–10.5', '사진 30'],
    ] as const;
    cards.forEach((card, i) => {
      const [title, date, photos] = expected[i];
      expect(within(card).getByText(title)).toBeOnTheScreen();
      expect(within(card).getByText(date)).toBeOnTheScreen();
      expect(within(card).getByText(photos)).toBeOnTheScreen();
      // 썸네일형 카드다(자리 박스가 카드 안에 있다).
      expect(
        within(card).getByTestId(`${String(card.props.testID)}-thumb`)
      ).toBeOnTheScreen();
    });
  });

  it('하단 탭바가 합성돼 있고 마이 탭이 활성이다', () => {
    render(<DevPreview />);

    const tabBar = screen.getByTestId('shell-tabbar-root');
    expect(
      within(tabBar).getByTestId('shell-tabbar-icon-my-active')
    ).toBeOnTheScreen();
  });

  it('라벨이 l03 코드로 시작하고 옛 "예정 0·종료 0" 이 아니다', () => {
    const state = PREVIEW_STATES.find((s) => s.key === 'my-page-empty');

    expect(state).toBeDefined();
    expect(state?.label).not.toBe('l03 · 예정 0·종료 0');
    expect(state?.label).toMatch(/^l03 · /);
    // TRIP-772: l 라벨을 Figma 프레임 이름(`l03 · 마이페이지 empty`)으로 통일해 픽스처 수("종료 3")
    // 단언은 뺐다 — 정확한 라벨은 devPreviewBandNav 'TRIP-772' describe 가 못박는다.
  });
});
