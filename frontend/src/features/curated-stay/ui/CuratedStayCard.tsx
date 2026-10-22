import type { ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';

import type { CuratedStay } from '@/shared/api/index.schemas';
import { HeartButton } from '@/shared/ui/HeartButton';
import { Image } from '@/shared/ui/Image';

import { curatedKey } from '../model/curatedKey';

/**
 * 인기 숙소 카드(TRIP-1579) — 사진 + 이름 + 하트, 주소는 있을 때만 한 줄. 평점·가격은 없다(BR-U1-18 — 계약에
 * 필드가 없다). 순수 뷰 — 저장 상태·핸들러는 props. 폭·사진 높이는 숙소·장소 레인 카드(160×120)와 같다.
 *
 * testID 는 hotelId(`stayId` 의 콜론 뒤) 기준: 카드 `curated-stay-card-{id}` · 하트 `curated-stay-heart-{id}`
 * (`-filled`/`-outline` 글리프). 하트는 카드의 자식 Pressable 이라 하트 누름이 카드 누름을 부르지 않는다.
 * 대기(disabled) 하트 누름은 부모로 새므로 카드 쪽에 `!pending` 가드를 둔다(PlaceRailCard 선례).
 */
export interface CuratedStayCardProps {
  stay: CuratedStay;
  saved: boolean;
  pending?: boolean;
  onPress: () => void;
  onToggleSave: () => void;
}

export function CuratedStayCard({
  stay,
  saved,
  pending,
  onPress,
  onToggleSave,
}: CuratedStayCardProps): ReactElement {
  const id = curatedKey(stay).externalId;
  return (
    <Pressable
      testID={`curated-stay-card-${id}`}
      accessibilityRole="button"
      // 보이는 글자 그대로(TRIP-1281) — 없으면 iOS 가 자식 하트 라벨을 카드에 끌어다 붙인다.
      accessibilityLabel={[stay.name, stay.address].filter(Boolean).join(', ')}
      onPress={() => {
        if (!pending) onPress();
      }}
      className="w-[160px]"
    >
      <View>
        <Image
          testID={`curated-stay-photo-${id}`}
          source={{ uri: stay.imageUrl }}
          contentFit="cover"
          cachePolicy="memory-disk"
          recyclingKey={stay.stayId}
          transition={120}
          className="h-[120px] w-full rounded-card bg-surface-strong"
        />
        <HeartButton
          saved={saved}
          pending={pending}
          onPress={onToggleSave}
          testID={`curated-stay-heart-${id}`}
          filledTestID={`curated-stay-heart-${id}-filled`}
          outlineTestID={`curated-stay-heart-${id}-outline`}
          name={stay.name}
          className="absolute right-sm top-sm"
        />
      </View>
      <Text
        numberOfLines={1}
        className="mt-sm font-noto-bold text-card-title font-bold text-ink"
      >
        {stay.name}
      </Text>
      {stay.address ? (
        <Text
          testID={`curated-stay-address-${id}`}
          numberOfLines={1}
          className="mt-xs font-noto text-label text-muted"
        >
          {stay.address}
        </Text>
      ) : null}
    </Pressable>
  );
}
