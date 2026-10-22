import type { ReactElement } from 'react';
import { ScrollView } from 'react-native';

import type { CuratedStay } from '@/shared/api/index.schemas';

import { CuratedStayCard } from './CuratedStayCard';

/**
 * 인기 숙소 가로 스크롤 줄(TRIP-1579) — 순위 순서 그대로 카드를 늘어놓는다. 저장 판정·핸들러는 props
 * (features 끼리 import 금지 — 저장 훅은 조립하는 쪽이 붙인다).
 */
export interface CuratedStayRowProps {
  items: CuratedStay[];
  isSaved: (stay: CuratedStay) => boolean;
  /** 저장 요청이 진행 중인 카드의 stayId — 그 하트만 잠근다. */
  pendingStayId?: string | null;
  onPressCard: (stay: CuratedStay) => void;
  onToggleSave: (stay: CuratedStay) => void;
  testID?: string;
  /** 좌우 여백·번짐은 배치마다 달라 소비처가 준다(카드 사이 간격 `gap-md` 는 줄이 고정). */
  className?: string;
  contentPaddingClassName?: string;
}

export function CuratedStayRow({
  items,
  isSaved,
  pendingStayId,
  onPressCard,
  onToggleSave,
  testID,
  className,
  contentPaddingClassName = '',
}: CuratedStayRowProps): ReactElement {
  return (
    <ScrollView
      testID={testID}
      horizontal
      showsHorizontalScrollIndicator={false}
      className={className}
      contentContainerClassName={`gap-md ${contentPaddingClassName}`}
    >
      {items.map((stay) => (
        <CuratedStayCard
          key={stay.stayId}
          stay={stay}
          saved={isSaved(stay)}
          pending={pendingStayId === stay.stayId}
          onPress={() => onPressCard(stay)}
          onToggleSave={() => onToggleSave(stay)}
        />
      ))}
    </ScrollView>
  );
}
