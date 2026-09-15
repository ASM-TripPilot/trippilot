import type { ReactElement } from 'react';
import { useEffect, useRef } from 'react';
import { Text, View } from 'react-native';
import {
  NaverMapView,
  NaverMapMarkerOverlay,
  NaverMapPathOverlay,
} from '@mj-studio/react-native-naver-map';

/**
 * 공급자 중립 지도 래퍼(TRIP-863 S1). 카카오 WebView 브리지를 네이버 네이티브 지도로
 * 교체한 코어다 — 화면·소비처는 이 컴포넌트(또는 임시 별칭 `KakaoMapView`)만 쓰고
 * 지도 공급자를 모른다.
 *
 * 왜 네이티브인가 — 카카오 시절 제스처 잠금(viewOnly)·핀 배선은 WebView 대본 **문자열**
 * 안에 있어 jest 가 원리적으로 못 봤다(자동 심판 부재). 네이버는 4개의 불리언 prop 과
 * 오버레이 컴포넌트로 바뀌어, 목이 그 prop 을 그대로 노출하면 jest 가 제스처 4토글·마커
 * 수·경로선 유무·핀 탭을 렌더 트리에서 직접 관측한다.
 */

/** 지도 중심 좌표. 리포 전체 `{lat,lng}` 순서(네이버 SDK 의 `{latitude,longitude}` 와 다름). */
export interface MapCenter {
  lat: number;
  lng: number;
}

/**
 * 번호가 붙은 지도 핀(카카오 시절 계약 계승). `number` 는 지도가 정하지 않는다 — 호출부가
 * 만든 값을 그대로 그린다(좌표 없는 슬롯을 건너뛴 뒤에도 카드 번호를 유지해야 해 핀 번호가
 * ①③④처럼 뛴다).
 */
export interface MapPin {
  number: number;
  lat: number;
  lng: number;
}

export interface MapViewProps {
  center: MapCenter;
  /** 번호 마커. 미전달이면 마커·경로선 없이 빈 지도. */
  pins?: MapPin[];
  /** 보여주기 전용 지도. true 면 사용자 제스처 4종(스크롤·줌·회전·기울임)을 모두 끈다.
   * 기본값(미전달)은 조작 가능 — 지도를 움직여 좌표를 확정하는 화면이 조용히 잠기면 안 된다. */
  viewOnly?: boolean;
  /** 핀을 번호 순서대로 잇는 경로선. 기본 `true`라 **끄는 쪽이 명시한다** — "담은 순서"일 뿐인
   * 화면(h05)이 아직 정해지지 않은 동선을 선으로 그리면 안 되기 때문. */
  connectPins?: boolean;
  /** 마커 탭. `index`는 `pins` 배열의 0-기반 위치다(결번이 있어도 배열 기준이라 안전). */
  onPinTap?: (index: number) => void;
  /** 로드 실패를 부모에 위임(INV-4). S1 에서는 클라이언트 ID 부재가 유일한 실패 트리거다. */
  onLoadFailed?: () => void;
  /** 카카오 `maxLevel`(줌아웃 상한) → 네이버 `minZoom`(줌아웃 하한)으로 변환. 넘길 때만 전달. */
  maxLevel?: number;
}

/** 네이버 초기 줌. ponytail: 카카오 기본 level 3 에 대응하는 대략값, 정확 캘리브레이션은 실기(6-b). */
const INITIAL_ZOOM = 14;

/**
 * 카카오 level(값이 클수록 축소) ↔ 네이버 zoom(값이 클수록 확대)은 축이 반대다. 카카오의
 * 줌아웃 상한(`maxLevel`)은 네이버의 줌아웃 하한(`minZoom`)에 해당한다.
 *
 *   카카오 level |  1   3   5   7
 *   네이버 zoom  | 19  17  15  13   (대략 20 - level)
 *
 * ponytail: 정확한 대응값은 실기에서 맞춘다(6-b 조정 knob). 테스트는 minZoom 전달 여부만 본다.
 */
const NAVER_ZOOM_BASELINE = 20;
function kakaoMaxLevelToNaverMinZoom(maxLevel: number): number {
  return NAVER_ZOOM_BASELINE - maxLevel;
}

export function MapView({
  center,
  pins,
  viewOnly,
  connectPins,
  onPinTap,
  onLoadFailed,
  maxLevel,
}: MapViewProps): ReactElement {
  // 네이티브 SDK 는 런타임 키를 config plugin 에서 받으므로, 이 env 판정은 "설정 누락 표면"용이다
  // (키가 없으면 회색 빈 지도 대신 안내 화면을 띄운다). 참조는 이 한 곳뿐(A-2 계승).
  const clientId = process.env.EXPO_PUBLIC_NAVER_MAP_CLIENT_ID;
  const hasKey = Boolean(clientId);

  // 실패를 부모에 위임한다(INV-4). 렌더 중 부수효과는 금지라 effect 로 감지하고, ref 로 1회만
  // 알린다 — 부모가 재렌더로 새 콜백을 넘겨도 같은 실패를 두 번 통지하지 않는다.
  const notifiedRef = useRef(false);
  useEffect(() => {
    if (!hasKey && !notifiedRef.current) {
      notifiedRef.current = true;
      onLoadFailed?.();
    }
  }, [hasKey, onLoadFailed]);

  if (!hasKey) {
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

  const showPath =
    connectPins !== false && pins !== undefined && pins.length >= 2;

  return (
    <View testID="map-root" className="flex-1">
      <NaverMapView
        style={{ flex: 1 }}
        initialCamera={{
          latitude: center.lat,
          longitude: center.lng,
          zoom: INITIAL_ZOOM,
        }}
        isScrollGesturesEnabled={!viewOnly}
        isZoomGesturesEnabled={!viewOnly}
        isRotateGesturesEnabled={!viewOnly}
        isTiltGesturesEnabled={!viewOnly}
        {...(maxLevel !== undefined
          ? { minZoom: kakaoMaxLevelToNaverMinZoom(maxLevel) }
          : {})}
      >
        {pins?.map((pin, index) => (
          <NaverMapMarkerOverlay
            key={pin.number}
            latitude={pin.lat}
            longitude={pin.lng}
            caption={{ text: String(pin.number) }}
            onTap={() => onPinTap?.(index)}
          />
        ))}
        {showPath ? (
          <NaverMapPathOverlay
            coords={pins.map((pin) => ({
              latitude: pin.lat,
              longitude: pin.lng,
            }))}
          />
        ) : null}
      </NaverMapView>
    </View>
  );
}
