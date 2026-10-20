import type { ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';

import type { Opportunity } from '@/shared/api/index.schemas';
import { CloseGlyph } from '@/shared/ui/glyphs';

import { opportunityCopy } from '../model/hubOpportunity';

/**
 * 상황 감지 FE-C · frontend-components §4.2 · BR-SA-22 — 허브 기회 카드(순수 프레젠테이션, props 만).
 *
 * 문장은 고정 템플릿(`opportunityCopy`) 한 곳에서 온다 — 카드는 시각·`오늘 열려요`·`N분` 을 만들지 않고 거리는
 * 서버 `distanceLabel` 그대로다(INV-2·3). 고르기·숨김 기억·이동은 페이지·훅 몫이고 카드는 콜백만 부른다.
 * 화면 정본 프레임이 아직 없다(G-SA-12) — 모양은 허브 카드(`SlotProgressCard` 예정 카드)의 기존 토큰을 따른다.
 */

export interface OpportunityCardProps {
  item: Opportunity;
  /** [넣어서 다시 짜기] — i04 로 간다(경로는 페이지가 만든다). */
  onPressReplan: () => void;
  /** × — 이 날 이 카드를 기기에서 숨긴다(숨김 기억은 훅 몫). */
  onDismiss: () => void;
}

export function OpportunityCard({
  item,
  onPressReplan,
  onDismiss,
}: OpportunityCardProps): ReactElement {
  const copy = opportunityCopy(item);
  return (
    <View
      testID="execution-live-opportunity-card"
      className="mb-md gap-[10px] rounded-button border border-hairline bg-canvas p-[14px]"
    >
      <View className="flex-row items-start gap-sm">
        <Text
          testID="execution-live-opportunity-title"
          className="flex-1 font-noto-bold text-body font-bold text-ink"
        >
          {copy.title}
        </Text>
        <Pressable
          testID="execution-live-opportunity-dismiss"
          accessibilityRole="button"
          accessibilityLabel="이 추천 닫기"
          hitSlop={8}
          onPress={onDismiss}
        >
          <CloseGlyph size={18} color="muted" />
        </Pressable>
      </View>
      <Text
        testID="execution-live-opportunity-body"
        className="font-noto text-label text-body"
      >
        {copy.body}
      </Text>
      {copy.note ? (
        <Text className="font-noto text-caption text-muted">{copy.note}</Text>
      ) : null}
      <Pressable
        testID="execution-live-opportunity-cta"
        accessibilityRole="button"
        onPress={onPressReplan}
        className="self-start rounded-[10px] bg-primary px-md py-[10px]"
      >
        <Text className="font-noto-bold text-caption font-bold text-on-primary">
          넣어서 다시 짜기
        </Text>
      </Pressable>
    </View>
  );
}
