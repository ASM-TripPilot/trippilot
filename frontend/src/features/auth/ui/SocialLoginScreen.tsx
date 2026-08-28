import type { ComponentType, ReactNode } from 'react';
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
  WarningTriangleGlyph,
} from './AuthGlyphs';
import { APP_ICON_COLORS, AUTH_ICON_COLORS } from '../config/gradients';
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

// 라벨 4종은 Figma c02-social-login 확정값(D5 한글) 그대로다. 예전엔 kakao 만 예외로
// 영문 브랜드명을 유지했다 — 동결 충돌 시트 테스트가 화면 전역에서 "카카오" 가 단 하나
// (충돌 메시지)만 있다고 가정했기 때문이다. 그 단언은 이제 안내 메시지 testID
// (auth-login-conflict-message) 스코프로 좁혀져 있어 더 이상 화면 전역 유일성을 요구하지
// 않는다 — 버튼 라벨이 한글이어도 계약이 깨지지 않는다.
const SOCIAL_BUTTONS: {
  provider: SocialProvider;
  label: string;
  Icon: BrandIcon;
}[] = [
  { provider: 'google', label: '구글로 계속하기', Icon: GoogleIcon },
  { provider: 'apple', label: '애플로 계속하기', Icon: AppleIcon },
  { provider: 'kakao', label: '카카오로 계속하기', Icon: KakaoIcon },
  { provider: 'naver', label: '네이버로 계속하기', Icon: NaverIcon },
];

// 서버가 주는 provider 코드(existingProvider)를 화면 표시용 한글로 옮긴다. 코드 원문이 화면에
// 새면 안 되고(AC-C2), 4종 밖 코드·null 은 이 표에 없으므로 일반 문구로 폴백한다(AC-C4).
const PROVIDER_KO: Record<string, string> = {
  google: '구글',
  apple: '애플',
  kakao: '카카오',
  naver: '네이버',
};

// 앱아이콘 박스(72px) 스타일 — 브랜드 그림자 + 라운드 스퀘어 클립.
// borderRadius 는 반드시 style 로 준다(className rounded-* 가 아니라): LinearGradient 는
// className 반경으로 자기 그라디언트를 클립하지 않아 각져 보이기 때문이다(스플래시가 style
// borderRadius 로 사는 것이 대조군). 반경/박스 비율 0.223(=Figma 12.473/56, 스플래시
// 20.94/94 동형) → 72×0.2227≈16.03. 그림자색은 브랜드색 raw 라 토큰화 없이 플랫폼 그림자로.
// TRIP-598 후속: 사용자가 "너무 작아 뭔지 모르겠다"를 거듭 강조 → 64→72px 재확대(비율 동결).
const logoShadow = {
  shadowColor: '#DB2647',
  shadowOffset: { width: 0, height: 2.5 },
  shadowOpacity: 0.28,
  shadowRadius: 6.1,
  elevation: 4,
  borderRadius: 16.03,
} as const;

// 시트 딤(backdrop). gorhom 은 기본값으로 딤을 안 그리므로 각 <BottomSheet> 에
// backdropComponent 로 명시한다. 목/실라이브러리 모두 이 컴포넌트에 prop 을 안 넘길 수 있어
// 넘겨받은 prop 에 기대지 않고 자기 노드에 직접 testID·스크림 토큰을 얹는다.
function SheetBackdrop() {
  return (
    <View
      testID="auth-sheet-backdrop"
      className="absolute inset-0 bg-scrim/40"
    />
  );
}

// 세 시트(충돌·연령확인·연령제한)의 공통 셸 — 딤 위에 grabber + 블록 간격 14 균일 컨테이너.
function Sheet({ testID, children }: { testID: string; children: ReactNode }) {
  return (
    <BottomSheet backdropComponent={SheetBackdrop}>
      <BottomSheetView
        testID={testID}
        className="gap-[14px] rounded-sheet-top px-[22px] pb-[26px]"
      >
        <View className="h-[5px] w-[40px] self-center rounded-pill bg-hairline-strong" />
        {children}
      </BottomSheetView>
    </BottomSheet>
  );
}

// 시트 주 행동(filled primary) — 채움 버튼이라 테두리 토큰을 쓰지 않는다.
function SheetCta({
  testID,
  label,
  onPress,
}: {
  testID: string;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      className="h-[52px] items-center justify-center rounded-button bg-primary"
    >
      <Text className="font-noto-bold font-bold text-on-primary">{label}</Text>
    </Pressable>
  );
}

