#!/usr/bin/env node
// 웹 QA 드라이버 — Aside(크로미움) 디버깅 포트에 붙어 모바일 뷰로 웹 앱을 조작한다. agent-device 의 웹 짝.
//   서버: node web.mjs serve [url]      (백그라운드로 띄운다 — 탭·에뮬레이션을 세션 동안 쥔다)
//   조작: node web.mjs <명령> [인자…]   (서버에 HTTP 로 보낸다)
//     tree [정규식필터]      testID(data-testid)·라벨·문구와 중심 좌표 목록
//     press <testID|"text:문구"|x,y>   그 요소 중심을 터치
//     fill <testID> <글>     입력칸에 글 넣기   ·  key <Enter|Escape|Backspace>
//     swipe x1 y1 x2 y2 [ms] ·  scroll <testID|-> <dy>
//     geo <lat> <lng>  위치 권한 허용 + 좌표 고정
//     nav <url|/경로>  ·  back  ·  reload  ·  url  ·  shot <파일.png>  ·  eval '<js>'  ·  console(최근 오류)
//     fail <경로glob> <status|net> [본문JSON]  GET 응답을 가짜로(본문 기본 = 백엔드 ErrorResponse 봉투) · net = 네트워크 실패
//     delay <경로glob> <ms>  ·  fail-list(규칙·맞은 횟수)  ·  fail-clear   — 규칙은 서버 메모리에만, 끄면 사라진다
//       glob: 경로(pathname)에만 맞춘다. * = 한 마디(/ 제외), ** = 여러 마디. 예 /api/trips/*/itinerary**
// 환경: CDP=http://[::1]:9333 (Aside), PORT=9444, 뷰 412×915 (갤럭시급 안드로이드 크롬)
import http from 'node:http';
const CDP = process.env.CDP ?? 'http://[::1]:9333';
const PORT = Number(process.env.PORT ?? 9444);
const [cmd, ...args] = process.argv.slice(2);

if (cmd !== 'serve') {
  const res = await fetch(`http://127.0.0.1:${PORT}/`, { method: 'POST', body: JSON.stringify({ cmd, args }) }).catch(() => null);
  if (!res) { console.error(`서버가 없다 — node web.mjs serve 를 먼저 백그라운드로`); process.exit(2); }
  const out = await res.text(); console.log(out); process.exit(res.ok ? 0 : 1);
}

const start = args[0] ?? 'https://app.trippilot.co.kr/';
const W = 412, H = 915;
const UA = 'Mozilla/5.0 (Linux; Android 14; SM-S921N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Mobile Safari/537.36';
// 갈래마다 새 창으로 연다 — 같은 창의 뒤쪽 탭은 렌더가 멈춰 터치·스크린샷이 걸린다(실측).
const bws = new WebSocket((await (await fetch(`${CDP}/json/version`)).json()).webSocketDebuggerUrl);
await new Promise((r) => (bws.onopen = r));
const targetId = await new Promise((r) => { bws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id === 1) r(d.result.targetId); }; bws.send(JSON.stringify({ id: 1, method: 'Target.createTarget', params: { url: 'about:blank', newWindow: true } })); });
bws.close();
const created = (await (await fetch(`${CDP}/json`)).json()).find((t) => t.id === targetId);
const ws = new WebSocket(created.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map(); const logs = [];
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); return; }
  if (d.method === 'Runtime.exceptionThrown') logs.push('EXC ' + (d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text).slice(0, 300));
  if (d.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(d.params.type))
    logs.push(d.params.type + ' ' + d.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300));
  if (d.method === 'Network.loadingFailed' && !d.params.canceled) logs.push('NETFAIL ' + d.params.errorText);
  if (d.method === 'Network.responseReceived' && d.params.response.status >= 400) logs.push(`HTTP ${d.params.response.status} ${d.params.response.url.slice(0, 160)}`);
  if (d.method === 'Fetch.requestPaused') onPaused(d.params).catch((e) => logs.push('FAULT ' + e.message));
  if (logs.length > 200) logs.shift();
};
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); }).then((d) => { if (d.error) throw new Error(`${method}: ${d.error.message}`); return d.result; });
const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2.625, mobile: true });
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await send('Emulation.setUserAgentOverride', { userAgent: UA, platform: 'Android' });
await send('Page.bringToFront');
await send('Page.navigate', { url: start });

