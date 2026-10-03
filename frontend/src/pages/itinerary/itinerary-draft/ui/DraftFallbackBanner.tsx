import type { ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';

import {
  AlertCircleGlyph,
  ChevronRightGlyph,
} from '@/features/itinerary/index.view';

/**
 * TRIP-1039 · h08 셸 시트 맨 위에 얹는 폴백·일부 실패 안내(BR-U3-11 · INV-4). Figma 전용 프레임이 없어
 * h07 message-card(`3831:2212`) 결 + h14 시트 안 NoticeBar(`4466:1794`) 자리로 합성했다.
 *
 * 순수 표시(useState·조회·라우터 0) — 판정 결과(boolean)만 받는다. 컨테이너(`DraftPage`)와 다른 파일이라야
 * 프리뷰가 네트워크 계층 없이 가져다 쓴다(`NoBaseNoticeCard` 선례). 둘 다 false 면 아무것도 안 그린다.
 */

const FALLBACK_REASON_TITLE = '취향 반영 없이 만든 기본 일정이에요';
const REASON_SUBTITLE = '장소 하나만 다른 후보로 바꿀 수도 있어요';
const MANUAL_LINK = '처음부터 직접 짜기';
/** 원인을 특정하지 않는다 — 여기로 오는 사건이 여럿이다(`DraftScreen` 같은 문구와 같은 이유). */
const STALE_FAILED_NOTE = '일부 정보를 불러오지 못했어요';

export function DraftFallbackBanner({
  fallback,
  staleFailed,
  onManualPlan,
}: {
  fallback: boolean;
  staleFailed: boolean;
  onManualPlan?: () => void;
}): ReactElement | null {
  if (!fallback && !staleFailed) return null;

  return (
    <View className="gap-md">
      {fallback ? (
        <View
          testID="itinerary-draft-fallback-banner"
          className="w-full flex-row items-start gap-md rounded-button border border-hairline bg-canvas px-lg py-md"
        >
          <AlertCircleGlyph />
          <View className="flex-1 items-start gap-[6px]">
            <Text
              testID="itinerary-draft-reason-title"
              className="font-noto-bold text-card-title font-bold text-ink"
            >
              {FALLBACK_REASON_TITLE}
            </Text>
            <Text
              testID="itinerary-draft-reason-subtitle"
              className="font-noto text-label text-muted"
            >
              {REASON_SUBTITLE}
            </Text>
            {onManualPlan === undefined ? null : (
              <Pressable
                testID="itinerary-draft-manual"
                accessibilityRole="button"
                onPress={onManualPlan}
                hitSlop={8}
                className="flex-row items-center gap-[2px]"
              >
                <Text className="font-noto-bold text-label font-bold text-primary-text">
                  {MANUAL_LINK}
                </Text>
                <ChevronRightGlyph size={16} />
              </Pressable>
            )}
          </View>
        </View>
      ) : null}

      {staleFailed ? (
        <View
          testID="itinerary-draft-stale-failed"
          className="w-full flex-row items-center gap-sm rounded-button border border-hairline bg-surface-soft px-md py-md"
        >
          <AlertCircleGlyph />
          <Text className="flex-1 font-noto text-label text-body">
            {STALE_FAILED_NOTE}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
