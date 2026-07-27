/**
 * c07-nickname 프레젠테이션 (US-ONB-03 · AC B3~B7 · Figma 1295:1208 정합 TRIP-162).
 * props 만 받고 네트워크를 모른다. 판정(중복·금칙어)은 서버가 하고 이 화면은 표시만 한다.
 */
import type { ReactElement } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  BackChevronGlyph,
  PositiveCheckGlyph,
  RegenerateGlyph,
} from './OnboardingGlyphs';

/**
 * 오류 사유. TOO_SHORT/TOO_LONG 은 클라 형식 검증(UX 사본)에서,
 * TAKEN/BANNED_WORD 는 **서버 응답**에서만 온다 — 클라가 스스로 만들지 않는다.
 */
export type NicknameErrorReason =
  'TOO_SHORT' | 'TOO_LONG' | 'TAKEN' | 'BANNED_WORD' | 'SAVE_FAILED';

export interface NicknameScreenProps {
  value: string;
  canProceed: boolean;
  errorReason: NicknameErrorReason | null;
  /** B5·B6 — 서버가 준 대체 후보. 빈 배열이면 칩을 그리지 않는다. */
  suggestions: string[];
  onChange: (next: string) => void;
  onRegenerate: () => void;
  onSelectSuggestion: (value: string) => void;
  onNext: () => void;
  /**
   * 서버 근거(자동생성 프리필·추천칩 선택·서버 check 통과 값)가 입력창에 그대로 있는 동안만
   * true — 긍정 메시지 표시 스위치. **판정은 컨테이너 몫**("현재 값 === 서버가 준/검증한 값"
   * 파생, US-ONB-03 서버 권한) — 이 화면은 표시만 한다. 기본 미표시, 오류가 있으면 오류 우선.
   */
  availabilityConfirmed?: boolean;
}

const ERROR_MESSAGES: Record<NicknameErrorReason, string> = {
  TOO_SHORT: '닉네임은 2자 이상이어야 해요',
  TOO_LONG: '닉네임은 20자까지 쓸 수 있어요',
  TAKEN: '이미 사용 중인 닉네임이에요',
  BANNED_WORD: '사용할 수 없는 닉네임이에요',
  SAVE_FAILED: '저장에 실패했어요. 다시 시도해 주세요',
};

export function NicknameScreen({
  value,
  canProceed,
  errorReason,
  suggestions,
  onChange,
  onRegenerate,
  onSelectSuggestion,
  onNext,
  availabilityConfirmed,
}: NicknameScreenProps): ReactElement {
  const showAvailable = !errorReason && Boolean(availabilityConfirmed);

  return (
    <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
      <View testID="onboarding-nickname-root" className="flex-1 bg-canvas">
        <View className="h-[56px] flex-row items-center gap-sm border-b border-hairline px-lg">
          <BackChevronGlyph />
          <Text className="font-noto-bold text-[16px] font-bold text-ink">
            닉네임 설정
          </Text>
        </View>

        <View className="flex-1 px-2xl pt-xl">
          <View className="gap-[7px]">
            <Text className="font-noto-bold text-display font-bold text-ink">
              닉네임을 정해 주세요
            </Text>
            <Text className="font-noto text-body text-muted">
              2~20자로 입력할 수 있어요
            </Text>
          </View>

          <View className="gap-sm pt-[26px]">
            <Text className="font-noto-bold text-label font-bold text-muted">
              닉네임
            </Text>

            <View className="h-[52px] flex-row items-center justify-between rounded-input border-[1.5px] border-hairline-strong px-lg">
              <TextInput
                testID="onboarding-nickname-input"
                value={value}
                onChangeText={onChange}
                className="flex-1 font-noto text-card-title text-ink"
              />
              <Pressable
                testID="onboarding-nickname-regenerate"
                onPress={onRegenerate}
                hitSlop={8}
              >
                <RegenerateGlyph size={22} />
              </Pressable>
            </View>

            {errorReason ? (
              <Text
                testID="onboarding-nickname-error"
                className="font-noto text-label text-primary-text"
              >
                {ERROR_MESSAGES[errorReason]}
              </Text>
            ) : showAvailable ? (
              <View className="flex-row items-center gap-[6px]">
                <PositiveCheckGlyph size={16} />
                <Text
                  testID="onboarding-nickname-available"
                  className="font-noto text-label text-info"
                >
                  사용 가능한 닉네임이에요
                </Text>
              </View>
            ) : null}

            {suggestions.length > 0 ? (
              <View
                testID="onboarding-nickname-suggestions"
                className="flex-row flex-wrap gap-sm"
              >
                {suggestions.map((suggestion, index) => (
                  <Pressable
                    key={`${index}-${suggestion}`}
                    testID={`onboarding-nickname-suggest-${index}`}
                    onPress={() => onSelectSuggestion(suggestion)}
                    className="rounded-pill border-[1.5px] border-hairline-strong px-lg py-sm"
                  >
                    <Text className="font-noto text-body text-ink">
                      {suggestion}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
          </View>

          <Text
            testID="onboarding-nickname-helper"
            className="font-noto pt-md text-label text-muted"
          >
            나중에 설정에서 바꿀 수 있어요
          </Text>
        </View>

        <View className="border-t border-hairline px-2xl pb-[30px] pt-md">
          <Pressable
            testID="onboarding-nickname-next"
            disabled={!canProceed}
            onPress={onNext}
            className={`h-[52px] items-center justify-center rounded-button bg-primary ${
              canProceed ? '' : 'opacity-40'
            }`}
          >
            <Text className="font-noto-bold text-card-title font-bold text-on-primary">
              다음
            </Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}
