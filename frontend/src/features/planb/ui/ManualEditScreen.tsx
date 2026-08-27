import type { ReactElement } from 'react';

import type {
  ItineraryDaysItem,
  ItineraryDaysItemSlotsItem,
} from '@/shared/api/generated/schemas';
import { ManualEditShell } from '@/shared/itinerary-edit';

/**
 * TRIP-443 · i15·i22 수동 편집 화면(features/planb) — 라우트 파라미터 `variant`를 mode로 파생해
 * 공용 셸을 소비한다: `variant==='error' → 'fallback'`(i22 폴백), else `'normal'`(i15 정상).
 * mode 파생 외의 렌더는 전부 `@/shared/itinerary-edit`의 `ManualEditShell`이 진다(shared 승격 —
 * planb는 U3(features/itinerary) 직접 import 금지라 공용 셸이 유일한 다리다).
 */

export type ManualEditVariant = 'error' | 'normal';

export interface ManualEditScreenProps {
  /** 미지정 → 'normal'(정상 [직접 고르기] 진입, i15). */
  variant?: ManualEditVariant;
  days: ItineraryDaysItem[];
  activeDayIndex?: number;
  lockedSlotKeys?: string[];
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
