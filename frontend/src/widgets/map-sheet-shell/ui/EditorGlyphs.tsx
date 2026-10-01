import Svg, { Path } from 'react-native-svg';

// TRIP-921 · h12 편집 뷰(EditorView·SlotDropZone) 전용 인라인 SVG 글리프. widgets → `@/features` import
// 금지(widgetsStructure F · mapSheetShellStructure G3)라 `features/itinerary/ui/ItineraryGlyphs` 의
// Plus·InfoCircle 을 **바이트 복제**한다(MapSheetGlyphs 와 같은 로컬 복제 관례). Trash 는 Figma
// `4197:2469`(드롭존 20px · ink) 에셋 그대로다. 색은 이 파일에서만 raw hex 로 고정한다(`*Glyphs.tsx`
// raw-hex 스캔 제외 관례).

const INK = '#222222';
const MUTED = '#6A6A6A';
const PRIMARY = '#FF385C';

type GlyphProps = {
  size?: number;
  testID?: string;
};

// 드롭존 휴지통(20) — Figma `4197:2469` 에셋 path 그대로(ink).
export function TrashGlyph({ size = 20, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
    >
      <Path
        d="M2.5 5H17.5"
        stroke={INK}
        strokeWidth={1.66667}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M15.8333 5L15 16.6667C15 17.1087 14.8244 17.5326 14.5118 17.8452C14.1993 18.1577 13.7754 18.3333 13.3333 18.3333H6.66667C6.22464 18.3333 5.80072 18.1577 5.48816 17.8452C5.17559 17.5326 5 17.1087 5 16.6667L4.16667 5"
        stroke={INK}
        strokeWidth={1.66667}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M6.66667 5V3.33333C6.66667 2.89131 6.84226 2.46738 7.15482 2.15482C7.46738 1.84226 7.89131 1.66667 8.33333 1.66667H11.6667C12.1087 1.66667 12.5326 1.84226 12.8452 2.15482C13.1577 2.46738 13.3333 2.89131 13.3333 3.33333V5"
        stroke={INK}
        strokeWidth={1.66667}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// 카드 사이 "+"·"장소 추가" — PlusGlyph(ItineraryGlyphs) 바이트 복제(편집 뷰가 쓰는 ink·primary 톤만).
export function PlusGlyph({
  size = 18,
  tone = 'ink',
  testID,
}: GlyphProps & { tone?: 'ink' | 'primary' }) {
  const stroke = tone === 'primary' ? PRIMARY : INK;
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 18 18"
      fill="none"
    >
      <Path
        d="M9 3.75V14.25"
        stroke={stroke}
        strokeWidth={1.8}
        strokeLinecap="round"
      />
      <Path
        d="M3.75 9H14.25"
        stroke={stroke}
        strokeWidth={1.8}
        strokeLinecap="round"
      />
    </Svg>
  );
}

// 안내줄 i(16) — InfoCircleGlyph(ItineraryGlyphs) 바이트 복제(편집 뷰가 쓰는 muted 톤만).
export function InfoCircleGlyph({ size = 20, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
    >
      <Path
        d="M10 17.5C14.1421 17.5 17.5 14.1421 17.5 10C17.5 5.85786 14.1421 2.5 10 2.5C5.85786 2.5 2.5 5.85786 2.5 10C2.5 14.1421 5.85786 17.5 10 17.5Z"
        stroke={MUTED}
        strokeWidth={1.66667}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M10 9.16667V13.3333"
        stroke={MUTED}
        strokeWidth={1.66667}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M10 6.66667H10.0083"
        stroke={MUTED}
        strokeWidth={1.66667}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
