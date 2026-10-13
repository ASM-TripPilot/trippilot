import { addressInRegion } from '@/features/trip/index.view';

/**
 * TRIP-1011 — g02 숙소 선택 시트의 섹션 분리(그 밤 지역 / 다른 지역).
 *
 * 숨기지 않는다(D8 fail-open · INV-4) — 주소가 확인돼 그 밤 지역에 속하는 숙소만 첫 섹션이고,
 * 나머지(다른 지역·주소 모름·조회 중)는 전부 두 번째 섹션이다. `null` = 평면 목록(전부 그 밤 지역·후보 0곳).
 *
 * TRIP-1273(B-14 · 결정 1) — 그 밤 지역이 0곳이면 전부를 "다른 지역" 한 섹션으로 묶는다. 단 조회 중
 * (`loading`·맵에 항목 없음)이 섞이면 "없다"를 아직 단정할 수 없어 `null`(01b Q5).
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

  if (other.length === 0) return null;
  const otherSection: StaySheetSection<T> = {
    key: 'other',
    title: unconfirmed ? '다른 지역 · 위치 확인 안 됨' : '다른 지역',
    candidates: other,
  };
  if (here.length > 0) {
    return [
      { key: 'here', title: `${region} 숙소`, candidates: here },
      otherSection,
    ];
  }
  const pending = stays.some((stay) => {
    const state = addresses[stay.savedStayId];
    return state === undefined || state.status === 'loading';
  });
  return pending ? null : [otherSection];
}

/**
 * TRIP-1273(01b Q2·Q5) — 그 밤 지역 숙소가 0곳이라고 **단정할 수 있을 때만** 안내 문구를 낸다: 후보가 있고
 * 전부 주소가 확인됐고 그 지역이 하나도 없을 때. 모름·조회 중이 섞이면 그 숙소가 실제로 그 지역일 수 있다.
 */
export function staySheetRegionNotice<T extends { savedStayId: string }>(
  stays: T[],
  addresses: Record<string, StayAddressState>,
  region: string
): string | null {
  const noneHere =
    stays.length > 0 &&
    stays.every((stay) => {
      const state = addresses[stay.savedStayId];
      return (
        state?.status === 'known' && !addressInRegion(state.address, region)
      );
    });
  return noneHere ? `${region}에 저장한 숙소가 없어요` : null;
}
