/* ----------------------------------------------------
   POKEMATCH - CLIENT MAIN LOGIC (UPDATED)
---------------------------------------------------- */

// Helper: Extract price ranges from card object
function getCardPrice(card) {
  if (!card.tcgplayer || !card.tcgplayer.prices) {
    if (card.cardmarket && card.cardmarket.prices) {
      const cm = card.cardmarket.prices;
      const m = cm.trendPrice || cm.averageSellPrice || cm.suggestedPrice || 0;
      const l = cm.lowPrice || m || 0;
      const h = cm.averageSellPrice * 1.5 || m * 1.5 || 0;
      return {
        market: Number(m.toFixed(2)),
        low: Number(l.toFixed(2)),
        high: Number(h.toFixed(2))
      };
    }
    return { market: 0, low: 0, high: 0 };
  }

  const priceTypes = Object.keys(card.tcgplayer.prices);
  if (priceTypes.length === 0) return { market: 0, low: 0, high: 0 };

  let totalMarket = 0, totalLow = 0, totalHigh = 0, count = 0;
  for (const type of priceTypes) {
    const p = card.tcgplayer.prices[type];
    if (p) {
      const m = p.market || p.mid || p.low || 0;
      const l = p.low || m || 0;
      const h = p.high || m || 0;
      if (m > 0 || l > 0) {
        totalMarket += m;
        totalLow += l;
        totalHigh += h;
        count++;
      }
    }
  }

  if (count > 0) {
    return {
      market: Number((totalMarket / count).toFixed(2)),
      low: Number((totalLow / count).toFixed(2)),
      high: Number((totalHigh / count).toFixed(2))
    };
  }
  return { market: 0, low: 0, high: 0 };
}

// Helper: Extract release year
function getReleaseYear(card) {
  if (card.set && card.set.releaseDate) {
    return card.set.releaseDate.split('/')[0];
  }
  return 'Unknown';
}

// Helper: Clean and extract root Pokemon name (strips trainer prefixes and special card suffixes)
function cleanPokemonName(name) {
  if (!name) return 'Unknown';
  // Strip common trainer prefixes (e.g. Erika's, Brock's, Blaine's, Team Rocket's)
  let n = name.replace(/^(Brock|Misty|Lt\. Surge|Erika|Koga|Sabrina|Blaine|Giovanni|Team (Aqua|Magma|Galactic|Plasma|Rocket|Flare|Skull|Yell|Star))'s\s+/i, '');
  // Strip common suffixes (e.g. ex, EX, GX, VMAX, VSTAR, Star, delta species, etc.)
  n = n.replace(/\s+([0-9]+|EX|GX|VMAX|VSTAR|V|ex|LV\.X|Prime|BREAK|Star|Delta Species|Holo|Reverse|Shiny|Promo|🌈|⭐).*$/i, '');
  return n.trim();
}

// Helper: Box-Muller transform for standard normal sample
function sampleNormal() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

// Helper: Gamma distribution sampler (scale = 1)
function sampleGamma(n) {
  if (n <= 0) return 0;
  if (n <= 20) {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      sum -= Math.log(Math.random() || 1e-10);
    }
    return sum;
  } else {
    const val = n + Math.sqrt(n) * sampleNormal();
    return Math.max(0, val);
  }
}

// Helper: Beta distribution sampler (using Gamma ratios)
function sampleBeta(alpha, beta) {
  const y1 = sampleGamma(alpha);
  const y2 = sampleGamma(beta);
  if (y1 + y2 === 0) return 0.5;
  return y1 / (y1 + y2);
}


/* ====================================================
   1. POKEMON DATABASE MODULE (INDEXEDDB)
==================================================== */
class PokemonDatabase {
  constructor() {
    this.dbName = 'PokeMatchDB';
    this.dbVersion = 1;
    this.db = null;
    this.isFetching = false;
  }

  // Open / Initialize IndexedDB
  init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        const objectStore = db.createObjectStore('cards', { keyPath: 'id' });
        
        objectStore.createIndex('rarity', 'rarity', { unique: false });
        objectStore.createIndex('artist', 'artist', { unique: false });
        objectStore.createIndex('setName', 'set.name', { unique: false });
      };

      request.onsuccess = (event) => {
        this.db = event.target.result;
        resolve(this);
      };

      request.onerror = (event) => {
        console.error('IndexedDB open error:', event.target.error);
        reject(event.target.error);
      };
    });
  }

  // Get total card count in DB
  getCardCount() {
    return new Promise((resolve) => {
      if (!this.db) return resolve(0);
      const transaction = this.db.transaction(['cards'], 'readonly');
      const store = transaction.objectStore('cards');
      const countRequest = store.count();

      countRequest.onsuccess = () => resolve(countRequest.result);
      countRequest.onerror = () => resolve(0);
    });
  }

  // Add multiple cards to DB
  saveCards(cards) {
    return new Promise((resolve) => {
      if (!this.db || !cards || cards.length === 0) return resolve();
      const transaction = this.db.transaction(['cards'], 'readwrite');
      const store = transaction.objectStore('cards');

      cards.forEach(card => {
        if (card.id && card.images && card.images.small) {
          store.put(card);
        }
      });

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => {
        console.error('Save cards transaction failed');
        resolve();
      };
    });
  }

  // Get all cards from DB
  getAllCards() {
    return new Promise((resolve) => {
      if (!this.db) return resolve([]);
      const transaction = this.db.transaction(['cards'], 'readonly');
      const store = transaction.objectStore('cards');
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve([]);
    });
  }

  // Clear all cached cards
  clearCache() {
    return new Promise((resolve) => {
      if (!this.db) return resolve();
      const transaction = this.db.transaction(['cards'], 'readwrite');
      const store = transaction.objectStore('cards');
      const request = store.clear();
      transaction.oncomplete = () => {
        localStorage.removeItem('fetchedPages');
        resolve();
      };
    });
  }

  // Draw an unfetched page number at random to guarantee set diversity
  getRandomUnfetchedPage() {
    let fetched = [];
    try {
      fetched = JSON.parse(localStorage.getItem('fetchedPages')) || [];
    } catch (e) {
      fetched = [];
    }

    // Total of 81 pages in Pokemon TCG API v2
    const totalPagesCount = 81;
    const allPages = Array.from({ length: totalPagesCount }, (_, i) => i + 1);
    const available = allPages.filter(p => !fetched.includes(p));

    if (available.length === 0) return -1; // All pages loaded

    const randIndex = Math.floor(Math.random() * available.length);
    const chosenPage = available[randIndex];

    fetched.push(chosenPage);
    localStorage.setItem('fetchedPages', JSON.stringify(fetched));
    return chosenPage;
  }

  // Synchronize/Fetch cards from TCG API page-by-page
  async fetchCardsPage(page = 1) {
    const url = `https://api.pokemontcg.io/v2/cards?pageSize=250&page=${page}`;
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const payload = await response.json();
      return {
        cards: payload.data || [],
        totalCount: payload.totalCount || 0
      };
    } catch (e) {
      console.error(`Error fetching page ${page}:`, e);
      return { cards: [], totalCount: 0 };
    }
  }

  // Background downloader queue (loads all cards in cache page-by-page out of order)
  async startBackgroundSync(onProgress) {
    if (this.isFetching) return;
    this.isFetching = true;

    try {
      const targetCount = 30000;
      let currentCachedCount = await this.getCardCount();

      while (currentCachedCount < targetCount) {
        const page = this.getRandomUnfetchedPage();
        if (page === -1) {
          console.log('All API pages fetched, background sync stopping');
          break;
        }

        const data = await this.fetchCardsPage(page);
        if (data.cards.length === 0) {
          console.warn(`API page ${page} returned empty, aborting background fetch`);
          break;
        }

        await this.saveCards(data.cards);
        currentCachedCount = await this.getCardCount();

        if (onProgress) {
          onProgress(page, currentCachedCount, data.cards);
        }

        // 1.5s rate-limit pause
        await new Promise(r => setTimeout(r, 1500));
      }
    } catch (err) {
      console.error('Background sync failed:', err);
    } finally {
      this.isFetching = false;
      if (onProgress) onProgress(-1, await this.getCardCount(), []); // Complete
    }
  }
}


/* ====================================================
   2. RECOMMENDER ENGINE MODULE (THOMPSON SAMPLING)
=================================================== */
class Recommender {
  constructor() {
    this.likedCardIds = new Set();
    this.dislikedCardIds = new Set();
    this.superLikedCardIds = new Set();
    this.swipedCardIds = new Set();
    
    // Feature Stats: { [category]: { [value]: { likes: N, dislikes: M } } }
    this.stats = {
      name: {},
      artist: {},
      type: {},
      rarity: {},
      set: {},
      year: {},
      subtype: {}
    };

    // History: [{ cardId, action: 'like' | 'dislike' | 'superlike' }]
    this.swipeHistory = [];
    this.packsOpenedCount = 0;

    this.loadFromStorage();
  }

  loadFromStorage() {
    try {
      const likes = JSON.parse(localStorage.getItem('likedCardIds')) || [];
      const dislikes = JSON.parse(localStorage.getItem('dislikedCardIds')) || [];
      const supers = JSON.parse(localStorage.getItem('superLikedCardIds')) || [];
      const history = JSON.parse(localStorage.getItem('swipeHistory')) || [];
      const featureStats = JSON.parse(localStorage.getItem('swipeFeatureStats')) || null;
      this.packsOpenedCount = parseInt(localStorage.getItem('packsOpenedCount')) || 0;

      this.likedCardIds = new Set(likes);
      this.dislikedCardIds = new Set(dislikes);
      this.superLikedCardIds = new Set(supers);
      
      likes.forEach(id => this.swipedCardIds.add(id));
      dislikes.forEach(id => this.swipedCardIds.add(id));
      supers.forEach(id => {
        this.swipedCardIds.add(id);
        this.likedCardIds.add(id); // Superlikes are also collections likes
      });

      this.swipeHistory = history;

      if (featureStats) {
        this.stats = featureStats;
        if (!this.stats.name) this.stats.name = {};
      } else {
        this.stats = { name: {}, artist: {}, type: {}, rarity: {}, set: {}, year: {}, subtype: {} };
      }
    } catch (e) {
      console.error('Error reading localStorage preferences:', e);
    }
  }

  saveToStorage() {
    try {
      localStorage.setItem('likedCardIds', JSON.stringify([...this.likedCardIds]));
      localStorage.setItem('dislikedCardIds', JSON.stringify([...this.dislikedCardIds]));
      localStorage.setItem('superLikedCardIds', JSON.stringify([...this.superLikedCardIds]));
      localStorage.setItem('swipeHistory', JSON.stringify(this.swipeHistory));
      localStorage.setItem('swipeFeatureStats', JSON.stringify(this.stats));
      localStorage.setItem('packsOpenedCount', this.packsOpenedCount.toString());
    } catch (e) {
      console.error('Error saving localStorage preferences:', e);
    }
  }

  // Record a swipe action
  recordSwipe(card, action) {
    const cardId = card.id;

    if (action === 'like') {
      this.likedCardIds.add(cardId);
    } else if (action === 'superlike') {
      this.superLikedCardIds.add(cardId);
      this.likedCardIds.add(cardId);
    } else {
      this.dislikedCardIds.add(cardId);
    }
    
    this.swipedCardIds.add(cardId);
    this.swipeHistory.push({ cardId, action });

    // Super Like adds 5 feature weights, Likes add 1
    const weight = action === 'superlike' ? 5 : 1;
    const isLike = action === 'like' || action === 'superlike';

    this.adjustStats(card, isLike, weight);
    this.saveToStorage();
  }

