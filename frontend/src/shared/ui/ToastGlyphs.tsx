import Svg, { Path } from 'react-native-svg';

// 공용 토스트 성공 체크 — Figma DS NoticeBar tone=success(4464:1583)의 원 없는 체크. SVG `stroke` 는
// className 을 못 받아 색은 이 파일에서만 raw hex 로 고정한다(`*Glyphs.tsx` 관례). 완료 도킹 배너
// (`GenerationDoneBar`, pages)도 이 글리프를 쓴다 — 예전 사본 `DoneCheckGlyph` 는 TRIP-1357 에서 걷었다.

const SUCCESS = '#0E9384';

export function ToastSuccessGlyph({
  size = 20,
  testID,
}: {
  size?: number;
  testID?: string;
}) {
  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
    >
      <Path
        d="M16.6667 5L7.5 14.1667L3.33333 10"
        stroke={SUCCESS}
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
