function copyByTextarea(text) {
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  const done = document.execCommand('copy');
  area.remove();
  if (!done) throw new Error('The browser did not allow copying to the clipboard');
}

export async function copyText(textOrPromise) {
  const pending = Promise.resolve(textOrPromise).then(String);
  if (typeof ClipboardItem === 'function' && navigator.clipboard?.write) {
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'text/plain': pending.then((t) => new Blob([t], { type: 'text/plain' })) })]);
      return;
    } catch (err) {
      if (err?.name !== 'NotAllowedError' && err?.name !== 'TypeError' && err?.name !== 'DataError') throw err;
    }
  }
  const text = await pending;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    copyByTextarea(text);
  }
}
