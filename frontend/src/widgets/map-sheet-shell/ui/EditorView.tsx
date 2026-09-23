import type { ReactElement } from 'react';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import DraggableFlatList, {
  type DragEndParams,
  type RenderItemParams,
} from 'react-native-draggable-flatlist';

import type { ItineraryDaysItemSlotsItem } from '@/shared/api/generated/schemas';
import type { MapCenter, MapPin } from '@/shared/map';
import { buildSlotKey } from '@/entities/itinerary-slot/lib/slotKey';
import { SlotStopCard } from '@/entities/itinerary-slot/ui/SlotStopCard';

import type { CtaButton } from './CtaBar';
import { InfoCircleGlyph, PlusGlyph } from './EditorGlyphs';
import { BackChevronGlyph } from './MapSheetGlyphs';
import { MapSheetShell } from './MapSheetShell';
import { SheetHeader } from './SheetHeader';
import { SlotDropZone } from './SlotDropZone';

/**
 * TRIP-797 · h12 통일 편집기 뷰 — TRIP-921 로 pages 에서 widgets 로 승격돼 h12 편집(`ItineraryEditPage`)·
 * i07(같은 페이지 inTrip)·h12 직접 짜기(`ManualPlanPage`)가 **같은 뷰**를 소비한다. 조회·저장 PUT·시트
 * 개폐·미지정 안내는 페이지 몫이고, 이 뷰는 셸 조립·드래그 판정만 진다. 위젯은 features 를 못 물어 헤더
 * 날짜는 페이지가 포맷한 `dateLabel` 문자열로 받는다.
 *
 * 드래그(TRIP-921, 3-a 결정): 리스트 data = 활성 일자 슬롯 n개 + **맨 끝 센티널**(드롭존 칸, 끌 수 없음).
 * 놓은 카드가 새 data 에서 센티널 **뒤**면 삭제(`onDeleteViaDrag`), 아니면 재정렬(`onReorder`, 센티널 제외).
 * 고정·방문 완료 카드는 롱프레스가 끌기로 안 이어지고, 판정 단계에서도 한 번 더 거른다(심층 방어 —
 * 스토어 삭제는 고정 여부를 안 본다).
 *
 * ⚠️ 원리적 사각(6-b 실기): 실제 롱프레스·손가락 이동·놓을 자리 계산·시트 콘텐츠 제스처 경합·색.
 */

/** 편집 중 슬롯 — 서버 슬롯에서 startAt 만 미지정(null) 허용(편집 스토어 EditorSlot 과 같은 모양). */
export type EditorViewSlot = Omit<ItineraryDaysItemSlotsItem, 'startAt'> & {
  startAt: string | null;
};

