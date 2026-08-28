import Svg, { Path } from 'react-native-svg';

import { AUTH_ICON_COLORS } from '../config/gradients';

// 인증 화면 전용 벡터 글리프(D3 인라인 방식). Figma 에서 내려받은 .svg 의 좌표를
// react-native-svg 프리미티브(<Svg><Path/>)로 1:1 옮긴 것 — transformer 미도입.
// Figma 의 fill="var(--fill-0, ...)" CSS 변수 폴백은 실색으로 고정했다(RN 은 CSS 변수 미지원).
// testID 는 화면이 계약 testID(auth-login-*-icon·*-logo-glyph, shell-splash-logo-glyph)를
// 얹을 수 있도록 Svg 루트로 넘긴다.

type GlyphProps = {
  size?: number;
  testID?: string;
};

// TripPilot 워드마크 글리프 — 브랜드 그라디언트 박스 위에 얹는 흰색 종이비행기.
// 단일 에셋을 size 로 비례 축소해 스플래시(≈56)·로그인(≈34)에 공용(D6).
export function AppIconGlyph({ size = 34, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 57 57"
      fill="none"
    >
      <Path
        d="M49.35 7.0498L7.05 27.7298L26.79 34.3098L49.35 7.0498Z"
        fill="#ffffff"
      />
      <Path
        d="M49.35 7.0498L26.79 34.3098L33.84 50.2898L49.35 7.0498Z"
        fill="#ffffff"
        opacity={0.72}
      />
    </Svg>
  );
}

export function GoogleIcon({ size = 20, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
    >
      <Path
        d="M9.99998 3.95833C11.475 3.95833 12.7958 4.46667 13.8375 5.45833L16.6917 2.60417C14.9583 0.991667 12.6958 0 9.99998 0C6.09165 0 2.71248 2.24167 1.06665 5.50833L4.39165 8.0875C5.17915 5.71667 7.39165 3.95833 9.99998 3.95833Z"
        fill="#EA4335"
      />
      <Path
        d="M19.575 10.2293C19.575 9.57516 19.5125 8.94183 19.4167 8.3335H10V12.0918H15.3917C15.15 13.3252 14.45 14.3752 13.4 15.0835L16.6208 17.5835C18.5 15.8418 19.575 13.2668 19.575 10.2293Z"
        fill="#4285F4"
      />
      <Path
        d="M4.3875 11.9125C4.1875 11.3083 4.07083 10.6666 4.07083 9.99997C4.07083 9.3333 4.18333 8.69163 4.3875 8.08747L1.0625 5.5083C0.383333 6.8583 0 8.3833 0 9.99997C0 11.6166 0.383333 13.1416 1.06667 14.4916L4.3875 11.9125Z"
        fill="#FBBC05"
      />
      <Path
        d="M10 19.9999C12.7 19.9999 14.9708 19.1124 16.6208 17.579L13.4 15.079C12.5042 15.6832 11.35 16.0374 10 16.0374C7.39167 16.0374 5.17917 14.279 4.3875 11.9082L1.0625 14.4874C2.7125 17.7582 6.09167 19.9999 10 19.9999Z"
        fill="#34A853"
      />
    </Svg>
  );
}

export function AppleIcon({ size = 20, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
    >
      <Path
        d="M13.6333 10.7834C13.6167 9.0751 15.0333 8.25843 15.0917 8.21676C14.3 7.05843 13.0667 6.9001 12.625 6.88343C11.575 6.7751 10.575 7.5001 10.0417 7.5001C9.50835 7.5001 8.69168 6.9001 7.81668 6.91676C6.67501 6.93343 5.61668 7.58343 5.02501 8.60843C3.83335 10.6751 4.71668 13.7334 5.87501 15.4084C6.44168 16.2251 7.11668 17.1418 8.00002 17.1084C8.85002 17.0751 9.17501 16.5584 10.2083 16.5584C11.2333 16.5584 11.525 17.1084 12.425 17.0918C13.3417 17.0751 13.9167 16.2584 14.475 15.4334C15.125 14.4834 15.3917 13.5668 15.4083 13.5168C15.3917 13.5084 13.6167 12.8251 13.6 10.7834H13.6333ZM12.0833 5.7501C12.55 5.18343 12.8667 4.39176 12.775 3.6001C12.1 3.6251 11.2833 4.0501 10.8 4.61676C10.3667 5.11676 9.98335 5.91676 10.0833 6.68343C10.8333 6.74176 11.6083 6.3001 12.0833 5.7501Z"
        fill="#000000"
      />
    </Svg>
  );
}

export function KakaoIcon({ size = 20, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
    >
      <Path
        d="M15 0H5C2.23858 0 0 2.23858 0 5V15C0 17.7614 2.23858 20 5 20H15C17.7614 20 20 17.7614 20 15V5C20 2.23858 17.7614 0 15 0Z"
        fill="#FEE500"
      />
      <Path
        d="M10 5C7.24167 5 5 6.75 5 8.91667C5 10.3 5.91667 11.5083 7.3 12.2083C7.2 12.5667 6.93333 13.5417 6.88333 13.75C6.81667 14.0083 6.975 14.0083 7.08333 13.9333C7.16667 13.875 8.41667 13.025 8.95833 12.6583C9.29167 12.7083 9.64167 12.7333 10 12.7333C12.7583 12.7333 15 10.9833 15 8.81667C15 6.65 12.7583 5 10 5Z"
        fill="#3C1E1E"
      />
    </Svg>
  );
}

export function NaverIcon({ size = 20, testID }: GlyphProps) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
    >
      <Path
        d="M15.8333 0H4.16667C1.86548 0 0 1.86548 0 4.16667V15.8333C0 18.1345 1.86548 20 4.16667 20H15.8333C18.1345 20 20 18.1345 20 15.8333V4.16667C20 1.86548 18.1345 0 15.8333 0Z"
        fill="#03C75A"
      />
      <Path
        d="M6.66669 5.8335H8.91669L11.0834 9.16683V5.8335H13.3334V14.1668H11.0834L8.91669 10.8335V14.1668H6.66669V5.8335Z"
        fill="#ffffff"
      />
    </Svg>
  );
}

// 에러 배너 경고 아이콘 — 형태 선례는 shared/location/LocationGlyphs.tsx 의
// LocationInfoGlyph(원형 info, 같은 18px·strokeWidth 1.575·round cap/join, 내부 2 path).
// 여기서는 원(info) 대신 삼각(warning) 외곽 + 세로 막대 + 하단 점 3-path.
export function WarningTriangleGlyph({
  size = 18,
  testID,
  color,
}: GlyphProps & { color?: string }) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 18 18"
      fill="none"
    >
      <Path
        d="M9 2.25L16.5 15H1.5L9 2.25Z"
        stroke={color ?? AUTH_ICON_COLORS.warning}
        strokeWidth={1.575}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M9 6.75V10.5"
        stroke={color ?? AUTH_ICON_COLORS.warning}
        strokeWidth={1.575}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M9 12.75H9.0075"
        stroke={color ?? AUTH_ICON_COLORS.warning}
        strokeWidth={1.575}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
