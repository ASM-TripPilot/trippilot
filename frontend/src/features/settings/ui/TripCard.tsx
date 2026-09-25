import type { ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';

import { CARD_SHADOW } from './cardShadow';
import { InfoChip } from './InfoChip';
import { ChevronRightGlyph } from './SettingsGlyphs';

/**
 * TRIP-604 · l03 여행 카드 1장 — 순수 프레젠테이션(VM + 회고 콜백만). 판정·조회는 컨테이너
 * (`pages/my-page/TripCardContainer`)가 지고, 이 카드는 완성된 VM 필드만 그린다.
 *
 * 무엇을 보장하나(승인 계약):
 *  - 제목(`trip.title`)·기간·숙소 수·일정 수를 그린다(BR-U6-22 — 서버 기본 제목이 "{첫 목적지} 여행"). 숙소 수·일정 수 칩은 **값 하나만**
 *    담는 leaf 라 `getByText('숙소 3')`·`getByText('일정 2일')` 완전일치가 성립한다.
 *  - `숙소 미등록`(bases 0)과 `숙소 N`(bases≥1)이 한 칩 자리에서 정확히 갈린다(AC-3).
 *  - `isEnded` 일 때만 회고 진입 chevron(`my-trip-reflection-{id}`)을 그린다 — 텍스트 없는
 *    어포던스라 testID 로만 잡힌다(AC-4·AC-5). 그 외 카드엔 어포던스 자체가 없다.
 *  - 소요시간 문자열 0(INV-3) — "일정 N일"은 일수지 시간이 아니다.
 *
 * TRIP-775(Figma 1602:2388): 머리줄 한 줄 = [D-배지][제목](+종료면 회고 chevron). 배지 색은 VM 의
 * `dBadgeTone`(의미 등급)을 받아 화면이 클래스로 바꾼다 — 판정(며칠 이하인가)은 컨테이너 몫.
 */

export interface TripCardVM {
  tripId: string;
  /** 카드 제목 = `trip.title`("부산 여행"). */
  title: string;
  /** "6.10~6.12" (M.D~M.D, 점·물결). */
  dateRange: string;
  /** "숙소 3" 또는 "숙소 미등록" — bases 미도착이면 null(칩 생략, daysLabel 축과 대칭). */
  basesLabel: string | null;
  /** "일정 2일" — itinerary 미도착이면 null(칩 생략, 지연 표시). */
  daysLabel: string | null;
  /** "D-12"·"D-DAY" — 예정(미래 출발) 카드에만, 그 외 null. */
  dBadge: string | null;
  /** D-배지 바탕 — 'primary'(임박) / 'ink'(여유). 배지가 없으면 쓰이지 않는다. */
  dBadgeTone: 'primary' | 'ink';
  /** 종료 여행이면 회고 진입 chevron 을 그린다. */
  isEnded: boolean;
}

export interface TripCardProps {
  vm: TripCardVM;
  /** 회고 진입 press(종료 카드 전용) — 컨테이너가 `/trips/{id}/records` push 로 배선. */
  onPressReflection?: () => void;
}

export function TripCard({
  vm,
  onPressReflection,
}: TripCardProps): ReactElement {
  const {
    tripId,
    title,
    dateRange,
    basesLabel,
    daysLabel,
    dBadge,
    dBadgeTone,
    isEnded,
  } = vm;

  return (
    <View
      testID={`my-trip-card-${tripId}`}
      style={CARD_SHADOW}
      className="w-full gap-[10px] rounded-[12px] border border-hairline bg-canvas p-[14px]"
    >
      {/* 머리줄 — [D-배지(예정)][제목] + 회고 chevron(종료). */}
      <View className="flex-row items-center gap-sm">
        {dBadge !== null ? (
          <View
            className={`rounded-[8px] px-[10px] py-[5px] ${
              dBadgeTone === 'primary' ? 'bg-primary' : 'bg-ink'
            }`}
          >
            <Text className="font-inter-bold text-caption font-bold text-on-primary">
              {dBadge}
            </Text>
          </View>
        ) : null}
        <Text
          numberOfLines={1}
          className="flex-1 font-noto-bold text-[16px] font-bold text-ink"
        >
          {title}
        </Text>
        {isEnded ? (
          <Pressable
            testID={`my-trip-reflection-${tripId}`}
            accessibilityRole="button"
            accessibilityLabel="회고 보기"
            onPress={onPressReflection}
            className="h-8 w-8 items-center justify-center"
          >
            <ChevronRightGlyph size={22} />
          </Pressable>
        ) : null}
      </View>

      {/* 대표정보 칩 — 각 leaf 는 값 하나만 담는다(완전일치 계약). */}
      <View className="flex-row flex-wrap items-center gap-sm">
        <InfoChip label={dateRange} />
        {basesLabel !== null ? <InfoChip label={basesLabel} /> : null}
        {daysLabel !== null ? <InfoChip label={daysLabel} /> : null}
      </View>
    </View>
  );
}