export interface EditorViewProps {
  center: MapCenter;
  pins?: MapPin[];
  /** 일차 칩(다일자면 length > 1일 때만 칩을 그린다). */
  days: { dayIndex: number; date: string }[];
  /** 활성 일자 슬롯(미지정 startAt null 허용). */
  slots: EditorViewSlot[];
  activeDayIndex: number;
  /** slotKey 조립용 활성 날짜. */
  activeDate: string;
  /** 헤더 날짜 문구(페이지가 포맷, 예: `6월 10일(수)`). */
  dateLabel: string;
  onSelectDay: (index: number) => void;
  onBack: () => void;
  /** 카드 ⌄ → TimeSheet 열기(페이지가 시트 소유). */
  onPressTimeChip: (slotKey: string) => void;
  /** 점선 "+ 장소 추가"(index 미지정 = 말미). */
  onPressAddPlace: () => void;
  /** 카드 사이 "+"(선행 슬롯 index → h13). */
  onPressAddBetween: (precedingIndex: number) => void;
  onSave: () => void;
  /** 끌어 바꾼 새 순서(센티널 제외). 고정·완료 재고정은 페이지 사슬 몫. */
  onReorder?: (slots: EditorViewSlot[]) => void;
  /** 드롭존(센티널 뒤)에 놓인 카드. 고정·완료 카드는 부르지 않는다. */
  onDeleteViaDrag?: (poiId: string) => void;
  /** 드래그 중 얼굴 강제(프리뷰 `h12-editor-dragging`). 실제 끌기는 내부 상태가 켠다. */
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

// 리스트 끝 센티널(드롭존 칸). poiId 가 아니라 이 문자열이라 슬롯과 키가 겹치지 않는다.
const DROP_SENTINEL = 'itinerary-edit-drop-sentinel';
type ListItem = EditorViewSlot | typeof DROP_SENTINEL;

export function EditorView({
  center,
  pins,
  days,
  slots,
  activeDayIndex,
  activeDate,
  dateLabel,
  onSelectDay,
  onBack,
  onPressTimeChip,
  onPressAddPlace,
  onPressAddBetween,
  onSave,
  onReorder,
  onDeleteViaDrag,
  isDragging,
  completedSlotKeys,
  inTrip,
}: EditorViewProps): ReactElement {
  // 끌기 진행 중(onDragBegin ~ onDragEnd) — 뷰 국소 일시 상태(widgetsStructure STATE_EXEMPT 1).
  const [dragging, setDragging] = useState(false);
  const dragFace = isDragging === true || dragging;

  // 고정·방문 완료 슬롯 — 끌기·드롭 삭제·시각 편집 전부 막는다(INV-U3-03 · TRIP-753 AC-11).
  const isLocked = (slot: EditorViewSlot): boolean =>
    completedSlotKeys?.includes(buildSlotKey(activeDate, slot.poiId)) === true;
  const isPinned = (slot: EditorViewSlot): boolean =>
    slot.isFixed === true || isLocked(slot);

  function handleDragEnd({ data, to }: DragEndParams<ListItem>): void {
    setDragging(false);
    const moved = data[to];
    // 센티널 자체는 못 끈다. 고정·완료 카드는 제스처가 막혀도 판정에서 한 번 더 거른다(심층 방어).
    if (moved === DROP_SENTINEL || isPinned(moved)) return;
    if (to > data.indexOf(DROP_SENTINEL)) {
      onDeleteViaDrag?.(moved.poiId);
      return;
    }
    onReorder?.(
      data.filter((item): item is EditorViewSlot => item !== DROP_SENTINEL)
    );
  }

  function renderItem({
    item,
    getIndex,
    drag,
    isActive,
  }: RenderItemParams<ListItem>): ReactElement | null {
    if (item === DROP_SENTINEL) {
      // 드롭존은 끌기 중에만 그린다(평소엔 빈 칸 — Figma 채움 얼굴에 드롭존이 없다).
      return dragFace ? (
        <View className="pb-md">
          <SlotDropZone isActive />
        </View>
      ) : null;
    }
    const index = getIndex() ?? 0;
    const slotKey = buildSlotKey(activeDate, item.poiId);
    const locked = isLocked(item);
    const fixed = item.isFixed === true;
    // 고정·완료 슬롯은 시각 편집 어포던스를 안 붙인다(INV-U3-03 · AC-11).
    const canEditTime = !fixed && !locked;
    const timeLabel =
      item.startAt === null
        ? null
        : `${item.startAt.slice(0, 5)}–${item.endAt.slice(0, 5)}`;
    return (
      <View className="gap-md pb-md">
        {/* 롱프레스 → 끌기 — 고정·완료 카드엔 핸들러를 안 건다(AC-3 ①). */}
        <Pressable onLongPress={isPinned(item) ? undefined : drag}>
          <SlotStopCard
            slot={item as ItineraryDaysItemSlotsItem}
            date={activeDate}
            index={index}
            timeLabel={timeLabel}
            unspecified={item.startAt === null}
            locked={locked}
            fixed={fixed}
            numberOutside
            dragging={isActive}
            violation={
              item.hasViolation
                ? (item.violationReason ?? VIOLATION_FALLBACK)
                : null
            }
            onPressTimeChip={
              canEditTime ? () => onPressTimeChip(slotKey) : undefined
            }
          />
        </Pressable>
        {/* 카드 사이 "+"(선행 index, AC-7) — i07 엔 없다. 끌기 중엔 안 보이고 안 눌리지만 **자리는 지킨다**:
            라이브러리가 끌기 시작 순간 끄는 카드 위치를 스냅샷으로 적어 두므로, 여기서 줄이 사라지면
            놓일 칸 계산이 드롭존 쪽으로 밀린다(03b 경고-1). display none·언마운트 금지. */}
        {!inTrip && index < slots.length - 1 ? (
          <Pressable
            testID={`itinerary-edit-insert-${index}`}
            onPress={() => onPressAddBetween(index)}
            pointerEvents={dragFace ? 'none' : 'auto'}
            accessibilityElementsHidden={dragFace}
            importantForAccessibility={
              dragFace ? 'no-hide-descendants' : 'auto'
            }
            style={dragFace ? { opacity: 0 } : undefined}
            className="flex-row items-center justify-center py-[2px]"
          >
            <PlusGlyph size={20} tone="primary" />
          </Pressable>
        ) : null}
      </View>
    );
  }

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
      dateLabel={dateLabel}
      meta={`${slots.length}곳`}
    />
  );

  // 끌기 중엔 드롭존이 삭제 자리라 CTA 를 비운다(빈 배열이면 MapSheetShell 이 CTA 바 미렌더).
  const cta: CtaButton[] = dragFace
    ? []
    : [
        {
          label: '일정 저장하기',
          variant: 'primary',
          onPress: onSave,
          disabled: slots.length === 0,
        },
      ];

  const data: ListItem[] = [...slots, DROP_SENTINEL];

  return (
    <MapSheetShell
      center={center}
      pins={pins}
      overlay={overlay}
      header={header}
      cta={cta}
      initialIndex={2}
    >
      <View className="px-lg pb-2xl pt-xs">
        {/* 셸 body 스크롤 안에 중첩 — 리스트 자체 스크롤은 끈다(셸 무수정, 01b Q4). */}
        <DraggableFlatList
          testID="itinerary-edit-list"
          data={data}
          keyExtractor={(item) =>
            item === DROP_SENTINEL ? DROP_SENTINEL : `card-${item.poiId}`
          }
          renderItem={renderItem}
          onDragBegin={() => setDragging(true)}
          onDragEnd={handleDragEnd}
          // 원래 자리 점선 칸(Figma `4196:2468`) — 번호 원(24 + gap 10) 자리는 비운다.
          renderPlaceholder={() => (
            <View className="mb-md ml-[34px] flex-1 rounded-card border border-dashed border-hairline-strong" />
          )}
          scrollEnabled={false}
        />

        <View className="gap-md">
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
      </View>
    </MapSheetShell>
  );
}
