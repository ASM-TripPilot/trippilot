import { openExternal } from '@/shared/external-link';

/**
 * "네이버 지도에서 보기" — 장소 하나를 네이버 지도(앱 → 웹)로 여는 순수 URL 조립 + 열기.
 *
 * `canOpenURL` 은 iOS 에서 `LSApplicationQueriesSchemes`(네이티브·재빌드)가 있어야 해서 쓰지 않는다 —
 * `openURL` 은 등록 없이 동작하고 처리할 앱이 없으면 reject 되므로, 그 reject 로 앱 → 웹 → 안내로 강등한다
 * (`features/execution/model/nextNav.ts` 와 같은 사다리).
 * 우리 라우트는 건드리지 않는다 — 외부 지도만 띄우므로 돌아오면 같은 화면이다.
 */

export interface NaverPlaceTarget {
  nameKo?: string | null;
  lat?: number | null;
  lng?: number | null;
}

const APP_NAME = 'com.trippilot.travel';

function usableCoords(
  target: NaverPlaceTarget
): { lat: number; lng: number } | null {
  const { lat, lng } = target;
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

function usableName(target: NaverPlaceTarget): string | null {
  const name = target.nameKo?.trim();
  return name ? name : null;
}

/** 이름도 좌표도 없으면 열 곳이 없다 → 버튼을 그리지 않는 기준(INV-1). */
export function canOpenNaverPlace(target: NaverPlaceTarget): boolean {
  return usableCoords(target) !== null || usableName(target) !== null;
}

/** 앱 URL — 좌표가 있어야 만든다(nmap place 는 좌표 필수). 없으면 null. */
export function buildNaverPlaceAppUrl(target: NaverPlaceTarget): string | null {
  const coords = usableCoords(target);
  if (coords === null) return null;
  const name = encodeURIComponent(usableName(target) ?? '장소');
  return `nmap://place?lat=${coords.lat}&lng=${coords.lng}&name=${name}&appname=${APP_NAME}`;
}

/** 웹 URL — 이름 검색. 이름이 없으면 null(좌표만으로 가게를 짚는 공식 웹 형식을 모른다). */
export function buildNaverPlaceWebUrl(target: NaverPlaceTarget): string | null {
  const name = usableName(target);
  if (name === null) return null;
  return `https://map.naver.com/p/search/${encodeURIComponent(name)}`;
}

/** 앱 → 웹 순으로 연다. 둘 다 못 열면 'failed' — 호출부가 안내한다(INV-4). */
export async function openNaverPlace(
  target: NaverPlaceTarget
): Promise<'app' | 'web' | 'failed'> {
  const appUrl = buildNaverPlaceAppUrl(target);
  if (appUrl !== null) {
    try {
      await openExternal(appUrl);
      return 'app';
    } catch {
      // 네이버 지도 앱 없음/열기 실패 → 웹으로 강등.
    }
  }
  const webUrl = buildNaverPlaceWebUrl(target);
  if (webUrl !== null) {
    try {
      await openExternal(webUrl);
      return 'web';
    } catch {
      // 웹도 실패 → 아래 failed.
    }
  }
  return 'failed';
}
