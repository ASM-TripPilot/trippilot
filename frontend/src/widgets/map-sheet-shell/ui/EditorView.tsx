import type { ReactElement } from 'react';
import { useContext, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import {
  NestableDraggableFlatList,
  NestableScrollContainer,
  type DragEndParams,
  type RenderItemParams,
} from 'react-native-draggable-flatlist';
import Animated, {
  useAnimatedRef,
  useScrollViewOffset,
  useSharedValue,
} from 'react-native-reanimated';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';

import {
  PlusGlyph,
  InfoCircleGlyph,
  BackChevronGlyph,
  UndoGlyph,
} from '@/shared/ui/glyphs';
import type { ItineraryDaysItemSlotsItem } from '@/shared/api/index.schemas';
import type { MapCenter, MapPin } from '@/shared/map';
import { buildSlotKey } from '@/entities/itinerary-slot';
import { overlapAwareNotice } from '@/entities/itinerary-slot';
import { SlotStopCard } from '@/entities/itinerary-slot';

import { CTA_BAR_HEIGHT, type CtaButton } from './CtaBar';
import { DayChipScroller } from './DayChipScroller';
import { decideDragEnd, DELETE_ZONE_BAR_HEIGHT } from './dragDelete';
import { MapSheetShell } from './MapSheetShell';
import { RemoveSelectedDialog } from './RemoveSelectedDialog';
import { SheetHeader } from './SheetHeader';
import { SlotDropZone } from './SlotDropZone';
import { useDeleteZoneHover } from './useDeleteZoneHover';

/**
 * TRIP-797 · h12 통일 편집기 뷰 — TRIP-921 로 pages 에서 widgets 로 승격돼 h12 편집(`ItineraryEditPage`)·
 * i07(같은 페이지 inTrip)·h12 직접 짜기(`ManualPlanPage`)가 **같은 뷰**를 소비한다. 조회·저장 PUT·시트
 * 개폐·미지정 안내는 페이지 몫이고, 이 뷰는 셸 조립·드래그 판정만 진다. 위젯은 features 를 못 물어 헤더
 * 날짜는 페이지가 포맷한 `dateLabel` 문자열로 받는다.
 *
 * 드래그(TRIP-1246, 센티널 폐기): 리스트 data = 활성 일자 슬롯뿐이다. 삭제 영역은 **리스트 밖 시트 하단에
 * 고정**(Figma `4195:2468` — CTA 자리)돼 끌기 중에만 뜨고, 놓을 때 끌던 카드가 그 영역 위에 있었으면
 * 삭제(`onDeleteViaDrag`), 아니면 재정렬(`onReorder`). 위 판정은 `dragDelete.ts` 순수 함수, 영역 위 여부
 * 추적은 `useDeleteZoneHover`. 센티널을 리스트에 두면 라이브러리가 삭제 칸도 슬롯처럼 밀어냈다.
 * 놓은 뒤엔 `dragEpoch` 로 칸 키를 바꿔 다시 그린다 — 라이브러리는 놓은 뒤에도 마지막 밀림값을 칸에 붙들고
 * 있다가 그 칸 `onLayout` 이 다시 불릴 때만 풀어, 고정 카드 위로 끌었다 되돌리면 밀린 채 남아 가려졌다.
 * 고정·방문 완료 카드는 롱프레스가 끌기로 안 이어지고, 판정 단계에서도 한 번 더 거른다(심층 방어 —
 * 스토어 삭제는 고정 여부를 안 본다).
 *
 * ⚠️ 원리적 사각(6-b 실기): 실제 롱프레스·손가락 이동·놓을 자리 계산·시트 콘텐츠 제스처 경합·색.
 */

/** 편집 중 슬롯 — 서버 슬롯에서 startAt 만 미지정(null) 허용(편집 스토어 EditorSlot 과 같은 모양). */
export type EditorViewSlot = Omit<ItineraryDaysItemSlotsItem, 'startAt'> & {
  startAt: string | null;
  /** TRIP-1793 · 옮김 표식(스토어 `EditorSlot.movedFromDate` 와 같은 값) — 있으면 카드에 「N일차에서 옮김」 배지. */
  movedFromDate?: string;
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
  /** CTA 라벨(TRIP-1038 — 직접 짜기만 「저장하고 확정하기」를 넘긴다). 생략하면 「일정 저장하기」. */
  saveLabel?: string;
  /** 끌어 바꾼 새 순서(센티널 제외). 완료 행 재고정은 페이지 사슬 몫(고정 행은 재고정 없음, TRIP-1250). */
  onReorder?: (slots: EditorViewSlot[]) => void;
  /** 드롭존(센티널 뒤)에 놓인 카드. 고정·완료 카드는 부르지 않는다. */
  onDeleteViaDrag?: (poiId: string) => void;
  /** TRIP-1791 · 「선택」으로 골라 한 번에 빼기 — 확정된 poiId(슬롯 순서)를 준다. **없으면 「선택」 버튼 자체가 없다**
   *  (직접 짜기 = 지금 화면). 선택 모드·고른 곳·확인창 상태는 이 뷰 안에 산다. */
  onDeleteSelected?: (poiIds: string[]) => void;
  /** TRIP-1792 · 머리 되돌리기 ↶ — 「선택」 오른쪽. **없으면 ↶ 자체가 없다**(직접 짜기 = 기능 부재). `enabled` 가 거짓이면(쌓인 편집
   *  없음) 선 색만 `muted-soft` 로 바뀌고 눌러도 아무 일이 없다. 선택 모드(`N곳 선택` 머리)에는 안 보인다. */
  undo?: { enabled: boolean; onPress: () => void };
  /** TRIP-1793 · 카드 ⋯ → 「다른 날로 옮기기」(페이지가 시트를 소유). **없으면 ⋯ 자체가 없다**(직접 짜기 = 지금 화면). 줘도 고정·방문 완료 카드·
   *  선택 모드·일정이 하루뿐일 때는 ⋯ 가 없다. */
  onPressMore?: (poiId: string) => void;
  /** 드래그 중 얼굴 강제(프리뷰 `h12-editor-dragging`). 실제 끌기는 내부 상태가 켠다. */
  isDragging?: boolean;
  /** 방문 완료 잠금(AC-11). */
  completedSlotKeys?: string[];
  /** TRIP-753 · i07(여행 중 편집) 진입 — 안내 문구를 i07 문구로 바꾸고, 방문 완료 카드 바로 앞의 카드 사이
   *  "+" 를 빈 줄로 바꾼다(TRIP-1115 — 완료 카드 앞 삽입은 거짓 순서). 그 밖(완료 잠금·위반 배지)은
   *  모드가 아니라 데이터가 정한다. */
  inTrip?: boolean;
  /** 시트 머리 제목(TRIP-1440 Q-141 가산) — 미전달이면 '일정 편집'. 직접 짜기 첫 화면은 '편집'이 아니라 만드는 중이다. */
  title?: string;
}

const GUIDE_H12 = '길게 눌러 순서를 바꾸거나, 아래로 끌어 삭제해요';
const GUIDE_IN_TRIP =
  '방문한 곳은 그대로 두고, 길게 눌러 순서를 바꾸거나 아래로 끌어 삭제해요';

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
  saveLabel = '일정 저장하기',
  onReorder,
  onDeleteViaDrag,
  onDeleteSelected,
  undo,
  onPressMore,
  isDragging,
  completedSlotKeys,
  inTrip,
  title = '일정 편집',
}: EditorViewProps): ReactElement {
  // 끌기 진행 중(onDragBegin ~ onDragEnd) — 뷰 국소 일시 상태.
  const [dragging, setDragging] = useState(false);
  const dragFace = isDragging === true || dragging;
  // 놓을 때마다 +1 — 칸 키에 섞어 라이브러리가 붙든 밀림값(`heldTranslate`)을 버리게 새로 그린다(끌기 중엔 불변).
  const [dragEpoch, setDragEpoch] = useState(0);
  // 끌던 카드가 하단 삭제 영역 위에 있는지(터치 중 마지막 값). 렌더에 안 쓰므로 ref.
  const overZoneRef = useRef(false);
  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  const scrollOffset = useScrollViewOffset(scrollRef);
  const viewportHeight = useSharedValue(0);
  // CTA 바가 하단 안전 영역 위에 얹히므로 여백에 그 높이를 더한다. Provider 없으면(jest) 0 — 셸과 같은 읽기.
  const bottomInset = useContext(SafeAreaInsetsContext)?.bottom ?? 0;

  // 고정·방문 완료 슬롯 — 끌기·드롭 삭제를 막는다(INV-U3-03 · TRIP-753 AC-11). 시각 편집은 `canEditTime` 이 따로 가른다.
  const isLocked = (slot: EditorViewSlot): boolean =>
    completedSlotKeys?.includes(buildSlotKey(activeDate, slot.poiId)) === true;
  const isPinned = (slot: EditorViewSlot): boolean =>
    slot.isFixed === true || isLocked(slot);

  // TRIP-1791 · 선택 모드 — 모드·체크·확인창은 뷰 국소 상태. 빼기 대상 `picked` 는 **매 렌더 도출**한다
  // (고른 것 ∩ 지금 슬롯 ∖ 잠김) — 체크 뒤 방문 완료로 잠긴 카드는 자동으로 빠진다(D12).
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const hasUnlocked = slots.some((slot) => !isPinned(slot));
  const pickedSlots: EditorViewSlot[] = [];
  for (const slot of slots) {
    if (
      selected.includes(slot.poiId) &&
      !isPinned(slot) &&
      !pickedSlots.some((p) => p.poiId === slot.poiId)
    ) {
      pickedSlots.push(slot);
    }
  }
  const picked = pickedSlots.map((slot) => slot.poiId);
  function exitSelecting(): void {
    setSelecting(false);
    setSelected([]);
    setConfirming(false);
  }
  function toggleSelected(poiId: string): void {
    setSelected((prev) =>
      prev.includes(poiId)
        ? prev.filter((id) => id !== poiId)
        : [...prev, poiId]
    );
  }
  function confirmDelete(): void {
    // 캡처 → 모드 종료(동기) → 콜백. 전부 잠겨 비었으면 확인창만 닫는다.
    exitSelecting();
    if (picked.length > 0) onDeleteSelected?.(picked);
  }

  const { onAnimValInit } = useDeleteZoneHover({
    scrollOffset,
    viewportHeight,
    bottomInset,
    onChange: (over) => {
      overZoneRef.current = over;
    },
  });

  function handleDragEnd({ data, to }: DragEndParams<EditorViewSlot>): void {
    setDragging(false);
    setDragEpoch((e) => e + 1);
    const overZone = overZoneRef.current;
    overZoneRef.current = false;
    // 고정·완료 카드는 제스처가 막혀도 판정에서 한 번 더 거른다(심층 방어).
    const decision = decideDragEnd({ data, to, overZone, isPinned });
    if (decision.kind === 'delete') onDeleteViaDrag?.(decision.moved.poiId);
    else if (decision.kind === 'reorder') onReorder?.(decision.slots);
  }

  // TRIP-1793 · 옮김 배지 문구 — 출발 날짜가 이 일정의 몇 일차인지 `days` 에서 찾는다(없으면 지어내지 않는다).
  function movedLabelOf(slot: EditorViewSlot): string | null {
    const from = days.find((tab) => tab.date === slot.movedFromDate);
    return from === undefined ? null : `${from.dayIndex}일차에서 옮김`;
  }

  function renderItem({
    item,
    getIndex,
    drag,
    isActive,
  }: RenderItemParams<EditorViewSlot>): ReactElement | null {
    const index = getIndex() ?? 0;
    const slotKey = buildSlotKey(activeDate, item.poiId);
    const locked = isLocked(item);
    const fixed = item.isFixed === true;
    // 시각 편집: 숙소(고정)는 변경 불가(BR-U3-07), 꼭 갈 곳 고정은 사용자가 시각을 고친다(INV-U3-03
    // 2026-10-30 개정, TRIP-1674), 방문 완료는 잠금. category 가 없는 고정 슬롯은 편집 허용(fail-open, 수용).
    // ponytail: `isFixedStay`(features/itinerary/model/sheetMeta.ts)와 같은 판정이나 widgets 는 features 를
    // 안 물어 인라인 사본 — 세 번째 사본이 생기면 shared 로 올린다.
    const canEditTime = !(fixed && item.category === '숙소') && !locked;
    const timeLabel =
      item.startAt === null
        ? null
        : `${item.startAt.slice(0, 5)}–${item.endAt.slice(0, 5)}`;
    return (
      <View className="gap-md pb-md">
        {/* 롱프레스 → 끌기 — 고정·완료 카드엔 핸들러를 안 건다(AC-3 ①). */}
        {/* eslint-disable-next-line no-restricted-syntax -- 롱프레스 끌기 손잡이 — 낭독기 대체 수단은 M-102(나중)(TRIP-1765). */}
        <Pressable onLongPress={isPinned(item) || selecting ? undefined : drag}>
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
            violation={overlapAwareNotice(item, slots[index - 1])}
            onPressTimeChip={
              canEditTime && !selecting
                ? () => onPressTimeChip(slotKey)
                : undefined
            }
            more={
              onPressMore !== undefined &&
              !selecting &&
              !isPinned(item) &&
              days.length > 1
                ? {
                    onPress: () => onPressMore(item.poiId),
                    testID: `editor-slot-more-${item.poiId}`,
                  }
                : undefined
            }
            movedLabel={movedLabelOf(item)}
            selection={
              selecting
                ? {
                    state: isPinned(item)
                      ? 'disabled'
                      : selected.includes(item.poiId)
                        ? 'on'
                        : 'off',
                    onToggle: () => toggleSelected(item.poiId),
                    testID: `editor-select-check-${item.poiId}`,
                  }
                : undefined
            }
          />
        </Pressable>
        {/* 카드 사이 "+"(선행 index, AC-7). "+" i 는 카드 i 뒤·i+1 앞에 넣는다 — i07 에서 카드 i+1 이 방문
            완료면 그 자리엔 "+" 대신 같은 높이(24)의 빈 줄을 둔다(TRIP-1115, Figma i07 4735:2958). h12 는
            완료 데이터가 있어도 전 자리 "+"(칸 DoD 무회귀 — 판정은 inTrip 한정). 끌기 중엔 안 보이고 안
            눌리지만 **자리는 지킨다**: 라이브러리가 끌기 시작 순간 끄는 카드 위치를 스냅샷으로 적어 두므로,
            여기서 줄이 사라지면 놓일 칸 계산이 드롭존 쪽으로 밀린다(03b 경고-1). display none·언마운트 금지. */}
        {index < slots.length - 1 ? (
          selecting || (inTrip === true && isLocked(slots[index + 1])) ? (
            <View className="h-[24px]" />
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="여기에 장소 추가"
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
              <PlusGlyph size={20} color="primary" />
            </Pressable>
          )
        ) : null}
      </View>
    );
  }

  // 좌상단 오버레이 — back + 일차 칩(다일자만). MapSheetShell 의 기본 DayChipOverlay 대신 편집기 고유
  // testID(`itinerary-edit-day-{dayIndex}`)를 쓰려고 overlay 슬롯을 직접 채운다(AC-4).
  const overlay = (
    <View className="flex-row items-center gap-sm">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="뒤로"
        testID="itinerary-edit-back"
        onPress={onBack}
        className="h-[36px] w-[36px] items-center justify-center rounded-pill bg-canvas"
      >
        <BackChevronGlyph size={20} />
      </Pressable>
      {days.length > 1 ? (
        <DayChipScroller selectedIndex={activeDayIndex}>
          {days.map((tab, index) => {
            const selected = index === activeDayIndex;
            return (
              <Pressable
                accessibilityRole="button"
                key={tab.date}
                testID={`itinerary-edit-day-${tab.dayIndex}`}
                onPress={() => {
                  exitSelecting();
                  onSelectDay(index);
                }}
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
          })}
        </DayChipScroller>
      ) : null}
    </View>
  );

  const showSelect = onDeleteSelected !== undefined && hasUnlocked;
  const header = selecting ? (
    <View className="px-lg pb-md pt-sm">
      <Text
        testID="editor-select-count"
        className="font-noto-bold text-card-title font-bold text-ink"
      >
        {`${picked.length}곳 선택`}
      </Text>
    </View>
  ) : (
    <SheetHeader
      title={title}
      dayLabel={`${activeDayIndex + 1}일차`}
      dateLabel={dateLabel}
      meta={`${slots.length}곳`}
      trailing={
        showSelect || undo !== undefined ? (
          <View className="flex-row items-center gap-sm">
            {showSelect ? (
              <Pressable
                accessibilityRole="button"
                testID="editor-select-toggle"
                onPress={() => setSelecting(true)}
                hitSlop={8}
                className="rounded-pill border border-hairline-strong bg-canvas px-md py-[4px]"
              >
                <Text className="font-noto-bold text-caption font-bold text-ink">
                  선택
                </Text>
              </Pressable>
            ) : null}
            {undo !== undefined ? (
              // 보이는 원 32(Figma 5210:4520), 히트는 hitSlop 6 으로 44 — 비활성은 opacity 가 아니라 선 색만 바뀐다.
              // 레이아웃 높이를 44 로 두면 머리(items-start)의 오른쪽 묶음이 제목보다 처진다(6-b 실측) → 원 32 + -my 4 로
              // 줄 높이는 「선택」 알약과 같게 두고 원만 위아래로 4 씩 넘친다.
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="되돌리기"
                accessibilityState={{ disabled: !undo.enabled }}
                testID="editor-undo"
                disabled={!undo.enabled}
                onPress={undo.onPress}
                hitSlop={6}
                className="-my-[4px] h-[32px] w-[32px] items-center justify-center rounded-pill bg-surface-strong"
              >
                <UndoGlyph color={undo.enabled ? 'ink' : 'mutedSoft'} />
              </Pressable>
            ) : null}
          </View>
        ) : undefined
      }
    />
  );

  // 끌기 중엔 드롭존이 삭제 자리라 CTA 를 비운다(빈 배열이면 MapSheetShell 이 CTA 바 미렌더).
  const cta: CtaButton[] = dragFace
    ? []
    : selecting
      ? [
          {
            label: '취소',
            variant: 'outline',
            fill: true,
            testID: 'editor-select-cancel',
            onPress: exitSelecting,
          },
          {
            label: picked.length === 0 ? '빼기' : `${picked.length}곳 빼기`,
            variant: 'ink',
            fill: true,
            testID: 'editor-select-delete',
            disabled: picked.length === 0,
            onPress: () => setConfirming(true),
          },
        ]
      : [
          {
            label: saveLabel,
            variant: 'primary',
            onPress: onSave,
            disabled: slots.length === 0,
          },
        ];

  return (
    <>
      <MapSheetShell
        center={center}
        pins={pins}
        overlay={overlay}
        header={null}
        cta={cta}
        initialIndex={2}
        // TRIP-1112: 셸 스크롤 안에 드래그 리스트를 넣으면 카드 위 스와이프를 리스트 Pan 이 먼저 가져가 스크롤도
        // 시트도 안 움직였다(실기). 셸 스크롤을 끄고 시트는 손잡이로만 끌며, 스크롤은 Nestable 컨테이너가
        // 리스트와 판정을 나눠 갖는다(실기 스파이크 A 통과). 두 값은 정적이다 — 렌더 중 바꾸면 본문이 재마운트된다.
        bodyScroll={false}
        contentPanning={false}
      >
        <View
          testID="itinerary-edit-viewport"
          className="flex-1"
          onLayout={(e) => {
            viewportHeight.value = e.nativeEvent.layout.height;
          }}
        >
          <NestableScrollContainer
            ref={scrollRef as never}
            contentContainerStyle={{
              paddingBottom: CTA_BAR_HEIGHT + bottomInset,
            }}
          >
            {header}
            <View className="px-lg pb-2xl pt-xs">
              {/* activationDistance·scrollEnabled 는 넘기지 않는다 — 라이브러리 기본(20·false)을 {...props} 가
              덮으면(undefined 라도) 활성 거리 0 이 돼 스와이프를 드래그가 다시 뺏는다. */}
              <NestableDraggableFlatList
                testID="itinerary-edit-list"
                data={slots}
                keyExtractor={(item) => `card-${item.poiId}-${dragEpoch}`}
                renderItem={renderItem}
                // 끌던 카드가 목록 밖(하단 삭제 영역)까지 손가락을 따라가게 한다 — 기본은 목록 경계에 묶여 영역에 못 닿는다.
                dragItemOverflow
                onAnimValInit={onAnimValInit}
                onDragBegin={() => {
                  overZoneRef.current = false;
                  setDragging(true);
                }}
                onDragEnd={handleDragEnd}
                // 원래 자리 점선 칸(Figma `4196:2468`) — 번호 원(24 + gap 10) 자리는 비운다.
                renderPlaceholder={() => (
                  <View className="mb-md ml-[34px] flex-1 rounded-card border border-dashed border-hairline-strong" />
                )}
              />

              {/* 선택 모드(TRIP-1791)에선 장소 추가·안내줄이 없다 — 리스트·key 는 그대로 둔다. */}
              {selecting ? null : (
                <View className="gap-md">
                  {/* 점선 "+ 장소 추가"(index 미지정 = 말미, AC-8). */}
                  <Pressable
                    accessibilityRole="button"
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
                  {/* 0곳이면 끌어 바꿀 카드가 없어 끌기 안내를 안 보인다(TRIP-1440 Q-141). */}
                  {slots.length > 0 ? (
                    <View
                      testID="itinerary-edit-guide"
                      className="flex-row items-center gap-[6px]"
                    >
                      <InfoCircleGlyph size={16} />
                      <Text className="font-noto text-caption text-muted">
                        {inTrip ? GUIDE_IN_TRIP : GUIDE_H12}
                      </Text>
                    </View>
                  ) : null}

                  {/* TRIP-1424 — 장소 추가는 [저장]과 따로 곧장 서버에 저장된다(PlaceAddPage PUT). Figma 공백이라 안내줄 꼴을 따른다. */}
                  <View
                    testID="itinerary-edit-add-saved-hint"
                    className="flex-row items-center gap-[6px]"
                  >
                    <InfoCircleGlyph size={16} />
                    <Text className="font-noto text-caption text-muted">
                      장소를 추가하면 바로 저장돼요
                    </Text>
                  </View>
                </View>
              )}
            </View>
          </NestableScrollContainer>
          {/* 하단 고정 삭제 영역 — 리스트 밖(끌기 중에만, Figma `4195:2468`: CTA 자리 84 = 12 + 56 + 16). 터치는
          통과(pointerEvents none) — 판정은 위치 추적이라 이 View 가 눌릴 일이 없다. */}
          {dragFace ? (
            <View
              testID="itinerary-edit-dropzone-bar"
              pointerEvents="none"
              style={{ height: DELETE_ZONE_BAR_HEIGHT + bottomInset }}
              className="absolute bottom-0 left-0 right-0 bg-canvas px-lg pt-md"
            >
              <View className="absolute inset-x-0 top-0 h-px bg-hairline" />
              <SlotDropZone isActive />
            </View>
          ) : null}
        </View>
      </MapSheetShell>
      {/* TRIP-1791 · 빼기 확인창 — 시트 위를 덮으려 셸 형제로 둔다(소비처 루트가 flex-1 View). 조건부 absolute 오버레이라 덮임은 6-b. */}
      {confirming && picked.length > 0 ? (
        <RemoveSelectedDialog
          names={pickedSlots.map((slot) => slot.nameKo ?? '')}
          onConfirm={confirmDelete}
          onCancel={() => setConfirming(false)}
        />
      ) : null}
    </>
  );
}
