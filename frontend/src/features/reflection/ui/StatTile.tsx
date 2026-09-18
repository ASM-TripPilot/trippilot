import type { ReactElement } from 'react';
import { Text, View } from 'react-native';

/**
 * TRIP-573 · j05 통계 타일 — 큰 숫자 + 단위 + 하단 라벨(카드형). 하루 평균 방문·평균 체류 두 자리에서 쓴다.
 *
 * ★ INV-3 강제 형태: 숫자·단위를 **값 인터폴레이션**으로만 그린다(`value`·`unit` prop). 소스에 리터럴
 * `72분` 같은 숫자+분 문자열을 두지 않아 기존 INV-3 가드(reflectionStructure G6·reflectionSummaryStructure
 * AC-4·travelStyleStructure)가 무수정 통과한다. 값과 단위는 **한 Text** 로 이어 붙여(`{value}{unit}`)
 * 렌더 텍스트가 `72분` 한 덩어리가 되게 한다(개별 Text 로 쪼개면 `getByText(/72분/)` 가 못 잡는다).
 */

export interface StatTileProps {
  value: number | string;
  unit: string;
  label: string;
  testID: string;
}

export function StatTile({
  value,
  unit,
  label,
  testID,
}: StatTileProps): ReactElement {
  return (
    <View
      testID={testID}
      className="flex-1 gap-[6px] rounded-card bg-surface-soft px-lg py-[18px]"
    >
      <Text className="font-noto-bold text-[24px] font-bold text-ink">
        {value}
        {unit}
      </Text>
      <Text className="font-noto text-label text-muted">{label}</Text>
    </View>
  );
}
