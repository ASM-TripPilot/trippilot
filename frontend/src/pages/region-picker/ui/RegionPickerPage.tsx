import type { ReactElement } from 'react';
import { useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';

import type { Region } from '@/shared/api/generated/schemas';
import { filterRegions, useRegions } from '@/features/explore/model/regions';
import type { RegionPickerPurpose } from '@/features/explore/model/regionPickerPurpose';
import { useTripWizardStore } from '@/features/trip/model/tripWizardStore';
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
  const purpose: RegionPickerPurpose =
    rawPurpose === 'trip' || rawPurpose === 'explore' || rawPurpose === 'places'
      ? rawPurpose
      : 'stay';
  // 화면 카피는 둘뿐이다(BR-U1-07) — 숙소가 아니면 전부 여행지 선택 카피(라이브 1834:2283).
  const copy: RegionPurpose = purpose === 'stay' ? 'stay' : 'trip';

  const [query, setQuery] = useState('');
  // TRIP-683 AC-1 — trip 분기가 이 orphan 액션을 다시 문다(g 밴드 이전 때 옛 인라인 시트의
  // confirmDestination 이 사라지며 배선을 잃었다). 셀렉터로 액션만 구독(리렌더 최소).
  const addDestination = useTripWizardStore((s) => s.addDestination);
  const regions = useRegions();
  // 전체 카탈로그를 화면에 내린다 — 빈 검색어 6개 상한(구 `limitRegionsWhenEmpty`)은 화면의
  // 시/도→구/군 드릴다운 그룹 접기가 대체한다(TRIP-597). 검색어가 있으면 클라 필터로 좁힌다.
  const visible = filterRegions(regions.data ?? [], query);

  function handleSelectRegion(region: Region): void {
    if (purpose === 'trip') {
      // TRIP-683 AC-1 — 여행지 편집 시트의 "도시 추가"에서 왔다. 그 지역을 1박으로 담고
      // 위저드로 복귀한다(사용자 확정). 스토어는 코드가 아니라 한글 **이름**을 받는다(destinations
      // 행이 이름을 그린다 — code 를 넘기면 화면에 코드가 뜬다). 옛 `/explore/destination/{code}`
      // 이탈(d03)은 담기 배선을 잃은 결함이었다.
      addDestination(region.name, 1);
      router.back();
      return;
    }
    if (purpose === 'explore') {
      // TRIP-985 — 탐색 진입(랜딩·홈·결과 화면 검색). 결과 화면은 **코드**를 받는다(이름은 캐시
      // 역인덱스). dismissTo: 스택에 결과 화면이 있으면 그리로 돌아가 교체하고, 없으면 피커를 바꿔
      // 끼운다 — "결과→피커→결과" 누적이 없다.
      router.dismissTo(`/explore/destination/${region.regionCode}`);
      return;
    }
    if (purpose === 'places') {
      // TRIP-985 — d04 "지역 바꾸기". d04 는 지역을 URL 로만 들고 있어 **이름**을 실어 돌아간다.
      router.dismissTo({
        pathname: '/explore/places',
        params: { region: region.name },
      });
      return;
    }
    // 서버 `region`은 자유 문자열 계약이라 코드가 아니라 한글 이름을 보낸다. dismissTo 로 결과
    // 화면에 돌아가 지역만 교체한다 — push 면 "결과→피커→결과"가 쌓였다(TRIP-989 D16).
    router.dismissTo(`/stays?region=${encodeURIComponent(region.name)}`);
  }

  return (
    <RegionPickerScreen
      purpose={copy}
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
