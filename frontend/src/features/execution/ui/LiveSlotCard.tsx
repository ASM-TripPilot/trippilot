import type { ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';

import type { ItineraryDaysItemSlotsItem } from '@/shared/api/generated/schemas';

import type { NavDest } from '../model/nextNav';
import type { SlotState } from '../model/slotProgress';
import {
  CameraGlyph,
  ClockGlyph,
  MemoGlyph,
  RouteArrowGlyph,
  VisitCheckGlyph,
} from './ExecutionGlyphs';

/**
 * TRIP-395 · LiveSlotCard(i01) — 여행 중 한 슬롯의 카드. 상태로 구조가 갈린다(Figma i01):
 *  - `done`   = 컴팩트. 이름 + 시각 범위 배지만(상태 텍스트·액션 버튼 없음).
 *  - `active` = 핑크 테두리 + "진행 중" 배지 + 액션 버튼 3개.
 *  - `upcoming` = "예정" 배지 + 다음 구간 거리행 + 비활성 아이콘 버튼 3개.
 *
 * 규율:
 *  - 계획 시각은 서버 `startAt`(HH:mm:ss)을 `slice(0,5)`로 자를 뿐 — 재추정하지 않는다(BR-U4-34).
 *  - `openingHours` null → "미확인"(빈칸 아님). `distanceRange` null → 거리 줄 부재(INV-3).
 *  - [방문 완료]·[사진]·[메모]는 표시하되 동작 안 함(BR-U4-38 — 전부 비활성, U5 소관).
 *  - 각 leaf 는 값 하나만 담는다(화면 테스트가 `toHaveTextContent` 완전 일치로 읽음).
 */

const MISSING_HOURS = '미확인';

const STATE_LABEL: Record<'active' | 'upcoming', string> = {
  active: '진행 중',
  upcoming: '예정',
};

// slotKey 규약 `{date}#{poiId}` — features/itinerary/model/slotKey.ts 의 buildSlotKey 와 같은 규칙.
// features 간 import 금지라 한 줄을 미러링한다. testID·핀 번호가 이 규약을 공유한다.
const buildSlotKey = (date: string, poiId: string): string =>
  `${date}#${poiId}`;

// 비활성 어포던스 3종(BR-U4-38) — 눌러도 오류 없이 준비 중임이 드러난다. 기능화는 115-B/U5.
const AFFORDANCES: {
  role: string;
  label: string;
  Icon: (props: { size?: number; color?: string }) => ReactElement;
}[] = [
  { role: 'visit', label: '방문 완료', Icon: VisitCheckGlyph },
  { role: 'photo', label: '사진', Icon: CameraGlyph },
  { role: 'memo', label: '메모', Icon: MemoGlyph },
];

const MUTED = '#6A6A6A';
const MUTED_SOFT = '#9AA1AB';
const WHITE = '#FFFFFF';

export interface LiveSlotCardProps {
  slot: ItineraryDaysItemSlotsItem;
  /** slotKey·표시 조립용 활성 날짜. */
  date: string;
  state: SlotState;
  /** active 카드의 "다음 예정지"(첫 upcoming). 없으면 섹션 미렌더 — page 가 resolveNextDest 로 도출해 주입. */
  nextDest?: NavDest | null;
  /** "다음 장소 길찾기" CTA press 핸들러. 카드는 이 콜백만 부르고 Linking·router 를 모른다. */
  onPressNextNav?: () => void;
}

export function LiveSlotCard({
  slot,
  date,
  state,
  nextDest,
  onPressNextNav,
}: LiveSlotCardProps): ReactElement {
  const slotKey = buildSlotKey(date, slot.poiId);
  const fieldId = (role: string): string =>
    `execution-live-slot-${role}-${slotKey}`;

  const name =
    slot.nameKo === null || slot.nameKo === undefined ? null : (
      <Text
        testID={fieldId('name')}
        numberOfLines={1}
        className="font-noto-bold text-card-title font-bold text-ink"
      >
        {slot.nameKo}
      </Text>
    );

  // 완료 = 컴팩트. 이름 + 시각 범위 배지(시계). 상태 텍스트·액션 버튼이 없다.
  if (state === 'done') {
    return (
      <View
        testID={`execution-live-slot-${slotKey}`}
        className="flex-row items-center justify-between gap-sm rounded-card bg-canvas px-lg py-md"
      >
        {name}
        <View className="flex-row items-center gap-[6px] rounded-pill bg-surface-soft px-sm py-[3px]">
          <ClockGlyph size={13} color={MUTED} />
          <Text
            testID={fieldId('range')}
            className="font-noto-medium text-caption text-muted"
          >
            {`${slot.startAt.slice(0, 5)}–${slot.endAt.slice(0, 5)}`}
          </Text>
        </View>
      </View>
    );
  }

  const active = state === 'active';

  return (
    <View
      testID={`execution-live-slot-${slotKey}`}
      className={`gap-[6px] rounded-card bg-canvas p-lg ${
        active ? 'border border-primary' : ''
      }`}
    >
      <View className="flex-row items-center justify-between gap-sm">
        {name}
        <View
          className={`rounded-pill px-sm py-[2px] ${
            active ? 'bg-primary' : 'bg-surface-strong'
          }`}
        >
          <Text
            testID={fieldId('status')}
            className={`font-noto-medium text-caption ${
              active ? 'text-on-primary' : 'text-muted'
            }`}
          >
            {STATE_LABEL[active ? 'active' : 'upcoming']}
          </Text>
        </View>
      </View>

      <Text
        testID={fieldId('time')}
        className="font-noto-medium text-label text-muted"
      >
        {`${slot.startAt.slice(0, 5)} 도착 예정`}
      </Text>

      <Text
        testID={fieldId('hours')}
        className="font-noto text-label text-muted"
      >
        {slot.openingHours ?? MISSING_HOURS}
      </Text>

      {active ? (
        <View className="flex-row gap-sm pt-[2px]">
          {AFFORDANCES.map(({ role, label, Icon }) => {
            const primary = role === 'visit';
            return (
              <Pressable
                key={role}
                testID={fieldId(role)}
                disabled
                accessibilityState={{ disabled: true }}
                className={`flex-row items-center gap-[4px] rounded-button px-md py-[6px] ${
                  primary ? 'bg-primary' : 'bg-surface-soft'
                }`}
              >
                <Icon size={16} color={primary ? WHITE : MUTED} />
                <Text
                  className={`font-noto-medium text-label ${
                    primary ? 'text-on-primary' : 'text-body'
                  }`}
                >
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : (
        <View className="flex-row items-center justify-between gap-sm pt-[2px]">
          {slot.distanceRange === null || slot.distanceRange === undefined ? (
            <View />
          ) : (
            <View className="flex-row items-center gap-[6px]">
              <RouteArrowGlyph size={13} color={MUTED} />
              <Text
                testID={fieldId('distance')}
                className="font-noto text-label text-body"
              >
                {slot.distanceRange}
              </Text>
            </View>
          )}
          <View className="flex-row gap-xs">
            {AFFORDANCES.map(({ role, Icon }) => (
              <Pressable
                key={role}
                testID={fieldId(role)}
                disabled
                accessibilityState={{ disabled: true }}
                className="rounded-button bg-surface-soft p-sm"
              >
                <Icon size={15} color={MUTED_SOFT} />
              </Pressable>
            ))}
          </View>
        </View>
      )}

      {active && nextDest ? (
        <View className="flex-row items-center justify-between gap-sm pt-[2px]">
          <View className="flex-row items-center gap-[6px]">
            <RouteArrowGlyph size={13} color={MUTED} />
            <Text
              testID="execution-arrive-next-distance"
              className="font-noto text-label text-body"
            >
              {nextDest.distanceRange}
            </Text>
          </View>
          <Pressable
            testID="execution-arrive-next-nav"
            onPress={onPressNextNav}
            className="rounded-button bg-primary px-md py-[6px]"
          >
            <Text className="font-noto-medium text-label text-on-primary">
              다음 장소 길찾기
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
