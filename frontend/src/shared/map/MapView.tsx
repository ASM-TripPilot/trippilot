import type { ReactElement } from 'react';
import { useEffect, useMemo, useRef } from 'react';
import type { ImageSourcePropType } from 'react-native';
import { StyleSheet, Text, View } from 'react-native';
import Svg, {
  Circle,
  ClipPath,
  Defs,
  Image as SvgImage,
  Path,
  Rect,
  Text as SvgText,
} from 'react-native-svg';
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
 * 핀 3상태(TRIP-745). 도메인 무관 일반 이름이다 — 슬롯·방문기록 어휘(`active`)가 아니라 지도가
 * 그리는 세 얼굴(`done`=완료·초록 체크 / `current`=진행중·분홍 / `upcoming`=예정·흰 회색테두리).
 * 어휘 변환은 소비처(`entities/itinerary-slot/lib/slotMapPin`)가 진다.
 */
export type MapPinState = 'done' | 'current' | 'upcoming';

/**
 * 기록 도메인 마커족(TRIP-768). `state`(진행 축)와 **직교**인 별개 축이다 — j 밴드 기록·회고 지도가
 * 쓴다. `visited`=사진 썸네일+번호 배지, `planned`=회색 점선 원+회색 번호, `stay`=빨강 마커+흰 침대
 * (번호 없음). `kind` 미전달이면 이 마커족을 안 그리고 현행 `state` 물방울로 폴백한다(무회귀).
 */
export type MapPinKind = 'visited' | 'planned' | 'stay';

/**
 * 번호가 붙은 지도 핀(카카오 시절 계약 계승). `number` 는 지도가 정하지 않는다 — 호출부가
 * 만든 값을 그대로 그린다(좌표 없는 슬롯을 건너뛴 뒤에도 카드 번호를 유지해야 해 핀 번호가
 * ①③④처럼 뛴다). `state` 는 **옵셔널 additive** — 미전달이면 기존 분홍 핀(번호 있음) 거동 유지라
 * 현행 소비처가 무회귀로 그대로 돈다.
 *
 * `imageUrl`·`kind` 도 옵셔널 additive(TRIP-768) — 기록 마커족 축이다. 둘 다 미전달이면 위 `state`
 * 물방울 거동이 그대로라 h·i 밴드 현행 호출부는 건드리지 않는다. `imageUrl` 은 `visited` 에서만
 * 의미가 있고 번들 `require`(number source)를 받는다 — SVG `<Image href>` 로 넘겨 iOS 마커 래스터에
 * 안전하게 찍는다(원격 URL 배선은 TRIP-634 밖).
 */
export interface MapPin {
  number: number;
  lat: number;
  lng: number;
  state?: MapPinState;
  imageUrl?: ImageSourcePropType;
  kind?: MapPinKind;
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
  /** 현재위치 점(TRIP-745). 좌표를 주면 파란 점+반투명 링+"현재 위치" 라벨을 별도 마커로 얹는다.
   * 미전달이면 그 마커를 렌더하지 않는다(항상-렌더 회귀 방지). 핀 index 를 오염시키지 않도록
   * `onPinTap` 을 달지 않는 별도 마커다. */
  currentLocation?: MapCenter;
  /** +/− 줌 컨트롤(우상단)을 켠다(TRIP-768, 기록·회고 지도). **옵트인** — 미전달이면 명시적으로
   * 끈다(네이버 SDK native default 가 `true` 라 안 넘기면 저절로 뜬다). `viewOnly`(제스처)와 **독립**:
   * 제스처를 잠근 지도에도 줌 버튼은 켤 수 있고, 기존 viewOnly 지도(h05·h07)에 저절로 생기지 않는다. */
  showZoomControls?: boolean;
  /** 축척 바("1km", 우하단)를 켠다(TRIP-768). `showZoomControls` 와 같은 옵트인·독립 규칙. 거리
   * 표기라 INV-3(소요시간 금지)과 무관하다. */
  showScaleBar?: boolean;
}

/** 네이버 초기 줌. ponytail: 카카오 기본 level 3 에 대응하는 대략값, 정확 캘리브레이션은 실기(6-b). */
const INITIAL_ZOOM = 14;

/** 색·모양은 마커 래스터에서 안전하게 잡히도록 전부 SVG 로 그린다 — NativeWind className 은 네이버
 * SDK 가 자식 뷰를 화면 밖에서 마커 이미지로 스냅샷할 때 적용이 보장되지 않고(초록 링·흰 실루엣),
 * SVG stroke/fill 은 애초에 className 을 못 받는다(shared/map 관례). 색은 tailwind 팔레트 raw hex —
 * S7 팔레트 부분집합 가드는 TRIP-864 로 삭제됐고 재도입하지 않았다(TRIP-745 Q3). */
