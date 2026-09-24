import type { ReactElement } from 'react';
import {
  Image,
  Pressable,
  Text,
  View,
  type ImageSourcePropType,
} from 'react-native';

import type { ItineraryDaysItemSlotsItem } from '@/shared/api/generated/schemas';

import { formatOpeningHoursLabel } from '../lib/openingHoursLabel';
import { buildSlotKey } from '../lib/slotKey';
import type { SlotProgressState } from '../lib/slotMapPin';
import {
  CheckGlyph,
  ChevronRightGlyph,
  MemoGlyph,
  PhotoGlyph,
} from './SlotGlyphs';

/**
 * TRIP-746 · i01 허브 시트의 슬롯 카드 3상태(entities · presentation-only, useState 0).
 *  - done     = 이름 › + 우측 계획 시각 "09:30" + "방문" / 사진 N장 / 후기. 사진·후기가 없으면 그 칸을
 *               통째로 안 그린다(G6 — 실앱은 조회 계약이 없어 늘 없다).
 *  - active   = 상태줄 "13:00 도착 · 지금 관람 중"(D4 고정) + [방문 완료]·[사진]·[메모].
 *               [사진]·[메모]는 `onPressSoon` 만 부른다 — "준비 중" 힌트의 열림 상태는 부모가 쥔다(BR-U4-38).
 *               `onPressSoon` 미주입이면 [사진]·[메모]·힌트를 그리지 않는다(TRIP-939 — 심사 2.1).
 *  - upcoming = "예정" 알약(트리거 영향이면 `badgeLabel` 분홍 배지, TRIP-748) + 상태줄 "15:00 도착 예정 · {영업시간}" + 누를 수 없는 아이콘 3개.
 *
 * 시각은 서버 `startAt` 을 자를 뿐(BR-U4-34). 각 leaf 는 값 하나 — 시각과 "방문" 은 형제 leaf 다.
 */

const SOON_HINT = '사진·메모는 준비 중이에요';

// 그림자 색은 토큰이 없다 — SlotStopCard·DayChipOverlay 의 `#000000` 스타일 객체 관례.
const DONE_SHADOW = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.06,
  shadowRadius: 5,
  elevation: 2,
} as const;
const ACTIVE_SHADOW = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.08,
  shadowRadius: 8,
  elevation: 3,
} as const;

export interface SlotProgressCardProps {
  slot: ItineraryDaysItemSlotsItem;
  /** slotKey `${date}#${poiId}` 조립용. */
  date: string;
  state: SlotProgressState;
  /** done 전용. 비었으면 사진 행을 통째로 안 그린다. */
  photos?: ImageSourcePropType[];
  /** done 전용. null/미전달이면 후기 박스를 안 그린다. */
  memo?: string | null;
  /** active [방문 완료]. */
  onPressComplete?: () => void;
  /** active [사진]·[메모] — 카드는 부르기만 한다(BR-U4-38). */
  onPressSoon?: () => void;
  /** "준비 중" 힌트 표시 여부 — 상태는 부모가 가진다. */
  soonHintVisible?: boolean;
  /** upcoming 전용(TRIP-748) — 주면 "예정" 대신 이 글자를 분홍 배지로(트리거 영향 카드). */
  badgeLabel?: string;
}

