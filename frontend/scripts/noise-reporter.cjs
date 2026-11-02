/**
 * 테스트 로그 소음 예산 reporter(TRIP-1624) — jest 가 실행 끝에 결과를 넘겨 주는 플러그인.
 * 파일마다 `testResult.console` 을 쌓아 두었다가 `onRunComplete` 에서 한 번 판정·출력한다.
 * 예산을 넘으면 `getLastError()` 가 Error 를 돌려줘 테스트가 전부 통과해도 jest 종료코드가 1 이 된다.
 * 판정 로직은 `noise-budget.cjs`(테스트: `noiseBudget.test.ts`).
 */
const {
  BUDGETS,
  aggregate,
  describeBlindRun,
  judgeBudget,
  renderReport,
} = require('./noise-budget.cjs');

module.exports = class NoiseReporter {
  constructor(globalConfig, options) {
    const bucket = options && options.bucket;
    if (!Object.prototype.hasOwnProperty.call(BUDGETS, bucket ?? '')) {
      throw new Error(
        `noise-reporter: options.bucket 은 ${Object.keys(BUDGETS).join('·')} 중 하나여야 한다 (받은 값: ${String(bucket)})`
      );
    }
    this.globalConfig = globalConfig;
    this.bucket = bucket;
    this.results = [];
    this.error = undefined;
  }

  onTestResult(_test, testResult) {
    this.results.push({
      file: testResult.testFilePath,
      console: testResult.console,
    });
  }

  onRunComplete() {
    const blind = describeBlindRun(this.globalConfig);
    if (blind) {
      process.stderr.write(`[소음 예산:${this.bucket}] 판정 생략 — ${blind}\n`);
      return;
    }
    const budget = BUDGETS[this.bucket];
    const { totals, files } = aggregate(this.results);
    process.stderr.write(
      renderReport({
        bucket: this.bucket,
        budget,
        totals,
        files,
        rootDir: this.globalConfig.rootDir,
      })
    );
    const { over } = judgeBudget(totals, budget);
    if (over.length > 0) {
      this.error = new Error(
        `소음 예산 초과: ${over
          .map((o) => `${o.category} ${o.actual} > ${o.allowed}`)
          .join(', ')}`
      );
    }
  }

  getLastError() {
    return this.error;
  }
};