const TREE = `(() => { const out = []; const seen = new Set();
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth ? r : null; };
  for (const e of document.querySelectorAll('[data-testid],[role=button],button,a,input,textarea,[aria-label]')) {
    const r = vis(e); if (!r) continue;
    const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); if (top && !e.contains(top) && !top.contains(e)) continue; // 다른 화면 아래 깔린 요소는 뺀다
    const tid = e.getAttribute('data-testid') ?? ''; const lab = e.getAttribute('aria-label') ?? '';
    const txt = (e.value ?? e.innerText ?? '').replace(/\\s+/g, ' ').trim().slice(0, 50);
    const k = tid + '|' + Math.round(r.x) + ',' + Math.round(r.y); if (seen.has(k)) continue; seen.add(k);
    const st = [e.getAttribute('aria-selected') === 'true' && 'selected', e.getAttribute('aria-checked') === 'true' && 'checked', e.getAttribute('aria-disabled') === 'true' && 'disabled'].filter(Boolean).join(',');
    out.push((tid ? '#' + tid + ' ' : '') + (e.getAttribute('role') ?? e.tagName.toLowerCase()) + (lab ? ' [' + lab.slice(0, 40) + ']' : '') + (txt ? ' "' + txt + '"' : '') + (st ? ' {' + st + '}' : '') + ' @' + Math.round(r.x + r.width / 2) + ',' + Math.round(r.y + r.height / 2));
  } return out.join('\\n'); })()`;