export function SlotProgressCard({
  slot,
  date,
  state,
  photos = [],
  memo,
  onPressComplete,
  onPressSoon,
  soonHintVisible,
  badgeLabel,
}: SlotProgressCardProps): ReactElement {
  const slotKey = buildSlotKey(date, slot.poiId);
  const fieldId = (role: string): string =>
    `execution-live-slot-${role}-${slotKey}`;
  const hhmm = slot.startAt.slice(0, 5);

  const head = (
    <View className="flex-row items-center justify-between gap-sm">
      <View className="shrink flex-row items-center gap-xs">
        <Text
          testID={fieldId('name')}
          numberOfLines={1}
          className={`shrink font-noto-bold text-card-title font-bold ${
            state === 'upcoming' ? 'text-body' : 'text-ink'
          }`}
        >
          {slot.nameKo ?? ''}
        </Text>
        <View testID={fieldId('chevron')}>
          <ChevronRightGlyph size={18} tone="ink" />
        </View>
      </View>
      {state === 'done' ? (
        <View className="flex-row items-baseline">
          <Text
            testID={fieldId('visit-time')}
            className="font-noto-bold text-label font-bold text-ink"
          >
            {hhmm}
          </Text>
          <Text
            testID={fieldId('visit-label')}
            className="ml-[3px] font-noto text-caption text-success"
          >
            방문
          </Text>
        </View>
      ) : null}
      {state === 'upcoming' ? (
        <View
          className={`rounded-button px-[10px] py-[5px] ${
            badgeLabel ? 'bg-primary-pale' : 'bg-surface-strong'
          }`}
        >
          <Text
            testID={fieldId('status')}
            className={`font-noto-bold text-micro font-bold ${
              badgeLabel ? 'text-primary' : 'text-muted'
            }`}
          >
            {badgeLabel ?? '예정'}
          </Text>
        </View>
      ) : null}
    </View>
  );

  if (state === 'done') {
    return (
      <View
        testID={`execution-live-slot-${slotKey}`}
        style={DONE_SHADOW}
        className="gap-[10px] rounded-button border border-hairline bg-canvas p-[14px]"
      >
        {head}
        {photos.length > 0 ? (
          <View testID={fieldId('photos')} className="flex-row gap-sm">
            {photos.map((source, index) => (
              <Image
                key={index}
                testID={`execution-live-slot-photo-${index}-${slotKey}`}
                source={source}
                resizeMode="cover"
                className="h-[88px] flex-1 rounded-thumb border border-hairline"
              />
            ))}
          </View>
        ) : null}
        {memo ? (
          <View className="rounded-[10px] bg-surface-soft p-[10px]">
            <Text
              testID={fieldId('memo')}
              className="font-noto text-label text-body"
            >
              {memo}
            </Text>
          </View>
        ) : null}
      </View>
    );
  }

  if (state === 'active') {
    return (
      <View
        testID={`execution-live-slot-${slotKey}`}
        style={ACTIVE_SHADOW}
        className="gap-[11px] rounded-button border-[1.5px] border-primary bg-canvas p-[14px]"
      >
        {head}
        <Text
          testID={fieldId('time')}
          className="font-noto text-caption text-muted"
        >
          {`${hhmm} 도착 · 지금 관람 중`}
        </Text>
        <View className="flex-row items-center gap-sm">
          <Pressable
            testID="execution-arrive-complete"
            accessibilityRole="button"
            onPress={onPressComplete}
            className="rounded-[10px] bg-primary px-md py-[10px]"
          >
            <Text className="font-noto-bold text-caption font-bold text-on-primary">
              방문 완료
            </Text>
          </Pressable>
          {onPressSoon ? (
            <>
              <Pressable
                testID="execution-arrive-photo"
                accessibilityRole="button"
                onPress={onPressSoon}
                className="flex-row items-center gap-[5px] rounded-[10px] border border-hairline-strong bg-canvas py-[10px] pl-md pr-[13px]"
              >
                <PhotoGlyph size={16} />
                <Text className="font-noto-bold text-caption font-bold text-ink">
                  사진
                </Text>
              </Pressable>
              <Pressable
                testID="execution-arrive-memo"
                accessibilityRole="button"
                onPress={onPressSoon}
                className="flex-row items-center gap-[5px] rounded-[10px] border border-hairline-strong bg-canvas py-[10px] pl-md pr-[13px]"
              >
                <MemoGlyph size={16} />
                <Text className="font-noto-bold text-caption font-bold text-ink">
                  메모
                </Text>
              </Pressable>
            </>
          ) : null}
        </View>
        {onPressSoon && soonHintVisible ? (
          <Text
            testID="execution-arrive-soon-hint"
            className="font-noto text-caption text-muted"
          >
            {SOON_HINT}
          </Text>
        ) : null}
      </View>
    );
  }

  const hoursLabel = formatOpeningHoursLabel(slot.openingHours);
  const disabledIcons = [
    { role: 'disabled-check', icon: <CheckGlyph size={15} /> },
    { role: 'disabled-photo', icon: <PhotoGlyph size={15} tone="disabled" /> },
    { role: 'disabled-memo', icon: <MemoGlyph size={15} tone="disabled" /> },
  ];

  return (
    <View
      testID={`execution-live-slot-${slotKey}`}
      className="gap-[10px] rounded-button border border-hairline bg-canvas p-[14px]"
    >
      {head}
      <Text
        testID={fieldId('time')}
        className="font-noto text-caption text-muted"
      >
        {hoursLabel === null
          ? `${hhmm} 도착 예정`
          : `${hhmm} 도착 예정 · ${hoursLabel}`}
      </Text>
      {/* 도착은 지오펜스 자동이라 예정 카드의 아이콘은 모양만 있고 누를 수 없다. */}
      <View className="flex-row gap-[6px]">
        {disabledIcons.map(({ role, icon }) => (
          <Pressable
            key={role}
            testID={fieldId(role)}
            disabled
            accessibilityState={{ disabled: true }}
            className="h-[32px] w-[32px] items-center justify-center rounded-[8px] border border-hairline"
          >
            {icon}
          </Pressable>
        ))}
      </View>
    </View>
  );
}
