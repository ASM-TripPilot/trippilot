import type { ReactElement } from 'react';
import { useCallback, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Location from 'expo-location';

import { getSavedStays } from '@/shared/api/generated/saved-stays/saved-stays';
import { filterRegions, type Region } from '@/features/explore/model/regions';
import {
  resolveNearby,
  type Coords,
} from '@/features/explore/model/resolveNearby';
import { RegionPickerScreen } from '@/features/explore/ui/RegionPickerScreen';
import type {
  NearbyState,
  RegionPurpose,
} from '@/features/explore/ui/RegionPickerScreen';

/**
 * e00·d1b 지역 선택 배선 (US-STAY-01 · US-EXPL-02 · BR-U1-07 · BR-U1-11).
 *
 * 이 파일이 지는 책임 셋 — 화면은 이 중 어느 것도 알지 못한다(프리뷰 제약).
 *  1. `purpose` 해석과 **다음 목적지 분기**(BR-U1-07이 "카피와 다음 목적지만 다르다"고 한 그 목적지)
 *  2. 검색어 상태와 필터
 *  3. '내 주변' — 권한 요청 → 좌표 해석 → 대체 조회(BR-U1-11)
 */

/** 등록 숙소 중 **좌표가 확정된** 첫 곳. 미확정 좌표를 검색 중심으로 쓰면 안 된다(INV-U1-08). */
async function firstConfirmedSavedStayCoords(): Promise<Coords | null> {
  const list = await getSavedStays();
  const hit = list.find(
    (stay) => stay.coordConfirmed && stay.lat != null && stay.lng != null
  );
  return hit ? { lat: hit.lat as number, lng: hit.lng as number } : null;
}

export function RegionPickerPage(): ReactElement {
  const router = useRouter();
  // URL은 신뢰 경계 — 아는 값이 아니면 전부 'stay'로 떨어뜨린다("부분적으로 해석"하지 않는다).
  const { purpose: rawPurpose } = useLocalSearchParams<{ purpose?: string }>();
  const purpose: RegionPurpose = rawPurpose === 'trip' ? 'trip' : 'stay';

  const [query, setQuery] = useState('');
  const [nearby, setNearby] = useState<NearbyState>({ kind: 'idle' });

  const handleSelectRegion = useCallback(
    (region: Region) => {
      if (purpose === 'trip') {
        // ⚠️ `explore/destination/[region].tsx`는 아직 없다(정본 §1에 자리만 있고 밴드 d 티켓 몫).
        // 앱에서 이 경로에 닿는 동선도 아직 없다 — BR-U1-07이 요구한 분기를 구현해 둔 것이고,
        // 검증은 이 컨테이너 테스트가 한다.
        router.push(`/explore/destination/${region.code}`);
        return;
      }
      // 서버 `region`은 자유 문자열 계약이라 코드가 아니라 한글 이름을 보낸다.
      router.push(`/stays?region=${encodeURIComponent(region.name)}`);
    },
    [purpose, router]
  );

  const handleSelectNearby = useCallback(async () => {
    setNearby({ kind: 'locating' });

    const result = await resolveNearby({
      requestPermission: async () => {
        const { status } = await Location.requestForegroundPermissionsAsync();
        return { granted: status === 'granted' };
      },
      getCurrentPosition: async () => {
        const position = await Location.getCurrentPositionAsync({});
        return {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        };
      },
      getSavedStayCoords: firstConfirmedSavedStayCoords,
    });

    if (result.kind === 'unavailable') {
      // 좌표를 못 구했으면 이동하지 않는다 — 좌표 없이 조회하면 전국 목록을 '내 주변'이라
      // 부르게 된다(INV-4). 화면에 원인별 안내가 남는다.
      setNearby(result);
      return;
    }

    // 대체 조회였다면 그 사실을 화면에 남긴 뒤 이동한다(INV-4 침묵 금지).
    setNearby(
      result.kind === 'fallback' ? { kind: 'fallback' } : { kind: 'idle' }
    );
    // radiusKm은 보내지 않는다 — 반경 정책은 서버 기본값(TRIP-202)이 갖는다. 클라이언트가
    // 복사하면 서버가 값을 바꿀 때 조용히 갈라진다.
    router.push(`/stays?lat=${result.lat}&lng=${result.lng}`);
  }, [router]);

  return (
    <RegionPickerScreen
      purpose={purpose}
      query={query}
      regions={filterRegions(query)}
      nearby={nearby}
      onChangeQuery={setQuery}
      onSelectRegion={handleSelectRegion}
      onSelectNearby={handleSelectNearby}
      onBack={() => router.back()}
    />
  );
}