const PIN_PRIMARY = '#FF385C'; // primary — current·기본 물방울
const PIN_SUCCESS = '#0E9384'; // success — done 물방울
const PIN_MUTED_SOFT = '#9AA1AB'; // muted-soft — upcoming 테두리·번호
const PIN_LINK = '#1659C9'; // link — 현재위치 점·링·라벨
const PIN_WHITE = '#FFFFFF'; // on-primary·canvas — 흰 테두리·흰 번호·흰 체크

/** Figma 4125:3958 물방울 벡터 1:1. 큰 것(current·기본)은 35×45.5, 작은 것(upcoming·done)은 28×36. */
const TEARDROP_LARGE =
  'M17.5 1.25C8.5 1.25 1.25 8.125 1.25 16.875C1.25 27.5 17.5 43.75 17.5 43.75C17.5 43.75 33.75 27.5 33.75 16.875C33.75 8.125 26.5 1.25 17.5 1.25Z';
const TEARDROP_SMALL =
  'M14 1C6.8 1 1 6.5 1 13.5C1 22 14 35 14 35C14 35 27 22 27 13.5C27 6.5 21.2 1 14 1Z';
/** done 흰 체크(✓). Figma imgStateDone 의 벡터. */
const DONE_CHECK = 'M9.3 13.8L12.4 16.9L18.4 10.2';

/**
 * 물방울 핀 한 개(상태별). current·기본 = 분홍 채움 + 흰 번호, upcoming = 흰 채움 + 회색 테두리·회색
 * 번호, done = 초록 채움 + 흰 체크(번호 없음). 번호·체크는 전부 SVG 여야 iOS 마커 래스터(UIImage
 * 스냅샷)에 찍힌다(RN <Text> 는 안 찍힘, TRIP-876 실측). done 체크에는 testID `map-marker-check-{n}`
 * 를 붙여 text 가 아닌 SVG Path 를 식별한다(다른 상태엔 없음).
 */
function PinTeardrop({
  state,
  number,
}: {
  state: MapPinState;
  number: number;
}): ReactElement {
  if (state === 'done') {
    // 체크는 초록 물방울 위에 겹치는 **별도 <Svg>** 로 그린다. testID 를 Svg 호스트(RNSVGSvgView)에
    // 얹어야 stroke 가 원문 '#FFFFFF' 문자열로 남는다 — shape 호스트(RNSVGPath)는 색을 정수로 가공해
    // 문자열이 사라진다(스파이크 실측). 흰 체크 색은 이 Svg 의 stroke 를 자식 Path 가 상속해 그린다
    // (그 색이 곧 testID 노드가 노출하는 stroke prop 이다 — 표식과 픽셀이 같은 값).
    return (
      <>
        <Svg
          width={28}
          height={36}
          viewBox="0 0 28 36"
          style={StyleSheet.absoluteFill}
        >
          <Path
            d={TEARDROP_SMALL}
            fill={PIN_SUCCESS}
            stroke={PIN_WHITE}
            strokeWidth={2}
          />
        </Svg>
        <Svg
          testID={`map-marker-check-${number}`}
          stroke={PIN_WHITE}
          width={28}
          height={36}
          viewBox="0 0 28 36"
          style={StyleSheet.absoluteFill}
        >
          <Path
            d={DONE_CHECK}
            fill="none"
            strokeWidth={2.4}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
      </>
    );
  }
  if (state === 'upcoming') {
    return (
      <Svg width={28} height={36} viewBox="0 0 28 36.4142">
        <Path
          d={TEARDROP_SMALL}
          fill={PIN_WHITE}
          stroke={PIN_MUTED_SOFT}
          strokeWidth={2}
        />
        <SvgText
          x={14}
          y={18}
          fill={PIN_MUTED_SOFT}
          fontSize={13}
          fontWeight="bold"
          textAnchor="middle"
        >
          {number}
        </SvgText>
      </Svg>
    );
  }
  // current(진행중) · state 미전달(기본) — 분홍 물방울 + 흰 번호. baseline y≈22 는 머리 중심(≈16.9)에
  // cap-height 절반을 더한 값(6-b 실기 조정 knob).
  return (
    <Svg width={35} height={45.5} viewBox="0 0 35 45.5178">
      <Path
        d={TEARDROP_LARGE}
        fill={PIN_PRIMARY}
        stroke={PIN_WHITE}
        strokeWidth={2.5}
      />
      <SvgText
        x={17.5}
        y={22}
        fill={PIN_WHITE}
        fontSize={15}
        fontWeight="bold"
        textAnchor="middle"
      >
        {number}
      </SvgText>
    </Svg>
  );
}

