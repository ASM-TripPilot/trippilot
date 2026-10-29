import { act, render, screen, waitFor } from '@testing-library/react-native';

import { CenterPinPicker } from './CenterPinPicker';
import { buildFitRegion } from './fitRegion';
import type { MapCenter, MapPin } from './MapView';
import type { NaverMapsApi } from './naverMapsLoader';
// 웹 대체 파일을 **확장자까지 적어 직접** 불러온다 — jest(ios 프리셋)는 `./MapView` 를 네이티브로 풀어
// `.web.tsx` 를 절대 자동으로 집지 않는다. 이 파일이 없으면 웹 쪽은 아무 테스트에도 안 걸린다.
import { MapView } from './MapView.web';
import { regionToCorners } from './webMapOptions';

/**
 * TRIP-1651 (W5) — 웹 `MapView`(네이버 지도 JS v3)의 실패 표면·재시도 규칙. AC-1·AC-2·AC-3 컴포넌트 층, INV-4.
 *
 * 초심자용 — 지도 스크립트를 불러오는 로더(`./naverMapsLoader`)를 통째로 가짜(`mockLoader`)로 바꾼다.
 * 가짜 로더는 "영영 안 풀림 / 거부 / 인증 실패를 알림" 세 가지만 흉내 내고, 컴포넌트가
 * 그때 `map-failure` 를 그리는지·`onLoadFailed` 를 몇 번 부르는지를 본다(동작 단언).
 * 로더가 성공한 뒤의 배선은 파일 아래쪽 「성공 경로」 블록(createNodeMock)이 본다. 실제 타일·마커 모양은 실물 확인(AC-11) 몫.
 */

const mockLoader = {
  load: jest.fn(),
  onAuthFailure: jest.fn(),
};
jest.mock('./naverMapsLoader', () => ({
  getNaverMapsLoader: () => mockLoader,
}));

// TRIP-1652 — 내 위치는 `expo-location` 으로 조회·감시한다. 진짜 가장자리(모듈)를 가짜로 바꿔 껍데기 이음부를 본다.
// 팩토리는 호출 시점에 `mockLocation` 을 읽는다(호이스트된 팩토리가 실행될 땐 const 가 아직 초기화 전이다).
const mockLocation = {
  getForegroundPermissionsAsync: jest.fn(),
  requestForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
  watchPositionAsync: jest.fn(),
};
jest.mock('expo-location', () => ({
  getForegroundPermissionsAsync: (...args: unknown[]) =>
    mockLocation.getForegroundPermissionsAsync(...args),
  requestForegroundPermissionsAsync: (...args: unknown[]) =>
    mockLocation.requestForegroundPermissionsAsync(...args),
  getCurrentPositionAsync: (...args: unknown[]) =>
    mockLocation.getCurrentPositionAsync(...args),
  watchPositionAsync: (...args: unknown[]) =>
    mockLocation.watchPositionAsync(...args),
}));

// `CenterPinPicker` 는 `./MapView`(jest 에선 네이티브)를 쓴다. 이 파일 안에서만 그것을 웹 대체 파일로 갈아 끼워
// 「CenterPinPicker + 웹 MapView」 통합을 본다(위 직접 import 는 영향 없음 — 웹 파일은 './MapView' 를 타입으로만 가져온다).
jest.mock('./MapView', () => require('./MapView.web'));

// no-dynamic-env-var(eslint-plugin-expo) 회피 — 선언과 대입을 분리한다(네이티브 MapView.test.tsx 선례).
const CLIENT_ID_KEY = 'EXPO_PUBLIC_NAVER_MAP_CLIENT_ID';
let ORIGINAL_CLIENT_ID: string | undefined;
ORIGINAL_CLIENT_ID = process.env[CLIENT_ID_KEY];

const CENTER: MapCenter = { lat: 33.4996, lng: 126.5312 };
const NEVER = (): Promise<never> => new Promise(() => {});

beforeEach(() => {
  process.env[CLIENT_ID_KEY] = 'test-naver-client-id';
  mockLoader.load.mockReset();
  mockLoader.onAuthFailure.mockReset();
  mockLoader.load.mockImplementation(NEVER);
  mockLoader.onAuthFailure.mockImplementation(() => () => {});
  Object.values(mockLocation).forEach((fn) => fn.mockReset());
});

afterEach(() => {
  if (ORIGINAL_CLIENT_ID === undefined) {
    delete process.env[CLIENT_ID_KEY];
  } else {
    process.env[CLIENT_ID_KEY] = ORIGINAL_CLIENT_ID;
  }
});

describe('AC-1 — 키 부재 → 실패 표면 + onLoadFailed 1회(스크립트는 부르지 않는다)', () => {
  it('map-failure·안내문이 보이고 onLoadFailed 는 재렌더해도 1회, 로더는 호출되지 않는다', () => {
    delete process.env[CLIENT_ID_KEY];
    const first = jest.fn();
    const second = jest.fn();
    // 앵커 — 렌더 전엔 호출 0.
    expect(first).not.toHaveBeenCalled();

    const { rerender } = render(
      <MapView center={CENTER} onLoadFailed={first} />
    );

    expect(screen.getByTestId('map-failure')).toBeTruthy();
    // RNTL 문자열 매처는 완전일치라 정규식으로 센다(네이티브 MapView.test.tsx AC5 와 같은 관례).
    expect(screen.getByText(/지도를 불러오지 못했어요/)).toBeTruthy();
    expect(first).toHaveBeenCalledTimes(1);

    rerender(<MapView center={CENTER} onLoadFailed={second} />);

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
    expect(mockLoader.load).not.toHaveBeenCalled();
  });
});

