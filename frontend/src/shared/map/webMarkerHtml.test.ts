import type { MapPin } from './MapView';
import { buildWebMarker } from './webMarkerHtml';

/**
 * TRIP-1651 (W5) — 웹 지도 마커의 HTML(SVG 문자열) 생성기. AC-4·AC-10.
 *
 * 초심자용 — 네이티브 마커는 react-native-svg 컴포넌트지만, 네이버 JS 지도의 마커 아이콘은
 * "HTML 문자열"이다. 그래서 같은 물방울 핀을 문자열로 돌려주는 순수 함수가 필요하다.
 * 생김새(path 좌표·색)는 jest 가 못 지킨다(README 판정 4) — 여기서는 **번호가 글자로 들어가는지 ·
 * 번호 대신 표식이 들어가는지 · 아래 꼭짓점 기준점인지**만 문자열 포함 여부로 본다.
 */

const BASE: MapPin = { number: 3, lat: 33.5, lng: 126.5 };

describe('AC-4 — 번호 물방울', () => {
  it.each([
    ['state 미전달(기본)', undefined],
    ['current', 'current' as const],
    ['upcoming', 'upcoming' as const],
  ])('%s 는 번호가 요소 글자(>3<)로 들어간다', (_name, state) => {
    const { html } = buildWebMarker({ ...BASE, state });

    expect(html).toContain('>3<');
  });

  it('label 이 있으면 번호 대신 label 이 들어간다', () => {
    const { html } = buildWebMarker({ ...BASE, number: 7, label: 'B' });

    expect(html).toContain('>B<');
    expect(html).not.toContain('>7<');
  });
});

describe('AC-4 — 번호 없는 표식', () => {
  it('done 은 번호 대신 체크 표식이 들어간다', () => {
    const { html } = buildWebMarker({ ...BASE, number: 5, state: 'done' });

    expect(html).not.toContain('>5<');
    expect(html).toContain('data-marker="check"');
  });

  it.each([
    ['stay', 'data-marker="stay"'],
    ['candidate', 'data-marker="candidate"'],
  ] as const)('%s 는 번호 없이 자기 표식만 들어간다', (kind, marker) => {
    const { html } = buildWebMarker({ ...BASE, number: 4, kind });

    expect(html).not.toContain('>4<');
    expect(html).toContain(marker);
  });
});

describe('AC-4 — visited·planned 는 번호 물방울로 폴백한다(프로덕션 소비처 0)', () => {
  it.each(['visited', 'planned'] as const)(
    '%s 는 kind 없는 같은 핀과 결과가 완전히 같다(imageUrl 은 무시)',
    (kind) => {
      const fallback = buildWebMarker({ ...BASE, kind, imageUrl: 1 });

      expect(fallback).toEqual(buildWebMarker(BASE));
    }
  );
});

describe('기준점 — 물방울 아래 꼭짓점이 좌표', () => {
  it.each([
    ['기본', BASE],
    ['upcoming', { ...BASE, state: 'upcoming' as const }],
    ['done', { ...BASE, state: 'done' as const }],
    ['stay', { ...BASE, kind: 'stay' as const }],
    ['candidate', { ...BASE, kind: 'candidate' as const }],
  ])('%s 는 anchor (0.5, 1) 이고 치수는 양수다', (_name, pin) => {
    const marker = buildWebMarker(pin);

    expect(marker.anchor).toEqual({ x: 0.5, y: 1 });
    expect(marker.width).toBeGreaterThan(0);
    expect(marker.height).toBeGreaterThan(0);
  });
});

describe('AC-10 — INV-3: 마커에 소요시간 글자가 없다', () => {
  it('모든 종류의 html 은 SVG 이고 분·시간·소요·duration 글자가 없다', () => {
    const pins: MapPin[] = [
      BASE,
      { ...BASE, state: 'upcoming' },
      { ...BASE, state: 'done' },
      { ...BASE, kind: 'stay' },
      { ...BASE, kind: 'candidate' },
      { ...BASE, kind: 'visited' },
      { ...BASE, kind: 'planned' },
      { ...BASE, label: 'A' },
    ];

    for (const pin of pins) {
      const { html } = buildWebMarker(pin);
      expect(html).toContain('<svg');
      expect(html).not.toMatch(/분|min|소요|duration/i);
    }
  });
});
