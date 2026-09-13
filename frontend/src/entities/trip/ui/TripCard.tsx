import type { ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';

import { ChevronRightGlyph } from './TripGlyphs';
import type { MyTripCardVM } from '../model';

/**
 * TRIP-808 · h06 "내 여행" 카드 — 순수 프레젠테이션(features/itinerary/ui/MyTripCard 에서 이관).
 *
 * 판정은 안 한다 — 소비처(TripCardContainer)가 완성된 VM 을 내리고 이 카드는 필드만 그린다. testID 는
 * 카드가 하드코딩하지 않고 소비처가 `testIDPrefix` 로 명시한다(806 SlotCandidateCard 선례) — h06 이
 * `testIDPrefix="my-trip"` 을 넘겨 `my-trip-card-{id}` 등 프로즌 리터럴을 얻고, 나중에 l03 이 같은 카드를
 * 쓰면 다른 prefix 로 testID 충돌(D1)을 피한다.
 *
 * 무엇을 보장하나:
 *  - 제목·메타줄·부가정보 leaf 는 값 하나만 담는다(toHaveTextContent 완전일치 계약).
 *  - 배지는 badge!==null 일 때만, resume CTA 는 badge==='draft' 일 때만 뜬다(파생 — 별도 VM 필드 없음).
 *  - 사진 자리는 중립 회색(`bg-surface-soft`) — `Trip` 계약에 사진 필드가 없다(INV-1).
 */

/** resume CTA 미제공 시 onResume 대신 onPress 로 폴백(현 h06 동작 보존). */
export interface TripCardProps {
  vm: MyTripCardVM;
  onPress: () => void;
  onResume?: () => void;
  testIDPrefix: string;
}

const BADGE_LABEL: Record<'done' | 'draft', string> = {
  done: '완성',
  draft: '작성중',
};

const RESUME_LABEL = '일정 이어서 짜기';

export function TripCard({
  vm,
  onPress,
  onResume,
  testIDPrefix,
}: TripCardProps): ReactElement {
  const { tripId, title, metaLine, badge, extra } = vm;

  return (
    <Pressable
      testID={`${testIDPrefix}-card-${tripId}`}
      accessibilityRole="button"
      onPress={onPress}
      className="w-full overflow-hidden rounded-card border border-hairline bg-canvas"
    >
      {/* 사진 자리 — 중립 플레이스홀더(Trip 에 사진 필드 없음). 배지·resume 를 이 위에 얹는다. */}
      <View className="h-[178px] w-full bg-surface-soft">
        {badge !== null ? (
          <View
            testID={`${testIDPrefix}-badge-${tripId}`}
            className={`absolute right-[14px] top-[14px] rounded-pill px-md py-[5px] ${
              badge === 'done' ? 'bg-success-bg' : 'bg-primary-pale'
            }`}
          >
            <Text
              className={`font-noto-bold text-label font-bold ${
                badge === 'done' ? 'text-success' : 'text-primary-text'
              }`}
            >
              {BADGE_LABEL[badge]}
            </Text>
          </View>
        ) : null}

        {badge === 'draft' ? (
          <Pressable
            testID={`${testIDPrefix}-resume-${tripId}`}
            accessibilityRole="button"
            onPress={onResume ?? onPress}
            className="absolute bottom-[14px] left-[14px] flex-row items-center gap-[2px] rounded-pill bg-primary py-[7px] pl-md pr-sm"
          >
            <Text className="font-noto-bold text-label font-bold text-on-primary">
              {RESUME_LABEL}
            </Text>
            <ChevronRightGlyph size={16} />
          </Pressable>
        ) : null}
      </View>

      {/* 정보 — 제목·메타줄·부가정보. 각 leaf 는 값 하나만 담는다(완전일치 계약). */}
      <View className="gap-[5px] px-[14px] pb-[14px] pt-[13px]">
        <Text
          testID={`${testIDPrefix}-title-${tripId}`}
          numberOfLines={1}
          className="font-noto-bold text-card-title font-bold text-ink"
        >
          {title}
        </Text>
        <Text
          testID={`${testIDPrefix}-meta-${tripId}`}
          numberOfLines={1}
          className="font-noto text-label text-body"
        >
          {metaLine}
        </Text>
        {extra !== null ? (
          <Text
            testID={`${testIDPrefix}-extra-${tripId}`}
            numberOfLines={1}
            className={`font-noto text-caption ${
              badge === 'draft' ? 'text-primary-text' : 'text-muted'
            }`}
          >
            {extra}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}
