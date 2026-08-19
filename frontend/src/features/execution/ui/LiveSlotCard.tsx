import type { ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';

import type { ItineraryDaysItemSlotsItem } from '@/shared/api/generated/schemas';

import type { SlotState } from '../model/slotProgress';

/**
 * TRIP-395 · LiveSlotCard(i01) — 여행 중 한 슬롯의 카드.
 *
 * 표면 = 상태 배지 · 계획 시각("15:00 도착 예정") · 장소명 · 영업시간 · 다음 구간 거리.
 * 각 leaf 는 값 하나만 담는다(PoiSlotCard 규율 — 화면 테스트가 `toHaveTextContent` 완전 일치로 읽음).
 *
 * 규율:
 *  - 계획 시각은 서버 `startAt`(HH:mm:ss)을 `slice(0,5)`로 **자를 뿐** — 재추정하지 않는다(BR-U4-34).
 *    "도착 예정"은 계획값임을 드러내는 라벨이다(지연 반영 실제 도착이 아니다).
 *  - `openingHours` null → "미확인"(빈칸 아님). `distanceRange` null → 거리 줄 **부재**(INV-3 파생 금지).
 *  - [방문 완료]·[사진]·[메모]는 **비활성 자리만**이다(BR-U4-38 — 표시하되 동작 안 함, U5 소관).
 */

const MISSING_HOURS = '미확인';

const STATE_LABEL: Record<SlotState, string> = {
  done: '완료',
  active: '진행 중',
  upcoming: '예정',
};

// 상태 배지 색 — 완료=성공, 진행 중=주(primary), 예정=회색. raw hex 금지(토큰 경유).
const STATE_TONE: Record<SlotState, string> = {
  done: 'bg-success-bg',
  active: 'bg-primary-pale',
  upcoming: 'bg-surface-strong',
};

// slotKey 규약 `{date}#{poiId}` — features/itinerary/model/slotKey.ts 의 buildSlotKey 와 같은 규칙.
// features 간 import 금지라 한 줄을 미러링한다(ponytail: 세 번째 소비자가 parse/충돌 로직까지
// 필요해지면 shared 로 승격). testID·핀 번호가 이 규약을 공유해야 하는 건 그 파일과 동일하다.
const buildSlotKey = (date: string, poiId: string): string =>
  `${date}#${poiId}`;

// 비활성 어포던스 3종(BR-U4-38) — 눌러도 오류 없이 준비 중임이 드러난다. 기능화는 115-B/U5.
const AFFORDANCES: { role: string; label: string }[] = [
  { role: 'visit', label: '방문 완료' },
  { role: 'photo', label: '사진' },
  { role: 'memo', label: '메모' },
];

export interface LiveSlotCardProps {
  slot: ItineraryDaysItemSlotsItem;
  /** slotKey·표시 조립용 활성 날짜. */
  date: string;
  state: SlotState;
}

export function LiveSlotCard({
  slot,
  date,
  state,
}: LiveSlotCardProps): ReactElement {
  const slotKey = buildSlotKey(date, slot.poiId);
  const fieldId = (role: string): string =>
    `execution-live-slot-${role}-${slotKey}`;

  return (
    <View
      testID={`execution-live-slot-${slotKey}`}
      className="gap-[6px] rounded-card bg-canvas p-lg"
    >
      <View className="flex-row items-center gap-sm">
        <View className={`rounded-pill px-sm py-[2px] ${STATE_TONE[state]}`}>
          <Text
            testID={fieldId('status')}
            className="font-noto-medium text-caption text-body"
          >
            {STATE_LABEL[state]}
          </Text>
        </View>
        <Text
          testID={fieldId('time')}
          className="font-noto-medium text-label text-muted"
        >
          {`${slot.startAt.slice(0, 5)} 도착 예정`}
        </Text>
      </View>

      {slot.nameKo === null || slot.nameKo === undefined ? null : (
        <Text
          testID={fieldId('name')}
          numberOfLines={1}
          className="font-noto-bold text-card-title font-bold text-ink"
        >
          {slot.nameKo}
        </Text>
      )}

      <Text
        testID={fieldId('hours')}
        className="font-noto text-label text-muted"
      >
        {slot.openingHours ?? MISSING_HOURS}
      </Text>

      {slot.distanceRange === null ||
      slot.distanceRange === undefined ? null : (
        <Text
          testID={fieldId('distance')}
          className="font-noto text-label text-body"
        >
          {slot.distanceRange}
        </Text>
      )}

      <View className="flex-row gap-sm pt-[2px]">
        {AFFORDANCES.map(({ role, label }) => (
          <Pressable
            key={role}
            testID={fieldId(role)}
            disabled
            accessibilityState={{ disabled: true }}
            className="rounded-button bg-surface-soft px-md py-[6px]"
          >
            <Text className="font-noto-medium text-label text-muted-soft">
              {label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
