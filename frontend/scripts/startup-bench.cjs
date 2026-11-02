#!/usr/bin/env node
/**
 * 콜드스타트 6구간 측정(TRIP-1717) — `pnpm bench:startup --label <이름> [--runs 11] [--out <dir>]`, 재집계는 `report <runs.json>`.
 * 앱(startupMarks)이 남긴 원자료 `Documents/startup-marks.json` 에서 S1~S6 을 이 파일이 계산한다(정의를 바꿔도 앱 재빌드 불필요).
 *
 * 측정 절차
 *  1. Release 빌드: `EXPO_PUBLIC_STARTUP_MARKS=1` 을 xcodebuild env 로 준다 — prebuild 만으로는 안 굽힌다(TRIP-1344).
 *     `cd ios && LANG=en_US.UTF-8 EXPO_PUBLIC_STARTUP_MARKS=1 SENTRY_DISABLE_AUTO_UPLOAD=true SENTRY_CLI_EXECUTABLE=<sentry-cli 실경로>
 *      IPHONEOS_DEPLOYMENT_TARGET=18.0 xcodebuild -workspace TripPilot.xcworkspace -scheme TripPilot -configuration Release
 *      -sdk iphonesimulator -derivedDataPath build-release` (SENTRY_CLI_EXECUTABLE·18.0 이유: 메모리 ios-run-xcode27-simulator)
 *  2. 설치: `xcrun simctl install booted ios/build-release/Build/Products/Release-iphonesimulator/TripPilot.app`
 *  3. 측정 전제: 로그인과 권한 안내를 이미 본 계정·HOME 이 목적지인 상태(아니면 그 회는 invalid). SIM_UDID 로 기기를 고른다(기본 booted).
 *  4. Release 숫자와 dev 숫자를 섞지 않는다 — 파일의 buildKind 가 섞이면 집계가 던진다.
 *  5. 첫 회는 예열이라 집계에서 뺀다. p90 은 최근접 순위 sorted[ceil(0.9n)-1] 이다(보간 없음).
 *  6. metro.config.js 의 inlineRequires 설정이 다른 빌드끼리는 구간 비교가 안 된다(점의 의미가 이동) — 총합만 비교한다.
 *  7. 시뮬레이터 부하가 숫자를 흔든다 — 회마다 loadAvg1 을 같이 저장하니 이상치는 그걸로 본다.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const BUNDLE_ID = 'com.trippilot.travel';
const NAMES = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6'];
const LABELS = {
  S1: 'S1 실행→JS 진입',
  S2: 'S2 JS 진입→루트 레이아웃',
  S3: 'S3 루트 레이아웃→마운트',
  S4: 'S4 마운트→부트스트랩 확정',
  S5: 'S5 확정→스플래시 해제',
  S6: 'S6 스플래시 해제→첫 프레임',
};
// 앞 점 → 뒤 점의 perfNow 차이가 S2~S6 이다.
const POINTS = [
  'jsEntry',
  'rootLayout',
  'rootMounted',
  'bootstrapResolved',
  'splashReleased',
  'firstFrame',
];

/** 앱 기록 + 호스트 실행 시각 → 6구간. ok / incomplete(못 쟀다) / invalid(HOME 첫 화면 아님). */
function segmentsOf(record, launchEpoch) {
  if (!record || !record.marks) {
    return { status: 'incomplete', reason: '앱 기록 없음(파일 없음·타임아웃)' };
  }
  const missing = POINTS.filter((p) => !record.marks[p]);
  if (missing.length) {
    return { status: 'incomplete', reason: `점 없음: ${missing.join(',')}` };
  }
  const m = record.marks;
  const segments = { S1: m.jsEntry.epoch - launchEpoch };
  POINTS.slice(1).forEach((p, i) => {
    segments[`S${i + 2}`] = m[p].perfNow - m[POINTS[i]].perfNow;
  });
  for (const n of NAMES) {
    if (!Number.isFinite(segments[n])) {
      return { status: 'incomplete', reason: `${n} 가 유한수 아님` };
    }
    if (segments[n] < 0) {
      return { status: 'incomplete', reason: `${n} 음수(${segments[n]})` };
    }
  }
  const detail = m.bootstrapResolved.detail || {};
  if (detail.destination !== 'HOME') {
    return {
      status: 'invalid',
      reason: `목적지 ${detail.destination} (HOME 아님)`,
    };
  }
  if (detail.isProvisional === true) {
    return { status: 'invalid', reason: '잠정 분기(부트스트랩 타임아웃)' };
  }
  return { status: 'ok', segments };
}

/** 최근접 순위 백분위 — sorted[ceil(p·n)-1]. 1e-9 는 0.7*10 같은 부동소수 오차로 ceil 이 한 칸 튀는 것을 막는다. */
function percentile(values, p) {
  if (!values.length) throw new Error('percentile: 빈 입력');
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil(p * sorted.length - 1e-9) - 1;
  return sorted[Math.min(sorted.length - 1, Math.max(0, idx))];
}

