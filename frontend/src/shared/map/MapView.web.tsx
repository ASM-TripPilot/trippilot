import type { ReactElement } from 'react';
import { memo, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

// 값 import 금지 — Metro 웹에서 './MapView' 는 이 파일 자신이다(순환). 타입만 가져온다.
import type { MapViewProps } from './MapView';
import { MapFailure } from './MapFailure';
import { getNaverMapsLoader } from './naverMapsLoader';
import type { NaverMapsApi } from './naverMapsLoader';
import { createWebMapController } from './webMapController';
import type { WebMapController } from './webMapController';

/**
 * 웹 지도(네이버 지도 JS v3). Metro 가 웹에서 `./MapView` 를 이 파일로 고른다 — 네이티브 SDK(`@mj-studio/…`)를
 * 웹 번들에 싣지 않는다. 이번 범위는 표시·카메라·번호 마커·탭·영역 맞춤·실패 표면이고, 경로선·내 위치·카메라 콜백
 * (`connectPins`·`drawPathOnMount`·`actualRoute`·`onCameraIdle`·`onTapMap`·`showMyLocation` 등)은 받아서 무시한다.
 */
function MapViewImpl({
  center,
  pins,
  viewOnly,
  onPinTap,
  onLoadFailed,
  radiusCircle,
  fitPins,
  fitBand,
}: MapViewProps): ReactElement {
  const clientId = process.env.EXPO_PUBLIC_NAVER_MAP_CLIENT_ID;
  const hasKey = Boolean(clientId);
  const [naver, setNaver] = useState<NaverMapsApi | null>(null);
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const failed = !hasKey || loadFailed;

  // 실패 통지는 1회 — 부모가 새 콜백을 넘기거나 실패 두 종류가 겹쳐도 다시 부르지 않는다(네이티브와 같은 규칙).
  const notifiedRef = useRef(false);
  useEffect(() => {
    if (failed && !notifiedRef.current) {
      notifiedRef.current = true;
      onLoadFailed?.();
    }
  }, [failed, onLoadFailed]);

  useEffect(() => {
    if (!hasKey) return;
    let alive = true;
    const loader = getNaverMapsLoader();
    const unsubscribe = loader.onAuthFailure(() => {
      if (alive) setLoadFailed(true);
    });
    loader.load(clientId).then(
      (api) => {
        if (alive) setNaver(api);
      },
      () => {
        if (alive) setLoadFailed(true);
      }
    );
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [hasKey, clientId]);

  const onPinTapRef = useRef(onPinTap);
  useEffect(() => {
    onPinTapRef.current = onPinTap;
  });
  // 실패로 돌아선 뒤엔 컨트롤러가 cleanup 으로 정리되기 전이라도 망가진 지도에 닿지 않게 한다(refit 용).
  const failedRef = useRef(failed);
  useEffect(() => {
    failedRef.current = failed;
  });

  const controllerRef = useRef<WebMapController | null>(null);
  useEffect(() => {
    if (naver === null || element === null) return;
    const controller = createWebMapController({
      naver,
      element,
      onPinTap: (index) => onPinTapRef.current?.(index),
    });
    controllerRef.current = controller;
    // 컨테이너 크기가 잡히거나 바뀌면 지도 크기를 다시 재고 재맞춤한다(첫 관측은 생성 직후 한 번 불린다).
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            if (!failedRef.current) controller.refit();
          });
    observer?.observe(element);
    return () => {
      observer?.disconnect();
      controller.destroy();
      controllerRef.current = null;
    };
  }, [naver, element]);

  // 컨트롤러가 입력을 값으로 비교하므로 렌더마다 불러도 바뀐 것만 지도에 닿는다. 생성 effect 뒤에 선언해야 한다.
  useEffect(() => {
    if (failed) return;
    controllerRef.current?.update({
      center,
      pins,
      viewOnly,
      fitPins,
      fitBand,
      radiusCircle,
    });
  });

  if (failed) return <MapFailure />;

  return (
    <View
      testID="map-root"
      className="flex-1"
      style={{ position: 'relative', zIndex: 0 }}
    >
      <div
        ref={setElement}
        style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}
      />
    </View>
  );
}

export const MapView = memo(MapViewImpl);
