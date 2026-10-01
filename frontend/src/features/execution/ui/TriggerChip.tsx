import { Pressable, Text, View } from 'react-native';

import { WarningFilledGlyph } from './ExecutionGlyphs';

/**
 * TRIP-561 → TRIP-748 · TriggerChip(i02) — 지도 위 일자 칩 아래에 뜨는 흰 트리거 알약 한 줄
 * `[빨강 경고삼각] {카피} ›`. 알약 전체가 한 버튼이다(→ 재계획 진입).
 *
 * **순수 프레젠테이션** — 카피는 페이지가 조립한 완성값(`triggerPillCopy`)을 그대로 그린다. 시각을
 * 만들거나 계산하지 않는다(liveTimeStructure). 부제·×(끄기)는 없다(D3 — 숨김은 허브의 로컬 상태).
 * `›` 앞 간격은 공백 글자가 아니라 `gap` 이다 — 글자 전체가 정확히 `{카피}›` 여야 한다.
 */

// 그림자 색은 토큰이 없다 — 허브 뒤로가기(BACK_SHADOW)와 같은 값(Figma 0 2 10 rgba(0,0,0,.06)).
const PILL_SHADOW = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.06,
  shadowRadius: 10,
  elevation: 3,
} as const;

export interface TriggerChipProps {
  /** 알약 카피 `{라벨} · {대상}` — 페이지가 조립한 완성 문구. 길면 한 줄 말줄임. */
  label: string;
  onPressAlternative: () => void;
}

export function TriggerChip({ label, onPressAlternative }: TriggerChipProps) {
  return (
    <View testID="execution-live-trigger-chip" className="mt-md self-start">
      <Pressable
        testID="execution-live-trigger-alternative"
        onPress={onPressAlternative}
        accessibilityRole="button"
        accessibilityLabel={`${label}, 대안 보기`}
        style={PILL_SHADOW}
        className="flex-row items-center gap-[6px] rounded-pill border border-hairline bg-canvas py-[7px] pl-[10px] pr-sm"
      >
        <WarningFilledGlyph size={12} testID="execution-live-trigger-warning" />
        <Text
          testID="execution-live-trigger-label"
          numberOfLines={1}
          className="shrink font-noto-bold text-caption font-bold text-ink"
        >
          {label}
        </Text>
        <Text className="font-noto-bold text-label font-bold text-ink">›</Text>
      </Pressable>
    </View>
  );
}
