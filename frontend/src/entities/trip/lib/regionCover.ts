import type { ImageSourcePropType } from 'react-native';

import { sidoKey } from '@/shared/lib/sidoKey';

import coverNames from '../../../../assets/region-covers/index.json';
import { REGION_COVERS } from '../config/regionCovers';
import type { TripDestination } from '../model';

type CoverDestination = Pick<TripDestination, 'seq' | 'regionCode'>;

/**
 * 키 → 그림. **`REGION_COVERS` 를 읽는 곳은 이 함수와 `coverChoices` 둘뿐이다** — 그림을 서버/CDN 으로 옮기면 이 둘만 바꾼다.
 * `hasOwnProperty` 로 "내 칸"인지 확인한다 — 서버는 키 모양만 검사해 `'constructor'` 도 통과하는데 `obj['constructor']` 는
 * 없는 칸이 아니라 `Object` 함수를 돌려준다. 모르는 키는 null.
 */
export function coverSourceForKey(key: string): ImageSourcePropType | null {
  return Object.prototype.hasOwnProperty.call(REGION_COVERS, key)
    ? REGION_COVERS[key]
    : null;
}

/** 고를 수 있는 커버 키와 이름표(`assets/region-covers/index.json`). CDN 으로 옮기면 여기만 바꾼다. */
export function coverChoices(): readonly { key: string; label: string }[] {
  return Object.keys(REGION_COVERS).map((key) => ({
    key,
    label: (coverNames.covers as Record<string, string>)[key],
  }));
}

/** 첫 목적지(seq 최소)의 `regionCode`. 목적지·코드가 없으면 null. */
function firstRegionCode(
  destinations: readonly CoverDestination[] | undefined
): string | null {
  if (!destinations || destinations.length === 0) return null;
  const first = destinations.reduce((a, b) => (b.seq < a.seq ? b : a));
  return first.regionCode?.trim() || null;
}

/** 첫 목적지 → 시군구 그림, 없으면 같은 시도(앞 2자리) 그림, 그마저 없으면 null. */
function firstDestinationCover(
  destinations: readonly CoverDestination[] | undefined
): ImageSourcePropType | null {
  const code = firstRegionCode(destinations);
  if (!code) return null;
  return coverSourceForKey(code) ?? coverSourceForKey(code.slice(0, 2));
}

/**
 * 여행 → 표시 그림 — 사용자가 고른 `coverKey` → 첫 목적지 자동 → null(호출부가 그라데이션으로 폴백). 여행 커버의 유일한 입구다
 * (목록 카드·홈 2곳·기록 달력·마이·설정). `coverKey` 가 null·없음(옛 서버)·앱이 모르는 키면 첫 목적지로 내려간다.
 */
export function tripCoverSource(trip: {
  coverKey?: string | null;
  destinations?: readonly CoverDestination[];
}): ImageSourcePropType | null {
  const chosen = trip.coverKey ? coverSourceForKey(trip.coverKey) : null;
  return chosen ?? firstDestinationCover(trip.destinations);
}

/** 다른 시도에 같은 이름이 있는 시군구(카탈로그 선택 가능 237행 실측). 접미를 떼거나 시도를 빼면 도시 글자와 같아 보여 거짓이 된다. */
const SHARED_SIGUNGU_NAMES = new Set([
  '중구',
  '동구',
  '서구',
  '남구',
  '북구',
  '강서구',
  '고성군',
]);

/** 이름표(`부산광역시 해운대구`) → 그림 위 짧은 이름(`해운대`·`부산`·`부산 중구`). */
function shortCoverName(label: string): string {
  const [sido, sigungu] = label.split(' ');
  if (!sigungu) return sidoKey(sido);
  return SHARED_SIGUNGU_NAMES.has(sigungu)
    ? `${sidoKey(sido)} ${sigungu}`
    : sigungu.replace(/[구군시]$/, '');
}

/**
 * 고른 그림이 첫 목적지와 다른 시도면 그 이름(`그림 · 해운대`), 아니면 null(TRIP-1806).
 * 앱이 모르는 키는 `tripCoverSource` 가 자동 커버로 내려가므로 null. 첫 목적지 코드를 모르면 붙인다 — 같은 지역 그림이어도 글자는 참이다.
 */
export function tripCoverLabel(trip: {
  coverKey?: string | null;
  destinations?: readonly CoverDestination[];
}): string | null {
  const key = trip.coverKey;
  const choice = key ? coverChoices().find((one) => one.key === key) : null;
  if (!key || !choice) return null;
  const code = firstRegionCode(trip.destinations);
  if (code?.slice(0, 2) === key.slice(0, 2)) return null;
  return `그림 · ${shortCoverName(choice.label)}`;
}

/**
 * 고정 지역 전용(지역 피커·온보딩 투어처럼 코드가 박힌 호출부). 튜플(길이가 정해진 배열)만 받는다 — 여행의 `destinations`
 * 배열을 넘기면 컴파일 오류라 소비처가 `tripCoverSource` 로 가게 된다.
 */
export function pickRegionCover(
  destinations: readonly [CoverDestination]
): ImageSourcePropType | null {
  return firstDestinationCover(destinations);
}
