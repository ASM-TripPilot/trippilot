/**
 * TRIP-1787 · g03 여행 설정 순수 뷰(Figma `5151:3550`) — props 만 받는다(조회·저장·라우터를 모른다). 프리뷰
 * (`app/_dev/preview.tsx`)가 네트워크 계층을 전이 로드하지 않고 이 파일만 문다.
 *
 * 고칠 수 있는 칸은 이름(입력)·기간·동행·일과 시간(눌러 시트)과 커버(오른쪽 아래 「커버 바꾸기」)다. 눌림은 콜백이 있을 때만
 * 열린다 — 기간은 `onPressPeriod` 가 없으면(시작됨·생성 중·끝남) chevron 도 눌림도 없고 보조문이 이유로 바뀐다(TRIP-1788).
 * 여행지는 보기만(1787 그대로). 「여행 삭제」는 카드 밖 뉴트럴 텍스트 버튼(Figma 값 #6a6a6a — primary 아님).
 *
 * ⚠️ 시트 열림·삭제 다이얼로그 딤·키보드·생김새는 jest 사각 — 프리뷰/6-b 몫.
 */
import { type ReactElement, type ReactNode } from 'react';
import {
  type ImageSourcePropType,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Button } from '@/shared/ui/Button';
import { SafeAreaView } from 'react-native-safe-area-context';

import { COLOR_TOKENS } from '@/shared/config';
import { PhotoGlyph } from '@/entities/itinerary-slot';
import { CoverLabel } from '@/entities/trip';
import { BackChevronGlyph, ChevronRight24Glyph } from '@/shared/ui/glyphs';
import { Image } from '@/shared/ui/Image';

export interface TripSettingsViewProps {
  title: string;
  /** 이름 위반(빈·120자 초과) 안내를 띄울지. */
  titleInvalid: boolean;
  /** 끝난 여행 — 이름 입력·동행·일과를 막고 이유 한 줄을 띄운다. */
  locked: boolean;
  companionLabel: string;
  partyLabel: string;
  /** `HH:mm ~ 21:00`. */
  dayRangeLabel: string;
  /** 정한 값이 있을 때만(없으면 줄 자체를 안 그린다). */
  dayFirstLabel?: string;
  dayEndLabel?: string;
  /** `6월 10일(수) – 13일(토)`. */
  periodLabel: string;
  /** `3박 4일`. */
  nightsLabel: string;
  /** 기간 행 보조문(열림이면 날짜만 옮긴다는 안내, 잠금이면 그 이유 — `periodHint`). */
  periodHint: string;
  /** 서버가 기간 변경을 거절한 사유 안내(없으면 줄 자체가 없다). */
  periodNotice?: string;
  /** 있으면 기간 행이 눌려 시트가 열린다(chevron). 없으면 보기 행. */
  onPressPeriod?: () => void;
  /** 있으면 커버 오른쪽 아래에 「커버 바꾸기」 버튼. 끝난 여행엔 안 넘긴다. */
  onPressCover?: () => void;
  destinationsLabel: string;
  /** 지역 커버 — 없으면 회색 자리. */
  cover: ImageSourcePropType | null;
  /** 첫 여행지와 다른 시도의 그림이면 그 이름(`tripCoverLabel`). 없으면 안 그린다. */
  coverLabel?: string | null;
  canSave: boolean;
  /** 저장 실패(5xx·네트워크) — 오류 줄 + 다시 시도. */
  saveFailed: boolean;
  /** 「여행 삭제」 노출(내 여행 목록 ⋯ 삭제와 같은 판정). */
  deletable: boolean;
  onBack: () => void;
  onChangeTitle: (next: string) => void;
  onPressCompanion: () => void;
  onPressDayWindow: () => void;
  onSave: () => void;
  onPressDelete: () => void;
}

/** 카드 그림자(Figma 0,2,10 · 6%) — className 으로 못 준다. */
const CARD_SHADOW = {
  shadowColor: COLOR_TOKENS.scrim,
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.06,
  shadowRadius: 10,
  elevation: 2,
} as const;

