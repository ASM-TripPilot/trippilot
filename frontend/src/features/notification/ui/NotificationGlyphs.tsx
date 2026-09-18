import Svg, { Path } from 'react-native-svg';

// l02 알림 설정 전용 인라인 SVG 글리프(뒤로가기·정보·경고삼각형). features 간 import 금지라
// LocationGlyphs·AuthGlyphs 의 동형 벡터를 재사용하지 못하고 이 파일에 새로 그린다(리포 관례 —
// ChevronRightGlyph 가 이미 여러 벌, feature 마다 자기 글리프를 갖는다). stroke 색은 className 을
// 못 받아 값이 필요하므로 호출자가 color 로 주입한다(기본값은 tailwind 미러 hex, `*Glyphs.tsx` 는
// raw-hex 스캔 제외 관례).

type GlyphProps = {
  size?: number;
  testID?: string;
  color?: string;
};

// 헤더 back chevron — 표시만(실동작은 라우트가 onPressBack 으로 배선).
export function NotifBackChevronGlyph({
  size = 24,
  testID,
  color = '#222222',
}: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
    >
      <Path
        d="M15 18L9 12L15 6"
        stroke={color}
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// 상·하단 정보 배너의 ⓘ 아이콘.
export function NotifInfoGlyph({
  size = 18,
  testID,
  color = '#6A6A6A',
}: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 18 18"
      fill="none"
    >
      <Path
        d="M9 15.75C12.7279 15.75 15.75 12.7279 15.75 9C15.75 5.27208 12.7279 2.25 9 2.25C5.27208 2.25 2.25 5.27208 2.25 9C2.25 12.7279 5.27208 15.75 9 15.75Z"
        stroke={color}
        strokeWidth={1.575}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M9 8.25V12"
        stroke={color}
        strokeWidth={1.575}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M9 6H9.0075"
        stroke={color}
        strokeWidth={1.575}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// permission-denied 상단 대시 배너의 경고 삼각형(⚠).
export function NotifWarningGlyph({
  size = 18,
  testID,
  color = '#222222',
}: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
    >
      <Path
        d="M12 3.5 22 20H2L12 3.5Z"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M12 10V14"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M12 17H12.01"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
