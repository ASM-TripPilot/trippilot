import { buildCircleRegion, buildFitRegion } from './fitRegion';
import type { MapPin } from './MapView';
import type { NaverMapsApi } from './naverMapsLoader';
import { createWebMapController } from './webMapController';
import type { WebMapInput } from './webMapController';
import { buildWebMarker } from './webMarkerHtml';
import { regionToCorners } from './webMapOptions';

/**
 * TRIP-1651 (W5) — 웹 지도 컨트롤러: 입력(핀·center·맞춤·원·viewOnly)을 네이버 JS 지도 호출로 옮기는 층.
 * AC-4(마커 배선)·AC-5(탭 index)·AC-6(영역 맞춤)·AC-7(viewOnly 배선).
 *
 * 초심자용 — 진짜 `naver.maps` 는 브라우저에서만 뜬다. 그래서 아래 `makeNaver()` 가 같은 이름의
 * 가짜 클래스(Map·LatLng·LatLngBounds·Point·Marker·Circle·Event)를 만들어 **무엇이 만들어지고
 * 호출됐는지 기록**한다. 테스트는 (준비) 가짜를 꽂아 컨트롤러를 만들고 → (실행) `update` 로 입력을 주고
 * → (단언) 기록된 값이 요구 동작인지 본다. "호출됐다"가 아니라 **값**(좌표 순서·클릭 index·모서리 숫자)을 본다.
 */

class FakeLatLng {
  constructor(
    public latValue: number,
    public lngValue: number
  ) {}
}
class FakePoint {
  constructor(
    public x: number,
    public y: number
  ) {}
}
class FakeBounds {
  constructor(
    public sw: FakeLatLng,
    public ne: FakeLatLng
  ) {}
}
class FakeMap {
  fitBounds = jest.fn();
  setCenter = jest.fn();
  setZoom = jest.fn();
  setOptions = jest.fn();
  autoResize = jest.fn();
  destroy = jest.fn();
  constructor(
    public element: unknown,
    public options: Record<string, unknown>
  ) {}
}
class FakeMarker {
  map: FakeMap | null;
  setMap = jest.fn((map: FakeMap | null) => {
    this.map = map;
  });
  constructor(
    public options: {
      position: FakeLatLng;
      map?: FakeMap;
      icon: { content: string; anchor: FakePoint };
    }
  ) {
    this.map = options.map ?? null;
  }
}
class FakeCircle {
  map: FakeMap | null;
  setMap = jest.fn((map: FakeMap | null) => {
    this.map = map;
  });
  constructor(
    public options: {
      map?: FakeMap;
      center: FakeLatLng;
      radius: number;
    }
  ) {
    this.map = options.map ?? null;
  }
}

interface Listener {
  target: unknown;
  name: string;
  handler: () => void;
}

function makeNaver() {
  const made = {
    maps: [] as FakeMap[],
    markers: [] as FakeMarker[],
    circles: [] as FakeCircle[],
    listeners: [] as Listener[],
  };
  const maps = {
    LatLng: FakeLatLng,
    Point: FakePoint,
    LatLngBounds: FakeBounds,
    Map: class extends FakeMap {
      constructor(element: unknown, options: Record<string, unknown>) {
        super(element, options);
        made.maps.push(this);
      }
    },
    Marker: class extends FakeMarker {
      constructor(options: FakeMarker['options']) {
        super(options);
        made.markers.push(this);
      }
    },
    Circle: class extends FakeCircle {
      constructor(options: FakeCircle['options']) {
        super(options);
        made.circles.push(this);
      }
    },
    Event: {
      addListener: (target: unknown, name: string, handler: () => void) => {
        const listener = { target, name, handler };
        made.listeners.push(listener);
        return listener;
      },
      removeListener: (listener: Listener) => {
        made.listeners = made.listeners.filter((l) => l !== listener);
      },
    },
  };
  return { naver: { maps } as unknown as NaverMapsApi, made };
}