describe('로딩 중 — 실패 표면 없이 map-root, 키를 로더에 넘기고 인증 실패를 구독한다', () => {
  it('load 가 안 풀리는 동안 map-root 만 있고 map-failure 는 없다', () => {
    const onLoadFailed = jest.fn();

    render(<MapView center={CENTER} onLoadFailed={onLoadFailed} />);

    expect(screen.getByTestId('map-root')).toBeTruthy();
    expect(screen.queryByTestId('map-failure')).toBeNull();
    expect(mockLoader.load).toHaveBeenCalledTimes(1);
    expect(mockLoader.load).toHaveBeenCalledWith('test-naver-client-id');
    expect(mockLoader.onAuthFailure).toHaveBeenCalledTimes(1);
    expect(onLoadFailed).not.toHaveBeenCalled();
  });

  it('언마운트하면 인증 실패 구독을 해제한다', () => {
    const unsubscribe = jest.fn();
    mockLoader.onAuthFailure.mockImplementation(() => unsubscribe);
    const { unmount } = render(<MapView center={CENTER} />);
    expect(unsubscribe).not.toHaveBeenCalled();

    unmount();

    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});

describe('AC-2 — 스크립트 로드 실패 → 실패 표면 + 1회, 다시 마운트하면 다시 시도', () => {
  it('load 거부 → map-failure + onLoadFailed 1회', async () => {
    mockLoader.load.mockRejectedValue(new Error('script error'));
    const onLoadFailed = jest.fn();

    render(<MapView center={CENTER} onLoadFailed={onLoadFailed} />);

    await waitFor(() => expect(screen.getByTestId('map-failure')).toBeTruthy());
    expect(onLoadFailed).toHaveBeenCalledTimes(1);
  });

  it('실패 뒤 다시 마운트하면 로드를 다시 시도한다(폴백 바 "재시도")', async () => {
    mockLoader.load.mockRejectedValueOnce(new Error('script error'));
    const first = render(<MapView center={CENTER} onLoadFailed={jest.fn()} />);
    await waitFor(() => expect(screen.getByTestId('map-failure')).toBeTruthy());
    expect(mockLoader.load).toHaveBeenCalledTimes(1);
    first.unmount();

    // 두 번째 시도의 로더는 안 풀리는 상태 — 컴포넌트가 새로 로드를 부르는지만 본다.
    render(<MapView center={CENTER} onLoadFailed={jest.fn()} />);

    expect(mockLoader.load).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId('map-failure')).toBeNull();
  });
});

describe('AC-3 — navermap_authFailure → 실패 표면 + 1회', () => {
  it('인증 실패 통지가 오면 map-failure + onLoadFailed 1회, 거듭 와도 1회', () => {
    let notify: () => void = () => {};
    mockLoader.onAuthFailure.mockImplementation((cb: () => void) => {
      notify = cb;
      return () => {};
    });
    const onLoadFailed = jest.fn();
    render(<MapView center={CENTER} onLoadFailed={onLoadFailed} />);
    // 앵커 — 통지 전엔 정상 로딩.
    expect(screen.queryByTestId('map-failure')).toBeNull();

    act(() => notify());
    expect(screen.getByTestId('map-failure')).toBeTruthy();
    expect(onLoadFailed).toHaveBeenCalledTimes(1);

    act(() => notify());
    expect(onLoadFailed).toHaveBeenCalledTimes(1);
  });

  it('인증 실패가 이미 있었던 로더에 새로 마운트해도 곧바로 실패 표면', () => {
    // 이미 실패한 로더는 구독하는 순간 콜백을 바로 부른다(로더 테스트가 지키는 계약).
    mockLoader.onAuthFailure.mockImplementation((cb: () => void) => {
      cb();
      return () => {};
    });
    const onLoadFailed = jest.fn();

    render(<MapView center={CENTER} onLoadFailed={onLoadFailed} />);

    expect(screen.getByTestId('map-failure')).toBeTruthy();
    expect(onLoadFailed).toHaveBeenCalledTimes(1);
  });

  it('로드 거부와 인증 실패가 겹쳐도 onLoadFailed 는 총 1회', async () => {
    let notify: () => void = () => {};
    mockLoader.onAuthFailure.mockImplementation((cb: () => void) => {
      notify = cb;
      return () => {};
    });
    mockLoader.load.mockRejectedValue(new Error('script error'));
    const onLoadFailed = jest.fn();
    render(<MapView center={CENTER} onLoadFailed={onLoadFailed} />);
    await waitFor(() => expect(screen.getByTestId('map-failure')).toBeTruthy());

    act(() => notify());

    expect(onLoadFailed).toHaveBeenCalledTimes(1);
  });
});

/**
 * 5-b 보강(code-critic 03b B1) — 로더가 **성공한 뒤**의 껍데기 배선: 입력을 컨트롤러에 넘기고, 마커 탭을
 * `onPinTap` 으로 돌려주고, 크기 변화에 재맞춤하고, 언마운트에 정리하는 effect 들.
 *
 * 초심자용 — 새 개념 둘.
 * - `createNodeMock`: 테스트 렌더러엔 진짜 DOM 이 없어 `<div ref>` 가 `null` 이 된다. 이 옵션이 "div 의 ref 자리에 넣을
 *   가짜 요소"를 정해 준다. 가짜가 들어와야 컴포넌트가 컨트롤러를 만든다(위 상단 주석의 "jest 불가"는 이걸로 해소).
 * - `ResizeObserver`: 요소 크기가 바뀌면 알려 주는 브라우저 API. 테스트에선 전역에 가짜를 꽂아 콜백을 우리가 직접 부른다.
 * 가짜 `naver.maps` 는 컨트롤러 테스트와 같은 생각 — 무엇이 만들어졌는지 기록하고, 테스트는 그 **값**(좌표·클릭 index·
 * fitBounds 모서리·Map 옵션)을 본다. 컨트롤러는 진짜를 쓴다(로더만 가짜).
 */
class FakeLatLng {
  constructor(
    public latValue: number,
    public lngValue: number
  ) {}
  // 진짜 LatLng 는 좌표를 lat()/lng() 메서드로 읽는다 — getCenter() 결과를 읽는 코드가 이걸 써야 한다.
  lat() {
    return this.latValue;
  }
  lng() {
    return this.lngValue;
  }
}
class FakeBounds {
  constructor(
    public sw: FakeLatLng,
    public ne: FakeLatLng
  ) {}
}
class FakeNaverMap {
  fitBounds = jest.fn();
  setCenter = jest.fn();
  setOptions = jest.fn();
  autoResize = jest.fn();
  destroy = jest.fn();
  getCenter = jest.fn(() => new FakeLatLng(0, 0));
  constructor(
    public element: unknown,
    public options: Record<string, unknown>
  ) {}
}
class FakeOverlay {
  map: unknown;
  setMap = jest.fn((map: unknown) => {
    this.map = map;
  });
  setPosition = jest.fn((position: unknown) => {
    this.options.position = position;
  });
  constructor(public options: Record<string, unknown>) {
    this.map = options.map ?? null;
  }
}

function makeFakeNaver() {
  const made = {
    maps: [] as FakeNaverMap[],
    markers: [] as FakeOverlay[],
    circles: [] as FakeOverlay[],
    polylines: [] as FakeOverlay[],
    listeners: [] as { target: unknown; name: string; handler: () => void }[],
  };
  const maps = {
    LatLng: FakeLatLng,
    Point: class {
      constructor(
        public x: number,
        public y: number
      ) {}
    },
    LatLngBounds: FakeBounds,
    Map: class extends FakeNaverMap {
      constructor(element: unknown, options: Record<string, unknown>) {
        super(element, options);
        made.maps.push(this);
      }
    },
    Marker: class extends FakeOverlay {
      constructor(options: Record<string, unknown>) {
        super(options);
        made.markers.push(this);
      }
    },
    Circle: class extends FakeOverlay {
      constructor(options: Record<string, unknown>) {
        super(options);
        made.circles.push(this);
      }
    },
    Polyline: class extends FakeOverlay {
      constructor(options: Record<string, unknown>) {
        super(options);
        made.polylines.push(this);
      }
    },
    Event: {
      addListener: (target: unknown, name: string, handler: () => void) => {
        made.listeners.push({ target, name, handler });
        return {};
      },
    },
  };
  return { naver: { maps } as unknown as NaverMapsApi, made };
}

class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  observe = jest.fn();
  disconnect = jest.fn();
  constructor(public callback: () => void) {
    FakeResizeObserver.instances.push(this);
  }
}

