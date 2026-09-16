import type { ReactElement } from 'react';
import { useState } from 'react';
import { View } from 'react-native';

import { MapView } from './MapView';
import type { MapCenter } from './MapView';

/**
 * 중앙 고정 핀 좌표 선택기(TRIP-866 S4). 핀은 화면 한가운데 붙박이고, 사용자가 *지도를 움직여*
 * 원하는 곳을 핀 아래로 가져온다(핀을 끌지 않는다). 지도가 멈추면(카메라 idle) 그때의 중심
 * 좌표가 `onPick({lat,lng})` 으로 올라간다 — 옛 "지도를 길게 눌러 찍기"의 대체.
 *
 * ★ 제어형 camera 되먹임 함정: onPick 좌표가 부모를 거쳐 다시 `center` 로 돌아오면, 제어형
 * camera 가 방금 사용자가 민 지도를 원위치로 되돌린다(pan 이 씹힌다). 그래서 마운트 시점의
 * center 를 `initialCenter` 로 **한 번만 포획**하고, 이후 center prop 변경은 무시한다 — 지도로
 * 흘리는 좌표는 초기값 하나뿐이라 사용자의 pan 이 되돌려지지 않는다.
 *
 * 핀 오버레이는 지도의 자식이되 `pointerEvents="none"` 이라 지도 제스처를 그대로 통과시킨다
 * (네이티브 지도 뷰는 터치를 흡수하지 않으므로 형제가 아니어도 안전 — WebView 오버레이 함정과
 * 다르다).
 */
export interface CenterPinPickerProps {
  center: MapCenter;
  onPick: (center: MapCenter) => void;
}

export function CenterPinPicker({
  center,
  onPick,
}: CenterPinPickerProps): ReactElement {
  const [initialCenter] = useState(center);

  return (
    <View testID="center-pin-picker" className="flex-1">
      <MapView center={initialCenter} onCameraIdle={onPick} />
      <View
        testID="map-center-pin"
        pointerEvents="none"
        className="absolute inset-0 items-center justify-center"
      >
        <View className="h-4 w-4 rounded-full border-2 border-canvas bg-primary" />
      </View>
    </View>
  );
}