/** stay 마커 몸통 — 아래로 뾰족한 라운드 사각(Figma 1557:1738 침대 마커). 좌표는 아래 꼭짓점(17,39). */
const STAY_PIN =
  'M11 2 H23 A9 9 0 0 1 32 11 V21 A9 9 0 0 1 23 30 H21 L17 39 L13 30 H11 A9 9 0 0 1 2 21 V11 A9 9 0 0 1 11 2 Z';

/** 기록 마커족 치수·앵커(kind 별). 앵커는 좌표가 마커의 어디를 가리키나 — 6-b 조정 knob. */
const RECORD_DIMS: Record<
  MapPinKind,
  { width: number; height: number; anchor: { x: number; y: number } }
> = {
  visited: { width: 48, height: 48, anchor: { x: 0.5, y: 0.5 } },
  planned: { width: 32, height: 32, anchor: { x: 0.5, y: 0.5 } },
  stay: { width: 34, height: 42, anchor: { x: 0.5, y: 1 } },
};

/**
 * 기록 마커족 한 개(TRIP-768). PinTeardrop(state 물방울) 옆 형제 분기다 — `kind` 가 있을 때만 그린다.
 *  · visited: 라운드 사각 사진 썸네일(`<Image href>`, `map-marker-photo-{n}` testID)에 좌상단 빨강 번호 배지.
 *  · planned: 회색 점선 빈 원 + 가운데 회색 번호(채움·사진 없음).
 *  · stay: 빨강 마커 + 흰 침대(`map-marker-stay-{n}` testID). 번호 없음.
 * 번호·글자는 전부 SVG 여야 iOS 마커 래스터(UIImage 스냅샷)에 찍힌다(RN <Text> 미포착, TRIP-876).
 * 사진·침대는 색이 아니라 testID 로 식별한다(SVG shape 색은 마커 스왑에 취약 — 색 토글 거짓통과 함정).
 */
