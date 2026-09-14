import Svg, { Path, Rect } from 'react-native-svg';

// TRIP-809 · entities/itinerary-slot 슬롯 카드 글리프. 카테고리 사진 플레이스홀더 아이콘 8종(명소·맛집·
// 카페·야경·자연·쇼핑·문화 + 폴백 이미지)을 features/itinerary/ui/ItineraryGlyphs 에서 바이트 그대로
// 이관했고(TRIP-465 출생), ReplanSlotRow(i13)용 chevron·lock 2종은 planb PlanbGlyphs 판을 바이트 복제했다
// (entities → features 역참조 금지라 재사용 불가 — 리포 글리프 로컬 복제 관례의 N번째 사본).
//
// 색은 이 파일 안에서만 raw hex 로 고정한다(SVG stroke/fill 은 className 을 못 받고 `*Glyphs.tsx` 는
// raw-hex 스캔 제외 관례 · docs/structure.md §지금 작업하려면). 카테고리 아이콘 색은 틴트 계열의 "진한
// 잉크"로 스냅한다 — info-bg 틴트엔 info, success-bg 틴트엔 success, presence-blue-bg 틴트엔 presence-blue.

const MUTED = '#6A6A6A';
const PRIMARY_TEXT = '#C13515';
const INFO = '#0B6E63';
const SUCCESS = '#0E9384';
const PRESENCE_BLUE = '#1B6EF3';

type GlyphProps = {
  size?: number;
  testID?: string;
};

