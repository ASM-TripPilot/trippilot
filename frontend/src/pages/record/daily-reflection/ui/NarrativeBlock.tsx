import type { ReactElement } from 'react';
import { Text, View } from 'react-native';

/**
 * TRIP-571 · 서술 블록. testID `reflection-daily-narrative`.
 *
 * 무엇을 보장하나: 완성된 표시본 문자열을 그대로 그린다. 화면(상류 페이지)이 `reflectionFallback`
 * 으로 이미 표시본을 정해 `narrative` 로 내려주므로, 이 블록은 `draftNarrative`/`editedNarrative`/
 * `resolveDisplayNarrative` 어느 것도 참조하지 않는다(AC-8 이 소스로 강제 — 화면이 자체 폴백을 못 만든다).
 */

export interface NarrativeBlockProps {
  narrative: string;
}

export function NarrativeBlock({
  narrative,
}: NarrativeBlockProps): ReactElement {
  return (
    <View testID="reflection-daily-narrative" className="w-full">
      <Text className="font-noto text-body leading-[22px] text-body">
        {narrative}
      </Text>
    </View>
  );
}
