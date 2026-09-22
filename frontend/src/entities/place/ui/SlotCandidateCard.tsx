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
 * 이름은 기본이 중립 플레이스홀더(candidates 에 nameKo 없음 · poiId 원문 비노출 INV-1). 거리·근거 leaf 에
 * 소요시간 단위 0(INV-3, slack leaf 는 두 고정시각 차라 예외).
 *
 * TRIP-793 additive(전부 기본값이 기존 렌더 불변): h08 "다른 후보 시트"가 이 카드를 직접 소비하며
 * 사진·이름·태그를 켜고 rationale·"이동" 라벨을 끈다.
 *  - `tags?` — 주면 태그줄(`{prefix}-tags-{poiId}`, **첫 태그만 `#`**) 렌더. 미주입=태그줄 0(planb·CC 불변).
 *  - `nameKo?` — 주면 이름 자리에 실이름(없으면 종전 플레이스홀더). CC1~4 는 미주입이라 "이름 준비 중" 그대로.
 *  - `showRationale?`(기본 true) — false 면 rationale leaf 미렌더. planb·CC 는 미주입=true 라 rationale 그대로.
 *  - `distanceLabel?`(옵셔널화) — 미주입이면 거리 앞 라벨 Text 를 안 그린다(h08 시트는 라벨 없이 태그·거리만).
 *  - `distanceTone?`(기본 'ink') — 'muted' 면 거리 leaf 를 태그줄과 같은 muted 로(h08 시트 한 줄 정합).
 *    planb·CC 는 미주입=ink 라 굵은 잉크 거리 그대로.
 */
export interface SlotCandidateCardProps {
  candidate: SlotCandidatesCandidatesItem;
  /** 'itinerary-candidate' | 'planb-candidate' — 소비처가 주입. */
  testIDPrefix: string;
  /** 거리 앞 라벨(별도 Text): '이동'(itin) | '지금 위치서'(planb). 미주입이면 라벨 없음(h08 시트). */
  distanceLabel?: string;
  /** 거리 leaf 색조 — 'ink'(굵은 잉크, 기본) | 'muted'(태그·거리 한 줄, h08 시트). */
  distanceTone?: 'ink' | 'muted';
  /** 태그줄(첫 태그만 `#`) — 주면 `{prefix}-tags-{poiId}` leaf 렌더. */
  tags?: string[];
  /** 실이름 — 주면 플레이스홀더 대신 표시(h08 시트). */
  nameKo?: string | null;
  /** rationale leaf 를 그릴지(기본 true) — h08 시트는 false 로 추천이유를 버린다. */
  showRationale?: boolean;
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
  distanceTone = 'ink',
  tags,
  nameKo,
  showRationale = true,
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
  const nameLabel =
    nameKo === null || nameKo === undefined || nameKo === ''
      ? namePlaceholder
      : nameKo;
  // 첫 태그만 `#` — join 이 나머지 사이에 ` · ` 를 넣고, 앞에 한 번만 `#` 를 붙인다(`#미술 · 실내`).
  const tagLine =
    tags !== undefined && tags.length > 0 ? `#${tags.join(' · ')}` : null;
  const distanceClass =
    distanceTone === 'muted'
      ? 'font-noto text-caption text-muted'
      : 'font-noto-bold text-caption font-bold text-ink';

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
          {nameLabel}
        </Text>

        {showRationale ? (
          <Text
            testID={leafId('rationale')}
            className="font-noto text-caption text-muted"
          >
            {candidate.rationale}
          </Text>
        ) : null}

        <View className="flex-row items-center gap-xs">
          {tagLine !== null ? (
            <Text
              testID={leafId('tags')}
              className="font-noto text-caption text-muted"
            >
              {tagLine}
            </Text>
          ) : null}
          {tagLine !== null ? (
            <Text className="font-noto text-caption text-muted">·</Text>
          ) : null}
          {distanceLabel !== undefined ? (
            <Text className="font-noto text-caption text-muted-soft">
              {distanceLabel}
            </Text>
          ) : null}
          <Text testID={leafId('distance')} className={distanceClass}>
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