const LOCKED_NOTICE = '끝난 여행은 바꿀 수 없어요';

/** 앱바 — 얼굴(로딩·오류·없음)도 같은 줄을 쓴다. */
export function TripSettingsHeader({
  onBack,
}: {
  onBack: () => void;
}): ReactElement {
  return (
    <View className="h-[52px] flex-row items-center gap-[6px] px-lg">
      <Pressable
        testID="trip-settings-back"
        accessibilityRole="button"
        accessibilityLabel="뒤로"
        onPress={onBack}
      >
        <BackChevronGlyph />
      </Pressable>
      <Text className="font-noto-bold text-section font-bold text-ink">
        여행 설정
      </Text>
    </View>
  );
}

function Row({
  label,
  testID,
  onPress,
  chevronTestID,
  children,
}: {
  label: string;
  testID?: string;
  /** 있으면 눌러서 고치는 행(우측 chevron). 없으면 보기 행. */
  onPress?: () => void;
  chevronTestID?: string;
  children: ReactNode;
}): ReactElement {
  const body = (
    <View className="flex-row items-center gap-sm px-lg py-md">
      <View className="flex-1 gap-xs">
        <Text className="font-noto text-caption text-muted">{label}</Text>
        {children}
      </View>
      {onPress ? <ChevronRight24Glyph testID={chevronTestID} /> : null}
    </View>
  );
  return onPress ? (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
    >
      {body}
    </Pressable>
  ) : (
    <View testID={testID}>{body}</View>
  );
}

const VALUE = 'font-noto-bold text-card-title font-bold text-ink';
const DIVIDER = <View className="mx-lg h-px bg-hairline" />;