  // Undo the last swipe action
  undoLastSwipe(allCardsMap) {
    if (this.swipeHistory.length === 0) return null;
    const lastSwipe = this.swipeHistory.pop();
    const card = allCardsMap.get(lastSwipe.cardId);

    if (!card) return null;

    const action = lastSwipe.action;
    if (action === 'like') {
      this.likedCardIds.delete(card.id);
      this.swipedCardIds.delete(card.id);
      this.adjustStats(card, true, -1);
    } else if (action === 'superlike') {
      this.superLikedCardIds.delete(card.id);
      this.likedCardIds.delete(card.id);
      this.swipedCardIds.delete(card.id);
      this.adjustStats(card, true, -5);
    } else if (action === 'dislike') {
      this.dislikedCardIds.delete(card.id);
      this.swipedCardIds.delete(card.id);
      this.adjustStats(card, false, -1);
    } else if (action === 'convert_like') {
      this.superLikedCardIds.add(card.id);
      this.adjustStats(card, true, 4);
    } else if (action === 'convert_super') {
      this.superLikedCardIds.delete(card.id);
      this.adjustStats(card, true, -4);
    } else if (action === 'remove_like') {
      this.likedCardIds.add(card.id);
      this.swipedCardIds.add(card.id);
      this.adjustStats(card, true, 1);
    } else if (action === 'remove_super') {
      this.superLikedCardIds.add(card.id);
      this.likedCardIds.add(card.id);
      this.swipedCardIds.add(card.id);
      this.adjustStats(card, true, 5);
    }

    this.saveToStorage();
    return card;
  }

  // Toggle Super Like status inside binder
  toggleSuperLikeStatus(card) {
    const isSuper = this.superLikedCardIds.has(card.id);
    if (isSuper) {
      // Convert to regular Like
      this.superLikedCardIds.delete(card.id);
      this.adjustStats(card, true, -4);
      this.swipeHistory.push({ cardId: card.id, action: 'convert_like' });
    } else {
      // Convert to Super Like
      this.superLikedCardIds.add(card.id);
      this.adjustStats(card, true, 4);
      this.swipeHistory.push({ cardId: card.id, action: 'convert_super' });
    }
    this.saveToStorage();
    return !isSuper;
  }

  adjustStats(card, isLike, weight) {
    const features = this.extractCardFeatures(card);

    for (const [category, values] of Object.entries(features)) {
      if (!this.stats[category]) this.stats[category] = {};

      values.forEach(val => {
        if (!this.stats[category][val]) {
          this.stats[category][val] = { likes: 0, dislikes: 0 };
        }
        
        if (isLike) {
          this.stats[category][val].likes = Math.max(0, this.stats[category][val].likes + weight);
        } else {
          this.stats[category][val].dislikes = Math.max(0, this.stats[category][val].dislikes + weight);
        }
      });
    }
  }

  // Parse card attributes into categorical features
  extractCardFeatures(card) {
    const rootName = cleanPokemonName(card.name);
    return {
      name: [rootName],
      artist: card.artist ? [card.artist] : ['Unknown'],
      type: card.types && card.types.length > 0 ? card.types : ['Trainer/Energy'],
      rarity: card.rarity ? [card.rarity] : ['Common'],
      set: card.set && card.set.name ? [card.set.name] : ['Unknown Set'],
      year: [getReleaseYear(card)],
      subtype: card.subtypes && card.subtypes.length > 0 ? card.subtypes : ['Standard']
    };
  }

  // Expected value of Beta distribution
  getFeatureValueRating(category, value) {
    const counts = this.stats[category]?.[value] || { likes: 0, dislikes: 0 };
    const alpha = 1 + counts.likes;
    const beta = 1 + counts.dislikes;
    return alpha / (alpha + beta);
  }

  // Draw Thompson sample for a single feature value
  sampleFeatureValueScore(category, value) {
    const counts = this.stats[category]?.[value] || { likes: 0, dislikes: 0 };
    const alpha = 1 + counts.likes;
    const beta = 1 + counts.dislikes;
    return sampleBeta(alpha, beta);
  }

  // Score a single card using Thompson Sampling across all its features (weighted average)
  scoreCard(card, debug = false) {
    const features = this.extractCardFeatures(card);
    let totalWeightedScore = 0;
    let totalWeight = 0;
    
    const categoryWeights = {
      name: 4.0,
      type: 2.0,
      artist: 2.0,
      set: 1.0,
      rarity: 1.0,
      year: 0.5,
      subtype: 0.5
    };
    
    const debugDetails = {};

    for (const [category, values] of Object.entries(features)) {
      let categoryScoreSum = 0;
      
      values.forEach(val => {
        categoryScoreSum += this.sampleFeatureValueScore(category, val);
      });

      const categoryAvg = categoryScoreSum / values.length;
      const weight = categoryWeights[category] || 1.0;
      totalWeightedScore += categoryAvg * weight;
      totalWeight += weight;

      if (debug) {
        let valSum = 0;
        values.forEach(v => { valSum += this.getFeatureValueRating(category, v); });
        debugDetails[category] = Math.round((valSum / values.length) * 100);
      }
    }

    const finalScore = totalWeightedScore / totalWeight;
    return debug ? { score: finalScore, details: debugDetails } : finalScore;
  }

  // Choose the next recommended card from the pool (50% Exploitation, 50% Exploration)
  selectNextCard(cardsArray) {
    const candidates = cardsArray.filter(card => !this.swipedCardIds.has(card.id));
    if (candidates.length === 0) return null;

    // Epsilon-Greedy: 10% chance to show a completely random candidate
    const epsilon = 0.10;
    if (Math.random() < epsilon) {
      const idx = Math.floor(Math.random() * candidates.length);
      return candidates[idx];
    }

    const hasLikes = this.likedCardIds.size > 0;
    // 50% of the time, prioritize showing cards with features the user has liked before
    const showLiked = hasLikes && (Math.random() < 0.50);

    if (showLiked) {
      // EXPLOITATION MODE: Filter candidates to those sharing at least one liked feature value
      const likedCandidates = candidates.filter(card => {
        const features = this.extractCardFeatures(card);
        for (const [category, values] of Object.entries(features)) {
          for (const val of values) {
            const counts = this.stats[category]?.[val];
            if (counts && counts.likes > 0) {
              return true;
            }
          }
        }
        return false;
      });

      const pool = likedCandidates.length > 0 ? likedCandidates : candidates;
      // Score the top candidates using Thompson Sampling and choose the best
      const poolSize = Math.min(100, pool.length);
      const tempPool = [...pool].slice(0, poolSize);
      
      let bestCard = null;
      let bestScore = -1;
      tempPool.forEach(card => {
        const score = this.scoreCard(card);
        if (score > bestScore) {
          bestScore = score;
          bestCard = card;
        }
      });
      return bestCard || pool[Math.floor(Math.random() * pool.length)];
    } else {
      // EXPLORATION MODE: Prioritize cards containing unexplored features to learn user's tastes
      const scoredCandidates = candidates.map(card => {
        const features = this.extractCardFeatures(card);
        let unseenCount = 0;
        for (const [category, values] of Object.entries(features)) {
          values.forEach(val => {
            const counts = this.stats[category]?.[val];
            if (!counts || (counts.likes === 0 && counts.dislikes === 0)) {
              unseenCount++;
            }
          });
        }
        return { card, unseenCount };
      });

      // Sort by count of unexplored features descending
      scoredCandidates.sort((a, b) => b.unseenCount - a.unseenCount);
      
      const pool = scoredCandidates.slice(0, 30).map(c => c.card);
      if (pool.length === 0) return candidates[Math.floor(Math.random() * candidates.length)];
      
      let bestCard = null;
      let bestScore = -1;
      pool.forEach(card => {
        const score = this.scoreCard(card);
        if (score > bestScore) {
          bestScore = score;
          bestCard = card;
        }
      });
      return bestCard;
    }
  }

  sampleFeatureValueExpectedScore(category, value) {
    const counts = this.stats[category]?.[value] || { likes: 0, dislikes: 0 };
    const alpha = 1 + counts.likes;
    const beta = 1 + counts.dislikes;
    return alpha / (alpha + beta);
  }

  scoreCardExpected(card, debug = false) {
    const features = this.extractCardFeatures(card);
    let totalWeightedScore = 0;
    let totalWeight = 0;
    
    const categoryWeights = {
      name: 4.0,
      type: 2.0,
      artist: 2.0,
      set: 1.0,
      rarity: 1.0,
      year: 0.5,
      subtype: 0.5
    };
    
    const debugDetails = {};

    for (const [category, values] of Object.entries(features)) {
      let categoryScoreSum = 0;
      
      values.forEach(val => {
        categoryScoreSum += this.sampleFeatureValueExpectedScore(category, val);
      });

      const categoryAvg = categoryScoreSum / values.length;
      const weight = categoryWeights[category] || 1.0;
      totalWeightedScore += categoryAvg * weight;
      totalWeight += weight;

      if (debug) {
        let valSum = 0;
        values.forEach(v => { valSum += this.getFeatureValueRating(category, v); });
        debugDetails[category] = Math.round((valSum / values.length) * 100);
      }
    }

    const finalScore = totalWeightedScore / totalWeight;
    return debug ? { score: finalScore, details: debugDetails } : finalScore;
  }

  sample10Cards(subPool) {
    let candidates = subPool.filter(card => !this.swipedCardIds.has(card.id));
    if (candidates.length < 10) {
      candidates = [...subPool];
    }
    
    const scored = candidates.map(card => {
      return {
        card,
        score: this.scoreCard(card)
      };
    });
    scored.sort((a, b) => b.score - a.score);
    
    const selected = [];
    const seenIds = new Set();
    
    for (let i = 0; i < scored.length && selected.length < 10; i++) {
      const c = scored[i].card;
      if (!seenIds.has(c.id)) {
        seenIds.add(c.id);
        selected.push(c);
      }
    }
    
    if (selected.length < 10) {
      for (let i = 0; i < subPool.length && selected.length < 10; i++) {
        const c = subPool[i];
        if (!seenIds.has(c.id)) {
          seenIds.add(c.id);
          selected.push(c);
        }
      }
    }
    return selected;
  }

  sample10CardsExpected(subPool) {
    let candidates = subPool.filter(card => !this.swipedCardIds.has(card.id));
    if (candidates.length < 10) {
      candidates = [...subPool];
    }
    
    const scored = candidates.map(card => {
      return {
        card,
        score: this.scoreCardExpected(card)
      };
    });
    scored.sort((a, b) => b.score - a.score);
    
    const selected = [];
    const seenIds = new Set();
    
    for (let i = 0; i < scored.length && selected.length < 10; i++) {
      const c = scored[i].card;
      if (!seenIds.has(c.id)) {
        seenIds.add(c.id);
        selected.push(c);
      }
    }
    
    if (selected.length < 10) {
      for (let i = 0; i < subPool.length && selected.length < 10; i++) {
        const c = subPool[i];
        if (!seenIds.has(c.id)) {
          seenIds.add(c.id);
          selected.push(c);
        }
      }
    }
    return selected;
  }

