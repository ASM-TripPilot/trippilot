import type { ComponentType } from 'react';
import { render, screen } from '@testing-library/react-native';

/**
 * TRIP-703 AC-8 — dev 프리뷰 `explore-landing-default` 가 Figma default(1672:1183)와 맞다:
 *  - `savedMenu.open:false`(접힘) — 백드롭·미니 FAB 없음
 *  - 픽스처 숙소 3 · 장소 5(여행자 데이터 없음)
 *  - ＋ 여행 만들기 FAB 존재 · 여행자 일정 레인 없음
 *
 * 무엇을 보장하나: 이 키는 Tabs 밖 단독 렌더라 탭바·오버레이는 못 본다(구조 한계, 브리프 맹점).
 * 대신 접힘 상태(open:false)와 픽스처 개수를 잠근다 — 현재 소스는 open:true 라 red 다. 나머지
 * devPreview 정리는 TRIP-711 몫이라 이번엔 `explore-landing-default` 만 다룬다.
 *
 * 동결된 `devPreview*.test.tsx` 는 한 글자도 고치지 않는다 — `devPreviewExplore.test.tsx`
 * 구조(지뢰 목으로 네트워크 격리 + 프리뷰 키 딥링크)를 그대로 따라 새 파일로 추가한다.
 */

const mockSearchParams: { state?: string | string[] } = {};

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ ...mockSearchParams }),
}));

jest.mock('@gorhom/bottom-sheet');

// 지뢰 — 프리뷰가 네트워크 계층을 (직접이든 전이든) require 하면 즉시 터진다.
jest.mock('@/shared/api', () => {
  throw new Error(
    '탐색 랜딩 프리뷰가 @/shared/api(네트워크 계층)를 런타임에 로드했다'
  );
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const DevPreview = require('@/app/_dev/preview').default as ComponentType;

beforeEach(() => {
  delete mockSearchParams.state;
});

describe('dev 프리뷰 d01 default — Figma 정합(open:false·숙소3·장소5)', () => {
  it('explore-landing-default 는 접힌 saved-menu·숙소3·장소5·＋FAB·여행자 레인 없음', () => {
    mockSearchParams.state = 'explore-landing-default';

    render(<DevPreview />);

    // 루트가 뜬다.
    expect(screen.getByTestId('explore-landing')).toBeOnTheScreen();

    // saved-menu 접힘(open:false) — 토글만 있고 백드롭·미니 FAB 은 없다.
    expect(screen.getByTestId('explore-saved-menu-toggle')).toBeOnTheScreen();
    expect(screen.queryByTestId('explore-saved-menu-backdrop')).toBeNull();
    expect(screen.queryByTestId('explore-saved-places-fab')).toBeNull();
    expect(screen.queryByTestId('explore-saved-stays-fab')).toBeNull();

    // 픽스처 개수 — 숙소 3(하트·저장 testID 는 별 접두라 카드 루트만 잡힌다).
    expect(screen.getAllByTestId(/^explore-stay-card-/)).toHaveLength(3);
    // 장소 5 — 사진 leaf(`explore-place-card-image-*`)는 imageUrl:null 이라 없다.
    // 그래도 이미지 접두는 negative lookahead 로 제외해 카드 루트만 센다.
    expect(
      screen.getAllByTestId(/^explore-place-card-(?!image-)/)
    ).toHaveLength(5);

    // ＋ 여행 만들기 FAB 존재 · 여행자 일정 레인 없음.
    expect(screen.getByTestId('explore-create-trip-fab')).toBeOnTheScreen();
    expect(screen.queryByTestId('explore-lane-itin')).toBeNull();
  });
});