// 모듈 싱글턴처럼 새는 전역은 파일 최상위 afterEach 로 되돌린다(describe 안에만 걸면 앞 테스트 상태가 샌다).
afterEach(() => {
  delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
  FakeResizeObserver.instances = [];
});

const FAKE_ELEMENT = { fake: 'div' };
const PINS: MapPin[] = [
  { number: 2, lat: 33.51, lng: 126.52 },
  { number: 5, lat: 33.515, lng: 126.526 },
  { number: 9, lat: 33.52, lng: 126.53 },
];

/** 가짜 요소를 ref 로 주고, 로더가 가짜 naver 로 풀리게 한 채 렌더한 뒤 지도가 만들어질 때까지 기다린다. */
async function renderLoaded(ui: React.ReactElement) {
  const { naver, made } = makeFakeNaver();
  mockLoader.load.mockResolvedValue(naver);
  const view = render(ui, { createNodeMock: () => FAKE_ELEMENT });
  // 앵커 — 로더가 풀리기 전엔 지도가 없다.
  expect(made.maps).toHaveLength(0);
  await waitFor(() => expect(made.maps).toHaveLength(1));
  return { ...view, made };
}
function tap(
  made: ReturnType<typeof makeFakeNaver>['made'],
  marker: FakeOverlay
) {
  const listener = made.listeners.find(
    (l) => l.target === marker && l.name === 'click'
  );
  if (!listener) throw new Error('마커에 click 리스너가 없다');
  listener.handler();
}