  // Compile a booster pack of 10 cards using multi-pack rules
  compileBoosterPack(cardsArray) {
    if (!cardsArray || cardsArray.length === 0) {
      return { cards: [], type: 'silver', subtypeName: 'Normal' };
    }

    this.packsOpenedCount++;
    localStorage.setItem('packsOpenedCount', this.packsOpenedCount.toString());

    if (this.packsOpenedCount <= 5) {
      const cards = this.sample10Cards(cardsArray);
      return { cards, type: 'silver', subtypeName: 'Normal' };
    }

    const roll = Math.random();
    
    if (roll < 0.50) {
      const cards = this.sample10Cards(cardsArray);
      return { cards, type: 'silver', subtypeName: 'Normal' };
    } else if (roll < 0.60) {
      const cards = this.sample10CardsExpected(cardsArray);
      return { cards, type: 'gold', subtypeName: 'Gold' };
    } else if (roll < 0.70) {
      const validTypes = ['Grass', 'Fire', 'Water', 'Lightning', 'Psychic', 'Fighting', 'Colorless', 'Metal', 'Darkness', 'Dragon', 'Fairy'];
      const qualifyingTypes = [];
      validTypes.forEach(t => {
        const pool = cardsArray.filter(c => c.types && c.types.includes(t));
        if (pool.length >= 10) {
          qualifyingTypes.push({ name: t, pool });
        }
      });
      if (qualifyingTypes.length > 0) {
        const chosen = qualifyingTypes[Math.floor(Math.random() * qualifyingTypes.length)];
        const cards = this.sample10Cards(chosen.pool);
        return { cards, type: 'type', subtypeName: chosen.name };
      }
    } else if (roll < 0.80) {
      const setPools = {};
      cardsArray.forEach(c => {
        const setName = c.set && c.set.name;
        if (setName) {
          if (!setPools[setName]) setPools[setName] = [];
          setPools[setName].push(c);
        }
      });
      const qualifyingSets = [];
      for (const [setName, pool] of Object.entries(setPools)) {
        if (pool.length >= 10) {
          qualifyingSets.push({ name: setName, pool });
        }
      }
      if (qualifyingSets.length > 0) {
        const chosen = qualifyingSets[Math.floor(Math.random() * qualifyingSets.length)];
        const cards = this.sample10Cards(chosen.pool);
        return { cards, type: 'set', subtypeName: chosen.name };
      }
    } else if (roll < 0.90) {
      const rarityPools = {};
      cardsArray.forEach(c => {
        const rarity = c.rarity;
        if (rarity) {
          if (!rarityPools[rarity]) rarityPools[rarity] = [];
          rarityPools[rarity].push(c);
        }
      });
      const qualifyingRarities = [];
      for (const [rarityName, pool] of Object.entries(rarityPools)) {
        if (pool.length >= 10) {
          qualifyingRarities.push({ name: rarityName, pool });
        }
      }
      if (qualifyingRarities.length > 0) {
        const chosen = qualifyingRarities[Math.floor(Math.random() * qualifyingRarities.length)];
        const cards = this.sample10Cards(chosen.pool);
        return { cards, type: 'rarity', subtypeName: chosen.name };
      }
    } else {
      const artistPools = {};
      cardsArray.forEach(c => {
        const artist = c.artist;
        if (artist) {
          if (!artistPools[artist]) artistPools[artist] = [];
          artistPools[artist].push(c);
        }
      });
      const qualifyingArtists = [];
      for (const [artistName, pool] of Object.entries(artistPools)) {
        if (pool.length >= 10) {
          qualifyingArtists.push({ name: artistName, pool });
        }
      }
      if (qualifyingArtists.length > 0) {
        const chosen = qualifyingArtists[Math.floor(Math.random() * qualifyingArtists.length)];
        const cards = this.sample10Cards(chosen.pool);
        return { cards, type: 'artist', subtypeName: chosen.name };
      }
    }

    const cards = this.sample10Cards(cardsArray);
    return { cards, type: 'silver', subtypeName: 'Normal' };
  }

  // Get like ratio in consecutive blocks of 10 swipes to plot the satisfaction curve
  getSatisfactionTrend() {
    const blockSize = 10;
    const blocks = [];
    
    for (let i = 0; i < this.swipeHistory.length; i += blockSize) {
      const chunk = this.swipeHistory.slice(i, i + blockSize);
      const likesCount = chunk.filter(h => h.action === 'like' || h.action === 'superlike').length;
      const ratio = Math.round((likesCount / chunk.length) * 100);
      blocks.push({
        blockIndex: Math.floor(i / blockSize) + 1,
        rangeLabel: `${i + 1}-${i + chunk.length}`,
        percentage: ratio
      });
    }
    return blocks;
  }

  clearStats() {
    this.likedCardIds.clear();
    this.dislikedCardIds.clear();
    this.superLikedCardIds.clear();
    this.swipedCardIds.clear();
    this.stats = { name: {}, artist: {}, type: {}, rarity: {}, set: {}, year: {}, subtype: {} };
    this.swipeHistory = [];
    this.packsOpenedCount = 0;
    this.saveToStorage();
  }
}


/* ====================================================
   3. TINDER CARD INTERACTION MODULE
=================================================== */
class CardDeck {
  constructor(containerId, onSwipe, onInspect) {
    this.container = document.getElementById(containerId);
    this.onSwipe = onSwipe;
    this.onInspect = onInspect;

    this.activeCard = null;
    this.isDragging = false;
    this.startX = 0;
    this.startY = 0;
    this.currentX = 0;
    this.currentY = 0;
    
    this.swipeThreshold = 120;
    this.maxRotation = 20;

    // Mobile drag event binders (configured to execute non-passively)
    this._handleMoveBound = (e) => this.handleMove(e);
    this._handleEndBound = (e) => this.handleEnd(e);
  }

  pushCard(card, upcomingCard = null) {
    this.container.querySelectorAll('.swipe-card').forEach(el => el.remove());

    const emptyId = this.container.id === 'pack-card-deck' ? 'pack-deck-empty' : 'deck-empty';
    const emptyEl = document.getElementById(emptyId);

    if (!card) {
      if (emptyEl) emptyEl.style.display = 'flex';
      return;
    }
    
    if (emptyEl) emptyEl.style.display = 'none';

    // 1. Render upcoming card (behind)
    if (upcomingCard) {
      const isPack = typeof upcomingCard === 'string' && upcomingCard.startsWith('booster-pack');
      const nextEl = isPack ? this.createPackCoverElement(upcomingCard) : this.createCardElement(upcomingCard);
      nextEl.classList.add('upcoming-card');
      nextEl.style.pointerEvents = 'none';
      nextEl.style.transform = 'scale(0.94) translateY(12px)';
      nextEl.style.opacity = '0.6';
      nextEl.style.zIndex = '1';
      this.container.appendChild(nextEl);
    }

    // 2. Render active card (on top)
    const cardEl = this.createCardElement(card);
    cardEl.style.zIndex = '2';
    this.container.appendChild(cardEl);
    this.activeCard = cardEl;

    this.bindEvents(cardEl, card);
  }

  createPackCoverElement(upcomingCard = '') {
    const coverEl = document.createElement('div');
    coverEl.className = 'swipe-card booster-pack-cover-stacked';
    
    // Parse theme from upcomingCard if present
    let type = 'silver';
    let subtypeName = 'Normal';
    if (upcomingCard && upcomingCard.includes(':')) {
      const parts = upcomingCard.split(':');
      type = parts[1];
      subtypeName = parts[2];
    }
    
    // Set appropriate background gradient and border based on theme
    let background = `linear-gradient(
      135deg,
      #e6e9f0 0%,
      #eef1f6 10%,
      #b2b6bd 22%,
      #7d828e 35%,
      #ffffff 45%,
      #4e5461 55%,
      #f3f5f8 68%,
      #a8acb7 80%,
      #ffffff 90%,
      #7a8090 100%
    )`;
    let border = '3px solid rgba(255, 255, 255, 0.7)';

    if (type === 'gold') {
      background = `linear-gradient(
        135deg,
        #ffe259 0%,
        #ffa751 20%,
        #ffe259 40%,
        #ffc837 60%,
        #ffa751 80%,
        #ffe259 100%
      )`;
      border = '3px solid rgba(255, 223, 0, 0.8)';
    } else if (type === 'rarity') {
      background = `linear-gradient(
        135deg,
        #ff9a9e 0%,
        #fecfef 20%,
        #a1c4fd 40%,
        #c2e9fb 60%,
        #e2ebf0 80%,
        #fbc2eb 100%
      )`;
      border = '3px solid rgba(255, 255, 255, 0.8)';
    } else if (type === 'set') {
      background = `linear-gradient(
        135deg,
        #30cfd0 0%,
        #330867 30%,
        #30cfd0 50%,
        #a2a6ad 70%,
        #330867 100%
      )`;
      border = '3px solid rgba(135, 206, 250, 0.6)';
    } else if (type === 'artist') {
      background = `linear-gradient(
        135deg,
        #f83600 0%,
        #f9d423 30%,
        #f83600 60%,
        #4a0e17 80%,
        #f83600 100%
      )`;
      border = '3px solid rgba(255, 140, 0, 0.7)';
    } else if (type === 'type') {
      const typeLower = subtypeName.toLowerCase();
      if (typeLower === 'grass') {
        background = 'linear-gradient(135deg, #11998e 0%, #38ef7d 30%, #11998e 60%, #054f24 85%, #38ef7d 100%)';
        border = '3px solid rgba(124, 252, 0, 0.6)';
      } else if (typeLower === 'fire') {
        background = 'linear-gradient(135deg, #ff416c 0%, #ff4b2b 30%, #ff416c 60%, #801000 85%, #ff4b2b 100%)';
        border = '3px solid rgba(255, 69, 0, 0.6)';
      } else if (typeLower === 'water') {
        background = 'linear-gradient(135deg, #00c6ff 0%, #0072ff 30%, #00c6ff 60%, #002c66 85%, #0072ff 100%)';
        border = '3px solid rgba(30, 144, 255, 0.6)';
      } else if (typeLower === 'lightning') {
        background = 'linear-gradient(135deg, #f5af19 0%, #f12711 30%, #f5af19 60%, #8c5d00 85%, #f5af19 100%)';
        border = '3px solid rgba(255, 215, 0, 0.7)';
      } else if (typeLower === 'psychic') {
        background = 'linear-gradient(135deg, #9053c7 0%, #a1c4fd 35%, #9053c7 60%, #4a154b 85%, #9053c7 100%)';
        border = '3px solid rgba(218, 112, 214, 0.6)';
      } else if (typeLower === 'fighting') {
        background = 'linear-gradient(135deg, #805b47 0%, #b8860b 35%, #805b47 60%, #3d2314 85%, #b8860b 100%)';
        border = '3px solid rgba(218, 165, 32, 0.6)';
      } else if (typeLower === 'colorless') {
        background = 'linear-gradient(135deg, #bdc3c7 0%, #2c3e50 35%, #bdc3c7 60%, #1e272e 85%, #bdc3c7 100%)';
        border = '3px solid rgba(220, 220, 220, 0.6)';
      } else if (typeLower === 'metal') {
        background = 'linear-gradient(135deg, #8e9eab 0%, #eef2f3 35%, #8e9eab 60%, #4a545e 85%, #eef2f3 100%)';
        border = '3px solid rgba(255, 255, 255, 0.8)';
      } else if (typeLower === 'darkness') {
        background = 'linear-gradient(135deg, #0f2027 0%, #203a43 35%, #2c5364 60%, #000000 85%, #203a43 100%)';
        border = '3px solid rgba(72, 85, 99, 0.6)';
      } else if (typeLower === 'dragon') {
        background = 'linear-gradient(135deg, #a770ef 0%, #cf8bf3 35%, #fdb99b 60%, #5d1421 85%, #cf8bf3 100%)';
        border = '3px solid rgba(255, 99, 71, 0.6)';
      } else if (typeLower === 'fairy') {
        background = 'linear-gradient(135deg, #ff9a9e 0%, #fecfef 35%, #a1c4fd 60%, #7e1634 85%, #fecfef 100%)';
        border = '3px solid rgba(255, 182, 193, 0.7)';
      }
    }
    
    coverEl.style.background = background;
    coverEl.style.border = border;
    coverEl.style.boxShadow = 'inset 0 0 40px rgba(0, 0, 0, 0.4)';
    coverEl.style.setProperty('--card-glow-color', 'rgba(255, 255, 255, 0.1)');
    
    // Add Pokeball center
    const pokeball = document.createElement('div');
    pokeball.style.position = 'absolute';
    pokeball.style.top = '50%';
    pokeball.style.left = '50%';
    pokeball.style.transform = 'translate(-50%, -50%)';
    pokeball.style.width = '60px';
    pokeball.style.height = '60px';
    pokeball.style.borderRadius = '50%';
    pokeball.style.border = '4px solid #1a1a24';
    pokeball.style.background = 'linear-gradient(135deg, #ff4d6d 50%, #ffffff 50%)';
    pokeball.style.boxShadow = '0 0 10px rgba(0,0,0,0.3)';
    
    const center = document.createElement('div');
    center.style.position = 'absolute';
    center.style.top = '50%';
    center.style.left = '50%';
    center.style.transform = 'translate(-50%, -50%)';
    center.style.width = '18px';
    center.style.height = '18px';
    center.style.background = '#ffffff';
    center.style.border = '3px solid #1a1a24';
    center.style.borderRadius = '50%';
    pokeball.appendChild(center);
    
    coverEl.appendChild(pokeball);

    // Add text
    const text = document.createElement('div');
    const fullText = type === 'gold' ? 'GOLD COMPILATION' : (type === 'silver' ? 'BOOSTER PACK' : `${subtypeName.toUpperCase()} PACK`);
    text.innerText = fullText;
    text.style.position = 'absolute';
    text.style.width = '100%';
    text.style.textAlign = 'center';
    text.style.bottom = '20px';
    text.style.fontFamily = "'Outfit', sans-serif";
    text.style.fontWeight = '900';
    text.style.color = '#fff';
    text.style.textShadow = '0 1px 3px #000';
    text.style.whiteSpace = 'nowrap';
    text.style.boxSizing = 'border-box';
    text.style.padding = '0 10px';

    const len = fullText.length;
    if (len > 24) {
      text.style.fontSize = '0.65rem';
      text.style.letterSpacing = '0.5px';
    } else if (len > 18) {
      text.style.fontSize = '0.75rem';
      text.style.letterSpacing = '1px';
    } else if (len > 12) {
      text.style.fontSize = '0.85rem';
      text.style.letterSpacing = '1.5px';
    } else {
      text.style.fontSize = '0.95rem';
      text.style.letterSpacing = '2px';
    }

    coverEl.appendChild(text);

    return coverEl;
  }

