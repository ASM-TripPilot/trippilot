// 시뮬레이터 앱을 JS 런타임(CDP)에서 직접 이동시킨다 — `xcrun simctl openurl` 딥링크가 화면을 안 바꿀 때의 우회.
// 사용: node nav.mjs '/_dev/preview?state=my-stays-error'   (뒤로: node nav.mjs --back)
//       node nav.mjs --eval '<JS 식>'   (예: 모듈 레지스트리 조회 — 개발 빌드 Metro 8081 에 붙은 앱만)
const [arg, expr] = process.argv.slice(2);
const list = await (await fetch('http://localhost:8081/json/list')).json();
const target = list.find((p) => p.title.includes('Bridgeless')) ?? list[0];
if (!target) throw new Error('Metro 8081 에 붙은 앱이 없다');
const findRouter = `(()=>{let id=null;__r.getModules().forEach((v,k)=>{if(/expo-router\\/build\\/index\\.js$/.test(v.verboseName||''))id=k});return __r(id).router})()`;
const expression =
  arg === '--eval' ? expr
  : arg === '--back' ? `${findRouter}.back(),'back'`
  : `${findRouter}.push(${JSON.stringify(arg)}),'push ${arg}'`;
const ws = new WebSocket(target.webSocketDebuggerUrl);
ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id !== 1) return;
  console.log(JSON.stringify(d.result?.result?.value ?? d.result).slice(0, 400));
  ws.close();
  process.exit(d.result?.exceptionDetails ? 1 : 0);
};
setTimeout(() => { console.log('timeout'); process.exit(1); }, 8000);
