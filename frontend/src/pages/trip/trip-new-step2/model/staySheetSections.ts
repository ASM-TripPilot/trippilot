import { addressInRegion } from '@/features/trip/index.view';

/**
 * 거점 시트의 후보 거르기·섹션 분리. TRIP-1011 이 "숨기지 않는다(D8)"로 시작했으나 TRIP-1703(2026-11-02
 * 사용자 결정)이 뒤집었다 — 주소가 확인돼 그 밤 지역 밖인 숙소는 거점으로 고를 수 없으므로 후보에서 뺀다.
 * 주소를 모르는 숙소(조회 중·모름·항목 없음)는 여전히 남긴다(fail-open · INV-4 — 아직 밖이라 단정 못 한다).
 *
 * `staySheetSections`: 첫 섹션 = 주소가 확인된 그 밤 지역 숙소, 둘째 섹션 = 위치 확인 안 된 나머지.
 * `null` = 평면 목록. 입력에 지역 밖 숙소가 섞여 있어도 어느 섹션에도 담지 않는다(방어).
 *
 * TRIP-1273(B-14 · 결정 1) — 그 밤 지역이 0곳이면 나머지를 한 섹션으로 묶는다. 단 조회 중
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

/** 주소가 확인돼 그 밤 지역 밖인 숙소. 조회 중·모름·항목 없음은 밖이라 단정할 수 없어 아니다. */
function isOutside(
  state: StayAddressState | undefined,
  region: string
): boolean {
  return state?.status === 'known' && !addressInRegion(state.address, region);
}

/** 시트에 보여줄 후보 — 지역 밖으로 확인된 숙소만 뺀다. 입력 순서 보존. */
export function staySheetCandidates<T extends { savedStayId: string }>(
  stays: T[],
  addresses: Record<string, StayAddressState>,
  region: string
): T[] {
  return stays.filter(
    (stay) => !isOutside(addresses[stay.savedStayId], region)
  );
}

export function staySheetSections<T extends { savedStayId: string }>(
  stays: T[],
  addresses: Record<string, StayAddressState>,
  region: string
): StaySheetSection<T>[] | null {
  const here: T[] = [];
  const other: T[] = [];
  let pending = false;

  staySheetCandidates(stays, addresses, region).forEach((stay) => {
    const state = addresses[stay.savedStayId];
    if (state?.status === 'known') {
      here.push(stay);
      return;
    }
    other.push(stay);
    if (state === undefined || state.status === 'loading') pending = true;
  });

  if (other.length === 0) return null;
  const otherSection: StaySheetSection<T> = {
    key: 'other',
    title: '위치 확인 안 됨',
    candidates: other,
  };
  if (here.length > 0) {
    return [
      { key: 'here', title: `${region} 숙소`, candidates: here },
      otherSection,
    ];
  }
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
