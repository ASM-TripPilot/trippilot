import type { ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';

import { ChevronRightGlyph, LockGlyph } from './PlanbGlyphs';

/**
 * TRIP-563 · AC-4 — i13 재계획안 슬롯 1행(순수 props+콜백, 라우팅·훅 모름).
 *
 * 주입 VM 을 그린다: 상단 상태 배지 · 장소명 · 메타(서버값 통과) · 우측 어포던스. 우측은 상호배타 —
 * `isFixed` 면 고정 pill, 아니고 `candidateCount>0` 이면 "다른 후보 N >"(누르면 후보 시트 열기 위임).
 * 실 슬롯 데이터(사진·번호·시간대)는 draft 계약 공백이라 VM 에 없어 안 그린다(정직한 골격).
 *
 * ★ INV-3: metaText 는 서버가 준 거리("도보 1.3km")·시각범위("09:30–10:50")만 통과 렌더한다 —
 *   소요시간(N분·N시간·소요)을 이 화면이 조립하지 않는다(구조가드 executionDurationStructure).
 * ★ badgeKind='fixed' 는 상단 배지로 그리지 않는다 — 우측 고정 pill 이 대신 표시한다.
 */

export type SlotBadgeKind =
  'visited' | 'inProgress' | 'changed' | 'fixed' | null;

export interface ReplanSlotVM {
  slotKey: string;
  badgeKind: SlotBadgeKind;
  placeName: string;
  metaText: string;
  candidateCount?: number;
  isFixed: boolean;
}

export interface ReplanSlotRowProps {
  vm: ReplanSlotVM;
  onPressCandidates: (slotKey: string) => void;
}

// 상단 상태 배지 라벨 — fixed 는 우측 pill 이 대신 표시하므로 여기서 제외한다.
const TOP_BADGE_LABEL: Record<'visited' | 'inProgress' | 'changed', string> = {
  visited: '방문함',
  inProgress: '진행 중',
  changed: '변경됨',
};

export function ReplanSlotRow({
  vm,
  onPressCandidates,
}: ReplanSlotRowProps): ReactElement {
  const { slotKey, badgeKind, placeName, metaText, candidateCount, isFixed } =
    vm;
  const topBadge =
    badgeKind !== null && badgeKind !== 'fixed'
      ? TOP_BADGE_LABEL[badgeKind]
      : null;
  const isChanged = badgeKind === 'changed';
  const showCandidates = !isFixed && (candidateCount ?? 0) > 0;

  return (
    <View
      testID={`planb-draft-slot-${slotKey}`}
      className="flex-row items-center gap-md rounded-[14px] border border-hairline bg-canvas px-[10px] py-md"
    >
      <View className="flex-1 gap-[3px]">
        {topBadge !== null ? (
          <View
            testID={`planb-draft-badge-${slotKey}`}
            className={`self-start rounded-pill px-sm py-[2px] ${
              isChanged ? 'bg-primary-pale' : 'bg-hairline'
            }`}
          >
            <Text
              className={`font-noto-bold text-micro ${
                isChanged ? 'text-primary-text' : 'text-muted'
              }`}
            >
              {topBadge}
            </Text>
          </View>
        ) : null}
        <Text className="font-noto-bold text-card-title font-bold text-ink">
          {placeName}
        </Text>
        <Text
          testID={`planb-draft-slot-meta-${slotKey}`}
          className="font-noto text-caption text-muted"
        >
          {metaText}
        </Text>
      </View>

      {isFixed ? (
        <View
          testID={`planb-draft-fixed-${slotKey}`}
          className="flex-row items-center gap-[4px] rounded-pill bg-primary-pale px-md py-[6px]"
        >
          <LockGlyph />
          <Text className="font-noto-bold text-label text-primary-text">
            고정
          </Text>
        </View>
      ) : showCandidates ? (
        <Pressable
          testID={`planb-draft-candidates-${slotKey}`}
          accessibilityRole="button"
          onPress={() => onPressCandidates(slotKey)}
          hitSlop={8}
          className="flex-row items-center gap-[2px]"
        >
          <Text className="font-noto-bold text-label text-primary-text">
            다른 후보 {candidateCount}
          </Text>
          <ChevronRightGlyph />
        </Pressable>
      ) : null}
    </View>
  );
}