function setup() {
  const { naver, made } = makeNaver();
  const onPinTap = jest.fn();
  const controller = createWebMapController({
    naver,
    element: {} as unknown as HTMLElement,
    onPinTap,
  });
  return { controller, made, onPinTap };
}

const CENTER = { lat: 33.5, lng: 126.5 };

function cornersOf(bounds: FakeBounds) {
  return {
    sw: { lat: bounds.sw.latValue, lng: bounds.sw.lngValue },
    ne: { lat: bounds.ne.latValue, lng: bounds.ne.lngValue },
  };
}
function expectCornersClose(
  actual: ReturnType<typeof cornersOf>,
  expected: {
    sw: { lat: number; lng: number };
    ne: { lat: number; lng: number };
  }
) {
  for (const corner of ['sw', 'ne'] as const) {
    expect(actual[corner].lat).toBeCloseTo(expected[corner].lat, 6);
    expect(actual[corner].lng).toBeCloseTo(expected[corner].lng, 6);
  }
}
function fitCorners(map: FakeMap, call: number) {
  return cornersOf(map.fitBounds.mock.calls[call][0] as FakeBounds);
}
function click(made: ReturnType<typeof makeNaver>['made'], marker: FakeMarker) {
  const listener = made.listeners.find(
    (l) => l.target === marker && l.name === 'click'
  );
  if (!listener) throw new Error('마커에 click 리스너가 없다');
  listener.handler();
}

const FIT_PINS: MapPin[] = [
  { number: 1, lat: 33.51, lng: 126.52 },
  { number: 2, lat: 33.515, lng: 126.526 },
];
const FIT_POINTS = FIT_PINS.map((p) => ({ lat: p.lat, lng: p.lng }));

describe('AC-4 — 핀 N개 → 마커 N개(좌표·HTML·기준점)', () => {
  it('핀마다 마커가 핀 좌표(lat,lng 순서)·핀 HTML·아래 꼭짓점 기준점으로 지도에 붙는다', () => {
    const { controller, made } = setup();
    const pins: MapPin[] = [
      { number: 1, lat: 33.51, lng: 126.52 },
      { number: 2, lat: 33.52, lng: 126.53, state: 'done' },
      { number: 3, lat: 33.53, lng: 126.54, kind: 'stay' },
    ];

    controller.update({ center: CENTER, pins });

    expect(made.maps).toHaveLength(1);
    expect(made.markers).toHaveLength(3);
    made.markers.forEach((marker, i) => {
      const expected = buildWebMarker(pins[i]);
      expect(marker.options.position).toBeInstanceOf(FakeLatLng);
      expect(marker.options.position.latValue).toBeCloseTo(pins[i].lat, 9);
      expect(marker.options.position.lngValue).toBeCloseTo(pins[i].lng, 9);
      expect(marker.map).toBe(made.maps[0]);
      expect(marker.options.icon.content).toBe(expected.html);
      expect(marker.options.icon.anchor.x).toBeCloseTo(
        expected.width * expected.anchor.x,
        6
      );
      expect(marker.options.icon.anchor.y).toBeCloseTo(
        expected.height * expected.anchor.y,
        6
      );
    });
  });

  it('핀이 없으면 마커도 없다(지도는 열린다)', () => {
    const { controller, made } = setup();

    controller.update({ center: CENTER });

    expect(made.maps).toHaveLength(1);
    expect(made.markers).toHaveLength(0);
  });
});

describe('AC-5 — 마커 탭 → onPinTap(핀 배열 위치)', () => {
  it('번호가 [2,5,9] 여도 넘기는 값은 번호가 아니라 배열 위치다', () => {
    const { controller, made, onPinTap } = setup();
    controller.update({
      center: CENTER,
      pins: [
        { number: 2, lat: 33.51, lng: 126.52 },
        { number: 5, lat: 33.52, lng: 126.53 },
        { number: 9, lat: 33.53, lng: 126.54 },
      ],
    });
    // 앵커 — 탭 전엔 아무 호출도 없다.
    expect(onPinTap).not.toHaveBeenCalled();

    click(made, made.markers[2]);
    expect(onPinTap).toHaveBeenCalledTimes(1);
    expect(onPinTap).toHaveBeenLastCalledWith(2);

    click(made, made.markers[0]);
    expect(onPinTap).toHaveBeenCalledTimes(2);
    expect(onPinTap).toHaveBeenLastCalledWith(0);
  });
});

