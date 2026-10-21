import { BlurView } from 'expo-blur';
import type { ReactElement, ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

/**
 * TRIP-1522 · 유리(glass) 표면 — 흰 반투명 + 흰 테두리 + 뒤 배경 블러 + 그림자를 한 묶음으로 쓰는 공용 부품.
 * 앱 하단 탭 바(`BottomTabBar`)가 같은 값을 인라인으로 구현하고 있고(TRIP-1104·1436 합의 값), 여행 중 허브의 하단 바·수정 팝업·
 * 행사 카드가 같은 값을 써야 해서 한 곳으로 뽑았다. `BottomTabBar` 는 건드리지 않았다(탭 바를 쓰는 화면 영향 0 — 합치는 건 후속).
 *
 * 구조: `그림자 래퍼 View` → `BlurView(expo-blur)` → `[흰 0.68 레이어(터치를 삼키지 않는다)]` + `children`.
 * 그림자를 BlurView 밖 래퍼가 지는 이유: BlurView 는 블러를 모양에 맞춰 자르려고 `overflow-hidden` 인데 그게 그림자까지 잘라 버린다.
 * 테두리는 클리핑된 모양을 따라 그려지도록 BlurView 안쪽이 진다. 새 네이티브 모듈 없음(expo-blur 는 탭 바가 이미 쓴다).
 * 블러가 실제로 그려지는지(iOS·안드로이드 + 네이티브 지도 위)는 jest 가 못 본다 → 6-b.
 */

// 그림자 색은 토큰이 없다 — `BottomTabBar` PILL_SHADOW_STYLE 과 같은 값(HomeScreen 그림자 관례).
const GLASS_SHADOW = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.1,
  shadowRadius: 14,
  elevation: 4,
} as const;

// 테두리 — 50% 반투명 흰색(Figma 실측, 알파는 토큰이 아니라 raw). `BottomTabBar` PILL_BORDER_STYLE 과 같다.
const GLASS_BORDER = {
  borderWidth: 1,
  borderColor: 'rgba(255,255,255,0.5)',
} as const;

export interface GlassSurfaceProps {
  children?: ReactNode;
  /** 바깥(그림자 래퍼) — 크기·배치·여백. */
  className?: string;
  style?: StyleProp<ViewStyle>;
  /** 안쪽(BlurView) — 패딩·flex 방향. */
  contentClassName?: string;
  contentStyle?: StyleProp<ViewStyle>;
  /** 반경 — 바깥·안쪽에 같이 준다(그림자 모양과 블러 잘림이 어긋나지 않게). 기본 알약. */
  radiusClassName?: string;
  /** 바깥 래퍼에 단다. */
  testID?: string;
}

export function GlassSurface({
  children,
  className = '',
  style,
  contentClassName = '',
  contentStyle,
  radiusClassName = 'rounded-pill',
  testID,
}: GlassSurfaceProps): ReactElement {
  return (
    <View
      testID={testID}
      className={`${radiusClassName} ${className}`}
      style={[GLASS_SHADOW, style]}
    >
      <BlurView
        // intensity 70(TRIP-1104) — 탭 바와 같은 값. Figma 블러 28 은 다른 척도라 따로 바꾸지 않는다.
        intensity={70}
        tint="light"
        experimentalBlurMethod="dimezisBlurView"
        className={`overflow-hidden ${radiusClassName} ${contentClassName}`}
        style={[GLASS_BORDER, contentStyle]}
      >
        {/* 흰 68% 레이어(TRIP-1436 합의) — 사진 위에서도 라벨이 읽히게. 터치를 삼키지 않는다. */}
        <View
          pointerEvents="none"
          className="absolute inset-0 bg-canvas/[0.68]"
        />
        {children}
      </BlurView>
    </View>
  );
}
