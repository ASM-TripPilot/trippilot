import type { ReactElement } from 'react';
import { useEffect, useRef } from 'react';
import { Text, View } from 'react-native';

import { WHEEL_CELL_HEIGHT, WheelPicker } from '@/shared/ui/WheelPicker';

/**
 * 시·분 두 열 휠 한 쌍 — TRIP-1437 신설. 값은 `'HH:mm'`(24시간) 한 덩이로 받고 낸다.
 *
 * 시각 선택기 셋(방문 시각 지정·시각 조정 시트·방문 시각 수정)이 같은 모양을 쓴다. Figma 기준은 j01
 * `4707:2808` — 시 열 · `:` · 분 열, 두 열을 묶은 한 쌍 아래 회색 둥근 띠(selband).
 *
 * testID 는 열마다 소비처가 주입한다 — 소비처마다 모양이 달라(`-wheel-h-13`·`-start-option-h-13`·
 * `-arrived-h-13`) 이 조각이 이름을 지으면 어느 한쪽이 깨진다(WheelPicker 와 같은 결).
 *
 * `value` 가 없으면 선택 표시 없이 `anchor` 자리에만 세운다(값은 사용자가 고를 때만 생긴다 — BR-U1-49).
 * 한 열만 고르면 다른 열은 **화면에 서 있는 값**이다: 값 → 없으면 anchor → 없으면 첫 칸(01b Q3).
 * 그 값은 ref 로 쥔다 — 두 열이 다시 그리기 전에 연달아 멈추면 렌더 때 잡은 값은 앞 열 변경을 모른다.
 */

const pad2 = (n: number): string => String(n).padStart(2, '0');
const HOURS = Array.from({ length: 24 }, (_, i) => pad2(i));
const MINUTES = Array.from({ length: 60 }, (_, i) => pad2(i));

/** WheelPicker 가운데 칸 위치(위 패딩 2칸) — selband 를 이 칸에 맞춘다. */
const BAND_TOP = WHEEL_CELL_HEIGHT * 2;

export interface HourMinuteWheelProps {
  /** 현재 값 'HH:mm'. null 이면 선택 셀 없음. */
  value: string | null;
  /** 값이 없을 때 휠을 세울 'HH:mm' — 위치만, 선택·onChange 없음. */
  anchor?: string;
  onChange: (next: string) => void;
  hourWheelTestID: string;
  minuteWheelTestID: string;
  hourCellTestID: (hour: string) => string;
  minuteCellTestID: (minute: string) => string;
  /** 시 열 값. 기본 00~23. */
  hours?: string[];
  /** 분 열 값. 기본 00~59. */
  minutes?: string[];
}

export function HourMinuteWheel({
  value,
  anchor,
  onChange,
  hourWheelTestID,
  minuteWheelTestID,
  hourCellTestID,
  minuteCellTestID,
  hours = HOURS,
  minutes = MINUTES,
}: HourMinuteWheelProps): ReactElement {
  const hour = value === null ? null : value.slice(0, 2);
  const minute = value === null ? null : value.slice(3, 5);
  const anchorHour = anchor?.slice(0, 2);
  const anchorMinute = anchor?.slice(3, 5);
  // 화면에 서 있는 값 — 한 열을 고를 때 다른 열에 쓴다.
  const standingHour = hour ?? anchorHour ?? hours[0];
  const standingMinute = minute ?? anchorMinute ?? minutes[0];
  const standing = useRef({ hour: standingHour, minute: standingMinute });
  useEffect(() => {
    standing.current = { hour: standingHour, minute: standingMinute };
  }, [standingHour, standingMinute]);
  const pick = (part: 'hour' | 'minute', next: string): void => {
    standing.current = { ...standing.current, [part]: next };
    onChange(`${standing.current.hour}:${standing.current.minute}`);
  };

  return (
    // 열 72 · `:` 23 · 열 72 = 167(j01). 좁은 칸(방문 시각 수정의 반폭)에선 열이 줄어든다.
    <View className="relative w-full max-w-[167px] flex-row items-center self-center">
      <View
        pointerEvents="none"
        className="absolute left-0 right-0 rounded-[10px] bg-surface-strong"
        style={{ top: BAND_TOP, height: WHEEL_CELL_HEIGHT }}
      />
      <View className="flex-1">
        <WheelPicker
          testID={hourWheelTestID}
          values={hours}
          selected={hour}
          anchor={anchorHour}
          onSelect={(next) => pick('hour', next)}
          testIDForValue={hourCellTestID}
        />
      </View>
      <Text className="w-[23px] text-center font-noto-bold text-hero font-bold text-ink">
        :
      </Text>
      <View className="flex-1">
        <WheelPicker
          testID={minuteWheelTestID}
          values={minutes}
          selected={minute}
          anchor={anchorMinute}
          onSelect={(next) => pick('minute', next)}
          testIDForValue={minuteCellTestID}
        />
      </View>
    </View>
  );
}
