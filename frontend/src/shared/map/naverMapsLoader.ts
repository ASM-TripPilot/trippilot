/**
 * 네이버 지도 JS v3(웹) 스크립트 로더. `document`·`window` 를 인자로 받아(의존성 주입) jest 가 가짜를 꽂을 수 있다.
 * 실패(키 부재·스크립트 오류·`naver.maps` 없음)는 거부로 알리고 캐시하지 않는다 — 폴백 바 "재시도"가 새로 시도하게(INV-4).
 */

/** 컨트롤러가 쓰는 `naver.maps` 면만 손으로 선언한다(@types/navermaps 미추가). 이름은 maps.js 3.10.5 로 확인. */
export type NaverLatLng = object;
export type NaverPoint = object;
export type NaverBounds = object;
export interface NaverOverlay {
  setMap(map: NaverMap | null): void;
}
export interface NaverMap {
  fitBounds(bounds: NaverBounds): void;
  setCenter(center: NaverLatLng): void;
  setOptions(options: Record<string, unknown>): void;
  autoResize(): void;
  destroy(): void;
}
export interface NaverMapsApi {
  maps: {
    Map: new (
      element: HTMLElement,
      options: Record<string, unknown>
    ) => NaverMap;
    LatLng: new (lat: number, lng: number) => NaverLatLng;
    LatLngBounds: new (sw: NaverLatLng, ne: NaverLatLng) => NaverBounds;
    Point: new (x: number, y: number) => NaverPoint;
    Marker: new (options: {
      position: NaverLatLng;
      map: NaverMap;
      icon: { content: string; anchor: NaverPoint };
    }) => NaverOverlay;
    Circle: new (options: Record<string, unknown>) => NaverOverlay;
    Event: {
      addListener(target: unknown, name: string, handler: () => void): unknown;
    };
  };
}

export interface LoaderScript {
  src: string;
  async: boolean;
  onload: (() => void) | null;
  onerror: (() => void) | null;
  remove(): void;
}
export interface LoaderDoc {
  createElement(tag: 'script'): LoaderScript;
  head: {
    appendChild(node: LoaderScript): unknown;
    removeChild(node: LoaderScript): unknown;
  };
}
export interface LoaderWin {
  naver?: NaverMapsApi;
  navermap_authFailure?: () => void;
}

export interface NaverMapsLoader {
  load(clientId: string | undefined): Promise<NaverMapsApi>;
  /** 인증 실패(`navermap_authFailure`) 통지 구독. 이미 실패한 뒤에 구독해도 곧바로 통지한다. 반환값 = 구독 해제. */
  onAuthFailure(listener: () => void): () => void;
}

const MAPS_SRC = 'https://oapi.map.naver.com/openapi/v3/maps.js';

export function createNaverMapsLoader(env: {
  doc: LoaderDoc;
  win: LoaderWin;
}): NaverMapsLoader {
  const { doc, win } = env;
  let pending: Promise<NaverMapsApi> | null = null;
  let authFailed = false;
  const listeners = new Set<() => void>();

  return {
    load(clientId) {
      if (!clientId) {
        return Promise.reject(new Error('naver map client id is missing'));
      }
      // 네이버가 인증 실패 때 부르는 전역 콜백 — 스크립트가 뜨기 전에 먼저 설치한다.
      win.navermap_authFailure = () => {
        authFailed = true;
        listeners.forEach((listener) => listener());
      };
      if (pending) return pending;
      pending = new Promise<NaverMapsApi>((resolve, reject) => {
        const script = doc.createElement('script');
        const fail = (message: string): void => {
          pending = null;
          script.remove();
          reject(new Error(message));
        };
        script.async = true;
        script.src = `${MAPS_SRC}?ncpKeyId=${encodeURIComponent(clientId)}`;
        script.onload = () => {
          const naver = win.naver;
          if (naver?.maps) resolve(naver);
          else fail('naver maps api is missing after script load');
        };
        script.onerror = () => fail('naver maps script failed to load');
        doc.head.appendChild(script);
      });
      return pending;
    },
    onAuthFailure(listener) {
      listeners.add(listener);
      if (authFailed) listener();
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

let instance: NaverMapsLoader | null = null;

/** 실 `document`·`window` 에 묶인 지연 싱글턴 — import 시점엔 DOM 을 건드리지 않는다. */
export function getNaverMapsLoader(): NaverMapsLoader {
  instance ??= createNaverMapsLoader({
    doc: document as unknown as LoaderDoc,
    win: window as unknown as LoaderWin,
  });
  return instance;
}
