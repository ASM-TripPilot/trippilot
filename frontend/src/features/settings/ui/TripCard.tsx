import type { ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';

import { ChevronRightGlyph } from './SettingsGlyphs';

/**
 * TRIP-604 · l03 여행 카드 1장 — 순수 프레젠테이션(VM + 회고 콜백만). 판정·조회는 컨테이너
 * (`pages/my-page/TripCardContainer`)가 지고, 이 카드는 완성된 VM 필드만 그린다.
 *
 * 무엇을 보장하나(승인 계약):
 *  - 목적지(region)·기간·숙소 수·일정 수를 그린다(BR-U6-22). 숙소 수·일정 수 칩은 **값 하나만**
 *    담는 leaf 라 `getByText('숙소 3')`·`getByText('일정 2일')` 완전일치가 성립한다.
 *  - `숙소 미등록`(bases 0)과 `숙소 N`(bases≥1)이 한 칩 자리에서 정확히 갈린다(AC-3).
 *  - `isEnded` 일 때만 회고 진입 chevron(`my-trip-reflection-{id}`)을 그린다 — 텍스트 없는
 *    어포던스라 testID 로만 잡힌다(AC-4·AC-5). 그 외 카드엔 어포던스 자체가 없다.
 *  - 소요시간 문자열 0(INV-3) — "일정 N일"은 일수지 시간이 아니다.
 *
 * 카드 heading 은 **목적지 region**(트립 title 이 아니다) — 계약이 목적지를 title 과 별개로
 * 요구한다(★9). 다중 목적지는 컨테이너가 ` · ` 로 이어 하나의 heading 문자열로 내린다.
 */

export interface TripCardVM {
  tripId: string;
  /** 목적지 region 조인 — "부산" 또는 "부산 · 제주". 카드 heading. */
  destinationLabel: string;
  /** "6.10~6.12" (M.D~M.D, 점·물결). */
  dateRange: string;
  /** "숙소 3" 또는 "숙소 미등록" — bases 미도착이면 null(칩 생략, daysLabel 축과 대칭). */
  basesLabel: string | null;
  /** "일정 2일" — itinerary 미도착이면 null(칩 생략, 지연 표시). */
  daysLabel: string | null;
  /** "D-12"·"D-DAY" — 예정(미래 출발) 카드에만, 그 외 null. */
  dBadge: string | null;
  /** 종료 여행이면 회고 진입 chevron 을 그린다. */
  isEnded: boolean;
}

export interface TripCardProps {
  vm: TripCardVM;
  /** 회고 진입 press(종료 카드 전용) — 컨테이너가 `/trips/{id}/records` push 로 배선. */
  onPressReflection?: () => void;
}

/** 회색 알약 칩(값 하나짜리 leaf) — 기간·숙소·일정·목적지 공용 모양. */
function Chip({ label }: { label: string }): ReactElement {
  return (
    <View className="rounded-pill bg-surface-strong px-md py-[5px]">
      <Text className="font-noto text-caption text-body">{label}</Text>
    </View>
  );
}

export function TripCard({
  vm,
  onPressReflection,
}: TripCardProps): ReactElement {
  const {
    tripId,
    destinationLabel,
    dateRange,
    basesLabel,
    daysLabel,
    dBadge,
    isEnded,
  } = vm;

  return (
    <View
      testID={`my-trip-card-${tripId}`}
      className="w-full gap-[10px] rounded-card border border-hairline bg-canvas p-[14px]"
    >
      {/* 상단 줄 — D-배지(예정)와 회고 chevron(종료)이 각자 자리를 가진다. */}
      {dBadge !== null || isEnded ? (
        <View className="flex-row items-center">
          {dBadge !== null ? (
            <View className="rounded-pill bg-ink px-md py-[3px]">
              <Text className="font-noto-bold text-caption font-bold text-on-primary">
                {dBadge}
              </Text>
            </View>
          ) : null}
          <View className="flex-1" />
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
      ) : null}

      {/* 목적지 heading — region 조인(트립 title 아님, ★9). */}
      <Text
        numberOfLines={1}
        className="font-noto-bold text-[16px] font-bold text-ink"
      >
        {destinationLabel}
      </Text>

      {/* 대표정보 칩 — 각 leaf 는 값 하나만 담는다(완전일치 계약). */}
      <View className="flex-row flex-wrap items-center gap-[6px]">
        <Chip label={dateRange} />
        {basesLabel !== null ? <Chip label={basesLabel} /> : null}
        {daysLabel !== null ? <Chip label={daysLabel} /> : null}
      </View>
    </View>
  );
}
