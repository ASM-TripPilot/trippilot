import type { ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';

/**
 * TRIP-572 · j04 날짜별 하이라이트 카드. testID `reflection-summary-day-card`(카드당 1).
 *
 * 무엇을 보장하나: 하루치 요약을 한 카드로 그린다 — 72×72 썸네일 자리·`1일차`(dayLabel)·`· 5곳`
 * (visitCountLabel)·부제(daySubtitle 파생, 테마 문구 발명 없음)·chevron. **소요시간 없음**(INV-3,
 * 거리조차 카드엔 없다).
 *
 * TRIP-764(Figma 1571:2024 정합): 날짜줄(`6월 11일 목요일`)을 제거하고, 첫 줄을 `1일차`(강조)와
 * `· 5곳`(약)의 **2톤 별도 Text** 로 쪼갠다. 한 문자열로 융합하면 안 된다 — 두 Text 여야 완전일치
 * 심판(`getByText('1일차')`)이 통과한다(parity.test AC-3).
 *
 * 썸네일은 자리표시만이다 — `DayHighlight` 계약에 사진 URL 이 없어 실 이미지를 못 그린다(가짜 이미지
 * 금지, 실 배선은 계약 확장 후속 티켓 TRIP-634). 값은 페이지가 조립해 넘긴 완성 문자열만 받는다(무상태).
 */

export interface DayHighlightCardProps {
  /** '1일차' — formatDayLabel(dayOrder). 강조 Text(15 bold). */
  dayLabel: string;
  /** '5곳' — `${visitCount}곳`. 약 Text(13 muted, `· ` 접두는 카드 프레젠테이션). */
  visitCountLabel: string;
  /** '광안리 해변→전포 카페거리' — daySubtitle(places). 빈 문자열이면 부제 줄 생략. */
  subtitle: string;
  onPress?: () => void;
}

export function DayHighlightCard({
  dayLabel,
  visitCountLabel,
  subtitle,
  onPress,
}: DayHighlightCardProps): ReactElement {
  const content = (
    <>
      {/* 72×72 썸네일 자리 — 사진 URL 계약 부재라 자리표시(가짜 이미지 금지). */}
      <View className="h-[72px] w-[72px] rounded-card bg-surface-soft" />

      <View className="flex-1 gap-[2px]">
        {/* 2톤 첫 줄 — 일차(강조)·방문수(약)를 별도 Text 로 쪼갠다(융합 금지). */}
        <View className="flex-row items-center gap-[4px]">
          <Text className="font-noto-bold text-card-title font-bold text-ink">
            {dayLabel}
          </Text>
          <Text className="font-noto text-label text-muted">
            {`· ${visitCountLabel}`}
          </Text>
        </View>
        {subtitle ? (
          <Text className="text-label text-muted" numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
    </>
  );
  const cardClass =
    'w-full flex-row items-center gap-md rounded-card border border-hairline bg-canvas p-[12px]';

  // TRIP-939 A-2: 목적지(onPress)가 없으면 누를 수 없는 View 로 그리고 `›` 도 뺀다(어포던스 제거).
  if (!onPress) {
    return (
      <View testID="reflection-summary-day-card" className={cardClass}>
        {content}
      </View>
    );
  }
  return (
    <Pressable
      testID="reflection-summary-day-card"
      onPress={onPress}
      className={cardClass}
    >
      {content}
      <Text className="font-noto text-[20px] text-muted-soft">›</Text>
    </Pressable>
  );
}
