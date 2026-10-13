import type { ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';

/**
 * TRIP-1343 · 지도 위 `계획｜실제` 토글(US-PLANB-13 · BR-U10-41 · Figma u10e 4862:2897·4862:3628).
 * 흰 알약 2칸(선택 칸 primary) + 옆에 거리만(`실제 3.2km`). 실제 경로가 없거나 동의가 없으면 `실제` 칸 비활성 +
 * 사유 1줄. 시간·속도 문구 없음(INV-3). 상태는 소비처(페이지)가 쥔다.
 */
export interface RouteToggleProps {
  /** testID 접두 — 예 `execution-live` → `-route-toggle-plan`·`-route-toggle-actual`·`-route-disabled-reason`. */
  testIDPrefix: string;
  mode: 'plan' | 'actual';
  actualAvailable: boolean;
  /** 비활성 사유 1줄(actualAvailable=false 일 때). */
  disabledReason?: string;
  /** 실제 켜짐일 때 거리 라벨 — 예 `실제 3.2km`. */
  distanceLabel?: string;
  onChange: (mode: 'plan' | 'actual') => void;
}

const SHADOW = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.08,
  shadowRadius: 8,
  elevation: 3,
} as const;

export function RouteToggle({
  testIDPrefix,
  mode,
  actualAvailable,
  disabledReason,
  distanceLabel,
  onChange,
}: RouteToggleProps): ReactElement {
  const cell = (key: 'plan' | 'actual', label: string, disabled: boolean) => {
    const selected = mode === key;
    return (
      <Pressable
        testID={`${testIDPrefix}-route-toggle-${key}`}
        accessibilityRole="button"
        accessibilityState={{ selected, disabled }}
        disabled={disabled}
        hitSlop={8}
        onPress={() => onChange(key)}
        className={`rounded-pill px-md py-[5px] ${selected ? 'bg-primary' : ''}`}
      >
        <Text
          className={`font-noto-bold text-[13px] ${
            selected
              ? 'text-on-primary'
              : disabled
                ? 'text-muted-soft'
                : 'text-ink'
          }`}
        >
          {label}
        </Text>
      </Pressable>
    );
  };
  return (
    <View className="items-start gap-xs">
      <View className="flex-row items-center gap-sm">
        <View
          style={SHADOW}
          className="flex-row rounded-pill bg-canvas p-[3px]"
        >
          {cell('plan', '계획', false)}
          {cell('actual', '실제', !actualAvailable)}
        </View>
        {mode === 'actual' && actualAvailable && distanceLabel ? (
          <View
            style={SHADOW}
            className="rounded-pill bg-canvas px-md py-[6px]"
          >
            <Text
              testID={`${testIDPrefix}-route-distance`}
              className="font-noto-bold text-[12px] text-ink"
            >
              {distanceLabel}
            </Text>
          </View>
        ) : null}
      </View>
      {!actualAvailable && disabledReason ? (
        <View style={SHADOW} className="rounded-pill bg-canvas px-md py-[6px]">
          <Text
            testID={`${testIDPrefix}-route-disabled-reason`}
            className="font-noto text-[12px] text-muted"
          >
            {disabledReason}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/** 거리 m → `실제 3.2km`(소수 1자리). 시간·속도 없음(INV-3). */
export function actualDistanceLabel(distanceM: number): string {
  return `실제 ${(Math.round(distanceM / 100) / 10).toFixed(1)}km`;
}
