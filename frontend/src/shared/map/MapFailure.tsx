import type { ReactElement } from 'react';
import { Text, View } from 'react-native';

/** 지도를 못 그릴 때(키 부재·스크립트 실패·인증 실패) 네이티브·웹이 같이 보여 주는 안내 표면(INV-4). */
export function MapFailure(): ReactElement {
  return (
    <View testID="map-root" className="flex-1">
      <View
        testID="map-failure"
        className="flex-1 items-center justify-center bg-canvas px-2xl"
      >
        <Text
          testID="map-failure-message"
          className="font-noto text-body text-muted text-center"
        >
          지도를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.
        </Text>
      </View>
    </View>
  );
}
