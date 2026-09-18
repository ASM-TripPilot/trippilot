import type { ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';

import type { ShareFormat } from '../model/shareCard';

/**
 * TRIP-574 · j06 포맷 세그먼트(3셀) — 활성 셀은 흰 배경+ink Bold, 비활성은 muted Regular.
 * 선택 상태는 accessibilityState.selected 로 노출(테스트가 활성 셀을 판독) · 선택이 카드 프리뷰
 * 종횡비를 바꾼다(화면이 selectedId 로컬 상태로 aspect 를 계산). 토큰: #ededed→hairline·#222→ink·
 * #6a6a6a→muted, radius 12→button(바깥)·9→rounded-[9px](활성 셀, 일회성).
 */

export interface FormatSegmentProps {
  formats: ShareFormat[];
  selectedId: ShareFormat['id'];
  onSelect: (id: ShareFormat['id']) => void;
}

export function FormatSegment({
  formats,
  selectedId,
  onSelect,
}: FormatSegmentProps): ReactElement {
  return (
    <View
      testID="reflection-share-format-seg"
      className="w-full flex-row rounded-button bg-hairline p-[3px]"
    >
      {formats.map((format) => {
        const active = format.id === selectedId;
        return (
          <Pressable
            key={format.id}
            testID={`reflection-share-format-${format.id}`}
            accessibilityState={{ selected: active }}
            onPress={() => onSelect(format.id)}
            className={`flex-1 items-center justify-center rounded-[9px] py-sm ${
              active ? 'bg-canvas' : ''
            }`}
          >
            <Text
              className={`text-label ${
                active ? 'font-noto-bold text-ink' : 'font-noto text-muted'
              }`}
            >
              {format.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
