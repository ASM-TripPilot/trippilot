import { type ComponentProps, type ReactElement, type ReactNode } from 'react';
import { Keyboard, Pressable, Text, View } from 'react-native';
import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetView,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';

import { SHEET_HANDLE_INDICATOR_STYLE } from '@/shared/lib/sheetHandle';

// 편집/선택 바텀시트의 공용 틀(TRIP-1360) — 개폐 틀(index 0 · 아래로 닫기 · 딤) + 본문 컨테이너 + 머리글 + 적용 버튼.
// ⚠️ gorhom 통과형 목은 어떤 prop 을 줘도 children 을 그린다 — 이 틀이 prop 을 떨어뜨려도 jest 는 green 이다.
// 실제 개폐·딤·키보드 올림/내림은 6-b 실기가 유일한 그물이다(repo-traps 바텀시트 절). 소비처가 handle·keyboard·
// dismissKeyboardOnBodyTap 을 **명시적으로** 넘기고, 기본값에 기대어 값이 뭉개지지 않게 한다.

export interface SheetApply {
  testID: string;
  onPress: () => void;
  /** 넘기면 진짜 `disabled` + `opacity-40`. 안 넘기면 항상 활성. */
  disabled?: boolean;
}

export interface SheetShellProps {
  testID: string;
  onClose: () => void;
  children: ReactNode;
  title?: string;
  /** 있으면 제목과 함께 `gap-xs` 머리글 블록으로 묶는다. */
  subtitle?: string;
  /** lg = 20px(편집 시트), section = 17px 류(필터·가격 시트). */
  titleSize?: 'lg' | 'section';
  /** 본문 컨테이너 className — 기본은 g01/g02 편집 시트 값. */
  contentClassName?: string;
  /** indicator = 연회색 통일 핸들(TRIP-735), default = gorhom 기본 핸들. */
  handle?: 'indicator' | 'default';
  backgroundStyle?: ComponentBackgroundStyle;
  /** 딤 농도 — default = 라이브러리 기본(0.5), strong = 0.55. */
  backdrop?: 'default' | 'strong';
  /** interactive = 키보드가 시트를 밀어 올린다(입력칸이 있는 시트). */
  keyboard?: 'none' | 'interactive';
  /** 본문 빈 곳 탭 = 키보드 내림(입력칸이 있는 시트). */
  dismissKeyboardOnBodyTap?: boolean;
  apply?: SheetApply;
}

type ComponentBackgroundStyle = ComponentProps<
  typeof BottomSheet
>['backgroundStyle'];

const TITLE_CLASS = {
  lg: 'text-[20px] font-noto-bold font-bold text-ink',
  section: 'font-noto-bold text-section font-bold text-ink',
} as const;

/** 딤(backdrop) — 리포 표준 idiom. */
function renderBackdrop(props: BottomSheetBackdropProps): ReactElement {
  return (
    <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} />
  );
}

/** 딤을 더 진하게(0.55) — 외부 이동 확인 시트가 쓴다. */
function renderStrongBackdrop(props: BottomSheetBackdropProps): ReactElement {
  return (
    <BottomSheetBackdrop
      {...props}
      appearsOnIndex={0}
      disappearsOnIndex={-1}
      opacity={0.55}
    />
  );
}

export function SheetShell({
  testID,
  onClose,
  children,
  title,
  subtitle,
  titleSize = 'lg',
  contentClassName = 'gap-lg px-xl pb-[34px] pt-[10px]',
  handle = 'indicator',
  backgroundStyle,
  backdrop = 'default',
  keyboard = 'none',
  dismissKeyboardOnBodyTap = false,
  apply,
}: SheetShellProps): ReactElement {
  const titleNode =
    title === undefined ? null : (
      <Text className={TITLE_CLASS[titleSize]}>{title}</Text>
    );
  const body = (
    <>
      {subtitle === undefined ? (
        titleNode
      ) : (
        <View className="gap-xs">
          {titleNode}
          <Text className="font-noto text-label text-muted">{subtitle}</Text>
        </View>
      )}
      {children}
      {apply === undefined ? null : (
        <Pressable
          testID={apply.testID}
          accessibilityRole="button"
          disabled={apply.disabled}
          onPress={apply.onPress}
          className={`h-[52px] items-center justify-center rounded-button bg-primary ${
            apply.disabled ? 'opacity-40' : ''
          }`}
        >
          <Text className="text-[16px] font-noto-bold font-bold text-on-primary">
            적용
          </Text>
        </Pressable>
      )}
    </>
  );

  return (
    <BottomSheet
      index={0}
      enablePanDownToClose
      onClose={onClose}
      backdropComponent={
        backdrop === 'strong' ? renderStrongBackdrop : renderBackdrop
      }
      handleIndicatorStyle={
        handle === 'indicator' ? SHEET_HANDLE_INDICATOR_STYLE : undefined
      }
      backgroundStyle={backgroundStyle}
      keyboardBehavior={keyboard === 'interactive' ? 'interactive' : undefined}
    >
      {dismissKeyboardOnBodyTap ? (
        <BottomSheetView testID={testID}>
          <Pressable
            accessible={false}
            onPress={Keyboard.dismiss}
            className={contentClassName}
          >
            {body}
          </Pressable>
        </BottomSheetView>
      ) : (
        <BottomSheetView testID={testID} className={contentClassName}>
          {body}
        </BottomSheetView>
      )}
    </BottomSheet>
  );
}
