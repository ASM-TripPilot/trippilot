import { act, render, screen, waitFor } from '@testing-library/react-native';

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
  constructor(public options: Record<string, unknown>) {
    this.map = options.map ?? null;
  }
}

function makeFakeNaver() {
  const made = {
    maps: [] as FakeNaverMap[],
    markers: [] as FakeOverlay[],
    circles: [] as FakeOverlay[],
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
