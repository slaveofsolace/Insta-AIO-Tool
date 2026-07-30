import { readFile, writeFile } from 'node:fs/promises';

const parts = [
  'src/app.parts/part-01.jsfrag',
  'src/app.parts/part-02.jsfrag',
  'src/app.parts/part-03.jsfrag',
  'src/app.parts/part-04.jsfrag',
];

const buffers = await Promise.all(parts.map((path) => readFile(path)));
await writeFile('src/app.js', Buffer.concat(buffers));
console.log('Assembled src/app.js from deterministic source segments.');
