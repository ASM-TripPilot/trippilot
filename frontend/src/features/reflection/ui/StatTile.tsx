import type { ReactElement } from 'react';
import { Text, View } from 'react-native';

/**
 * TRIP-573 · j05 통계 타일 — 큰 숫자 + 단위 + 하단 라벨(카드형). 하루 평균 방문·평균 체류 두 자리에서 쓴다.
 *
 * ★ INV-3 강제 형태: 숫자·단위를 **값 인터폴레이션**으로만 그린다(`value`·`unit` prop). 소스에 리터럴
 * `72분` 같은 숫자+분 문자열을 두지 않아 기존 INV-3 가드(reflectionStructure G6·reflectionSummaryStructure
 * AC-4·travelStyleStructure)가 무수정 통과한다.
 *
 * ★ TRIP-765 2톤: 숫자(22 bold ink)와 단위(15 regular muted)를 **중첩** `<Text>`(바깥 Text 안에 단위
 * Text 를 넣는다 — `<Text>{value}<Text>{unit}</Text></Text>`)로 그린다. 바깥이 자식 문자열을 이어 붙여
 * 렌더 텍스트는 `72분` 한 덩어리라 `getByText(/72분/)` 가 잡고, 단위는 별도 leaf 노드라 크기·색을 따로
 * 준다. 형제(`<View><Text>72</Text><Text>분</Text></View>`)로 쪼개면 이어 붙지 않아 `getByText(/72분/)`
 * 가 못 잡는다(카드 크롬은 흰 배경+hairline 테두리+r14 — bg-surface-soft 무테에서 교체).
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
      className="flex-1 gap-[6px] rounded-[14px] border border-hairline bg-canvas px-lg py-[18px]"
    >
      <Text className="font-noto-bold text-[22px] font-bold text-ink">
        {value}
        <Text className="font-noto text-[15px] font-normal text-muted">
          {unit}
        </Text>
      </Text>
      <Text className="font-noto text-label text-muted">{label}</Text>
    </View>
  );
}
