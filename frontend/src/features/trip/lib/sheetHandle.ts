import type { ViewStyle } from 'react-native';

/**
 * g01/g02 편집 시트 6종(Destination·Period·Companion·StaySelect·Budget·Pref)의
 * 바텀시트 핸들 통일값(TRIP-735).
 *
 * gorhom BottomSheet 의 `handleIndicatorStyle` 은 NativeWind className 이 아니라 raw ViewStyle 을
 * 받으므로 여기 상수로 둔다(features/auth/config/gradients.ts·shared/location/lib/locationColors.ts
 * 와 동일 패턴 — 시트 .tsx 의 raw-hex 가드는 .tsx 화면 표면만 보므로 .ts 상수 모듈은 대상 밖이다).
 *
 * 값은 tailwind hairline-strong(#DDDDDD)과 정확히 같다. 폭40·높이4·r2 = 종전 콘텐츠 안 커스텀
 * 그래버(2겹의 밝은 바)와 육안 동일 — 이제 gorhom 기본 핸들(어두운 rgba(0,0,0,.75) 바) 하나만
 * 이 값으로 덮어 1겹·연회색으로 통일한다.
 */
export const SHEET_HANDLE_INDICATOR_STYLE: ViewStyle = {
  width: 40,
  height: 4,
  borderRadius: 2,
  backgroundColor: '#DDDDDD',
};
