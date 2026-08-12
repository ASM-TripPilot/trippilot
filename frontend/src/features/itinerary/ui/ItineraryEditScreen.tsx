import type { ReactElement } from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  NestableDraggableFlatList,
  NestableScrollContainer,
  type RenderItemParams,
} from 'react-native-draggable-flatlist';

import type { ItineraryDaysItemSlotsItem } from '@/shared/api/generated/schemas';

import { formatDraftDayHeader } from '../model/draftView';
import type { PlanDayTab } from '../model/planState';
import { buildSlotKey } from '../model/slotKey';
import {
  AlertCircleGlyph,
  BackChevronGlyph,
  ClockGlyph,
  DragHandleGlyph,
  LockGlyph,
  PlusGlyph,
  TrashGlyph,
} from './ItineraryGlyphs';

/**
 * h24 일정 편집 화면(슬라이스1) — Figma `1896:1083`.
 *
 * 이 화면은 데이터를 모르는 **순수 컴포넌트**다(TimelineScreen 배치) — 조회·판정·스토어를 모르고
 * 활성 날 슬롯만 받아 그리고 콜백을 발화한다. 편집 로직(삭제·재정렬 수학)은 페이지가 스토어에
 * 배선한다.
 *
 * 슬라이스1 경계:
 *  - **카드 2형태만** — 고정(휴지통·핸들·다른후보 없음, 부제 '체크아웃 …')과 일반. 필수(must-visit)
 *    형태는 안 그린다(슬롯 계약에 필수 필드 없음 · 엣지4 defer).
 *  - **드래그 잠금은 두 겹** — 고정엔 핸들을 안 그리고(여기), 재정렬 수학이 고정을 재고정한다
 *    (스토어 `reorderKeepingFixed`). 배열 순서 = 슬롯 순서라(INV-U3-02) lib 이 준 순서를 그대로
 *    포워딩하고 고정 재고정은 스토어가 한다.
 *  - **자리만 어포던스**(저장하기·장소추가·시각칩·다른후보)는 Figma 대로 그리되 **콜백 prop 을
 *    아예 안 받아** press 가 무해하다(h25 비활성 CTA 선례). 뒤로만 콜백을 부른다(press 배선 생존).
 *  - **지도·필수칩·시각조정 시트·다른후보 조회**는 슬라이스2·3 — 지도는 자리 placeholder 다.
 *
 * 소요시간 문자열은 어디에도 없다(INV-3) — 시각 칩은 솔버 검증 시각(startAt–endAt)만, 구간은 서버
 * `distanceRange` 문자열만 실어 나른다(로컬로 지어내지 않는다).
 */

// 고정 슬롯 부제(동결 문구) — 시각 조정·삭제가 잠긴 체크아웃 앵커임을 말한다.
const FIXED_SUBTITLE = '체크아웃 · 변경·삭제 불가';
const APPBAR_TITLE = '일정 편집';
const ADD_PLACE_LABEL = '장소 추가';
const SAVE_LABEL = '저장하기';
const ALT_LABEL = '다른 후보 ›';
const FIXED_CHIP = '고정';
const MAP_PLACEHOLDER_NOTE = '지도는 곧 제공돼요';

// 카드 그림자(h25 `cardShadow` 와 동일 Figma 값). RN 은 box-shadow 가 없어 스타일 프로퍼티로 옮긴다.
const cardShadow = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.06,
  shadowRadius: 5,
  elevation: 2,
} as const;

export interface ItineraryEditScreenProps {
  days: PlanDayTab[];
  /** 활성 날의 슬롯만 — 페이지가 골라 내린다. */
  slots: ItineraryDaysItemSlotsItem[];
  activeDayIndex: number;
  onSelectDay: (index: number) => void;
  onBack: () => void;
  /** 비고정 휴지통 탭 — poiId 를 넘긴다. */
  onDeleteSlot: (poiId: string) => void;
  /** DraggableFlatList onDragEnd.data 포워딩 — 고정 재고정은 스토어가 한다. */
  onReorder: (data: ItineraryDaysItemSlotsItem[]) => void;
}

