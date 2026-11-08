#!/usr/bin/env node
// Maestro E2E 러너 — 로컬 docker 백엔드(localhost:8080 · trippilot-db) 전용. 운영·개발 서버에는 절대 붙지 않는다.
// 로그인: 앱에 우회 경로를 두지 않고, 로컬 DB 에 refresh_session 을 심어 /auth/token/refresh 로 진짜 토큰을 받은 뒤
// Metro CDP 로 앱 저장소에 넣는다. 그래서 dev build + Metro 가 있어야 하고 Release 빌드에는 쓸 수 없다.
// 사용: pnpm e2e [흐름 이름 …] [--repeat=3]   환경: OUT(결과 폴더, 기본 임시 폴더)
// 라운드마다 새 계정을 만든다 — 앞 라운드의 여행·AI 일일 한도가 다음 라운드에 새지 않는다.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  appendFileSync,
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  realpathSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const APP_ID = 'com.trippilot.travel';
const API = 'http://localhost:8080/api/v1';
const FLOW_DIR = new URL('.', import.meta.url).pathname;
const FLOW_TIMEOUT_MS = 15 * 60 * 1000; // 실패 세션 sysdiagnose 지연(Maestro #3633) 대비 — 넘으면 FAIL

const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10); // KST — 서버 오늘과 같은 존
const plusDays = (date, n) =>
  new Date(Date.parse(date) + n * 86400e3).toISOString().slice(0, 10);

const sql = (q) =>
  execFileSync(
    'docker',
    [
      'exec',
      'trippilot-db',
      'psql',
      '-U',
      'postgres',
      '-d',
      'trippilot',
      '-Atqc',
      q,
    ],
    { encoding: 'utf8' }
  ).trim();