describe('성공 경로 — 입력이 지도에 닿는다(B1)', () => {
  it('div 요소로 지도를 만들고 center·핀을 넘기며, 다시 렌더해 핀이 바뀌면 마커가 새로 만들어진다', async () => {
    const { rerender, made } = await renderLoaded(
      <MapView center={CENTER} pins={PINS} />
    );

    const map = made.maps[0];
    expect(map.element).toBe(FAKE_ELEMENT);
    const opened = map.options.center as FakeLatLng;
    expect(opened.latValue).toBeCloseTo(CENTER.lat, 9);
    expect(opened.lngValue).toBeCloseTo(CENTER.lng, 9);
    expect(made.markers).toHaveLength(3);
    made.markers.forEach((marker, i) => {
      const position = marker.options.position as FakeLatLng;
      expect(position.latValue).toBeCloseTo(PINS[i].lat, 9);
      expect(position.lngValue).toBeCloseTo(PINS[i].lng, 9);
      expect(marker.map).toBe(map);
    });

    rerender(
      <MapView
        center={CENTER}
        pins={PINS.map((p, i) => (i === 1 ? { ...p, lat: 33.6 } : p))}
      />
    );

    expect(made.maps).toHaveLength(1);
    expect(made.markers).toHaveLength(6);
    made.markers.slice(0, 3).forEach((m) => expect(m.map).toBeNull());
    expect(
      (made.markers[4].options.position as FakeLatLng).latValue
    ).toBeCloseTo(33.6, 9);
  });

  it('fitPins·fitBand 가 fitBounds 모서리 값으로, radiusCircle 이 원 반경 값으로 나타난다', async () => {
    const band = { top: 0.2, bottom: 0.5 };
    const radiusCircle = { center: CENTER, radiusM: 1200 };
    const { made } = await renderLoaded(
      <MapView
        center={CENTER}
        pins={PINS}
        fitPins
        fitBand={band}
        radiusCircle={radiusCircle}
      />
    );

    const map = made.maps[0];
    expect(map.fitBounds).toHaveBeenCalledTimes(1);
    const bounds = map.fitBounds.mock.calls[0][0] as FakeBounds;
    const expected = regionToCorners(
      buildFitRegion(
        PINS.map((p) => ({ lat: p.lat, lng: p.lng })),
        band
      )!
    );
    expect(bounds.sw.latValue).toBeCloseTo(expected.sw.lat, 6);
    expect(bounds.sw.lngValue).toBeCloseTo(expected.sw.lng, 6);
    expect(bounds.ne.latValue).toBeCloseTo(expected.ne.lat, 6);
    expect(bounds.ne.lngValue).toBeCloseTo(expected.ne.lng, 6);
    expect(made.circles).toHaveLength(1);
    expect(made.circles[0].options.radius).toBe(1200);
  });

  it('viewOnly 는 Map 옵션 값으로 나타나고, 나중에 바뀌면 setOptions 로 반영된다', async () => {
    const { rerender, made } = await renderLoaded(
      <MapView center={CENTER} viewOnly />
    );
    const map = made.maps[0];
    expect(map.options).toMatchObject({
      draggable: false,
      pinchZoom: false,
      scrollWheel: false,
      keyboardShortcuts: false,
    });
    expect(map.setOptions).not.toHaveBeenCalled();

    rerender(<MapView center={CENTER} viewOnly={false} />);

    expect(map.setOptions).toHaveBeenLastCalledWith({
      draggable: true,
      pinchZoom: true,
      scrollWheel: true,
      keyboardShortcuts: true,
    });
  });
});

describe('성공 경로 — 마커 탭 → onPinTap(B1)', () => {
  it('번호 [2,5,9] 의 세 번째 마커를 누르면 번호가 아니라 배열 위치 2 가 넘어간다', async () => {
    const onPinTap = jest.fn();
    const { made } = await renderLoaded(
      <MapView center={CENTER} pins={PINS} onPinTap={onPinTap} />
    );
    // 앵커 — 탭 전엔 호출 0.
    expect(onPinTap).not.toHaveBeenCalled();

    tap(made, made.markers[2]);
    expect(onPinTap).toHaveBeenCalledTimes(1);
    expect(onPinTap).toHaveBeenLastCalledWith(2);

    tap(made, made.markers[0]);
    expect(onPinTap).toHaveBeenLastCalledWith(0);
  });

  it('부모가 새 onPinTap 을 넘기면 마커를 다시 안 만들어도 새 콜백이 불린다(옛 콜백은 안 불림)', async () => {
    const stale = jest.fn();
    const fresh = jest.fn();
    const { rerender, made } = await renderLoaded(
      <MapView center={CENTER} pins={PINS} onPinTap={stale} />
    );

    rerender(<MapView center={CENTER} pins={PINS} onPinTap={fresh} />);
    expect(made.markers).toHaveLength(3);
    tap(made, made.markers[1]);

    expect(fresh).toHaveBeenCalledTimes(1);
    expect(fresh).toHaveBeenLastCalledWith(1);
    expect(stale).not.toHaveBeenCalled();
  });
});

