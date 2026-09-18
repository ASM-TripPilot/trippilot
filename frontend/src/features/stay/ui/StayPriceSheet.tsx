/**
 * e02 가격대 필터 시트(TRIP-457 AC-12 · 01b Q4 (a)) — 프리셋 가격 버킷 4개를 라디오로 그린다.
 *
 * **완전 제어 컴포넌트**(useState 0) — 선택된 버킷·열림은 페이지가 소유(StayFilterSheet 선례,
 * `features/stay/ui`는 구조 가드가 useState 0건 강제). 실제 필터링은 `priceRangeFilter` 순수 함수 +
 * 페이지가 진다(이 시트는 UI 만). 선택 표시는 색이 아니라 `accessibilityState.selected`로 잰다.
 * 실제 시트 열림/딤은 gorhom 목이 통과 컴포넌트라 무심판(6-b 실기, ★F-11).
 */
import type { ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetView,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';

import { PRICE_BUCKETS, type PriceBucketId } from '../model/priceRangeFilter';

export interface StayPriceSheetProps {
  selected: PriceBucketId;
  onSelect: (id: PriceBucketId) => void;
  onClose: () => void;
}

function renderBackdrop(props: BottomSheetBackdropProps): ReactElement {
  return (
    <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} />
  );
}

function PriceOption({
  id,
  label,
  selected,
  onSelect,
}: {
  id: PriceBucketId;
  label: string;
  selected: boolean;
  onSelect: (id: PriceBucketId) => void;
}): ReactElement {
  return (
    <Pressable
      testID={`stay-price-option-${id}`}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={() => onSelect(id)}
      className="w-full flex-row items-center justify-between rounded-[14px] border border-hairline bg-canvas px-lg py-md"
    >
      <Text
        className={
          selected
            ? 'font-noto-bold text-body font-bold text-primary-text'
            : 'font-noto text-body text-body'
        }
      >
        {label}
      </Text>
      <View
        className={`h-[20px] w-[20px] items-center justify-center rounded-pill border-[1.5px] ${
          selected ? 'border-primary' : 'border-hairline-strong'
        }`}
      >
        {selected ? (
          <View className="h-[10px] w-[10px] rounded-pill bg-primary" />
        ) : null}
      </View>
    </Pressable>
  );
}

export function StayPriceSheet({
  selected,
  onSelect,
  onClose,
}: StayPriceSheetProps): ReactElement {
  return (
    <BottomSheet
      index={0}
      enablePanDownToClose
      onClose={onClose}
      backdropComponent={renderBackdrop}
    >
      <BottomSheetView
        testID="stay-price-sheet"
        className="w-full gap-md px-lg pb-2xl pt-sm"
      >
        <Text className="font-noto-bold text-section font-bold text-ink">
          가격대
        </Text>
        <View className="w-full gap-sm">
          {PRICE_BUCKETS.map((bucket) => (
            <PriceOption
              key={bucket.id}
              id={bucket.id}
              label={bucket.label}
              selected={bucket.id === selected}
              onSelect={onSelect}
            />
          ))}
        </View>
        <Pressable
          testID="stay-price-close"
          accessibilityRole="button"
          onPress={onClose}
          className="mt-xs h-[52px] w-full items-center justify-center rounded-button bg-primary"
        >
          <Text className="font-noto-bold text-card-title font-bold text-on-primary">
            적용
          </Text>
        </Pressable>
      </BottomSheetView>
    </BottomSheet>
  );
}
