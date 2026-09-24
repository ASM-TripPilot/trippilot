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
 *
 * TRIP-765 정합: 카드 크롬(테두리·둥근 배경)을 벗고 **플레인 행**으로 — 제목(14 bold ink)+코랄
 * chevron(text-primary). testID·미주입 degrade 계약은 그대로.
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
        className="flex-row items-center gap-[6px] py-[4px]"
      >
        <Text className="font-noto-bold text-body font-bold text-ink">
          근거가 된 방문 데이터
        </Text>
        <Text className="font-noto text-body text-primary">›</Text>
      </Pressable>
      {degraded ? (
        <Text className="font-noto text-label text-muted">
          준비 중이에요 — 곧 근거 데이터를 볼 수 있어요
        </Text>
      ) : null}
    </View>
  );
}
