const EXACT_ASSETS = new Set([
  'index.html',
  'manifest.webmanifest',
  'sw.js',
  'assets/icon.svg',
  'assets/icon-192.png',
  'assets/icon-512.png',
  'src/styles.css',
  'src/app-loader.js',
  'src/app.parts/part-01.jsfrag',
  'src/app.parts/part-02.jsfrag',
  'src/app.parts/part-03.jsfrag',
  'src/app.parts/part-04.jsfrag',
]);

const SOURCE_ASSET = /^src\/(?:core|adapters|migrations|workers)\/[a-z0-9-]+\.js$/i;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost']);

export function isAllowedAssetPath(relativePath) {
  const normalized = String(relativePath || '').replaceAll('\\', '/');
  const segments = normalized.split('/');
  if (
    !normalized
    || normalized.startsWith('/')
    || segments.some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    return false;
  }
  return EXACT_ASSETS.has(normalized) || SOURCE_ASSET.test(normalized);
}

export function isAllowedLoopbackHost(hostHeader) {
  try {
    const parsed = new URL(`http://${String(hostHeader || '')}`);
    return (
      LOOPBACK_HOSTS.has(parsed.hostname)
      && !parsed.username
      && !parsed.password
      && parsed.pathname === '/'
      && !parsed.search
      && !parsed.hash
    );
  } catch {
    return false;
  }
}