function SlotCard({
  slot,
  date,
  index,
  drag,
  onDeleteSlot,
}: {
  slot: ItineraryDaysItemSlotsItem;
  date: string;
  index: number;
  drag: () => void;
  onDeleteSlot: (poiId: string) => void;
}): ReactElement {
  const slotKey = buildSlotKey(date, slot.poiId);
  // 시각 칩 = 솔버 검증 시각만(INV-2). endsNextDay 면 endAt 이 익일 시각이라(HC4) 표기로만 가른다.
  const timeText = `${slot.startAt.slice(0, 5)}–${
    slot.endsNextDay ? '익일 ' : ''
  }${slot.endAt.slice(0, 5)}`;
  const tagLine = slot.tags.length > 0 ? `#${slot.tags.join(' · ')}` : '';

  return (
    <View className="w-full">
      {/* 구간 거리 커넥터 — 서버 distanceRange 문자열만(INV-3). 편집 직후엔 계약상 null 이라 없다. */}
      {index > 0 &&
      slot.distanceRange !== null &&
      slot.distanceRange !== undefined ? (
        <View className="flex-row items-center gap-sm pb-[10px] pl-[9px]">
          <View className="h-[16px] w-[2px] rounded-[1px] bg-hairline-strong" />
          <Text className="font-noto text-caption text-muted-soft">
            {slot.distanceRange}
          </Text>
        </View>
      ) : null}

      <View
        style={cardShadow}
        className="mb-[14px] w-full flex-row items-center gap-[10px] rounded-card border border-hairline bg-canvas p-md"
      >
        {slot.isFixed ? null : (
          <Pressable
            testID={`itinerary-edit-slot-handle-${slotKey}`}
            accessibilityRole="button"
            accessibilityLabel="순서 변경 손잡이"
            onLongPress={drag}
            delayLongPress={120}
            hitSlop={6}
          >
            <DragHandleGlyph />
          </Pressable>
        )}

        <View className="h-[60px] w-[60px]">
          {slot.imageUrl === null || slot.imageUrl === undefined ? (
            // 기본 이미지를 지어내지 않는다(TRIP-219) — 미확보면 사진 없는 자리다.
            <View className="h-[60px] w-[60px] rounded-thumb bg-surface-soft" />
          ) : (
            <Image
              source={{ uri: slot.imageUrl }}
              className="h-[60px] w-[60px] rounded-thumb"
            />
          )}
          <View className="absolute -left-[6px] -top-[6px] h-[22px] w-[22px] items-center justify-center rounded-pill bg-primary">
            <Text
              testID={`itinerary-edit-slot-no-${slotKey}`}
              className="font-inter-bold text-micro font-bold text-on-primary"
            >
              {String(index + 1)}
            </Text>
          </View>
        </View>

        <View className="flex-1 gap-[6px]">
          <View className="flex-row items-center gap-xs">
            <Pressable
              testID={`itinerary-edit-slot-time-${slotKey}`}
              accessibilityRole="button"
              className="flex-row items-center gap-xs rounded-pill border border-hairline-strong px-sm py-[3px]"
            >
              <ClockGlyph size={12} />
              <Text className="font-noto-bold text-caption font-bold text-ink">
                {timeText}
              </Text>
            </Pressable>
            <View className="flex-1" />
            {slot.isFixed ? (
              <View
                testID={`itinerary-edit-slot-fixed-${slotKey}`}
                className="flex-row items-center gap-xs rounded-pill bg-surface-strong py-xs pl-sm pr-md"
              >
                <LockGlyph tone="muted" />
                <Text className="font-noto-bold text-caption font-bold text-muted">
                  {FIXED_CHIP}
                </Text>
              </View>
            ) : (
              <Pressable
                testID={`itinerary-edit-slot-delete-${slotKey}`}
                accessibilityRole="button"
                accessibilityLabel="삭제"
                onPress={() => onDeleteSlot(slot.poiId)}
                hitSlop={6}
              >
                <TrashGlyph />
              </Pressable>
            )}
          </View>

          <Text
            testID={`itinerary-edit-slot-name-${slotKey}`}
            className="font-noto-bold text-card-title font-bold text-ink"
          >
            {slot.nameKo ?? ''}
          </Text>

          {/* 부제이자 카드 앵커 — `itinerary-edit-slot-{slotKey}` 는 이 부제 leaf 에 붙는다. 승인
              테스트가 고정 부제를 문자열(=정규화 후 완전 일치)로 재므로 이 요소의 텍스트는 부제
              하나뿐이어야 하고, 슬롯마다 항상 렌더돼(비고정·빈 태그면 빈 문자열) 카드 순서 앵커가
              된다. */}
          <Text
            testID={`itinerary-edit-slot-${slotKey}`}
            className="font-noto text-caption text-muted"
          >
            {slot.isFixed ? FIXED_SUBTITLE : tagLine}
          </Text>

          {slot.isFixed ? null : (
            // 자리만 어포던스 — 콜백 없이 렌더(슬라이스3 slot-candidates 배선 전). press 무해.
            <Pressable
              testID={`itinerary-edit-slot-alt-${slotKey}`}
              accessibilityRole="button"
              className="self-start pt-[2px]"
            >
              <Text className="font-noto-bold text-caption font-bold text-primary-text">
                {ALT_LABEL}
              </Text>
            </Pressable>
          )}

          {/* 위반 배지 — h25 TimelineSlotCard 계약을 개명 없이 재현(AC7 · 02a ★3). */}
          {slot.hasViolation ? (
            <View
              testID={`itinerary-edit-violation-${slotKey}`}
              className="flex-row items-center gap-xs rounded-button bg-primary-pale px-sm py-xs"
            >
              <AlertCircleGlyph size={16} tone="primaryText" />
              {slot.violationReason === null ||
              slot.violationReason === undefined ? null : (
                <Text className="font-noto text-caption text-primary-text">
                  {slot.violationReason}
                </Text>
              )}
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
}

export function ItineraryEditScreen({
  days,
  slots,
  activeDayIndex,
  onSelectDay,
  onBack,
  onDeleteSlot,
  onReorder,
}: ItineraryEditScreenProps): ReactElement {
  const activeDate = days[activeDayIndex]?.date ?? '';

  return (
    <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
      <View className="flex-1 bg-canvas">
        <View className="w-full flex-row items-center gap-[6px] border-b border-hairline bg-canvas pb-sm pl-md pr-lg pt-lg">
          <Pressable
            testID="itinerary-edit-back"
            accessibilityRole="button"
            accessibilityLabel="뒤로"
            onPress={onBack}
            hitSlop={8}
          >
            <BackChevronGlyph />
          </Pressable>
          <Text className="font-noto-bold text-[18px] font-bold text-ink">
            {APPBAR_TITLE}
          </Text>
        </View>

        <NestableScrollContainer>
          <View className="gap-[14px] px-lg pb-lg pt-md">
            {/* 지도 카드는 슬라이스3 — 자리 placeholder(핀·폴리라인은 실제 지도와 함께 온다). */}
            <View className="h-[230px] w-full items-center justify-center rounded-card border border-hairline bg-surface-soft">
              <Text className="font-noto text-label text-muted">
                {MAP_PLACEHOLDER_NOTE}
              </Text>
            </View>

            {days.length > 1 ? (
              <View className="flex-row flex-wrap gap-sm">
                {days.map((tab, index) => (
                  <Pressable
                    key={tab.date}
                    testID={`itinerary-edit-day-${tab.dayIndex}`}
                    accessibilityRole="button"
                    onPress={() => onSelectDay(index)}
                    className={`flex-row items-center rounded-pill px-md py-[5px] ${
                      index === activeDayIndex
                        ? 'bg-primary-pale'
                        : 'border border-hairline-strong'
                    }`}
                  >
                    <Text
                      className={`text-label ${
                        index === activeDayIndex
                          ? 'font-noto-bold font-bold text-primary-text'
                          : 'font-noto text-body'
                      }`}
                    >
                      {`Day ${tab.dayIndex}`}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : null}

            <View className="flex-row items-center gap-sm">
              <View className="h-[18px] w-[4px] rounded-[2px] bg-primary" />
              <Text className="font-noto-bold text-section font-bold text-ink">
                {`Day ${activeDayIndex + 1}`}
              </Text>
              <Text className="font-noto text-label text-muted">
                {formatDraftDayHeader(activeDate)}
              </Text>
              <View className="flex-1" />
              <Text
                testID="itinerary-edit-day-count"
                className="font-noto text-label text-muted"
              >
                {`${slots.length}곳`}
              </Text>
            </View>

            <NestableDraggableFlatList<ItineraryDaysItemSlotsItem>
              testID="itinerary-edit-list"
              data={slots}
              keyExtractor={(item) => buildSlotKey(activeDate, item.poiId)}
              renderItem={({
                item,
                getIndex,
                drag,
              }: RenderItemParams<ItineraryDaysItemSlotsItem>) => (
                <SlotCard
                  slot={item}
                  date={activeDate}
                  index={getIndex() ?? 0}
                  drag={drag}
                  onDeleteSlot={onDeleteSlot}
                />
              )}
              onDragEnd={({ data }) => onReorder(data)}
            />

            {/* 자리만 어포던스 — 콜백 없이 렌더(슬라이스3 배선 전). press 무해. */}
            <Pressable
              testID="itinerary-edit-add-place"
              accessibilityRole="button"
              className="w-full flex-row items-center justify-center gap-xs rounded-button border border-hairline-strong bg-canvas py-md"
            >
              <PlusGlyph />
              <Text className="font-noto-bold text-body font-bold text-ink">
                {ADD_PLACE_LABEL}
              </Text>
            </Pressable>
          </View>
        </NestableScrollContainer>

        {/* 자리만 어포던스 — 저장 배선은 슬라이스2. 콜백 없이 렌더(press 무해). */}
        <View className="w-full px-lg pb-lg pt-sm">
          <Pressable
            testID="itinerary-edit-save"
            accessibilityRole="button"
            className="h-12 w-full items-center justify-center rounded-button bg-primary"
          >
            <Text className="font-noto-bold text-[16px] font-bold text-on-primary">
              {SAVE_LABEL}
            </Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}
