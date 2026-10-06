import type { ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';

import { BackChevronGlyph } from './TripWizardHeaderGlyphs';

/**
 * 여행 만들기 위저드 공용 앱바 — 1/4(g01)·2/4(g02)·3/4(h01)이 같이 쓴다(TRIP-1266 · QA F7).
 * 치수는 Figma g01·g02 앱바 기준: 높이 56(위아래 16 + ‹ 24) · 좌우 16 · ‹–제목 10 · 막대 14×4 r2
 * 간격 4 · 막대–분수 6(`gap-xs` + `ml-[2px]`). Figma h01 앱바(52·12·6·18)와는 어긋난다(01b Q1).
 *
 * 위젯은 features 를 모른다 — 채울 칸 수와 "N / 4" 문자열은 소비처가 `progress` 로 넘기고
 * 그대로 그린다. `progress` 가 없으면 진행 표시 통째로 없음(2/4 거점 편집 얼굴).
 * SafeArea 는 화면이 소유한다.
 */

const SEGMENTS = [1, 2, 3, 4] as const;

export interface TripWizardHeaderProps {
  title: string;
  onBack: () => void;
  /** 화면별 기존 이름 — Maestro·통합 테스트가 이 이름으로 누른다. */
  backTestID: string;
  progress?: { filled: number; label: string };
}

export function TripWizardHeader({
  title,
  onBack,
  backTestID,
  progress,
}: TripWizardHeaderProps): ReactElement {
  return (
    <View
      testID="trip-wizard-header"
      className="w-full flex-row items-center gap-[10px] bg-canvas px-lg py-lg"
    >
      <Pressable
        testID={backTestID}
        accessibilityRole="button"
        accessibilityLabel="뒤로"
        onPress={onBack}
        hitSlop={8}
      >
        <BackChevronGlyph />
      </Pressable>
      <Text className="font-noto-bold text-section font-bold text-ink">
        {title}
      </Text>
      <View className="flex-1" />
      {progress ? (
        <View
          testID="trip-wizard-progress"
          className="flex-row items-center gap-xs"
        >
          {SEGMENTS.map((n) => (
            <View
              key={n}
              testID={`trip-wizard-progress-seg-${n}`}
              className={`h-1 w-[14px] rounded-[2px] ${
                n <= progress.filled ? 'bg-primary' : 'bg-hairline-strong'
              }`}
            />
          ))}
          <Text className="ml-[2px] font-inter-bold text-caption text-muted">
            {progress.label}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
