import { useState, type ReactElement } from 'react';
import { router } from 'expo-router';

import {
  buildCompareRows,
  type CompareTab,
} from '@/features/record/model/compareRows';
import { useCompareRecords } from '@/features/record/model/useCompareRecords';
import { RecordsCompareScreen } from '@/features/record/ui/RecordsCompareScreen';
import { useGetTripsTripIdItinerary } from '@/shared/api/generated/trips/trips';
import { formatKoreanDate } from '@/shared/date/formatKoreanDate';

/**
 * TRIP-570 · records-compare 페이지 — j02 비교 조회·조립·배선의 단일 출처(FSD).
 *
 * `useCompareRecords(tripId)`(=`GET /trips/{tripId}/records`)로 `TripRecord` 를 받아
 * `buildCompareRows` 로 행을 접는다. TripRecord 엔 장소명이 없어 이름은 itinerary 슬롯 조인으로
 * best-effort 해소한다(`TripRecordsPage` j01 선례 — 조인 로직만 참고, import 아님). 변경으로 사라진
 * before POI 는 현행 itinerary 에 없어 해소가 실패할 수 있고, 그땐 `buildCompareRows` 가 poiId·폴백
 * 라벨로 구조를 유지한다(Q2, 완전 해소는 place-data 배치 조회 후속).
 *
 * 세그 활성 탭은 페이지 로컬 상태(리스트 필터가 아니라 지도 레이어 강조 토글 — 리스트는 항상 전체).
 * 귀속 헤더는 `TripRecordDay.baseStayName`(서버 파생 직독, BR-U5-25)을 최소 단일 헤더로 표시한다
 * (다중일 per-day 섹션은 Figma 정본 없음 — 후속). 지도는 화면이 degrade 자리표시로 접는다.
 *
 * ⚠️ 페이지 조립(이름 조인·귀속 파생·콜백 배선)은 jest 무심판이다 — 6-b 실기가 유일한 그물
 * (`TripRecordsPage`·`TripSummaryPage` 동형 사각, 자율 세션이라 이번엔 SKIP).
 */

export interface RecordsComparePageProps {
  tripId: string;
}

export function RecordsComparePage({
  tripId,
}: RecordsComparePageProps): ReactElement {
  const records = useCompareRecords(tripId);
  const itinerary = useGetTripsTripIdItinerary(tripId);
  const [activeTab, setActiveTab] = useState<CompareTab>('actual');

  const record = records.data;

  // 이름 조인 — TripRecord 엔 poiId 만 있어 itinerary 슬롯에서 이름을 가져온다(없으면 poiId 폴백).
  const nameByPoi: Record<string, string> = {};
  for (const day of itinerary.data?.days ?? []) {
    for (const slot of day.slots ?? []) {
      nameByPoi[slot.poiId] = slot.nameKo ?? slot.poiId;
    }
  }

  const rows = record ? buildCompareRows(record, nameByPoi) : [];

  // 귀속 — 서버가 파생해 내려준 baseStayName 직독(재도출 안 함). 첫 일자의 최소 단일 헤더.
  const firstDay = record?.days?.[0];
  const attribution = firstDay
    ? {
        dayLabel: formatKoreanDate(firstDay.date),
        stayName: firstDay.baseStayName ?? null,
      }
    : undefined;

  return (
    <RecordsCompareScreen
      activeTab={activeTab}
      onSelectTab={setActiveTab}
      rows={rows}
      attribution={attribution}
      onBack={() => {
        if (router.canGoBack()) router.back();
      }}
    />
  );
}
