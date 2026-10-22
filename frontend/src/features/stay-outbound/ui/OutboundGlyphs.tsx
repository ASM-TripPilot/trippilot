import Svg, { Path } from 'react-native-svg';

export { WarningTriangleGlyph } from '@/shared/ui/glyphs';

// 제휴 고지 시트(OtaChoiceSheet) 전용 글리프 — features/stay 의 StayGlyphs 에서 같은 벡터로 옮겨 그린다
// (features 끼리 import 금지, TRIP-1579 시트 이사). 색은 이 파일 안에서만 raw hex 로 고정한다(StayGlyphs 선례).

const MUTED = '#6A6A6A';
const MUTED_SOFT = '#9AA1AB';
const ON_PRIMARY = '#FFFFFF';

type GlyphProps = {
  size?: number;
  testID?: string;
};

export function ChevronRightGlyph({ size = 20, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
    >
      <Path
        d="M7.5 5L12.5 10L7.5 15"
        stroke={MUTED_SOFT}
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function InfoGlyph({ size = 15, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
    >
      <Path
        d="M8 14.5C11.5899 14.5 14.5 11.5899 14.5 8C14.5 4.41015 11.5899 1.5 8 1.5C4.41015 1.5 1.5 4.41015 1.5 8C1.5 11.5899 4.41015 14.5 8 14.5Z"
        stroke={MUTED}
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M8 7.3V11M8 5H8.008"
        stroke={MUTED}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function CheckGlyph({ size = 20, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
    >
      <Path
        d="M20 6L9 17L4 12"
        stroke={ON_PRIMARY}
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
