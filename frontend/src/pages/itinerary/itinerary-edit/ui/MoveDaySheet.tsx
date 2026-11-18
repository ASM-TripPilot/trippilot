import type { ReactElement } from 'react';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Button } from '@/shared/ui/Button';
import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetView,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';

import type { ImageLicense } from '@/shared/api/index.schemas';
import {
  ChevronRight24Glyph,
  CloseGlyph,
  PencilGlyph,
} from '@/shared/ui/glyphs';
import { PoiPhoto } from '@/shared/ui/PoiPhoto';

import type { MoveDayOption } from '../model/moveDayOptions';

/**
 * TRIP-1795 · 이 시트는 이제 「장소 시트」다 — 날짜 섹션(`move`)은 옮길 수 있는 장소(고정·방문 완료·하루 일정이 아닌)에만 있고, 어느 장소든
 * 「이름·분류 고치기」 행(`onPressRename`)이 있다. `move === null` 이면 날짜 라벨·일차 칩·힌트·옮기기 CTA 가 전부 없다 — `moveSlot` 은 고정 슬롯을
 * 막지 않으므로 이 `null` 이 옮기기의 유일한 방어선이다(판정은 페이지의 `canMove`). 행 누름은 고치기 시트가 이 시트를 대신하게 만든다(페이지).
 *
 * TRIP-1793 · 「다른 날로 옮기기」 장소 시트(Figma A3 ① `5191:3909`) — 어느 일차로 옮길지 칩으로 고르고 「N일차로 옮기기」로 확정한다.
 * 선택 상태는 시트가 쥔다(페이지가 조건부로 마운트하므로 열 때마다 `initialDate` 에서 새로 시작). 막힌 칩(현재 날·이미 그 장소가 있는 날)은
 * `Pressable disabled` 라 눌려도 아무 일이 없다. 확정은 고른 날짜를 `onConfirm` 으로 알릴 뿐 옮기는 일은 페이지(시각 시트 → 스토어)가 한다.
 * 닫기(X·딤·끌어내림)는 전부 `onClose` — 아무것도 안 옮긴다. Figma 의 「일정에서 빼기」·「장소 정보 ›」는 이번 범위가 아니라 그리지 않는다.
 *
 * ★ 시트 실제 열림·딤 덮임·끌어내림은 `@gorhom/bottom-sheet` 통과형 목이 못 본다 — 6-b 실기(`h12-editor-move-sheet` 프리뷰).
 */

export interface MoveDaySheetProps {
  name: string;
  /** 장소 썸네일(없으면 썸네일 칸을 안 그린다) — 사진이 없으면 `PoiPhoto` 가 카테고리 그림을 고른다. */
  photo?: {
    imageUrl: string | null;
    imageLicense: ImageLicense | null | undefined;
    poiId: string;
    category?: string | null;
  };
  /** 이름 아래 한 줄(예: `1일차 · 14:30–15:15`) — 페이지가 조립한다. */
  subtitle?: string;
  /** 옮기기 섹션 입력 — null 이면 날짜 섹션 전체가 없다(고정·방문 완료·하루 일정). */
  move: {
    options: MoveDayOption[];
    initialDate: string | null;
    onConfirm: (toDate: string) => void;
  } | null;
  /** 「이름·분류 고치기」 행 누름 — 시트 교체는 페이지가 한다. */
  onPressRename: () => void;
  onClose: () => void;
}

function renderBackdrop(props: BottomSheetBackdropProps): ReactElement {
  return (
    <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} />
  );
}

