// 홈 화면 파일 여럿(HomeHeader·HomeHeroes·HomeSections)이 함께 쓰는 표면 상수 — 한 파일만 쓰는 상수는 그 파일 안에 둔다.
import { StyleSheet } from 'react-native';

// 사진 위 흰 글씨 가독성을 위한 스크림 그라디언트(브리프 §3-D 명시 raw 허용 — 스크림은 토큰
// 대상이 아니다). 상단 30%는 투명, 하단은 검정. 카드별 하단 농도만 Figma 실측대로 다르다.
export const SCRIM_LOCATIONS = [0.3, 1] as const;

export const ABSOLUTE_FILL = StyleSheet.absoluteFillObject;

// 카드 그림자 2종(브리프 §3-D 명시 raw 허용 — 그림자는 토큰 대상이 아니다). RN은 box-shadow가
// 없어 shadow-* 스타일 프로퍼티로 옮긴다. shadowColor '#000000'은 D-3 13색 밖이라 무제재.
export const softCardShadow = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.06,
  shadowRadius: 10,
  elevation: 2,
} as const;
