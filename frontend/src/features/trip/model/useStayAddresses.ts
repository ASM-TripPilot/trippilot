import { useQueries } from '@tanstack/react-query';

import { getGetStaysReverseGeocodeQueryOptions } from '@/shared/api/generated/stays/stays';
import type { SavedStay } from '@/shared/api/generated/schemas';

import type { StayAddressState } from './staySheetSections';

/**
 * TRIP-1011 — 저장 숙소 좌표마다 `/stays/reverse-geocode` 로 주소를 받아 savedStayId 별 상태로 돌려준다.
 * `SavedStay` 에 주소 필드가 없어서다(BE 필드 추가는 새 티켓 후보).
 *
 * 같은 좌표(중복 등록 #021)는 한 번만 묻는다 — useQueries 에 같은 키를 두 번 넣으면 TanStack 이
 * "Duplicate Queries" 경고를 낸다. 좌표의 주소는 안 바뀌므로 `staleTime: Infinity`.
 * 페이지 테스트가 이 모듈 경로를 목으로 바꿔 끼운다(QueryClientProvider 없음).
 */
export function useStayAddresses(
  stays: SavedStay[]
): Record<string, StayAddressState> {
  // 좌표 키 → 요청 파라미터(좌표 없는 숙소는 빠진다 = 요청 0).
  const coords = new Map<string, { lat: number; lng: number }>();
  stays.forEach(({ lat, lng }) => {
    if (typeof lat === 'number' && typeof lng === 'number') {
      coords.set(coordKey(lat, lng), { lat, lng });
    }
  });
  const keys = [...coords.keys()];

  const results = useQueries({
    queries: [...coords.values()].map((params) =>
      getGetStaysReverseGeocodeQueryOptions(params, {
        query: { staleTime: Infinity },
      })
    ),
  });

  const stateByCoord = new Map<string, StayAddressState>(
    keys.map((key, index) => {
      const result = results[index];
      if (result.isPending) return [key, { status: 'loading' }];
      const address = result.data?.address;
      return [
        key,
        typeof address === 'string'
          ? { status: 'known', address }
          : { status: 'unknown' },
      ];
    })
  );

  return Object.fromEntries(
    stays.map(({ savedStayId, lat, lng }) => [
      savedStayId,
      stateByCoord.get(coordKey(lat, lng)) ?? { status: 'unknown' },
    ])
  );
}

function coordKey(lat: unknown, lng: unknown): string {
  return `${String(lat)},${String(lng)}`;
}
