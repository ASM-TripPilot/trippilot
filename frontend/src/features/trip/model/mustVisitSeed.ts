import type { SavedPlace } from '@/shared/api/generated/schemas';

/**
 * TRIP-209 g01 '꼭 갈 곳' — 담은 장소를 시드로 옮기고, 섹션의 얼굴을 정하는 순수 판정 3종.
 *
 * 무엇을 보장하나: 시드는 담은 목록의 **복사본**이라 만든 뒤로는 원본과 따로 논다(BR-U1-37 ·
 * INV-U1-04). 같은 장소를 두 번 담지 않고(BR-U1-50 — 서버가 409로 막기 전에 클라가 두 번
 * 보내지 않는다), 입력 배열을 제자리에서 흔들지 않는다(TanStack Query 캐시가 준 배열이다).
 *
 * 왜 화면 밖인가: "언제 어느 얼굴인가"를 화면 안에 두면 조합마다 렌더해야 보이고, 화면은
 * 조회 상태를 알 수 없다(경계 가드 `tripWizardStep1Boundary.test.ts`). 화면은 완성된 얼굴만
 * 받는다 — 판정도 문구도 여기와 컨테이너에서 끝난다.
 *
 * 이 모듈이 무는 것은 생성 스키마(순수 타입)뿐이다 — 화면이 여기서 타입을 가져와도 경계
 * 가드의 import 그래프가 깨끗하다.
 */

/** 시드 항목 — 서버 DTO가 아니라 이 화면이 쓸 최소 모양이다. 드래프트 스토어가 서버 응답을
 * 복사하면 `savedPlacesStructure.test.ts`가 red를 낸다(frontend/README.md §66). */
export interface MustVisitSeedItem {
  /** 등록 요청의 `poiId`이자 testID의 꼬리. */
  sourcePoiId: string;
  name: string;
  /** 값이 없으면 `null` — 기본 이미지를 지어내지 않는다(`Place.imageUrl` 계약 주석). */
  imageUrl: string | null;
}

/** 썸네일 상한(게이트① 확정 — 특례 없음). 4건이면 3장 + `+1`이다. */
export const MUST_VISIT_THUMBNAIL_LIMIT = 3;

/** 담은 장소 → 시드 목록. 같은 장소는 첫 등장 한 번만, 입력 순서 보존, 입력 배열 불변. */
export function seedMustVisits(savedPlaces: SavedPlace[]): MustVisitSeedItem[] {
  const seen = new Set<string>();
  const seeds: MustVisitSeedItem[] = [];

  for (const entry of savedPlaces) {
    const { poiId, nameKo, imageUrl } = entry.place;
    if (seen.has(poiId)) {
      continue;
    }
    seen.add(poiId);
    seeds.push({
      sourcePoiId: poiId,
      name: nameKo,
      imageUrl: imageUrl ?? null,
    });
  }

  return seeds;
}

/**
 * 재시드 규칙(TRIP-288 D2·D7·D8·D11) — 담은 목록이 늘어난 채 다시 도착했을 때 **무엇을 더하는가**.
 *
 * `current`를 접두사로 그대로 두고, `current`에도 `excluded`에도 없는 것만 뒤에 이어 붙인다.
 * 담은 목록 순서로 재정렬하지 않고, `incoming`에서 사라진 항목을 빼지도 않는다 — 시드는
 * 복사본이라 원본 담기를 풀어도 이미 옮겨 온 것은 남는다(INV-U1-04 양방향 독립 · BR-U1-37).
 *
 * ⚠️ **더할 게 없으면 `current`를 그대로 돌려준다**(내용이 같은 새 배열이 아니다). 이 함수를
 * 태우는 화면 효과에는 "이미 채웠나" 가드가 없고, 게스트·미도착에서는 담은 목록이 매 렌더
 * 새 빈 배열이다 — 새 배열을 돌려주면 상태 교체 → 리렌더 → 재계산의 무한 루프가 되어
 * `render()` 자체가 `Maximum update depth exceeded`로 죽는다.
 */
export function mergeMustVisitSeeds(input: {
  current: MustVisitSeedItem[];
  incoming: MustVisitSeedItem[];
  excluded: string[];
}): MustVisitSeedItem[] {
  const known = new Set(input.current.map((seed) => seed.sourcePoiId));
  const appended: MustVisitSeedItem[] = [];

  for (const seed of input.incoming) {
    const poiId = seed.sourcePoiId;
    if (known.has(poiId) || input.excluded.includes(poiId)) {
      continue;
    }
    known.add(poiId);
    appended.push(seed);
  }

  return appended.length === 0
    ? input.current
    : [...input.current, ...appended];
}

/** 섹션이 그릴 네 얼굴. `loading`은 글자 없는 자리표시다 — 도착 전에 "담은 곳이 없어요"를
 * 그리면 담아 둔 사용자에게 한 순간 거짓말을 한다. */
export type MustVisitSectionView =
  | { kind: 'loading' }
  | { kind: 'empty' }
  | { kind: 'failed' }
  | { kind: 'seeded'; thumbnails: MustVisitSeedItem[]; overflowCount: number };

/**
 * 얼굴 판정. **`seeds`를 가장 먼저 본다** — 조회가 실패하거나 다시 로딩으로 돌아가도 이미
 * 받아 둔 시드를 덮지 않는다(문제로그 `2026-08-04 화면 얼굴 전환이 잔존 목록을 지운다`).
 * 실패는 얼굴을 갈아 끼우는 대신 재시도 행을 **덧붙이는** 축으로 화면에 따로 내려간다.
 *
 * `failed`와 `empty`가 서로 다른 얼굴인 것이 이 함수의 나머지 절반이다 — 못 불러온 것과
 * 정말 없는 것은 다른 사실이다(INV-4).
 */
export function resolveMustVisitSection(input: {
  seeds: MustVisitSeedItem[];
  loading: boolean;
  failed: boolean;
}): MustVisitSectionView {
  if (input.seeds.length > 0) {
    return {
      kind: 'seeded',
      thumbnails: input.seeds.slice(0, MUST_VISIT_THUMBNAIL_LIMIT),
      overflowCount: Math.max(
        0,
        input.seeds.length - MUST_VISIT_THUMBNAIL_LIMIT
      ),
    };
  }
  if (input.loading) {
    return { kind: 'loading' };
  }
  if (input.failed) {
    return { kind: 'failed' };
  }
  return { kind: 'empty' };
}

/**
 * must-visit 등록 실패 배너 본문(게이트① 확정 문구). 시도·실패 **건수를 둘 다** 말한다 —
 * 409는 목표 상태와 결과 상태가 같아 실패 건수에 넣지 않는다(컨테이너가 접는다).
 *
 * ⚠️ 여행 생성 실패로 읽히는 어휘를 쓰지 않는다. 사용자가 "여행이 안 만들어졌다"고 믿고
 * 다시 만들면 되돌릴 수 없는 중복이 된다.
 */
export function mustVisitFailureNotice(
  attempted: number,
  failed: number
): string {
  return `꼭 갈 곳 ${attempted}곳 중 ${failed}곳을 등록하지 못했어요`;
}
