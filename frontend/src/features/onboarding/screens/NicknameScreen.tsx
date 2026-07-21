/**
 * c07-nickname 프레젠테이션 (US-ONB-03 · AC B3~B7).
 * props 만 받고 네트워크를 모른다. 판정(중복·금칙어)은 서버가 하고 이 화면은 표시만 한다.
 */
import type { ReactElement } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

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
}: NicknameScreenProps): ReactElement {
  // Figma 의 pt-44px 대신 SafeAreaView 로 기기 인셋을 잡는다(D4 · E2).
  return (
    <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
      <View
        testID="onboarding-nickname-root"
        className="flex-1 bg-canvas px-2xl"
      >
        <Text className="font-noto-bold pb-xl pt-3xl text-hero font-bold text-ink">
          닉네임을 정해 주세요
        </Text>

        <View className="flex-row items-center gap-md">
          <TextInput
            testID="onboarding-nickname-input"
            value={value}
            onChangeText={onChange}
            className="flex-1 rounded-input border-[1.5px] border-hairline-strong px-lg py-md font-noto text-body text-ink"
          />
          <Pressable
            testID="onboarding-nickname-regenerate"
            onPress={onRegenerate}
            className="rounded-input border-[1.5px] border-hairline-strong px-lg py-md"
          >
            <Text className="font-noto-medium text-body font-medium text-ink">
              재생성
            </Text>
          </Pressable>
        </View>

        {errorReason ? (
          <Text
            testID="onboarding-nickname-error"
            className="font-noto pt-md text-label text-primary-text"
          >
            {ERROR_MESSAGES[errorReason]}
          </Text>
        ) : null}

        {suggestions.length > 0 ? (
          <View
            testID="onboarding-nickname-suggestions"
            className="flex-row flex-wrap gap-sm pt-md"
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

        <Text
          testID="onboarding-nickname-helper"
          className="font-noto pt-md text-label text-muted"
        >
          나중에 설정에서 바꿀 수 있어요
        </Text>

        <View className="flex-1" />

        <Pressable
          testID="onboarding-nickname-next"
          disabled={!canProceed}
          onPress={onNext}
          className={`items-center justify-center rounded-button bg-primary py-lg ${
            canProceed ? '' : 'opacity-40'
          }`}
        >
          <Text className="font-noto-bold text-card-title font-bold text-on-primary">
            다음
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
