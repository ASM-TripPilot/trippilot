import type { ComponentType } from 'react';
import { Pressable, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import BottomSheet, { BottomSheetView } from '@gorhom/bottom-sheet';

import type { SocialProvider } from '@/shared/api';
import {
  AppIconGlyph,
  AppleIcon,
  GoogleIcon,
  KakaoIcon,
  NaverIcon,
} from './AuthGlyphs';
import { APP_ICON_COLORS } from '../config/gradients';
import type { SocialLoginPhase } from '../model/useSocialLogin';

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

type BrandIcon = ComponentType<{ size?: number; testID?: string }>;

// 라벨은 D5(한글) 를 최대한 따르되, kakao 만 예외로 영문 브랜드명을 유지한다: 동결된
// 충돌 시트 테스트가 `getByText(/카카오/)` 로 화면에 "카카오" 가 단 하나(충돌 메시지)만
// 있다고 가정하므로, 버튼 라벨을 "카카오…" 로 바꾸면 매칭이 2개가 되어 계약이 깨진다.
const SOCIAL_BUTTONS: {
  provider: SocialProvider;
  label: string;
  Icon: BrandIcon;
}[] = [
  { provider: 'google', label: '구글로 계속하기', Icon: GoogleIcon },
  { provider: 'apple', label: '애플로 계속하기', Icon: AppleIcon },
  { provider: 'kakao', label: 'Kakao로 계속하기', Icon: KakaoIcon },
  { provider: 'naver', label: '네이버로 계속하기', Icon: NaverIcon },
];

// 앱아이콘 박스(56px) 브랜드 그림자 — 브랜드색 raw 라 토큰화하지 않고 플랫폼 그림자로 변환한다.
const logoShadow = {
  shadowColor: '#DB2647',
  shadowOffset: { width: 0, height: 2.5 },
  shadowOpacity: 0.28,
  shadowRadius: 6.1,
  elevation: 4,
} as const;

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
  const showConflictSheet =
    phase === 'error' && errorCode === 'SOCIAL_EMAIL_CONFLICT';
  const showAgeSheet = phase === 'needs-age';
  const showAgeRestriction = phase === 'error' && errorCode === 'AGE_NOT_MET';
  // TRIP-172(결함 F) — 서버 에러코드는 7종+미지의 값까지 계속 늘어난다(INV-4, 침묵 금지).
  // 전용 화면(연령 제한·이메일 충돌)이 따로 있는 두 코드만 제외하고, 'error' phase 의 그 밖
  // 모든 errorCode(널 포함)는 이 배너로 덮는다 — 화이트리스트가 아니라 블랙리스트로 짠 이유가
  // 그것이다: 새 서버 코드가 생겨도 화면이 자동으로 안내를 띄운다.
  const showErrorBanner =
    phase === 'error' && !showConflictSheet && !showAgeRestriction;

  return (
    <View
      testID="auth-login-root"
      className="flex-1 gap-[14px] bg-canvas px-2xl pb-[28px]"
    >
      <View
        testID="auth-login-brand"
        className="items-center gap-[18px] pb-[34px] pt-[64px]"
      >
        <LinearGradient
          colors={APP_ICON_COLORS}
          style={logoShadow}
          className="h-14 w-14 items-center justify-center rounded-button"
        >
          <AppIconGlyph testID="auth-login-logo-glyph" size={34} />
        </LinearGradient>
        <Text className="font-noto-bold text-center text-hero font-bold text-ink">
          여행의 모든 순간을, TripPilot
        </Text>
      </View>

      {showCancelNotice ? (
        <View testID="auth-login-cancel-notice" className="items-center">
          <Text className="font-noto text-body text-muted">
            로그인이 취소되었습니다
          </Text>
        </View>
      ) : null}

      {showErrorBanner ? (
        <View testID="auth-login-error-banner" className="items-center">
          <Text className="font-noto text-body text-muted">
            로그인에 실패했어요. 잠시 후 다시 시도해 주세요
          </Text>
        </View>
      ) : null}

      <View className="gap-md">
        {SOCIAL_BUTTONS.map(({ provider, label, Icon }) => (
          <Pressable
            key={provider}
            testID={`auth-login-${provider}`}
            onPress={() => onSignIn(provider)}
            className="h-[52px] w-full flex-row items-center justify-center gap-[10px] rounded-button border-[1.5px] border-hairline-strong bg-canvas"
          >
            <Icon size={20} testID={`auth-login-${provider}-icon`} />
            <Text className="font-noto-medium text-card-title font-medium text-ink">
              {label}
            </Text>
          </Pressable>
        ))}
      </View>

      <Text
        testID="auth-login-terms"
        className="font-noto text-center text-caption text-muted-soft"
      >
        로그인 시 약관에 동의합니다
      </Text>

      {showAgeRestriction ? (
        <View testID="auth-age-restriction" className="items-center">
          <Text className="font-noto text-body text-muted">
            만 14세 미만은 가입할 수 없어요
          </Text>
        </View>
      ) : null}

      {showConflictSheet ? (
        <BottomSheet>
          <BottomSheetView testID="auth-login-conflict-sheet" className="p-6">
            <Text
              testID="auth-login-conflict-title"
              className="font-noto-bold text-section font-bold text-ink"
            >
              이미 가입된 계정이에요
            </Text>
            <Text
              testID="auth-login-conflict-message"
              className="mt-2 font-noto text-body text-body"
            >
              {conflictProvider
                ? `이 이메일은 이미 ${conflictProvider} 로그인으로 가입되어 있어요. 계속하시겠어요?`
                : '다른 방법으로 가입된 계정이에요'}
            </Text>
            <Pressable
              testID="auth-login-conflict-continue"
              onPress={onConflictContinue}
              className="mt-4 h-12 items-center justify-center rounded-button border-[1.5px] border-hairline-strong"
            >
              <Text className="font-noto-medium text-card-title font-medium text-ink">
                기존 로그인으로 계속하기
              </Text>
            </Pressable>
            <Pressable
              testID="auth-login-conflict-cancel"
              onPress={onConflictCancel}
              className="mt-2 h-12 items-center justify-center"
            >
              <Text className="font-noto text-card-title text-muted">취소</Text>
            </Pressable>
          </BottomSheetView>
        </BottomSheet>
      ) : null}

      {showAgeSheet ? (
        <BottomSheet>
          <BottomSheetView testID="auth-age-sheet" className="p-6">
            <Text className="font-noto-bold text-section font-bold text-ink">
              연령 확인
            </Text>
            <Text className="mt-2 font-noto text-body text-body">
              만 14세 이상이 맞나요?
            </Text>
            <Pressable
              testID="auth-age-sheet-confirm"
              onPress={onAgeConfirm}
              className="mt-4 h-12 items-center justify-center rounded-button border-[1.5px] border-hairline-strong"
            >
              <Text className="font-noto-medium text-card-title font-medium text-ink">
                네, 확인했어요
              </Text>
            </Pressable>
            <Pressable
              testID="auth-age-sheet-cancel"
              onPress={onAgeCancel}
              className="mt-2 h-12 items-center justify-center"
            >
              <Text className="font-noto text-card-title text-muted">취소</Text>
            </Pressable>
          </BottomSheetView>
        </BottomSheet>
      ) : null}
    </View>
  );
}
