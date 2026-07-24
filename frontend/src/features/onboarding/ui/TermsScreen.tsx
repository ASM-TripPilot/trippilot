/**
 * c06-terms 프레젠테이션 (US-ONB-02 · AC A1~A8 · C6 · Figma 1293:1208 정합 TRIP-162).
 * props 만 받고 네트워크를 모른다 — 서버 호출은 컨테이너/훅 몫이다.
 */
import type { ReactElement } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  BackChevronGlyph,
  CheckGlyph,
  ViewChevronGlyph,
} from './OnboardingGlyphs';

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
  /** seam — 행의 "보기"를 누르면 어느 약관인지 상위로 알린다(Q2-a). 실 동작(모달 등)은 후속 유닛. */
  onViewTerms?: (termsType: string) => void;
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
  onViewTerms,
}: TermsScreenProps): ReactElement {
  return (
    <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
      <View testID="onboarding-terms-root" className="flex-1 bg-canvas">
        <View className="h-[56px] flex-row items-center gap-sm border-b border-hairline px-lg">
          <BackChevronGlyph />
          <Text className="font-noto-bold text-[16px] font-bold text-ink">
            약관 동의
          </Text>
        </View>

        <ScrollView className="flex-1 px-2xl">
          <Text className="font-noto-bold pb-xl pt-2xl text-[24px] font-bold text-ink">
            {'서비스 이용을 위해\n약관에 동의해 주세요'}
          </Text>

          <Pressable
            testID="onboarding-terms-agreeall"
            accessibilityRole="checkbox"
            accessibilityState={{ checked: allChecked }}
            onPress={onToggleAll}
            className="flex-row items-center gap-md rounded-input bg-surface-soft p-lg"
          >
            <View
              className={`h-[22px] w-[22px] items-center justify-center rounded-[6px] ${
                allChecked
                  ? 'bg-primary'
                  : 'border-[1.5px] border-hairline-strong bg-canvas'
              }`}
            >
              {allChecked ? <CheckGlyph /> : null}
            </View>
            <Text className="font-noto-bold text-card-title font-bold text-ink">
              약관 전체 동의
            </Text>
          </Pressable>

          <View className="pt-xl">
            {items.map((item, index) => (
              <Pressable
                key={item.termsType}
                testID={`onboarding-terms-${item.termsType}`}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: item.checked }}
                onPress={() => onToggle(item.termsType)}
                className={`flex-row items-center justify-between py-[15px] ${
                  index > 0 ? 'border-t border-hairline' : ''
                }`}
              >
                <View className="flex-row items-center gap-[10px]">
                  <View
                    className={`h-[22px] w-[22px] items-center justify-center rounded-[6px] ${
                      item.checked
                        ? 'bg-primary'
                        : 'border-[1.5px] border-hairline-strong bg-canvas'
                    }`}
                  >
                    {item.checked ? <CheckGlyph /> : null}
                  </View>
                  <View
                    testID={`onboarding-terms-badge-${item.termsType}`}
                    className={`rounded-[6px] px-sm py-[3px] ${
                      item.required ? 'bg-primary-pale' : 'bg-surface-strong'
                    }`}
                  >
                    <Text
                      className={`font-noto-bold text-micro font-bold ${
                        item.required ? 'text-primary-text' : 'text-muted'
                      }`}
                    >
                      {item.required ? '필수' : '선택'}
                    </Text>
                  </View>
                  <Text className="font-noto text-body text-ink">
                    {item.label}
                  </Text>
                </View>
                <Pressable
                  testID={`onboarding-terms-view-${item.termsType}`}
                  onPress={() => onViewTerms?.(item.termsType)}
                  className="flex-row items-center gap-[2px]"
                >
                  <Text className="font-noto text-label text-muted-soft">
                    보기
                  </Text>
                  <ViewChevronGlyph />
                </Pressable>
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

        <View className="border-t border-hairline px-2xl pb-[30px] pt-md">
          <Pressable
            testID="onboarding-terms-next"
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