async function call(method, path, token, body) {
  const res = await fetch(API + path, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok)
    throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

async function tokensFor(accountId) {
  const raw = randomBytes(32).toString('base64url');
  const hash = createHash('sha256').update(raw).digest('hex');
  sql(
    `INSERT INTO app.refresh_session (account_id, device_id, token_hash, chain_id, expires_at) VALUES ('${accountId}', 'e2e-local', '${hash}', gen_random_uuid(), now() + interval '1 day')`
  );
  return call('POST', '/auth/token/refresh', null, { refreshToken: raw });
}

/** 온보딩을 마친 새 계정 + 편집 흐름용 AI 일정(미확정) 여행을 만든다. */
async function seed() {
  const accountId = sql(
    `INSERT INTO app.account (age_method, age_confirmed_at, verified_at) VALUES ('SELF_DECLARED', now(), now()) RETURNING account_id`
  ).split('\n')[0];
  const { accessToken: t } = await tokensFor(accountId);
  await call('POST', '/me/consents', t, {
    consents: ['TERMS_OF_SERVICE', 'PRIVACY_POLICY', 'LOCATION_TERMS'].map(
      (termsType) => ({ termsType, termsVersion: '1.0', action: 'GRANT' })
    ),
  });
  await call('PATCH', '/me/profile/nickname', t, {
    nickname: `e2e${randomBytes(3).toString('hex')}`,
  });
  await call('POST', '/onboarding/complete', t);

  const start = plusDays(today, 30);
  const { tripId } = await call('POST', '/trips', t, {
    title: 'E2E 편집',
    startDate: start,
    endDate: plusDays(start, 1),
    party: 1,
    preferenceSnapshot: {},
    destinations: [{ seq: 0, region: '제주', nights: 1 }],
  });
  await call('POST', `/trips/${tripId}/itinerary`, t, {
    generationMode: 'FULLY_AI',
  });
  let itinerary;
  for (let i = 0; i < 120 && itinerary?.generationState !== 'COMPLETE'; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    itinerary = await call('GET', `/trips/${tripId}/itinerary`, t).catch(
      () => null
    );
    if (itinerary?.generationState === 'FAILED')
      throw new Error(`시드 일정 생성 실패 ${tripId}`);
  }
  const slots = itinerary?.days?.[0]?.slots ?? [];
  if (slots.length < 2)
    throw new Error(
      `시드 일정 1일차가 2곳 미만이다: ${JSON.stringify(itinerary).slice(0, 300)}`
    );
  const slotKey = (s) => `${itinerary.days[0].date}#${s.poiId}`;
  return {
    accountId,
    env: {
      EDIT_TRIP_ID: tripId,
      EDIT_SLOT_1: slotKey(slots[0]),
      EDIT_SLOT_2: slotKey(slots[1]),
    },
  };
}

function cdp(expression, awaitPromise = false) {
  return fetch('http://localhost:8081/json/list')
    .then((r) => r.json())
    .then(
      (targets) =>
        new Promise((resolve, reject) => {
          if (!targets.length)
            return reject(new Error('Metro 에 붙은 앱이 없다'));
          const ws = new WebSocket(targets[0].webSocketDebuggerUrl);
          const timer = setTimeout(() => {
            ws.close();
            reject(new Error('CDP 응답 없음'));
          }, 8000);
          ws.addEventListener('message', (ev) => {
            const m = JSON.parse(ev.data);
            if (m.id !== 2) return;
            clearTimeout(timer);
            ws.close();
            if (m.result?.exceptionDetails)
              reject(
                new Error(
                  JSON.stringify(m.result.exceptionDetails).slice(0, 400)
                )
              );
            else resolve(m.result?.result?.value);
          });
          ws.addEventListener('open', () => {
            ws.send(JSON.stringify({ id: 1, method: 'Runtime.enable' }));
            ws.send(
              JSON.stringify({
                id: 2,
                method: 'Runtime.evaluate',
                params: { expression, returnByValue: true, awaitPromise },
              })
            );
          });
          ws.addEventListener('error', () => {
            clearTimeout(timer);
            reject(new Error('CDP 연결 실패'));
          });
        })
    );
}

const FIND_MODULES = `var ids={};__r.getModules().forEach(function(m,k){var v=m&&m.verboseName;if(!v)return;
  if(/src\\/shared\\/storage\\/index\\.ts$/.test(v))ids.storage=k;
  if(/src\\/shared\\/api\\/tokenManager\\.ts$/.test(v))ids.manager=k;
  if(/src\\/shared\\/api\\/index\\.ts$/.test(v))ids.api=k;});`;

/** 앱을 다시 띄워 Metro 에 붙었는지·로컬 백엔드를 보는지 확인한다 — 시드 전에 불러 어긋나면 아무것도 안 만든다. */
async function launchAndProbe() {
  spawnSync('xcrun', ['simctl', 'terminate', 'booted', APP_ID]);
  execFileSync('xcrun', ['simctl', 'launch', 'booted', APP_ID], {
    stdio: 'ignore',
  });
  let probe;
  for (let i = 0; i < 90 && !probe; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    probe = await cdp(
      `(function(){${FIND_MODULES}return ids.storage!=null&&ids.manager!=null&&ids.api!=null?JSON.stringify({ids:ids,base:__r(ids.api).API_BASE_URL}):null;})()`
    )
      .then((v) => v && JSON.parse(v))
      .catch(() => null);
  }
  if (!probe)
    throw new Error(
      '앱이 Metro 에 붙지 않는다 — frontend 에서 `pnpm start` 후 dev build 를 띄운다'
    );
  // 로컬 토큰을 다른 서버를 보는 앱에 넣지 않는다 — 넣어 봐야 401 이고 그 앱의 세션만 날린다.
  if (probe.base !== API)
    throw new Error(
      `앱이 로컬 백엔드를 안 본다: ${probe.base} — .env.local 의 EXPO_PUBLIC_API_BASE_URL=http://localhost:8080 후 Metro 재시작`
    );
  return probe;
}

/** 저장소에 토큰을 넣는다. 흐름의 launchApp 이 앱을 재시작하면 저장소에서 복원돼 로그인 상태로 뜬다. */
async function login(probe, accountId) {
  const { accessToken, refreshToken } = await tokensFor(accountId);
  await cdp(
    `__r(${probe.ids.storage}).saveTokens(${JSON.stringify({ accessToken, refreshToken })}).then(function(){__r(${probe.ids.manager}).setAccessToken(${JSON.stringify(accessToken)});return 'ok';})`,
    true
  );
}

// 기간 시트는 오늘 달에서 열린다 — 다음 달 15일이면 언제 돌려도 미래이고 [다음 달] 한 번으로 닿는다.
function wizardDate() {
  const d = new Date(Date.parse(today));
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(15);
  return d.toISOString().slice(0, 10);
}

const args = process.argv.slice(2);
const repeat = Number(
  args.find((a) => a.startsWith('--repeat='))?.split('=')[1] ?? 1
);
const allFlows = readdirSync(FLOW_DIR)
  .filter((f) => f.endsWith('.yaml'))
  .map((f) => f.replace(/\.yaml$/, ''));
const picked = args.filter((a) => !a.startsWith('--'));
const unknown = picked.filter((f) => !allFlows.includes(f));
if (unknown.length)
  throw new Error(
    `없는 흐름: ${unknown.join(', ')} (있는 것: ${allFlows.join(', ')})`
  );
const flows = picked.length ? picked : allFlows;
if (!Number.isInteger(repeat) || repeat < 1 || !flows.length)
  throw new Error(`돌릴 게 없다: --repeat=${repeat}, 흐름 ${flows.length}개`);

// 8081 은 워크트리별로 안 갈린다 — 다른 워크트리 번들로 돈 결과를 이 브랜치의 PASS 로 찍지 않는다.
const metroPid = spawnSync('lsof', ['-ti', ':8081', '-sTCP:LISTEN'], {
  encoding: 'utf8',
}).stdout.split('\n')[0];
if (!metroPid)
  throw new Error('Metro 8081 이 없다 — frontend 에서 `pnpm start`');
const metroCwd = execFileSync(
  'lsof',
  ['-a', '-p', metroPid, '-d', 'cwd', '-Fn'],
  {
    encoding: 'utf8',
  }
).match(/^n(.+)$/m)?.[1];
if (metroCwd !== realpathSync(join(FLOW_DIR, '..')))
  throw new Error(`Metro 가 다른 워크트리를 서빙한다: ${metroCwd}`);

const out = process.env.OUT ?? mkdtempSync(join(tmpdir(), 'trippilot-e2e-'));
mkdirSync(out, { recursive: true });
const summary = join(out, 'summary.tsv');
const env = {
  ...process.env,
  JAVA_HOME: process.env.JAVA_HOME ?? '/opt/homebrew/opt/openjdk@25',
  MAESTRO_CLI_NO_ANALYTICS: '1',
};
let failed = 0;

for (let round = 1; round <= repeat; round++) {
  const probe = await launchAndProbe();
  const { accountId, env: seeded } = await seed();
  await login(probe, accountId);
  const date = wizardDate();
  const vars = {
    ...seeded,
    WIZARD_DATE: date,
    WIZARD_MONTH: Number(date.slice(5, 7)),
  };
  // 흐름은 하나씩 띄운다 — 폴더째 돌리면 iOS 26 에서 둘째 흐름부터 드라이버가 죽는다(Maestro #3318).
  for (const flow of flows) {
    const dir = join(out, `round${round}`, flow);
    mkdirSync(dir, { recursive: true });
    const log = openSync(join(dir, 'maestro.log'), 'w');
    const started = Date.now();
    const { status } = spawnSync(
      'maestro',
      [
        'test',
        ...Object.entries(vars).flatMap(([k, v]) => ['-e', `${k}=${v}`]),
        '--test-output-dir',
        dir,
        join(FLOW_DIR, `${flow}.yaml`),
      ],
      { env, stdio: ['ignore', log, log], timeout: FLOW_TIMEOUT_MS }
    );
    closeSync(log);
    const line = `${round}\t${flow}\t${status === 0 ? 'PASS' : 'FAIL'}\t${Math.round((Date.now() - started) / 1000)}s`;
    if (status !== 0) failed++;
    appendFileSync(summary, `${line}\n`);
    console.log(line);
  }
}
console.log(`결과: ${out}`);
process.exit(failed ? 1 : 0);