describe('핀 값 기준 갱신 — 같으면 그대로, 바뀌면 전부 다시', () => {
  it('값이 같은 새 배열이면 마커를 다시 안 만들고, 하나라도 바뀌면 옛 마커를 걷고 새로 만든다', () => {
    const { controller, made } = setup();
    const pins: MapPin[] = [
      { number: 1, lat: 33.51, lng: 126.52 },
      { number: 2, lat: 33.52, lng: 126.53 },
      { number: 3, lat: 33.53, lng: 126.54 },
    ];
    controller.update({ center: CENTER, pins });
    const first = [...made.markers];

    controller.update({ center: CENTER, pins: pins.map((p) => ({ ...p })) });
    expect(made.markers).toHaveLength(3);
    first.forEach((m) => expect(m.map).not.toBeNull());

    controller.update({
      center: CENTER,
      pins: pins.map((p, i) => (i === 1 ? { ...p, lat: 33.6 } : { ...p })),
    });
    first.forEach((m) => expect(m.map).toBeNull());
    expect(made.markers).toHaveLength(6);
    made.markers.slice(3).forEach((m) => expect(m.map).toBe(made.maps[0]));
  });
});

describe('AC-6 — 영역 맞춤', () => {
  it('fitPins → fitBounds 에 핀 맞춤 영역의 남서·북동이 들어간다(손계산 값)', () => {
    const { controller, made } = setup();

    controller.update({ center: CENTER, pins: FIT_PINS, fitPins: true });

    expect(made.maps[0].fitBounds).toHaveBeenCalledTimes(1);
    // 핀 폭 0.005·0.006 에 여백 1.4 를 곱해도 최소 폭 0.01 보다 작아 폭은 0.01 로 고정.
    expectCornersClose(fitCorners(made.maps[0], 0), {
      sw: { lat: 33.5075, lng: 126.518 },
      ne: { lat: 33.5175, lng: 126.528 },
    });
  });

  it('fitBand 가 맞춤 영역에 반영된다(band 없을 때와 다르다)', () => {
    const band = { top: 0.2, bottom: 0.5 };
    const withBand = setup();
    const without = setup();

    withBand.controller.update({
      center: CENTER,
      pins: FIT_PINS,
      fitPins: true,
      fitBand: band,
    });
    without.controller.update({
      center: CENTER,
      pins: FIT_PINS,
      fitPins: true,
    });

    const actual = fitCorners(withBand.made.maps[0], 0);
    expectCornersClose(
      actual,
      regionToCorners(buildFitRegion(FIT_POINTS, band)!)
    );
    expect(actual.ne.lat - actual.sw.lat).toBeGreaterThan(
      fitCorners(without.made.maps[0], 0).ne.lat -
        fitCorners(without.made.maps[0], 0).sw.lat
    );
  });

  it('반경 원만 있으면(핀 맞춤 없음) 원 영역으로 맞추고 원을 그린다', () => {
    const { controller, made } = setup();
    const radiusCircle = { center: { lat: 33.5, lng: 126.5 }, radiusM: 1500 };

    controller.update({ center: CENTER, radiusCircle });

    expectCornersClose(
      fitCorners(made.maps[0], 0),
      regionToCorners(buildCircleRegion(radiusCircle.center, 1500))
    );
    expect(made.circles).toHaveLength(1);
    expect(made.circles[0].options.center.latValue).toBeCloseTo(33.5, 9);
    expect(made.circles[0].options.center.lngValue).toBeCloseTo(126.5, 9);
    expect(made.circles[0].options.radius).toBe(1500);
    expect(made.circles[0].map).toBe(made.maps[0]);
  });

  it('핀 맞춤이 원 맞춤보다 우선하고, 핀이 비면 원으로 떨어진다(원은 둘 다 그려진다)', () => {
    const radiusCircle = { center: { lat: 35, lng: 129 }, radiusM: 800 };
    const withPins = setup();
    const noPins = setup();

    withPins.controller.update({
      center: CENTER,
      pins: FIT_PINS,
      fitPins: true,
      radiusCircle,
    });
    noPins.controller.update({
      center: CENTER,
      pins: [],
      fitPins: true,
      radiusCircle,
    });

    expectCornersClose(
      fitCorners(withPins.made.maps[0], 0),
      regionToCorners(buildFitRegion(FIT_POINTS)!)
    );
    expectCornersClose(
      fitCorners(noPins.made.maps[0], 0),
      regionToCorners(buildCircleRegion(radiusCircle.center, 800))
    );
    expect(withPins.made.circles).toHaveLength(1);
    expect(noPins.made.circles).toHaveLength(1);
  });

  it('맞춤이 없으면 center·줌 14 로 열고 fitBounds 는 안 부른다; center 값이 바뀔 때만 setCenter', () => {
    const { controller, made } = setup();

    controller.update({ center: CENTER });

    const map = made.maps[0];
    expect(map.options.zoom).toBe(14);
    const opened = map.options.center as FakeLatLng;
    expect(opened.latValue).toBeCloseTo(33.5, 9);
    expect(opened.lngValue).toBeCloseTo(126.5, 9);
    expect(map.fitBounds).not.toHaveBeenCalled();

    const before = map.setCenter.mock.calls.length;
    controller.update({ center: { ...CENTER } });
    expect(map.setCenter).toHaveBeenCalledTimes(before);

    controller.update({ center: { lat: 35.1, lng: 129.0 } });
    expect(map.setCenter).toHaveBeenCalledTimes(before + 1);
    const moved = map.setCenter.mock.calls[before][0] as FakeLatLng;
    expect(moved.latValue).toBeCloseTo(35.1, 9);
    expect(moved.lngValue).toBeCloseTo(129.0, 9);
  });

  it('맞춤 영역 값이 같은 재렌더는 fitBounds 를 다시 안 부르고, 값이 바뀌면 다시 부른다; refit() 은 같은 영역으로 한 번 더', () => {
    const { controller, made } = setup();
    const input: WebMapInput = {
      center: CENTER,
      pins: FIT_PINS,
      fitPins: true,
    };
    controller.update(input);
    const map = made.maps[0];
    expect(map.fitBounds).toHaveBeenCalledTimes(1);

    controller.update({ ...input, pins: FIT_PINS.map((p) => ({ ...p })) });
    expect(map.fitBounds).toHaveBeenCalledTimes(1);

    controller.update({
      ...input,
      pins: [FIT_PINS[0], { ...FIT_PINS[1], lat: 33.7 }],
    });
    expect(map.fitBounds).toHaveBeenCalledTimes(2);

    controller.refit();
    expect(map.fitBounds).toHaveBeenCalledTimes(3);
    expectCornersClose(fitCorners(map, 2), fitCorners(map, 1));
  });
});

