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
  const adaptersBase = new URL('./adapters/', import.meta.url).href;
  const source = new TextDecoder().decode(combined)
    .replaceAll("from './core/", `from '${coreBase}`)
    .replaceAll("from './adapters/", `from '${adaptersBase}`);
  const moduleUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  try {
    await import(moduleUrl);
  } finally {
    URL.revokeObjectURL(moduleUrl);
  }
} catch (error) {
  const root = document.querySelector('#app');
  if (root) {
    const main = document.createElement('main');
    main.style.cssText = 'padding:24px;font-family:system-ui';
    const heading = document.createElement('h1');
    heading.textContent = 'Insta AIO Tool failed to load';
    const details = document.createElement('pre');
    details.textContent = String(error?.stack || error);
    main.append(heading, details);
    root.replaceChildren(main);
  }
  throw error;
}
