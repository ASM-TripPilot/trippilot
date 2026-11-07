import { useRef, type ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Button } from '@/shared/ui/Button';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CenterPinPicker, type MapCenter } from '@/shared/map';

/**
 * TRIP-1669 · 같이 짜기 '지도에서 찍기' 선택 화면 — 지도를 움직여 가운데 핀을 맞추고 [여기로 찾기]로 확정한다.
 * `CenterPinPicker` 는 카메라가 멈출 때마다 좌표를 올리므로(`onPick`) 그 값은 ref 에만 쥐고, **확정 버튼을 눌러야**
 * 부모가 요청을 보낸다(취소하면 아무 일도 없다). 한 번도 안 움직이고 확정하면 처음 보여 준 `center` 를 쓴다.
 *
 * 부모(`SlotFillPage`)가 `{open ? <CenterPointPicker/> : null}` 로 후보 화면 위에 조건부 렌더하는 `absolute inset-0`
 * 오버레이다(`CoPickLeaveDialog` 선례) — 지도 위에 덮이는지·터치가 아래로 새지 않는지는 jest 원리적 사각이라
 * 6-b 실기 몫이다. 문구·치수는 Figma 프레임이 없어 이 사이클이 정한 발명값이다.
 */
export function CenterPointPicker({
  center,
  onConfirm,
  onCancel,
}: {
  center: MapCenter;
  onConfirm: (picked: MapCenter) => void;
  onCancel: () => void;
}): ReactElement {
  const picked = useRef<MapCenter>(center);

  return (
    <View
      testID="itinerary-copick-center-point"
      className="absolute inset-0 bg-canvas"
    >
      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
        <View className="w-full gap-xs px-lg pb-sm pt-lg">
          <Text className="font-noto-bold text-[18px] font-bold text-ink">
            지도에서 찍기
          </Text>
          <Text className="font-noto text-caption text-muted">
            지도를 움직여 핀을 원하는 위치에 맞춰 주세요
          </Text>
        </View>
        <View className="flex-1">
          <CenterPinPicker
            center={center}
            onPick={(next) => {
              picked.current = next;
            }}
          />
        </View>
        <View className="w-full flex-row items-center gap-sm px-lg pb-lg pt-sm">
          <Pressable
            testID="itinerary-copick-center-point-cancel"
            accessibilityRole="button"
            onPress={onCancel}
            className="h-12 items-center justify-center rounded-button border border-primary px-md"
          >
            <Text className="font-noto-bold text-label font-bold text-primary-text">
              취소
            </Text>
          </Pressable>
          <Button
            testID="itinerary-copick-center-point-confirm"
            size="md"
            onPress={() => onConfirm(picked.current)}
            className="flex-1"
          >
            여기로 찾기
          </Button>
        </View>
      </SafeAreaView>
    </View>
  );
}
