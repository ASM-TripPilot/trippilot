import { getOAuthConfig } from './oauthConfig';

/**
 * AC-S4 · getOAuthConfig — kakao·naver authorize 설정 (결함 C).
 *
 * 무엇을 보장하나: env 를 채우면 kakao·naver 도 google 처럼 인가 요청을 구성할 수 있는
 * clientId·discovery(authorize/token 엔드포인트)·usePKCE·requiresState 를 돌려준다.
 * naver 는 PKCE 를 지원하지 않으므로(가이드 §5) usePKCE:false + requiresState:true 가
 * naver 에서만 갈라져야 한다(AC-S4 대조쌍). apple 은 이번 범위 밖이라 빈 슬롯을 유지한다.
 *
 * env 규율(§7-7 실측: jest 프로세스에는 .env.local 이 실리지 않는다): 대상 키의 원본을
 * 저장해두고 afterEach 에서 되돌린다 — 기존 makeAuthorize.realOauth.test.ts 의 ORIGINAL_ENV
 * 패턴을 그대로 따른다.
 *
 * 3동작: 준비(env set) → 실행(getOAuthConfig(provider)) → 단언(필드별 값).
 */

const ENV_KEYS = [
  'EXPO_PUBLIC_GOOGLE_CLIENT_ID',
  'EXPO_PUBLIC_GOOGLE_REDIRECT_URI',
  'EXPO_PUBLIC_GOOGLE_SCOPES',
  'EXPO_PUBLIC_KAKAO_CLIENT_ID',
  'EXPO_PUBLIC_KAKAO_REDIRECT_URI',
  'EXPO_PUBLIC_NAVER_CLIENT_ID',
  'EXPO_PUBLIC_NAVER_REDIRECT_URI',
] as const;

const ORIGINAL_ENV: Record<string, string | undefined> = {};
for (const key of ENV_KEYS) {
  ORIGINAL_ENV[key] = process.env[key];
}

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (ORIGINAL_ENV[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = ORIGINAL_ENV[key];
    }
  }
});

describe('getOAuthConfig — kakao (AC-S4 · 결함 C · 케이스 15)', () => {
  it('env 주입 시 kakao clientId·discovery(kauth.kakao.com)·usePKCE:true·requiresState:false 를 채운다', () => {
    // 준비 — 팀이 전달한 kakao clientId 가 주입됐다고 가정한다.
    process.env.EXPO_PUBLIC_KAKAO_CLIENT_ID = 'test-kakao-id';

    // 실행
    const config = getOAuthConfig('kakao');

    // 단언 — 지금은 kakao 가 빈 슬롯이고 usePKCE/requiresState 필드 자체가 없어 실패한다.
    expect(config.clientId).toBe('test-kakao-id');
    expect(config.discovery.authorizationEndpoint).toMatch(
      /^https:\/\/kauth\.kakao\.com\//
    );
    // token-uri 는 백엔드 application.yml 실측값과 동일해야 한다(리포 정본).
    expect(config.discovery.tokenEndpoint).toBe(
      'https://kauth.kakao.com/oauth/token'
    );
    expect(config.usePKCE).toBe(true);
    expect(config.requiresState).toBe(false);
    // authorize 경로는 제공자 문서값이라 전체 URL을 못박지 않는다 — 호스트+https 만 잠근다(J4).
    expect(config.discovery.authorizationEndpoint).not.toBe('');
  });
});

describe('getOAuthConfig — naver (AC-S4 · 결함 C · naver PKCE 미지원 · 케이스 16)', () => {
  it('env 주입 시 naver clientId·discovery(nid.naver.com) 를 채우고 PKCE 를 끈다', () => {
    // 준비
    process.env.EXPO_PUBLIC_NAVER_CLIENT_ID = 'test-naver-id';

    // 실행
    const config = getOAuthConfig('naver');

    // 단언 — naver 는 PKCE 미지원이라 usePKCE:false, state 필수라 requiresState:true 여야 한다.
    expect(config.clientId).toBe('test-naver-id');
    expect(config.discovery.authorizationEndpoint).toMatch(
      /^https:\/\/nid\.naver\.com\//
    );
    expect(config.discovery.tokenEndpoint).toBe(
      'https://nid.naver.com/oauth2.0/token'
    );
    expect(config.usePKCE).toBe(false);
    expect(config.requiresState).toBe(true);
  });
});

describe('getOAuthConfig — google (AC-S4 · 필드 신설 회귀 가드 · 케이스 17)', () => {
  it('google 은 usePKCE:true·requiresState:false 를 유지하고 기존 필드를 보존한다', () => {
    // 준비
    process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID = 'test-google-id';

    // 실행
    const config = getOAuthConfig('google');

    // 단언 — 신규 필드(usePKCE·requiresState)가 없으면 이 단언 자체가 컴파일도 되지만 값
    // 비교에서 실패한다(undefined !== true). 기존 값(authorizationEndpoint·scopes 기본값)도
    // 그대로 보존되어야 한다(회귀 가드).
    expect(config.usePKCE).toBe(true);
    expect(config.requiresState).toBe(false);
    expect(config.clientId).toBe('test-google-id');
    expect(config.discovery.authorizationEndpoint).toBe(
      'https://accounts.google.com/o/oauth2/v2/auth'
    );
    expect(config.scopes).toEqual(['openid', 'profile', 'email']);
  });
});

describe('getOAuthConfig — apple (AC-S4 · 범위 밖 유지 · 케이스 18)', () => {
  it('apple 은 여전히 빈 슬롯이다 — 범위 밖 provider 를 몰래 켜지 않는다', () => {
    // 준비 — apple 관련 env 는 없다(이번 범위 밖 · Seed §8 Q7).
    // 실행 + 단언
    const config = getOAuthConfig('apple');
    expect(config.clientId).toBe('');
    expect(config.discovery.authorizationEndpoint).toBe('');
  });
});

describe('getOAuthConfig — env 미주입 (AC-S4 · INV-4 근거 · 케이스 19)', () => {
  it.each(['kakao', 'naver'] as const)(
    '%s clientId 는 env 가 없으면 빈 문자열이다(빈 값으로 실 OAuth 시도 금지)',
    (provider) => {
      // 준비 — kakao/naver env 를 지운다.
      delete process.env.EXPO_PUBLIC_KAKAO_CLIENT_ID;
      delete process.env.EXPO_PUBLIC_NAVER_CLIENT_ID;

      // 실행 + 단언 — 빈 값이면 makeAuthorize 가 throw 할 근거가 된다(INV-4).
      expect(getOAuthConfig(provider).clientId).toBe('');
    }
  );
});

describe('getOAuthConfig — 호출 시점 평가 (AC-S4 · 캐시 금지 · 케이스 20)', () => {
  it('env 를 모듈 스코프에 캐시하지 않고 호출마다 다시 읽는다', () => {
    // 준비 + 실행 1 — 첫 값으로 호출.
    process.env.EXPO_PUBLIC_KAKAO_CLIENT_ID = 'A';
    expect(getOAuthConfig('kakao').clientId).toBe('A');

    // 실행 2 — 같은 프로세스 안에서 env 를 바꾸고 다시 호출한다.
    // 모듈 스코프 상수로 캐시했다면 여기서 여전히 'A' 가 나와 실패한다.
    process.env.EXPO_PUBLIC_KAKAO_CLIENT_ID = 'B';
    expect(getOAuthConfig('kakao').clientId).toBe('B');
  });
});
