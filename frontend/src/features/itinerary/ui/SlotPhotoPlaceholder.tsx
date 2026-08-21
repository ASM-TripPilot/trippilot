import type { ReactElement } from 'react';
import { View } from 'react-native';

import { resolveCategoryPlaceholder } from '../model/categoryPlaceholder';
import {
  CategoryBuildingGlyph,
  CategoryCupGlyph,
  CategoryForkKnifeGlyph,
  CategoryImageGlyph,
  CategoryNightGlyph,
  CategoryPinGlyph,
  CategoryShoppingBagGlyph,
  CategoryTreeGlyph,
} from './ItineraryGlyphs';

/**
 * TRIP-465 · 사진 없는 일정 슬롯의 카테고리 플레이스홀더 — Figma `2989:1731`.
 *
 * `slot.imageUrl` 이 null 인 h25 카드에서 사진 leaf 자리에 그리는 78×78 대체 타일. 카테고리별 옅은
 * 틴트 배경 + 중앙 테마 아이콘으로 "여기 원래 사진 자리인데 없음 · 이 종류의 장소"를 정직하게 알린다
 * (실사진 발명 아님 · INV-1 정신). 텍스트는 0 — 아이콘만 그려 INV-3 소요시간 오탐 소지를 없앤다.
 *
 * 배선 계약(★3): 틴트 className 과 testID 는 **같은 root View** 에 얹는다 — 렌더 틴트 단언이
 * `getByTestId(id).props.className` 로 이 노드에서 틴트를 관측하기 때문이다(자식에 얹으면 red).
 *
 * 판정은 순수 모듈에 위임한다: 틴트·아이콘 키는 `resolveCategoryPlaceholder`(model), 이 컴포넌트는
 * iconKey → 아이콘 컴포넌트 선택 + 렌더만 한다. 매핑 밖 iconKey 는 이미지 아이콘으로 폴백.
 */

const ICON_BY_KEY: Record<string, (props: { size?: number }) => ReactElement> =
  {
    sight: CategoryPinGlyph,
    food: CategoryForkKnifeGlyph,
    cafe: CategoryCupGlyph,
    night: CategoryNightGlyph,
    nature: CategoryTreeGlyph,
    shopping: CategoryShoppingBagGlyph,
    culture: CategoryBuildingGlyph,
    image: CategoryImageGlyph,
  };

export interface SlotPhotoPlaceholderProps {
  /** 슬롯 카테고리(자유 string, null 가능). 매핑 밖·부재는 폴백 타일로 접힌다. */
  category: string | null | undefined;
  /** 호출부가 주입(`itinerary-timeline-slot-photoplaceholder-{slotKey}`). */
  testID: string;
}

export function SlotPhotoPlaceholder({
  category,
  testID,
}: SlotPhotoPlaceholderProps): ReactElement {
  const { tintClass, iconKey } = resolveCategoryPlaceholder(category);
  const Icon = ICON_BY_KEY[iconKey] ?? CategoryImageGlyph;
  return (
    <View
      testID={testID}
      className={`h-[78px] w-[78px] items-center justify-center rounded-thumb ${tintClass}`}
    >
      <Icon size={30} />
    </View>
  );
}
