import * as homeFixtures from './homeFixtures';
import { HOME_DEFAULT_PROPS } from './homeFixtures';
import * as phaseFixtures from './__fixtures__/homePhaseFixtures';

// TRIP-1616 — 단계별 홈 상수(로딩·계획 중·여행 중·여행 후)는 프리뷰·테스트 전용이라 `__fixtures__` 로 옮겼다.
// 운영 번들은 `__fixtures__` 를 metro blockList 로 막으므로, 운영 파일(homeFixtures)에 이 상수가 되돌아오면
// 운영 export 가 깨진다 — 그 전에 여기서 먼저 빨개지게 한다.
// (B안 2026-11-01 — 화면이 아니라 모듈 계약이라 `HomeScreen.test.tsx` 에서 소스 옆으로 옮겼다.)
describe('홈 상수 배치 — 운영 기본값과 프리뷰 전용 상수를 파일로 가른다', () => {
  it('운영 파일(homeFixtures)이 런타임으로 내보내는 것은 HOME_DEFAULT_PROPS 하나뿐이다', () => {
    const exported = Object.keys(homeFixtures);

    expect(exported).toEqual(['HOME_DEFAULT_PROPS']);
    expect(homeFixtures.HOME_DEFAULT_PROPS.hero.length).toBeGreaterThan(0);
  });

  it('단계별 4상수는 프리뷰 전용 파일에 있고, hero·sections 는 운영 기본값과 같은 참조에서 파생한다', () => {
    const {
      HOME_LOADING_PROPS: loading,
      HOME_PLANNING_PROPS: planning,
      HOME_TRAVELING_PROPS: traveling,
      HOME_POST_TRIP_PROPS: postTrip,
    } = phaseFixtures;

    expect(planning.phase?.kind).toBe('planning');
    expect(traveling.phase?.kind).toBe('planning');
    expect(postTrip.phase?.kind).toBe('postTrip');
    [loading, planning, traveling, postTrip].forEach((props) => {
      expect(props.hero).toBe(HOME_DEFAULT_PROPS.hero);
    });
    expect(loading.sections).toEqual({ kind: 'loading' });
    [planning, traveling, postTrip].forEach((props) => {
      expect(props.sections).toBe(HOME_DEFAULT_PROPS.sections);
    });
  });

  it('여행 후 얼굴의 추천 카드는 운영 기본 컬렉션 3장과 같다(파생이 끊기면 red)', () => {
    const base = HOME_DEFAULT_PROPS.sections;
    if (base.kind !== 'ready')
      throw new Error('기본 sections 가 ready 가 아니다');

    const phase = phaseFixtures.HOME_POST_TRIP_PROPS.phase;
    expect(phase?.kind).toBe('postTrip');
    if (phase?.kind !== 'postTrip') return;
    expect(phase.recommendations).toHaveLength(3);
    expect(phase.recommendations).toEqual(base.collections);
  });

  // TRIP-1432 — 히어로 데이터는 서울 11 · 부산 26 · 제주 50 순서이고, 각 카드는 그 도시 hero/(세로 6:7) 그림을 싣는다
  // (여행 카드용 covers/(가로 3:2) 그림이 아니다). jest 의 에셋 require 는 같은 파일이면 같은 객체다.
  it('히어로 데이터는 서울 11 · 부산 26 · 제주 50 순서이고, 각 카드는 그 도시 hero/ 그림을 싣는다', () => {
    const heroCovers = [
      require('../../../../assets/region-covers/hero/11.webp'),
      require('../../../../assets/region-covers/hero/26.webp'),
      require('../../../../assets/region-covers/hero/50.webp'),
    ];
    const tripCovers = [
      require('../../../../assets/region-covers/covers/11.webp'),
      require('../../../../assets/region-covers/covers/26.webp'),
      require('../../../../assets/region-covers/covers/50.webp'),
    ];
    const hero = HOME_DEFAULT_PROPS.hero;

    expect(hero.map((card) => card.regionCode)).toEqual(['11', '26', '50']);
    hero.forEach((card, i) => {
      expect(card.coverSource).toBe(heroCovers[i]);
      expect(card.coverSource).not.toBe(tripCovers[i]);
    });
  });
});
