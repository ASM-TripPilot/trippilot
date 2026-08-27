import { useState, type ReactElement } from 'react';
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
 *  - `active` = 핑크 테두리 + "진행 중" 배지 + 상태줄 "HH:mm 도착 · 방문 중"
 *               + [방문 완료](활성) · [사진]/[메모](press → "준비 중" 힌트).
 *  - `upcoming` = "예정" 배지 + 상태줄 "HH:mm 도착 예정" + 수동 [도착](지오펜스 미발화 → 유일 도착 경로).
 *
 * TRIP-396: [방문 완료]를 기능화(비활성 해제 + `onPressComplete`)하고, upcoming 에 수동 [도착]을
 * 추가했다(01b Q2·Q5). [사진]·[메모]는 표시하되 눌러도 오류 없이 "준비 중"만 드러낸다(BR-U4-38,
 * U5 소관) — 그 힌트는 **카드 로컬 state**(prop 아님, 순수 뷰의 UI-로컬 상태). 서버 호출·라우팅은
 * 페이지가 배선하고 카드는 콜백만 부른다.
 *
 * 규율:
 *  - 계획 시각은 서버 `startAt`(HH:mm:ss)을 `slice(0,5)`로 자를 뿐 — 재추정하지 않는다(BR-U4-34).
 *  - 상태줄은 계획값 + 정성 리터럴("방문 중")뿐 — 소요시간 숫자를 안 낸다(INV-3·executionDuration 가드).
 *  - `openingHours` null → "미확인". `distanceRange` null → 거리 줄 부재(INV-3).
 *  - 각 leaf 는 값 하나만 담는다(화면 테스트가 `toHaveTextContent` 완전 일치로 읽음).
 */

const MISSING_HOURS = '미확인';
const SOON_HINT = '사진·메모는 준비 중이에요';

const STATE_LABEL: Record<'active' | 'upcoming', string> = {
  active: '진행 중',
  upcoming: '예정',
};

// slotKey 규약 `{date}#{poiId}` — features/itinerary/model/slotKey.ts 의 buildSlotKey 와 같은 규칙.
// features 간 import 금지라 한 줄을 미러링한다. testID·핀 번호가 이 규약을 공유한다.
const buildSlotKey = (date: string, poiId: string): string =>
  `${date}#${poiId}`;

const MUTED = '#6A6A6A';
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
  /** active [방문 완료] press — page 가 useVisitCheck.complete(visitCheckId) 로 배선(AC-3). */
  onPressComplete?: () => void;
  /** upcoming 수동 [도착] press — page 가 useVisitCheck.arrive({source:MANUAL}) 로 배선(AC-4). */
  onPressManualArrive?: () => void;
}

export function LiveSlotCard({
  slot,
  date,
  state,
  nextDest,
  onPressNextNav,
  onPressComplete,
  onPressManualArrive,
}: LiveSlotCardProps): ReactElement {
  // 사진·메모 "준비 중" 인라인 힌트 — press 하면 드러난다(BR-U4-38). 순수 뷰의 UI-로컬 상태.
  const [soonHintVisible, setSoonHintVisible] = useState(false);

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
  const timeText = active
    ? `${slot.startAt.slice(0, 5)} 도착 · 방문 중`
    : `${slot.startAt.slice(0, 5)} 도착 예정`;

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
        {timeText}
      </Text>

      <Text
        testID={fieldId('hours')}
        className="font-noto text-label text-muted"
      >
        {slot.openingHours ?? MISSING_HOURS}
      </Text>

      {active ? (
        <>
          <View className="flex-row items-center gap-sm pt-[2px]">
            {/* [방문 완료] — 활성. Figma 는 flex-1(넓게). page 가 완료 낙관을 배선. */}
            <Pressable
              testID="execution-arrive-complete"
              onPress={onPressComplete}
              className="flex-1 flex-row items-center justify-center gap-[4px] rounded-button bg-primary px-md py-[8px]"
            >
              <VisitCheckGlyph size={16} color={WHITE} />
              <Text className="font-noto-medium text-label text-on-primary">
                방문 완료
              </Text>
            </Pressable>
            {/* [사진]·[메모] — 활성처럼 보이되 press 는 "준비 중"만 드러낸다(BR-U4-38). */}
            <Pressable
              testID="execution-arrive-photo"
              onPress={() => setSoonHintVisible(true)}
              className="flex-row items-center gap-[4px] rounded-button bg-surface-soft px-md py-[8px]"
            >
              <CameraGlyph size={16} color={MUTED} />
              <Text className="font-noto-medium text-label text-body">
                사진
              </Text>
            </Pressable>
            <Pressable
              testID="execution-arrive-memo"
              onPress={() => setSoonHintVisible(true)}
              className="flex-row items-center gap-[4px] rounded-button bg-surface-soft px-md py-[8px]"
            >
              <MemoGlyph size={16} color={MUTED} />
              <Text className="font-noto-medium text-label text-body">
                메모
              </Text>
            </Pressable>
          </View>
          {soonHintVisible ? (
            <Text
              testID="execution-arrive-soon-hint"
              className="font-noto text-caption text-muted"
            >
              {SOON_HINT}
            </Text>
          ) : null}
        </>
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
          {/* 수동 [도착] — 지오펜스 미발화라 유일한 도착 경로(01b Q5). page 가 arrive(MANUAL) 배선. */}
          <Pressable
            testID={`execution-arrive-manual-${slotKey}`}
            onPress={onPressManualArrive}
            className="flex-row items-center gap-[4px] rounded-button bg-primary px-md py-[6px]"
          >
            <VisitCheckGlyph size={15} color={WHITE} />
            <Text className="font-noto-medium text-label text-on-primary">
              도착
            </Text>
          </Pressable>
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
