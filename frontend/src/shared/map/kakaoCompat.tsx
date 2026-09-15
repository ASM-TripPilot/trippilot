import type { ReactElement } from 'react';

import { MapView } from './MapView';
import type { MapCenter, MapPin } from './MapView';

/**
 * 임시 카카오 호환 별칭(TRIP-863 S1 — S3 소비처 전환·S5 최종 삭제 대상).
 *
 * 코어를 네이버 `MapView`로 교체했지만 소비처 12파일은 이 칸에서 건드리지 않는다(S3). 그
 * 파일들이 아직 `KakaoMapView`·구 prop 표면(`onMapMessage`)·`KakaoMapMessage` 타입을 물고
 * 있으므로, 빌드를 유지하려면 그 표면을 이 어댑터가 계속 제공해야 한다. 여기서 하는 일은
 * 구 표면을 새 `MapView` prop 으로 번역하는 것뿐이다.
 */

/**
 * RN↔지도 메시지 프로토콜(카카오 WebView 시절 계약 계승). 네이티브 지도엔 롱프레스가 없어
 * 실제로 올라오는 종류는 `PIN_TAP` 뿐이지만, 소비처(StayRegister·Timeline)가 아직 다른
 * 멤버를 `switch` 로 다루므로 유니온 전체를 유지한다 — S3/S5 에서 함께 정리한다.
 */
export type KakaoMapMessage =
  | { type: 'PIN_DROP'; lat: number; lng: number }
  | { type: 'GEOCODE_OK'; address: string; buildingName?: string }
  | { type: 'GEOCODE_FAIL' }
  | { type: 'PIN_TAP'; index: number };

export interface KakaoMapViewProps {
  center: MapCenter;
  pins?: MapPin[];
  viewOnly?: boolean;
  connectPins?: boolean;
  onMapMessage?: (message: KakaoMapMessage) => void;
  onLoadFailed?: () => void;
  maxLevel?: number;
}

export function KakaoMapView({
  center,
  pins,
  viewOnly,
  connectPins,
  onMapMessage,
  onLoadFailed,
  maxLevel,
}: KakaoMapViewProps): ReactElement {
  return (
    <MapView
      center={center}
      pins={pins}
      viewOnly={viewOnly}
      connectPins={connectPins}
      onLoadFailed={onLoadFailed}
      maxLevel={maxLevel}
      // PIN_TAP 만 새 `onPinTap` 으로 브리지한다. PIN_DROP/GEOCODE 는 네이티브에 롱프레스가
      // 없어 발생 자체가 없다(S4 중앙 고정 핀이 좌표 확정을 대체). 소비처 테스트는
      // `@/shared/map` 을 목으로 치환하므로 이 no-op 은 런타임에 무영향이다.
      onPinTap={
        onMapMessage !== undefined
          ? (index) => onMapMessage({ type: 'PIN_TAP', index })
          : undefined
      }
    />
  );
}
