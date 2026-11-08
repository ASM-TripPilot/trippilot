import { type ReactElement, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';

import { Button } from '@/shared/ui/Button';

// 확인/삭제류 오버레이 다이얼로그 1벌 + 래퍼 11개의 공용 틀(TRIP-1359).
// **조건부 렌더 absolute 오버레이**다 — RN Modal·백드롭 탭 닫기·애니메이션을 넣지 않는다(repo-traps 바텀시트·
// 오버레이 절). 딤 실제 덮임·중앙 정렬·터치 차단은 jest 원리적 사각이라 6-b 실기가 유일한 그물이고,
// 확정 재누름은 **래퍼/페이지의 잠금 ref(lockedRef·inFlightRef·deletingRef·pending)** 가 막는다 — 잠금은 해제
// 시점이 페이지마다 달라 이 틀로 옮기지 않는다. 값은 래퍼가 prop 으로 넘긴다(드리프트를 한 벌로 뭉개지 않는다).

type ConfirmTone =
  'primary' | 'primaryOn' | 'ink' | 'outline' | 'outlineBody' | 'text';

type ConfirmButton = {
  testID: string;
  label: string;
  onPress: () => void;
  tone: ConfirmTone;
  disabled?: boolean;
};

export type ConfirmDialogProps = {
  testID?: string;
  cardTestID?: string;
  title: string;
  /** 제목·본문 글자를 testID 로 관측하고 싶은 래퍼만 준다(없으면 testID 없음 — 기존 래퍼 불변). */
  titleTestID?: string;
  description?: string;
  descriptionTestID?: string;
  /** tight = `mt-sm`, loose = `mt-[10px] leading-[21px]` */
  descriptionSpacing?: 'tight' | 'loose';
  /** iOS 어절 단위 줄바꿈('요.' 한 글자 고아 줄 방지) — 기본으로 켠다(TRIP-1434 — 끄려면 false). */
  hangulBreak?: boolean;
  /** 제목·본문 아래, 실패 문구 위(목록 ScrollView 등). */
  children?: ReactNode;
  errorText?: string;
  errorTestID?: string;
  buttons: ConfirmButton[];
  /** 기본: 버튼 3개 이상이면 column, 아니면 row. */
  layout?: 'row' | 'column';
  /** lg = Button lg(52), md·sm = Button md(48) — 옛 md 44 는 TRIP-1828 에서 48 로 모였다. */
  size?: 'lg' | 'md' | 'sm';
  /** default = 0,8,24 · 12%, soft = 0,8,14 · 20%, none = 그림자 없음 */
  shadow?: 'default' | 'soft' | 'none';
  cardPaddingClassName?: string;
  buttonsTopClassName?: string;
};

const SHADOWS = {
  default: {
    shadowColor: 'black',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 24,
    elevation: 8,
  },
  soft: {
    shadowColor: 'black',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 14,
    elevation: 8,
  },
} as const;

// 블록 버튼 모양은 공용 Button 이 정한다(TRIP-1828) — md(44)·sm(48)은 둘 다 Button md(48)로, outlineBody 글자는 ink 로 모인다.
const TONE_VARIANT = {
  primary: 'primary',
  primaryOn: 'primary',
  ink: 'ink',
  outline: 'secondary',
  outlineBody: 'secondary',
} as const;

function DialogButton({
  button,
  size,
  column,
}: {
  button: ConfirmButton;
  size: 'lg' | 'md' | 'sm';
  column: boolean;
}): ReactElement {
  const { testID, label, onPress, tone, disabled } = button;
  if (tone === 'text') {
    return (
      <Pressable
        testID={testID}
        accessibilityRole="button"
        disabled={disabled}
        onPress={onPress}
        className="items-center justify-center py-[10px]"
      >
        <Text className="text-[13.5px] font-noto-bold font-bold text-muted">
          {label}
        </Text>
      </Pressable>
    );
  }
  return (
    <Button
      testID={testID}
      variant={TONE_VARIANT[tone]}
      size={size === 'lg' ? 'lg' : 'md'}
      disabled={disabled}
      onPress={onPress}
      className={column ? 'w-full' : 'flex-1'}
    >
      {label}
    </Button>
  );
}

export function ConfirmDialog({
  testID,
  cardTestID,
  title,
  titleTestID,
  description,
  descriptionTestID,
  descriptionSpacing = 'tight',
  hangulBreak = true,
  children,
  errorText,
  errorTestID,
  buttons,
  layout,
  size = 'lg',
  shadow = 'default',
  cardPaddingClassName = 'p-2xl',
  buttonsTopClassName = 'mt-xl',
}: ConfirmDialogProps): ReactElement {
  const column =
    (layout ?? (buttons.length >= 3 ? 'column' : 'row')) === 'column';
  return (
    <View
      testID={testID}
      className="absolute inset-0 items-center justify-center bg-scrim/55 px-2xl"
    >
      <View
        testID={cardTestID}
        style={shadow === 'none' ? undefined : SHADOWS[shadow]}
        className={`w-[330px] rounded-[20px] bg-canvas ${cardPaddingClassName}`}
      >
        <Text
          testID={titleTestID}
          className="font-noto-bold text-[19px] text-ink"
        >
          {title}
        </Text>
        {description === undefined ? null : (
          <Text
            testID={descriptionTestID}
            lineBreakStrategyIOS={hangulBreak ? 'hangul-word' : undefined}
            className={`font-noto text-body text-body ${
              descriptionSpacing === 'loose'
                ? 'mt-[10px] leading-[21px]'
                : 'mt-sm'
            }`}
          >
            {description}
          </Text>
        )}
        {children}
        {errorText ? (
          <Text
            testID={errorTestID}
            className="mt-sm font-noto text-label text-primary-text"
          >
            {errorText}
          </Text>
        ) : null}

        <View
          className={`${buttonsTopClassName} ${column ? '' : 'flex-row '}gap-[10px]`}
        >
          {buttons.map((b) => (
            <DialogButton
              key={b.testID}
              button={b}
              size={size}
              column={column}
            />
          ))}
        </View>
      </View>
    </View>
  );
}
