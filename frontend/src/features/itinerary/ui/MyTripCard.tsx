import type { ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';

import { ChevronRightGlyph } from './ItineraryGlyphs';

/**
 * TRIP-468 · h37 "내 여행" 목록 카드 — 순수 프레젠테이션(VM + onPress만).
 *
 * 판정은 안 한다 — 컨테이너(`TripCardContainer`)가 itinerary GET 을 씹어 완성된 VM 을 내리고,
 * 이 카드는 VM 필드만 그린다(판정이 두 층에 흩어지지 않게 — `draftView`/`planState` 배치와 같은 규율).
 *
 * 무엇을 보장하나(승인 테스트가 무는 계약):
 *  - 제목·메타줄·부가정보 leaf 는 **값 하나만** 담는다(RNTL `toHaveTextContent(문자열)` 완전일치).
 *  - 배지는 `badge!==null` 일 때만, resume CTA 는 `badge==='draft'` 일 때만 뜬다(파생 — 별도 VM 필드 없음).
 *  - 사진 자리는 중립 플레이스홀더(`bg-surface-soft`) — `Trip` 에 사진 필드가 없다(01b Q4).
 */

/** 배지 상태 — 'done'=완성(itinerary CONFIRMED) · 'draft'=작성중(그 외) · null=itinerary 미도착(배지 미정). */
export type MyTripBadge = 'done' | 'draft' | null;

export interface MyTripCardVM {
  tripId: string;
  title: string;
  /** "6월 10일 ~ 13일 · 3박 4일 · 2명" — 컨테이너가 formatNightsLabel + 로컬 `~` 조립으로 완성. */
  metaLine: string;
  badge: MyTripBadge;
  /** done: "확정 장소 N곳" · draft: "추천안 준비 중" · 미도착: null. */
  extra: string | null;
}

export interface MyTripCardProps {
  vm: MyTripCardVM;
  onPress: () => void;
}

const BADGE_LABEL: Record<'done' | 'draft', string> = {
  done: '완성',
  draft: '작성중',
};

const RESUME_LABEL = '일정 이어서 짜기';

export function MyTripCard({ vm, onPress }: MyTripCardProps): ReactElement {
  const { tripId, title, metaLine, badge, extra } = vm;

  return (
    <Pressable
      testID={`my-trip-card-${tripId}`}
      accessibilityRole="button"
      onPress={onPress}
      className="w-full overflow-hidden rounded-card border border-hairline bg-canvas"
    >
      {/* 사진 자리 — 중립 플레이스홀더(Trip 에 사진 필드 없음). 배지·resume 를 이 위에 얹는다. */}
      <View className="h-[178px] w-full bg-surface-soft">
        {badge !== null ? (
          <View
            testID={`my-trip-badge-${tripId}`}
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
            testID={`my-trip-resume-${tripId}`}
            accessibilityRole="button"
            onPress={onPress}
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
          testID={`my-trip-title-${tripId}`}
          numberOfLines={1}
          className="font-noto-bold text-card-title font-bold text-ink"
        >
          {title}
        </Text>
        <Text
          testID={`my-trip-meta-${tripId}`}
          numberOfLines={1}
          className="font-noto text-label text-body"
        >
          {metaLine}
        </Text>
        {extra !== null ? (
          <Text
            testID={`my-trip-extra-${tripId}`}
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