describe('성공 경로 — 크기 변화 재맞춤·언마운트 정리(B1)', () => {
  it('ResizeObserver 가 요소를 관측하고, 콜백이 오면 지도 크기를 다시 재고 같은 영역으로 다시 맞춘다', async () => {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver =
      FakeResizeObserver;
    const { made } = await renderLoaded(
      <MapView center={CENTER} pins={PINS} fitPins />
    );

    expect(FakeResizeObserver.instances).toHaveLength(1);
    const observer = FakeResizeObserver.instances[0];
    expect(observer.observe).toHaveBeenCalledWith(FAKE_ELEMENT);
    const map = made.maps[0];
    // 앵커 — 크기 변화 전엔 맞춤 1회, 크기 재기 0회.
    expect(map.fitBounds).toHaveBeenCalledTimes(1);
    expect(map.autoResize).not.toHaveBeenCalled();

    observer.callback();

    expect(map.autoResize).toHaveBeenCalledTimes(1);
    expect(map.fitBounds).toHaveBeenCalledTimes(2);
    expect(map.fitBounds.mock.calls[1][0]).toEqual(
      map.fitBounds.mock.calls[0][0]
    );
  });

  it('언마운트하면 관찰을 끊고, 마커·원·지도(destroy)를 정리한다', async () => {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver =
      FakeResizeObserver;
    const { unmount, made } = await renderLoaded(
      <MapView
        center={CENTER}
        pins={PINS}
        radiusCircle={{ center: CENTER, radiusM: 500 }}
      />
    );
    const map = made.maps[0];
    const observer = FakeResizeObserver.instances[0];
    // 앵커 — 언마운트 전엔 아무것도 정리되지 않았다.
    expect(map.destroy).not.toHaveBeenCalled();
    expect(observer.disconnect).not.toHaveBeenCalled();

    unmount();

    expect(observer.disconnect).toHaveBeenCalledTimes(1);
    expect(map.destroy).toHaveBeenCalledTimes(1);
    made.markers.forEach((m) => expect(m.map).toBeNull());
    expect(made.circles[0].map).toBeNull();
  });
});

/**
 * 웹 스모크 실결함 — 지도·마커를 만든 **뒤에** 네이버가 인증 실패(`navermap_authFailure`)를 알리는 경우.
 * 네이버 내부는 이미 반쯤 망가져 마커 `setMap(null)` 이 던지는데, 컴포넌트는 실패 표면으로 바꾸며 컨트롤러를 정리한다.
 * 여기서 던지면 `Uncaught Error: Cannot read properties of null (reading 'capitalize')` 로 앱 전체가 레드박스(INV-4 위반).
 *
 * 초심자용 — (준비) 지도가 만들어진 뒤 마커·지도의 정리 호출이 던지게 바꾸고, 인증 실패 통지 함수를 붙잡아 둔다.
 * (실행) `act` 안에서 통지 → (단언) 던지지 않고, 실패 표면 + `onLoadFailed` 1회, 정리는 계속 시도됐다.
 */
describe('성공 경로 — 지도가 만들어진 뒤 인증 실패 통지(INV-4)', () => {
  it('정리 호출이 던져도 레드박스 없이 실패 표면 + onLoadFailed 1회, 나머지 정리는 이어진다', async () => {
    let notify: () => void = () => {};
    mockLoader.onAuthFailure.mockImplementation((cb: () => void) => {
      notify = cb;
      return () => {};
    });
    const onLoadFailed = jest.fn();
    const { made } = await renderLoaded(
      <MapView center={CENTER} pins={PINS} onLoadFailed={onLoadFailed} />
    );
    const map = made.maps[0];
    const boom = () => {
      throw new Error('naver internal: capitalize of null');
    };
    made.markers[0].setMap.mockImplementation(boom);
    map.destroy.mockImplementation(boom);
    // 앵커 — 통지 전엔 실패 표면 없음·정리 0회.
    expect(screen.queryByTestId('map-failure')).toBeNull();
    expect(onLoadFailed).not.toHaveBeenCalled();
    expect(map.destroy).not.toHaveBeenCalled();

    expect(() => act(() => notify())).not.toThrow();

    expect(screen.getByTestId('map-failure')).toBeTruthy();
    expect(onLoadFailed).toHaveBeenCalledTimes(1);
    expect(made.markers[0].setMap).toHaveBeenCalledWith(null);
    expect(made.markers[1].map).toBeNull();
    expect(made.markers[2].map).toBeNull();
    expect(map.destroy).toHaveBeenCalledTimes(1);
  });
});

/**
 * TRIP-1652 (W6) — 웹 `MapView` 껍데기 이음부: 경로선·카메라 idle·내 위치가 **컴포넌트 입구(prop)에서 지도(가짜 naver)까지**
 * 이어지는지. AC-1~6, AC-8~10. (W5 1차 리뷰의 교훈 — 컨트롤러 단위 테스트만 있으면 껍데기가 prop 을 안 넘겨도 green 이다.)
 *
 * 초심자용 — 위 「성공 경로」와 같은 준비(로더=가짜, `createNodeMock`=가짜 div, 컨트롤러=진짜)에 더해:
 * - 위치는 `expo-location` 모듈을 가짜로 바꿔 "권한 상태"와 "위치가 바뀌었다는 호출"을 흉내 낸다(`mockLocation`).
 * - `CenterPinPicker` 통합은 파일 위쪽 `jest.mock('./MapView', …)` 로 picker 가 웹 `MapView` 를 쓰게 한 것이다.
 *   `made.maps.length === 1`(가짜 네이버 지도가 실제로 생김)이 "네이티브 MapView 가 아니라 웹이 선택됐다"의 증거다.
 * 단언은 값(경로 좌표 열·색 구분·개수·idle 로 올라온 {lat,lng}·marker 좌표)이고 prop 전달 여부가 아니다.
 */
