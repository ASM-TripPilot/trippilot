import type { ReactElement, ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';

import { PencilGlyph } from '@/features/itinerary/index.view';
import { SparkleGlyph } from '@/features/open-assistant';
import { GLYPH_COLORS } from '@/shared/ui/glyphs';
import { GlassSurface } from '@/shared/ui/GlassSurface';

/**
 * TRIP-1522 · i01 허브 수정 팝업(순수 프레임) — 하단 바의 "수정" 칸을 누르면 칸 위에 세로로 쌓이는 알약 둘:
 * 위 **AI에게 맡기기**, 아래 **직접 수정**(Figma B `5031:3438`, 딤 없음). 어디에 붙일지(칸 중심·바 윗변 − 8)는
 * 허브가 `editPopupPlacement` 로 정해 앵커에 붙이고, 여기는 항목·순서·비활성·유리 표면만 맡는다.
 * `onPressAi` 가 없으면(지난 날·시작 전 여행) AI 항목은 흐리고 `Pressable disabled` 로 눌림이 막힌다 — 직접 수정은 산다.
 * 글자는 라벨뿐이다(INV-2·3).
 */

export interface LiveEditPopupProps {
  /** 없으면 AI 항목이 비활성(흐림)이다. */
  onPressAi?: () => void;
  onPressManual: () => void;
}

function Item({
  testID,
  label,
  icon,
  onPress,
}: {
  testID: string;
  label: string;
  icon: ReactNode;
  onPress?: () => void;
}): ReactElement {
  const disabled = onPress === undefined;
  return (
    <GlassSurface className={disabled ? 'opacity-40' : ''}>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onPress}
        className="flex-row items-center gap-sm py-md pl-lg pr-[18px]"
      >
        {icon}
        <Text className="font-noto-bold text-body font-bold text-ink">
          {label}
        </Text>
      </Pressable>
    </GlassSurface>
  );
}

export function LiveEditPopup({
  onPressAi,
  onPressManual,
}: LiveEditPopupProps): ReactElement {
  return (
    <View testID="execution-live-edit-popup" className="items-center gap-sm">
      <Item
        testID="execution-live-edit-popup-ai"
        label="AI에게 맡기기"
        icon={<SparkleGlyph size={20} color={GLYPH_COLORS.primary} />}
        onPress={onPressAi}
      />
      <Item
        testID="execution-live-edit-popup-manual"
        label="직접 수정"
        icon={<PencilGlyph size={18} tone="primary" />}
        onPress={onPressManual}
      />
    </View>
  );
}
