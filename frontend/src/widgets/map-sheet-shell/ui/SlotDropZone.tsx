import type { ReactElement } from 'react';
import { Text, View } from 'react-native';

import { TrashGlyph } from './EditorGlyphs';

/**
 * TRIP-797 · AC-9 — h12 편집기 드래그 삭제 드롭존(presentation-only). TRIP-921 로 편집 뷰와 함께
 * widgets 로 옮겨 왔다(위젯은 features 를 못 문다). 편집 뷰가 드래그 리스트 **맨 끝 센티널** 칸에 끌기
 * 중에만 그린다 — 이 칸 뒤에 놓인 카드가 삭제된다(판정은 EditorView).
 *
 * 값은 Figma `4197:2468`(흰 바탕 · 1.5px primary 점선 · h56 · gap 8 · 휴지통 20 · ink Bold 15). 반경은
 * 킷 동기화 전이라 `rounded-card` 현행 유지(Figma 12).
 *
 * `isActive` 면 활성 표식(`itinerary-edit-dropzone-active`)을 추가로 그린다 — 색은 jest 원리적 사각이라
 * 표식 View 존재로 계약한다(02a ★7).
 */

export interface SlotDropZoneProps {
  isActive?: boolean;
}

export function SlotDropZone({ isActive }: SlotDropZoneProps): ReactElement {
  return (
    <View
      testID="itinerary-edit-dropzone"
      className={`h-[56px] flex-row items-center justify-center gap-sm rounded-card border-[1.5px] border-dashed bg-canvas ${
        isActive ? 'border-primary' : 'border-hairline-strong'
      }`}
    >
      <TrashGlyph size={20} />
      <Text className="font-noto-bold text-card-title font-bold text-ink">
        여기에 놓으면 삭제돼요
      </Text>
      {/* 활성 표식 — 색이 아니라 존재로 계약(02a ★7). */}
      {isActive ? (
        <View testID="itinerary-edit-dropzone-active" className="h-0 w-0" />
      ) : null}
    </View>
  );
}
