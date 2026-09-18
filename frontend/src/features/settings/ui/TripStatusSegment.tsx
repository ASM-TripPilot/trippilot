import type { ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';

import type { TripBucket } from '../model/tripBuckets';

/**
 * TRIP-604 · l03 여행 상태 세그먼트 — 예정/진행 중/종료 3탭(controlled). 활성 탭은 흰 알약 +
 * 그림자 + bold, 비활성은 회색 글자(Figma l03). 어느 탭이 켜졌는지의 권위는 페이지에 있고(`active`),
 * 이 컴포넌트는 표시와 탭 이벤트만 진다.
 *
 * 활성 시각(흰 배경·그림자·bold)은 className 이라 jest 사각 — [검증] 6-b 육안(AC-P2).
 */

const TABS: { bucket: TripBucket; label: string }[] = [
  { bucket: 'upcoming', label: '예정' },
  { bucket: 'active', label: '진행 중' },
  { bucket: 'ended', label: '종료' },
];

export interface TripStatusSegmentProps {
  active: TripBucket;
  onChange: (bucket: TripBucket) => void;
}

export function TripStatusSegment({
  active,
  onChange,
}: TripStatusSegmentProps): ReactElement {
  return (
    <View
      testID="my-trip-segment"
      className="w-full flex-row rounded-input bg-surface-strong p-[3px]"
    >
      {TABS.map(({ bucket, label }) => {
        const selected = bucket === active;
        return (
          <Pressable
            key={bucket}
            testID={`my-trip-segment-${bucket}`}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onChange(bucket)}
            className={`flex-1 items-center justify-center rounded-[9px] py-[9px] ${
              selected ? 'bg-canvas shadow-sm' : ''
            }`}
          >
            <Text
              className={`text-label ${
                selected
                  ? 'font-noto-bold font-bold text-ink'
                  : 'font-noto text-muted'
              }`}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