  createCardElement(card) {
    const cardEl = document.createElement('div');
    cardEl.className = 'swipe-card';
    cardEl.dataset.id = card.id;

    const firstType = card.types && card.types[0] ? card.types[0].toLowerCase() : 'colorless';
    cardEl.style.setProperty('--card-glow-color', `var(--type-${firstType})`);

    const img = document.createElement('img');
    img.src = card.images.small;
    img.alt = card.name;
    img.loading = 'eager';
    cardEl.appendChild(img);

    const holo = document.createElement('div');
    holo.className = 'holo-sheen';
    cardEl.appendChild(holo);

    // Nope, Like and Super Like Stamps
    const stampLike = document.createElement('div');
    stampLike.className = 'stamp stamp-like';
    stampLike.innerText = 'Like';
    cardEl.appendChild(stampLike);

    const stampNope = document.createElement('div');
    stampNope.className = 'stamp stamp-nope';
    stampNope.innerText = 'Nope';
    cardEl.appendChild(stampNope);

    const stampSuper = document.createElement('div');
    stampSuper.className = 'stamp stamp-super';
    stampSuper.innerText = 'Super Like';
    cardEl.appendChild(stampSuper);

    return cardEl;
  }

  bindEvents(cardEl, card) {
    const handleStart = (e) => {
      this.isDragging = true;
      cardEl.style.transition = 'none';
      
      const clientX = e.type.startsWith('touch') ? e.touches[0].clientX : e.clientX;
      const clientY = e.type.startsWith('touch') ? e.touches[0].clientY : e.clientY;
      
      this.startX = clientX;
      this.startY = clientY;
      
      // Bind dragging move/end on window (non-passive for touch triggers to block scrolling)
      window.addEventListener('mousemove', this._handleMoveBound);
      window.addEventListener('touchmove', this._handleMoveBound, { passive: false });
      
      window.addEventListener('mouseup', this._handleEndBound);
      window.addEventListener('touchend', this._handleEndBound);
    };

    const handleHoverParallax = (e) => {
      if (this.isDragging || e.type !== 'mousemove') return;
      
      const rect = cardEl.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      
      const rotateY = ((x / rect.width) - 0.5) * 15;
      const rotateX = -(((y / rect.height) - 0.5) * 15);
      
      cardEl.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale3d(1.02, 1.02, 1.02)`;
      
      const holo = cardEl.querySelector('.holo-sheen');
      if (holo) {
        holo.style.backgroundPosition = `${(x / rect.width) * 100}% ${(y / rect.height) * 100}%`;
        holo.style.opacity = '0.7';
      }
    };

    const handleLeave = () => {
      if (!this.isDragging) {
        cardEl.style.transform = 'perspective(1000px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)';
        cardEl.style.transition = 'transform 0.4s ease';
        
        const holo = cardEl.querySelector('.holo-sheen');
        if (holo) holo.style.opacity = '0';
      }
    };

    cardEl.addEventListener('mousedown', handleStart);
    cardEl.addEventListener('touchstart', handleStart, { passive: true });
    
    cardEl.addEventListener('mousemove', handleHoverParallax);
    cardEl.addEventListener('mouseleave', handleLeave);

    cardEl.addEventListener('dblclick', () => this.onInspect(card));
  }

  handleMove(e) {
    if (!this.isDragging) return;

    // Prevent default body scrolling while dragging card
    if (e.cancelable) {
      e.preventDefault();
    }

    const clientX = e.type.startsWith('touch') ? e.touches[0].clientX : e.clientX;
    const clientY = e.type.startsWith('touch') ? e.touches[0].clientY : e.clientY;
    
    this.currentX = clientX - this.startX;
    this.currentY = clientY - this.startY;

    // Enhanced 3D tilt
    const rotY = (this.currentX / this.swipeThreshold) * 15;
    const rotX = -(this.currentY / this.swipeThreshold) * 10;
    const rotZ = (this.currentX / this.swipeThreshold) * this.maxRotation;
    const boundedRotZ = Math.max(-this.maxRotation, Math.min(this.maxRotation, rotZ));

    this.activeCard.style.transform = `translate(${this.currentX}px, ${this.currentY}px) perspective(1000px) rotateX(${rotX}deg) rotateY(${rotY}deg) rotateZ(${boundedRotZ}deg)`;

    const stampLike = this.activeCard.querySelector('.stamp-like');
    const stampNope = this.activeCard.querySelector('.stamp-nope');
    const stampSuper = this.activeCard.querySelector('.stamp-super');
    
    // Check if dragging mostly UPwards -> SUPER LIKE
    if (this.currentY < -40 && Math.abs(this.currentY) > Math.abs(this.currentX)) {
      stampSuper.style.opacity = Math.min(1, -this.currentY / 80);
      stampLike.style.opacity = 0;
      stampNope.style.opacity = 0;
    } else {
      stampSuper.style.opacity = 0;
      if (this.currentX > 0) {
        stampLike.style.opacity = Math.min(1, this.currentX / 80);
        stampNope.style.opacity = 0;
      } else {
        stampNope.style.opacity = Math.min(1, -this.currentX / 80);
        stampLike.style.opacity = 0;
      }
    }

    const holo = this.activeCard.querySelector('.holo-sheen');
    if (holo) {
      holo.style.backgroundPosition = `${50 + this.currentX * 0.15}% ${50 + this.currentY * 0.15}%`;
      holo.style.opacity = Math.min(1, Math.max(Math.abs(this.currentX), Math.abs(this.currentY)) / 60);
    }

    // Scale and translate the upcoming card based on drag ratio
    const upcomingCardEl = this.container.querySelector('.upcoming-card');
    if (upcomingCardEl) {
      const dragDistance = Math.max(Math.abs(this.currentX), Math.abs(this.currentY));
      const dragRatio = Math.min(1, dragDistance / this.swipeThreshold);
      const scale = 0.94 + dragRatio * 0.06;
      const translateY = 12 - dragRatio * 12;
      const opacity = 0.6 + dragRatio * 0.4;
      upcomingCardEl.style.transform = `scale(${scale}) translateY(${translateY}px)`;
      upcomingCardEl.style.opacity = opacity;
    }
  }

  handleEnd(e) {
    if (!this.isDragging) return;
    this.isDragging = false;

    // Remove window event listeners
    window.removeEventListener('mousemove', this._handleMoveBound);
    window.removeEventListener('touchmove', this._handleMoveBound);
    window.removeEventListener('mouseup', this._handleEndBound);
    window.removeEventListener('touchend', this._handleEndBound);

    // Read touch coordinates on touch release fallback
    let lastX = this.currentX;
    let lastY = this.currentY;

    if (e.type === 'touchend' && e.changedTouches && e.changedTouches.length > 0) {
      // Touch release points are fine
    }

    // Process drag coordinates
    if (lastY < -this.swipeThreshold && Math.abs(lastY) > Math.abs(lastX)) {
      this.animateFlyAway('superlike');
    } else if (Math.abs(lastX) >= this.swipeThreshold) {
      const direction = lastX > 0 ? 'like' : 'dislike';
      this.animateFlyAway(direction);
    } else {
      this.animateReset();
    }
  }

  swipe(direction) {
    if (this.isDragging || !this.activeCard) return;
    this.animateFlyAway(direction);
  }

  animateFlyAway(direction) {
    const cardEl = this.activeCard;
    if (!cardEl) return;

    this.activeCard = null;
    
    let flyX = 0;
    let flyY = 0;
    let rotation = 0;

    if (direction === 'superlike') {
      flyX = this.currentX || 0;
      flyY = -window.innerHeight - 200;
      rotation = 5;
    } else {
      flyX = direction === 'like' ? window.innerWidth + 200 : -window.innerWidth - 200;
      flyY = this.currentY || 0;
      rotation = direction === 'like' ? 35 : -35;
    }

    const stamp = cardEl.querySelector(`.stamp-${direction === 'superlike' ? 'super' : direction}`);
    if (stamp) stamp.style.opacity = '1';

    cardEl.style.transition = 'transform 0.45s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
    cardEl.style.transform = `translate(${flyX}px, ${flyY}px) rotate(${rotation}deg)`;

    // Scale up the upcoming card behind it
    const upcomingCardEl = this.container.querySelector('.upcoming-card');
    if (upcomingCardEl) {
      upcomingCardEl.style.transition = 'transform 0.35s cubic-bezier(0.25, 0.46, 0.45, 0.94), opacity 0.35s';
      upcomingCardEl.style.transform = 'scale(1) translateY(0px)';
      upcomingCardEl.style.opacity = '1';
    }

    setTimeout(() => {
      cardEl.remove();
      this.onSwipe(direction);
    }, 450);

    this.currentX = 0;
    this.currentY = 0;
  }

  animateReset() {
    const cardEl = this.activeCard;
    if (!cardEl) return;

    cardEl.style.transition = 'transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.2)';
    cardEl.style.transform = 'translate(0px, 0px) rotate(0deg)';

    const stampLike = cardEl.querySelector('.stamp-like');
    const stampNope = cardEl.querySelector('.stamp-nope');
    const stampSuper = cardEl.querySelector('.stamp-super');
    const holo = cardEl.querySelector('.holo-sheen');

    if (stampLike) stampLike.style.opacity = 0;
    if (stampNope) stampNope.style.opacity = 0;
    if (stampSuper) stampSuper.style.opacity = 0;
    if (holo) holo.style.opacity = 0;

    // Reset upcoming card
    const upcomingCardEl = this.container.querySelector('.upcoming-card');
    if (upcomingCardEl) {
      upcomingCardEl.style.transition = 'transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.2), opacity 0.3s';
      upcomingCardEl.style.transform = 'scale(0.94) translateY(12px)';
      upcomingCardEl.style.opacity = '0.6';
      setTimeout(() => {
        if (upcomingCardEl) upcomingCardEl.style.transition = 'none';
      }, 300);
    }

    this.currentX = 0;
    this.currentY = 0;
  }
}


/* ====================================================
   4. UI CONTROLLER MODULE (INTEGRATION)
==================================================== */
class UIController {
  constructor(db, recommender) {
    this.db = db;
    this.recommender = recommender;
    this.cards = [];
    this.cardsMap = new Map();

    this.previousThemeColor = null;

    // Expandable Analytics Lists (Toggles status tracker)
    this.expandedCategories = {
      type: false,
      name: false,
      artist: false,
      set: false,
      rarity: false
    };

    // Booster Pack state variables
    this.currentPackCards = [];
    this.currentPackMetadata = null;
    this.slicedState = false;
    this.flippedCount = 0;
    this.packSwipeIndex = 0;
    this.currentActivePackCard = null;
    this.isDrawingSlash = false;
    this.slashPoints = [];
    this.slashCanvas = null;
    this.slashCtx = null;
    this.particles = [];
    this.particleAnimationId = null;

    this.packDeck = new CardDeck('pack-card-deck', 
      (action) => this.handlePackCardSwipe(action), 
      (card) => this.openInspectorModal(card)
    );

    this.init();
  }

  async init() {
    try {
      await this.db.init();
      
      const cachedCount = await this.db.getCardCount();
      document.getElementById('settings-db-count').innerText = `${cachedCount} cards cached`;

      if (cachedCount < 500) {
        // First Boot: Download 2 random pages (500 cards) in parallel to load rapidly
        this.showSplashProgress(5, 'Connecting to TCG database...');
        
        const targetPages = 2;
        let fetchedCount = 0;
        const batchSize = 2;

        while (fetchedCount < targetPages) {
          const batchPages = [];
          for (let i = 0; i < batchSize; i++) {
            const page = this.db.getRandomUnfetchedPage();
            if (page !== -1) {
              batchPages.push(page);
            }
          }
          
          if (batchPages.length === 0) break;

          const progressPct = Math.round((fetchedCount / targetPages) * 100);
          this.showSplashProgress(
            progressPct,
            `Downloading initial card library (${progressPct}% complete)...`
          );

          try {
            // Fetch batch pages concurrently
            const results = await Promise.all(batchPages.map(page => this.db.fetchCardsPage(page)));
            
            // Save card bundles to IndexedDB
            for (const data of results) {
              if (data.cards.length > 0) {
                await this.db.saveCards(data.cards);
              }
            }
          } catch (err) {
            console.error('Batch download failed:', err);
          }

          fetchedCount += batchPages.length;
          
          // Tiny rest interval
          await new Promise(r => setTimeout(r, 400));
        }

        this.hideSplash();
      } else {
        this.hideSplash();
      }

      await this.reloadLocalMemory();

      // Background downloader queue to continuously sync the full collection
      this.db.startBackgroundSync((page, count, newCards) => {
        const pill = document.getElementById('settings-db-count');
        if (pill) pill.innerText = `${count} cards cached`;
        
        // Append cards in memory without full IndexedDB hits to avoid stutters
        if (newCards && newCards.length > 0) {
          newCards.forEach(card => {
            if (!this.cardsMap.has(card.id)) {
              this.cards.push(card);
              this.cardsMap.set(card.id, card);
            }
          });
          this.updateBinderCountBadge();
        }

        if (page === -1) {
          console.log(`Background sync complete. Cards cached: ${count}`);
        }
      });

      this.initPacksView();

    } catch (e) {
      console.error('Initialization failed:', e);
      document.getElementById('splash-progress-text').innerText = 'Error loading cards. Please check connection.';
      return;
    }

    this.bindDOMEvents();
    this.setupPackSlicing();
    lucide.createIcons();
  }

  async reloadLocalMemory() {
    this.cards = await this.db.getAllCards();
    this.cardsMap.clear();
    this.cards.forEach(card => this.cardsMap.set(card.id, card));
    this.updateBinderCountBadge();
    this.populateFilterDropdowns();
  }

  updateLocalBinderState() {
    this.updateBinderCountBadge();
    this.populateFilterDropdowns();
  }

  preloadImage(src) {
    if (!src) return;
    const img = new Image();
    img.src = src;
  }



  preloadPackImages() {
    if (!this.currentPackCards) return;
    this.currentPackCards.forEach(card => {
      if (card && card.images && card.images.small) {
        this.preloadImage(card.images.small);
      }
    });
  }

  showSplashProgress(pct, text) {
    document.getElementById('splash-progress').style.width = `${pct}%`;
    document.getElementById('splash-progress-text').innerText = text;
  }

  hideSplash() {
    const splash = document.getElementById('splash-screen');
    splash.classList.add('fade-out');
    document.getElementById('app-container').style.display = 'flex';
  }



  updateBinderCountBadge() {
    const likesCount = this.recommender.likedCardIds.size;
    const badge = document.getElementById('binder-count-badge');
    if (!badge) return;
    
    if (likesCount > 0) {
      badge.innerText = likesCount;
      badge.style.display = 'inline-block';
    } else {
      badge.style.display = 'none';
    }
  }

  /* ----------------------------------------------------
     COLLECTOR BINDER RENDERING
  ---------------------------------------------------- */
  populateFilterDropdowns() {
    const binderCards = this.cards.filter(card => this.recommender.likedCardIds.has(card.id) || this.recommender.dislikedCardIds.has(card.id));

    const supertypes = new Set();
    const types = new Set();
    const subtypes = new Set();
    const sets = new Set();
    const rarities = new Set();
    const years = new Set();
    const artists = new Set();

    binderCards.forEach(card => {
      if (card.supertype) supertypes.add(card.supertype);
      if (card.types) card.types.forEach(t => types.add(t));
      if (card.subtypes) card.subtypes.forEach(s => subtypes.add(s));
      if (card.set && card.set.name) sets.add(card.set.name);
      if (card.rarity) rarities.add(card.rarity);
      
      const year = getReleaseYear(card);
      if (year && year !== 'Unknown') years.add(year);
      if (card.artist) artists.add(card.artist);
    });

    const getLikeCount = (category, val) => {
      if (category === 'supertype') {
        let count = 0;
        this.cards.forEach(card => {
          if (this.recommender.likedCardIds.has(card.id) && card.supertype === val) {
            count++;
          }
        });
        return count;
      }
      const counts = this.recommender.stats[category]?.[val];
      return counts ? counts.likes : 0;
    };

    const setSelect = (id, label, set, category) => {
      const el = document.getElementById(id);
      if (!el) return;
      
      const prevVal = el.value;
      el.innerHTML = `<option value="">${label}</option>`;
      
      const sortedVals = [...set].sort((a, b) => {
        const likesA = getLikeCount(category, a);
        const likesB = getLikeCount(category, b);
        if (likesB !== likesA) {
          return likesB - likesA;
        }
        return a.localeCompare(b);
      });

      sortedVals.forEach(val => {
        el.innerHTML += `<option value="${val}">${val}</option>`;
      });
      el.value = prevVal;
    };

    setSelect('filter-supertype', 'All Supertypes', supertypes, 'supertype');
    setSelect('filter-type', 'All Types', types, 'type');
    setSelect('filter-subtype', 'All Subtypes', subtypes, 'subtype');
    setSelect('filter-set', 'All Sets', sets, 'set');
    setSelect('filter-rarity', 'All Rarities', rarities, 'rarity');
    setSelect('filter-year', 'All Years', years, 'year');
    setSelect('filter-artist', 'All Artists', artists, 'artist');
  }

  renderBinderGrid() {
    const grid = document.getElementById('binder-grid');
    const emptyState = document.getElementById('binder-empty');

    const searchVal = document.getElementById('binder-search').value.toLowerCase();
    const filterCollection = document.getElementById('filter-collection').value;
    const filterSupertype = document.getElementById('filter-supertype').value;
    const filterType = document.getElementById('filter-type').value;
    const filterSubtype = document.getElementById('filter-subtype').value;
    const filterSet = document.getElementById('filter-set').value;
    const filterRarity = document.getElementById('filter-rarity').value;
    const filterYear = document.getElementById('filter-year').value;
    const filterArtist = document.getElementById('filter-artist').value;
    const sortBy = document.getElementById('sort-by').value;

    let binderCards = [];
    if (filterCollection === 'dislikes') {
      binderCards = this.cards.filter(card => this.recommender.dislikedCardIds.has(card.id));
    } else {
      binderCards = this.cards.filter(card => this.recommender.likedCardIds.has(card.id));
      
      // Filter Likes vs Super Likes
      if (filterCollection === 'likes') {
        binderCards = binderCards.filter(card => !this.recommender.superLikedCardIds.has(card.id));
      } else if (filterCollection === 'supers') {
        binderCards = binderCards.filter(card => this.recommender.superLikedCardIds.has(card.id));
      }
    }

    // Filter Supertype
    if (filterSupertype) {
      binderCards = binderCards.filter(card => card.supertype === filterSupertype);
    }

    // Filter Pokemon Type
    if (filterType) {
      binderCards = binderCards.filter(card => card.types && card.types.includes(filterType));
    }

    // Filter Subtype
    if (filterSubtype) {
      binderCards = binderCards.filter(card => card.subtypes && card.subtypes.includes(filterSubtype));
    }

    // Filter Set
    if (filterSet) {
      binderCards = binderCards.filter(card => card.set && card.set.name === filterSet);
    }

    // Filter Rarity
    if (filterRarity) {
      binderCards = binderCards.filter(card => card.rarity === filterRarity);
    }

    // Filter Release Year
    if (filterYear) {
      binderCards = binderCards.filter(card => getReleaseYear(card) === filterYear);
    }

    // Filter Artist
    if (filterArtist) {
      binderCards = binderCards.filter(card => card.artist === filterArtist);
    }

    // Apply Search
    if (searchVal) {
      binderCards = binderCards.filter(card => 
        card.name.toLowerCase().includes(searchVal) || 
        (card.artist && card.artist.toLowerCase().includes(searchVal)) ||
        (card.set?.name && card.set.name.toLowerCase().includes(searchVal))
      );
    }

    // Apply Sorting
    binderCards.sort((a, b) => {
      const priceA = getCardPrice(a).market;
      const priceB = getCardPrice(b).market;

      if (sortBy === 'price-desc') return priceB - priceA;
      if (sortBy === 'price-asc') return priceA - priceB;
      if (sortBy === 'name-asc') return a.name.localeCompare(b.name);
      if (sortBy === 'name-desc') return b.name.localeCompare(a.name);
      
      const indexA = this.recommender.swipeHistory.findIndex(h => h.cardId === a.id);
      const indexB = this.recommender.swipeHistory.findIndex(h => h.cardId === b.id);
      
      if (sortBy === 'date-desc') return indexB - indexA;
      if (sortBy === 'date-asc') return indexA - indexB;
      
      return 0;
    });

    grid.innerHTML = '';

    if (binderCards.length === 0) {
      grid.style.display = 'none';
      emptyState.style.display = 'flex';
      
      document.getElementById('binder-stat-count').innerText = 0;
      document.getElementById('binder-stat-value').innerText = '$0.00';
      document.getElementById('binder-stat-holo').innerText = 0;
      return;
    }

    grid.style.display = 'grid';
    emptyState.style.display = 'none';

    let totalPrice = 0;
    let holoCount = 0;

    binderCards.forEach(card => {
      const price = getCardPrice(card).market;
      totalPrice += price;

      const isHolo = card.rarity && (card.rarity.toLowerCase().includes('holo') || card.rarity.toLowerCase().includes('secret') || card.rarity.toLowerCase().includes('shiny') || card.rarity.toLowerCase().includes('promo'));
      if (isHolo) holoCount++;

      const binderCardEl = document.createElement('div');
      binderCardEl.className = 'binder-card';
      if (this.recommender.superLikedCardIds.has(card.id)) {
        binderCardEl.classList.add('super-liked');
      }

      const firstType = card.types && card.types[0] ? card.types[0].toLowerCase() : 'colorless';
      binderCardEl.style.setProperty('--card-glow-color', `var(--type-${firstType})`);

      const img = document.createElement('img');
      img.src = card.images.small;
      img.alt = card.name;
      img.loading = 'lazy';
      binderCardEl.appendChild(img);

      const removeBtn = document.createElement('button');
      removeBtn.className = 'binder-card-remove-btn';
      removeBtn.title = 'Remove from collection';
      removeBtn.innerHTML = '<i data-lucide="trash-2"></i>';
      
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isSuper = this.recommender.superLikedCardIds.has(card.id);
        
        // Remove from collection sets
        this.recommender.likedCardIds.delete(card.id);
        this.recommender.superLikedCardIds.delete(card.id);
        this.recommender.swipedCardIds.delete(card.id); // make it eligible for swiping again!
        
        // Subtract feature weights (-5 if super like, -1 if regular like)
        const weight = isSuper ? 5 : 1;
        this.recommender.adjustStats(card, true, -weight);
        this.recommender.swipeHistory.push({ cardId: card.id, action: isSuper ? 'remove_super' : 'remove_like' });
        this.recommender.saveToStorage();

        this.updateLocalBinderState();
        this.renderBinderGrid();
      });

      // Super Like star toggle button
      const superBtn = document.createElement('button');
      superBtn.className = 'binder-card-super-btn';
      const isSuper = this.recommender.superLikedCardIds.has(card.id);
      superBtn.title = isSuper ? 'Convert to regular Like' : 'Convert to Super Like';
      superBtn.innerHTML = '<i data-lucide="star"></i>';
      
      superBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.recommender.toggleSuperLikeStatus(card);
        this.updateLocalBinderState();
        this.renderBinderGrid();
      });

      binderCardEl.appendChild(removeBtn);
      binderCardEl.appendChild(superBtn);

      binderCardEl.addEventListener('click', () => this.openInspectorModal(card));
      grid.appendChild(binderCardEl);
    });

    document.getElementById('binder-stat-count').innerText = binderCards.length;
    document.getElementById('binder-stat-value').innerText = `$${totalPrice.toFixed(2)}`;
    document.getElementById('binder-stat-holo').innerText = holoCount;

    lucide.createIcons();
  }

  /* ----------------------------------------------------
     ANALYTICS STATS DASHBOARD RENDERING
  ---------------------------------------------------- */
  renderStatsView() {
    const swiped = this.recommender.swipedCardIds.size;
    const likes = this.recommender.likedCardIds.size;
    const dislikes = this.recommender.dislikedCardIds.size;
    const likePct = swiped > 0 ? Math.round((likes / swiped) * 100) : 0;

    document.getElementById('stats-total-swiped').innerText = swiped;
    document.getElementById('stats-like-pct').innerText = likePct;
    document.getElementById('stats-likes').innerText = likes;
    document.getElementById('stats-dislikes').innerText = dislikes;

    let binderValue = 0;
    let maxCardPrice = 0;
    this.cards.forEach(card => {
      if (this.recommender.likedCardIds.has(card.id)) {
        const p = getCardPrice(card).market;
        binderValue += p;
        if (p > maxCardPrice) maxCardPrice = p;
      }
    });

    document.getElementById('stats-worth').innerText = `$${binderValue.toFixed(2)}`;
    document.getElementById('stats-max-card-price').innerText = `$${maxCardPrice.toFixed(2)}`;

    // RENDER: Algorithmic satisfaction curves
    this.renderSatisfactionTrendChart();

    // RENDER: Expandable preference lists
    this.renderPreferencePanel('type', 'stats-types-list', 'btn-show-more-types');
    this.renderPreferencePanel('name', 'stats-names-list', 'btn-show-more-names');
    this.renderPreferencePanel('artist', 'stats-artists-list', 'btn-show-more-artists');
    this.renderPreferencePanel('set', 'stats-sets-list', 'btn-show-more-sets');
    this.renderPreferencePanel('rarity', 'stats-rarities-list', 'btn-show-more-rarities');
  }

  // satisfaction vertical trend bar chart compiler
  renderSatisfactionTrendChart() {
    const container = document.getElementById('stats-satisfaction-trend');
    const blocks = this.recommender.getSatisfactionTrend();

    if (blocks.length === 0) {
      container.innerHTML = '<p class="no-data-text">Complete at least 10 swipes to see the satisfaction trend curve...</p>';
      return;
    }

    container.innerHTML = '';

    const displayedBlocks = blocks.slice(-10);
    displayedBlocks.forEach(block => {
      const barWrapper = document.createElement('div');
      barWrapper.className = 'trend-bar-wrapper';

      const valLabel = document.createElement('span');
      valLabel.className = 'trend-bar-val';
      valLabel.innerText = `${block.percentage}%`;
      barWrapper.appendChild(valLabel);

      const track = document.createElement('div');
      track.className = 'trend-bar-track';

      const fill = document.createElement('div');
      fill.className = 'trend-bar-fill';
      
      // Delay height render triggers to enable nice CSS transition animations on load
      setTimeout(() => {
        fill.style.height = `${block.percentage}%`;
      }, 50);

      track.appendChild(fill);
      barWrapper.appendChild(track);

      const label = document.createElement('span');
      label.className = 'trend-bar-label';
      label.innerText = block.rangeLabel;
      barWrapper.appendChild(label);

      container.appendChild(barWrapper);
    });
  }

  // Dynamic preference panels compiler with Show More pagination
  renderPreferencePanel(category, containerId, buttonId) {
    const container = document.getElementById(containerId);
    const button = document.getElementById(buttonId);
    
    const statsList = this.compileFeatureRatio(category);

    if (statsList.length === 0) {
      container.innerHTML = `<p class="no-data-text">Swipe on more cards to compile favorite ${category}s...</p>`;
      button.style.display = 'none';
      return;
    }

    const isExpanded = this.expandedCategories[category];
    const displayCount = isExpanded ? statsList.length : 5;

    container.innerHTML = '';

    // Render entries
    if (category === 'type' || category === 'rarity') {
      // Bar layout
      statsList.slice(0, displayCount).forEach(stat => {
        const typeColor = category === 'type' 
          ? `var(--type-${stat.value.toLowerCase()}, var(--type-colorless))`
          : 'var(--color-yellow)';
          
        container.innerHTML += `
          <div class="stat-row">
            <div class="stat-row-label-row">
              <span>${stat.value}</span>
              <span class="stat-row-sub">${stat.likes}/${stat.seen} swiped (${stat.pct}%)</span>
            </div>
            <div class="progress-track">
              <div class="progress-fill" style="width: ${stat.pct}%; background-color: ${typeColor};"></div>
            </div>
          </div>
        `;
      });
    } else {
      // Rank layout
      statsList.slice(0, displayCount).forEach((stat, idx) => {
        container.innerHTML += `
          <div class="top-list-item">
            <div class="top-list-left">
              <div class="top-list-rank">${idx + 1}</div>
              <div class="top-list-name" title="${stat.value}">${stat.value}</div>
            </div>
            <div class="top-list-right">
              <span class="top-list-ratio">${stat.pct}%</span>
              <span class="top-list-count">${stat.likes}/${stat.seen} likes</span>
            </div>
          </div>
        `;
      });
    }

    // Toggle button visibility and text labels
    if (statsList.length > 5) {
      button.style.display = 'block';
      button.innerText = isExpanded ? 'Show Less' : 'Show More';
    } else {
      button.style.display = 'none';
    }
  }

  // Compile stats ratio helper: sorts by like percentage, with a secondary sorting by seen count to avoid 1/1 likes skewing top rankings
  compileFeatureRatio(category) {
    const data = this.recommender.stats[category] || {};
    const array = [];

    for (const [value, counts] of Object.entries(data)) {
      const seen = counts.likes + counts.dislikes;
      if (seen > 0) {
        const pct = Math.round((counts.likes / seen) * 100);
        array.push({ value, likes: counts.likes, dislikes: counts.dislikes, seen, pct });
      }
    }

    return array.sort((a, b) => {
      if (b.pct !== a.pct) {
        return b.pct - a.pct;
      }
      return b.seen - a.seen;
    });
  }

  /* ----------------------------------------------------
     CARD INSPECTOR MODAL RENDERING
  ---------------------------------------------------- */
  openInspectorModal(card) {
    const modal = document.getElementById('card-modal');
    modal.classList.add('active');

    const card3D = document.getElementById('modal-card-3d');
    card3D.style.transform = 'perspective(1000px) rotateX(0deg) rotateY(0deg)';

    const largeImg = card.images.large || card.images.small;
    document.getElementById('modal-card-img').src = largeImg;

    document.getElementById('modal-card-name').innerText = card.name;
    document.getElementById('modal-card-id').innerText = `${card.set.id.toUpperCase()} #${card.number}`;
    
    // Type badges
    const typePill = document.getElementById('modal-card-type');
    if (card.types && card.types[0]) {
      typePill.innerText = card.types[0];
      typePill.style.display = 'inline-block';
      typePill.style.backgroundColor = `var(--type-${card.types[0].toLowerCase()}, var(--type-colorless))`;
    } else {
      typePill.style.display = 'none';
    }

    const subtypePill = document.getElementById('modal-card-subtypes');
    if (card.subtypes && card.subtypes.length > 0) {
      subtypePill.innerText = card.subtypes.join(', ');
      subtypePill.style.display = 'inline-block';
    } else {
      subtypePill.style.display = 'none';
    }

    const rarityPill = document.getElementById('modal-card-rarity');
    if (card.rarity) {
      rarityPill.innerText = card.rarity;
      rarityPill.style.display = 'inline-block';
    } else {
      rarityPill.style.display = 'none';
    }

    // Prices
    const pricing = getCardPrice(card);
    document.getElementById('price-low').innerText = pricing.low > 0 ? `$${pricing.low.toFixed(2)}` : 'N/A';
    document.getElementById('price-market').innerText = pricing.market > 0 ? `$${pricing.market.toFixed(2)}` : 'N/A';
    document.getElementById('price-high').innerText = pricing.high > 0 ? `$${pricing.high.toFixed(2)}` : 'N/A';

    const tcgplayerBtn = document.getElementById('modal-tcgplayer-btn');
    if (card.tcgplayer?.url) {
      tcgplayerBtn.href = card.tcgplayer.url;
      tcgplayerBtn.style.display = 'inline-flex';
    } else {
      tcgplayerBtn.style.display = 'none';
    }

    // Card Profile details
    document.getElementById('profile-artist').innerText = card.artist || 'Unknown';
    document.getElementById('profile-set-name').innerText = card.set?.name || 'Unknown Set';
    document.getElementById('profile-release').innerText = card.set?.releaseDate || 'Unknown Date';
    document.getElementById('profile-hp').innerText = card.hp ? `${card.hp} HP` : 'N/A';
    document.getElementById('profile-supertype').innerText = card.supertype || 'Pokémon';
    
    const setSymbol = document.getElementById('profile-set-symbol');
    if (card.set?.images?.symbol) {
      setSymbol.src = card.set.images.symbol;
      setSymbol.style.display = 'inline-block';
    } else {
      setSymbol.style.display = 'none';
    }

    // Attacks list
    const attackSection = document.getElementById('modal-section-attacks');
    const attackList = document.getElementById('modal-attacks-list');
    attackList.innerHTML = '';

    const hasAttacks = card.attacks && card.attacks.length > 0;
    const hasRules = card.rules && card.rules.length > 0;

    if (hasAttacks) {
      attackSection.style.display = 'block';
      card.attacks.forEach(attack => {
        let energyHTML = '';
        if (attack.cost) {
          attack.cost.forEach(cost => {
            const costColor = `var(--type-${cost.toLowerCase()}, var(--type-colorless))`;
            const textSymbol = cost.substring(0, 1);
            energyHTML += `<span class="energy-symbol" style="background-color: ${costColor};" title="${cost}">${textSymbol}</span>`;
          });
        }

        attackList.innerHTML += `
          <div class="attack-item">
            <div class="attack-header">
              <div class="attack-name-cost">
                <span class="attack-name">${attack.name}</span>
                <div class="energy-cost">${energyHTML}</div>
              </div>
              <span class="attack-damage">${attack.damage ? attack.damage : ''}</span>
            </div>
            <p class="attack-text">${attack.text ? attack.text : ''}</p>
          </div>
        `;
      });
    } else if (hasRules) {
      attackSection.style.display = 'block';
      card.rules.forEach(rule => {
        attackList.innerHTML += `
          <div class="attack-item">
            <div class="attack-header">
              <span class="attack-name">Trainer Rule</span>
            </div>
            <p class="attack-text">${rule}</p>
          </div>
        `;
      });
    } else {
      attackSection.style.display = 'none';
    }

    // Recommendation Breakdown
    const recProfile = this.recommender.scoreCard(card, true);
    
    document.getElementById('rec-bar-artist').style.width = `${recProfile.details.artist}%`;
    document.getElementById('rec-val-artist').innerText = `${recProfile.details.artist}%`;
    
    document.getElementById('rec-bar-type').style.width = `${recProfile.details.type}%`;
    document.getElementById('rec-val-type').innerText = `${recProfile.details.type}%`;
    
    document.getElementById('rec-bar-rarity').style.width = `${recProfile.details.rarity}%`;
    document.getElementById('rec-val-rarity').innerText = `${recProfile.details.rarity}%`;
    
    document.getElementById('rec-bar-set').style.width = `${recProfile.details.set}%`;
    document.getElementById('rec-val-set').innerText = `${recProfile.details.set}%`;

    this.bindModalCard3DEvents(card3D);
  }

  closeInspectorModal() {
    document.getElementById('card-modal').classList.remove('active');
  }

  bindModalCard3DEvents(card3D) {
    const handleMove = (e) => {
      const rect = card3D.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      
      const rotateY = ((x / rect.width) - 0.5) * 20;
      const rotateX = -(((y / rect.height) - 0.5) * 20);
      
      card3D.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale3d(1.05, 1.05, 1.05)`;
      
      const holo = card3D.querySelector('.holo-sheen');
      if (holo) {
        holo.style.backgroundPosition = `${(x / rect.width) * 100}% ${(y / rect.height) * 100}%`;
      }
    };

    const handleLeave = () => {
      card3D.style.transform = 'perspective(1000px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)';
      const holo = card3D.querySelector('.holo-sheen');
      if (holo) holo.style.backgroundPosition = '50% 50%';
    };

    card3D.removeEventListener('mousemove', card3D._prevMoveHandler);
    card3D.removeEventListener('mouseleave', card3D._prevLeaveHandler);

    card3D._prevMoveHandler = handleMove;
    card3D._prevLeaveHandler = handleLeave;

    card3D.addEventListener('mousemove', handleMove);
    card3D.addEventListener('mouseleave', handleLeave);
  }

  /* ----------------------------------------------------
     BOOSTER PACK SYSTEM METHODS
  ---------------------------------------------------- */
  initPacksView() {
    // Clear canvas
    if (this.slashCtx && this.slashCanvas) {
      this.slashCtx.clearRect(0, 0, this.slashCanvas.width, this.slashCanvas.height);
    }
    
    this.slicedState = false;
    this.packSwipeIndex = 0;
    this.currentActivePackCard = null;

    // Compile a new pack if empty
    if (this.currentPackCards.length === 0) {
      const packResult = this.recommender.compileBoosterPack(this.cards);
      this.currentPackCards = packResult.cards;
      this.currentPackMetadata = {
        type: packResult.type,
        subtypeName: packResult.subtypeName
      };
      this.preloadPackImages();
    }

    const packEl = document.getElementById('booster-pack');
    if (packEl) {
      packEl.classList.remove('sliced');
      
      // Determine theme class
      let themeClass = 'pack-theme-silver';
      if (this.currentPackMetadata) {
        const pType = this.currentPackMetadata.type;
        const pSub = this.currentPackMetadata.subtypeName;
        if (pType === 'gold') {
          themeClass = 'pack-theme-gold';
        } else if (pType === 'rarity') {
          themeClass = 'pack-theme-rarity';
        } else if (pType === 'set') {
          themeClass = 'pack-theme-set';
        } else if (pType === 'artist') {
          themeClass = 'pack-theme-artist';
        } else if (pType === 'type') {
          themeClass = `pack-theme-type-${pSub.toLowerCase()}`;
        }
      }
      
      // Remove any existing theme classes and apply correct theme
      packEl.className = 'booster-pack';
      packEl.classList.add(themeClass);
      packEl.style.transform = 'perspective(1000px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)';
      
      // Setup dynamic text and emoji symbols
      let topText = 'BOOSTER';
      let bottomText = 'PACK';
      let symbolIcon = '⭐';

      if (this.currentPackMetadata) {
        const pType = this.currentPackMetadata.type;
        const pSub = this.currentPackMetadata.subtypeName || '';
        
        if (pType === 'gold') {
          topText = 'GOLD';
          bottomText = 'COMPILATION';
          symbolIcon = '👑';
        } else if (pType === 'type') {
          topText = `${pSub.toUpperCase()} TYPE`;
          bottomText = 'BOOSTER';
          
          const typeEmojis = {
            'Grass': '🌿',
            'Fire': '🔥',
            'Water': '💧',
            'Lightning': '⚡',
            'Psychic': '🔮',
            'Fighting': '👊',
            'Colorless': '⚪',
            'Metal': '🛡️',
            'Darkness': '🌙',
            'Dragon': '🐉',
            'Fairy': '✨'
          };
          symbolIcon = typeEmojis[pSub] || '⭐';
        } else if (pType === 'set') {
          topText = 'SPECIAL SET';
          bottomText = pSub.toUpperCase();
          symbolIcon = '📦';
        } else if (pType === 'rarity') {
          topText = pSub.toUpperCase();
          bottomText = 'RARITY PACK';
          symbolIcon = '★ ★ ★';
        } else if (pType === 'artist') {
          topText = 'ART BY';
          bottomText = pSub.toUpperCase();
          symbolIcon = '🎨';
        }
      }

      const topTextEl = packEl.querySelector('.booster-pack-top .pack-logo-text');
      const bottomTextEl = packEl.querySelector('.booster-pack-bottom .pack-logo-text');
      const symbolEl = document.getElementById('pack-logo-symbol');

      const scalePackText = (el, text) => {
        if (!el) return;
        const len = text.length;
        if (len > 20) {
          el.style.fontSize = '0.75rem';
          el.style.letterSpacing = '1px';
        } else if (len > 15) {
          el.style.fontSize = '0.9rem';
          el.style.letterSpacing = '1.5px';
        } else if (len > 12) {
          el.style.fontSize = '1.1rem';
          el.style.letterSpacing = '2px';
        } else if (len > 8) {
          el.style.fontSize = '1.25rem';
          el.style.letterSpacing = '3px';
        } else {
          el.style.fontSize = '';
          el.style.letterSpacing = '';
        }
      };

      if (topTextEl) {
        topTextEl.innerText = topText;
        scalePackText(topTextEl, topText);
      }
      if (bottomTextEl) {
        bottomTextEl.innerText = bottomText;
        scalePackText(bottomTextEl, bottomText);
      }
      if (symbolEl) symbolEl.innerText = symbolIcon;
    }

    document.getElementById('pack-opening-chamber').style.display = 'block';
    document.getElementById('pack-reveal-chamber').style.display = 'none';
    
    const emptyPlaceholder = document.getElementById('pack-deck-empty');
    if (emptyPlaceholder) emptyPlaceholder.style.display = 'none';
    
    // Clear previous swiped cards from container
    const container = document.getElementById('pack-card-deck');
    if (container) {
      container.querySelectorAll('.swipe-card').forEach(el => el.remove());
    }
  }

  setupPackSlicing() {
    this.slashCanvas = document.getElementById('slash-canvas');
    if (!this.slashCanvas) return;
    this.slashCtx = this.slashCanvas.getContext('2d');
    const container = document.getElementById('pack-opening-chamber');
    if (!container) return;

    // Resize canvas to match the container client size
    const resizeCanvas = () => {
      const rect = container.getBoundingClientRect();
      this.slashCanvas.width = rect.width;
      this.slashCanvas.height = rect.height;
    };
    
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // Pointer events for swipe tracking and 3D floating effect
    container.addEventListener('pointerdown', (e) => {
      if (this.slicedState) return;
      
      container.releasePointerCapture(e.pointerId);
      
      this.isDrawingSlash = true;
      this.slashPoints = [];
      
      const rect = this.slashCanvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      this.slashPoints.push({ x, y, time: Date.now() });

      const packEl = document.getElementById('booster-pack');
      if (packEl) packEl.style.transition = 'none';
    });

    container.addEventListener('pointermove', (e) => {
      // 1. Dynamic 3D tilt & shiny overlay position
      if (!this.slicedState) {
        const rect = container.getBoundingClientRect();
        const px = e.clientX - rect.left;
        const py = e.clientY - rect.top;
        
        const rotateY = ((px / rect.width) - 0.5) * 20;
        const rotateX = -(((py / rect.height) - 0.5) * 20);
        
        const packEl = document.getElementById('booster-pack');
        if (packEl) {
          packEl.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale3d(1.03, 1.03, 1.03)`;
        }
        
        const shinyTop = document.getElementById('pack-half-top').querySelector('.pack-overlay-shiny');
        const shinyBottom = document.getElementById('pack-half-bottom').querySelector('.pack-overlay-shiny');
        const posX = (px / rect.width) * 100;
        const posY = (py / rect.height) * 100;
        if (shinyTop) shinyTop.style.backgroundPosition = `${posX}% ${posY}%`;
        if (shinyBottom) shinyBottom.style.backgroundPosition = `${posX}% ${posY}%`;
      }

      // 2. Slash drawing
      if (!this.isDrawingSlash || this.slicedState) return;

      const canvasRect = this.slashCanvas.getBoundingClientRect();
      const cx = e.clientX - canvasRect.left;
      const cy = e.clientY - canvasRect.top;
      this.slashPoints.push({ x: cx, y: cy, time: Date.now() });

      if (this.slashPoints.length > 15) {
        this.slashPoints.shift();
      }

      this.drawSlash();
      this.checkSlashSwipe();
    });

    const stopDrawing = () => {
      this.isDrawingSlash = false;
      if (this.slashCtx) {
        this.slashCtx.clearRect(0, 0, this.slashCanvas.width, this.slashCanvas.height);
      }
      this.slashPoints = [];

      // Reset pack tilt
      if (!this.slicedState) {
        const packEl = document.getElementById('booster-pack');
        if (packEl) {
          packEl.style.transform = 'perspective(1000px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)';
          packEl.style.transition = 'transform 0.4s ease';
        }
        const shinyTop = document.getElementById('pack-half-top').querySelector('.pack-overlay-shiny');
        const shinyBottom = document.getElementById('pack-half-bottom').querySelector('.pack-overlay-shiny');
        if (shinyTop) shinyTop.style.backgroundPosition = '50% 50%';
        if (shinyBottom) shinyBottom.style.backgroundPosition = '50% 50%';
      }
    };

    container.addEventListener('pointerup', stopDrawing);
    container.addEventListener('pointercancel', stopDrawing);
    container.addEventListener('pointerleave', stopDrawing);
  }

  drawSlash() {
    if (!this.slashCtx || this.slashPoints.length < 2) return;

    this.slashCtx.clearRect(0, 0, this.slashCanvas.width, this.slashCanvas.height);

    this.slashCtx.beginPath();
    this.slashCtx.moveTo(this.slashPoints[0].x, this.slashPoints[0].y);
    for (let i = 1; i < this.slashPoints.length; i++) {
      this.slashCtx.lineTo(this.slashPoints[i].x, this.slashPoints[i].y);
    }
    
    this.slashCtx.strokeStyle = '#ff3366';
    this.slashCtx.lineWidth = 5;
    this.slashCtx.lineCap = 'round';
    this.slashCtx.lineJoin = 'round';
    this.slashCtx.shadowColor = '#ff3366';
    this.slashCtx.shadowBlur = 15;
    this.slashCtx.stroke();
    this.slashCtx.shadowBlur = 0;
  }

  checkSlashSwipe() {
    if (this.slashPoints.length < 5) return;
    
    const first = this.slashPoints[0];
    const last = this.slashPoints[this.slashPoints.length - 1];
    
    const dx = last.x - first.x;
    const dy = last.y - first.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const dt = last.time - first.time;
    
    if (distance > 110 && dt < 250) {
      this.isDrawingSlash = false;
      this.ripOpenBoosterPack();
    }
  }

  ripOpenBoosterPack() {
    if (this.slicedState) return;

    if (this.currentPackCards.length < 10) {
      const packResult = this.recommender.compileBoosterPack(this.cards);
      this.currentPackCards = packResult.cards;
      this.currentPackMetadata = {
        type: packResult.type,
        subtypeName: packResult.subtypeName
      };
      this.preloadPackImages();
    }

    if (this.currentPackCards.length < 10) {
      alert("Still loading cards... Please wait a few seconds and try again!");
      return;
    }

    this.slicedState = true;

    const packEl = document.getElementById('booster-pack');
    if (packEl) packEl.classList.add('sliced');

    this.triggerPackSliceParticles();

    setTimeout(() => {
      document.getElementById('pack-opening-chamber').style.display = 'none';
      
      const revealChamber = document.getElementById('pack-reveal-chamber');
      revealChamber.style.display = 'flex';
      
      this.loadNextPackCard();
    }, 800);
  }

  triggerPackSliceParticles() {
    if (!this.slashCanvas || !this.slashCtx) return;
    
    const width = this.slashCanvas.width;
    const height = this.slashCanvas.height;
    
    this.particles = [];
    const count = 45;
    
    for (let i = 0; i < count; i++) {
      this.particles.push({
        x: width / 2 + (Math.random() - 0.5) * 80,
        y: height / 2 + (Math.random() - 0.5) * 140,
        vx: (Math.random() - 0.5) * 10,
        vy: (Math.random() - 0.5) * 10,
        size: Math.random() * 4 + 2.5,
        color: Math.random() < 0.5 ? '#ff3366' : '#ffd600',
        alpha: 1,
        decay: Math.random() * 0.02 + 0.015
      });
    }

    const animate = () => {
      if (!this.slicedState || this.particles.length === 0) {
        this.particleAnimationId = null;
        return;
      }

      this.slashCtx.clearRect(0, 0, width, height);
      
      for (let i = this.particles.length - 1; i >= 0; i--) {
        const p = this.particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.08; // gravity
        p.alpha -= p.decay;
        
        if (p.alpha <= 0) {
          this.particles.splice(i, 1);
          continue;
        }

        this.slashCtx.save();
        this.slashCtx.globalAlpha = p.alpha;
        this.slashCtx.beginPath();
        this.slashCtx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        this.slashCtx.fillStyle = p.color;
        this.slashCtx.shadowColor = p.color;
        this.slashCtx.shadowBlur = 6;
        this.slashCtx.fill();
        this.slashCtx.restore();
      }

      if (this.particles.length > 0) {
        this.particleAnimationId = requestAnimationFrame(animate);
      } else {
        this.particleAnimationId = null;
      }
    };

    if (this.particleAnimationId) {
      cancelAnimationFrame(this.particleAnimationId);
    }
    this.particleAnimationId = requestAnimationFrame(animate);
  }

  loadNextPackCard() {
    const progressEl = document.getElementById('pack-swipe-progress');
    if (progressEl) {
      progressEl.innerText = `${this.packSwipeIndex + 1}/10`;
    }

    const drawer = document.getElementById('pack-card-summary-drawer');
    const actionActions = document.getElementById('pack-swipe-actions');

    if (this.packSwipeIndex < 10) {
      if (actionActions) {
        actionActions.style.pointerEvents = 'auto';
        actionActions.style.opacity = '1';
      }
      
      const card = this.currentPackCards[this.packSwipeIndex];
      this.currentActivePackCard = card;
      const upcomingCard = this.packSwipeIndex + 1 < 10 ? this.currentPackCards[this.packSwipeIndex + 1] : `booster-pack:${this.currentPackMetadata ? this.currentPackMetadata.type : 'silver'}:${this.currentPackMetadata ? this.currentPackMetadata.subtypeName : 'Normal'}`;
      this.packDeck.pushCard(card, upcomingCard);

      if (drawer) {
        drawer.style.display = 'block';
        document.getElementById('pack-summary-card-name').innerText = card.name;
        
        const typeBadge = document.getElementById('pack-summary-card-type');
        const primaryType = card.types && card.types[0] ? card.types[0] : 'None';
        typeBadge.innerText = primaryType;
        typeBadge.style.backgroundColor = `var(--type-${primaryType.toLowerCase()}, var(--type-colorless))`;
        
        document.getElementById('pack-summary-card-set').innerText = card.set?.name || 'Unknown Set';
        document.getElementById('pack-summary-card-rarity').innerText = card.rarity || 'Common';
        document.getElementById('pack-summary-card-artist').innerText = card.artist ? `Art by ${card.artist}` : 'Unknown Artist';
      }
    } else {
      if (actionActions) {
        actionActions.style.pointerEvents = 'none';
        actionActions.style.opacity = '0.3';
      }
      if (drawer) drawer.style.display = 'none';

      this.currentActivePackCard = null;
      this.packDeck.pushCard(null);
      
      const emptyPlaceholder = document.getElementById('pack-deck-empty');
      if (emptyPlaceholder) emptyPlaceholder.style.display = 'flex';
    }
  }

  async handlePackCardSwipe(action) {
    if (this.currentActivePackCard) {
      this.recommender.recordSwipe(this.currentActivePackCard, action);
      this.updateBinderCountBadge();
    }
    this.packSwipeIndex++;
    if (this.packSwipeIndex >= 10) {
      this.currentPackCards = [];
      this.initPacksView();
    } else {
      this.loadNextPackCard();
    }
  }

  /* ----------------------------------------------------
     DOM ROUTING & SYSTEM EVENTS
  ---------------------------------------------------- */
  bindDOMEvents() {
    // 1. Navigation Tab Switching
    document.querySelectorAll('.nav-tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        const target = e.currentTarget.dataset.target;
        
        document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
        e.currentTarget.classList.add('active');

        document.querySelectorAll('.app-view').forEach(v => v.classList.remove('active'));
        document.getElementById(`view-${target}`).classList.add('active');

        if (target === 'binder') {
          this.populateFilterDropdowns();
          this.renderBinderGrid();
        } else if (target === 'stats') {
          this.renderStatsView();
        } else if (target === 'packs') {
          if (this.currentPackCards.length === 0) {
            this.initPacksView();
          } else {
            if (this.slicedState) {
              document.getElementById('pack-opening-chamber').style.display = 'none';
              document.getElementById('pack-reveal-chamber').style.display = 'flex';
              const drawer = document.getElementById('pack-card-summary-drawer');
              if (drawer && this.currentActivePackCard) {
                drawer.style.display = 'block';
              }
            } else {
              document.getElementById('pack-opening-chamber').style.display = 'block';
              document.getElementById('pack-reveal-chamber').style.display = 'none';
            }
          }
        }
      });
    });

    // 1.5 Booster Packs Buttons
    const btnTear = document.getElementById('btn-tear-pack');
    if (btnTear) {
      btnTear.addEventListener('click', () => {
        this.ripOpenBoosterPack();
      });
    }

    const btnNextPack = document.getElementById('btn-next-pack');
    if (btnNextPack) {
      btnNextPack.addEventListener('click', () => {
        this.currentPackCards = [];
        this.initPacksView();
      });
    }

    const pBtnDislike = document.getElementById('pack-btn-dislike');
    if (pBtnDislike) {
      pBtnDislike.addEventListener('click', () => {
        this.packDeck.swipe('dislike');
      });
    }

    const pBtnLike = document.getElementById('pack-btn-like');
    if (pBtnLike) {
      pBtnLike.addEventListener('click', () => {
        this.packDeck.swipe('like');
      });
    }

    const pBtnSuper = document.getElementById('pack-btn-super');
    if (pBtnSuper) {
      pBtnSuper.addEventListener('click', () => {
        this.packDeck.swipe('superlike');
      });
    }

    const pBtnInfo = document.getElementById('pack-btn-info');
    if (pBtnInfo) {
      pBtnInfo.addEventListener('click', () => {
        if (this.currentActivePackCard) {
          this.openInspectorModal(this.currentActivePackCard);
        }
      });
    }

    const emptyGoSwipeBtn = document.getElementById('empty-go-swipe-btn');
    if (emptyGoSwipeBtn) {
      emptyGoSwipeBtn.addEventListener('click', () => {
        const tabPacksBtn = document.getElementById('tab-packs-btn');
        if (tabPacksBtn) tabPacksBtn.click();
      });
    }

    // 3. Modals Closures
    document.getElementById('modal-close-btn').addEventListener('click', () => this.closeInspectorModal());
    document.getElementById('card-modal').addEventListener('click', (e) => {
      if (e.target === document.getElementById('card-modal')) this.closeInspectorModal();
    });

    // 4. Binder filters
    const filterIds = [
      'binder-search', 'filter-collection', 'filter-supertype', 
      'filter-type', 'filter-subtype', 'filter-set', 
      'filter-rarity', 'filter-year', 'filter-artist', 'sort-by'
    ];
    filterIds.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        const eventName = id === 'binder-search' ? 'input' : 'change';
        el.addEventListener(eventName, () => this.renderBinderGrid());
      }
    });

    // 5. Expandable Lists Events
    const categories = ['type', 'name', 'artist', 'set', 'rarity'];
    categories.forEach(cat => {
      const btn = document.getElementById(`btn-show-more-${cat}s`);
      if (btn) {
        btn.addEventListener('click', () => {
          this.expandedCategories[cat] = !this.expandedCategories[cat];
          this.renderStatsView();
        });
      }
    });

    // 6. Settings overlay bindings
    const settingsOverlay = document.getElementById('settings-modal-overlay');
    
    document.getElementById('settings-btn').addEventListener('click', () => {
      settingsOverlay.classList.add('active');
    });

    document.getElementById('settings-close-btn').addEventListener('click', () => {
      settingsOverlay.classList.remove('active');
    });

    settingsOverlay.addEventListener('click', (e) => {
      if (e.target === settingsOverlay) settingsOverlay.classList.remove('active');
    });

    document.getElementById('settings-clear-model-btn').addEventListener('click', () => {
      if (confirm('Clear your card preferences? Swipe history will be deleted.')) {
        this.recommender.clearStats();
        this.updateBinderCountBadge();
        this.currentPackCards = [];
        this.initPacksView();
        alert('Preferences reset completed!');
      }
    });

    document.getElementById('settings-clear-db-btn').addEventListener('click', async () => {
      if (confirm('Reset your card catalog? PokéMatch will need to re-download cards.')) {
        settingsOverlay.classList.remove('active');
        document.getElementById('app-container').style.display = 'none';
        
        const splash = document.getElementById('splash-screen');
        splash.classList.remove('fade-out');
        this.showSplashProgress(0, 'Clearing local card files...');

        await this.db.clearCache();
        this.recommender.clearStats();
        
        window.location.reload();
      }
    });

    // Deck empty trigger
    const forceLoadBtn = document.getElementById('force-load-more-btn');
    if (forceLoadBtn) {
      forceLoadBtn.addEventListener('click', async () => {
        forceLoadBtn.disabled = true;
        forceLoadBtn.innerText = 'Downloading...';
        
        const page = this.db.getRandomUnfetchedPage();
        if (page !== -1) {
          try {
            const data = await this.db.fetchCardsPage(page);
            if (data.cards.length > 0) {
              await this.db.saveCards(data.cards);
              await this.reloadLocalMemory();
            } else {
              alert('No more cards found in API or rate limit hit. Try again later.');
            }
          } catch (e) {
            console.error(e);
            alert('Network error when fetching more cards.');
          } finally {
            forceLoadBtn.disabled = false;
            forceLoadBtn.innerHTML = '<i data-lucide="download"></i> Fetch Next Set';
            lucide.createIcons();
          }
        } else {
          alert('All API sets have been downloaded!');
          forceLoadBtn.disabled = false;
          forceLoadBtn.innerHTML = '<i data-lucide="download"></i> Fetch Next Set';
        }
      });
    }
  }
}

// Bootstrap Initialization
window.addEventListener('DOMContentLoaded', () => {
  const db = new PokemonDatabase();
  const recommender = new Recommender();
  new UIController(db, recommender);
});
