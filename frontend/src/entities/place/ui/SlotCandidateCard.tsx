import type { ReactElement, ReactNode } from 'react';
import { Text, View } from 'react-native';

import type { SlotCandidatesCandidatesItem } from '@/shared/api/generated/schemas';

/**
 * TRIP-806 · AC-M2·M5·M6 — 슬롯 후보 카드(itinerary h08·h10 · planb i14 공용).
 *
 * 두 소비처는 접두만 다른 게 아니라 **구조가 갈린다**(02a ★6): itinerary 는 배지·회색 이미지·이름
 * testID·trailing·selected 테두리에 거리 라벨 "이동", planb 는 `-slack-` leaf 가 있고 이미지·이름
 * testID·배지·trailing 이 없으며 거리 라벨 "지금 위치서". 그래서 옵셔널 슬롯으로 둘 다 재현한다.
 *
 * ★6-a: planb 무수정 테스트의 루트 정규식이 `image-`·`name-` 를 제외하지 않아, planb 구성에선 그 두
 *   testID 를 그리면 후보 루트 집합이 깨진다 → `showImage`·`showNameTestId` 기본 false 로 둔다.
 *
 * 이름은 항상 중립 플레이스홀더(candidates 에 nameKo 없음 · poiId 원문 비노출 INV-1). 거리·근거 leaf 에
 * 소요시간 단위 0(INV-3, slack leaf 는 두 고정시각 차라 예외).
 */
export interface SlotCandidateCardProps {
  candidate: SlotCandidatesCandidatesItem;
  /** 'itinerary-candidate' | 'planb-candidate' — 소비처가 주입. */
  testIDPrefix: string;
  /** 거리 앞 라벨(별도 Text): '이동'(itin) | '지금 위치서'(planb). */
  distanceLabel: string;
  /** 이름 자리 플레이스홀더(기본 '이름 준비 중'). */
  namePlaceholder?: string;
  /** 이름 leaf 에 testID 를 붙일지(itin true / planb false, ★6-a). */
  showNameTestId?: boolean;
  /** 회색 이미지 자리를 그릴지(itin true / planb false, ★6-a). */
  showImage?: boolean;
  /** 알파벳 배지(A/B/C…, itin) — planb 미지정. */
  badge?: string;
  /** h18 선택 강조 테두리(itin) — planb 미지정. */
  selected?: boolean;
  /** planb 여유 행({label:'다음 고정까지', value}) → `-slack-` leaf — itin 미지정. */
  slack?: { label: string; value: string };
  /** itin 선택버튼·라디오 오른쪽 슬롯 — planb 미지정. */
  trailing?: ReactNode;
}

// 카드 그림자(itinerary h12·h18 값) — planb 는 그림자 없음이라 showImage 로 게이트한다.
const cardShadow = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.06,
  shadowRadius: 5,
  elevation: 2,
} as const;

export function SlotCandidateCard({
  candidate,
  testIDPrefix,
  distanceLabel,
  namePlaceholder = '이름 준비 중',
  showNameTestId = false,
  showImage = false,
  badge,
  selected = false,
  slack,
  trailing,
}: SlotCandidateCardProps): ReactElement {
  const { poiId } = candidate;
  const leafId = (role: string): string => `${testIDPrefix}-${role}-${poiId}`;

  return (
    <View
      testID={`${testIDPrefix}-${poiId}`}
      style={showImage ? cardShadow : undefined}
      className={`w-full flex-row items-center gap-md rounded-card border bg-canvas p-md ${
        selected ? 'border-primary' : 'border-hairline'
      }`}
    >
      {badge !== undefined ? (
        <View className="h-[26px] w-[26px] items-center justify-center rounded-pill bg-primary">
          <Text className="font-inter-bold text-caption font-bold text-on-primary">
            {badge}
          </Text>
        </View>
      ) : null}

      {showImage ? (
        <View
          testID={leafId('image')}
          className="h-[56px] w-[56px] rounded-thumb bg-surface-soft"
        />
      ) : null}

      <View className="min-w-0 flex-1 gap-[3px]">
        <Text
          testID={showNameTestId ? leafId('name') : undefined}
          numberOfLines={1}
          className="font-noto-bold text-card-title font-bold text-ink"
        >
          {namePlaceholder}
        </Text>

        <Text
          testID={leafId('rationale')}
          className="font-noto text-caption text-muted"
        >
          {candidate.rationale}
        </Text>

        <View className="flex-row items-center gap-xs">
          <Text className="font-noto text-caption text-muted-soft">
            {distanceLabel}
          </Text>
          <Text
            testID={leafId('distance')}
            className="font-noto-bold text-caption font-bold text-ink"
          >
            {candidate.distanceRange}
          </Text>
        </View>

        {slack ? (
          <View className="flex-row items-center gap-xs">
            <Text className="font-noto text-caption text-muted-soft">
              {slack.label}
            </Text>
            <Text
              testID={leafId('slack')}
              className="font-noto-bold text-caption font-bold text-primary-text"
            >
              {slack.value}
            </Text>
          </View>
        ) : null}
      </View>

      {trailing}
    </View>
  );
}
