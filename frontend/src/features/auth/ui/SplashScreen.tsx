import { Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { AppIconGlyph } from './AuthGlyphs';
import { SplashIllustration } from './SplashIllustration';
import {
  APP_ICON_COLORS,
  SPLASH_BACKGROUND_COLORS,
  SPLASH_BACKGROUND_LOCATIONS,
} from '../config/gradients';

// c01-splash · 몰입형 부트스트랩 스플래시. 프레젠테이션만 브랜드 비주얼로 교체하고 동작 계약은
// 불변이다 — testID(shell-splash-root·-logo·-wordmark·-slogan·-progress)와 문구를 보존해
// 기존 행위 테스트(SplashScreen.test·SplashGate.test)가 수정 없이 green 으로 남는다.

// 앱아이콘 박스(94px) 브랜드 그림자 — 브랜드색 raw 라 토큰화하지 않고 플랫폼 그림자로 변환한다.
const logoShadow = {
  shadowColor: '#DB2647',
  shadowOffset: { width: 0, height: 4.27 },
  shadowOpacity: 0.28,
  shadowRadius: 10.26,
  elevation: 8,
} as const;

// TRIP-722: loading prop 제거 — 유일 소비처(프리뷰 splash-loading 키·loading 테스트)가 함께
// 삭제됐고, 실앱(SplashGate·프리뷰 splash)은 무인자라 진행점 강조 갈래가 죽은 코드였다.
export function SplashScreen() {
  return (
    <LinearGradient
      testID="shell-splash-gradient"
      colors={SPLASH_BACKGROUND_COLORS}
      locations={SPLASH_BACKGROUND_LOCATIONS}
      style={{ flex: 1 }}
    >
      <View testID="shell-splash-root" className="flex-1">
        <View className="mt-[120px]">
          <SplashIllustration />
        </View>

        <View className="mt-[10px] items-center gap-xl">
          <LinearGradient
            testID="shell-splash-logo"
            colors={APP_ICON_COLORS}
            style={{
              width: 94,
              height: 94,
              borderRadius: 20.94,
              alignItems: 'center',
              justifyContent: 'center',
              ...logoShadow,
            }}
          >
            <AppIconGlyph testID="shell-splash-logo-glyph" size={56.4} />
          </LinearGradient>

          <View className="items-center gap-sm">
            <Text
              testID="shell-splash-wordmark"
              className="font-inter-bold text-[30px] font-bold tracking-[-0.6px] text-ink"
            >
              TripPilot
            </Text>
            <Text
              testID="shell-splash-slogan"
              className="font-noto text-body text-muted"
            >
              여행의 처음부터 끝까지, 한 곳에서
            </Text>
          </View>
        </View>

        <View className="flex-1" />

        <View
          testID="shell-splash-progress"
          className="flex-row items-center justify-center gap-[8px] pb-[61px]"
        >
          <View
            testID="shell-splash-progress-dot"
            className="h-[7px] w-[7px] rounded-full bg-primary opacity-[0.45]"
          />
          <View
            testID="shell-splash-progress-dot"
            className="h-[7px] w-[7px] rounded-full bg-primary opacity-[0.45]"
          />
          <View
            testID="shell-splash-progress-dot"
            className="h-[7px] w-[7px] rounded-full bg-primary opacity-[0.45]"
          />
        </View>
      </View>
    </LinearGradient>
  );
}
