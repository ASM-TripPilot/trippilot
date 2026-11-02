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
  // 진짜 naver.maps.LatLng 는 좌표를 lat()/lng() 메서드로 읽는다(getCenter() 결과를 읽는 쪽이 이걸 써야 한다).
  lat() {
    return this.latValue;
  }
  lng() {
    return this.lngValue;
  }
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
  getCenter = jest.fn(() => new FakeLatLng(0, 0));
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
  setPosition = jest.fn((position: FakeLatLng) => {
    this.options.position = position;
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

class FakePolyline {
  map: FakeMap | null;
  setMap = jest.fn((map: FakeMap | null) => {
    this.map = map;
  });
  constructor(public options: Record<string, unknown>) {
    this.map = (options.map as FakeMap | undefined) ?? null;
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
    polylines: [] as FakePolyline[],
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
    Polyline: class extends FakePolyline {
      constructor(options: Record<string, unknown>) {
        super(options);
        made.polylines.push(this);
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

/**
 * TRIP-1652 (W6) — 경로선(Polyline)·카메라 idle·내 위치 점. AC-1~5, AC-8~10.
 *
 * 초심자용 — 새 개념 셋.
 * - `Polyline`: 점들을 이은 선을 지도에 그리는 네이버 JS 클래스. 가짜는 만들 때 받은 옵션(`path`=LatLng 배열,
 *   `strokeColor`·`strokeWeight`·`strokeStyle`)을 기록하고, 테스트는 그 **값**을 읽는다.
 * - `idle` 이벤트: 지도가 움직이다 멈추면 발화. 가짜 `Event.addListener` 가 리스너를 모아 두므로 테스트가 꺼내 직접 부른다.
 * - 위치 포트(`location`): 컨트롤러가 위치 권한 조회·감시를 맡길 곳(DI). 진짜는 `expo-location`, 여기선 가짜가
 *   "권한 상태"와 "위치가 바뀌었다는 호출"을 흉내 내고, 묻는 함수(request·getCurrentPosition)가 불렸는지도 센다.
 * 단언은 모두 값(경로 좌표 열·색·굵기 대소·개수·marker 좌표)이고 prop 전달 여부가 아니다.
 */
const SOLID_OR_UNSET = (style: unknown) =>
  style === undefined || style === 'solid';
const live = (made: ReturnType<typeof makeNaver>['made']) =>
  made.polylines.filter((p) => p.map !== null);
const pathOf = (line: FakePolyline) =>
  (line.options.path as FakeLatLng[]).map((p) => ({
    lat: p.latValue,
    lng: p.lngValue,
  }));
const isDashed = (line: FakePolyline) =>
  !SOLID_OR_UNSET(line.options.strokeStyle);
const plansOf = (made: ReturnType<typeof makeNaver>['made']) =>
  live(made).filter((l) => !isDashed(l));
const dashedOf = (made: ReturnType<typeof makeNaver>['made']) =>
  live(made).filter(isDashed);

const LINE_PINS: MapPin[] = [
  { number: 1, lat: 33.51, lng: 126.52, kind: 'visited' },
  { number: 2, lat: 33.52, lng: 126.53, kind: 'planned' },
  { number: 3, lat: 33.53, lng: 126.54 },
  { number: 4, lat: 33.54, lng: 126.55, kind: 'stay' },
  { number: 5, lat: 33.55, lng: 126.56, kind: 'visited' },
];
const LINE_COORDS = [
  { lat: 33.51, lng: 126.52 },
  { lat: 33.53, lng: 126.54 },
  { lat: 33.55, lng: 126.56 },
];
const SEG_A = [
  { lat: 33.511, lng: 126.521 },
  { lat: 33.512, lng: 126.522 },
];
const SEG_B = [
  { lat: 33.531, lng: 126.541 },
  { lat: 33.532, lng: 126.542 },
  { lat: 33.533, lng: 126.543 },
];

describe('AC-1 — 계획 연결선: 흰 케이싱 아래 + primary 위, 같은 좌표(visited·무-kind 핀만)', () => {
  it('핀 5개(visited·planned·무-kind·stay·visited) → 선 2개, 둘 다 연결 대상 3곳의 좌표를 배열 순서로 잇는다', () => {
    const { controller, made } = setup();
    // 앵커 — update 전엔 선이 없다.
    expect(made.polylines).toHaveLength(0);

    controller.update({ center: CENTER, pins: LINE_PINS });

    const lines = live(made);
    expect(lines).toHaveLength(2);
    const [casing, route] = lines;
    expect(lines.every((l) => l.map === made.maps[0])).toBe(true);
    expect(pathOf(casing)).toEqual(LINE_COORDS);
    expect(pathOf(route)).toEqual(LINE_COORDS);
    // 케이싱·primary 선의 색·굵기는 jest-cut 에서 뺐다 — 실화면 QA 몫.
    expect(isDashed(casing) || isDashed(route)).toBe(false);
  });

  it('선 옵션에 소요시간류 필드가 없다(INV-3) — drawPathOnMount 형 값은 컨트롤러가 받지도 않는다', () => {
    const { controller, made } = setup();

    controller.update({ center: CENTER, pins: LINE_PINS });

    // 앵커 — 선이 실제로 만들어졌다(선이 없으면 아래 반복이 공허하게 통과한다).
    expect(made.polylines.length).toBeGreaterThan(0);
    for (const line of made.polylines) {
      expect(Object.keys(line.options).join(' ')).not.toMatch(
        /duration|minute|eta|time/i
      );
    }
  });
});

describe('AC-2 — 선이 없는 경우와 값 기준 갱신', () => {
  it('connectPins:false · 연결 핀 1개 · 핀 없음이면 선이 0개다', () => {
    const { controller, made } = setup();

    controller.update({ center: CENTER, pins: LINE_PINS, connectPins: false });
    expect(made.polylines).toHaveLength(0);

    controller.update({ center: CENTER, pins: [LINE_PINS[0], LINE_PINS[1]] });
    expect(made.polylines).toHaveLength(0);

    controller.update({ center: CENTER });
    expect(made.polylines).toHaveLength(0);

    // 짝 — 연결 조건을 갖추면 같은 컨트롤러에서 선이 생긴다(위 단언이 "선 기능 자체가 없어서" 공허하게 통과하지 않게).
    controller.update({ center: CENTER, pins: LINE_PINS });
    expect(live(made)).toHaveLength(2);
  });

  it('값이 같은 재update 는 선을 다시 만들지도 지우지도 않고, 핀이 바뀌면 옛 선을 걷고 새로 그린다', () => {
    const { controller, made } = setup();
    controller.update({ center: CENTER, pins: LINE_PINS });
    const first = [...made.polylines];

    controller.update({
      center: CENTER,
      pins: LINE_PINS.map((p) => ({ ...p })),
    });

    expect(made.polylines).toHaveLength(2);
    first.forEach((l) => expect(l.setMap).not.toHaveBeenCalled());

    controller.update({
      center: CENTER,
      pins: LINE_PINS.map((p) => (p.number === 5 ? { ...p, lat: 33.6 } : p)),
    });

    first.forEach((l) => expect(l.map).toBeNull());
    const now = live(made);
    expect(now).toHaveLength(2);
    expect(pathOf(now[1])).toEqual([
      ...LINE_COORDS.slice(0, 2),
      { lat: 33.6, lng: 126.56 },
    ]);
  });

  it('선이 사라지는 쪽으로 바뀌면(연결 끔) 옛 선만 걷히고 새 선은 안 생긴다 — 마커는 그대로', () => {
    const { controller, made } = setup();
    controller.update({ center: CENTER, pins: LINE_PINS });
    const markersBefore = made.markers.length;

    controller.update({ center: CENTER, pins: LINE_PINS, connectPins: false });

    expect(live(made)).toHaveLength(0);
    expect(made.polylines).toHaveLength(2);
    expect(made.markers).toHaveLength(markersBefore);
  });
});

describe('AC-3 — 실제 경로: 세그먼트마다 점선 1개, 계획선은 흐리고 얇게(케이싱 없음)', () => {
  const route = [SEG_A, [{ lat: 1, lng: 1 }], SEG_B];

  it('점 2개 미만 세그먼트는 빼고 나머지를 이어 붙이지 않고 각자 그린다 — 점선·primary', () => {
    const { controller, made } = setup();

    controller.update({ center: CENTER, pins: LINE_PINS, actualRoute: route });

    const dashed = dashedOf(made);
    expect(dashed).toHaveLength(2);
    expect(pathOf(dashed[0])).toEqual(SEG_A);
    expect(pathOf(dashed[1])).toEqual(SEG_B);
    dashed.forEach((l) => expect(l.map).toBe(made.maps[0]));
  });

  it('계획선은 muted-soft 한 줄로 낮아진다 — 흰 케이싱이 없고 평소 primary 선보다 얇다', () => {
    const { controller, made } = setup();
    controller.update({ center: CENTER, pins: LINE_PINS });

    controller.update({ center: CENTER, pins: LINE_PINS, actualRoute: route });

    // 케이싱이 빠져 계획선이 한 줄이다. muted-soft 색·얇은 굵기는 jest-cut 에서 뺐다 — 실화면 QA 몫.
    const plans = plansOf(made);
    expect(plans).toHaveLength(1);
    expect(pathOf(plans[0])).toEqual(LINE_COORDS);
  });

  it('실제 경로가 사라지면 점선을 걷고 계획선이 평소 2겹으로 돌아온다', () => {
    const { controller, made } = setup();
    controller.update({ center: CENTER, pins: LINE_PINS, actualRoute: route });

    controller.update({ center: CENTER, pins: LINE_PINS, actualRoute: [] });

    expect(dashedOf(made)).toHaveLength(0);
    expect(plansOf(made)).toHaveLength(2);
  });

  it('연결선을 끄면 계획선은 없고 점선만 남는다', () => {
    const { controller, made } = setup();

    controller.update({
      center: CENTER,
      pins: LINE_PINS,
      connectPins: false,
      actualRoute: [SEG_A],
    });

    expect(plansOf(made)).toHaveLength(0);
    expect(dashedOf(made)).toHaveLength(1);
  });
});

describe('선 정리 — destroy', () => {
  it('destroy 는 모든 선을 지도에서 걷고, 이후 update 는 새 선을 만들지 않는다', () => {
    const { controller, made } = setup();
    controller.update({
      center: CENTER,
      pins: LINE_PINS,
      actualRoute: [SEG_A],
    });
    // 앵커 — 정리 전엔 선이 붙어 있다.
    expect(live(made).length).toBeGreaterThan(0);

    controller.destroy();
    controller.update({
      center: CENTER,
      pins: LINE_PINS,
      actualRoute: [SEG_B],
    });

    expect(live(made)).toHaveLength(0);
    expect(made.polylines.length).toBeLessThanOrEqual(2);
  });

  it('선의 setMap(null) 이 던져도 destroy 는 안 던지고 마커·지도 정리는 이어진다', () => {
    const { controller, made } = setup();
    controller.update({ center: CENTER, pins: LINE_PINS });
    made.polylines[0].setMap.mockImplementation(() => {
      throw new Error('naver internal: capitalize of null');
    });
    const map = made.maps[0];

    expect(() => controller.destroy()).not.toThrow();

    expect(made.polylines[1].map).toBeNull();
    made.markers.forEach((m) => expect(m.map).toBeNull());
    expect(map.destroy).toHaveBeenCalledTimes(1);
  });
});

describe('AC-5 — onCameraIdle: 줄 때만 idle 을 듣고, 멈춘 중심을 {lat,lng} 로 올린다', () => {
  function withIdle() {
    const { naver, made } = makeNaver();
    const onCameraIdle = jest.fn();
    const controller = createWebMapController({
      naver,
      element: {} as unknown as HTMLElement,
      onPinTap: jest.fn(),
      onCameraIdle,
    });
    return { controller, made, onCameraIdle };
  }
  const idleListeners = (made: ReturnType<typeof makeNaver>['made']) =>
    made.listeners.filter((l) => l.name === 'idle');

  it('지도에 idle 리스너가 1개 붙고, 몇 번 update 해도 늘지 않는다; 발화하면 getCenter 의 위도·경도가 순서대로 올라온다', () => {
    const { controller, made, onCameraIdle } = withIdle();
    expect(idleListeners(made)).toHaveLength(0);

    controller.update({ center: CENTER });
    controller.update({ center: CENTER, pins: FIT_PINS });
    controller.update({ center: { lat: 35, lng: 129 } });

    const [listener] = idleListeners(made);
    expect(idleListeners(made)).toHaveLength(1);
    expect(listener.target).toBe(made.maps[0]);
    expect(onCameraIdle).not.toHaveBeenCalled();

    made.maps[0].getCenter.mockReturnValue(new FakeLatLng(33.25, 126.75));
    listener.handler();
    made.maps[0].getCenter.mockReturnValue(new FakeLatLng(34.5, 127.5));
    listener.handler();

    expect(onCameraIdle).toHaveBeenCalledTimes(2);
    expect(onCameraIdle).toHaveBeenNthCalledWith(1, {
      lat: 33.25,
      lng: 126.75,
    });
    expect(onCameraIdle).toHaveBeenNthCalledWith(2, { lat: 34.5, lng: 127.5 });
  });

  it('콜백을 안 주면 idle 리스너를 아예 붙이지 않는다(옵트인)', () => {
    const { controller, made } = setup();

    controller.update({ center: CENTER, pins: FIT_PINS });

    // 앵커 — 지도·마커 리스너는 정상으로 붙었고(click) idle 만 없다.
    expect(made.maps).toHaveLength(1);
    expect(made.listeners.filter((l) => l.name === 'click')).toHaveLength(
      FIT_PINS.length
    );
    expect(idleListeners(made)).toHaveLength(0);
  });

  it('destroy 뒤에 늦게 발화해도 콜백은 불리지 않는다', () => {
    const { controller, made, onCameraIdle } = withIdle();
    controller.update({ center: CENTER });
    const [listener] = idleListeners(made);

    controller.destroy();
    listener.handler();

    expect(onCameraIdle).not.toHaveBeenCalled();
  });
});

describe('내 위치 점 — 권한은 조회만, granted 일 때만 감시하고 점 마커 1개', () => {
  type Pos = { coords: { latitude: number; longitude: number } };
  const flush = async () => {
    for (let i = 0; i < 12; i += 1) await Promise.resolve();
  };

  function makeLocation(status = 'granted') {
    const subscriptions: { remove: jest.Mock }[] = [];
    const callbacks: ((position: Pos) => void)[] = [];
    const port = {
      getForegroundPermissionsAsync: jest.fn(async () => ({ status })),
      // 묻는 함수 — 호출되면 안 된다(BR-U10-53). 있는데 불리지 않는 것을 센다.
      requestForegroundPermissionsAsync: jest.fn(),
      getCurrentPositionAsync: jest.fn(),
      watchPositionAsync: jest.fn(
        async (_options: unknown, callback: (position: Pos) => void) => {
          const subscription = { remove: jest.fn() };
          subscriptions.push(subscription);
          callbacks.push(callback);
          return subscription;
        }
      ),
    };
    const emit = (lat: number, lng: number, which = callbacks.length - 1) =>
      callbacks[which]({ coords: { latitude: lat, longitude: lng } });
    return { port, subscriptions, emit };
  }

  function setupLocation(location?: ReturnType<typeof makeLocation>['port']) {
    const { naver, made } = makeNaver();
    const controller = createWebMapController({
      naver,
      element: {} as unknown as HTMLElement,
      onPinTap: jest.fn(),
      location,
    });
    return { controller, made };
  }
  const posOf = (marker: FakeMarker) => ({
    lat: marker.options.position.latValue,
    lng: marker.options.position.lngValue,
  });
  const noAsk = (port: ReturnType<typeof makeLocation>['port']) => {
    expect(port.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
    expect(port.getCurrentPositionAsync).not.toHaveBeenCalled();
  };

  it('AC-8 granted: 첫 위치가 오기 전엔 점이 없고, 오면 그 좌표에 1개; 위치가 바뀌면 같은 마커가 옮겨 간다', async () => {
    const loc = makeLocation();
    const { controller, made } = setupLocation(loc.port);

    controller.update({ center: CENTER, showMyLocation: true });
    await flush();

    // 앵커 — 감시는 시작됐지만 위치가 아직 안 와 점이 없다.
    expect(loc.port.watchPositionAsync).toHaveBeenCalledTimes(1);
    expect(made.markers).toHaveLength(0);

    loc.emit(33.3, 126.4);
    expect(made.markers).toHaveLength(1);
    const dot = made.markers[0];
    expect(dot.map).toBe(made.maps[0]);
    expect(posOf(dot)).toEqual({ lat: 33.3, lng: 126.4 });

    loc.emit(33.31, 126.41);
    expect(made.markers).toHaveLength(1);
    expect(dot.map).toBe(made.maps[0]);
    expect(posOf(dot)).toEqual({ lat: 33.31, lng: 126.41 });
    noAsk(loc.port);
  });

  it('점 마커에는 보이는 글자가 없다(INV-3 — 분·시간을 그릴 자리가 없다)', async () => {
    const loc = makeLocation();
    const { controller, made } = setupLocation(loc.port);
    controller.update({ center: CENTER, showMyLocation: true });
    await flush();

    loc.emit(33.3, 126.4);

    const html = made.markers[0].options.icon.content;
    expect(html.replace(/<[^>]*>/g, '').trim()).toBe('');
  });

  it('같은 true 로 update 를 거듭해도 권한 조회·감시는 1번이다', async () => {
    const loc = makeLocation();
    const { controller } = setupLocation(loc.port);

    controller.update({ center: CENTER, showMyLocation: true });
    controller.update({ center: CENTER, showMyLocation: true });
    await flush();
    controller.update({ center: CENTER, showMyLocation: true });
    await flush();

    expect(loc.port.getForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(loc.port.watchPositionAsync).toHaveBeenCalledTimes(1);
  });

  it('AC-8 false 로 바뀌면 점을 걷고 감시를 끊는다; 끊은 뒤 늦게 온 위치는 점을 되살리지 않고, 다시 true 면 새로 시작한다', async () => {
    const loc = makeLocation();
    const { controller, made } = setupLocation(loc.port);
    controller.update({ center: CENTER, showMyLocation: true });
    await flush();
    loc.emit(33.3, 126.4);
    const dot = made.markers[0];
    expect(loc.subscriptions[0].remove).not.toHaveBeenCalled();

    controller.update({ center: CENTER, showMyLocation: false });

    expect(dot.map).toBeNull();
    expect(loc.subscriptions[0].remove).toHaveBeenCalledTimes(1);
    loc.emit(33.4, 126.5, 0);
    expect(dot.map).toBeNull();
    expect(made.markers).toHaveLength(1);

    controller.update({ center: CENTER, showMyLocation: true });
    await flush();
    expect(loc.port.watchPositionAsync).toHaveBeenCalledTimes(2);
    loc.emit(33.5, 126.6);
    expect(made.markers.filter((m) => m.map !== null)).toHaveLength(1);
  });

  it('AC-8 destroy: 점을 걷고 감시를 끊는다 — 권한 조회가 끝나기 전이면 감시를 시작하지 않고, 감시 시작이 끝나기 전이면 끝나는 즉시 끊는다', async () => {
    const loc = makeLocation();
    const { controller, made } = setupLocation(loc.port);
    controller.update({ center: CENTER, showMyLocation: true });
    await flush();
    loc.emit(33.3, 126.4);
    controller.destroy();
    expect(made.markers[0].map).toBeNull();
    expect(loc.subscriptions[0].remove).toHaveBeenCalledTimes(1);

    // 권한 조회가 아직 안 끝난 채 destroy.
    let resolvePermission: (v: { status: string }) => void = () => {};
    const slowPermission = makeLocation();
    slowPermission.port.getForegroundPermissionsAsync.mockImplementation(
      () => new Promise((resolve) => (resolvePermission = resolve))
    );
    const a = setupLocation(slowPermission.port);
    a.controller.update({ center: CENTER, showMyLocation: true });
    a.controller.destroy();
    resolvePermission({ status: 'granted' });
    await flush();
    expect(slowPermission.port.watchPositionAsync).not.toHaveBeenCalled();

    // 감시 시작이 아직 안 끝난 채 destroy.
    let resolveWatch: (s: { remove: jest.Mock }) => void = () => {};
    const lateSub = { remove: jest.fn() };
    const slowWatch = makeLocation();
    slowWatch.port.watchPositionAsync.mockImplementation(
      () => new Promise((resolve) => (resolveWatch = resolve))
    );
    const b = setupLocation(slowWatch.port);
    b.controller.update({ center: CENTER, showMyLocation: true });
    await flush();
    b.controller.destroy();
    expect(lateSub.remove).not.toHaveBeenCalled();
    resolveWatch(lateSub);
    await flush();
    expect(lateSub.remove).toHaveBeenCalledTimes(1);
    expect(b.made.markers).toHaveLength(0);
  });

  it.each(['denied', 'undetermined'])(
    'AC-9 권한이 %s 면 감시도 점도 없고, 묻지도 않는다(안내 없이 조용히)',
    async (status) => {
      const loc = makeLocation(status);
      const { controller, made } = setupLocation(loc.port);

      expect(() =>
        controller.update({
          center: CENTER,
          pins: FIT_PINS,
          showMyLocation: true,
        })
      ).not.toThrow();
      await flush();

      expect(loc.port.getForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
      expect(loc.port.watchPositionAsync).not.toHaveBeenCalled();
      noAsk(loc.port);
      // 지도·핀은 정상.
      expect(made.maps).toHaveLength(1);
      expect(made.markers).toHaveLength(FIT_PINS.length);
    }
  );

  it('AC-9 권한 조회가 거부·동기 예외, 감시 시작이 거부돼도 안 던지고(미처리 거부 없음) 점 없이 지도는 정상이다', async () => {
    const cases: ((port: ReturnType<typeof makeLocation>['port']) => void)[] = [
      (port) =>
        port.getForegroundPermissionsAsync.mockRejectedValue(new Error('x')),
      (port) =>
        port.getForegroundPermissionsAsync.mockImplementation(() => {
          throw new Error('no permissions api');
        }),
      (port) => port.watchPositionAsync.mockRejectedValue(new Error('x')),
    ];
    for (const arrange of cases) {
      const loc = makeLocation();
      arrange(loc.port);
      const { controller, made } = setupLocation(loc.port);

      expect(() =>
        controller.update({
          center: CENTER,
          pins: FIT_PINS,
          showMyLocation: true,
        })
      ).not.toThrow();
      await flush();

      // 앵커 — 실패 경로까지 실제로 갔다(조회는 항상 1번, 감시는 granted 였던 경우에만 시도).
      expect(loc.port.getForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
      expect(made.maps).toHaveLength(1);
      expect(made.markers).toHaveLength(FIT_PINS.length);
      noAsk(loc.port);
    }
  });

  it('AC-10 showMyLocation 을 안 주거나 false 면 권한 조회도 없다; 위치 포트를 안 꽂아도 true 가 던지지 않는다', async () => {
    const loc = makeLocation();
    const { controller } = setupLocation(loc.port);

    controller.update({ center: CENTER });
    controller.update({ center: CENTER, showMyLocation: false });
    await flush();

    expect(loc.port.getForegroundPermissionsAsync).not.toHaveBeenCalled();
    expect(loc.port.watchPositionAsync).not.toHaveBeenCalled();
    // 짝 — 켜면 같은 컨트롤러·같은 포트가 조회한다(위 "0회"가 포트 배선 끊김 때문에 공허하게 통과하지 않게).
    controller.update({ center: CENTER, showMyLocation: true });
    await flush();
    expect(loc.port.getForegroundPermissionsAsync).toHaveBeenCalledTimes(1);

    const bare = setupLocation(undefined);
    expect(() =>
      bare.controller.update({ center: CENTER, showMyLocation: true })
    ).not.toThrow();
    await flush();
    expect(bare.made.markers).toHaveLength(0);
  });

  it('정리 호출(점 setMap(null)·감시 remove)이 던져도 destroy 는 안 던지고 지도 정리는 이어진다', async () => {
    const loc = makeLocation();
    const { controller, made } = setupLocation(loc.port);
    controller.update({ center: CENTER, showMyLocation: true });
    await flush();
    loc.emit(33.3, 126.4);
    made.markers[0].setMap.mockImplementation(() => {
      throw new Error('naver internal');
    });
    loc.subscriptions[0].remove.mockImplementation(() => {
      throw new Error('geolocation internal');
    });
    const map = made.maps[0];

    expect(() => controller.destroy()).not.toThrow();

    expect(loc.subscriptions[0].remove).toHaveBeenCalledTimes(1);
    expect(map.destroy).toHaveBeenCalledTimes(1);
  });
});