type FakeMade = ReturnType<typeof makeFakeNaver>['made'];
const liveLines = (made: FakeMade) =>
  made.polylines.filter((p) => p.map !== null);
const linePath = (line: FakeOverlay) =>
  (line.options.path as FakeLatLng[]).map((p) => ({
    lat: p.latValue,
    lng: p.lngValue,
  }));
const dashed = (line: FakeOverlay) =>
  line.options.strokeStyle !== undefined &&
  line.options.strokeStyle !== 'solid';
const idleListeners = (made: FakeMade) =>
  made.listeners.filter((l) => l.name === 'idle');
const flushMicrotasks = async () => {
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
};
const PIN_COORDS = PINS.map((p) => ({ lat: p.lat, lng: p.lng }));
const ROUTE_A = [
  { lat: 33.511, lng: 126.521 },
  { lat: 33.512, lng: 126.522 },
];
const ROUTE_B = [
  { lat: 33.531, lng: 126.541 },
  { lat: 33.532, lng: 126.542 },
];

describe('이음부 — 경로선(AC-1·2·3·4)', () => {
  it('핀 3개를 주면 흰 케이싱 + primary 선이 핀 좌표 순서로 그려지고, 값이 같은 재렌더는 선을 안 건드리며, 핀이 바뀌면 다시 그린다', async () => {
    const { rerender, made } = await renderLoaded(
      <MapView center={CENTER} pins={PINS} />
    );

    const lines = liveLines(made);
    expect(lines).toHaveLength(2);
    expect(lines.map(linePath)).toEqual([PIN_COORDS, PIN_COORDS]);
    expect(lines[0].options.strokeColor).toBe('#FFFFFF');
    expect(lines[1].options.strokeColor).toBe('#FF385C');
    expect(lines.every((l) => l.map === made.maps[0])).toBe(true);

    rerender(<MapView center={CENTER} pins={PINS.map((p) => ({ ...p }))} />);
    expect(made.polylines).toHaveLength(2);
    lines.forEach((l) => expect(l.setMap).not.toHaveBeenCalled());

    rerender(
      <MapView
        center={CENTER}
        pins={PINS.map((p, i) => (i === 2 ? { ...p, lat: 33.6 } : p))}
      />
    );
    lines.forEach((l) => expect(l.map).toBeNull());
    expect(liveLines(made).map(linePath)).toEqual([
      [...PIN_COORDS.slice(0, 2), { lat: 33.6, lng: PINS[2].lng }],
      [...PIN_COORDS.slice(0, 2), { lat: 33.6, lng: PINS[2].lng }],
    ]);
  });

  it('connectPins={false} 면 선이 없고(핀은 그대로), 다시 켜면 생긴다', async () => {
    const { rerender, made } = await renderLoaded(
      <MapView center={CENTER} pins={PINS} connectPins={false} />
    );
    expect(made.markers).toHaveLength(3);
    expect(liveLines(made)).toHaveLength(0);

    rerender(<MapView center={CENTER} pins={PINS} connectPins />);

    expect(liveLines(made)).toHaveLength(2);
  });

  it('actualRoute 를 주면 세그먼트마다 점선이 그려지고 계획선은 한 줄로 낮아진다', async () => {
    const { made } = await renderLoaded(
      <MapView
        center={CENTER}
        pins={PINS}
        actualRoute={[ROUTE_A, [{ lat: 1, lng: 1 }], ROUTE_B]}
      />
    );

    const lines = liveLines(made);
    const routes = lines.filter(dashed);
    const plans = lines.filter((l) => !dashed(l));
    expect(routes.map(linePath)).toEqual([ROUTE_A, ROUTE_B]);
    expect(plans).toHaveLength(1);
    expect(linePath(plans[0])).toEqual(PIN_COORDS);
    expect(plans[0].options.strokeColor).toBe('#9AA1AB');
  });

  it.each([[true], [{ durationMs: 650, delayMs: 300 }]])(
    'drawPathOnMount=%j 를 줘도 애니메이션 없이 선과 핀 전부가 곧바로 생기고, 선 옵션에 시간 필드가 없다',
    async (drawPathOnMount) => {
      const { made } = await renderLoaded(
        <MapView
          center={CENTER}
          pins={PINS}
          drawPathOnMount={drawPathOnMount}
        />
      );

      expect(made.markers).toHaveLength(PINS.length);
      expect(liveLines(made)).toHaveLength(2);
      for (const line of made.polylines) {
        expect(Object.keys(line.options).join(' ')).not.toMatch(
          /duration|delay|minute|eta|time/i
        );
      }
    }
  );
});