/** 예열(첫 회) 제외 후 ok 회만 모아 [{segments}] 로 — summarize 와 합계 계산이 같이 쓴다. */
function analyze(runs) {
  const kinds = new Set(
    runs.filter((r) => r.record).map((r) => r.record.buildKind)
  );
  if (kinds.size > 1) {
    throw new Error(
      `buildKind 가 섞였다: ${[...kinds].join(', ')} — dev 와 release 를 같이 집계하지 않는다`
    );
  }
  const counts = {
    warmupExcluded: Math.min(1, runs.length),
    ok: 0,
    incomplete: 0,
    invalid: 0,
  };
  const oks = [];
  for (const r of runs.slice(1)) {
    const v = segmentsOf(r.record, r.launchEpoch);
    counts[v.status] += 1;
    if (v.status === 'ok') oks.push(v.segments);
  }
  if (!oks.length) throw new Error('ok 회가 0 이다 — 집계할 수 없다');
  return { buildKind: [...kinds][0], counts, oks };
}

const stat = (xs) => ({
  p50: percentile(xs, 0.5),
  p90: percentile(xs, 0.9),
  min: Math.min(...xs),
  max: Math.max(...xs),
});

function summarize(runs) {
  const { buildKind, counts, oks } = analyze(runs);
  const segments = {};
  for (const n of NAMES) segments[n] = stat(oks.map((s) => s[n]));
  return { buildKind, counts, segments };
}

function renderMarkdown(runs) {
  const { buildKind, counts, oks } = analyze(runs);
  const summary = summarize(runs);
  const total = stat(oks.map((s) => NAMES.reduce((a, n) => a + s[n], 0))); // 합계는 회별 합의 분포다(구간 p 의 합이 아니다).
  const row = (name, s) =>
    `| ${name} | ${[s.p50, s.p90, s.min, s.max].map(Math.round).join(' | ')} |`;
  return [
    `buildKind: ${buildKind} · n(ok)=${counts.ok} · 예열 제외 ${counts.warmupExcluded} · incomplete ${counts.incomplete} · invalid ${counts.invalid}`,
    'p90 = 최근접 순위 sorted[ceil(0.9n)-1] · 단위 ms(정수 반올림)',
    '',
    '| 구간 | p50 | p90 | min | max |',
    '|---|---|---|---|---|',
    ...NAMES.map((n) => row(LABELS[n], summary.segments[n])),
    row('합계(S1..S6)', total),
  ].join('\n');
}

// ── CLI (모듈로 읽힐 땐 실행 안 됨) ────────────────────────────────

const sleep = (ms) =>
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const simctl = (...args) =>
  spawnSync('xcrun', ['simctl', ...args], { encoding: 'utf8' });

function report(runs) {
  runs.forEach((r, i) => {
    const v = segmentsOf(r.record, r.launchEpoch);
    console.log(
      `#${i}${i === 0 ? '(예열)' : ''} ${v.status}${v.reason ? ' — ' + v.reason : ''}`
    );
  });
  console.log('\n' + renderMarkdown(runs));
  // 표본이 빠진 표를 기준선으로 쓰지 않게 — 무효·불완전 회가 하나라도 있으면 종료 코드 1(03b W2).
  const { counts } = summarize(runs);
  if (counts.incomplete + counts.invalid > 0) {
    console.error(
      `⚠️ incomplete ${counts.incomplete} · invalid ${counts.invalid} — 기준선으로 쓰지 말고 원인을 보고 다시 잰다`
    );
    process.exitCode = 1;
  }
}

function measure(label, n, outDir) {
  const udid = process.env.SIM_UDID || 'booted';
  const got = simctl('get_app_container', udid, BUNDLE_ID, 'data');
  if (got.status !== 0)
    throw new Error(`앱 컨테이너를 못 찾았다(설치됐나?): ${got.stderr}`);
  const file = path.join(got.stdout.trim(), 'Documents', 'startup-marks.json');
  const runs = [];
  for (let i = 0; i < n; i++) {
    simctl('terminate', udid, BUNDLE_ID); // 안 떠 있으면 실패해도 무시.
    fs.rmSync(file, { force: true });
    sleep(1000);
    const launchEpoch = Date.now();
    simctl('launch', udid, BUNDLE_ID);
    let record = null;
    for (let waited = 0; waited < 20000 && !record; waited += 200) {
      sleep(200);
      try {
        record = JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch {
        // 파일 없음 또는 쓰는 도중 — 다음 폴링에서 다시 읽는다.
      }
    }
    runs.push({ i, launchEpoch, loadAvg1: os.loadavg()[0], record });
    sleep(2000);
  }
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, `${label}.json`),
    JSON.stringify(runs, null, 2)
  );
  report(runs);
}

function main() {
  const argv = process.argv.slice(2);
  const flag = (name, fallback) => {
    const at = argv.indexOf(name);
    return at >= 0 ? argv[at + 1] : fallback;
  };
  try {
    if (argv[0] === 'report')
      return report(JSON.parse(fs.readFileSync(argv[1], 'utf8')));
    const label = flag('--label');
    if (!label)
      throw new Error(
        '사용: --label <이름> [--runs 11] [--out <dir>] | report <runs.json>'
      );
    measure(
      label,
      Number(flag('--runs', 11)),
      flag('--out', path.join(__dirname, '../../_workspace/startup-bench'))
    );
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}

module.exports = { segmentsOf, percentile, summarize, renderMarkdown };

if (require.main === module) main();
