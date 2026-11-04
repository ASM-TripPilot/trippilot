/**
 * @jest-environment node
 */

/**
 * TRIP-1770 · `index.view.ts` 순수성 가드 — 모든 슬라이스의 view 진입점은 네트워크 계층을 전이 로드하지 않는다.
 *
 * 무엇을 보장하나: `src/**\/index.view.ts(x)` 를 **파일 시스템에서 찾아**(새 view 도 자동 편입) 각각의 정적 런타임 의존
 * 그래프를 부팅 계수 스크립트의 `walk`(TRIP-1716 — 타입 전용 import·함수 안 지연 require 는 제외. 운영 계수와 달리 `__DEV__`
 * 분기는 접지 않는다 — 프리뷰·jest 는 개발 모드라 그 가지를 실제로 평가한다)로 따라가, 네트워크 계층(`src/shared/api` 중 스키마
 * 밖 전부 — 클라이언트·훅·mutator 포함, 그리고 `axios`)이 하나도 없음을 단언한다. 스키마(`index.schemas.ts`·
 * `generated/schemas/**`)는 타입·enum 상수뿐이라 허용한다. view 를 무는 개발 프리뷰가 네트워크 없이 그려진다는 전제
 * (`devPreviewReleaseGate` 의 지뢰 목)를 그 테스트가 렌더하는 화면만이 아니라 view 전수로 잠근다.
 * 3동작 뼈대: 준비=view 목록 → 실행=walk → 단언=금지 모듈 0.
 */
import fs from 'fs';
import path from 'path';

type Lib = {
  walk: (
    entries: string[],
    opts?: { dev?: boolean }
  ) => {
    seen: Map<string, string | null>;
    pkgs: Set<string>;
  };
};

const { walk } = jest.requireActual<Lib>('./boot-import-count.cjs');

const ROOT = path.resolve(__dirname, '..');

function findViews(dir: string): string[] {
  return fs
    .readdirSync(path.join(ROOT, dir), { withFileTypes: true })
    .flatMap((e) => {
      const rel = path.join(dir, e.name);
      if (e.isDirectory()) return findViews(rel);
      return /^index\.view\.tsx?$/.test(e.name) ? [rel] : [];
    });
}

const API = 'src/shared/api/';
const isNetworkFile = (rel: string) =>
  rel.startsWith(API) &&
  rel !== `${API}index.schemas.ts` &&
  !rel.startsWith(`${API}generated/schemas/`);
const NETWORK_PKGS = ['axios'];

/** 그 진입점이 끌어오는 네트워크 모듈(프로젝트 파일 + 패키지) — 비면 순수. */
function networkReach(entry: string): string[] {
  // dev: 프리뷰·jest 는 `__DEV__ = true` 라 운영에서 접히는 분기도 실제로 평가한다 — 접지 않고 따라간다(03b 경고-1).
  const { seen, pkgs } = walk([entry], { dev: true });
  const files = [...seen.keys()]
    .map((f) => path.relative(ROOT, f))
    .filter(isNetworkFile);
  return [...files, ...NETWORK_PKGS.filter((p) => pkgs.has(p))];
}

const VIEWS = findViews('src');

describe('index.view 순수성', () => {
  it('view 진입점을 찾는다(빈 목록 공허 통과 방지)', () => {
    expect(VIEWS.length).toBeGreaterThan(0);
  });

  // 탐지기 대조군 — 같은 슬라이스의 index.ts 는 네트워크 훅을 실어 걸려야 한다. 못 잡으면 아래 전수 단언이 공허하다.
  it('대조군: features/explore/index.ts 는 네트워크 계층에 닿는다', () => {
    expect(networkReach('src/features/explore/index.ts')).not.toEqual([]);
  });

  it.each(VIEWS)('%s 는 네트워크 계층을 끌지 않는다', (view) => {
    expect(networkReach(view)).toEqual([]);
  });
});
