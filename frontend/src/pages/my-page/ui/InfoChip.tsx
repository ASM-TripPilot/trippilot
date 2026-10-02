import type { ReactElement } from 'react';
import { Text, View } from 'react-native';

/**
 * TRIP-775 · l03 회색 정보 칩(누르지 않음) — 프로필 태그·스타일 디스크립터·여행 카드 기간/숙소/일정이
 * 같은 모양(Figma 1602:2388: r8 · surface-strong · 좌우 11 · 위아래 6 · 12 muted)이라 한 번만 짠다.
 * 글자는 받은 그대로 — 값 하나짜리 leaf 라 `getByText('숙소 3')` 완전일치가 성립한다.
 * 반경 8 은 raw 다(킷 §3 반경 토큰 동기화 대기, TRIP-780 선례).
 */
export function InfoChip({
  label,
  testID,
}: {
  label: string;
  testID?: string;
}): ReactElement {
  return (
    <View
      testID={testID}
      className="rounded-[8px] bg-surface-strong px-[11px] py-[6px]"
    >
      <Text className="font-noto text-caption text-muted">{label}</Text>
    </View>
  );
}
