import type { ReactElement } from 'react';
import {
  Image,
  Pressable,
  Text,
  View,
  type ImageSourcePropType,
} from 'react-native';

import type { ItineraryDaysItemSlotsItem } from '@/shared/api/index.schemas';

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
 *  - done     = 이름 › + 우측 실제 방문 시각 "09:30" + "방문"(TRIP-1220 — 실제 시각이 없으면 계획 시각 + "계획") / 사진 N장 / 후기. 사진·후기가 없으면 그 칸을
 *               통째로 안 그린다(G6 — 실앱은 조회 계약이 없어 늘 없다). 사진·메모 콜백을 받으면 active 와 같은
 *               [사진]·[메모]와 안내 줄(TRIP-1203 — testID 는 `execution-live-slot-done-*-{slotKey}`).
 *  - active   = 상태줄 "13:00 도착 · 지금 관람 중"(D4 고정) + [방문 완료]·[사진]·[메모] + (있으면) 메모 박스(TRIP-1117).
 *               [사진]은 `onPressPhoto`, [메모]는 `onPressMemo` 를 부른다(TRIP-1070). 받지 않은 버튼은
 *               그리지 않는다(TRIP-939 — 심사 2.1). 사진 안내 한 줄(`photoNotice`)의 상태는 부모가 쥔다.
 *  - upcoming = "예정" 알약(트리거 영향이면 `badgeLabel` 분홍 배지, TRIP-748) + 상태줄 "15:00 도착 예정 · {영업시간}"
 *               (한 줄 말줄임, TRIP-1021) + 누를 수 없는 아이콘 3개. `onPressArrive` 를 받으면 같은 줄 오른쪽에
 *               수동 [✓ 도착](TRIP-1021 — 자동 도착 TRIP-1018 보류 중 유일한 도착 경로). 누가 받을지는 허브가 정한다.
 *
 * 시각은 서버 `startAt` 을 자를 뿐(BR-U4-34). 각 leaf 는 값 하나 — 시각과 "방문" 은 형제 leaf 다.
 */

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
  /** done 전용(TRIP-1220) — 실제 방문 시각 'HH:mm'(KST, 기록 j01 과 같은 값). 없으면 계획 시각 + "계획" 으로 표시한다. */
  visitedLabel?: string | null;
  /** done·active(TRIP-1117). null/미전달이면 메모 박스를 안 그린다. */
  memo?: string | null;
  /** active [방문 완료]. */
  onPressComplete?: () => void;
  /** active·done(TRIP-1203) [사진](TRIP-1070). 미주입이면 버튼을 그리지 않는다. */
  onPressPhoto?: () => void;
  /** active·done(TRIP-1203) [메모](TRIP-1070). 미주입이면 버튼을 그리지 않는다. */
  onPressMemo?: () => void;
  /** active·done 사진 안내 한 줄(권한 거부·저장 실패 등) — 상태는 부모가 가진다. 비면 안 그린다. */
  photoNotice?: string | null;
  /** TRIP-1216 — 사진 안내 옆 [설정 열기](권한 거부). 주면 안내가 있을 때만 그린다. 설정을 여는 일은 부모 몫. */
  onPressPhotoSettings?: () => void;
  /** TRIP-1117 — active·done 메모 안내 한 줄(저장 실패, Q3). 상태는 부모가 가진다. 비면 안 그린다. */
  memoNotice?: string | null;
  /** upcoming 전용(TRIP-748) — 주면 "예정" 대신 이 글자를 분홍 배지로(트리거 영향 카드). */
  badgeLabel?: string;
  /** TRIP-987 — 이름·'›' 진입(i10). 미주입이면 이름은 누를 수 없는 글자이고 '›' 도 없다(TRIP-939). */
  onPressName?: () => void;
  /** TRIP-1021 — upcoming 수동 [도착]. 미주입이면 그리지 않는다. */
  onPressArrive?: () => void;
  /** TRIP-1189 — upcoming 다음 예정지 [길찾기](외부 지도앱 위임). 미주입이면 그리지 않는다. 누가 첫 upcoming 인지는 부모가 정한다. */
  onPressDirections?: () => void;
  /** TRIP-1189 — 길찾기가 앱·웹 모두 실패했을 때 거리 안내 한 줄(INV-4). 상태는 부모가 가진다. 비면 안 그린다. */
  directionsNotice?: string | null;
}