describe('이음부 — onCameraIdle(AC-5)', () => {
  it('주면 지도가 멈출 때마다 getCenter 의 위도·경도가 {lat,lng} 로 올라오고, 부모가 새 콜백을 넘기면 새 콜백만 불린다', async () => {
    const stale = jest.fn();
    const fresh = jest.fn();
    const { rerender, made } = await renderLoaded(
      <MapView center={CENTER} onCameraIdle={stale} />
    );
    const map = made.maps[0];
    // 앵커 — 리스너는 지도에 하나, 아직 아무 콜백도 안 불렸다.
    expect(idleListeners(made)).toHaveLength(1);
    expect(idleListeners(made)[0].target).toBe(map);
    expect(stale).not.toHaveBeenCalled();

    map.getCenter.mockReturnValue(new FakeLatLng(33.25, 126.75));
    idleListeners(made)[0].handler();
    expect(stale).toHaveBeenLastCalledWith({ lat: 33.25, lng: 126.75 });

    rerender(<MapView center={CENTER} onCameraIdle={fresh} />);
    expect(idleListeners(made)).toHaveLength(1);
    map.getCenter.mockReturnValue(new FakeLatLng(34.5, 127.5));
    idleListeners(made)[0].handler();

    expect(fresh).toHaveBeenCalledTimes(1);
    expect(fresh).toHaveBeenLastCalledWith({ lat: 34.5, lng: 127.5 });
    expect(stale).toHaveBeenCalledTimes(1);
  });

  it('안 주면 idle 리스너를 붙이지 않는다(마커 click 리스너는 정상)', async () => {
    const { made } = await renderLoaded(
      <MapView center={CENTER} pins={PINS} onPinTap={jest.fn()} />
    );

    expect(made.listeners.filter((l) => l.name === 'click')).toHaveLength(3);
    expect(idleListeners(made)).toHaveLength(0);
  });

  it('언마운트한 뒤, 또는 인증 실패로 실패 표면이 된 뒤 늦게 발화해도 콜백은 불리지 않는다', async () => {
    let notify: () => void = () => {};
    mockLoader.onAuthFailure.mockImplementation((cb: () => void) => {
      notify = cb;
      return () => {};
    });
    const onCameraIdle = jest.fn();
    const failedRun = await renderLoaded(
      <MapView center={CENTER} onCameraIdle={onCameraIdle} />
    );
    const failedHandler = idleListeners(failedRun.made)[0].handler;
    act(() => notify());
    expect(screen.getByTestId('map-failure')).toBeTruthy();
    failedHandler();
    expect(onCameraIdle).not.toHaveBeenCalled();
    failedRun.unmount();

    mockLoader.onAuthFailure.mockImplementation(() => () => {});
    const unmounted = await renderLoaded(
      <MapView center={CENTER} onCameraIdle={onCameraIdle} />
    );
    const handler = idleListeners(unmounted.made)[0].handler;
    unmounted.unmount();
    handler();

    expect(onCameraIdle).not.toHaveBeenCalled();
  });
});

describe('이음부 — CenterPinPicker + 웹 MapView(AC-6)', () => {
  it('마운트 때 center 를 한 번만 포획하고, 지도가 멈추면 그 중심이 onPick({lat,lng}) 로 올라간다', async () => {
    const onPick = jest.fn();
    const { rerender, made } = await renderLoaded(
      <CenterPinPicker center={CENTER} onPick={onPick} />
    );

    // 웹 MapView 가 골라졌다 — 가짜 네이버 지도가 생겼고 네이티브 목 지도(map-native)는 없다.
    expect(made.maps).toHaveLength(1);
    expect(screen.queryByTestId('map-native')).toBeNull();
    expect(screen.getByTestId('center-pin-picker')).toBeTruthy();
    expect(screen.getByTestId('map-center-pin')).toBeTruthy();
    expect(screen.queryByTestId('map-failure')).toBeNull();
    const map = made.maps[0];
    expect((map.options.center as FakeLatLng).latValue).toBeCloseTo(
      CENTER.lat,
      9
    );
    expect(onPick).not.toHaveBeenCalled();

    // center prop 이 바뀌어도 지도를 되돌리지 않는다(되먹임 방지).
    rerender(
      <CenterPinPicker center={{ lat: 35, lng: 129 }} onPick={onPick} />
    );
    expect(map.setCenter).not.toHaveBeenCalled();
    expect(made.maps).toHaveLength(1);

    // 첫 멈춤도 그대로 올라가고, 두 번째 멈춤은 새 좌표(위도≠경도라 축이 바뀌면 잡힌다).
    map.getCenter.mockReturnValue(new FakeLatLng(33.5, 126.5));
    idleListeners(made)[0].handler();
    expect(onPick).toHaveBeenLastCalledWith({ lat: 33.5, lng: 126.5 });
    map.getCenter.mockReturnValue(new FakeLatLng(33.6, 126.7));
    idleListeners(made)[0].handler();
    expect(onPick).toHaveBeenCalledTimes(2);
    expect(onPick).toHaveBeenLastCalledWith({ lat: 33.6, lng: 126.7 });
  });
});

