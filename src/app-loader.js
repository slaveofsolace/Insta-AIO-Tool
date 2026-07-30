const partUrls = [
  './app.parts/part-01.jsfrag',
  './app.parts/part-02.jsfrag',
  './app.parts/part-03.jsfrag',
  './app.parts/part-04.jsfrag',
];

try {
  const buffers = await Promise.all(partUrls.map(async (path) => {
    const response = await fetch(new URL(path, import.meta.url));
    if (!response.ok) throw new Error(`Unable to load ${path}: HTTP ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  }));

  const totalBytes = buffers.reduce((sum, buffer) => sum + buffer.byteLength, 0);
  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const buffer of buffers) {
    combined.set(buffer, offset);
    offset += buffer.byteLength;
  }

  const coreBase = new URL('./core/', import.meta.url).href;
  const source = new TextDecoder().decode(combined)
    .replaceAll("from './core/", `from '${coreBase}`);
  const moduleUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  try {
    await import(moduleUrl);
  } finally {
    URL.revokeObjectURL(moduleUrl);
  }
} catch (error) {
  const root = document.querySelector('#app');
  if (root) root.innerHTML = `<main style="padding:24px;font-family:system-ui"><h1>Insta AIO Tool failed to load</h1><pre>${String(error?.stack || error)}</pre></main>`;
  throw error;
}
