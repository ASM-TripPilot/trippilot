/**
 * 약관 열람 프레젠테이션(TRIP-937 · 가이드라인 5.1.1(i) · LEGAL-01 · INV-4).
 * Figma 프레임이 없어 l06 하위 화면 헤더 + 본문 스크롤로 구성했다(Figma 역반영 후속).
 * props 만 받고 네트워크를 모른다 — 조회·재시도 배선은 `pages/terms-viewer` 몫이다.
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

import { BackChevronGlyph } from './OnboardingGlyphs';

export interface TermsViewerScreenProps {
  /** 헤더 제목 = 문서 이름(예: '개인정보 처리방침'). */
  title: string;
  status: 'loading' | 'ready' | 'error';
  /** 서버가 준 약관 전문. `ready` 일 때만 그린다. */
  body: string | null;
  onPressBack: () => void;
  onRetry: () => void;
}

export function TermsViewerScreen({
  title,
  status,
  body,
  onPressBack,
  onRetry,
}: TermsViewerScreenProps): ReactElement {
  return (
    <SafeAreaView edges={['top', 'bottom']} className="flex-1 bg-canvas">
      <View className="flex-row items-center gap-sm border-b border-hairline px-lg pb-md pt-sm">
        <Pressable
          testID="terms-viewer-back"
          accessibilityRole="button"
          onPress={onPressBack}
        >
          <BackChevronGlyph />
        </Pressable>
        <Text className="text-[18px] font-noto-bold text-ink">{title}</Text>
      </View>

      {status === 'ready' ? (
        <ScrollView
          testID="terms-viewer-body"
          contentContainerClassName="px-2xl py-xl"
        >
          <Text className="font-noto text-body text-ink">{body}</Text>
        </ScrollView>
      ) : status === 'error' ? (
        <View className="flex-1 items-center justify-center gap-md px-2xl">
          <Text
            testID="terms-viewer-error"
            className="text-center font-noto text-body text-primary-text"
          >
            약관을 불러오지 못했어요. 다시 시도해 주세요.
          </Text>
          <Pressable
            testID="terms-viewer-retry"
            accessibilityRole="button"
            onPress={onRetry}
            className="rounded-button border-[1.5px] border-hairline-strong px-lg py-sm"
          >
            <Text className="font-noto-medium text-body font-medium text-ink">
              다시 시도
            </Text>
          </Pressable>
        </View>
      ) : (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator />
        </View>
      )}
    </SafeAreaView>
  );
}