export function SlotProgressCard({
  slot,
  date,
  state,
  photos = [],
  memo,
  visitedLabel,
  onPressComplete,
  onPressPhoto,
  onPressMemo,
  photoNotice,
  onPressPhotoSettings,
  memoNotice,
  badgeLabel,
  onPressName,
  onPressArrive,
  onPressDirections,
  directionsNotice,
}: SlotProgressCardProps): ReactElement {
  const slotKey = buildSlotKey(date, slot.poiId);
  const fieldId = (role: string): string =>
    `execution-live-slot-${role}-${slotKey}`;
  const hhmm = slot.startAt.slice(0, 5);

  const nameText = (testID?: string): ReactElement => (
    <Text
      testID={testID}
      numberOfLines={1}
      className={`shrink font-noto-bold text-card-title font-bold ${
        state === 'upcoming' ? 'text-body' : 'text-ink'
      }`}
    >
      {slot.nameKo ?? ''}
    </Text>
  );

  const head = (
    <View className="flex-row items-center justify-between gap-sm">
      {/* 이름 진입 목적지가 없으면 누를 수 없는 글자로, '›' 도 뺀다(TRIP-939 — 자매 SlotStopCard 선례). */}
      {onPressName ? (
        <Pressable
          testID={fieldId('name')}
          accessibilityRole="button"
          onPress={onPressName}
          className="shrink flex-row items-center gap-xs"
        >
          {nameText()}
          <View testID={fieldId('chevron')}>
            <ChevronRightGlyph size={18} tone="ink" />
          </View>
        </Pressable>
      ) : (
        <View className="shrink flex-row items-center gap-xs">
          {nameText(fieldId('name'))}
        </View>
      )}
      {state === 'done' ? (
        <View className="flex-row items-baseline">
          <Text
            testID={fieldId('visit-time')}
            className="font-noto-bold text-label font-bold text-ink"
          >
            {visitedLabel ?? hhmm}
          </Text>
          <Text
            testID={fieldId('visit-label')}
            className={`ml-[3px] font-noto text-caption ${
              visitedLabel ? 'text-success' : 'text-muted'
            }`}
          >
            {visitedLabel ? '방문' : '계획'}
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

  // TRIP-1189 — [길찾기]는 예정·진행 중 카드가 같은 모양을 쓴다(방문 완료엔 안 그린다).
  const directionsButton = onPressDirections ? (
    <Pressable
      testID={fieldId('directions')}
      accessibilityRole="button"
      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
      onPress={onPressDirections}
      className="rounded-[10px] border border-hairline-strong bg-canvas px-md py-[8px]"
    >
      <Text className="font-noto-bold text-caption font-bold text-ink">
        길찾기
      </Text>
    </Pressable>
  ) : null;
  const directionsNoticeLine = directionsNotice ? (
    <Text
      testID={fieldId('directions-notice')}
      className="font-noto text-caption text-muted"
    >
      {directionsNotice}
    </Text>
  ) : null;

  // 메모 박스 — done 과 active(TRIP-1117 결정 2, Figma 4741:4804)가 같은 마크업·testID 계열을 쓴다.
  const memoBox = memo ? (
    <View className="rounded-[10px] bg-surface-soft p-[10px]">
      <Text testID={fieldId('memo')} className="font-noto text-label text-body">
        {memo}
      </Text>
    </View>
  ) : null;

  // [사진]·[메모] 버튼과 안내 줄 — active 와 done(TRIP-1203)이 같은 모양을 쓴다. testID 만 다르다:
  // active 는 고정 id, done 은 카드가 여러 장이라 slotKey 를 붙인다.
  const mediaButton = (
    testID: string,
    onPress: (() => void) | undefined,
    glyph: ReactElement,
    label: string
  ): ReactElement | null =>
    onPress ? (
      <Pressable
        testID={testID}
        accessibilityRole="button"
        onPress={onPress}
        className="flex-row items-center gap-[5px] rounded-[10px] border border-hairline-strong bg-canvas py-[10px] pl-md pr-[13px]"
      >
        {glyph}
        <Text className="font-noto-bold text-caption font-bold text-ink">
          {label}
        </Text>
      </Pressable>
    ) : null;
  const photoButton = (testID: string) =>
    mediaButton(testID, onPressPhoto, <PhotoGlyph size={16} />, '사진');
  const memoButton = (testID: string) =>
    mediaButton(testID, onPressMemo, <MemoGlyph size={16} />, '메모');
  // 순서: 사진 안내 → [설정 열기] → 메모 안내(TRIP-1117 Q9 — 그 아래가 메모 박스).
  const mediaNotices = (ids: {
    photoNotice: string;
    photoSettings: string;
    memoNotice: string;
  }): ReactElement => (
    <>
      {photoNotice ? (
        <Text
          testID={ids.photoNotice}
          className="font-noto text-caption text-muted"
        >
          {photoNotice}
        </Text>
      ) : null}
      {photoNotice && onPressPhotoSettings ? (
        <Pressable
          testID={ids.photoSettings}
          accessibilityRole="button"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          onPress={onPressPhotoSettings}
          className="self-start"
        >
          <Text className="font-noto-bold text-caption font-bold text-primary">
            설정 열기
          </Text>
        </Pressable>
      ) : null}
      {memoNotice ? (
        <Text
          testID={ids.memoNotice}
          className="font-noto text-caption text-muted"
        >
          {memoNotice}
        </Text>
      ) : null}
    </>
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
        {/* TRIP-1203 — 완료 방문에도 [사진]·[메모](G-U4-7). [방문 완료]·[길찾기]는 없다. */}
        {onPressPhoto || onPressMemo ? (
          <View className="flex-row flex-wrap items-center gap-sm">
            {photoButton(fieldId('done-photo'))}
            {memoButton(fieldId('done-memo'))}
          </View>
        ) : null}
        {mediaNotices({
          photoNotice: fieldId('done-photo-notice'),
          photoSettings: fieldId('done-photo-settings'),
          memoNotice: fieldId('done-memo-notice'),
        })}
        {memoBox}
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
        <View className="flex-row flex-wrap items-center gap-sm">
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
          {photoButton('execution-arrive-photo')}
          {memoButton('execution-arrive-memo')}
          {directionsButton}
        </View>
        {directionsNoticeLine}
        {/* TRIP-1117 Q3 — 시트가 닫힌 뒤 도착한 메모 저장 실패(INV-4). 순서: 버튼 줄 → 안내 → 메모 박스(Q9). */}
        {mediaNotices({
          photoNotice: 'execution-arrive-photo-notice',
          photoSettings: 'execution-arrive-photo-settings',
          memoNotice: 'execution-arrive-memo-notice',
        })}
        {memoBox}
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
        numberOfLines={1}
        className="font-noto text-caption text-muted"
      >
        {hoursLabel === null
          ? `${hhmm} 도착 예정`
          : `${hhmm} 도착 예정 · ${hoursLabel}`}
      </Text>
      {/* 예정 카드의 아이콘은 모양만 있고 누를 수 없다. 도착은 옆의 [도착](주입 시)으로만. */}
      <View className="flex-row items-center justify-between">
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
        {onPressArrive || onPressDirections ? (
          <View className="flex-row items-center gap-sm">
            {directionsButton}
            {onPressArrive ? (
              <Pressable
                testID={fieldId('arrive')}
                accessibilityRole="button"
                onPress={onPressArrive}
                className="flex-row items-center gap-[4px] rounded-button bg-primary px-md py-[6px]"
              >
                <CheckGlyph size={15} tone="onPrimary" />
                <Text className="font-noto-bold text-label font-bold text-on-primary">
                  도착
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>
      {directionsNoticeLine}
    </View>
  );
}
