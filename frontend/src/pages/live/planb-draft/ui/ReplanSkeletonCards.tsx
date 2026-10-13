import type { ReactElement } from 'react';
import { View } from 'react-native';

import { Skeleton } from '@/shared/ui/Skeleton';

/**
 * TRIP-1205 · i05 시트 빈 곳의 스켈레톤 슬롯 카드 2장 + 사이 거리 줄(Figma `4817:2695`
 * stopcard·skeleton · conn·skeleton). 실제 슬롯 카드(`ReplanSlotRow`)와 같은 윤곽 — 카드 96 · 패딩 11
 * · 사진 72 · 같은 그림자. 두 장+거리 줄이 `Skeleton` 하나 안에 있어 펄스 루프도 하나다(동작 줄이기면
 * 정지). 글자·퍼센트·안내 문장은 없다(INV-3, 새 문장 금지). ⚠️ 윤곽·펄스는 jest 사각(6-b 육안).
 *
 * `leadingConnector` — 앞에 방문 행이 있으면 첫 카드 앞에도 거리 줄을 그린다(Figma 순서 conn→card).
 */

const CARD_COUNT = 2;

// 카드 그림자 — ReplanSlotRow 와 같은 값.
const cardShadow = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.08,
  shadowRadius: 16,
  elevation: 2,
} as const;

const BLOCK = 'bg-surface-strong';

function ConnectorBlock({ id }: { id: string }): ReactElement {
  return (
    <View testID={id} className="flex-row items-center gap-[6px] pl-md">
      <View className={`h-[16px] w-[16px] rounded-[8px] ${BLOCK}`} />
      <View className={`h-[16px] w-[36px] rounded-[8px] ${BLOCK}`} />
    </View>
  );
}

function CardBlock({ n }: { n: number }): ReactElement {
  const id = `planb-skeleton-card-${n}`;
  return (
    <View
      testID={id}
      style={cardShadow}
      className="flex-row items-start gap-[10px] rounded-card border border-hairline bg-canvas p-[11px]"
    >
      <View
        testID={`${id}-num`}
        className={`h-[24px] w-[24px] rounded-pill ${BLOCK}`}
      />
      <View
        testID={`${id}-photo`}
        className={`h-[72px] w-[72px] rounded-thumb ${BLOCK}`}
      />
      <View className="flex-1 gap-[6px]">
        <View
          testID={`${id}-time`}
          className={`h-[25px] w-[97px] rounded-[8px] ${BLOCK}`}
        />
        <View
          testID={`${id}-title`}
          className={`h-[18px] w-[83px] rounded-[8px] ${BLOCK}`}
        />
        <View
          testID={`${id}-meta`}
          className={`h-[15px] w-[59px] rounded-[8px] ${BLOCK}`}
        />
      </View>
    </View>
  );
}

export function ReplanSkeletonCards({
  leadingConnector,
}: {
  leadingConnector: boolean;
}): ReactElement {
  const cards = Array.from({ length: CARD_COUNT }, (_, i) => i + 1);
  return (
    <Skeleton testID="planb-skeleton" className="gap-sm">
      {cards.map((n) => (
        <View key={n} className="gap-sm">
          {n > 1 || leadingConnector ? (
            <ConnectorBlock id={`planb-skeleton-conn-${n}`} />
          ) : null}
          <CardBlock n={n} />
        </View>
      ))}
    </Skeleton>
  );
}
