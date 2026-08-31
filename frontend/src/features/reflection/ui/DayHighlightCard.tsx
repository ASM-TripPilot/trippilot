import type { ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';

/**
 * TRIP-572 · j04 날짜별 하이라이트 카드. testID `reflection-summary-day-card`(카드당 1).
 *
 * 무엇을 보장하나: 하루치 요약을 한 카드로 그린다 — 썸네일 자리·`Day N · M곳`(countLabel)·부제
 * (daySubtitle 파생, 테마 문구 발명 없음)·chevron. **소요시간 없음**(INV-3, 거리조차 카드엔 없다).
 *
 * 썸네일은 자리표시만이다 — `DayHighlight` 계약에 사진 URL 이 없어 실 이미지를 못 그린다(가짜 이미지
 * 금지, 실 배선은 계약 확장 후속 티켓). 값은 페이지가 조립해 넘긴 완성 문자열만 받는다(무상태).
 */

export interface DayHighlightCardProps {
  /** '6월 11일 목요일' — 페이지가 formatKoreanDate 로 조립. */
  dateLabel: string;
  /** 'Day1 · 5곳' — dayOrder + visitCount 파생. */
  countLabel: string;
  /** '광안리 해변→전포 카페거리' — daySubtitle(places). 빈 문자열이면 부제 줄 생략. */
  subtitle: string;
  onPress?: () => void;
}

export function DayHighlightCard({
  dateLabel,
  countLabel,
  subtitle,
  onPress,
}: DayHighlightCardProps): ReactElement {
  return (
    <Pressable
      testID="reflection-summary-day-card"
      onPress={onPress}
      className="w-full flex-row items-center gap-md rounded-card border border-hairline bg-canvas p-[12px]"
    >
      {/* 썸네일 자리 — 사진 URL 계약 부재라 자리표시(가짜 이미지 금지). */}
      <View className="h-[56px] w-[56px] rounded-card bg-surface-soft" />

      <View className="flex-1 gap-[2px]">
        <Text className="font-noto-bold text-card-title font-bold text-ink">
          {countLabel}
        </Text>
        <Text className="text-label text-muted">{dateLabel}</Text>
        {subtitle ? (
          <Text className="text-label text-muted" numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>

      <Text className="font-noto text-[20px] text-muted-soft">›</Text>
    </Pressable>
  );
}