export function MoveDaySheet({
  name,
  photo,
  subtitle,
  move,
  onPressRename,
  onClose,
}: MoveDaySheetProps): ReactElement {
  const options = move?.options ?? [];
  const [selected, setSelected] = useState(move?.initialDate ?? null);
  const target = options.find((option) => option.date === selected);
  const hasDuplicate = options.some((option) => option.blocked === 'duplicate');

  return (
    // 스와이프·딤 탭 닫힘도 `onClose` 로 알린다 — 안 그러면 시트만 사라지고 페이지의 "열림" 상태가 남는다(TimeSheet 선례).
    <BottomSheet
      backdropComponent={renderBackdrop}
      enablePanDownToClose
      onClose={onClose}
    >
      <BottomSheetView
        testID="editor-move-sheet"
        className="w-full gap-lg px-xl pb-[28px] pt-[10px]"
      >
        <View className="w-full flex-row items-center gap-md">
          {photo === undefined ? null : (
            <PoiPhoto
              testID="editor-move-photo"
              imageUrl={photo.imageUrl}
              imageLicense={photo.imageLicense}
              surface="thumb"
              category={photo.category}
              poiId={photo.poiId}
              cachePolicy="memory-disk"
              className="h-[72px] w-[72px] rounded-thumb"
            />
          )}
          <View className="flex-1 gap-xs">
            <Text
              numberOfLines={1}
              className="font-noto-bold text-section font-bold text-ink"
            >
              {name}
            </Text>
            {subtitle === undefined ? null : (
              <Text
                numberOfLines={1}
                className="font-noto text-caption text-muted"
              >
                {subtitle}
              </Text>
            )}
          </View>
          {/* 44 터치 타깃 · 아이콘 24(TimeSheet 머리 X 와 같은 모양). */}
          <Pressable
            testID="editor-move-close"
            accessibilityRole="button"
            accessibilityLabel="닫기"
            onPress={onClose}
            className="h-[44px] w-[44px] items-center justify-center"
          >
            <CloseGlyph size={24} color="ink" />
          </Pressable>
        </View>

        {move === null ? null : (
          <>
            <Text className="font-noto-bold text-label font-bold text-ink">
              날짜
            </Text>
            <View className="w-full flex-row flex-wrap gap-sm">
              {options.map((option) => {
                const isSelected = option.date === selected;
                return (
                  <Pressable
                    key={option.date}
                    testID={`editor-move-day-${option.dayIndex}`}
                    accessibilityRole="button"
                    accessibilityState={{
                      selected: isSelected,
                      disabled: option.blocked !== null,
                    }}
                    disabled={option.blocked !== null}
                    onPress={() => setSelected(option.date)}
                    className={`rounded-pill px-[14px] py-sm ${
                      isSelected
                        ? 'bg-primary'
                        : option.blocked !== null
                          ? 'border border-hairline bg-surface-strong'
                          : 'border border-hairline-strong bg-canvas'
                    }`}
                  >
                    <Text
                      className={`font-noto-bold text-body font-bold ${
                        isSelected
                          ? 'text-on-primary'
                          : option.blocked !== null
                            ? 'text-muted-soft'
                            : 'text-body'
                      }`}
                    >
                      {`${option.dayIndex}일차`}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {target === undefined ? null : (
              <Text
                testID="editor-move-hint"
                className="font-noto text-caption text-muted"
              >
                {`${target.dayIndex}일차 마지막에 넣어요 · 다음 단계에서 시각을 골라요`}
              </Text>
            )}
            {hasDuplicate ? (
              <Text
                testID="editor-move-duplicate-hint"
                className="font-noto text-caption text-muted"
              >
                이미 이 날에 있는 장소예요
              </Text>
            ) : null}
          </>
        )}
        {/* TRIP-1795 · 이름·분류 고치기 진입 행(Figma 5223:4455) — 연한 회색 박스, 연필 18 · 쉐브론 16. */}
        <Pressable
          testID="editor-move-rename"
          accessibilityRole="button"
          onPress={onPressRename}
          className="h-[48px] w-full flex-row items-center gap-sm rounded-button bg-surface-soft px-lg"
        >
          <PencilGlyph size={18} color="ink" />
          <Text className="flex-1 font-noto-bold text-body font-bold text-ink">
            이름·분류 고치기
          </Text>
          <ChevronRight24Glyph size={16} color="muted" />
        </Pressable>

        {move === null ? null : (
          <Button
            testID="editor-move-confirm"
            disabled={target === undefined}
            onPress={() => {
              if (target !== undefined) move?.onConfirm(target.date);
            }}
            className="w-full"
          >
            {target === undefined
              ? '옮기기'
              : `${target.dayIndex}일차로 옮기기`}
          </Button>
        )}
      </BottomSheetView>
    </BottomSheet>
  );
}
