import type { ReactElement } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CompareRow } from './CompareRow';
import { CompareSegment } from './CompareSegment';
import { BackArrowGlyph } from './RecordGlyphs';
import type {
  CompareRow as CompareRowVM,
  CompareTab,
} from '../model/compareRows';

/**
 * TRIP-570 · j02 기록 비교 화면(순수 프레젠테이션 — VM·콜백 주입, 조회/조립 0).
 *
 * 세로 컬럼: appbar → 3탭 세그 → 귀속 헤더 → 범례 → 지도(degrade 자리표시) → 라벨 행 목록.
 * 조립·조회는 `pages/records-compare` 가 진다(이 파일은 `@/shared/api`·`@/shared/map` 을 import
 * 하지 않는다 — 프리뷰 격리 렌더 안전, FSD 경계).
 *
 * ★ 지도 degrade — TripRecord 계약에 좌표(lat/lng)가 없고 지도 렌더는 jest 원리적 사각이라
 * (repo-traps) `KakaoMapView` 를 애초에 안 문다. 정적 "지도 준비 중" 자리표시만 그린다(j04
 * `reflection-summary-map-pending` 동형, 정직한 degrade INV-4). 실 3레이어·사진 핀·탭별 강조는 후속.
 *
 * 세그는 리스트 필터가 아니라 지도 레이어 강조 토글이다 — 리스트는 활성 탭과 무관하게 전체 행을
 * 표시한다(01b·Figma). 귀속 헤더는 숙소/날짜를 색이 아니라 상호배타 testID 로 가른다(fill 함정 회피).
 */

export interface RecordsCompareScreenProps {
  activeTab: CompareTab;
  onSelectTab: (tab: CompareTab) => void;
  rows: CompareRowVM[];
  /** 활성 일자의 숙소·날짜 귀속 헤더(없으면 미표시). `stayName` truthy→숙소, null→날짜만. */
  attribution?: { dayLabel: string; stayName?: string | null };
  onBack: () => void;
}

export function RecordsCompareScreen({
  activeTab,
  onSelectTab,
  rows,
  attribution,
  onBack,
}: RecordsCompareScreenProps): ReactElement {
  return (
    <SafeAreaView edges={['top']} style={{ flex: 1 }} className="bg-canvas">
      {/* appbar */}
      <View className="w-full flex-row items-center gap-[4px] bg-canvas pb-[12px] pl-[12px] pr-lg pt-[4px]">
        <Pressable
          testID="record-compare-back"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          onPress={onBack}
        >
          <BackArrowGlyph size={24} />
        </Pressable>
        <Text className="font-noto-bold text-[18px] text-ink">기록 비교</Text>
      </View>

      {/* 3탭 세그먼트 */}
      <View className="w-full bg-canvas px-lg pb-[10px] pt-[4px]">
        <CompareSegment activeTab={activeTab} onSelect={onSelectTab} />
      </View>

      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-md px-lg pb-[40px] pt-[10px]"
      >
        {/* 귀속 헤더 — 숙소 있음/없음을 상호배타 testID 로 가른다(SVG fill 사각 회피). */}
        {attribution ? (
          attribution.stayName ? (
            <View
              testID="record-compare-attribution-stay"
              className="w-full flex-row items-center gap-sm"
            >
              <Text className="font-noto-bold text-body text-ink">
                {attribution.stayName}
              </Text>
              <Text className="text-label text-muted">
                {attribution.dayLabel}
              </Text>
            </View>
          ) : (
            <View testID="record-compare-attribution-date" className="w-full">
              <Text className="text-label text-muted">
                {attribution.dayLabel}
              </Text>
            </View>
          )
        ) : null}

        {/* 범례 — 실선/점선/코랄 3레이어(지도 복원 후 실체화, 지금은 안내 문구) */}
        <Text className="w-full text-label text-muted">
          실선 = 실제 동선 · 점선 = 계획(미방문) · 코랄 = 변경
        </Text>

        {/* 지도 degrade — 좌표 계약 부재 + jest 사각이라 자리표시(KakaoMapView 미사용, ★T-1). */}
        <View
          testID="record-compare-map-pending"
          className="w-full items-center gap-sm rounded-card border-[1.5px] border-dashed border-hairline-strong bg-surface-soft px-lg py-3xl"
        >
          <Text className="font-noto text-label text-muted">지도 준비 중</Text>
        </View>

        {/* 라벨 행 목록 — 활성 탭과 무관하게 전체 행(필터 아님). */}
        {rows.map((row) => (
          <CompareRow key={row.key} row={row} />
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}
