import type { ComponentType } from 'react';
import { render, screen } from '@testing-library/react-native';

/**
 * P1 (TRIP-339 · AC-6 무회귀) — 프리뷰 h11 상태를 **실제로 렌더하는 유일한 심판**.
 *
 * 왜 필요한가: 이 칸은 `preview.tsx` 픽스처에 로컬 이미지를 들인다. 그 해석이 jest에서 터지면
 * `preview.tsx` 를 import 하는 **모든 테스트가 함께 red** 가 되고, 그때 화면에 찍히는 원인은
 * "이미지 넣기"가 아니라 엉뚱한 모듈 로드 실패다. 실측(02a §2-A)으로 지금 형태
 * (`Image.resolveAssetSource(require(...))` → `{ testUri }`, `.uri` 는 `undefined`)는 던지지 않음을
 * 확인했지만, 다른 API로 갈아타면 그 보장이 사라진다 — 이 케이스가 그 그물이다.
 *
 * ⚠️ **여기서 78px 썸네일이 뜨는지는 재지 않는다.** jest 에서는 `.uri` 가 `undefined` 라 화면이
 * 사진 요소 자체를 안 그린다 — 어떤 올바른 구현도 그렇다. "사진이 실제로 뜨는가"는 6-b 실기(R7)
 * 몫이고, 로컬 파일이 실재하는지는 `itineraryMapSurfaceStructure.test.ts` S5가 잰다.
 *
 * 목킹 규약은 `devPreviewMap.test.tsx` 를 그대로 따른다(동결 devPreview 계열과 같은 지뢰 포함).
 */

const mockSearchParams: { state?: string | string[] } = {};

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ ...mockSearchParams }),
}));

jest.mock('@gorhom/bottom-sheet');
jest.mock('react-native-webview');

// 지뢰 — 프리뷰가 네트워크 계층을 (직접이든 전이든) require 하면 즉시 터진다.
jest.mock('@/shared/api', () => {
  throw new Error(
    '일정 초안 프리뷰가 @/shared/api(네트워크 계층)를 런타임에 로드했다'
  );
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const DevPreview = require('@/app/_dev/preview').default as ComponentType;

beforeEach(() => {
  delete mockSearchParams.state;
});

/** 카드 루트만 세는 셀렉터 — 번호·라벨·배지·사진이 같은 접두를 공유하므로 제외한다
 * (`DraftScreen.test.tsx` 가 세운 규약과 같은 형태). */
const CARD_SUB_PREFIXES = [
  'no-',
  'band-',
  'badge-',
  'fixed-',
  'image-',
  'tags-',
  'name-',
];

function cardTestIds(): string[] {
  return screen
    .queryAllByTestId(/^itinerary-draft-slot-/)
    .map((node) => String(node.props.testID))
    .filter((testID) => {
      const tail = testID.slice('itinerary-draft-slot-'.length);
      return !CARD_SUB_PREFIXES.some((prefix) => tail.startsWith(prefix));
    });
}

describe('P1 · AC-6 무회귀 — 프리뷰 h11 상태가 픽스처를 싣고 그대로 렌더된다', () => {
  it('state=itinerary-draft-default 로 열면 슬롯 카드 4장과 지도 자리가 뜬다', () => {
    mockSearchParams.state = 'itinerary-draft-default';

    render(<DevPreview />);

    // ① 픽스처가 그대로 살아 있다 — 사진을 넣으면서 슬롯이 줄거나 늘지 않았다.
    expect(cardTestIds()).toHaveLength(4);
    // ② 화면 뼈대가 섰다(초안 화면의 상시 요소).
    expect(screen.getByTestId('itinerary-draft-back')).toBeOnTheScreen();
    // ③ 지도 블록이 있다 — 좌표를 고쳐도 핀이 하나도 안 남는 일은 없어야 한다
    //    (핀 0개면 화면이 지도 블록을 통째로 뺀다).
    expect(screen.getByTestId('map-root')).toBeOnTheScreen();
  });
});
