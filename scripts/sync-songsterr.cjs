const fs = require('fs');
const path = require('path');
const https = require('https');

const FILES = [
  {
    url: 'https://raw.githubusercontent.com/Metaphysics0/songsterr-downloader/main/src/lib/types/index.ts',
    dest: 'src/lib/songsterr-downloader/types.ts',
    transform: (content) => content
  },
  {
    url: 'https://raw.githubusercontent.com/Metaphysics0/songsterr-downloader/main/src/lib/server/services/converter/duration-mapper.ts',
    dest: 'src/lib/songsterr-downloader/duration-mapper.ts',
    transform: (content) => content
  },
  {
    url: 'https://raw.githubusercontent.com/Metaphysics0/songsterr-downloader/main/src/lib/server/services/converter/instrument-map.ts',
    dest: 'src/lib/songsterr-downloader/instrument-map.ts',
    transform: (content) => content
  },
  {
    url: 'https://raw.githubusercontent.com/Metaphysics0/songsterr-downloader/main/src/lib/server/services/converter/songsterr-to-alphatab.converter.ts',
    dest: 'src/lib/songsterr-downloader/songsterr-to-alphatab.converter.ts',
    transform: (content) => {
      // Replace imports from '$lib/types' with relative './types'
      return content.replace(/from '\$lib\/types';/g, "from './types';");
    }
  }
];

const download = (url) => {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Failed to download ${url}: HTTP ${res.statusCode}`));
        return;
      }
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
};

async function main() {
  const outputDir = path.join(__dirname, '..', 'src', 'lib', 'songsterr-downloader');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  for (const file of FILES) {
    const destPath = path.join(__dirname, '..', file.dest);
    console.log(`Downloading ${file.url} -> ${file.dest}...`);
    try {
      const rawContent = await download(file.url);
      const transformed = file.transform(rawContent);
      fs.writeFileSync(destPath, transformed, 'utf8');
      console.log(`Saved ${file.dest}`);
    } catch (err) {
      console.error(`Error processing ${file.dest}:`, err);
      process.exit(1);
    }
  }
  console.log('Synchronization complete!');
}

main();
