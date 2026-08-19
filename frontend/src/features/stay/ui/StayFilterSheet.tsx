import type { ReactElement } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetView,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';

import type { StayFilterOption } from '../model/stayFilterOptions';

/**
 * e02 필터 시트(TRIP-415) — 편의시설·숙소유형 다중 선택.
 *
 * **완전 제어 컴포넌트다** — 선택 초안 상태를 자기 안에 두지 않는다(features/stay/ui 는 구조
 * 가드가 `useState` 를 0건 강제한다, `staySearchStructure.test.ts`). 초안 상태·적용은 페이지가
 * 지고, 여기선 옵션을 그리고 토글·적용·닫기 이벤트만 위로 넘긴다(순수 화면 규약).
 *
 * ponytail: 옵션 라벨은 서버 코드(`ocean`·`HOTEL` 등)를 그대로 쓴다 — 계약에 amenity/stayType
 * 표시명 사전이 없어 값을 창작하지 않는 정직한 폴백이다(`filterReasonLabel` 의 "모르는 축은
 * 코드 그대로"와 동형). 코드→한글 라벨 사전은 서버가 표시명을 줄 때 별도 티켓 몫.
 */

const SHEET_TITLE = '필터';
const AMENITY_LABEL = '편의시설';
const STAY_TYPE_LABEL = '숙소 유형';
const APPLY_LABEL = '적용';
const CLOSE_LABEL = '닫기';
const EMPTY_LABEL = '이 결과에는 걸 수 있는 필터가 없어요';

export interface StayFilterSheetProps {
  amenities: StayFilterOption[];
  stayTypes: StayFilterOption[];
  onToggleAmenity: (value: string) => void;
  onToggleStayType: (value: string) => void;
  onApply: () => void;
  onClose: () => void;
}

function renderBackdrop(props: BottomSheetBackdropProps): ReactElement {
  return (
    <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} />
  );
}

/** 값 하나 = 누를 수 있는 토글 칩. 선택되면 accessibilityState.selected 로 표시. */
function FilterToggle({
  testID,
  label,
  selected,
  onPress,
}: {
  testID: string;
  label: string;
  selected: boolean;
  onPress: () => void;
}): ReactElement {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      className={`rounded-pill border px-md py-sm ${
        selected
          ? 'border-primary bg-primary-pale'
          : 'border-hairline-strong bg-canvas'
      }`}
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
    </Pressable>
  );
}

function FilterGroup({
  title,
  axis,
  options,
  onToggle,
}: {
  title: string;
  axis: 'amenity' | 'staytype';
  options: StayFilterOption[];
  onToggle: (value: string) => void;
}): ReactElement | null {
  if (options.length === 0) return null;
  return (
    <View className="w-full gap-sm">
      <Text className="font-noto-bold text-body font-bold text-ink">
        {title}
      </Text>
      <View className="w-full flex-row flex-wrap gap-sm">
        {options.map((opt) => (
          <FilterToggle
            key={opt.value}
            testID={`stay-filter-${axis}-${opt.value}`}
            label={opt.value}
            selected={opt.selected}
            onPress={() => onToggle(opt.value)}
          />
        ))}
      </View>
    </View>
  );
}

export function StayFilterSheet({
  amenities,
  stayTypes,
  onToggleAmenity,
  onToggleStayType,
  onApply,
  onClose,
}: StayFilterSheetProps): ReactElement {
  const isEmpty = amenities.length === 0 && stayTypes.length === 0;

  return (
    <BottomSheet
      index={0}
      enablePanDownToClose
      onClose={onClose}
      backdropComponent={renderBackdrop}
    >
      <BottomSheetView
        testID="stay-filter-sheet"
        className="w-full gap-lg px-lg pb-2xl pt-sm"
      >
        <Text className="font-noto-bold text-section font-bold text-ink">
          {SHEET_TITLE}
        </Text>

        {isEmpty ? (
          <Text className="font-noto text-body text-muted">{EMPTY_LABEL}</Text>
        ) : (
          <ScrollView className="max-h-[360px]" showsVerticalScrollIndicator>
            <View className="w-full gap-lg">
              <FilterGroup
                title={AMENITY_LABEL}
                axis="amenity"
                options={amenities}
                onToggle={onToggleAmenity}
              />
              <FilterGroup
                title={STAY_TYPE_LABEL}
                axis="staytype"
                options={stayTypes}
                onToggle={onToggleStayType}
              />
            </View>
          </ScrollView>
        )}

        <View className="w-full flex-row gap-sm">
          <Pressable
            testID="stay-filter-close"
            accessibilityRole="button"
            onPress={onClose}
            className="flex-1 items-center justify-center rounded-button border border-hairline-strong bg-canvas py-md"
          >
            <Text className="font-noto-bold text-body font-bold text-ink">
              {CLOSE_LABEL}
            </Text>
          </Pressable>
          <Pressable
            testID="stay-filter-apply"
            accessibilityRole="button"
            onPress={onApply}
            className="flex-1 items-center justify-center rounded-button bg-primary py-md"
          >
            <Text className="font-noto-bold text-body font-bold text-on-primary">
              {APPLY_LABEL}
            </Text>
          </Pressable>
        </View>
      </BottomSheetView>
    </BottomSheet>
  );
}
