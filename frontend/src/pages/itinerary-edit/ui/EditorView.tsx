import type { ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';

import type { ItineraryDaysItemSlotsItem } from '@/shared/api/generated/schemas';
import type { MapCenter, MapPin } from '@/shared/map';
import { MapSheetShell } from '@/widgets/map-sheet-shell/ui/MapSheetShell';
import { SheetHeader } from '@/widgets/map-sheet-shell/ui/SheetHeader';
import type { CtaButton } from '@/widgets/map-sheet-shell/ui/CtaBar';
import { formatCoPickDayHeader } from '@/features/itinerary/model/draftView';
import type { EditorSlot } from '@/features/itinerary/model/itineraryEditStore';
import type { PlanDayTab } from '@/features/itinerary/model/planState';
import {
  BackChevronGlyph,
  InfoCircleGlyph,
  PlusGlyph,
} from '@/features/itinerary/ui/ItineraryGlyphs';
import { SlotDropZone } from '@/features/itinerary/ui/SlotDropZone';
import { buildSlotKey } from '@/entities/itinerary-slot/lib/slotKey';
import { SlotStopCard } from '@/entities/itinerary-slot/ui/SlotStopCard';

/**
 * TRIP-797 · h12 통일 편집기 **순수 뷰**(OQ-3). features 화면은 widgets(MapSheetShell)를 상향 참조
 * 못 하므로, 편집기는 pages 층 순수 뷰가 셸을 **조립**한다(h07/h08 DraftPage·h14/h16 ItineraryPlanPage
 * 선례). 이 뷰는 컨테이너 api 사슬이 없어 preview.tsx 가 그대로 import 한다(api import 0, TRIP-610 회피)
 * — 조회·저장 PUT·시트 개폐·미지정 안내는 페이지(ItineraryEditPage) 몫이고, 이 뷰는 골격·배선만 진다.
 *
 * ⚠️ 원리적 사각(6-b 실기 이연): 2스냅 실개폐·딤·롱프레스 드래그 실동작·드롭 삭제·색(빨강 테두리)은
 * `@gorhom/bottom-sheet`·`react-native-draggable-flatlist` 통과형 목이 못 본다. 여기선 시각칩 press
 * 콜백·카드사이 + 배선·`isDragging` 드롭존 표면 전환만 계약한다(02a ★7).
 */

export interface EditorViewProps {
  center: MapCenter;
  pins?: MapPin[];
  /** 일차 칩(다일자면 length > 1일 때만 칩을 그린다). */
  days: PlanDayTab[];
  /** 활성 일자 슬롯(미지정 startAt null 허용). */
  slots: EditorSlot[];
  activeDayIndex: number;
  /** slotKey 조립 + 헤더 날짜 출처. */
  activeDate: string;
  onSelectDay: (index: number) => void;
  onBack: () => void;
  /** 카드 ⌄ → TimeSheet 열기(페이지가 시트 소유). */
  onPressTimeChip: (slotKey: string) => void;
  /** 점선 "+ 장소 추가"(index 미지정 = 말미). */
  onPressAddPlace: () => void;
  /** 카드 사이 "+"(선행 슬롯 index → h13). */
  onPressAddBetween: (precedingIndex: number) => void;
  onSave: () => void;
  /** 드래그 재정렬(onDragEnd 포워딩) — 실동작은 6-b 실기, 배선만. */
  onReorder?: (data: EditorSlot[]) => void;
  /** 드롭존 삭제(6-b 실기 이연, 배선만). */
  onDeleteViaDrag?: (poiId: string) => void;
  /** dragging 정적 얼굴(드롭존이 CTA 자리 대체, AC-9). */
  isDragging?: boolean;
  /** 방문 완료 잠금(AC-11). */
  completedSlotKeys?: string[];
  /** TRIP-753 · i07(여행 중 편집) 진입 — 카드 사이 "+" 를 숨기고 안내 문구를 i07 문구로 바꾼다.
   *  그 밖(완료 잠금·위반 배지)은 모드가 아니라 데이터가 정한다. */
  inTrip?: boolean;
}

const GUIDE_H12 = '길게 눌러 순서를 바꾸거나, 아래로 끌어 삭제해요';
const GUIDE_IN_TRIP =
  '방문한 곳은 그대로 두고, 길게 눌러 순서를 바꾸거나 아래로 끌어 삭제해요';
// 위반 사유(AI detail)가 없을 때의 배지 문구 — 사유를 지어내지 않는다(Q4, 발명 카피·Figma 근거 없음).
const VIOLATION_FALLBACK = '일정 충돌';

export function EditorView({
  center,
  pins,
  days,
  slots,
  activeDayIndex,
  activeDate,
  onSelectDay,
  onBack,
  onPressTimeChip,
  onPressAddPlace,
  onPressAddBetween,
  onSave,
  isDragging,
  completedSlotKeys,
  inTrip,
}: EditorViewProps): ReactElement {
  // 좌상단 오버레이 — back + 일차 칩(다일자만). MapSheetShell 의 기본 DayChipOverlay 대신 편집기 고유
  // testID(`itinerary-edit-day-{dayIndex}`)를 쓰려고 overlay 슬롯을 직접 채운다(AC-4).
  const overlay = (
    <View className="flex-row items-center gap-sm">
      <Pressable
        testID="itinerary-edit-back"
        onPress={onBack}
        className="h-[36px] w-[36px] items-center justify-center rounded-pill bg-canvas"
      >
        <BackChevronGlyph size={20} />
      </Pressable>
      {days.length > 1
        ? days.map((tab, index) => {
            const selected = index === activeDayIndex;
            return (
              <Pressable
                key={tab.date}
                testID={`itinerary-edit-day-${tab.dayIndex}`}
                onPress={() => onSelectDay(index)}
                accessibilityState={{ selected }}
                className={`rounded-pill px-md py-[6px] ${selected ? 'bg-primary' : 'border border-hairline-strong bg-canvas'}`}
              >
                <Text
                  className={`font-noto-bold text-caption font-bold ${selected ? 'text-on-primary' : 'text-ink'}`}
                >
                  {`${tab.dayIndex}일차`}
                </Text>
              </Pressable>
            );
          })
        : null}
    </View>
  );

  const header = (
    <SheetHeader
      title="일정 편집"
      dayLabel={`${activeDayIndex + 1}일차`}
      dateLabel={formatCoPickDayHeader(activeDate)}
      meta={`${slots.length}곳`}
    />
  );

  // 드래그 중엔 CTA 자리를 드롭존이 대체하므로 CTA 를 비운다(빈 배열이면 MapSheetShell 이 CTA 바 미렌더).
  const cta: CtaButton[] = isDragging
    ? []
    : [
        {
          label: '일정 저장하기',
          variant: 'primary',
          onPress: onSave,
          disabled: slots.length === 0,
        },
      ];

  return (
    <View className="flex-1">
      <MapSheetShell
        center={center}
        pins={pins}
        overlay={overlay}
        header={header}
        cta={cta}
        initialIndex={1}
      >
        <View className="gap-md px-lg pb-2xl pt-xs">
          {/* 슬롯 카드 + 카드 사이 "+"(선행 index 인코딩, AC-7 배선). */}
          {slots.flatMap((slot, index) => {
            const slotKey = buildSlotKey(activeDate, slot.poiId);
            const locked = completedSlotKeys?.includes(slotKey) === true;
            const fixed = slot.isFixed === true;
            // 고정·완료 슬롯은 시각 편집 어포던스를 안 붙인다(INV-U3-03 · AC-11).
            const canEditTime = !fixed && !locked;
            const timeLabel =
              slot.startAt === null
                ? null
                : `${slot.startAt.slice(0, 5)}–${slot.endAt.slice(0, 5)}`;
            const items: ReactElement[] = [
              <SlotStopCard
                key={`card-${slot.poiId}`}
                slot={slot as ItineraryDaysItemSlotsItem}
                date={activeDate}
                index={index}
                timeLabel={timeLabel}
                unspecified={slot.startAt === null}
                locked={locked}
                fixed={fixed}
                numberOutside
                violation={
                  slot.hasViolation
                    ? (slot.violationReason ?? VIOLATION_FALLBACK)
                    : null
                }
                onPressTimeChip={
                  canEditTime ? () => onPressTimeChip(slotKey) : undefined
                }
              />,
            ];
            if (!inTrip && index < slots.length - 1) {
              items.push(
                <Pressable
                  key={`insert-${index}`}
                  testID={`itinerary-edit-insert-${index}`}
                  onPress={() => onPressAddBetween(index)}
                  className="flex-row items-center justify-center py-[2px]"
                >
                  <PlusGlyph size={20} tone="primary" />
                </Pressable>
              );
            }
            return items;
          })}

          {/* 점선 "+ 장소 추가"(index 미지정 = 말미, AC-8). */}
          <Pressable
            testID="itinerary-edit-add-place"
            onPress={onPressAddPlace}
            className="flex-row items-center justify-center gap-xs rounded-card border border-dashed border-hairline-strong bg-canvas py-md"
          >
            <PlusGlyph size={24} />
            <Text className="font-noto-bold text-body font-bold text-muted">
              장소 추가
            </Text>
          </Pressable>

          {/* 안내줄(AC-12) — Figma 는 "장소 추가" 아래(h12·i07 공통), 문구만 모드별. */}
          <View
            testID="itinerary-edit-guide"
            className="flex-row items-center gap-[6px]"
          >
            <InfoCircleGlyph size={16} />
            <Text className="font-noto text-caption text-muted">
              {inTrip ? GUIDE_IN_TRIP : GUIDE_H12}
            </Text>
          </View>
        </View>
      </MapSheetShell>

      {/* dragging 정적 얼굴 — CTA 자리를 드롭존이 대체(형제 절대배치, AC-9). 실제 드롭 삭제는 6-b 실기. */}
      {isDragging ? (
        <View className="absolute bottom-0 left-0 right-0 px-lg pb-lg">
          <SlotDropZone isActive />
        </View>
      ) : null}
    </View>
  );
}