describe('이음부 — 내 위치(AC-8·9·10)', () => {
  type Pos = { coords: { latitude: number; longitude: number } };
  function armWatch() {
    const subscription = { remove: jest.fn() };
    const state: { emit: (p: Pos) => void } = { emit: () => {} };
    mockLocation.watchPositionAsync.mockImplementation(
      async (_options: unknown, callback: (p: Pos) => void) => {
        state.emit = callback;
        return subscription;
      }
    );
    return { subscription, state };
  }
  const here = (lat: number, lng: number): Pos => ({
    coords: { latitude: lat, longitude: lng },
  });
  const noAsk = () => {
    expect(
      mockLocation.requestForegroundPermissionsAsync
    ).not.toHaveBeenCalled();
    expect(mockLocation.getCurrentPositionAsync).not.toHaveBeenCalled();
  };

  it('권한이 granted 면 위치가 오는 대로 점 1개가 옮겨 다니고, 끄거나 언마운트하면 점이 걷히고 감시가 끊긴다', async () => {
    mockLocation.getForegroundPermissionsAsync.mockResolvedValue({
      status: 'granted',
    });
    const { subscription, state } = armWatch();
    const { rerender, unmount, made } = await renderLoaded(
      <MapView center={CENTER} showMyLocation />
    );
    await waitFor(() =>
      expect(mockLocation.watchPositionAsync).toHaveBeenCalledTimes(1)
    );
    // 앵커 — 감시는 시작됐지만 위치가 아직 안 와 점이 없다.
    expect(made.markers).toHaveLength(0);

    state.emit(here(33.3, 126.4));
    state.emit(here(33.31, 126.41));

    expect(made.markers).toHaveLength(1);
    const dot = made.markers[0];
    expect((dot.options.position as FakeLatLng).latValue).toBeCloseTo(33.31, 9);
    expect((dot.options.position as FakeLatLng).lngValue).toBeCloseTo(
      126.41,
      9
    );
    expect(dot.map).toBe(made.maps[0]);
    noAsk();

    rerender(<MapView center={CENTER} showMyLocation={false} />);
    expect(dot.map).toBeNull();
    expect(subscription.remove).toHaveBeenCalledTimes(1);

    rerender(<MapView center={CENTER} showMyLocation />);
    await waitFor(() =>
      expect(mockLocation.watchPositionAsync).toHaveBeenCalledTimes(2)
    );
    state.emit(here(33.4, 126.5));
    const second = made.markers[made.markers.length - 1];
    expect(second.map).toBe(made.maps[0]);

    unmount();
    expect(second.map).toBeNull();
    expect(subscription.remove).toHaveBeenCalledTimes(2);
  });

  it.each(['denied', 'undetermined'])(
    '권한이 %s 면 점도 감시도 없고, 묻지 않으며, 지도는 정상이다(실패 표면·onLoadFailed 없음)',
    async (status) => {
      mockLocation.getForegroundPermissionsAsync.mockResolvedValue({ status });
      const onLoadFailed = jest.fn();
      const { made } = await renderLoaded(
        <MapView
          center={CENTER}
          pins={PINS}
          showMyLocation
          onLoadFailed={onLoadFailed}
        />
      );
      await waitFor(() =>
        expect(
          mockLocation.getForegroundPermissionsAsync
        ).toHaveBeenCalledTimes(1)
      );
      await flushMicrotasks();

      expect(mockLocation.watchPositionAsync).not.toHaveBeenCalled();
      noAsk();
      expect(made.markers).toHaveLength(PINS.length);
      expect(screen.queryByTestId('map-failure')).toBeNull();
      expect(onLoadFailed).not.toHaveBeenCalled();
    }
  );

  it('권한 조회가 동기로 던지거나 거부돼도 점 없이 지도는 정상이고 실패 표면으로 가지 않는다', async () => {
    mockLocation.getForegroundPermissionsAsync.mockImplementation(() => {
      throw new Error('no permissions api');
    });
    const first = await renderLoaded(
      <MapView center={CENTER} pins={PINS} showMyLocation />
    );
    await flushMicrotasks();
    expect(mockLocation.getForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(first.made.markers).toHaveLength(PINS.length);
    expect(screen.queryByTestId('map-failure')).toBeNull();
    first.unmount();

    mockLocation.getForegroundPermissionsAsync.mockReset();
    mockLocation.getForegroundPermissionsAsync.mockRejectedValue(
      new Error('x')
    );
    const second = await renderLoaded(
      <MapView center={CENTER} pins={PINS} showMyLocation />
    );
    await flushMicrotasks();

    expect(mockLocation.getForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(second.made.markers).toHaveLength(PINS.length);
    expect(screen.queryByTestId('map-failure')).toBeNull();
    noAsk();
  });

  it('showMyLocation 을 안 주면 권한 조회도 없다 — 켠 지도에서는 조회한다(짝)', async () => {
    mockLocation.getForegroundPermissionsAsync.mockResolvedValue({
      status: 'denied',
    });
    const off = await renderLoaded(<MapView center={CENTER} pins={PINS} />);
    await flushMicrotasks();
    expect(mockLocation.getForegroundPermissionsAsync).not.toHaveBeenCalled();
    off.unmount();

    await renderLoaded(<MapView center={CENTER} showMyLocation />);
    await waitFor(() =>
      expect(mockLocation.getForegroundPermissionsAsync).toHaveBeenCalledTimes(
        1
      )
    );
  });
});
