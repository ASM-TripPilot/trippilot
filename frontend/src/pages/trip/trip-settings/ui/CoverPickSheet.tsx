import { useContext, useState, type ReactElement } from 'react';
import { Pressable, Text, View, type ImageSourcePropType } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetFlatList,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';

import { coverChoices, coverSourceForKey } from '@/entities/trip';
import { SHEET_HANDLE_INDICATOR_STYLE } from '@/shared/lib/sheetHandle';
import { CloseGlyph } from '@/shared/ui/glyphs';
import { Image } from '@/shared/ui/Image';

const SNAP_POINTS = ['88%'];
/** 격자 줄 사이·칸 사이 간격(`gap-md`). 라이브러리 FlatList 래퍼는 `columnWrapperClassName` 을 못 받아 숫자로 준다. */
const ROW_STYLE = { gap: 12, paddingBottom: 12 };
/** 처음 그리는 줄 수 — 첫 화면(약 5줄)을 빈 칸 없이 채운다. 줄당 2칸이다. */
const INITIAL_ROWS = 6;
/** 보이는 화면 + 위아래 한 화면씩(사용자 결정 2026-11-06). 기본값 21 이면 사실상 전부 마운트라 메모리가 안 준다. */
const WINDOW_SCREENS = 3;

/**
 * TRIP-1788 · 커버 고르기 시트 — 첫 칸 「첫 여행지 그림」(`null` = 자동) + 앱에 든 지역 그림 전부를 2열로 보여 주고, [적용]에서만
 * 고른 값을 올린다(위저드 시트와 같은 약속: 닫으면 버림). Figma 프레임 없음 — 기존 어휘.
 *
 * - **드래프트는 시트 안 `useState`** 다. 페이지가 열 때만 마운트하므로(조건부 렌더) 열 때마다 서버 값으로 새로 시작한다.
 * - `picked` 가 `undefined` 면 "아직 안 골랐다" — [적용]은 아무것도 올리지 않는다. 앱이 모르는 서버 키를 그냥 [적용]해도
 *   그 키가 지워지지 않게 하려는 것이다(`null` 은 사용자가 첫 칸을 직접 누른 선택).
 * - 그림 키·이름표는 `@/entities/trip` 의 `coverChoices`·`coverSourceForKey` 로만 읽는다(번들→CDN 이전 때 그 둘만 바뀐다).
 * - **구조: 머리줄 · 스크롤 격자 · [적용] 세 덩이를 고정 높이(`SNAP_POINTS`) 시트에 세로로 쌓는다.** 격자만
 *   `BottomSheetFlatList` 안에서 스크롤하고 머리줄·[적용]은 그 밖이라 늘 보인다(안에 두면 맨 위 그림을 고른 뒤 수십 줄을
 *   내려가야 적용할 수 있었다). 높이를 고정하려고 `enableDynamicSizing={false}` 다 — 켜 두면 시트가 내용 높이를 따라가
 *   스크롤 영역의 높이가 정해지지 않는다.
 * - **격자는 가상화다(TRIP-1805)** — 그림이 107장이라 전부 마운트하면 시트를 여는 순간 메모리가 튄다(46장에 +180MB 측정).
 *   보이는 화면과 위아래 한 화면씩만 그린다(`WINDOW_SCREENS`). 화면 밖 칸은 마운트돼 있지 않으니 jest 에서도 스크롤해야 나온다.
 *   단 처음 그린 줄(`INITIAL_ROWS`)은 RN 이 내리지 않는다 — 늘리면 그만큼 시트가 닫힐 때까지 메모리에 남는다.
 * - **그림은 `cachePolicy="none"` 이다** — 가상화만으로는 부족하다. `memory-disk` 는 칸이 사라져도 그림을 쥐고 있어 끝까지 내리면
 *   +197MB 까지 늘고 시트를 닫아도 안 줄었다(`footprint` 측정, 칸 0개인데 510MB). `none` 은 같은 스크롤에 +48~79MB 이고 빠른 스크롤
 *   프레임에 빈 칸이 없었다. 시뮬 개발 번들 측정이다 — 운영 번들·저사양 기기·시트 재오픈은 재지 않았다.
 *   서버/CDN 으로 옮기면 다시 정한다(칸이 다시 그려질 때마다 재다운로드가 된다).
 *
 * - **딤 탭은 시트가 다 올라온 뒤에만 닫는다.** 「커버 바꾸기」 연타의 둘째 탭이 올라오는 중인 딤에 떨어져 시트가 바로 닫혔다(통합 QA D7 —
 *   실기 로그로 확인, 첫 렌더 뒤 약 380ms). 46장을 그리느라 늦어 누름 가드 창(400ms)으로는 경계라 도착(`onChange`)을 기준으로 본다.
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
  const [arrived, setArrived] = useState(false);
  const cells: CoverCell[] = [
    { id: 'auto', value: null, label: '첫 여행지 그림', source: autoSource },
    ...coverChoices().map(({ key, label }) => ({
      id: key,
      value: key,
      label,
      source: coverSourceForKey(key),
    })),
  ];
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
      onChange={(index) => {
        if (index >= 0) setArrived(true);
      }}
      onClose={onClose}
      handleIndicatorStyle={SHEET_HANDLE_INDICATOR_STYLE}
      backdropComponent={arrived ? renderBackdrop : renderOpeningBackdrop}
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
      <BottomSheetFlatList
        testID="trip-settings-cover-sheet"
        className="flex-1"
        contentContainerClassName="w-full px-lg pb-lg"
        data={cells}
        keyExtractor={(cell: CoverCell) => cell.id}
        numColumns={2}
        columnWrapperStyle={ROW_STYLE}
        initialNumToRender={INITIAL_ROWS}
        windowSize={WINDOW_SCREENS}
        renderItem={({ item }: { item: CoverCell }) => (
          <Option
            testID={`trip-settings-cover-option-${item.id}`}
            label={item.label}
            source={item.source}
            selected={current === item.value}
            onPress={() => setPicked(item.value)}
          />
        )}
      />
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

/** 올라오는 동안의 딤 — 탭해도 안 닫힌다(`pressBehavior="none"` 이면 라이브러리가 탭 제스처를 달지 않는다). */
function renderOpeningBackdrop(props: BottomSheetBackdropProps): ReactElement {
  return (
    <BottomSheetBackdrop
      {...props}
      appearsOnIndex={0}
      disappearsOnIndex={-1}
      pressBehavior="none"
    />
  );
}

/** 격자 칸 하나의 값. `value` 가 null 이면 첫 칸(자동)이다. */
type CoverCell = {
  id: string;
  value: string | null;
  label: string;
  source?: ImageSourcePropType | null;
};

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
            cachePolicy="none"
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
