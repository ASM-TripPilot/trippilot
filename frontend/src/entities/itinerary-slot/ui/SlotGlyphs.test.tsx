import { render } from '@testing-library/react-native';

import {
  CategoryBuildingGlyph,
  CategoryCupGlyph,
  CategoryForkKnifeGlyph,
  CategoryImageGlyph,
  CategoryNightGlyph,
  CategoryPinGlyph,
  CategoryShoppingBagGlyph,
  CategoryTreeGlyph,
} from './SlotGlyphs';

/**
 * TRIP-809 · AC-4(글리프) — entities/itinerary-slot/ui/SlotGlyphs 의 카테고리 글리프 8종.
 *
 * 무엇을 보장하나:
 *  - 🔴 카테고리 사진 플레이스홀더가 고르는 8 아이콘(명소·맛집·카페·야경·자연·쇼핑·문화 + 폴백)이
 *    이 모듈에서 **실제로 export 된다** — `SlotPhotoPlaceholder` 의 `ICON_BY_KEY` 8키와
 *    `ItineraryGlyphs.tsx` 의 8종 재수출 shim 이 모두 이 파일을 물기 때문이다. 하나라도 빠지면
 *    소비처가 `undefined` 를 렌더해 깨진다.
 *  - 🔴 각 글리프가 render 시 **비어 있지 않은 트리**를 낸다(SVG 를 실제로 그린다).
 *
 * (한계) **어느 아이콘이 어느 모양·색인지는 이 파일이 안 본다** — 글리프는 SVG `stroke`/`fill` 이라
 *   className·testID 를 안 받아 jest 원리적 사각이다(repo-traps `*Glyphs.tsx` raw-hex 제외 · traps-itinerary
 *   `ICON_BY_KEY` 함정). 두 글리프를 맞바꿔도 이 테스트는 green — 아이콘↔카테고리 정합은 6-b 육안
 *   (`itinerary-timeline-placeholder` 프리뷰) 전용이다. 이관으로 **새로 생긴 사각이 아니라** 원래
 *   있던 것을 그대로 옮기는 것이라 여기서 세우려 하지 않는다(01b §jest 사각 · 02a ★9).
 *
 * (개념) `render(<Glyph />).toJSON()` — 컴포넌트를 렌더 트리로 직렬화한 결과. 아무것도 안 그리면
 *   `null` 이 나오므로 `not.toBeNull()` 이 "빈 컴포넌트가 아니다"를 잠근다. 여기선 무prop 호출
 *   (`<Glyph />`)로 기본값(size=30)만 태운다 — 소비처가 `<Icon size={30} />` 로 부르는 것과 같은 형태.
 *
 * 3동작 뼈대: 준비=글리프 컴포넌트 → 실행=render → 단언=함수 존재·트리 비-null.
 */

const CATEGORY_GLYPHS: {
  name: string;
  Glyph: (props: { size?: number }) => React.ReactElement;
}[] = [
  { name: 'CategoryPinGlyph', Glyph: CategoryPinGlyph },
  { name: 'CategoryForkKnifeGlyph', Glyph: CategoryForkKnifeGlyph },
  { name: 'CategoryCupGlyph', Glyph: CategoryCupGlyph },
  { name: 'CategoryNightGlyph', Glyph: CategoryNightGlyph },
  { name: 'CategoryTreeGlyph', Glyph: CategoryTreeGlyph },
  { name: 'CategoryShoppingBagGlyph', Glyph: CategoryShoppingBagGlyph },
  { name: 'CategoryBuildingGlyph', Glyph: CategoryBuildingGlyph },
  { name: 'CategoryImageGlyph', Glyph: CategoryImageGlyph },
];

describe('🔴 SlotGlyphs — 카테고리 글리프 8종 export·렌더(AC-4)', () => {
  it('카테고리 글리프가 정확히 8종 나열된다(폴백 포함 — 7 카테고리 + 이미지)', () => {
    // 준비·단언 — 이 표가 8행이어야 아래 it.each 가 8종을 전수한다(누락 방지 앵커).
    expect(CATEGORY_GLYPHS).toHaveLength(8);
  });

  it.each(CATEGORY_GLYPHS)(
    '$name 은 함수로 export 되고 render 시 비어 있지 않은 트리를 낸다',
    ({
      Glyph,
    }: {
      Glyph: (props: { size?: number }) => React.ReactElement;
    }) => {
      // 단언 ① — 실제로 export 된 컴포넌트다(undefined 면 소비처가 깨진다).
      expect(typeof Glyph).toBe('function');
      // 단언 ② — render 가 SVG 트리를 낸다(빈 컴포넌트가 아니다). 모양·색은 안 본다(위 한계).
      expect(render(<Glyph />).toJSON()).not.toBeNull();
    }
  );
});
