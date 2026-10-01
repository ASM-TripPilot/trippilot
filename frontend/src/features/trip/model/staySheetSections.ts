import { addressInRegion } from './regionMatch';

/**
 * TRIP-1011 — g02 숙소 선택 시트의 섹션 분리(그 밤 지역 / 다른 지역).
 *
 * 숨기지 않는다(D8 fail-open · INV-4) — 주소가 확인돼 그 밤 지역에 속하는 숙소만 첫 섹션이고,
 * 나머지(다른 지역·주소 모름·조회 중)는 전부 두 번째 섹션이다. 한쪽이 비면 `null` = 평면 목록.
 */

/** 저장 숙소 한 곳의 주소 조회 상태. `unknown` = 좌표 없음 · 주소 null · 조회 실패. */
export type StayAddressState =
  | { status: 'loading' }
  | { status: 'unknown' }
  | { status: 'known'; address: string };

export interface StaySheetSection<T> {
  key: 'here' | 'other';
  title: string;
  candidates: T[];
}

export function staySheetSections<T extends { savedStayId: string }>(
  stays: T[],
  addresses: Record<string, StayAddressState>,
  region: string
): StaySheetSection<T>[] | null {
  const here: T[] = [];
  const other: T[] = [];
  let unconfirmed = false;

  stays.forEach((stay) => {
    const state = addresses[stay.savedStayId];
    if (state?.status === 'known' && addressInRegion(state.address, region)) {
      here.push(stay);
      return;
    }
    other.push(stay);
    if (state?.status !== 'known') unconfirmed = true;
  });

  if (here.length === 0 || other.length === 0) return null;
  return [
    { key: 'here', title: `${region} 숙소`, candidates: here },
    {
      key: 'other',
      title: unconfirmed ? '다른 지역 · 위치 확인 안 됨' : '다른 지역',
      candidates: other,
    },
  ];
}