export function TripSettingsView({
  title,
  titleInvalid,
  locked,
  companionLabel,
  partyLabel,
  dayRangeLabel,
  dayFirstLabel,
  dayEndLabel,
  periodLabel,
  nightsLabel,
  periodHint,
  periodNotice,
  onPressPeriod,
  onPressCover,
  destinationsLabel,
  cover,
  coverLabel,
  canSave,
  saveFailed,
  deletable,
  onBack,
  onChangeTitle,
  onPressCompanion,
  onPressDayWindow,
  onSave,
  onPressDelete,
}: TripSettingsViewProps): ReactElement {
  return (
    <SafeAreaView
      testID="trip-settings-root"
      edges={['top', 'bottom']}
      className="flex-1 bg-canvas"
    >
      <TripSettingsHeader onBack={onBack} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1"
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerClassName="gap-lg px-lg pb-xl pt-sm"
        >
          {/* 커버 — 고른 그림 또는 첫 목적지 자동. 버튼은 그림 위(overflow 밖) 오른쪽 아래 */}
          <View testID="trip-settings-cover">
            <View className="h-[201px] overflow-hidden rounded-button bg-surface-strong">
              {cover ? (
                <Image
                  testID="trip-settings-cover-image"
                  source={cover}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                  className="h-[201px] w-full"
                />
              ) : null}
            </View>
            {/* 왼쪽 아래 — 오른쪽 아래 「커버 바꾸기」와 겹치지 않게 폭을 묶는다(넘치면 말줄임). */}
            <CoverLabel
              label={coverLabel}
              testID="trip-settings-cover-label"
              className="absolute bottom-md left-md max-w-[45%]"
            />
            {onPressCover ? (
              <Pressable
                testID="trip-settings-cover-change"
                accessibilityRole="button"
                onPress={onPressCover}
                style={CARD_SHADOW}
                className="absolute bottom-md right-md h-[36px] flex-row items-center gap-xs rounded-button bg-canvas px-md"
              >
                <PhotoGlyph size={16} />
                <Text className="font-noto-bold text-label font-bold text-ink">
                  커버 바꾸기
                </Text>
              </Pressable>
            ) : null}
          </View>

          {locked ? (
            <Text
              testID="trip-settings-locked"
              className="font-noto text-label text-muted"
            >
              {LOCKED_NOTICE}
            </Text>
          ) : null}

          <View
            style={CARD_SHADOW}
            className="rounded-button border border-hairline bg-canvas"
          >
            <Row label="여행 이름">
              <TextInput
                testID="trip-settings-title"
                value={title}
                onChangeText={onChangeTitle}
                editable={!locked}
                accessibilityLabel="여행 이름"
                placeholder="여행 이름"
                // maxLength 를 걸지 않는다 — 121자 안내를 띄울 수 없게 된다(서버 한도 UX 사본은 titleViolation).
                className={`p-0 ${VALUE}`}
              />
              {titleInvalid ? (
                <Text
                  testID="trip-settings-title-error"
                  className="font-noto text-caption text-primary-text"
                >
                  이름은 1~120자로 적어 주세요
                </Text>
              ) : null}
            </Row>
            {DIVIDER}
            <Row label="여행지" testID="trip-settings-destinations">
              <Text className={VALUE}>{destinationsLabel}</Text>
            </Row>
            {DIVIDER}
            <Row
              label="기간"
              testID="trip-settings-period"
              onPress={onPressPeriod}
              chevronTestID="trip-settings-period-chevron"
            >
              <View className="flex-row items-center gap-sm">
                <Text className={VALUE}>{periodLabel}</Text>
                <Text className="font-noto text-caption text-muted">
                  {nightsLabel}
                </Text>
              </View>
              <Text
                testID="trip-settings-period-hint"
                className="font-noto text-caption text-muted"
              >
                {periodHint}
              </Text>
              {periodNotice !== undefined ? (
                <Text
                  testID="trip-settings-period-notice"
                  className="font-noto text-caption text-primary-text"
                >
                  {periodNotice}
                </Text>
              ) : null}
            </Row>
            {DIVIDER}
            <Row
              label="동행"
              testID="trip-settings-companion"
              onPress={locked ? undefined : onPressCompanion}
            >
              <View className="flex-row items-center">
                <Text testID="trip-settings-companion-type" className={VALUE}>
                  {companionLabel}
                </Text>
                <Text className={VALUE}>{' · '}</Text>
                <Text testID="trip-settings-party" className={VALUE}>
                  {partyLabel}
                </Text>
              </View>
            </Row>
            {DIVIDER}
            <Row
              label="일과 시간"
              testID="trip-settings-day-start"
              onPress={locked ? undefined : onPressDayWindow}
            >
              <Text testID="trip-settings-day-start-value" className={VALUE}>
                {dayRangeLabel}
              </Text>
              {dayFirstLabel !== undefined ? (
                <Text
                  testID="trip-settings-day-first"
                  className="font-noto text-caption text-muted"
                >
                  {dayFirstLabel}
                </Text>
              ) : null}
              {dayEndLabel !== undefined ? (
                <Text
                  testID="trip-settings-day-end"
                  className="font-noto text-caption text-muted"
                >
                  {dayEndLabel}
                </Text>
              ) : null}
            </Row>
          </View>

          {deletable ? (
            <Pressable
              testID="trip-settings-delete"
              accessibilityRole="button"
              onPress={onPressDelete}
              className="h-[48px] items-center justify-center"
            >
              <Text className="font-noto-bold text-card-title font-bold text-muted">
                여행 삭제
              </Text>
            </Pressable>
          ) : null}
        </ScrollView>

        <View className="gap-sm px-lg pb-lg pt-sm">
          {saveFailed ? (
            <View className="flex-row items-center justify-between">
              <Text
                testID="trip-settings-error"
                className="flex-1 font-noto text-caption text-primary-text"
              >
                저장하지 못했어요. 다시 시도해 주세요.
              </Text>
              <Pressable
                testID="trip-settings-retry"
                accessibilityRole="button"
                onPress={onSave}
              >
                <Text className="font-noto-bold text-label font-bold text-primary-text">
                  다시 시도
                </Text>
              </Pressable>
            </View>
          ) : null}
          <Button
            testID="trip-settings-save"
            disabled={!canSave}
            onPress={onSave}
          >
            저장
          </Button>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
