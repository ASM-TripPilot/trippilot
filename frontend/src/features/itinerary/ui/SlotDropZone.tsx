import type { ReactElement } from 'react';
import { Text, View } from 'react-native';

import { TrashGlyph } from './ItineraryGlyphs';

/**
 * TRIP-797 · AC-9 — h12 편집기 드래그 삭제 드롭존(presentation-only). 드래그 중 하단 CTA 자리를
 * 대체해 "여기에 놓으면 삭제돼요"를 보여주는 정적 얼굴이다.
 *
 * `isActive`(끌기 대상이 드롭존 위)면 활성 표식(`itinerary-edit-dropzone-active`)을 추가로 그린다 —
 * 빨강 점선·그림자 같은 **색은 jest 원리적 사각**이라 색이 아니라 표식 View 존재로 계약한다(02a ★7).
 * 실제 드롭 삭제 동작은 드래그 제스처가 필요해 6-b 실기 전용(`h12-editor-dragging` 프리뷰).
 */

export interface SlotDropZoneProps {
  isActive?: boolean;
}

export function SlotDropZone({ isActive }: SlotDropZoneProps): ReactElement {
  return (
    <View
      testID="itinerary-edit-dropzone"
      className={`flex-row items-center justify-center gap-xs rounded-card border border-dashed bg-canvas px-lg py-md ${
        isActive ? 'border-primary' : 'border-hairline-strong'
      }`}
    >
      <TrashGlyph size={18} />
      <Text className="font-noto-bold text-label font-bold text-primary-text">
        여기에 놓으면 삭제돼요
      </Text>
      {/* 활성 표식 — 색이 아니라 존재로 계약(끌기 대상이 드롭존 위, 02a ★7). */}
      {isActive ? (
        <View testID="itinerary-edit-dropzone-active" className="h-0 w-0" />
      ) : null}
    </View>
  );
}
