import type { ReactElement } from 'react';

import type {
  ItineraryDaysItem,
  ItineraryDaysItemSlotsItem,
} from '@/shared/api/generated/schemas';
import { ManualEditShell } from '@/widgets/itinerary-edit';

/**
 * TRIP-443 신설 → TRIP-805로 features/planb → pages/planb-manual 이관. i15·i22 수동 편집 화면 —
 * 라우트 파라미터 `variant`를 mode로 파생해 공용 셸을 소비한다: `variant==='error' → 'fallback'`
 * (i22 폴백), else `'normal'`(i15 정상). mode 파생 외의 렌더는 전부 `@/widgets/itinerary-edit`의
 * `ManualEditShell`이 진다(TRIP-805로 shared→widgets 승격 — 이 화면이 features 에 있으면
 * features→widgets 층 린트가 막으므로 pages 로 올렸다, 브리프 맹점①).
 */

export type ManualEditVariant = 'error' | 'normal';

export interface ManualEditScreenProps {
  /** 미지정 → 'normal'(정상 [직접 고르기] 진입, i15). */
  variant?: ManualEditVariant;
  days: ItineraryDaysItem[];
  activeDayIndex?: number;
  lockedSlotKeys?: string[];
  /** 시각 직접입력이 적용된 슬롯 키(폴백 i22, 결정 b) — `{...rest}` 로 셸에 그대로 통과된다. */
  timeConfirmedSlotKeys?: string[];
  onBack: () => void;
  onSave: () => void;
  onPressAddPlace?: () => void;
  onDeleteSlot?: (poiId: string) => void;
  onReorder?: (data: ItineraryDaysItemSlotsItem[]) => void;
  onEditSlotTime?: (slotKey: string) => void;
  onPressHistory?: () => void;
}

export function ManualEditScreen({
  variant,
  ...rest
}: ManualEditScreenProps): ReactElement {
  const mode = variant === 'error' ? 'fallback' : 'normal';
  return <ManualEditShell mode={mode} {...rest} />;
}
