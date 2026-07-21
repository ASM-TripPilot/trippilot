/**
 * c06-terms 프레젠테이션 (US-ONB-02 · AC A1~A8 · C6).
 * props 만 받고 네트워크를 모른다 — 서버 호출은 컨테이너/훅 몫이다.
 */
import type { ReactElement } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export interface TermsItemView {
  termsType: string;
  version: string;
  label: string;
  required: boolean;
  checked: boolean;
}

export interface TermsScreenProps {
  items: TermsItemView[];
  allChecked: boolean;
  canProceed: boolean;
  /** A2 — 아직 동의하지 않은 필수 항목의 이름들. 빈 배열이면 안내를 띄우지 않는다. */
  missingRequiredLabels: string[];
  /** A8 — 서버 저장 실패 메시지. null 이면 오류 영역을 그리지 않는다. */
  errorMessage: string | null;
  onToggle: (termsType: string) => void;
  onToggleAll: () => void;
  onNext: () => void;
  onRetry: () => void;
}

export function TermsScreen({
  items,
  allChecked,
  canProceed,
  missingRequiredLabels,
  errorMessage,
  onToggle,
  onToggleAll,
  onNext,
  onRetry,
}: TermsScreenProps): ReactElement {
  // Figma 의 pt-44px(상태바 구워넣기) 대신 SafeAreaView 로 기기 인셋을 잡는다(D4 · E2).
  return (
    <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
      <View testID="onboarding-terms-root" className="flex-1 bg-canvas px-2xl">
        <Text className="font-noto-bold pb-xl pt-3xl text-hero font-bold text-ink">
          약관에 동의해 주세요
        </Text>

        <ScrollView className="flex-1">
          <Pressable
            testID="onboarding-terms-agreeall"
            accessibilityRole="checkbox"
            accessibilityState={{ checked: allChecked }}
            onPress={onToggleAll}
            className="flex-row items-center gap-md rounded-input bg-surface-soft px-lg py-lg"
          >
            <View
              className={`h-5 w-5 rounded-pill border-[1.5px] ${
                allChecked
                  ? 'border-primary bg-primary'
                  : 'border-hairline-strong bg-canvas'
              }`}
            />
            <Text className="font-noto-medium text-card-title font-medium text-ink">
              전체 동의
            </Text>
          </Pressable>

          <View className="gap-md pt-lg">
            {items.map((item) => (
              <Pressable
                key={item.termsType}
                testID={`onboarding-terms-${item.termsType}`}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: item.checked }}
                onPress={() => onToggle(item.termsType)}
                className="flex-row items-center gap-md px-lg py-sm"
              >
                <View
                  className={`h-5 w-5 rounded-pill border-[1.5px] ${
                    item.checked
                      ? 'border-primary bg-primary'
                      : 'border-hairline-strong bg-canvas'
                  }`}
                />
                <Text className="font-noto text-body text-muted">
                  {item.required ? '필수' : '선택'}
                </Text>
                <Text className="font-noto text-body text-ink">
                  {item.label}
                </Text>
              </Pressable>
            ))}
          </View>

          {missingRequiredLabels.length > 0 ? (
            <View className="px-lg pt-md">
              <Text className="font-noto text-label text-muted">
                아직 동의하지 않은 필수 항목이에요
              </Text>
              {/* 안내 문구가 아니라 **항목 이름**이 나와야 한다(A2). testID 요소는 이름만 담는다. */}
              <Text
                testID="onboarding-terms-missing"
                className="font-noto pt-xs text-label text-primary-text"
              >
                {missingRequiredLabels.join(', ')}
              </Text>
            </View>
          ) : null}

          {errorMessage ? (
            <View className="gap-sm px-lg pt-md">
              <Text
                testID="onboarding-terms-error"
                className="font-noto text-label text-primary-text"
              >
                {errorMessage}
              </Text>
              <Pressable
                testID="onboarding-terms-retry"
                onPress={onRetry}
                className="self-start rounded-button border-[1.5px] border-hairline-strong px-lg py-sm"
              >
                <Text className="font-noto-medium text-body font-medium text-ink">
                  다시 시도
                </Text>
              </Pressable>
            </View>
          ) : null}
        </ScrollView>

        <Pressable
          testID="onboarding-terms-next"
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