// 명소 — 위치 핀(info). `LocationOffGlyph` 의 핀에서 사선만 뺀 형태.
export function CategoryPinGlyph({ size = 30, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
    >
      <Path
        d="M12 21.5C12 21.5 19.5 15.25 19.5 9.75C19.5 5.60786 16.1421 2.25 12 2.25C7.85786 2.25 4.5 5.60786 4.5 9.75C4.5 15.25 12 21.5 12 21.5Z"
        stroke={INFO}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M12 12.25C13.3807 12.25 14.5 11.1307 14.5 9.75C14.5 8.36929 13.3807 7.25 12 7.25C10.6193 7.25 9.5 8.36929 9.5 9.75C9.5 11.1307 10.6193 12.25 12 12.25Z"
        stroke={INFO}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// 맛집 — 포크+나이프(primary-text). onboarding `ForkKnifeGlyph` 벡터 복제, 색만 스냅.
export function CategoryForkKnifeGlyph({ size = 30, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
    >
      <Path
        d="M7 2.5V10.5M9 2.5V10.5M5 2.5V8.5C5 9.6 5.9 10.5 7 10.5V21.5"
        stroke={PRIMARY_TEXT}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M17 2.5C15.3431 2.5 14 4.79086 14 7.5C14 9.98528 15.1193 12.0402 16.5714 12.4272L16 21.5"
        stroke={PRIMARY_TEXT}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// 카페 — 커피컵+김(muted). 컵 몸통 + 손잡이 + 위로 오르는 김 2줄.
export function CategoryCupGlyph({ size = 30, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
    >
      <Path
        d="M5 9.5H16.5V15C16.5 17.2091 14.7091 19 12.5 19H9C6.79086 19 5 17.2091 5 15V9.5Z"
        stroke={MUTED}
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M16.5 11H18C19.3807 11 20.5 12.1193 20.5 13.5C20.5 14.8807 19.3807 16 18 16H16.5"
        stroke={MUTED}
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M9 3.5V6M12.5 3.5V6"
        stroke={MUTED}
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// 야경 — 초승달+반짝(presence-blue). onboarding `MoonGlyph` 크레센트 + 4각 스파클(fill).
export function CategoryNightGlyph({ size = 30, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
    >
      <Path
        d="M20.5 13.6C19.4 14.1 18.2 14.4 16.9 14.4C12.4 14.4 8.8 10.8 8.8 6.3C8.8 5 9.1 3.8 9.6 2.7C5.7 3.6 2.8 7.1 2.8 11.2C2.8 16 6.7 19.9 11.5 19.9C15.6 19.9 19.1 17 20 13.1L20.5 13.6Z"
        stroke={PRESENCE_BLUE}
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M19 2.5L19.8 4.7L22 5.5L19.8 6.3L19 8.5L18.2 6.3L16 5.5L18.2 4.7L19 2.5Z"
        fill={PRESENCE_BLUE}
      />
    </Svg>
  );
}

// 자연 — 침엽수(success). 2단 삼각 잎 + 줄기 + 밑동.
export function CategoryTreeGlyph({ size = 30, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
    >
      <Path
        d="M12 3L7.5 10.5H16.5L12 3Z"
        stroke={SUCCESS}
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M12 8L6.5 16H17.5L12 8Z"
        stroke={SUCCESS}
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M12 16V20M9.5 20H14.5"
        stroke={SUCCESS}
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// 쇼핑 — 쇼핑백(primary-text). onboarding `ShoppingBagGlyph` 벡터 복제, 색만 스냅.
export function CategoryShoppingBagGlyph({ size = 30, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
    >
      <Path
        d="M4.5 8.5H19.5L18.5 20.5H5.5L4.5 8.5Z"
        stroke={PRIMARY_TEXT}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M8 8.5V6.5C8 4.29086 9.79086 2.5 12 2.5C14.2091 2.5 16 4.29086 16 6.5V8.5"
        stroke={PRIMARY_TEXT}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// 문화 — 기둥/박공 건물(info). 삼각 지붕 + 기둥 4개 + 밑단.
export function CategoryBuildingGlyph({ size = 30, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
    >
      <Path
        d="M12 3.5L4.5 8.5H19.5L12 3.5Z"
        stroke={INFO}
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M6.5 8.5V17.5M9.8 8.5V17.5M14.2 8.5V17.5M17.5 8.5V17.5"
        stroke={INFO}
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M4 17.5H20M3.5 20.5H20.5"
        stroke={INFO}
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// 기본(폴백) — 이미지/사진 프레임(muted). onboarding `ArtGlyph` 형태(프레임+산+해), 색만 스냅.
export function CategoryImageGlyph({ size = 30, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
    >
      <Path
        d="M3.5 5H20.5V19H3.5V5Z"
        stroke={MUTED}
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M3.5 15.5L8.5 10.5L12.5 14.5L16 11L20.5 15.5"
        stroke={MUTED}
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M8 8.5C8.55228 8.5 9 8.05228 9 7.5C9 6.94772 8.55228 6.5 8 6.5C7.44772 6.5 7 6.94772 7 7.5C7 8.05228 7.44772 8.5 8 8.5Z"
        stroke={MUTED}
        strokeWidth={1.7}
      />
    </Svg>
  );
}

// TRIP-563 출생 · ReplanSlotRow(i13) 슬롯 행 어포던스 글리프 2종 — planb PlanbGlyphs 판 바이트 복제.
// primary-text(#C13515) raw 고정("다른 후보 N" 텍스트·고정 pill 텍스트와 같은 잉크). 무prop 호출(<Glyph/>).
// "다른 후보 N >" 우측 체브론.
export function ChevronRightGlyph({ size = 16 }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M9 6L15 12L9 18"
        stroke={PRIMARY_TEXT}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// 고정 pill 자물쇠(몸통 + 걸쇠).
export function LockGlyph({ size = 14 }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect
        x={5}
        y={10.5}
        width={14}
        height={9.5}
        rx={2.2}
        stroke={PRIMARY_TEXT}
        strokeWidth={1.8}
      />
      <Path
        d="M8 10.5V7.5a4 4 0 0 1 8 0v3"
        stroke={PRIMARY_TEXT}
        strokeWidth={1.8}
        strokeLinecap="round"
      />
    </Svg>
  );
}