function RecordMarker({
  kind,
  number,
  imageUrl,
}: {
  kind: MapPinKind;
  number: number;
  imageUrl?: ImageSourcePropType;
}): ReactElement {
  if (kind === 'visited') {
    // 사진은 라운드 사각으로 클립한다(clip id 는 핀별 고유). 번호 배지는 사진 좌상단에 겹치는 별도 Svg.
    const clipId = `photo-clip-${number}`;
    return (
      <>
        <Svg
          testID={`map-marker-photo-${number}`}
          width={40}
          height={40}
          viewBox="0 0 40 40"
          style={{ position: 'absolute', top: 8, left: 8 }}
        >
          <Defs>
            <ClipPath id={clipId}>
              <Rect x={0} y={0} width={40} height={40} rx={10} />
            </ClipPath>
          </Defs>
          {imageUrl ? (
            <SvgImage
              href={imageUrl}
              x={0}
              y={0}
              width={40}
              height={40}
              preserveAspectRatio="xMidYMid slice"
              clipPath={`url(#${clipId})`}
            />
          ) : null}
          <Rect
            x={1}
            y={1}
            width={38}
            height={38}
            rx={9}
            fill="none"
            stroke={PIN_WHITE}
            strokeWidth={2}
          />
        </Svg>
        <Svg
          width={22}
          height={22}
          viewBox="0 0 22 22"
          style={{ position: 'absolute', top: 0, left: 0 }}
        >
          <Circle
            cx={11}
            cy={11}
            r={10}
            fill={PIN_PRIMARY}
            stroke={PIN_WHITE}
            strokeWidth={1.5}
          />
          <SvgText
            x={11}
            y={15}
            fill={PIN_WHITE}
            fontSize={12}
            fontWeight="bold"
            textAnchor="middle"
          >
            {number}
          </SvgText>
        </Svg>
      </>
    );
  }
  if (kind === 'planned') {
    // 회색 점선 빈 원 + 가운데 회색 번호. 채움 없음(fill="none") · 빨강/초록 노드 0(스왑 차단).
    return (
      <Svg width={32} height={32} viewBox="0 0 32 32">
        <Circle
          cx={16}
          cy={16}
          r={13}
          fill="none"
          stroke={PIN_MUTED_SOFT}
          strokeWidth={2}
          strokeDasharray="3 3"
        />
        <SvgText
          x={16}
          y={20.5}
          fill={PIN_MUTED_SOFT}
          fontSize={13}
          fontWeight="bold"
          textAnchor="middle"
        >
          {number}
        </SvgText>
      </Svg>
    );
  }
  // stay — 빨강 마커 몸통 + 흰 침대(별도 Svg testID). 번호는 안 그린다.
  return (
    <>
      <Svg
        width={34}
        height={42}
        viewBox="0 0 34 42"
        style={{ position: 'absolute', top: 0, left: 0 }}
      >
        <Path
          d={STAY_PIN}
          fill={PIN_PRIMARY}
          stroke={PIN_WHITE}
          strokeWidth={2}
        />
      </Svg>
      <Svg
        testID={`map-marker-stay-${number}`}
        width={20}
        height={20}
        viewBox="0 0 20 20"
        style={{ position: 'absolute', top: 6, left: 7 }}
      >
        {/* 침대 실루엣(헤드보드·베개·매트리스·다리) — 전부 흰 Rect. */}
        <Rect x={1} y={6} width={2} height={10} rx={1} fill={PIN_WHITE} />
        <Rect x={2} y={11} width={16} height={4.5} rx={2} fill={PIN_WHITE} />
        <Rect x={4.5} y={8} width={4.5} height={3} rx={1.5} fill={PIN_WHITE} />
        <Rect x={2} y={15.5} width={1.8} height={2.5} fill={PIN_WHITE} />
        <Rect x={16.2} y={15.5} width={1.8} height={2.5} fill={PIN_WHITE} />
      </Svg>
    </>
  );
}

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
  currentLocation,
  showZoomControls,
  showScaleBar,
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

  // 연결선은 **방문(visited) 구간만** + **현행 무-kind 호출부 전부** 잇는다(TRIP-768). `kind===undefined`
  // 를 반드시 포함해야 h·i 밴드 물방울 지도(전부 kind 미전달)의 선이 안 지워진다(무회귀). j 밴드는
  // 모든 핀이 kind 를 가지므로 결과는 visited-only 다(planned·stay 는 선 밖).
  const lineCoords = (pins ?? [])
    .filter((pin) => pin.kind === undefined || pin.kind === 'visited')
    .map((pin) => ({ latitude: pin.lat, longitude: pin.lng }));
  const showPath = connectPins !== false && lineCoords.length >= 2;

  return (
    <View testID="map-root" className="flex-1">
      <NaverMapView
        style={{ flex: 1 }}
        camera={camera}
        isScrollGesturesEnabled={!viewOnly}
        isZoomGesturesEnabled={!viewOnly}
        isRotateGesturesEnabled={!viewOnly}
        isTiltGesturesEnabled={!viewOnly}
        // 줌/축척은 명시적으로 내려보낸다(옵트인). SDK native default 가 true 라 안 넘기면(undefined)
        // 저절로 뜨므로, 미전달을 `=== true` 로 눌러 명시적 false 로 "기본 미표시"를 지킨다.
        isShowZoomControls={showZoomControls === true}
        isShowScaleBar={showScaleBar === true}
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
        {pins?.map((pin, index) => {
          // 기록 마커족(kind 축)이 있으면 그것으로, 없으면 현행 state 물방울로 그린다(TRIP-768,
          // 무회귀). 래퍼(map-marker-pin-{n}·collapsable={false})는 두 갈래가 공유한다 — TRIP-876
          // 래스터 필수 조건이고 심판이 이 testID 를 물고 있다.
          if (pin.kind !== undefined) {
            const dims = RECORD_DIMS[pin.kind];
            return (
              <NaverMapMarkerOverlay
                key={pin.number}
                latitude={pin.lat}
                longitude={pin.lng}
                anchor={dims.anchor}
                width={dims.width}
                height={dims.height}
                onTap={() => onPinTap?.(index)}
              >
                <View
                  key={`pin-${pin.number}-${pin.kind}`}
                  collapsable={false}
                  testID={`map-marker-pin-${pin.number}`}
                  style={{
                    width: dims.width,
                    height: dims.height,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <RecordMarker
                    kind={pin.kind}
                    number={pin.number}
                    imageUrl={pin.imageUrl}
                  />
                </View>
              </NaverMapMarkerOverlay>
            );
          }

          // state 미전달이면 'current'(분홍+번호)로 폴백해 기존 거동을 보존한다(옵셔널 additive).
          const pinState = pin.state ?? 'current';
          // current·기본은 큰 물방울(35×45.5), upcoming·done 은 작은 물방울(28×36). 래퍼·마커 치수를
          // 물방울에 맞춰 래스터가 잘리지 않게 한다.
          const isLarge = pinState === 'current';
          const wrapW = isLarge ? 35 : 28;
          const wrapH = isLarge ? 46 : 36;
          return (
            // 기본 마커(네이버 초록)를 쓰지 않고 children 커스텀 뷰로 물방울 번호 핀을 그린다
            // (TRIP-876, 카카오 시절 디자인 복원). anchor {x:0.5,y:1} 로 핀 아래 꼭짓점이 좌표를
            // 가리킨다.
            <NaverMapMarkerOverlay
              key={pin.number}
              latitude={pin.lat}
              longitude={pin.lng}
              anchor={{ x: 0.5, y: 1 }}
              width={wrapW}
              height={wrapH}
              onTap={() => onPinTap?.(index)}
            >
              {/* collapsable={false} 는 New Architecture(iOS) 에서 커스텀 뷰 마커가 래스터되기 위한
                필수 조건 — 없으면 RN 이 뷰를 평탄화(view flattening)해 네이티브가 못 찾고 기본
                초록 심볼/흰 실루엣으로 나온다(6-b 실측, 라이브러리 문서 "Custom React View" 항).
                생김새 의존성(번호·상태)은 최상위 자식 key 로 넘긴다. 물방울·번호·체크는 SVG 로 그린다 —
                RN <Text> 글리프는 iOS 가 마커를 UIImage 로 스냅샷하는 시점에 안 그려졌다(6-b 실측). */}
              <View
                key={`pin-${pin.number}-${pinState}`}
                collapsable={false}
                testID={`map-marker-pin-${pin.number}`}
                style={{ width: wrapW, height: wrapH }}
              >
                <PinTeardrop state={pinState} number={pin.number} />
              </View>
            </NaverMapMarkerOverlay>
          );
        })}
        {currentLocation ? (
          // 현재위치는 핀 index 를 흔들지 않는 별도 마커다 — onTap(→onPinTap) 을 달지 않는다.
          // anchor y 는 하단 점을 좌표에 대략 맞춘다(정확 정렬은 6-b).
          <NaverMapMarkerOverlay
            key="current-location"
            latitude={currentLocation.lat}
            longitude={currentLocation.lng}
            anchor={{ x: 0.5, y: 0.85 }}
            width={72}
            height={70}
          >
            <View
              collapsable={false}
              testID="map-current-location"
              style={{ width: 72, alignItems: 'center' }}
            >
              {/* 라벨 pill(흰 배경+파란 텍스트) — 반드시 SVG(Rect+Text). RN <Text> 는 마커 래스터에
                안 찍힌다(TRIP-876). */}
              <Svg width={72} height={20} viewBox="0 0 72 20">
                <Rect
                  x={0}
                  y={0}
                  width={72}
                  height={20}
                  rx={8}
                  fill={PIN_WHITE}
                />
                <SvgText
                  x={36}
                  y={14}
                  fill={PIN_LINK}
                  fontSize={10.5}
                  textAnchor="middle"
                >
                  현재 위치
                </SvgText>
              </Svg>
              {/* 반투명 링(16%) 뒤 · 불투명 점 앞. */}
              <Svg width={42} height={42} viewBox="0 0 42 42">
                <Circle
                  cx={21}
                  cy={21}
                  r={21}
                  fill={PIN_LINK}
                  fillOpacity={0.16}
                />
                <Circle
                  cx={21}
                  cy={21}
                  r={6.75}
                  fill={PIN_LINK}
                  stroke={PIN_WHITE}
                  strokeWidth={2.5}
                />
              </Svg>
            </View>
          </NaverMapMarkerOverlay>
        ) : null}
        {showPath ? (
          // 경로선 빨강(primary) + 흰 케이싱(Figma 4125:3958 route/route-casing). width 는 6-b 조정.
          // coords 는 visited(+무-kind) 구간만 — planned·stay 는 선에서 빠진다(위 lineCoords).
          <NaverMapPathOverlay
            coords={lineCoords}
            color={PIN_PRIMARY}
            width={2.75}
            outlineColor={PIN_WHITE}
            outlineWidth={1.6}
          />
        ) : null}
      </NaverMapView>
    </View>
  );
}
