import type { ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';

import type { CompareTab } from '../model/compareRows';

/**
 * TRIP-570 · j02 3탭 세그먼트(계획·실제·변경) — 무상태 프레젠테이션.
 *
 * 세그는 리스트 필터가 아니라 지도 레이어 강조 토글이다(01b·Figma — 리스트는 활성 탭과 무관하게
 * 전체 행 표시). 활성 탭은 색이 아니라 `accessibilityState.selected` 로 노출한다(글리프 fill 함정
 * 회피, `FormatSegment`·`ConflictSheet` 선례). press → onSelect(tab) 1회.
 *
 * 토큰(Figma raw → 우리 토큰): #ededed→hairline(컨테이너)·#222→ink(활성 텍스트)·#6a6a6a→muted
 * (비활성)·radius 12→button(바깥)·radius 10→rounded-[10px](활성 셀). 활성 셀 bg 는 흰색(canvas).
 */

const TABS: { id: CompareTab; label: string }[] = [
  { id: 'planned', label: '계획' },
  { id: 'actual', label: '실제' },
  { id: 'change', label: '변경' },
];

export interface CompareSegmentProps {
  activeTab: CompareTab;
  onSelect: (tab: CompareTab) => void;
}

export function CompareSegment({
  activeTab,
  onSelect,
}: CompareSegmentProps): ReactElement {
  return (
    <View
      testID="record-compare-segment"
      className="w-full flex-row rounded-button bg-hairline p-[3px]"
    >
      {TABS.map((tab) => {
        const active = tab.id === activeTab;
        return (
          <Pressable
            key={tab.id}
            testID={`record-compare-tab-${tab.id}`}
            accessibilityState={{ selected: active }}
            onPress={() => onSelect(tab.id)}
            className={`flex-1 items-center justify-center rounded-[10px] py-sm ${
              active ? 'bg-canvas' : ''
            }`}
          >
            <Text
              className={`text-body ${
                active ? 'font-noto-bold text-ink' : 'font-noto text-muted'
              }`}
            >
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
