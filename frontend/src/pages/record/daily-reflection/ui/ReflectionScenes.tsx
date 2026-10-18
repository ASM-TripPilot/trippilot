import type { ReactElement } from 'react';
import { Text, View } from 'react-native';
import { Image } from '@/shared/ui/Image';

import type { ReflectionScene } from '../model/reflectionScenes';
import { slotUri } from '../model/reflectionScenes';

/**
 * TRIP-1445 · AI 가 짠 장면을 순서대로 그린다. 사진은 기기에서 꺼낸 `photos` 로 채우고,
 * 못 구하면 캡션만 그린다(빈 사진 칸을 그리지 않는다). 레이아웃 비율 변환은 후속 — 지금은 사진+캡션 한 모양.
 */
export interface ReflectionScenesProps {
  scenes: readonly ReflectionScene[];
  date: string;
  photos: readonly { uri: string; poiId: string }[];
}

export function ReflectionScenes({
  scenes,
  date,
  photos,
}: ReflectionScenesProps): ReactElement | null {
  if (scenes.length === 0) return null;
  return (
    <View testID="reflection-daily-scenes" className="w-full gap-md">
      {scenes.map((scene, i) => {
        const uri = slotUri(scene, date, photos);
        return (
          <View key={i} className="w-full gap-sm">
            {uri ? (
              <Image
                source={{ uri }}
                className="h-[200px] w-full rounded-card bg-surface-soft"
                contentFit="cover"
                cachePolicy="memory-disk"
              />
            ) : null}
            <Text className="font-noto text-body leading-[22px] text-body">
              {scene.caption}
            </Text>
          </View>
        );
      })}
    </View>
  );
}
