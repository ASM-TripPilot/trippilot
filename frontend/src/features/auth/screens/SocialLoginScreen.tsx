import { Pressable, Text, View } from 'react-native';
import BottomSheet, { BottomSheetView } from '@gorhom/bottom-sheet';

import type { SocialProvider } from '@/shared/api';
import type { SocialLoginPhase } from '../hooks/useSocialLogin';

export interface SocialLoginScreenProps {
  phase: SocialLoginPhase;
  errorCode: string | null;
  conflictProvider: string | null;
  onSignIn: (provider: SocialProvider) => void;
  onConflictContinue: () => void;
  onConflictCancel: () => void;
  onAgeConfirm: () => void;
  onAgeCancel: () => void;
}

const SOCIAL_BUTTONS: { provider: SocialProvider; label: string }[] = [
  { provider: 'google', label: 'Google로 계속하기' },
  { provider: 'apple', label: 'Apple로 계속하기' },
  { provider: 'kakao', label: 'Kakao로 계속하기' },
  { provider: 'naver', label: 'Naver로 계속하기' },
];

export function SocialLoginScreen({
  phase,
  errorCode,
  conflictProvider,
  onSignIn,
  onConflictContinue,
  onConflictCancel,
  onAgeConfirm,
  onAgeCancel,
}: SocialLoginScreenProps) {
  const showCancelNotice = phase === 'cancelled';
  const showErrorBanner =
    phase === 'error' &&
    (errorCode === 'SOCIAL_AUTH_FAILED' || errorCode === 'RATE_LIMITED');
  const showConflictSheet =
    phase === 'error' && errorCode === 'SOCIAL_EMAIL_CONFLICT';
  const showAgeSheet = phase === 'needs-age';
  const showAgeRestriction = phase === 'error' && errorCode === 'AGE_NOT_MET';

  return (
    <View testID="auth-login-root" className="flex-1 justify-center px-6">
      <View testID="auth-login-brand" className="mb-10 items-center">
        <Text className="text-xl font-bold">여행의 모든 순간을, TripPilot</Text>
      </View>

      {showCancelNotice ? (
        <View testID="auth-login-cancel-notice" className="mb-4 items-center">
          <Text>로그인이 취소되었습니다</Text>
        </View>
      ) : null}

      {showErrorBanner ? (
        <View testID="auth-login-error-banner" className="mb-4 items-center">
          <Text>로그인에 실패했어요. 잠시 후 다시 시도해 주세요</Text>
        </View>
      ) : null}

      <View className="gap-3">
        {SOCIAL_BUTTONS.map(({ provider, label }) => (
          <Pressable
            key={provider}
            testID={`auth-login-${provider}`}
            onPress={() => onSignIn(provider)}
            className="h-12 items-center justify-center rounded-xl border border-gray-300"
          >
            <Text>{label}</Text>
          </Pressable>
        ))}
      </View>

      <Text
        testID="auth-login-terms"
        className="mt-8 text-center text-xs text-gray-500"
      >
        로그인 시 약관에 동의합니다
      </Text>

      {showAgeRestriction ? (
        <View testID="auth-age-restriction" className="mt-4 items-center">
          <Text>만 14세 미만은 가입할 수 없어요</Text>
        </View>
      ) : null}

      {showConflictSheet ? (
        <BottomSheet>
          <BottomSheetView testID="auth-login-conflict-sheet" className="p-6">
            <Text
              testID="auth-login-conflict-title"
              className="text-lg font-bold"
            >
              이미 가입된 계정이에요
            </Text>
            <Text testID="auth-login-conflict-message" className="mt-2">
              {conflictProvider
                ? `이 이메일은 이미 ${conflictProvider} 로그인으로 가입되어 있어요. 계속하시겠어요?`
                : '다른 방법으로 가입된 계정이에요'}
            </Text>
            <Pressable
              testID="auth-login-conflict-continue"
              onPress={onConflictContinue}
              className="mt-4 h-12 items-center justify-center rounded-xl border border-gray-300"
            >
              <Text>기존 로그인으로 계속하기</Text>
            </Pressable>
            <Pressable
              testID="auth-login-conflict-cancel"
              onPress={onConflictCancel}
              className="mt-2 h-12 items-center justify-center"
            >
              <Text>취소</Text>
            </Pressable>
          </BottomSheetView>
        </BottomSheet>
      ) : null}

      {showAgeSheet ? (
        <BottomSheet>
          <BottomSheetView testID="auth-age-sheet" className="p-6">
            <Text className="text-lg font-bold">연령 확인</Text>
            <Text className="mt-2">만 14세 이상이 맞나요?</Text>
            <Pressable
              testID="auth-age-sheet-confirm"
              onPress={onAgeConfirm}
              className="mt-4 h-12 items-center justify-center rounded-xl border border-gray-300"
            >
              <Text>네, 확인했어요</Text>
            </Pressable>
            <Pressable
              testID="auth-age-sheet-cancel"
              onPress={onAgeCancel}
              className="mt-2 h-12 items-center justify-center"
            >
              <Text>취소</Text>
            </Pressable>
          </BottomSheetView>
        </BottomSheet>
      ) : null}
    </View>
  );
}