describe('AC-7 — viewOnly 는 Map 옵션에서 제스처 4종을 끈다', () => {
  it('viewOnly → 모두 꺼짐 / 미전달 → 모두 켜짐', () => {
    const locked = setup();
    const free = setup();

    locked.controller.update({ center: CENTER, viewOnly: true });
    free.controller.update({ center: CENTER });

    expect(locked.made.maps[0].options).toMatchObject({
      draggable: false,
      pinchZoom: false,
      scrollWheel: false,
      keyboardShortcuts: false,
    });
    expect(free.made.maps[0].options).toMatchObject({
      draggable: true,
      pinchZoom: true,
      scrollWheel: true,
      keyboardShortcuts: true,
    });
  });
});

describe('정리 — 원 제거·destroy', () => {
  it('반경 원이 사라지면 원을 지도에서 걷는다', () => {
    const { controller, made } = setup();
    controller.update({
      center: CENTER,
      radiusCircle: { center: CENTER, radiusM: 500 },
    });
    expect(made.circles[0].map).toBe(made.maps[0]);

    controller.update({ center: CENTER });

    expect(made.circles[0].map).toBeNull();
  });

  it('destroy() → 마커·원 전부 지도에서 걷고, 이후 update 는 새 객체를 만들지 않는다', () => {
    const { controller, made } = setup();
    controller.update({
      center: CENTER,
      pins: FIT_PINS,
      radiusCircle: { center: CENTER, radiusM: 500 },
    });
    expect(made.markers).toHaveLength(2);

    controller.destroy();

    made.markers.forEach((m) => expect(m.map).toBeNull());
    expect(made.circles[0].map).toBeNull();

    controller.update({ center: CENTER, pins: FIT_PINS });
    expect(made.markers).toHaveLength(2);
    expect(made.maps).toHaveLength(1);
  });
});

