import { useContext, type ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import BottomSheet, { BottomSheetView } from '@gorhom/bottom-sheet';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';

import type { MyTripsSortKey } from '../model/myTripsOrder';

import { SortCheckGlyph } from '@/features/itinerary/index.view';

/**
 * TRIP-1122 · h06 정렬 시트(Figma 4750:2946) — 완전 제어(선택·열림은 페이지가 쥔다, StayPriceSheet 선례).
 * 옵션 탭 = `onSelect` 1회(닫기는 페이지 몫), 스크림 탭·끌어내리기 = `onClose`. 적용 버튼·✕ 없음.
 * 배선은 같은 feature 의 `SlotCandidateSheet` 를 따른다(기본 핸들 끔 + 토큰 grabber + 커스텀 스크림).
 * 실제 열림·딤 덮임·끌기 제스처는 gorhom 목이 통과형이라 jest 사각(6-b 실기).
 */

const TITLE = '정렬';

const OPTIONS: readonly {
  key: MyTripsSortKey;
  label: string;
  hint?: string;
}[] = [
  { key: 'recent', label: '최신순', hint: '최근에 고친 여행부터' },
  { key: 'start', label: '출발일순', hint: '가까운 출발일부터' },
  { key: 'title', label: '이름순', hint: '가나다순으로' },
];

export interface MyTripsSortSheetProps {
  selected: MyTripsSortKey;
  onSelect: (key: MyTripsSortKey) => void;
  onClose: () => void;
}

export function MyTripsSortSheet({
  selected,
  onSelect,
  onClose,
}: MyTripsSortSheetProps): ReactElement {
  // 시트가 열리면 탭바가 숨어(TRIP-1240) 홈 인디케이터만 남는다 — 마지막 옵션이 화면 가장자리에 붙지 않게 하단 안전영역을
  // 본문 아래 여백에 더한다(TRIP-1436 Q-131). Provider 없으면 0(MapSheetShell 선례).
  const bottomInset = useContext(SafeAreaInsetsContext)?.bottom ?? 0;
  return (
    <BottomSheet
      index={0}
      enablePanDownToClose
      onClose={onClose}
      handleComponent={null}
      backdropComponent={() => (
        // 통과형 목에서도 onPress 가 발화하도록 라이브러리 backdrop 대신 커스텀 Pressable(SlotCandidateSheet 선례).
        <Pressable
          testID="my-trips-sort-scrim"
          accessibilityRole="button"
          accessibilityLabel="닫기"
          onPress={onClose}
          className="absolute inset-0 bg-scrim/40"
        />
      )}
    >
      <BottomSheetView
        testID="my-trips-sort-sheet"
        style={{ paddingBottom: 24 + bottomInset }}
        className="gap-lg rounded-sheet-top px-lg pt-md"
      >
        {/* grabber — Figma 는 40×5 r2.5 지만 킷·리포 선례(40×4 pill)를 따른다. */}
        <View className="h-[4px] w-[40px] self-center rounded-pill bg-hairline-strong" />

        <Text className="font-noto-bold text-section font-bold text-ink">
          {TITLE}
        </Text>

        <View>
          {OPTIONS.map(({ key, label, hint }) => {
            const isSelected = key === selected;
            return (
              <Pressable
                key={key}
                testID={`my-trips-sort-option-${key}`}
                accessibilityRole="radio"
                accessibilityState={{ selected: isSelected }}
                onPress={() => onSelect(key)}
                className="h-[56px] w-full flex-row items-center justify-between"
              >
                <View className="gap-xs">
                  <Text
                    className={
                      isSelected
                        ? 'font-noto-bold text-body font-bold text-primary'
                        : 'font-noto text-body text-body'
                    }
                  >
                    {label}
                  </Text>
                  {hint ? (
                    <Text className="font-noto text-caption text-muted">
                      {hint}
                    </Text>
                  ) : null}
                </View>
                {isSelected ? (
                  <SortCheckGlyph testID={`my-trips-sort-check-${key}`} />
                ) : null}
              </Pressable>
            );
          })}
        </View>
      </BottomSheetView>
    </BottomSheet>
  );
}
