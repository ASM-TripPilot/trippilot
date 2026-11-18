import Svg, { Path } from 'react-native-svg';
import { COLOR_TOKENS } from '@/shared/config';
// TRIP-783 · 지도+시트 셸 전용 인라인 SVG 글리프. widgets 는 `@/features` 를 import 하지 않으므로
// `features/itinerary/ui/ItineraryGlyphs` 의 Back/Car/Walk 를 **바이트 복제**
// 한다(리포 글리프 로컬 복제 관례의 N번째 사본). 색은 이 파일에서만 raw hex 로 고정한다(SVG stroke/fill
// 은 className 을 못 받고 `*Glyphs.tsx` 는 raw-hex 스캔 제외 관례 · docs/structure.md §지금 작업하려면).

const MUTED = COLOR_TOKENS.muted;

type GlyphProps = {
  size?: number;
  testID?: string;
};

// 지도핀-꺼짐(16) — 지도 폴백 바 아이콘 원 안 표식(TRIP-919, Figma `4287:2126` 벡터 그대로). muted.
export function MapPinOffGlyph({ size = 16, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
    >
      <Path
        d="M3.6 3.6C2.98178 4.50233 2.65595 5.57292 2.66667 6.66667C2.66667 10.6667 8 14.6667 8 14.6667C8.8638 13.9573 9.66661 13.1768 10.4 12.3333"
        stroke={MUTED}
        strokeWidth={1.33333}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M12.8 9C13.1523 8.27267 13.3346 7.47481 13.3333 6.66667C13.333 5.63215 13.0318 4.62006 12.4665 3.7537C11.9011 2.88733 11.096 2.20409 10.1492 1.78722C9.20236 1.37034 8.15475 1.23782 7.13396 1.40581C6.11318 1.5738 5.16328 2.03504 4.4 2.73333"
        stroke={MUTED}
        strokeWidth={1.33333}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M6.06667 6.06667C5.97178 6.36829 5.94977 6.6881 6.00242 6.99988C6.05507 7.31165 6.1809 7.6065 6.36957 7.86023C6.55824 8.11397 6.80438 8.31935 7.0878 8.45953C7.37122 8.59971 7.68383 8.6707 8 8.66667C8.42993 8.67213 8.85018 8.53889 9.19842 8.28671C9.54667 8.03453 9.80438 7.67684 9.93333 7.26667"
        stroke={MUTED}
        strokeWidth={1.33333}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M1.33333 1.33333L14.6667 14.6667"
        stroke={MUTED}
        strokeWidth={1.33333}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