/**
 * 5-b 보강(code-critic 03b W1) — "값이 바뀌면 다시 그린다" 규칙을 필드마다 하나씩 잠근다.
 * 초심자용 — 컨트롤러는 입력의 JSON 키를 지난번과 비교해 다른 때만 마커·원을 새로 만든다.
 * 좌표를 `lat` 하나만 바꿔 보던 기존 케이스는 키에 다른 필드가 빠져도 green 이라, 여기서는
 * **좌표는 그대로 두고 필드 하나만** 바꿔 "그래도 새로 그려지는가"를 본다.
 */
describe('핀 필드별 갱신 — 좌표가 같아도 모양을 정하는 필드가 바뀌면 마커를 새로 만든다', () => {
  const BASE: MapPin = { number: 1, lat: 33.51, lng: 126.52 };
  const CASES: [string, MapPin][] = [
    ['state(current→done)', { ...BASE, state: 'done' }],
    ['kind(기본→stay)', { ...BASE, kind: 'stay' }],
    ['label(번호→A)', { ...BASE, label: 'A' }],
    ['number(1→2)', { ...BASE, number: 2 }],
  ];

  it.each(CASES)(
    '%s 만 바뀌면 옛 마커를 걷고 새 모양 마커를 만든다',
    (_name, changed) => {
      const { controller, made } = setup();
      controller.update({ center: CENTER, pins: [BASE] });
      const old = made.markers[0];
      // 앵커 — 같은 값으로 한 번 더 줄 땐 새로 안 만든다.
      controller.update({ center: CENTER, pins: [{ ...BASE }] });
      expect(made.markers).toHaveLength(1);

      controller.update({ center: CENTER, pins: [changed] });

      expect(old.map).toBeNull();
      expect(made.markers).toHaveLength(2);
      expect(made.markers[1].map).toBe(made.maps[0]);
      expect(made.markers[1].options.icon.content).toBe(
        buildWebMarker(changed).html
      );
      expect(made.markers[1].options.icon.content).not.toBe(
        old.options.icon.content
      );
    }
  );
});

describe('원 반경 갱신 — 중심이 같아도 반경만 바뀌면 원을 새로 그린다', () => {
  it('반경 500 → 900: 옛 원은 지도에서 걷히고 새 원은 반경 900', () => {
    const { controller, made } = setup();
    controller.update({
      center: CENTER,
      radiusCircle: { center: CENTER, radiusM: 500 },
    });
    // 앵커 — 같은 값이면 새로 안 그린다.
    controller.update({
      center: CENTER,
      radiusCircle: { center: { ...CENTER }, radiusM: 500 },
    });
    expect(made.circles).toHaveLength(1);

    controller.update({
      center: CENTER,
      radiusCircle: { center: CENTER, radiusM: 900 },
    });

    expect(made.circles).toHaveLength(2);
    expect(made.circles[0].map).toBeNull();
    expect(made.circles[1].options.radius).toBe(900);
    expect(made.circles[1].map).toBe(made.maps[0]);
  });
});