// 스택 아래 화면이 DOM 에 남아 같은 testID 가 여럿이다(실측) — 크기가 있는 첫 요소를 고른다.
const BYID = (sel) => `[...document.querySelectorAll('[data-testid=' + CSS.escape(${JSON.stringify(sel)}) + ']')].find((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; })`;
const locate = (sel) => {
  if (/^\d+,\d+$/.test(sel)) { const [x, y] = sel.split(',').map(Number); return Promise.resolve({ x, y }); }
  const q = sel.startsWith('text:') ? `[...document.querySelectorAll('[role=button],button,a,[data-testid],div,span')].filter(e=>e.innerText&&e.innerText.trim()===${JSON.stringify(sel.slice(5))}).sort((a,b)=>a.getBoundingClientRect().width*a.getBoundingClientRect().height-b.getBoundingClientRect().width*b.getBoundingClientRect().height)[0]` : BYID(sel);
  return ev(`(() => { const e = ${q}; if (!e) return null; e.scrollIntoView({block:'nearest'}); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
};
// 터치·스와이프는 페이지 안에서 포인터 이벤트를 합성한다 — CDP Input.dispatch* 는 가려진/뒤쪽 창에서
// 렌더 프레임을 기다리며 무기한 멈춘다(실측). RN web Pressable·제스처 핸들러는 합성 포인터 이벤트에 반응한다.
const PTR = `window.__ptr = (type, x, y) => { const t = document.elementFromPoint(x, y) ?? document.body;
  const o = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, pointerId: 1, pointerType: 'touch', isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1 };
  t.dispatchEvent(new PointerEvent(type, o));
  if (type === 'pointerdown') t.dispatchEvent(new MouseEvent('mousedown', o));
  if (type === 'pointerup') { t.dispatchEvent(new MouseEvent('mouseup', o)); t.dispatchEvent(new MouseEvent('click', o)); }
  return t.getAttribute('data-testid') ?? t.tagName; };`;
const touch = async (x, y) => { await ev(PTR); await ev(`__ptr('pointerdown', ${x}, ${y})`); await sleep(60); return ev(`__ptr('pointerup', ${x}, ${y})`); };
const swipe = async (x1, y1, x2, y2, ms = 400) => {
  await ev(PTR); const n = Math.max(8, Math.round(ms / 16));
  await ev(`__ptr('pointerdown', ${x1}, ${y1})`);
  for (let i = 1; i <= n; i++) { await sleep(ms / n); const x = x1 + ((x2 - x1) * i) / n, y = y1 + ((y2 - y1) * i) / n;
    await ev(`(() => { const t = document.elementFromPoint(${x}, ${y}) ?? document.body; t.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, composed: true, clientX: ${x}, clientY: ${y}, pointerId: 1, pointerType: 'touch', isPrimary: true, buttons: 1 })); })()`); }
  await ev(`__ptr('pointerup', ${x2}, ${y2})`);
};
// 실패 주입 — CDP Fetch 로 XHR/fetch 를 요청 단계에서 세운다. GET 만 건드린다(쓰기 요청을 가짜 성공·실패로 만들면
// 서버에 갔는지 헷갈린다). 예비 요청(OPTIONS)도 통과 — 진짜 서버가 CORS 를 답한다.
const rules = []; // { glob, re, kind: 'fail'|'delay', status, body, ms, hits }
const globRe = (g) => new RegExp('^' + g.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\0').replace(/\*/g, '[^/]*').replace(/\0/g, '.*') + '$');
const CODE = { 400: 'VALIDATION_ERROR', 401: 'AUTHENTICATION_REQUIRED', 403: 'PERMISSION_DENIED', 404: 'RESOURCE_NOT_FOUND', 409: 'CONFLICT', 429: 'RATE_LIMITED', 502: 'UPSTREAM_UNAVAILABLE', 503: 'UPSTREAM_UNAVAILABLE' };
const errBody = (st) => ({ error: { code: CODE[st] ?? 'INTERNAL', message: `[실패 주입] ${st}`, traceId: 'fault-injected' } });
const onPaused = async (p) => {
  const go = () => send('Fetch.continueRequest', { requestId: p.requestId });
  const path = new URL(p.request.url).pathname;
  const r = p.request.method === 'GET' && rules.find((x) => x.re.test(path));
  if (!r) return go();
  r.hits++;
  if (r.kind === 'delay') { await sleep(r.ms); return go(); }
  if (r.status === 'net') return send('Fetch.failRequest', { requestId: p.requestId, errorReason: 'Failed' });
  const origin = Object.entries(p.request.headers).find(([k]) => k.toLowerCase() === 'origin')?.[1];
  const headers = [{ name: 'Content-Type', value: 'application/json' }];
  if (origin) headers.push({ name: 'Access-Control-Allow-Origin', value: origin }, { name: 'Access-Control-Allow-Credentials', value: 'true' }); // 교차 출처 API — 없으면 브라우저가 응답을 막아 네트워크 실패로 보인다
  return send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: r.status, responseHeaders: headers, body: Buffer.from(JSON.stringify(r.body)).toString('base64') });
};
const syncFetch = () => rules.length
  ? send('Fetch.enable', { patterns: [{ urlPattern: '*', resourceType: 'XHR', requestStage: 'Request' }, { urlPattern: '*', resourceType: 'Fetch', requestStage: 'Request' }] })
  : send('Fetch.disable');
const addRule = async (rule) => { const i = rules.findIndex((x) => x.glob === rule.glob); if (i >= 0) rules.splice(i, 1); rules.push({ ...rule, re: globRe(rule.glob), hits: 0 }); await syncFetch(); };
const listRules = () => rules.map((x) => `${x.kind} ${x.glob} ${x.kind === 'delay' ? x.ms + 'ms' : x.status} (맞음 ${x.hits})`).join('\n') || '(규칙 없음)';
const H_ = {
  tree: async (f) => { const t = await ev(TREE); if (!f) return t; const re = new RegExp(f); const out = t.split('\n').filter((l) => re.test(l)).join('\n'); return out || `(일치 없음: ${f})`; },
  // testID 로 누르면 그 요소에 직접 쏜다 — 좌표(elementFromPoint)로 쏘면 위에 덮인 탭바·하단 바가 대신 눌린다(실측).
  press: async (sel) => { const p = await locate(sel); if (!p) throw new Error('못 찾음: ' + sel);
    if (!/^\d+,\d+$/.test(sel) && !sel.startsWith('text:')) { await ev(PTR); await ev(`(() => { const e = ${BYID(sel)};
      const o = { bubbles: true, cancelable: true, composed: true, clientX: ${p.x}, clientY: ${p.y}, pointerId: 1, pointerType: 'touch', isPrimary: true, button: 0 };
      e.dispatchEvent(new PointerEvent('pointerdown', { ...o, buttons: 1 })); e.dispatchEvent(new MouseEvent('mousedown', o));
      e.dispatchEvent(new PointerEvent('pointerup', o)); e.dispatchEvent(new MouseEvent('mouseup', o)); e.dispatchEvent(new MouseEvent('click', o)); })()`); }
    else await touch(p.x, p.y); await sleep(700); return `pressed @${Math.round(p.x)},${Math.round(p.y)} → ${await ev('location.pathname+location.search')}`; },
  fill: async (sel, ...t) => { const p = await locate(sel); if (!p) throw new Error('못 찾음: ' + sel); await touch(p.x, p.y); await sleep(200);
    return ev(`(() => { let e = document.activeElement; if (!e || !('value' in e)) { const h = document.elementFromPoint(${p.x}, ${p.y}); e = h?.closest('input,textarea') ?? h?.querySelector?.('input,textarea'); }
      if (!e) return 'no input'; e.focus(); const s = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(e), 'value').set; s.call(e, ${JSON.stringify(t.join(' '))});
      e.dispatchEvent(new Event('input', { bubbles: true })); return 'filled ' + (e.getAttribute('data-testid') ?? e.tagName); })()`); },
  key: (k) => ev(`(() => { const e = document.activeElement ?? document.body; const o = { key: ${JSON.stringify(k)}, code: ${JSON.stringify(k)}, keyCode: ${JSON.stringify({ Enter: 13, Escape: 27, Backspace: 8 })}[${JSON.stringify(k)}] ?? 0, bubbles: true, cancelable: true };
    e.dispatchEvent(new KeyboardEvent('keydown', o)); e.dispatchEvent(new KeyboardEvent('keypress', o)); e.dispatchEvent(new KeyboardEvent('keyup', o)); return 'key ${k} → ' + (e.getAttribute?.('data-testid') ?? e.tagName); })()`),
  swipe: async (x1, y1, x2, y2, ms) => { await swipe(+x1, +y1, +x2, +y2, ms ? +ms : 400); await sleep(500); return 'swiped'; },
  scroll: async (sel, dy) => { const p = sel === '-' ? { x: W / 2, y: H / 2 } : await locate(sel);
    const r = await ev(`(() => { let e = document.elementFromPoint(${p.x}, ${p.y}); while (e && !(e.scrollHeight > e.clientHeight + 2 && /(auto|scroll)/.test(getComputedStyle(e).overflowY))) e = e.parentElement; (e ?? document.scrollingElement).scrollBy(0, ${+dy}); return e ? (e.getAttribute('data-testid') ?? e.tagName) : 'document'; })()`);
    await sleep(500); return 'scrolled ' + r; },
  nav: async (u) => { await send('Page.navigate', { url: u.startsWith('/') ? new URL(u, await ev('location.origin')).href : u }); await sleep(2500); return ev('location.href'); },
  back: async () => { await ev('history.back()'); await sleep(1200); return ev('location.href'); },
  reload: async () => { await send('Page.reload'); await sleep(3000); return ev('location.href'); },
  url: () => ev('location.href'),
  shot: async (f) => { if (!f?.startsWith('/')) throw new Error('shot 은 절대경로만 — 상대경로는 서버 cwd(리포)에 떨어진다'); const { data } = await send('Page.captureScreenshot', { format: 'png' }); (await import('node:fs')).writeFileSync(f, Buffer.from(data, 'base64')); return 'saved ' + f; },
  eval: (...js) => ev(js.join(' ')),
  geo: async (lat, lng) => { await send('Browser.grantPermissions', { origin: await ev('location.origin'), permissions: ['geolocation'] }).catch(() => {}); await send('Emulation.setGeolocationOverride', { latitude: +lat, longitude: +lng, accuracy: 20 }); return `geo ${lat},${lng}`; },
  console: () => { const out = logs.splice(0).join('\n'); return out || '(없음)'; },
  fail: async (glob, st, ...json) => { if (!glob?.startsWith('/') || !st) throw new Error('fail <경로glob> <status|net> [본문JSON]');
    const status = st === 'net' ? 'net' : +st; if (status !== 'net' && !(status >= 200 && status < 600)) throw new Error('status 는 200~599 또는 net');
    await addRule({ glob, kind: 'fail', status, body: json.length ? JSON.parse(json.join(' ')) : errBody(status) }); return listRules(); },
  delay: async (glob, ms) => { if (!glob?.startsWith('/') || !(+ms >= 0)) throw new Error('delay <경로glob> <ms>'); await addRule({ glob, kind: 'delay', ms: +ms }); return listRules(); },
  'fail-list': () => listRules(),
  'fail-clear': async () => { rules.length = 0; await syncFetch(); return '(규칙 없음) — 가로채기 꺼짐'; },
};
http.createServer(async (req, res) => {
  let b = ''; for await (const c of req) b += c;
  try { const { cmd, args } = JSON.parse(b); if (!H_[cmd]) throw new Error('명령 없음: ' + cmd);
    const v = await H_[cmd](...args); res.end(typeof v === 'string' ? v : JSON.stringify(v, null, 1));
  } catch (e) { res.statusCode = 500; res.end(String(e.message ?? e)); }
}).listen(PORT, '127.0.0.1', () => console.log(`web QA 드라이버 :${PORT} → ${start} (tab ${created.id})`));
