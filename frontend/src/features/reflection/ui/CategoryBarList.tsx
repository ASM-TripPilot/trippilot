import type { ReactElement } from 'react';
import { Text, View } from 'react-native';

import type { CategoryShare } from '@/shared/api/generated/schemas';

import { categoryLabel } from '../model/styleThreshold';

/**
 * TRIP-573 · j05 카테고리 비율 막대 — 행마다 `라벨 …… N%` + 트랙 위 채움 막대.
 *
 * ★ 글리프 fill 함정 회피: SVG 한 장으로 그리면 "값 4행인데 3행"이 전 심판 green(색·개수는 jest 사각).
 * → 막대를 **행마다 exact testID(`reflection-style-bar`) View** 로 그려 개수·라벨·퍼센트를 테스트가
 * 잰다. 최상위(max) 행만 코랄(primary), 나머지는 어두운 채움(body) — 이 색 구분은 [검증] 픽셀 몫(무심판).
 *
 * [[반쪽 방어]]: `categories` 가 null/undefined(계약 위반 응답)여도 `?? []` 로 0막대·무크래시.
 * 라벨은 `categoryLabel`(맛집→미식·isOther→기타), 퍼센트는 서버 비율(0~1)을 정수 %로 반올림.
 */

export interface CategoryBarListProps {
  categories: CategoryShare[] | null | undefined;
}

export function CategoryBarList({
  categories,
}: CategoryBarListProps): ReactElement {
  const list = categories ?? [];
  const maxRatio = list.length
    ? Math.max(...list.map((share) => share.ratio))
    : -1;

  return (
    <View className="gap-md">
      {list.map((share, index) => {
        const percent = Math.round(share.ratio * 100);
        const isTop = share.ratio === maxRatio;
        return (
          <View
            key={`${share.category}-${index}`}
            testID="reflection-style-bar"
            className="gap-[8px]"
          >
            <View className="flex-row items-center justify-between">
              <Text className="font-noto-bold text-[16px] font-bold text-ink">
                {categoryLabel(share)}
              </Text>
              <Text className="font-noto-bold text-[16px] font-bold text-ink">
                {percent}%
              </Text>
            </View>
            <View className="h-[6px] w-full overflow-hidden rounded-pill bg-hairline">
              <View
                className={`h-full rounded-pill ${isTop ? 'bg-primary' : 'bg-body'}`}
                style={{ width: `${percent}%` }}
              />
            </View>
          </View>
        );
      })}
    </View>
  );
}