describe('viewOnly 사후 변경 — 지도를 만든 뒤에 바뀌어도 반영된다', () => {
  it('false→true→false: 바뀔 때만 setOptions 가 불리고 옵션 4종이 값을 따른다', () => {
    const { controller, made } = setup();
    controller.update({ center: CENTER });
    const map = made.maps[0];
    // 앵커 — 같은 값이면 setOptions 는 안 불린다.
    controller.update({ center: CENTER });
    expect(map.setOptions).not.toHaveBeenCalled();

    controller.update({ center: CENTER, viewOnly: true });
    expect(map.setOptions).toHaveBeenCalledTimes(1);
    expect(map.setOptions).toHaveBeenLastCalledWith({
      draggable: false,
      pinchZoom: false,
      scrollWheel: false,
      keyboardShortcuts: false,
    });

    controller.update({ center: CENTER, viewOnly: true });
    expect(map.setOptions).toHaveBeenCalledTimes(1);

    controller.update({ center: CENTER, viewOnly: false });
    expect(map.setOptions).toHaveBeenCalledTimes(2);
    expect(map.setOptions).toHaveBeenLastCalledWith({
      draggable: true,
      pinchZoom: true,
      scrollWheel: true,
      keyboardShortcuts: true,
    });
  });
});

describe('맞춤 해제 — fitPins 를 끄면 지도가 center 로 돌아간다', () => {
  it('핀 맞춤 중 → fitPins false(같은 center·핀): setCenter 가 center 값으로 불린다', () => {
    const { controller, made } = setup();
    controller.update({ center: CENTER, pins: FIT_PINS, fitPins: true });
    const map = made.maps[0];
    // 앵커 — 맞춤 중엔 center 를 따로 옮기지 않는다.
    expect(map.setCenter).not.toHaveBeenCalled();

    controller.update({ center: CENTER, pins: FIT_PINS, fitPins: false });

    expect(map.setCenter).toHaveBeenCalledTimes(1);
    const back = map.setCenter.mock.calls[0][0] as FakeLatLng;
    expect(back.latValue).toBeCloseTo(CENTER.lat, 9);
    expect(back.lngValue).toBeCloseTo(CENTER.lng, 9);

    // 한 번 돌아온 뒤 같은 입력이면 더 안 옮긴다(끌어 둔 지도를 안 되돌린다).
    controller.update({ center: CENTER, pins: FIT_PINS, fitPins: false });
    expect(map.setCenter).toHaveBeenCalledTimes(1);
  });
});

describe('refit() — 크기를 다시 재고, 영역이 있을 때만 맞춘다', () => {
  it('영역 없음: autoResize 만 1회(fitBounds 0) / 영역 있음: autoResize 뒤에 fitBounds', () => {
    const plain = setup();
    plain.controller.update({ center: CENTER });
    plain.controller.refit();
    expect(plain.made.maps[0].autoResize).toHaveBeenCalledTimes(1);
    expect(plain.made.maps[0].fitBounds).not.toHaveBeenCalled();

    const fitted = setup();
    fitted.controller.update({
      center: CENTER,
      pins: FIT_PINS,
      fitPins: true,
    });
    const map = fitted.made.maps[0];
    expect(map.autoResize).not.toHaveBeenCalled();
    fitted.controller.refit();
    expect(map.autoResize).toHaveBeenCalledTimes(1);
    expect(map.fitBounds).toHaveBeenCalledTimes(2);
    // 크기를 먼저 재야 맞춤이 새 크기 기준이 된다.
    expect(map.autoResize.mock.invocationCallOrder[0]).toBeLessThan(
      map.fitBounds.mock.invocationCallOrder[1]
    );
  });

  it('지도가 만들어지기 전·destroy 뒤의 refit() 은 아무것도 안 한다', () => {
    const { controller, made } = setup();
    controller.refit();
    expect(made.maps).toHaveLength(0);

    controller.update({ center: CENTER });
    controller.destroy();
    controller.refit();
    expect(made.maps[0].autoResize).not.toHaveBeenCalled();
  });
});

