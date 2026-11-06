import { useContext, useState, type ReactElement } from 'react';
import { Pressable, Text, View, type ImageSourcePropType } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetScrollView,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';

import { coverChoices, coverSourceForKey } from '@/entities/trip';
import { SHEET_HANDLE_INDICATOR_STYLE } from '@/shared/lib/sheetHandle';
import { CloseGlyph } from '@/shared/ui/glyphs';
import { Image } from '@/shared/ui/Image';

const SNAP_POINTS = ['88%'];

/**
 * TRIP-1788 · 커버 고르기 시트 — 첫 칸 「첫 여행지 그림」(`null` = 자동) + 앱에 든 지역 그림 전부를 2열로 보여 주고, [적용]에서만
 * 고른 값을 올린다(위저드 시트와 같은 약속: 닫으면 버림). Figma 프레임 없음 — 기존 어휘.
 *
 * - **드래프트는 시트 안 `useState`** 다. 페이지가 열 때만 마운트하므로(조건부 렌더) 열 때마다 서버 값으로 새로 시작한다.
 * - `picked` 가 `undefined` 면 "아직 안 골랐다" — [적용]은 아무것도 올리지 않는다. 앱이 모르는 서버 키를 그냥 [적용]해도
 *   그 키가 지워지지 않게 하려는 것이다(`null` 은 사용자가 첫 칸을 직접 누른 선택).
 * - 그림 키·이름표는 `@/entities/trip` 의 `coverChoices`·`coverSourceForKey` 로만 읽는다(번들→CDN 이전 때 그 둘만 바뀐다).
 * - **구조: 머리줄 · 스크롤 격자 · [적용] 세 덩이를 고정 높이(`SNAP_POINTS`) 시트에 세로로 쌓는다.** 격자(지금 46장)만
 *   `BottomSheetScrollView` 안에서 스크롤하고 머리줄·[적용]은 그 밖이라 늘 보인다(안에 두면 맨 위 그림을 고른 뒤 약 24줄을
 *   내려가야 적용할 수 있었다). 높이를 고정하려고 `enableDynamicSizing={false}` 다 — 켜 두면 시트가 내용 높이를 따라가
 *   스크롤 영역의 높이가 정해지지 않는다. 격자는 전부 마운트한다 —
 *   // ponytail: 썸네일이 늘어 메모리가 부담되면 BottomSheetFlatList 로 가상화(그때 jest 는 앞 10개만 마운트한다).
 *
 * ⚠️ 시트 실제 열림·딤·스크롤 중첩 제스처·격자 생김새·[적용] 고정은 jest 사각(통과형 목) — 6-b.
 */
export function CoverPickSheet({
  value,
  autoSource,
  onApply,
  onClose,
}: {
  /** 지금 화면의 커버 키(서버 값 또는 방금 [적용]한 값). null·없음·모르는 키는 첫 칸이 선택돼 보인다. */
  value: string | null | undefined;
  /** 첫 칸 「첫 여행지 그림」에 그릴 그림. 없으면(`null`·생략) 회색 칸. */
  autoSource?: ImageSourcePropType | null;
  /** 고른 키(`null` = 첫 칸). 아무것도 안 골랐으면 `undefined`. */
  onApply: (picked: string | null | undefined) => void;
  onClose: () => void;
}): ReactElement {
  const [picked, setPicked] = useState<string | null | undefined>(undefined);
  // 시트 윗변이 상태바 아래에서 멈추게 한다(ReplanRequestSheet 선례). Provider 가 없으면(jest) 0.
  const topInset = useContext(SafeAreaInsetsContext)?.top ?? 0;
  const choices = coverChoices();
  const current =
    picked !== undefined
      ? picked
      : value && coverSourceForKey(value) !== null
        ? value
        : null;

  return (
    <BottomSheet
      accessible={false}
      snapPoints={SNAP_POINTS}
      enableDynamicSizing={false}
      enablePanDownToClose
      topInset={topInset}
      onClose={onClose}
      handleIndicatorStyle={SHEET_HANDLE_INDICATOR_STYLE}
      backdropComponent={renderBackdrop}
    >
      <View className="w-full flex-row items-center justify-between px-lg pb-lg pt-sm">
        <Text className="font-noto-bold text-[20px] font-bold text-ink">
          커버 고르기
        </Text>
        <Pressable
          testID="trip-settings-cover-close"
          accessibilityRole="button"
          accessibilityLabel="닫기"
          onPress={onClose}
          hitSlop={8}
        >
          <CloseGlyph color="ink" size={20} />
        </Pressable>
      </View>
      <BottomSheetScrollView
        testID="trip-settings-cover-sheet"
        className="flex-1"
        contentContainerClassName="w-full px-lg pb-lg"
      >
        <View className="flex-row flex-wrap gap-md">
          <Option
            testID="trip-settings-cover-option-auto"
            label="첫 여행지 그림"
            source={autoSource}
            selected={current === null}
            onPress={() => setPicked(null)}
          />
          {choices.map(({ key, label }) => (
            <Option
              key={key}
              testID={`trip-settings-cover-option-${key}`}
              label={label}
              source={coverSourceForKey(key)}
              selected={current === key}
              onPress={() => setPicked(key)}
            />
          ))}
        </View>
      </BottomSheetScrollView>
      <View className="w-full px-lg pb-[34px] pt-md">
        <Pressable
          testID="trip-settings-cover-apply"
          accessibilityRole="button"
          onPress={() => onApply(picked)}
          className="h-[52px] items-center justify-center rounded-button bg-primary"
        >
          <Text className="text-[16px] font-noto-bold font-bold text-on-primary">
            적용
          </Text>
        </Pressable>
      </View>
    </BottomSheet>
  );
}

function renderBackdrop(props: BottomSheetBackdropProps): ReactElement {
  return (
    <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} />
  );
}

/** 칸 하나 — 선택 표시는 색이 아니라 `accessibilityState.selected`(+ 테두리)로 관찰한다. */
function Option({
  testID,
  label,
  source,
  selected,
  onPress,
}: {
  testID: string;
  label: string;
  source?: ImageSourcePropType | null;
  selected: boolean;
  onPress: () => void;
}): ReactElement {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      className={`w-[47%] gap-xs rounded-button border p-xs ${
        selected ? 'border-primary' : 'border-hairline'
      }`}
    >
      <View className="h-[84px] items-center justify-center overflow-hidden rounded-[8px] bg-surface-strong">
        {source ? (
          <Image
            source={source}
            contentFit="cover"
            cachePolicy="memory-disk"
            className="h-[84px] w-full"
          />
        ) : null}
      </View>
      <Text numberOfLines={1} className="font-noto text-caption text-body">
        {label}
      </Text>
    </Pressable>
  );
}
