import type { ReactElement } from 'react';
import { useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';

import type { Region } from '@/shared/api/generated/schemas';
import {
  filterRegions,
  limitRegionsWhenEmpty,
  useRegions,
} from '@/features/explore/model/regions';
import { RegionPickerScreen } from '@/features/explore/ui/RegionPickerScreen';
import type { RegionPurpose } from '@/features/explore/ui/RegionPickerScreen';

/**
 * e00·d1b 지역 선택 배선 (US-STAY-01 · US-EXPL-02 · BR-U1-07 · TRIP-445).
 *
 * 이 파일이 지는 책임 셋 — 화면은 이 중 어느 것도 알지 못한다(프리뷰 제약).
 *  1. `purpose` 해석과 **다음 목적지 분기**(BR-U1-07이 "카피와 다음 목적지만 다르다"고 한 그 목적지)
 *  2. 서버 카탈로그 조회(`useRegions`)와 로딩/에러 상태를 화면에 그대로 내림(판별 함수 신설 없이
 *     `isPending`·`isError`를 직접 내린다 — 프레젠테이션 얼굴은 화면이 그린다).
 *  3. 검색어 상태와 클라 필터(`filterRegions`) — 서버 `q` 대신 클라 필터라 전체 목록을 늘 쥔다.
 */
export function RegionPickerPage(): ReactElement {
  const router = useRouter();
  // URL은 신뢰 경계 — 아는 값이 아니면 전부 'stay'로 떨어뜨린다("부분적으로 해석"하지 않는다).
  const { purpose: rawPurpose } = useLocalSearchParams<{ purpose?: string }>();
  const purpose: RegionPurpose = rawPurpose === 'trip' ? 'trip' : 'stay';

  const [query, setQuery] = useState('');
  const regions = useRegions();
  // 빈 검색어면 대표 소수(앞 6개)만, 입력이 있으면 필터 전량 — 카탈로그를 통째로 쏟지 않는다(TRIP-499).
  const visible = limitRegionsWhenEmpty(
    filterRegions(regions.data ?? [], query),
    query
  );

  function handleSelectRegion(region: Region): void {
    if (purpose === 'trip') {
      // `explore/destination/[region].tsx`는 d03 목적지 상세 실화면이다(TRIP-183 스텁을
      // 2026-08-22에 교체). BR-U1-07이 요구한 분기는 그대로 — 검증은 이 컨테이너 테스트가 한다.
      router.push(`/explore/destination/${region.regionCode}`);
      return;
    }
    // 서버 `region`은 자유 문자열 계약이라 코드가 아니라 한글 이름을 보낸다.
    router.push(`/stays?region=${encodeURIComponent(region.name)}`);
  }

  return (
    <RegionPickerScreen
      purpose={purpose}
      query={query}
      regions={visible}
      isLoading={regions.isPending}
      isError={regions.isError}
      onChangeQuery={setQuery}
      onSelectRegion={handleSelectRegion}
      onRetry={() => void regions.refetch()}
      onBack={() => router.back()}
    />
  );
}