describe('destroy() — 지도 인스턴스까지 정리한다', () => {
  it('map.destroy 가 정확히 1회 불리고, 두 번째 destroy 는 무시된다', () => {
    const { controller, made } = setup();
    controller.update({ center: CENTER, pins: FIT_PINS });
    const map = made.maps[0];
    // 앵커 — 정리 전엔 네이버 지도가 살아 있다.
    expect(map.destroy).not.toHaveBeenCalled();

    controller.destroy();
    controller.destroy();

    expect(map.destroy).toHaveBeenCalledTimes(1);
  });
});

/**
 * 정리 중 네이버 호출이 던져도 — 웹 스모크 실결함(`Cannot read properties of null (reading 'capitalize')`).
 * 인증 실패 통지(`navermap_authFailure`)가 오면 네이버 내부는 이미 반쯤 망가진 상태라 `marker.setMap(null)` 이 던진다.
 * `MapView.web` 은 실패 표면으로 바꾸며 `destroy()` 를 부르는데, 여기서 던지면 앱 전체가 레드박스가 된다(INV-4 위반).
 *
 * 초심자용 — (준비) 핀 3개·원·지도를 만들고, 한 곳의 `setMap`/`destroy` 가 던지게 바꾼다.
 * (실행) `destroy()` → (단언) ① 던지지 않는다 ② 던지지 않는 나머지 정리는 끝까지 간다 ③ 이후 `update`·`refit` 은 무동작.
 */
describe('destroy() — 네이버 호출이 던져도 정리는 계속되고 밖으로 던지지 않는다', () => {
  const PINS3: MapPin[] = [
    { number: 1, lat: 33.51, lng: 126.52 },
    { number: 2, lat: 33.515, lng: 126.526 },
    { number: 3, lat: 33.52, lng: 126.53 },
  ];
  const boom = () => {
    throw new Error('naver internal: capitalize of null');
  };

  function ready() {
    const { controller, made } = setup();
    controller.update({
      center: CENTER,
      pins: PINS3,
      fitPins: true,
      radiusCircle: { center: CENTER, radiusM: 500 },
    });
    return { controller, made, map: made.maps[0] };
  }

  /** 정리 뒤 상태: 던지지 않은 곳은 끝까지 정리됐고, 컨트롤러는 더 이상 지도를 건드리지 않는다. */
  function expectDeadController(
    controller: ReturnType<typeof ready>['controller'],
    made: ReturnType<typeof ready>['made'],
    map: FakeMap
  ) {
    const markersBefore = made.markers.length;
    const circlesBefore = made.circles.length;
    const fitBefore = map.fitBounds.mock.calls.length;
    const centerBefore = map.setCenter.mock.calls.length;

    expect(() => {
      controller.update({
        center: { lat: 35, lng: 129 },
        pins: [{ number: 9, lat: 35, lng: 129 }],
        radiusCircle: { center: CENTER, radiusM: 900 },
      });
      controller.refit();
    }).not.toThrow();

    expect(made.maps).toHaveLength(1);
    expect(made.markers).toHaveLength(markersBefore);
    expect(made.circles).toHaveLength(circlesBefore);
    expect(map.fitBounds).toHaveBeenCalledTimes(fitBefore);
    expect(map.setCenter).toHaveBeenCalledTimes(centerBefore);
    expect(map.autoResize).not.toHaveBeenCalled();
  }

  it('가운데 마커의 setMap(null) 이 던져도: 안 던지고, 나머지 마커·원·map.destroy 는 정리된다', () => {
    const { controller, made, map } = ready();
    made.markers[1].setMap.mockImplementation(boom);
    // 앵커 — 정리 전엔 마커 셋이 지도에 붙어 있고 map.destroy 도 안 불렸다.
    made.markers.forEach((m) => expect(m.map).toBe(map));
    expect(map.destroy).not.toHaveBeenCalled();

    expect(() => controller.destroy()).not.toThrow();

    expect(made.markers[0].map).toBeNull();
    expect(made.markers[1].setMap).toHaveBeenCalledWith(null);
    expect(made.markers[2].map).toBeNull();
    expect(made.circles[0].map).toBeNull();
    expect(map.destroy).toHaveBeenCalledTimes(1);
    expectDeadController(controller, made, map);
  });

  it('첫 마커가 던져도 뒤 마커 둘이 정리된다(첫 줄에서 멈추지 않는다)', () => {
    const { controller, made, map } = ready();
    made.markers[0].setMap.mockImplementation(boom);

    expect(() => controller.destroy()).not.toThrow();

    expect(made.markers[1].map).toBeNull();
    expect(made.markers[2].map).toBeNull();
    expect(made.circles[0].map).toBeNull();
    expect(map.destroy).toHaveBeenCalledTimes(1);
  });

  it('원의 setMap(null) 이 던져도: 안 던지고, 마커는 정리되고 map.destroy 를 시도한다', () => {
    const { controller, made, map } = ready();
    made.circles[0].setMap.mockImplementation(boom);

    expect(() => controller.destroy()).not.toThrow();

    made.markers.forEach((m) => expect(m.map).toBeNull());
    expect(made.circles[0].setMap).toHaveBeenCalledWith(null);
    expect(map.destroy).toHaveBeenCalledTimes(1);
    expectDeadController(controller, made, map);
  });

  it('map.destroy 가 던져도: 안 던지고, 마커·원은 이미 정리됐고, 두 번째 destroy 는 map.destroy 를 다시 안 부른다', () => {
    const { controller, made, map } = ready();
    map.destroy.mockImplementation(boom);

    expect(() => controller.destroy()).not.toThrow();

    made.markers.forEach((m) => expect(m.map).toBeNull());
    expect(made.circles[0].map).toBeNull();
    expect(map.destroy).toHaveBeenCalledTimes(1);

    expect(() => controller.destroy()).not.toThrow();
    expect(map.destroy).toHaveBeenCalledTimes(1);
    expectDeadController(controller, made, map);
  });

  it('마커·원·map.destroy 가 전부 던져도: 안 던지고, 전부 한 번씩 시도하고, 이후 무동작', () => {
    const { controller, made, map } = ready();
    made.markers.forEach((m) => m.setMap.mockImplementation(boom));
    made.circles[0].setMap.mockImplementation(boom);
    map.destroy.mockImplementation(boom);

    expect(() => controller.destroy()).not.toThrow();

    made.markers.forEach((m) => expect(m.setMap).toHaveBeenCalledTimes(1));
    expect(made.circles[0].setMap).toHaveBeenCalledTimes(1);
    expect(map.destroy).toHaveBeenCalledTimes(1);
    expectDeadController(controller, made, map);
  });
});

