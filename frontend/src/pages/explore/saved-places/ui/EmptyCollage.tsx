import type { ReactElement } from 'react';
import { View } from 'react-native';

import { HeartFilledGlyph } from '@/shared/ui/HeartGlyphs';

/**
 * empty 삽화 — Figma 1695:1183 · 2437:1616 의 사진 3장 부채꼴 + 중앙 하트 원. 저장한 장소(`SavedPlaceListScreen`)와
 * 꼭 가고 싶은 곳 고르기(`MustVisitPickScreen`) 두 화면이 같은 그림을 쓴다 — testID 만 화면이 정한다.
 * 실사진은 에셋 라이선스·출처 미정이라 회색 벡터로 대체(미충족 기록, 6-b 육안). 기울기는 transform 으로만 낸다.
 */
export function EmptyCollage({ testID }: { testID: string }): ReactElement {
  return (
    <View
      testID={testID}
      className="h-[170px] w-[230px] flex-row items-center justify-center"
    >
      <View
        className="h-[118px] w-[74px] rounded-card bg-surface-strong"
        style={{ transform: [{ rotate: '-12deg' }], marginRight: -12 }}
      />
      <View className="z-10 h-[162px] w-[96px] items-center justify-center rounded-card bg-surface-soft">
        <View className="h-12 w-12 items-center justify-center rounded-pill bg-canvas">
          <HeartFilledGlyph size={26} />
        </View>
      </View>
      <View
        className="h-[118px] w-[74px] rounded-card bg-surface-strong"
        style={{ transform: [{ rotate: '12deg' }], marginLeft: -12 }}
      />
    </View>
  );
}
