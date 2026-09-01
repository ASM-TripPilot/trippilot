import type { ReactElement } from 'react';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

/**
 * TRIP-573 · j05 근거 진입 링크 — `근거가 된 방문 데이터 ›`.
 *
 * Q3·INV-4 정직 degrade: 근거 방문 목적지 라우트가 정본에 아직 없다(계정 단위라 단일 여행 없음,
 * Follow-up E). 목적지가 정해져 `onPress` 가 주입되면 그리로 보내고, 미주입이면 press 에 **로컬
 * "준비 중" 안내만** 띄운다(가짜 이동 0 — 죽은 네비게이션·거짓 성공 금지).
 *
 * chevron 은 `›` 텍스트(StyleSummaryCard 관례 — 전용 글리프 미신설, ponytail lite).
 */

export interface EvidenceLinkProps {
  onPress?: () => void;
}

export function EvidenceLink({ onPress }: EvidenceLinkProps): ReactElement {
  const [degraded, setDegraded] = useState(false);

  const handlePress = () => {
    if (onPress) {
      onPress();
      return;
    }
    setDegraded(true);
  };

  return (
    <View className="gap-[6px]">
      <Pressable
        testID="reflection-style-evidence"
        accessibilityRole="button"
        onPress={handlePress}
        className="flex-row items-center justify-between rounded-card border border-hairline bg-canvas px-lg py-[16px]"
      >
        <Text className="font-noto text-body text-ink">
          근거가 된 방문 데이터
        </Text>
        <Text className="font-noto text-body text-muted">›</Text>
      </Pressable>
      {degraded ? (
        <Text className="font-noto text-label text-muted">
          준비 중이에요 — 곧 근거 데이터를 볼 수 있어요
        </Text>
      ) : null}
    </View>
  );
}