/**
 * 2차 리뷰 경고 W3 — 맞춤이 켜졌다 꺼진 뒤의 `refit()`. 구현은 `fitPins` 가 꺼질 때 기억해 둔 영역(`fitCorners`)을 비운다.
 * 이 케이스가 없으면 그 한 줄을 지워도 전부 green 이다(뮤테이션 C7). 사용자가 지도를 끌어 둔 뒤 창 크기가 바뀌면
 * 옛 핀 영역으로 지도가 튄다.
 */
describe('refit() — 맞춤이 꺼진 뒤엔 옛 영역으로 되돌리지 않는다(W3)', () => {
  it('fitPins 켬 → 끔 → refit(): autoResize 만 불리고 fitBounds 는 늘지 않는다', () => {
    const { controller, made } = setup();
    controller.update({ center: CENTER, pins: FIT_PINS, fitPins: true });
    const map = made.maps[0];
    // 앵커 — 켜진 동안엔 refit 이 옛 영역으로 다시 맞춘다(fitBounds 1 → 2).
    controller.refit();
    expect(map.fitBounds).toHaveBeenCalledTimes(2);
    expect(map.autoResize).toHaveBeenCalledTimes(1);

    controller.update({ center: CENTER, pins: FIT_PINS, fitPins: false });
    controller.refit();

    expect(map.autoResize).toHaveBeenCalledTimes(2);
    expect(map.fitBounds).toHaveBeenCalledTimes(2);
  });
});
