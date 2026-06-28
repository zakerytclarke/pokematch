const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const IMAGES_DIR = path.join(__dirname, 'images');
const SYMBOLS_DIR = path.join(IMAGES_DIR, 'symbols');

// Create directories if they don't exist
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(IMAGES_DIR)) fs.mkdirSync(IMAGES_DIR, { recursive: true });
if (!fs.existsSync(SYMBOLS_DIR)) fs.mkdirSync(SYMBOLS_DIR, { recursive: true });

// Configuration
const API_URL = 'https://api.pokemontcg.io/v2/cards';
const PAGE_SIZE = 250;
const DELAY_BETWEEN_PAGES_MS = 2100; // to avoid 30 req/min rate limiting on pokemontcg.io
const CONCURRENCY = 15; // Download up to 15 images concurrently
const DOWNLOAD_IMAGES = false; // Set to true to download images locally later
const REWRITE_URLS_TO_LOCAL = false; // Set to true to rewrite URLs to local paths later

// Helper to fetch with retry
async function fetchWithRetry(url, options = {}, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, options);
      if (res.status === 429) {
        console.log(`\n[API] Rate limited. Waiting 15 seconds before retrying...`);
        await new Promise(resolve => setTimeout(resolve, 15000));
        continue;
      }
      if (!res.ok) throw new Error(`HTTP status ${res.status}`);
      return await res.json();
    } catch (err) {
      if (i === retries - 1) throw err;
      console.log(`\n[API] Fetch error for ${url}: ${err.message}. Retrying in 2 seconds...`);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
}

// Helper to download a file with retry and resumption support
async function downloadFile(url, destPath) {
  if (fs.existsSync(destPath)) {
    try {
      const stat = fs.statSync(destPath);
      if (stat.size > 0) {
        return 'skipped';
      }
    } catch (e) {}
  }

  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP status ${res.status}`);
      const arrayBuffer = await res.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      await fs.promises.writeFile(destPath, buffer);
      return 'downloaded';
    } catch (err) {
      if (i === 2) {
        return 'failed';
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
}

// Concurrency pool runner
async function runWithConcurrency(tasks, concurrencyLimit) {
  let activeCount = 0;
  let index = 0;

  return new Promise((resolve) => {
    async function next() {
      if (index >= tasks.length && activeCount === 0) {
        resolve();
        return;
      }

      while (activeCount < concurrencyLimit && index < tasks.length) {
        const task = tasks[index++];
        activeCount++;
        task().then(() => {
          activeCount--;
          next();
        });
      }
    }
    next();
  });
}

async function main() {
  console.log('=== PokéMatch Local Caching Tool ===');
  console.log('Step 1: Fetching card metadata from api.pokemontcg.io...');
  
  let cards = [];
  let page = 1;
  let totalPages = 1;
  let totalCardsCount = 0;

  while (true) {
    const startTime = Date.now();
    const data = await fetchWithRetry(`${API_URL}?pageSize=${PAGE_SIZE}&page=${page}`);
    
    if (!data.data || data.data.length === 0) {
      console.log('\nNo more cards returned.');
      break;
    }

    cards = cards.concat(data.data);
    totalCardsCount = data.totalCount || cards.length;
    totalPages = Math.ceil(totalCardsCount / PAGE_SIZE);

    process.stdout.write(`\rFetched page ${page}/${totalPages} (${cards.length}/${totalCardsCount} cards collected)`);

    if (cards.length >= totalCardsCount || page >= totalPages) {
      break;
    }

    page++;
    
    // Rate limit pause
    const elapsed = Date.now() - startTime;
    const remainingDelay = Math.max(0, DELAY_BETWEEN_PAGES_MS - elapsed);
    if (remainingDelay > 0) {
      await new Promise(resolve => setTimeout(resolve, remainingDelay));
    }
  }

  console.log(`\nSuccessfully fetched metadata for ${cards.length} cards!`);

  // Build the download queue BEFORE rewriting URLs
  console.log('\nPreparing download queue...');
  const downloadQueue = [];
  const uniqueSets = new Set();

  for (const card of cards) {
    // Collect set symbol
    if (card.set && card.set.id && card.set.images && card.set.images.symbol) {
      if (!uniqueSets.has(card.set.id)) {
        uniqueSets.add(card.set.id);
        downloadQueue.push({
          url: card.set.images.symbol,
          dest: path.join(SYMBOLS_DIR, `${card.set.id}.png`),
          type: 'symbol'
        });
      }
    }
    
    // Collect card image (low res / small)
    if (card.images && card.images.small) {
      downloadQueue.push({
        url: card.images.small,
        dest: path.join(IMAGES_DIR, `${card.id}.png`),
        type: 'card'
      });
    }
  }

  // Rewrite card object image URLs to local assets if enabled
  if (REWRITE_URLS_TO_LOCAL) {
    console.log('Rewriting metadata image URLs to local paths...');
    for (const card of cards) {
      if (card.images) {
        if (card.images.small) {
          card.images.small = `images/${card.id}.png`;
        }
        if (card.images.large) {
          card.images.large = `images/${card.id}.png`; // pointing large to local low-res image
        }
      }
      if (card.set && card.set.images && card.set.images.symbol) {
        card.set.images.symbol = `images/symbols/${card.set.id}.png`;
      }
    }
  } else {
    console.log('Keeping original metadata CDN image URLs...');
  }

  // Write divided JSON chunks
  console.log('Writing minified local JSON files...');
  const chunkCount = 10;
  const chunkSize = Math.ceil(cards.length / chunkCount);
  for (let i = 0; i < chunkCount; i++) {
    const chunk = cards.slice(i * chunkSize, (i + 1) * chunkSize);
    const filePath = path.join(DATA_DIR, `cards_${i + 1}.json`);
    fs.writeFileSync(filePath, JSON.stringify(chunk));
    console.log(`  Saved ./data/cards_${i + 1}.json with ${chunk.length} cards`);
  }

  // Run downloading if enabled
  if (!DOWNLOAD_IMAGES) {
    console.log('\nImage downloading is disabled (DOWNLOAD_IMAGES = false). Skipping step 2.');
    console.log('\n=== Done! ===');
    console.log(`Total metadata files: 10 chunks under ./data/`);
    return;
  }

  console.log(`\nStep 2: Starting concurrent downloads for ${downloadQueue.length} assets (limit: ${CONCURRENCY})...`);
  
  let completed = 0;
  let skippedCount = 0;
  let downloadedCount = 0;
  let failedCount = 0;

  const tasks = downloadQueue.map(item => async () => {
    const result = await downloadFile(item.url, item.dest);
    completed++;
    if (result === 'skipped') skippedCount++;
    if (result === 'downloaded') downloadedCount++;
    if (result === 'failed') failedCount++;
    
    if (completed % 10 === 0 || completed === downloadQueue.length) {
      const percentage = ((completed / downloadQueue.length) * 100).toFixed(1);
      process.stdout.write(`\rProgress: ${percentage}% (${completed}/${downloadQueue.length}) | Downloaded: ${downloadedCount} | Skipped: ${skippedCount} | Failed: ${failedCount}`);
    }
  });

  await runWithConcurrency(tasks, CONCURRENCY);

  console.log('\n\n=== Done! ===');
  console.log(`Total metadata files: 10 chunks under ./data/`);
  console.log(`Images: ${downloadedCount} downloaded, ${skippedCount} skipped (already present), ${failedCount} failed.`);
}

main().catch(err => {
  console.error('\nFatal error in caching tool:', err);
});
