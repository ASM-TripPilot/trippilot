import type { MapPin } from './MapView';
import {
  DONE_CHECK,
  DROP_LARGE_SIZE,
  DROP_SMALL_SIZE,
  PIN_MUTED_SOFT,
  PIN_PRIMARY,
  PIN_SUCCESS,
  PIN_WHITE,
  RECORD_DIMS,
  STAY_PIN,
  TEARDROP_LARGE,
  TEARDROP_SMALL,
} from './pinShapes';

export interface WebMarker {
  html: string;
  width: number;
  height: number;
  anchor: { x: number; y: number };
}

/** 물방울·stay·candidate 모두 아래 꼭짓점이 좌표다. */
const BOTTOM_TIP = { x: 0.5, y: 1 } as const;

function escapeText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function svg(
  size: { width: number; height: number },
  viewBox: string,
  body: string
): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size.width}" height="${size.height}" viewBox="${viewBox}" style="display:block">${body}</svg>`;
}

function glyphText(
  x: number,
  y: number,
  fill: string,
  fontSize: number,
  glyph: string
): string {
  return `<text x="${x}" y="${y}" fill="${fill}" font-size="${fontSize}" font-weight="bold" font-family="sans-serif" text-anchor="middle">${escapeText(glyph)}</text>`;
}

/**
 * 네이버 JS 지도 마커 아이콘(HTML 문자열). 네이티브 `PinTeardrop`·`RecordMarker` 와 같은 모양을 SVG 문자열로 그린다.
 * `visited`·`planned`(프로덕션 소비처 0)는 번호 물방울로 폴백한다. 거리·시간 글자는 받지도 그리지도 않는다(INV-3).
 */
export function buildWebMarker(pin: MapPin): WebMarker {
  if (pin.kind === 'stay') {
    const dims = RECORD_DIMS.stay;
    const bed = [
      '<rect x="1" y="6" width="2" height="10" rx="1"/>',
      '<rect x="2" y="11" width="16" height="4.5" rx="2"/>',
      '<rect x="4.5" y="8" width="4.5" height="3" rx="1.5"/>',
      '<rect x="2" y="15.5" width="1.8" height="2.5"/>',
      '<rect x="16.2" y="15.5" width="1.8" height="2.5"/>',
    ].join('');
    return {
      html: svg(
        dims,
        '0 0 34 42',
        `<path data-marker="stay" d="${STAY_PIN}" fill="${PIN_PRIMARY}" stroke="${PIN_WHITE}" stroke-width="2"/><g transform="translate(7 6)" fill="${PIN_WHITE}">${bed}</g>`
      ),
      width: dims.width,
      height: dims.height,
      anchor: dims.anchor,
    };
  }
  if (pin.kind === 'candidate') {
    const dims = RECORD_DIMS.candidate;
    return {
      html: svg(
        dims,
        '0 0 28 36',
        `<path data-marker="candidate" d="${TEARDROP_SMALL}" fill="${PIN_WHITE}" stroke="${PIN_PRIMARY}" stroke-width="2"/>`
      ),
      width: dims.width,
      height: dims.height,
      anchor: dims.anchor,
    };
  }

  const glyph = pin.label ?? String(pin.number);
  const state = pin.state ?? 'current';
  if (state === 'done') {
    return {
      html: svg(
        DROP_SMALL_SIZE,
        '0 0 28 36',
        `<path d="${TEARDROP_SMALL}" fill="${PIN_SUCCESS}" stroke="${PIN_WHITE}" stroke-width="2"/><path data-marker="check" d="${DONE_CHECK}" fill="none" stroke="${PIN_WHITE}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`
      ),
      ...DROP_SMALL_SIZE,
      anchor: BOTTOM_TIP,
    };
  }
  if (state === 'upcoming') {
    return {
      html: svg(
        DROP_SMALL_SIZE,
        '0 0 28 36',
        `<path d="${TEARDROP_SMALL}" fill="${PIN_WHITE}" stroke="${PIN_MUTED_SOFT}" stroke-width="2"/>${glyphText(14, 18, PIN_MUTED_SOFT, 13, glyph)}`
      ),
      ...DROP_SMALL_SIZE,
      anchor: BOTTOM_TIP,
    };
  }
  return {
    html: svg(
      DROP_LARGE_SIZE,
      '0 0 35 45.5178',
      `<path d="${TEARDROP_LARGE}" fill="${PIN_PRIMARY}" stroke="${PIN_WHITE}" stroke-width="2.5"/>${glyphText(17.5, 22, PIN_WHITE, 15, glyph)}`
    ),
    ...DROP_LARGE_SIZE,
    anchor: BOTTOM_TIP,
  };
}
