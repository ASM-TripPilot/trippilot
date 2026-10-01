/**
 * 약관 재동의 프레젠테이션(TRIP-937 · BR-U0-14 · BR-U0-10 · INV-4).
 * Figma 프레임이 없어 c06 `TermsScreen` 의 체크 행·"보기"·하단 고정 CTA 관례로 구성했다(Figma 역반영 후속).
 * props 만 받고 네트워크를 모른다 — 대상 조회·저장·탈출 배선은 `pages/reconsent` 몫이다.
 * 뒤로가기는 없다 — 재동의 전에는 나갈 곳이 없는 게이트 화면이다(거부 경로는 TRIP-938).
 */
import type { ReactElement } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CheckGlyph, ViewChevronGlyph } from './OnboardingGlyphs';

export interface ReconsentItemView {
  termsType: string;
  label: string;
  checked: boolean;
}

export interface ReconsentScreenProps {
  loading: boolean;
  items: ReconsentItemView[];
  canAgree: boolean;
  /** 대상 조회 실패·교집합 빔·저장 실패 공통. null 이면 오류 영역을 그리지 않는다. */
  errorMessage: string | null;
  onToggle: (termsType: string) => void;
  onViewTerms: (termsType: string) => void;
  onAgree: () => void;
  onRetry: () => void;
}

export function ReconsentScreen({
  loading,
  items,
  canAgree,
  errorMessage,
  onToggle,
  onViewTerms,
  onAgree,
  onRetry,
}: ReconsentScreenProps): ReactElement {
  return (
    <SafeAreaView edges={['top', 'bottom']} className="flex-1 bg-canvas">
      <View className="border-b border-hairline px-lg pb-md pt-sm">
        <Text className="text-[18px] font-noto-bold text-ink">약관 재동의</Text>
      </View>

      <ScrollView className="flex-1 px-2xl">
        <Text className="font-noto-bold pb-xl pt-2xl text-[24px] font-bold text-ink">
          {'약관이 변경되었어요\n다시 동의해 주세요'}
        </Text>

        {loading ? <ActivityIndicator /> : null}

        {items.map((item, index) => (
          <Pressable
            key={item.termsType}
            testID={`reconsent-item-${item.termsType}`}
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
              <Text className="font-noto text-body text-ink">{item.label}</Text>
            </View>
            <Pressable
              testID={`reconsent-view-${item.termsType}`}
              onPress={() => onViewTerms(item.termsType)}
              className="flex-row items-center gap-[2px]"
            >
              <Text className="font-noto text-label text-muted-soft">보기</Text>
              <ViewChevronGlyph />
            </Pressable>
          </Pressable>
        ))}

        {errorMessage ? (
          <View className="gap-sm pt-md">
            <Text
              testID="reconsent-error"
              className="font-noto text-label text-primary-text"
            >
              {errorMessage}
            </Text>
            <Pressable
              testID="reconsent-retry"
              accessibilityRole="button"
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
          testID="reconsent-agree"
          disabled={!canAgree}
          onPress={onAgree}
          className={`h-[52px] items-center justify-center rounded-button bg-primary ${
            canAgree ? '' : 'opacity-40'
          }`}
        >
          <Text className="font-noto-bold text-card-title font-bold text-on-primary">
            동의하고 계속하기
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
