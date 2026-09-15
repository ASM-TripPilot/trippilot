import type { ReactElement } from 'react';
import { useEffect, useMemo, useRef } from 'react';
import { Text, View } from 'react-native';
import Svg, { Circle, Text as SvgText } from 'react-native-svg';
import {
  NaverMapView,
  NaverMapMarkerOverlay,
  NaverMapPathOverlay,
} from '@mj-studio/react-native-naver-map';

/**
 * 공급자 중립 지도 래퍼(TRIP-863 S1). 카카오 WebView 브리지를 네이버 네이티브 지도로
 * 교체한 코어다 — 화면·소비처는 이 컴포넌트만 쓰고 지도 공급자를 모른다.
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
  /** 지도가 움직이다 멈추면(카메라 idle) 그때의 중심 좌표를 올린다(TRIP-866 S4). 네이버가 주는
   * `{latitude,longitude}`를 리포 순서 `{lat,lng}`로 감싼다. `maxLevel↔minZoom`과 같은 옵트인 —
   * 프롭을 준 때만 NaverMapView 에 콜백을 단다(미전달 시 콜백 부착 0). */
  onCameraIdle?: (center: MapCenter) => void;
}

/** 네이버 초기 줌. ponytail: 카카오 기본 level 3 에 대응하는 대략값, 정확 캘리브레이션은 실기(6-b). */
const INITIAL_ZOOM = 14;

/** 핀 컨테이너·라벨 스타일 — 마커 래스터에서 안전하게 렌더되도록 전부 인라인으로 지정한다.
 * NativeWind className(bg-primary·border-canvas·rounded-full)은 네이버 SDK 가 자식 뷰를 화면 밖
 * 에서 마커 이미지로 스냅샷할 때 적용이 보장되지 않아, 배경이 빠진 투명/기본 마커로 나온다(6-b
 * 실측 — 초록 링·흰 실루엣). 색은 tailwind 팔레트값 그대로(primary #FF385C · canvas #FFFFFF)라
 * 팔레트-부분집합 가드를 지킨다 — 인라인이라 리터럴로 둔다(shared/map className 미적용 회피). */
/** 핀 래스터용 래퍼 치수 — 네이버 마커 width/height 와 일치(28). */
const PIN_WRAP_STYLE = { width: 28, height: 28 } as const;
/** 핀 색·치수(SVG). 색은 tailwind 팔레트값(primary #FF385C · canvas #FFFFFF)이라 팔레트-부분집합
 * 가드를 지킨다. 번호 baseline y=18.5 는 14(중심)+대략 cap-height 절반 오프셋으로 세로 중앙. */
const PIN_FILL = '#FF385C';
const PIN_STROKE = '#FFFFFF';

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
  onCameraIdle,
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

  // 제어형 `camera` 를 쓴다(`initialCamera` 아님). initialCamera 는 SDK 가 "마운트 후 변경해도
  // 동작 안 함"이라, 소비처가 카카오 시절 key=remount 로 하던 재중심을 S3 에서 걷어낸 지금
  // center 가 바뀌어도 카메라가 첫 좌표에 얼어붙는다(code-critic 경고-1). 값으로 memo 해
  // center 가 실제로 바뀔 때만 새 객체 → 그때만 재중심하고, 안정적인 center 에선 같은 객체라
  // 사용자 제스처를 매 렌더 되돌리지 않는다.
  // ⚠️ 훅은 조기 반환(!hasKey) 위에 둔다 — 아래로 내리면 조건부 호출이 돼 rules-of-hooks 위반.
  const camera = useMemo(
    () => ({ latitude: center.lat, longitude: center.lng, zoom: INITIAL_ZOOM }),
    [center.lat, center.lng]
  );

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
        camera={camera}
        isScrollGesturesEnabled={!viewOnly}
        isZoomGesturesEnabled={!viewOnly}
        isRotateGesturesEnabled={!viewOnly}
        isTiltGesturesEnabled={!viewOnly}
        {...(maxLevel !== undefined
          ? { minZoom: kakaoMaxLevelToNaverMinZoom(maxLevel) }
          : {})}
        onCameraIdle={
          onCameraIdle
            ? (params) =>
                onCameraIdle({ lat: params.latitude, lng: params.longitude })
            : undefined
        }
      >
        {pins?.map((pin, index) => (
          // 기본 마커(네이버 초록)를 쓰지 않고 children 커스텀 뷰로 분홍 번호 핀을 그린다
          // (TRIP-876, 카카오 시절 디자인 복원). anchor {x:0.5,y:1} 로 핀 아래 꼭짓점이 좌표를
          // 가리킨다. 스타일은 PIN_CONTAINER_STYLE/PIN_LABEL_STYLE 인라인(className 미적용 회피).
          <NaverMapMarkerOverlay
            key={pin.number}
            latitude={pin.lat}
            longitude={pin.lng}
            anchor={{ x: 0.5, y: 1 }}
            width={28}
            height={28}
            onTap={() => onPinTap?.(index)}
          >
            {/* collapsable={false} 는 New Architecture(iOS) 에서 커스텀 뷰 마커가 래스터되기 위한
              필수 조건 — 없으면 RN 이 뷰를 평탄화(view flattening)해 네이티브가 못 찾고 기본
              초록 심볼/흰 실루엣으로 나온다(6-b 실측, 라이브러리 문서 "Custom React View" 항).
              생김새 의존성(번호)은 최상위 자식 key 로 넘긴다. 원·번호는 SVG 로 그린다 — RN <Text>
              글리프는 iOS 가 마커를 UIImage 로 스냅샷하는 시점에 안 그려졌다(6-b 실측: 분홍 원은
              뜨는데 번호만 비었다). SVG 는 한 레이어에 동기 렌더돼 스냅샷에 온전히 잡힌다(*Glyphs 관례). */}
            <View
              key={`pin-${pin.number}`}
              collapsable={false}
              testID={`map-marker-pin-${pin.number}`}
              style={PIN_WRAP_STYLE}
            >
              <Svg width={28} height={28} viewBox="0 0 28 28">
                <Circle
                  cx={14}
                  cy={14}
                  r={12}
                  fill={PIN_FILL}
                  stroke={PIN_STROKE}
                  strokeWidth={2}
                />
                <SvgText
                  x={14}
                  y={18.5}
                  fill={PIN_STROKE}
                  fontSize={13}
                  fontWeight="bold"
                  textAnchor="middle"
                >
                  {pin.number}
                </SvgText>
              </Svg>
            </View>
          </NaverMapMarkerOverlay>
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
