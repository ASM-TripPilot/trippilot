import type { ReactElement } from 'react';
import Svg, { Path } from 'react-native-svg';

import type { NotificationIconKind } from '../model/notificationKind';

// l01 알림함 kind 아이콘 5종(home·swap·list·document·sun) — Figma 1598:2389 벡터를 인라인 SVG 로.
// features 간 import 금지라 shared·타 feature 글리프를 재사용하지 못하고 feature-로컬로 그린다(리포 관례).
// stroke 색은 className 을 못 받아 값이 필요하므로 상수로 둔다(`*Glyphs.tsx` 는 raw-hex 스캔 제외 관례).

const STROKE = '#3F3F3F';

type KindGlyphProps = {
  size?: number;
};

function StrokeSvg({
  size,
  children,
}: {
  size: number;
  children: ReactElement | ReactElement[];
}): ReactElement {
  return (
    <Svg width={size} height={size} viewBox="0 0 22 22" fill="none">
      {children}
    </Svg>
  );
}

function strokeProps(d: string) {
  return {
    d,
    stroke: STROKE,
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
}

function HomeGlyph({ size = 22 }: KindGlyphProps): ReactElement {
  return (
    <StrokeSvg size={size}>
      <Path {...strokeProps('M2.75 9.625L11 2.75L19.25 9.625')} />
      <Path
        {...strokeProps(
          'M4.58333 8.98333V18.3333C4.58333 18.5764 4.67991 18.8096 4.85182 18.9815C5.02373 19.1534 5.25689 19.25 5.5 19.25H16.5C16.7431 19.25 16.9763 19.1534 17.1482 18.9815C17.3201 18.8096 17.4167 18.5764 17.4167 18.3333V8.98333'
        )}
      />
      <Path {...strokeProps('M8.70833 19.25V13.2917H13.2917V19.25')} />
    </StrokeSvg>
  );
}

function SwapGlyph({ size = 22 }: KindGlyphProps): ReactElement {
  return (
    <StrokeSvg size={size}>
      <Path {...strokeProps('M6.41667 3.66667L2.75 7.33333L6.41667 11')} />
      <Path {...strokeProps('M2.75 7.33333H19.25')} />
      <Path {...strokeProps('M15.5833 18.3333L19.25 14.6667L15.5833 11')} />
      <Path {...strokeProps('M19.25 14.6667H2.75')} />
    </StrokeSvg>
  );
}

function ListGlyph({ size = 22 }: KindGlyphProps): ReactElement {
  return (
    <StrokeSvg size={size}>
      <Path {...strokeProps('M8.25 5.5H18.3333')} />
      <Path {...strokeProps('M8.25 11H18.3333')} />
      <Path {...strokeProps('M8.25 16.5H18.3333')} />
      <Path {...strokeProps('M3.66667 5.5H4.03333')} />
      <Path {...strokeProps('M3.66667 11H4.03333')} />
      <Path {...strokeProps('M3.66667 16.5H4.03333')} />
    </StrokeSvg>
  );
}

function DocumentGlyph({ size = 22 }: KindGlyphProps): ReactElement {
  return (
    <StrokeSvg size={size}>
      <Path
        {...strokeProps(
          'M12.8333 2.75H6.41667C5.93044 2.75 5.46412 2.94315 5.1203 3.28697C4.77649 3.63079 4.58333 4.0971 4.58333 4.58333V17.4167C4.58333 17.9029 4.77649 18.3692 5.1203 18.713C5.46412 19.0568 5.93044 19.25 6.41667 19.25H15.5833C16.0696 19.25 16.5359 19.0568 16.8797 18.713C17.2235 18.3692 17.4167 17.9029 17.4167 17.4167V7.33333L12.8333 2.75Z'
        )}
      />
      <Path {...strokeProps('M12.8333 2.75V7.33333H17.4167')} />
      <Path {...strokeProps('M8.25 11.9167H13.75')} />
      <Path {...strokeProps('M8.25 15.5833H11.9167')} />
    </StrokeSvg>
  );
}

function SunGlyph({ size = 22 }: KindGlyphProps): ReactElement {
  return (
    <StrokeSvg size={size}>
      <Path
        {...strokeProps(
          'M11 13.75C12.5188 13.75 13.75 12.5188 13.75 11C13.75 9.48122 12.5188 8.25 11 8.25C9.48122 8.25 8.25 9.48122 8.25 11C8.25 12.5188 9.48122 13.75 11 13.75Z'
        )}
      />
      <Path
        {...strokeProps(
          'M11 2.29167V5.04167M11 16.9583V19.7083M19.7083 11H16.9583M5.04167 11H2.29167M16.8667 5.13333L14.9417 7.05833M7.05833 14.9417L5.13333 16.8667M16.8667 16.8667L14.9417 14.9417M7.05833 7.05833L5.13333 5.13333'
        )}
      />
    </StrokeSvg>
  );
}

const GLYPHS: Record<
  NotificationIconKind,
  (props: KindGlyphProps) => ReactElement
> = {
  home: HomeGlyph,
  swap: SwapGlyph,
  list: ListGlyph,
  document: DocumentGlyph,
  sun: SunGlyph,
};

/** icon 종류에 맞는 kind 글리프를 그린다(행이 이 하나만 물어 순수 프레젠테이션 유지). */
export function NotificationKindIcon({
  icon,
  size = 22,
}: {
  icon: NotificationIconKind;
  size?: number;
}): ReactElement {
  const Glyph = GLYPHS[icon];
  return <Glyph size={size} />;
}

// empty 상태(1599:2388)의 대시 박스 안 종 아이콘 — muted-soft 톤. StateNotice illustration 으로 주입.
export function NotifBellGlyph({
  size = 28,
  color = '#9AA1AB',
}: {
  size?: number;
  color?: string;
}): ReactElement {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M13.73 21a2 2 0 0 1-3.46 0"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