// 시트 취소(약한 위계) — 충돌·연령확인 두 시트만 쓴다(연령제한은 통보라 취소 없음).
function SheetCancel({
  testID,
  onPress,
}: {
  testID: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      className="h-[44px] items-center justify-center"
    >
      <Text className="font-noto text-card-title text-muted">취소</Text>
    </Pressable>
  );
}

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

  // 충돌 시트 표시명 — 매핑에 없으면(4종 밖·null) undefined → 일반 문구로 폴백.
  const conflictKo = conflictProvider
    ? PROVIDER_KO[conflictProvider]
    : undefined;

  return (
    // 루트 top=123 은 Figma 절대 좌표(jest 미검, [검증] 스크린샷 몫). SafeAreaView 밖이라
    // 이 상수를 그대로 둔다 — 감싸면 inset 이 더해져 123 이 깨진다.
    <View
      testID="auth-login-root"
      className="flex-1 gap-[14px] bg-canvas px-2xl pb-[28px] pt-[123px]"
    >
      <View
        testID="auth-login-brand"
        className="items-center gap-[18px] pb-[34px] pt-[64px]"
      >
        <LinearGradient
          colors={APP_ICON_COLORS}
          style={logoShadow}
          className="h-[72px] w-[72px] items-center justify-center"
        >
          <AppIconGlyph testID="auth-login-logo-glyph" size={43} />
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
        <View
          testID="auth-login-error-banner"
          className="w-full flex-row items-center gap-[10px]"
        >
          <View
            testID="auth-login-error-icon-badge"
            className="h-7 w-7 items-center justify-center rounded-full bg-primary"
          >
            <WarningTriangleGlyph
              size={16}
              color={AUTH_ICON_COLORS.onPrimary}
            />
          </View>
          <Text className="flex-1 font-noto-bold text-label font-bold text-ink">
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
            <Text className="font-noto-bold text-card-title font-bold text-ink">
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

      {showConflictSheet ? (
        <Sheet testID="auth-login-conflict-sheet">
          <Text
            testID="auth-login-conflict-title"
            className="font-noto-bold text-section font-bold text-ink"
          >
            이미 가입된 계정이에요
          </Text>
          <Text
            testID="auth-login-conflict-message"
            className="font-noto text-body text-body"
          >
            {conflictKo
              ? `이 이메일은 이미 ${conflictKo} 로그인으로 가입되어 있습니다. ${conflictKo} 로그인으로 계속하시겠어요?`
              : '다른 방법으로 가입된 계정이에요'}
          </Text>
          <SheetCta
            testID="auth-login-conflict-continue"
            label={
              conflictKo
                ? `${conflictKo} 로그인으로 계속`
                : '기존 로그인으로 계속'
            }
            onPress={onConflictContinue}
          />
          <SheetCancel
            testID="auth-login-conflict-cancel"
            onPress={onConflictCancel}
          />
        </Sheet>
      ) : null}

      {showAgeSheet ? (
        <Sheet testID="auth-age-sheet">
          <Text className="font-noto-bold text-section font-bold text-ink">
            만 14세 이상이 맞나요?
          </Text>
          <Text className="font-noto text-body text-body">
            관련 법령에 따라 만 14세 이상만 가입할 수 있어요.
          </Text>
          <SheetCta
            testID="auth-age-sheet-confirm"
            label="네, 확인했어요"
            onPress={onAgeConfirm}
          />
          <SheetCancel testID="auth-age-sheet-cancel" onPress={onAgeCancel} />
        </Sheet>
      ) : null}

      {showAgeRestriction ? (
        <Sheet testID="auth-age-restriction">
          <Text className="font-noto-bold text-section font-bold text-ink">
            만 14세 미만은 가입할 수 없어요
          </Text>
          <Text className="font-noto text-body text-body">
            관련 법령에 따라 만 14세 이상부터 이용할 수 있어요. 나이를 잘못
            확인했다면 다시 시도해 주세요.
          </Text>
          <SheetCta
            testID="auth-age-restriction-confirm"
            label="확인"
            onPress={onAgeCancel}
          />
        </Sheet>
      ) : null}
    </View>
  );
}
