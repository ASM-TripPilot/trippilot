import type { ReactElement } from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import {
  COVER_END,
  COVER_GRADIENTS,
  COVER_START,
} from '../config/coverGradients';

import { ChevronRightGlyph, MoreDotsGlyph, TrashGlyph } from './TripGlyphs';
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
 *  - 사진 자리는 imageUrl(픽스처 전용)이 있으면 Image, 없으면 톤별 가로 그라데이션 + 도시 이름(TRIP-1208,
 *    Figma 4828:2737) — `Trip` 계약에 사진 필드가 없어(INV-1) 실서비스는 항상 그라데이션이다.
 */

/** resume CTA 미제공 시 onResume 대신 onPress 로 폴백(현 h06 동작 보존). */
export interface TripCardProps {
  vm: MyTripCardVM;
  onPress: () => void;
  onResume?: () => void;
  testIDPrefix: string;
  /** TRIP-1055 · 주어지면 ⋯ 버튼을 그린다(삭제 가능 판정은 소비처 몫). */
  onPressDelete?: () => void;
  /** 메뉴 열림 — 카드는 상태를 갖지 않아 소비처가 쥔다. */
  menuOpen?: boolean;
  onPressMenu?: () => void;
}

const BADGE_LABEL: Record<'done' | 'draft' | 'live', string> = {
  done: '완성',
  draft: '작성중',
  live: '여행 중',
};

const RESUME_LABEL = '일정 이어서 짜기';
const MENU_DELETE_LABEL = '삭제';

/** Figma 4682:2573 — ⋯ 버튼 drop 0,2,10 · 6% / 메뉴 drop 0,4,16 · 8%. */
const MORE_SHADOW = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.06,
  shadowRadius: 10,
  elevation: 2,
} as const;
const MENU_SHADOW = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.08,
  shadowRadius: 16,
  elevation: 4,
} as const;

export function TripCard({
  vm,
  onPress,
  onResume,
  testIDPrefix,
  onPressDelete,
  menuOpen = false,
  onPressMenu,
}: TripCardProps): ReactElement {
  const {
    tripId,
    title,
    metaLine,
    badge,
    extra,
    resume,
    imageUrl,
    coverCity,
    coverTone = 'upcoming',
  } = vm;
  const city = coverCity?.trim() ? coverCity.trim() : null;
  const showMore = onPressDelete !== undefined;
  const showMenu = showMore && menuOpen;

  // TRIP-788 · resume 는 배지와 독립(AC-5 seam) — 명시 신호가 오면 그것, 없으면 기존 배지 파생 폴백.
  // 생성중(resume=false)이 draft 배지를 써도 이 게이트가 resume 누출을 막는다.
  const showResume = resume ?? badge === 'draft';

  return (
    <Pressable
      testID={`${testIDPrefix}-card-${tripId}`}
      accessibilityRole="button"
      onPress={onPress}
      className="w-full overflow-hidden rounded-card border border-hairline bg-canvas"
    >
      {/* 사진 자리 — imageUrl(픽스처 전용, AC-6 G7) 있으면 Image, 없으면 톤별 그라데이션 + 도시 이름
          (Trip 에 사진 필드 없음, INV-1). 배지·resume 는 이 위에 얹는다. */}
      <View className="h-[178px] w-full">
        {imageUrl ? (
          <Image
            testID={`${testIDPrefix}-photo-${tripId}`}
            source={{ uri: imageUrl }}
            className="h-[178px] w-full"
          />
        ) : (
          <>
            <LinearGradient
              colors={[...COVER_GRADIENTS[coverTone]]}
              start={COVER_START}
              end={COVER_END}
              style={{
                position: 'absolute',
                top: 0,
                right: 0,
                bottom: 0,
                left: 0,
              }}
            />
            {city !== null ? (
              <Text
                testID={`${testIDPrefix}-city-${tripId}`}
                numberOfLines={1}
                className="absolute left-[16px] right-[120px] top-[16px] font-noto-bold text-[22px] font-bold leading-[29px] text-on-primary"
              >
                {city}
              </Text>
            ) : null}
          </>
        )}
        {/* 우상단 줄 — [배지][⋯](Figma topRight, gap 8). testID 없음(TC7 host testID 수 보호). */}
        <View className="absolute right-[14px] top-[14px] flex-row items-center gap-sm">
          {badge !== null ? (
            <View
              testID={`${testIDPrefix}-badge-${tripId}`}
              className={`rounded-pill px-md py-[5px] ${
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
          {showMore ? (
            <Pressable
              testID={`${testIDPrefix}-menu-${tripId}`}
              accessibilityRole="button"
              accessibilityLabel="여행 메뉴"
              onPress={onPressMenu}
              hitSlop={4}
              style={MORE_SHADOW}
              className={`h-[36px] w-[36px] items-center justify-center rounded-pill ${
                menuOpen ? 'bg-surface-strong' : 'bg-canvas'
              }`}
            >
              <MoreDotsGlyph size={20} />
            </Pressable>
          ) : null}
        </View>

        {/* 팝오버 — ⋯ 아래 3px(14+36+3), 오른쪽 끝 맞춤. 사진 자리(178) 안에 들어가 카드 overflow 에 안 잘린다. */}
        {showMenu ? (
          <View
            testID={`${testIDPrefix}-menu-panel-${tripId}`}
            style={MENU_SHADOW}
            className="absolute right-[14px] top-[53px] w-[160px] rounded-button border border-hairline bg-canvas py-xs"
          >
            <Pressable
              testID={`${testIDPrefix}-menu-delete-${tripId}`}
              accessibilityRole="button"
              onPress={onPressDelete}
              className="h-[44px] flex-row items-center gap-sm px-lg"
            >
              <TrashGlyph size={18} />
              <Text className="font-noto text-body text-primary">
                {MENU_DELETE_LABEL}
              </Text>
            </Pressable>
          </View>
        ) : null}

        {showResume ? (
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
