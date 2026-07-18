const endpoint = 'http://127.0.0.1:9222';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  let target;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const targets = await fetch(`${endpoint}/json/list`).then((r) => r.json()).catch(() => []);
    target = targets.find((item) => item.type === 'page');
    if (target) break;
    await sleep(200);
  }
  if (!target) throw new Error('找不到 Edge 測試頁面');

  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let sequence = 0;
  const pending = new Map();
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    message.error ? reject(new Error(message.error.message)) : resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  };
  const check = (condition, label) => {
    if (!condition) throw new Error(`失敗：${label}`);
    console.log(`通過：${label}`);
  };

  await send('Runtime.enable');
  await evaluate("location.hash='text/full'");
  await sleep(900);
  const textResult = await evaluate(`({
    hasRealContent: document.querySelector('.prose')?.innerText.includes('大哉乾元'),
    hasSummaryPrompt: document.querySelector('.prose')?.innerText.includes('展開《文言》'),
    hasRawTags: /<\\/?(?:summary|details|span|br)/i.test(document.querySelector('.prose')?.innerText || '')
  })`);
  check(textResult.hasRealContent, '保留真正的易傳內容');
  check(!textResult.hasSummaryPrompt, '移除 summary 提示文字');
  check(!textResult.hasRawTags, '不顯示 details、summary、span、br 標籤');

  await evaluate("location.hash='gua/1'");
  await sleep(600);
  await evaluate(`(() => {
    localStorage.removeItem('iching-highlights-v1'); state.notes=[];
    const node=document.querySelector('.scripture').firstChild;
    const range=document.createRange();range.setStart(node,0);range.setEnd(node,2);
    const selection=getSelection();selection.removeAllRanges();selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));return true;
  })()`);
  await sleep(100);
  check(await evaluate("!document.querySelector('#highlight-action').hidden"), '反白後顯示註解按鈕');
  await evaluate("document.querySelector('#highlight-action').click()");
  check(await evaluate("!document.querySelector('#annotation-modal').hidden"), '點擊後開啟註解視窗');
  await evaluate(`(() => {const input=document.querySelector('#annotation-text');input.value='測試心得';document.querySelector('#annotation-form').requestSubmit();return true;})()`);
  await sleep(150);
  const saved = await evaluate(`({
    count: JSON.parse(localStorage.getItem('iching-highlights-v1')||'[]').length,
    comment: JSON.parse(localStorage.getItem('iching-highlights-v1')||'[]')[0]?.comment,
    bubbles: document.querySelectorAll('.annotation-bubble').length
  })`);
  check(saved.count === 1 && saved.comment === '測試心得', '註解保存至 localStorage');
  check(saved.bubbles === 1, '標記旁產生註解泡泡');

  await evaluate("document.querySelector('.annotation-bubble').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))");
  await sleep(650);
  check(await evaluate("!document.querySelector('#bubble-tooltip').hidden && document.querySelector('#bubble-tooltip').innerText.includes('測試心得')"), '長按泡泡浮出註解');
  await evaluate("document.querySelector('.annotation-bubble').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))");
  check(await evaluate("!document.querySelector('#annotation-modal').hidden && document.querySelector('#annotation-text').value==='測試心得'"), '雙擊泡泡進入編輯');
  await evaluate("document.querySelector('#close-annotation').click();document.querySelector('#notes-button').click()");
  check(await evaluate("!document.querySelector('#notes-panel').hidden && !!document.querySelector('[data-edit]') && !!document.querySelector('[data-delete]')"), '我的螢光筆可編輯與刪除');

  await evaluate("document.querySelector('#close-notes').click();location.hash='text/about'");
  await sleep(300);
  check(await evaluate("document.body.innerText.includes('網站介紹') && document.body.innerText.includes('本機螢光筆註解')"), '網站介紹頁正常顯示');
  socket.close();
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});


  git config --global user.email "bzw1123@gmail.com"
  git config --global user.name "apptcom1123"