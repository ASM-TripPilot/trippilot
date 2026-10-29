import {
  WEB_INITIAL_ZOOM,
  buildMapOptions,
  regionToCorners,
} from './webMapOptions';

/**
 * TRIP-1651 (W5) — 네이티브 `Region`(남서 모서리 + 폭)을 네이버 JS 의 `LatLngBounds`(남서·북동 두 점)
 * 재료로 바꾸는 순수 함수와, viewOnly 를 네이버 지도 옵션으로 옮기는 빌더. AC-6·AC-7.
 *
 * 초심자용 — 네이티브 SDK 는 "남서 모서리 + 위도·경도 폭"을 주고, 웹 지도는 "남서 점 + 북동 점"을
 * 받는다. 같은 영역을 표현만 바꾸는 계산이라 값으로 직접 단언한다(prop 전달을 보는 게 아니다).
 */

describe('AC-6 — regionToCorners', () => {
  it('남서 = (latitude, longitude), 북동 = 남서 + 폭(위도·경도를 서로 바꾸지 않는다)', () => {
    // lat≠lng 라 축을 뒤바꾸면 red.
    const corners = regionToCorners({
      latitude: 33.5,
      longitude: 126.5,
      latitudeDelta: 0.25,
      longitudeDelta: 0.5,
    });

    expect(corners.sw).toEqual({ lat: 33.5, lng: 126.5 });
    expect(corners.ne.lat).toBeCloseTo(33.75, 9);
    expect(corners.ne.lng).toBeCloseTo(127, 9);
  });

  it('WEB_INITIAL_ZOOM 은 14(네이티브 INITIAL_ZOOM 과 같은 값)', () => {
    expect(WEB_INITIAL_ZOOM).toBe(14);
  });
});

describe('AC-7 — buildMapOptions: viewOnly 는 드래그·핀치·휠·키보드 단축키를 끈다', () => {
  it('viewOnly → 네 가지가 모두 false', () => {
    expect(buildMapOptions({ viewOnly: true })).toMatchObject({
      draggable: false,
      pinchZoom: false,
      scrollWheel: false,
      keyboardShortcuts: false,
    });
  });

  it.each([[{}], [{ viewOnly: false }]])(
    '미전달·false(%p) → 네 가지가 모두 true(네이티브 기본과 같다)',
    (input) => {
      expect(buildMapOptions(input)).toMatchObject({
        draggable: true,
        pinchZoom: true,
        scrollWheel: true,
        keyboardShortcuts: true,
      });
    }
  );
});
