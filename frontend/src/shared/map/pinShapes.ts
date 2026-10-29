import type { MapPinKind } from './MapView';

/**
 * 핀 모양 상수 — 네이티브(`MapView.tsx` 의 react-native-svg)와 웹(`webMarkerHtml.ts` 의 SVG 문자열)이
 * 같이 쓴다. 한쪽만 바뀌어 두 플랫폼 핀이 갈라지지 않게 순수 데이터로 한 곳에 둔다.
 */

/** 색·모양은 마커 래스터에서 안전하게 잡히도록 전부 SVG 로 그린다 — NativeWind className 은 네이버
 * SDK 가 자식 뷰를 화면 밖에서 마커 이미지로 스냅샷할 때 적용이 보장되지 않고(초록 링·흰 실루엣),
 * SVG stroke/fill 은 애초에 className 을 못 받는다(shared/map 관례). 색은 tailwind 팔레트 raw hex —
 * S7 팔레트 부분집합 가드는 TRIP-864 로 삭제됐고 재도입하지 않았다(TRIP-745 Q3). */
export const PIN_PRIMARY = '#FF385C'; // primary — current·기본 물방울
export const PIN_SUCCESS = '#0E9384'; // success — done 물방울
export const PIN_MUTED_SOFT = '#9AA1AB'; // muted-soft — upcoming 테두리·번호
export const PIN_WHITE = '#FFFFFF'; // on-primary·canvas — 흰 테두리·흰 번호·흰 체크

/** Figma 4125:3958 물방울 벡터 1:1. 큰 것(current·기본)은 35×45.5, 작은 것(upcoming·done)은 28×36. */
export const TEARDROP_LARGE =
  'M17.5 1.25C8.5 1.25 1.25 8.125 1.25 16.875C1.25 27.5 17.5 43.75 17.5 43.75C17.5 43.75 33.75 27.5 33.75 16.875C33.75 8.125 26.5 1.25 17.5 1.25Z';
export const TEARDROP_SMALL =
  'M14 1C6.8 1 1 6.5 1 13.5C1 22 14 35 14 35C14 35 27 22 27 13.5C27 6.5 21.2 1 14 1Z';
/** done 흰 체크(✓). Figma imgStateDone 의 벡터. */
export const DONE_CHECK = 'M9.3 13.8L12.4 16.9L18.4 10.2';

/** stay 마커 몸통 — 아래로 뾰족한 라운드 사각(Figma 5000:3227 침대 마커). 좌표는 아래 꼭짓점(17,39). */
export const STAY_PIN =
  'M11 2 H23 A9 9 0 0 1 32 11 V21 A9 9 0 0 1 23 30 H21 L17 39 L13 30 H11 A9 9 0 0 1 2 21 V11 A9 9 0 0 1 11 2 Z';

/** 물방울 래퍼 치수 — current·기본(큰 것) / upcoming·done(작은 것). */
export const DROP_LARGE_SIZE = { width: 35, height: 46 } as const;
export const DROP_SMALL_SIZE = { width: 28, height: 36 } as const;

/** 기록 마커족 치수·앵커(kind 별). 앵커는 좌표가 마커의 어디를 가리키나 — 6-b 조정 knob. */
export const RECORD_DIMS: Record<
  MapPinKind,
  { width: number; height: number; anchor: { x: number; y: number } }
> = {
  visited: { width: 48, height: 48, anchor: { x: 0.5, y: 0.5 } },
  planned: { width: 32, height: 32, anchor: { x: 0.5, y: 0.5 } },
  stay: { width: 34, height: 42, anchor: { x: 0.5, y: 1 } },
  candidate: { width: 28, height: 36, anchor: { x: 0.5, y: 1 } },
};
