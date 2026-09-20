import type { ComponentType } from 'react';

import {
  AmenityGlyph,
  BreakfastGlyph,
  OceanViewGlyph,
  ParkingGlyph,
  WifiGlyph,
} from '../ui/StayGlyphs';

/**
 * 편의시설 코드 → 아이콘 매핑(TRIP-727 · AC-2). 서버가 보내는 실제 문자열은 canon(한글 enum)과
 * 픽스처(영문)가 갈려(01b 자율판정) **두 철자 모두** 같은 아이콘에 건다:
 *  - 주차/parking → ParkingGlyph · 조식/breakfast → BreakfastGlyph
 *  - 와이파이/wifi → WifiGlyph · 오션뷰/ocean → OceanViewGlyph
 *
 * 모르는 코드는 특정 아이콘을 지어내지 않고(INV-1) 일반 체크(`AmenityGlyph`)로 접는다.
 * 배럴 없이 화면이 직접 import 한다(features/stay 관례).
 */

type AmenityIcon = ComponentType<{ size?: number; testID?: string }>;

const ICON_BY_VALUE: Record<string, AmenityIcon> = {
  주차: ParkingGlyph,
  parking: ParkingGlyph,
  조식: BreakfastGlyph,
  breakfast: BreakfastGlyph,
  와이파이: WifiGlyph,
  wifi: WifiGlyph,
  오션뷰: OceanViewGlyph,
  ocean: OceanViewGlyph,
};

/** 알려진 값이면 코드별 아이콘, 아니면 폴백(`AmenityGlyph`). 반환은 컴포넌트 **참조**라 같은 값·
 * 두 철자는 동일 참조를 돌려준다(테스트가 `toBe`로 잠근다). */
export function resolveAmenityIcon(value: string): AmenityIcon {
  return ICON_BY_VALUE[value] ?? AmenityGlyph;
}
