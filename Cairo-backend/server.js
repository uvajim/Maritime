require('dotenv').config();

const express                = require('express');
const helmet                 = require('helmet');
const crypto                 = require('crypto');
const Alpaca                 = require('@alpacahq/alpaca-trade-api');
const { HDNodeWallet, JsonRpcProvider, Wallet, Contract, parseUnits,
        isAddress, keccak256, toUtf8Bytes, ZeroHash, id: ethersId,
        verifyMessage } = require('ethers');
const fs   = require('fs').promises;
const path = require('path');
const { Firestore } = require('@google-cloud/firestore');
const { verifyTypedData } = require('viem');

const MARITIME_DEPOSIT_CONTRACT =
  process.env.MARITIME_DEPOSIT_CONTRACT ?? '0xb6bea061A920E5471b1E1D3c1e1c9E62a0fE7D51';

// ─── Trade signing ────────────────────────────────────────────────────────────
const rpcProvider    = new JsonRpcProvider(process.env.RPC_URL);
const signerWallet   = new Wallet(process.env.DEPLOYER_PRIVATE_KEY, rpcProvider);

const TRADE_EXECUTOR_ADDRESS = process.env.TRADE_EXECUTOR_ADDRESS;
const CHAIN_ID               = Number(process.env.CHAIN_ID ?? 11155111);

const TRADE_DOMAIN = {
  name:              'Dhow',
  version:           '1',
  chainId:           CHAIN_ID,
  verifyingContract: TRADE_EXECUTOR_ADDRESS,
};

const BUY_TYPES = {
  BuyParams: [
    { name: 'user',     type: 'address' },
    { name: 'ticker',   type: 'string'  },
    { name: 'shares',   type: 'uint256' },
    { name: 'dUSDCost', type: 'uint256' },
    { name: 'nonce',    type: 'uint256' },
    { name: 'expiry',   type: 'uint256' },
  ],
};

const SELL_TYPES = {
  SellParams: [
    { name: 'user',       type: 'address' },
    { name: 'ticker',     type: 'string'  },
    { name: 'shares',     type: 'uint256' },
    { name: 'dUSDPayout', type: 'uint256' },
    { name: 'nonce',      type: 'uint256' },
    { name: 'expiry',     type: 'uint256' },
  ],
};

const tradeExecutorContract = TRADE_EXECUTOR_ADDRESS
  ? new Contract(TRADE_EXECUTOR_ADDRESS, ['function nonces(address) view returns (uint256)'], rpcProvider)
  : null;

const equityVault = new Contract(
  process.env.EQUITY_VAULT_ADDRESS,
  [
    'function tokenForTicker(string calldata ticker) view returns (address)',
    'function allTickers(uint256 index) view returns (string)',
    'function tickerCount() view returns (uint256)',
    'function balanceOfTicker(address account, string calldata ticker) view returns (uint256)',
    'function balanceOfBatch(address[] accounts, uint256[] ids) view returns (uint256[])',
    'function isRegistered(string ticker) view returns (bool)',
    'function tokenIdForTicker(string ticker) view returns (uint256)',
  ],
  rpcProvider,
);

const OVERSEER_ADDRESS  = process.env.OVERSEER_ADDRESS;
const backendWallet     = process.env.BACKEND_SIGNER_PRIVATE_KEY
  ? new Wallet(process.env.BACKEND_SIGNER_PRIVATE_KEY, rpcProvider)
  : null;
const overseerContract  = OVERSEER_ADDRESS
  ? new Contract(OVERSEER_ADDRESS, ['function nonces(address) view returns (uint256)'], rpcProvider)
  : null;

// ─── EIP-712 for Overseer offer signing ──────────────────────────────────────
const OVERSEER_DOMAIN = {
  name:              'Overseer',
  version:           '1',
  chainId:           CHAIN_ID,
  verifyingContract: OVERSEER_ADDRESS,
};
const OFFER_TYPES = {
  Offer: [
    { name: 'user',      type: 'address' },
    { name: 'ticker',    type: 'string'  },
    { name: 'shares',    type: 'uint256' },
    { name: 'mdtCost',   type: 'uint256' },
    { name: 'price',     type: 'uint256' },
    { name: 'timestamp', type: 'uint256' },
    { name: 'nonce',     type: 'uint256' },
    { name: 'expiry',    type: 'uint256' },
  ],
};
const REDEEM_TYPES = {
  RedeemOffer: [
    { name: 'user',      type: 'address' },
    { name: 'ticker',    type: 'string'  },
    { name: 'shares',    type: 'uint256' },
    { name: 'mdtPayout', type: 'uint256' },
    { name: 'price',     type: 'uint256' },
    { name: 'timestamp', type: 'uint256' },
    { name: 'nonce',     type: 'uint256' },
    { name: 'expiry',    type: 'uint256' },
  ],
};

// ─── Offer price store (bigint, 6-decimal) ────────────────────────────────────
// Separate from the float priceStore used for Alpaca/display prices.
// Set via POST /api/admin/offer-price before offers can be signed.
const offerPriceStore = new Map();
function setOfferPrice(ticker, price) {
  offerPriceStore.set(ticker.toUpperCase(), BigInt(price));
}
function getOfferPrice(ticker) {
  const p = offerPriceStore.get(ticker.toUpperCase());
  if (!p) throw new Error(`No offer price set for ticker: ${ticker}`);
  return p;
}

// ─── EIP-712 schema for deposit intents ──────────────────────────────────────
const EIP712_DOMAIN = {
  name:              'Cairo',
  version:           '1',
  verifyingContract: MARITIME_DEPOSIT_CONTRACT,
};

const EIP712_TYPES = {
  DepositIntent: [
    { name: 'walletAddress', type: 'address'  },
    { name: 'amount',        type: 'string'   },
    { name: 'timestamp',     type: 'uint256'  },
  ],
};

const INTENT_TTL_S = 15 * 60; // 15 minutes

// Support Railway/cloud deployments where credentials are passed as a JSON env var
// instead of a file path
let db;
if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
  const credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
  db = new Firestore({ projectId: credentials.project_id, credentials });
} else {
  db = new Firestore();
}


const app = express();
app.use(helmet());
// Capture raw body for webhook signature verification (WeChat)
app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));

// CORS — allow all origins and handle preflight
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

const alpaca = new Alpaca({
  keyId:     process.env.APCA_API_KEY_ID,
  secretKey: process.env.APCA_API_SECRET_KEY,
  paper:     process.env.ALPACA_PAPER !== 'false',
});

// ─── In-memory asset cache (1-hour TTL for search) ───────────────────────────
let assetsCache   = null;
let assetsCachedAt = 0;

async function getActiveAssets() {
  if (assetsCache && Date.now() - assetsCachedAt < 3_600_000) return assetsCache;
  assetsCache    = await alpaca.getAssets({ status: 'active', asset_class: 'us_equity' });
  assetsCachedAt = Date.now();
  return assetsCache;
}

// ─── Price store ─────────────────────────────────────────────────────────────
// ticker → { price: number, updatedAt: ms, source: 'alpaca' | 'admin' }
const priceStore = new Map();

function setPrice(ticker, priceUsd, source = 'alpaca') {
  priceStore.set(ticker.toUpperCase(), { price: priceUsd, updatedAt: Date.now(), source });
}

function getPrice(ticker) {
  return priceStore.get(ticker.toUpperCase()) ?? null;
}

async function refreshPrice(ticker) {
  const snap  = await alpaca.getSnapshot(ticker.toUpperCase());
  const price = snap.LatestTrade?.Price ?? snap.MinuteBar?.ClosePrice ?? 0;
  if (price > 0) setPrice(ticker, price, 'alpaca');
  return price;
}

// ─── Background price cron (every 15 s for watched tickers) ─────────────────
const WATCHED_TICKERS = (process.env.WATCHED_TICKERS ?? '').split(',').filter(Boolean);
const PRICE_TTL_MS    = Number(process.env.PRICE_TTL_MS ?? 30_000);

if (WATCHED_TICKERS.length > 0) {
  setInterval(() => {
    for (const ticker of WATCHED_TICKERS) refreshPrice(ticker).catch(() => {});
  }, 15_000);
}

// ─── Parse structured error from Alpaca SDK ──────────────────────────────────
function parseAlpacaError(err) {
  const m = String(err.message ?? '').match(/code:\s*(\d+),\s*message:\s*(.*)/);
  if (m) {
    const code = parseInt(m[1], 10);
    const msg  = m[2] && m[2] !== 'undefined' ? m[2]
               : code === 401               ? 'Invalid or missing Alpaca API credentials'
               : code === 403               ? 'Forbidden — check API key permissions'
               : 'Alpaca API error';
    return { code, message: msg };
  }
  return { code: 500, message: err.message ?? 'Unknown error' };
}

// ─── GET /api/market/snapshot/:symbol ────────────────────────────────────────
app.get('/api/market/snapshot/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const snap = await alpaca.getSnapshot(symbol.toUpperCase());

    const price    = snap.LatestTrade?.Price  ?? snap.MinuteBar?.ClosePrice  ?? 0;
    const prevClose = snap.PrevDailyBar?.ClosePrice ?? 0;
    const change   = price - prevClose;

    res.json({
      price,
      change,
      changePercent: prevClose > 0 ? (change / prevClose) * 100 : 0,
      open:      snap.DailyBar?.OpenPrice  ?? 0,
      high:      snap.DailyBar?.HighPrice  ?? 0,
      low:       snap.DailyBar?.LowPrice   ?? 0,
      volume:    snap.DailyBar?.Volume     ?? 0,
      vwap:      snap.DailyBar?.VWAP       ?? 0,
      prevClose,
      bidPrice:  snap.LatestQuote?.BidPrice ?? 0,
      askPrice:  snap.LatestQuote?.AskPrice ?? 0,
    });
  } catch (err) {
    const { code, message } = parseAlpacaError(err);
    console.error(`[snapshot] ${req.params.symbol}:`, code, message);
    res.status(code).json({ error: message });
  }
});

// ─── GET /api/market/bars/:symbol?timeframe=5Min&start=YYYY-MM-DD ────────────
app.get('/api/market/bars/:symbol', async (req, res) => {
  try {
    const { symbol }  = req.params;
    const timeframe   = req.query.timeframe || '1Day';
    const start       = req.query.start     || (() => {
      const d = new Date();
      d.setDate(d.getDate() - 30);
      return d.toISOString().split('T')[0];
    })();

    const gen  = alpaca.getBarsV2(symbol.toUpperCase(), { timeframe, start, feed: 'iex' });
    const bars = [];
    for await (const bar of gen) {
      bars.push({ time: bar.Timestamp, close: bar.ClosePrice });
    }
    res.json({ bars });
  } catch (err) {
    const { code, message } = parseAlpacaError(err);
    console.error(`[bars] ${req.params.symbol}:`, code, message);
    res.status(code).json({ error: message });
  }
});

// ─── GET /api/market/news/:symbol?limit=5 ────────────────────────────────────
app.get('/api/market/news/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const limit      = parseInt(req.query.limit, 10) || 5;
    const raw        = await alpaca.getNews({ symbols: [symbol.toUpperCase()], totalLimit: limit });
    const items      = Array.isArray(raw) ? raw : (raw.news ?? []);
    res.json({
      news: items.map(n => ({
        id:        n.id,
        headline:  n.headline,
        source:    n.source,
        url:       n.url,
        createdAt: n.created_at,
        imageUrl:  n.images?.[0]?.url ?? null,
      })),
    });
  } catch (err) {
    const { code, message } = parseAlpacaError(err);
    console.error(`[news] ${req.params.symbol}:`, code, message);
    res.status(code).json({ error: message });
  }
});

// ─── GET /api/market/asset/:symbol ───────────────────────────────────────────
app.get('/api/market/asset/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const a          = await alpaca.getAsset(symbol.toUpperCase());
    res.json({
      symbol:      a.symbol,
      name:        a.name,
      exchange:    a.exchange,
      assetClass:  a.class,
      tradable:    a.tradable,
      fractionable: a.fractionable,
    });
  } catch (err) {
    const { code, message } = parseAlpacaError(err);
    console.error(`[asset] ${req.params.symbol}:`, code, message);
    res.status(code).json({ error: message });
  }
});

// ─── GET /api/market/search?q=QUERY ──────────────────────────────────────────
app.get('/api/market/search', async (req, res) => {
  try {
    const q = (req.query.q || '').trim().toUpperCase();
    if (!q) return res.json({ results: [] });

    const assets  = await getActiveAssets();
    const results = assets
      .filter(a => a.symbol.startsWith(q) || a.name.toUpperCase().includes(q))
      .sort((a, b) => {
        const aExact = a.symbol === q ? -1 : a.symbol.startsWith(q) ? 0 : 1;
        const bExact = b.symbol === q ? -1 : b.symbol.startsWith(q) ? 0 : 1;
        return aExact - bExact;
      })
      .slice(0, 8)
      .map(a => ({ symbol: a.symbol, name: a.name, exchange: a.exchange }));

    res.json({ results });
  } catch (err) {
    console.error('[search]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/market/snapshots?symbols=AAPL,TSLA ─────────────────────────────
app.get('/api/market/snapshots', async (req, res) => {
  try {
    const symbols = (req.query.symbols || '')
      .split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
    if (!symbols.length) return res.json({});

    const snaps  = await alpaca.getSnapshots(symbols);
    const result = {};
    const list   = Array.isArray(snaps) ? snaps : Object.values(snaps);
    for (const snap of list) {
      const sym      = snap.symbol ?? snap.Symbol;
      const price    = snap.LatestTrade?.Price ?? snap.MinuteBar?.ClosePrice ?? 0;
      const prevClose = snap.PrevDailyBar?.ClosePrice ?? 0;
      result[sym] = {
        price,
        change:        price - prevClose,
        changePercent: prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0,
      };
    }
    res.json(result);
  } catch (err) {
    const { code, message } = parseAlpacaError(err);
    console.error('[snapshots]', code, message);
    res.status(code).json({ error: message });
  }
});

// ─── POST /api/portfolio/performance ─────────────────────────────────────────
// Body: { holdings: { AAPL: 5.5, TSLA: 2.0 } }  (ticker → fractional shares)
// Returns current portfolio value and period-over-period change metrics.
app.post('/api/portfolio/performance', async (req, res) => {
  try {
    const { holdings } = req.body;
    if (!holdings || typeof holdings !== 'object') {
      return res.status(400).json({ error: 'holdings object is required' });
    }

    const tickers = Object.keys(holdings).filter(t => Number(holdings[t]) > 0);
    if (tickers.length === 0) return res.json({ currentValue: 0, periods: {} });

    // ── Current prices ────────────────────────────────────────────────────────
    const snaps    = await alpaca.getSnapshots(tickers);
    const snapList = Array.isArray(snaps) ? snaps : Object.values(snaps);
    const snapMap  = {};
    for (const snap of snapList) {
      const sym = snap.symbol ?? snap.Symbol;
      snapMap[sym] = {
        price:     snap.LatestTrade?.Price    ?? snap.MinuteBar?.ClosePrice ?? 0,
        prevClose: snap.PrevDailyBar?.ClosePrice ?? 0,
      };
    }

    const currentValue = tickers.reduce(
      (sum, t) => sum + Number(holdings[t]) * (snapMap[t]?.price ?? 0), 0
    );

    // ── Helper: one historical close price for a ticker at a given ISO date ──
    async function getHistoricalPrice(ticker, isoDate) {
      try {
        const gen = alpaca.getBarsV2(ticker.toUpperCase(), {
          timeframe: '1Day', start: isoDate, limit: 1, feed: 'iex',
        });
        for await (const bar of gen) return bar.ClosePrice ?? 0;
        return 0;
      } catch { return 0; }
    }

    // ── Period start offsets (calendar days back from today) ─────────────────
    function isoDateDaysAgo(days) {
      const d = new Date();
      d.setDate(d.getDate() - days);
      return d.toISOString().split('T')[0];
    }

    const periodDays = { '1W': 7, '1M': 30, '3M': 90, '1Y': 365, 'ALL': 1825 };

    // ── Fetch all historical prices in parallel ───────────────────────────────
    const histFetches = {};
    for (const [period, days] of Object.entries(periodDays)) {
      const startDate = isoDateDaysAgo(days);
      histFetches[period] = tickers.map(t => getHistoricalPrice(t, startDate));
    }

    const histResults = {};
    for (const [period, promises] of Object.entries(histFetches)) {
      histResults[period] = await Promise.all(promises);
    }

    // ── Build period results ──────────────────────────────────────────────────
    const result = {};

    // 1D uses prevClose from snapshot (no extra API call)
    const startValue1D = tickers.reduce(
      (sum, t) => sum + Number(holdings[t]) * (snapMap[t]?.prevClose ?? 0), 0
    );
    const change1D = currentValue - startValue1D;
    result['1D'] = {
      startValue:    Math.round(startValue1D * 100) / 100,
      change:        Math.round(change1D * 100) / 100,
      changePercent: startValue1D > 0 ? Math.round((change1D / startValue1D) * 10000) / 100 : 0,
    };

    for (const [period, prices] of Object.entries(histResults)) {
      const startValue = tickers.reduce(
        (sum, t, i) => sum + Number(holdings[t]) * (prices[i] || snapMap[t]?.price || 0), 0
      );
      const change = currentValue - startValue;
      result[period] = {
        startValue:    Math.round(startValue * 100) / 100,
        change:        Math.round(change * 100) / 100,
        changePercent: startValue > 0 ? Math.round((change / startValue) * 10000) / 100 : 0,
      };
    }

    res.json({ currentValue: Math.round(currentValue * 100) / 100, periods: result });
  } catch (err) {
    const { code, message } = parseAlpacaError(err);
    console.error('[portfolio/performance]', code, message);
    res.status(code).json({ error: message });
  }
});

// ─── GET /api/market/crypto?ids=bitcoin,ethereum ─────────────────────────────
app.get('/api/market/crypto', async (req, res) => {
  try {
    const ids = req.query.ids || 'bitcoin';
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`;
    const data = await fetch(url).then(r => r.json());
    const result = {};
    for (const [id, info] of Object.entries(data)) {
      const price = info.usd ?? 0;
      result[id] = {
        price,
        change:        (price * (info.usd_24h_change ?? 0)) / 100,
        changePercent: info.usd_24h_change ?? 0,
      };
    }
    res.json(result);
  } catch (err) {
    console.error('[crypto]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/market/eth-history?days=1 ──────────────────────────────────────
// Returns { points: [{ time: string, value: number }] } for the Portfolio chart
app.get('/api/market/eth-history', async (req, res) => {
  try {
    const days     = parseInt(req.query.days, 10) || 1;
    const interval = days <= 1 ? 'hourly' : days <= 90 ? 'daily' : 'daily';
    const url      = `https://api.coingecko.com/api/v3/coins/ethereum/market_chart?vs_currency=usd&days=${days}&interval=${interval}`;
    const data     = await fetch(url).then(r => r.json());

    const points = (data.prices ?? []).map(([ts, price]) => {
      const d = new Date(ts);
      let label;
      if (days <= 1) {
        label = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      } else if (days <= 7) {
        label = d.toLocaleDateString([], { weekday: 'short' }) + ' ' +
                d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      } else {
        label = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
      }
      return { time: label, value: Math.round(price * 100) / 100 };
    });

    res.json({ points });
  } catch (err) {
    console.error('[eth-history]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/transaction ────────────────────────────────────────────────────
// Mirrors the Firebase doTransaction function for local dev.
// Requires WALLET_MNEMONIC in .env.
//
// Body: { requestedTicker, paymentStablecoin, unitsRequested, recipientAddress }
// Returns: { depositAddress, marketPriceLocked, billTotal, currency }

let walletIndex  = 0;                      // HD wallet derivation counter
const pendingOrders = new Map();           // in-memory ledger (use Firestore in prod)

app.options('/api/transaction', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.sendStatus(204);
});

app.post('/api/transaction', async (req, res) => {
  try {
    const { requestedTicker, paymentStablecoin, unitsRequested, recipientAddress } = req.body;

    if (!requestedTicker || !paymentStablecoin || !unitsRequested || !recipientAddress) {
      return res.status(400).json({ error: 'Missing required fields.' });
    }

    const mnemonic = process.env.WALLET_MNEMONIC;
    if (!mnemonic) {
      return res.status(500).json({ error: 'WALLET_MNEMONIC not configured in .env' });
    }

    // 1. Validate ticker via Alpaca asset lookup
    let asset;
    try {
      asset = await alpaca.getAsset(requestedTicker.toUpperCase());
    } catch {
      return res.status(404).json({ error: `Ticker "${requestedTicker}" not found.` });
    }
    if (!asset.tradable) {
      return res.status(400).json({ error: `${requestedTicker} is not currently tradable.` });
    }

    // 2. Fetch real-time market price
    const snap       = await alpaca.getSnapshot(requestedTicker.toUpperCase());
    const marketPrice = snap.LatestTrade?.Price ?? snap.MinuteBar?.ClosePrice ?? 0;
    if (marketPrice <= 0) {
      return res.status(503).json({ error: 'Could not fetch a live price. Market may be closed.' });
    }

    // 3. Calculate total bill
    const billTotal = Math.round(marketPrice * unitsRequested * 100) / 100;

    // 4. Derive next unique deposit address from HD wallet
    const nextIndex    = ++walletIndex;
    const masterNode   = HDNodeWallet.fromPhrase(mnemonic);
    const depositWallet = masterNode.derivePath(`m/44'/60'/0'/0/${nextIndex}`);
    const depositAddress = depositWallet.address;

    // 5. Store the order (swap Map for Firestore in production)
    pendingOrders.set(depositAddress.toLowerCase(), {
      requestedTicker:   requestedTicker.toUpperCase(),
      unitsToDispense:   unitsRequested,
      lockedPricePerUnit: marketPrice,
      paymentExpected:   billTotal,
      paymentStablecoin: paymentStablecoin.toUpperCase(),
      recipient:         recipientAddress,
      status:            'awaiting_payment',
      derivationIndex:   nextIndex,
      createdAt:         new Date().toISOString(),
    });

    // 6. Return the invoice
    res.json({ depositAddress, marketPriceLocked: marketPrice, billTotal, currency: paymentStablecoin.toUpperCase() });

  } catch (err) {
    const { code, message } = parseAlpacaError(err);
    console.error('[transaction]', code, message);
    res.status(code).json({ error: message });
  }
});

// ─── POST /api/assets ────────────────────────────────────────────────────────
app.post('/api/assets', async (req, res) => {
  try {
    const { walletAddress } = req.body;
    if (!walletAddress) return res.status(400).json({ error: 'walletAddress is required' });

    const upstream = await fetch('https://fetch-assets-266596137006.us-west3.run.app', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ walletAddress }),
    });
    const text = await upstream.text();
    let data; try { data = JSON.parse(text); } catch { data = { error: text }; }
    res.status(upstream.status).json(data);
  } catch (err) {
    console.error('[assets]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/trade ─────────────────────────────────────────────────────────
// Body: { walletAddress, ticker, amount, side: 'buy' | 'sell' }
// amount: 6-decimal USD integer string (e.g. $5.00 → "5000000")
// Returns a signed offer for the user to submit to TradeExecutor on-chain.
// The user's wallet submits the transaction and pays all gas.
app.post('/api/trade', async (req, res) => {
  try {
    const { walletAddress, ticker, amount, side } = req.body;
    if (!walletAddress || !ticker || !amount || !side) {
      return res.status(400).json({ error: 'walletAddress, ticker, amount, and side are required' });
    }
    if (side !== 'buy' && side !== 'sell') {
      return res.status(400).json({ error: 'side must be "buy" or "sell"' });
    }
    if (!tradeExecutorContract) {
      return res.status(503).json({ error: 'TRADE_EXECUTOR_ADDRESS not configured.' });
    }

    const amountRaw = BigInt(amount);
    if (amountRaw <= 0n) return res.status(400).json({ error: 'amount must be positive' });

    let entry = getPrice(ticker);
    if (!entry || Date.now() - entry.updatedAt > PRICE_TTL_MS) {
      const live = await refreshPrice(ticker);
      if (live <= 0) return res.status(503).json({ error: 'No live price available.' });
      entry = getPrice(ticker);
    }

    // Buy at 3% above market (user gets fewer shares), sell at 3% below (user gets less dUSD)
    const priceRaw  = side === 'buy'
      ? BigInt(Math.round(entry.price * 1_030_000))
      : BigInt(Math.round(entry.price * 970_000));
    const sharesRaw = (amountRaw * 1_000_000n) / priceRaw;
    const nonce     = await tradeExecutorContract.nonces(walletAddress);
    const expiry    = BigInt(Math.floor(Date.now() / 1000)) + 120n;
    const tickerUpper = ticker.toUpperCase();

    let params, signature;
    if (side === 'buy') {
      params    = { user: walletAddress, ticker: tickerUpper, shares: sharesRaw, dUSDCost: amountRaw, nonce, expiry };
      signature = await signerWallet.signTypedData(TRADE_DOMAIN, BUY_TYPES, params);
    } else {
      params    = { user: walletAddress, ticker: tickerUpper, shares: sharesRaw, dUSDPayout: amountRaw, nonce, expiry };
      signature = await signerWallet.signTypedData(TRADE_DOMAIN, SELL_TYPES, params);
    }

    // Stringify bigints for JSON transport
    const paramsJson = Object.fromEntries(
      Object.entries(params).map(([k, v]) => [k, v.toString()])
    );

    res.json({ params: paramsJson, signature, price: priceRaw.toString() });
  } catch (err) {
    console.error('[trade]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/trade/sell-all ────────────────────────────────────────────────
// Body: { walletAddress, ticker, shares }
// shares: exact 6-decimal share count from chain (e.g. 1.5 shares → "1500000")
// Applies same 3% sell spread as /api/trade — user receives 97% of market value.
app.post('/api/trade/sell-all', async (req, res) => {
  try {
    const { walletAddress, ticker, shares } = req.body;
    if (!walletAddress || !ticker || !shares) {
      return res.status(400).json({ error: 'walletAddress, ticker, and shares are required' });
    }
    if (!tradeExecutorContract) {
      return res.status(503).json({ error: 'TRADE_EXECUTOR_ADDRESS not configured.' });
    }

    const sharesRaw = BigInt(shares);
    if (sharesRaw <= 0n) return res.status(400).json({ error: 'shares must be positive' });

    let entry = getPrice(ticker);
    if (!entry || Date.now() - entry.updatedAt > PRICE_TTL_MS) {
      const live = await refreshPrice(ticker);
      if (live <= 0) return res.status(503).json({ error: 'No live price available.' });
      entry = getPrice(ticker);
    }

    // Apply 3% sell spread — price at 97% of market
    const priceRaw  = BigInt(Math.round(entry.price * 970_000));
    // dUSDPayout (6-dec) = shares_6dec * price_6dec / 1e6
    const dUSDPayout = (sharesRaw * priceRaw) / 1_000_000n;

    const nonce      = await tradeExecutorContract.nonces(walletAddress);
    const expiry     = BigInt(Math.floor(Date.now() / 1000)) + 120n;
    const tickerUpper = ticker.toUpperCase();

    const params    = { user: walletAddress, ticker: tickerUpper, shares: sharesRaw, dUSDPayout, nonce, expiry };
    const signature = await signerWallet.signTypedData(TRADE_DOMAIN, SELL_TYPES, params);

    const paramsJson = Object.fromEntries(
      Object.entries(params).map(([k, v]) => [k, v.toString()])
    );

    res.json({ params: paramsJson, signature, price: priceRaw.toString() });
  } catch (err) {
    console.error('[sell-all]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/trade/execute ─────────────────────────────────────────────────
// Executes a live Alpaca market order.
// Buy:  body { walletAddress, ticker, side: "buy", amount }  (USD notional)
// Sell: body { walletAddress, ticker, side: "sell", qty }     (share quantity)
app.post('/api/trade/execute', async (req, res) => {
  try {
    const { walletAddress, ticker, side, amount, qty } = req.body;
    if (!walletAddress || !ticker || !side) {
      return res.status(400).json({ error: 'walletAddress, ticker, and side are required' });
    }
    if (side !== 'buy' && side !== 'sell') {
      return res.status(400).json({ error: 'side must be "buy" or "sell"' });
    }

    const symbol = String(ticker).toUpperCase();
    const latestTrade = await alpaca.getLatestTrade(symbol);
    const marketPrice = Number(latestTrade?.Price ?? 0);
    if (!Number.isFinite(marketPrice) || marketPrice <= 0) {
      return res.status(503).json({ error: 'Could not fetch a live market price.' });
    }

    let orderRequest;
    let tradeValue;
    let shareQty;

    if (side === 'buy') {
      const notional = Number(amount);
      if (!Number.isFinite(notional) || notional <= 0) {
        return res.status(400).json({ error: 'amount must be a positive number for buy orders' });
      }

      // Buy by dollar amount to avoid share-qty rounding failures.
      orderRequest = {
        symbol,
        notional: Number(notional.toFixed(2)),
        side: 'buy',
        type: 'market',
        time_in_force: 'day',
      };
      tradeValue = Number(notional.toFixed(2));
      shareQty = tradeValue / marketPrice;
    } else {
      const numericQty = Number(qty);
      if (!Number.isFinite(numericQty) || numericQty <= 0) {
        return res.status(400).json({ error: 'qty must be a positive number for sell orders' });
      }

      orderRequest = {
        symbol,
        qty: numericQty,
        side: 'sell',
        type: 'market',
        time_in_force: 'day',
      };
      shareQty = numericQty;
      tradeValue = marketPrice * numericQty;
    }

    const order = await alpaca.createOrder(orderRequest);

    await db.collection('executed_orders').doc(order.id).set({
      walletAddress,
      ticker: order.symbol,
      side,
      qty: side === 'buy' ? Number(shareQty.toFixed(6)) : shareQty,
      tradeValue: Number(tradeValue.toFixed(2)),
      status: order.status,
      alpacaOrderId: order.id,
      createdAt: new Date().toISOString(),
    });

    res.json({
      message: `${side.toUpperCase()} executed successfully`,
      orderId: order.id,
      ticker: order.symbol,
      side,
      shares: side === 'buy' ? Number(shareQty.toFixed(6)) : shareQty,
      tradeValue: Number(tradeValue.toFixed(2)),
      marketPrice,
    });
  } catch (err) {
    const { code, message } = parseAlpacaError(err);
    console.error('[trade/execute]', code, message);
    res.status(code).json({ error: message });
  }
});

// ─── Admin endpoints ──────────────────────────────────────────────────────────
function requireAdminKey(req, res, next) {
  if (!process.env.ADMIN_API_KEY || req.headers['x-admin-key'] !== process.env.ADMIN_API_KEY)
    return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// Override or inspect a ticker's price manually
app.post('/api/admin/price', requireAdminKey, (req, res) => {
  const { ticker, price } = req.body;
  if (!ticker || typeof price !== 'number' || price <= 0)
    return res.status(400).json({ error: 'ticker and a positive numeric price are required' });
  setPrice(ticker, price, 'admin');
  res.json({ ticker: ticker.toUpperCase(), price, source: 'admin' });
});

// Inspect the full price store
app.get('/api/admin/prices', requireAdminKey, (_req, res) => {
  res.json(Object.fromEntries(priceStore));
});

// Offer prices (6-decimal bigint strings) — used by /api/trade/buy and /api/trade/sell
app.post('/api/admin/offer-price', requireAdminKey, (req, res) => {
  const { ticker, price } = req.body;
  if (!ticker || !price || !/^\d+$/.test(String(price)))
    return res.status(400).json({ error: 'ticker and a 6-decimal integer price are required' });
  setOfferPrice(ticker, price);
  res.json({ ticker: ticker.toUpperCase(), price: String(price) });
});

app.get('/api/admin/offer-prices', requireAdminKey, (_req, res) => {
  const out = {};
  for (const [k, v] of offerPriceStore) out[k] = v.toString();
  res.json(out);
});

// ─── POST /api/trade/buy — Overseer EIP-712 buy offer ────────────────────────
// Body: { user, ticker, shares }  (shares as 6-decimal integer string)
app.post('/api/trade/buy', async (req, res) => {
  if (!backendWallet || !overseerContract)
    return res.status(503).json({ error: 'Overseer signing not configured' });

  const { user, ticker, shares } = req.body;
  if (!user || !ticker || !shares || !/^\d+$/.test(String(shares)))
    return res.status(400).json({ error: 'user, ticker, and shares (6-decimal integer string) are required' });
  if (!isAddress(user))
    return res.status(400).json({ error: 'Invalid user address' });

  try {
    const price      = getOfferPrice(ticker);
    const sharesBn   = BigInt(shares);
    const priceFloat = Number(price) / 1_000_000;
    const priceBuy   = BigInt(Math.round(priceFloat * 1_030_000)); // 3% spread on buy
    const mdtCost    = (priceBuy * sharesBn) / 1_000_000n;
    const timestamp = BigInt(Math.floor(Date.now() / 1000));
    const nonce     = await overseerContract.nonces(user);
    const expiry    = timestamp + BigInt(process.env.OFFER_TTL ?? 120);

    const offer = { user, ticker: ticker.toUpperCase(), shares: sharesBn, mdtCost, price, timestamp, nonce: BigInt(nonce), expiry };
    const signature = await backendWallet.signTypedData(OVERSEER_DOMAIN, OFFER_TYPES, offer);

    res.json({
      offer: {
        user, ticker: offer.ticker,
        shares: sharesBn.toString(), mdtCost: mdtCost.toString(),
        price: price.toString(), timestamp: timestamp.toString(),
        nonce: offer.nonce.toString(), expiry: expiry.toString(),
      },
      signature,
    });
  } catch (err) {
    res.status(err.message.startsWith('No offer price') ? 404 : 500).json({ error: err.message });
  }
});

// ─── POST /api/trade/sell — Overseer EIP-712 redeem offer ────────────────────
// Body: { user, ticker, shares }  (shares as 6-decimal integer string)
app.post('/api/trade/sell', async (req, res) => {
  if (!backendWallet || !overseerContract)
    return res.status(503).json({ error: 'Overseer signing not configured' });

  const { user, ticker, shares } = req.body;
  if (!user || !ticker || !shares || !/^\d+$/.test(String(shares)))
    return res.status(400).json({ error: 'user, ticker, and shares (6-decimal integer string) are required' });
  if (!isAddress(user))
    return res.status(400).json({ error: 'Invalid user address' });

  try {
    const price      = getOfferPrice(ticker);
    const sharesBn   = BigInt(shares);
    const priceFloat = Number(price) / 1_000_000;
    const priceRaw   = BigInt(Math.round(priceFloat * 970_000)); // 3% spread
    const mdtPayout  = (priceRaw * sharesBn) / 1_000_000n;
    const timestamp  = BigInt(Math.floor(Date.now() / 1000));
    const nonce      = await overseerContract.nonces(user);
    const expiry     = timestamp + BigInt(process.env.OFFER_TTL ?? 120);

    const offer = { user, ticker: ticker.toUpperCase(), shares: sharesBn, mdtPayout, price, timestamp, nonce: BigInt(nonce), expiry };
    const signature = await backendWallet.signTypedData(OVERSEER_DOMAIN, REDEEM_TYPES, offer);

    res.json({
      offer: {
        user, ticker: offer.ticker,
        shares: sharesBn.toString(), mdtPayout: mdtPayout.toString(),
        price: price.toString(), timestamp: timestamp.toString(),
        nonce: offer.nonce.toString(), expiry: expiry.toString(),
      },
      signature,
    });
  } catch (err) {
    res.status(err.message.startsWith('No offer price') ? 404 : 500).json({ error: err.message });
  }
});

// ─── GET /api/balances/:address?tickers=AAPL,TSLA ────────────────────────────
// Returns on-chain share balances from EquityVault for the given tickers.
app.get('/api/balances/:address', async (req, res) => {
  const { address } = req.params;
  if (!isAddress(address)) return res.status(400).json({ error: 'Invalid address' });

  const tickers = ((req.query.tickers || '').split(','))
    .map(t => t.trim().toUpperCase()).filter(Boolean);
  if (!tickers.length) return res.status(400).json({ error: 'Provide ?tickers=AAPL,TSLA' });

  try {
    const ids  = tickers.map(t => BigInt(keccak256(toUtf8Bytes(t))));
    const bals = await equityVault.balanceOfBatch(tickers.map(() => address), ids);
    const balances = Object.fromEntries(tickers.map((t, i) => [t, bals[i].toString()]));
    res.json({ address, balances });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/tickers/:ticker ─────────────────────────────────────────────────
// Check whether a ticker is registered on EquityVault and return its tokenId.
app.get('/api/tickers/:ticker', async (req, res) => {
  const ticker = req.params.ticker.toUpperCase();
  try {
    const [registered, tokenId] = await Promise.all([
      equityVault.isRegistered(ticker),
      equityVault.tokenIdForTicker(ticker),
    ]);
    res.json({ ticker, tokenId: tokenId.toString(), registered });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ─── POST /api/deposit ────────────────────────────────────────────────────────
app.post('/api/deposit', async (req, res) => {
  try {
    const { amount, address } = req.body;
    if (!amount) return res.status(400).json({ error: 'amount is required' });

    const upstream = await fetch('https://maritime-deposit-service-266596137006.us-south1.run.app', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ amount, address }),
    });
    const text = await upstream.text();
    let json;
    try { json = JSON.parse(text); } catch { json = { error: text }; }
    res.status(upstream.status).json(json);
  } catch (err) {
    console.error('[deposit]', err.message);
    res.status(500).json({ error: err.message });
  }
});


// ─── POST /api/account ───────────────────────────────────────────────────────
app.post('/api/account', async (req, res) => {
  const docId = req.body.account_id;
  if (!docId) return res.status(400).json({ error: 'Missing account_id' });

  try {
    const doc = await db.collection('accounts').doc(docId).get();
    if (!doc.exists) {
      return res.status(200).json({ id: docId, balance: 0, amount: 0 });
    }
    return res.status(200).json({ id: doc.id, ...doc.data() });
  } catch (err) {
    console.error('[account]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/activity ───────────────────────────────────────────────────────
// Returns all on-chain activity for a wallet: buys (SharesMinted), sells
// (SharesBurned), dUSD deposits (Transfer from 0x0), dUSD withdrawals (Transfer
// to 0x0). MDT_CONTRACT_ADDRESS must point at the DhowUSD (dUSD) token.
// Set VAULT_DEPLOY_BLOCK in Railway env to the block the EquityVault was
// deployed at — this speeds up queries and avoids RPC range limits.
app.all('/api/activity', async (req, res) => {
  const walletAddress = req.query.walletAddress || req.body?.walletAddress;
  if (!walletAddress || !isAddress(walletAddress))
    return res.status(400).json({ error: "Missing or invalid 'walletAddress' query parameter." });

  const mdtAddress = process.env.MDT_CONTRACT_ADDRESS;
  if (!mdtAddress)
    return res.status(500).json({ error: 'MDT_CONTRACT_ADDRESS not configured.' });
  if (!process.env.EQUITY_VAULT_ADDRESS)
    return res.status(500).json({ error: 'EQUITY_VAULT_ADDRESS not configured.' });

  try {
    const ZERO = '0x0000000000000000000000000000000000000000';

    // Optional: set VAULT_DEPLOY_BLOCK to the deployment block so we only
    // scan from there instead of from genesis (avoids RPC range limits).
    const fromBlock = process.env.VAULT_DEPLOY_BLOCK
      ? parseInt(process.env.VAULT_DEPLOY_BLOCK, 10)
      : 0;

    // Contract instances with event ABIs only
    const vault = new Contract(
      process.env.EQUITY_VAULT_ADDRESS,
      [
        'event SharesMinted(address indexed to, string ticker, uint256 amount, address token)',
        'event SharesBurned(address indexed from, string ticker, uint256 amount, address token)',
      ],
      rpcProvider,
    );
    const mdt = new Contract(
      mdtAddress,
      ['event Transfer(address indexed from, address indexed to, uint256 value)'],
      rpcProvider,
    );

    // Query each event type individually so a single failure doesn't block
    // the others. RPC providers may reject unbounded ranges — fall back to []
    // so partial data still renders.
    const [mintLogs, burnLogs, mdtInLogs, mdtOutLogs] = await Promise.all([
      vault.queryFilter(vault.filters.SharesMinted(walletAddress), fromBlock).catch(() => []),
      vault.queryFilter(vault.filters.SharesBurned(walletAddress), fromBlock).catch(() => []),
      mdt.queryFilter(mdt.filters.Transfer(ZERO, walletAddress), fromBlock).catch(() => []),
      mdt.queryFilter(mdt.filters.Transfer(walletAddress, ZERO), fromBlock).catch(() => []),
    ]);

    // MDT Transfer events that share a tx hash with a trade are already
    // represented by SharesMinted/SharesBurned — exclude them.
    const tradeTxHashes = new Set([
      ...mintLogs.map(l => l.transactionHash),
      ...burnLogs.map(l => l.transactionHash),
    ]);
    const filteredMdtIn  = mdtInLogs .filter(l => !tradeTxHashes.has(l.transactionHash));
    const filteredMdtOut = mdtOutLogs.filter(l => !tradeTxHashes.has(l.transactionHash));

    // Fetch block timestamps for all unique block numbers
    const allLogs      = [...mintLogs, ...burnLogs, ...filteredMdtIn, ...filteredMdtOut];
    const uniqueBlocks = [...new Set(allLogs.map(l => l.blockNumber))];
    const blockTs      = {};
    await Promise.all(uniqueBlocks.map(async (bn) => {
      const block = await rpcProvider.getBlock(bn);
      blockTs[bn] = Number(block.timestamp) * 1000; // ms
    }));

    const result = [];

    for (const log of mintLogs) {
      result.push({
        type:        'buy',
        ticker:      log.args.ticker,
        shares:      Number(log.args.amount) / 1_000_000,
        dusdAmount:0,
        txHash:      log.transactionHash,
        blockNumber: log.blockNumber,
        timestamp:   blockTs[log.blockNumber] ?? 0,
      });
    }
    for (const log of burnLogs) {
      result.push({
        type:        'sell',
        ticker:      log.args.ticker,
        shares:      Number(log.args.amount) / 1_000_000,
        dusdAmount:0,
        txHash:      log.transactionHash,
        blockNumber: log.blockNumber,
        timestamp:   blockTs[log.blockNumber] ?? 0,
      });
    }
    for (const log of filteredMdtIn) {
      result.push({
        type:        'deposit',
        dusdAmount:Number(log.args.value) / 1_000_000,
        txHash:      log.transactionHash,
        blockNumber: log.blockNumber,
        timestamp:   blockTs[log.blockNumber] ?? 0,
      });
    }
    for (const log of filteredMdtOut) {
      result.push({
        type:        'withdraw',
        dusdAmount:Number(log.args.value) / 1_000_000,
        txHash:      log.transactionHash,
        blockNumber: log.blockNumber,
        timestamp:   blockTs[log.blockNumber] ?? 0,
      });
    }

    result.sort((a, b) => b.blockNumber - a.blockNumber);
    res.json({ activity: result });
  } catch (err) {
    console.error('[activity]', err.message);
    res.status(500).json({ error: 'Internal Server Error', details: err.message });
  }
});



// ─── POST /api/mint ───────────────────────────────────────────────────────────
// Called when ACH funds become available.
// Verifies the incoming HMAC-SHA256 signature, checks idempotency, then signs
// the payload so the cloud function can verify the data hasn't been tampered
// before it proceeds with minting.
//
// Required env vars:
//   MINT_SIGNING_SECRET — shared secret with the cloud function
//
// Replay-attack window: reject requests older than 5 minutes
const SIGNATURE_TTL_MS = 5 * 60_000;

app.post('/api/mint', async (req, res) => {
  try {
    const { walletAddress, amount, transferId, timestamp, userSignature, intentTimestamp } = req.body;

    if (!walletAddress || !amount || !transferId || !timestamp || !userSignature || !intentTimestamp) {
      return res.status(400).json({ error: 'Missing required fields.' });
    }

    // 1. Verify HMAC-SHA256 signature from cloud function
    const secret = process.env.MINT_SIGNING_SECRET;
    if (!secret) return res.status(500).json({ error: 'MINT_SIGNING_SECRET not configured.' });

    const expectedSig = crypto
      .createHmac('sha256', secret)
      .update(JSON.stringify({ walletAddress, amount, transferId, timestamp }))
      .digest('hex');

    const receivedSig = req.headers['x-cairo-signature'] ?? '';
    const expectedBuf = Buffer.from(expectedSig, 'hex');
    const receivedBuf = Buffer.from(receivedSig,  'hex');
    const sigOk = expectedBuf.length === receivedBuf.length &&
                  crypto.timingSafeEqual(expectedBuf, receivedBuf);
    if (!sigOk) return res.status(401).json({ error: 'Invalid signature.' });

    // 2. Reject stale requests (replay-attack prevention)
    if (Math.abs(Date.now() - Number(timestamp)) > SIGNATURE_TTL_MS) {
      return res.status(401).json({ error: 'Request timestamp expired.' });
    }

    // 3. Verify the user's EIP-712 signature — proves walletAddress and amount
    //    are exactly what the user agreed to. Tampering with either field fails here.
    let intentValid = false;
    try {
      intentValid = await verifyTypedData({
        address:     walletAddress,
        domain:      EIP712_DOMAIN,
        types:       EIP712_TYPES,
        primaryType: 'DepositIntent',
        message:     { walletAddress, amount: String(amount), timestamp: BigInt(intentTimestamp) },
        signature:   userSignature,
      });
    } catch (err) {
      return res.status(400).json({ error: 'User signature verification failed: ' + err.message });
    }
    if (!intentValid) {
      return res.status(401).json({ error: 'Invalid user signature — mint not authorized.' });
    }

    // 4. Idempotency — return cached signature for the same transfer
    const mintRef = db.collection('mints').doc(transferId);
    const mintDoc = await mintRef.get();
    if (mintDoc.exists) {
      return res.json({ success: true, ...mintDoc.data(), alreadyProcessed: true });
    }

    // 5. Sign the validated payload so the cloud function can trust it
    const approvedAt = Date.now();
    const approvedPayload = { walletAddress, amount, transferId, approvedAt };
    const backendSignature = crypto
      .createHmac('sha256', secret)
      .update(JSON.stringify(approvedPayload))
      .digest('hex');

    // 6. Record so this transfer can't be re-submitted
    await mintRef.set({ ...approvedPayload, backendSignature, createdAt: new Date().toISOString() });

    console.log(`[mint] approved ${amount} MDT → ${walletAddress} (transfer: ${transferId})`);

    // 7. Mint MDT tokens on-chain
    const mdtAddress = process.env.MDT_CONTRACT_ADDRESS;
    if (!mdtAddress) return res.status(500).json({ error: 'MDT_CONTRACT_ADDRESS not configured.' });
    const rpcUrl = process.env.RPC_URL;
    if (!rpcUrl) return res.status(500).json({ error: 'RPC_URL not configured.' });
    const deployerKey = process.env.DEPLOYER_PRIVATE_KEY;
    if (!deployerKey) return res.status(500).json({ error: 'DEPLOYER_PRIVATE_KEY not configured.' });

    const provider = new JsonRpcProvider(rpcUrl);
    const owner    = new Wallet(deployerKey, provider);
    const mdt      = new Contract(mdtAddress, ['function mint(address to, uint256 amount) external'], owner);

    const mintAmount = parseUnits(String(amount), 6);
    const tx = await mdt.mint(walletAddress, mintAmount);
    console.log(`[mint] tx submitted: ${tx.hash}`);
    await tx.wait();
    console.log(`[mint] confirmed: ${amount} MDT → ${walletAddress}`);

    return res.json({ success: true, ...approvedPayload, backendSignature, txHash: tx.hash });

  } catch (err) {
    console.error('[mint]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── WeChat Pay (via Airwallex) ───────────────────────────────────────────────

// Use demo env by default; set AIRWALLEX_ENV=production for live
const AIRWALLEX_BASE = process.env.AIRWALLEX_ENV === 'production'
  ? 'https://api.airwallex.com/api/v1'
  : 'https://api-demo.airwallex.com/api/v1';

let _awToken = null;
let _awTokenExpiry = 0;

async function airwallexAuth() {
  if (_awToken && Date.now() < _awTokenExpiry) return _awToken;

  const clientId = process.env.AIRWALLEX_CLIENT_ID;
  const apiKey   = process.env.AIRWALLEX_API_KEY;
  if (!clientId || !apiKey) {
    throw new Error('AIRWALLEX_CLIENT_ID and AIRWALLEX_API_KEY must be set in environment');
  }

  const res = await fetch(`${AIRWALLEX_BASE}/authentication/login`, {
    method: 'POST',
    headers: {
      'x-client-id':  clientId,
      'x-api-key':    apiKey,
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) throw new Error(`Airwallex auth failed (${res.status}): ${await res.text()}`);
  const data = await res.json();
  _awToken = data.token;
  _awTokenExpiry = Date.now() + 28 * 60 * 1000; // refresh 2 min before 30-min expiry
  return _awToken;
}

async function airwallexRequest(method, path, body) {
  const token = await airwallexAuth();
  const res = await fetch(`${AIRWALLEX_BASE}${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type':  'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(`Airwallex ${method} ${path} failed: ${JSON.stringify(data)}`);
  return data;
}

// Helper: create an Airwallex WeChat Pay QR code payment intent
// Returns { intentId, qrCodeUrl }
async function createWechatPayIntent(merchantOrderId, amountUsd, descriptor) {
  const intent = await airwallexRequest('POST', '/pa/payment_intents/create', {
    amount:            amountUsd,
    currency:          'USD',
    merchant_order_id: merchantOrderId,
    descriptor,
  });
  const confirmed = await airwallexRequest('POST', `/pa/payment_intents/${intent.id}/confirm`, {
    payment_method:         { type: 'wechatpay' },
    payment_method_options: { wechatpay: { flow: 'qrcode' } },
  });
  const qrCodeUrl = confirmed.next_action?.qr_code?.image_url
                 ?? confirmed.next_action?.qr_code_url
                 ?? '';
  return { intentId: intent.id, qrCodeUrl };
}

// ─── POST /api/wechat/create-session ─────────────────────────────────────────
// Creates a WeChat Pay QR code for account linking.
// Body: { walletAddress }
app.post('/api/wechat/create-session', async (req, res) => {
  const { walletAddress } = req.body;
  if (!walletAddress) return res.status(400).json({ error: 'walletAddress is required' });

  try {
    const sessionId = crypto.randomUUID();
    const { intentId, qrCodeUrl } = await createWechatPayIntent(sessionId, 0.01, 'Cairo WeChat Link');

    await db.collection('wechat_sessions').doc(sessionId).set({
      session_id:        sessionId,
      wallet_address:    walletAddress,
      status:            'pending',
      provider_order_id: intentId,
      created_at:        new Date().toISOString(),
    });

    res.json({ qr_code_url: qrCodeUrl, session_id: sessionId });
  } catch (err) {
    console.error('[wechat/create-session]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/wechat/link-status ────────────────────────────────────────────
// Polls whether the user has scanned and authorized the session.
// Body: { sessionId, walletAddress }
app.post('/api/wechat/link-status', async (req, res) => {
  const { sessionId, walletAddress } = req.body;
  if (!sessionId || !walletAddress) {
    return res.status(400).json({ error: 'sessionId and walletAddress are required' });
  }

  try {
    const doc = await db.collection('wechat_sessions').doc(sessionId).get();
    if (!doc.exists) return res.status(404).json({ error: 'Session not found' });

    const session = doc.data();
    if (session.wallet_address !== walletAddress) {
      return res.status(403).json({ error: 'Session does not belong to this wallet' });
    }

    res.json({ linked: session.status === 'linked' });
  } catch (err) {
    console.error('[wechat/link-status]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/wechat/linked ──────────────────────────────────────────────────
// Check if a wallet has a linked WeChat account.
// Body: { walletAddress }
app.post('/api/wechat/linked', async (req, res) => {
  const { walletAddress } = req.body;
  if (!walletAddress) return res.status(400).json({ error: 'walletAddress is required' });

  try {
    const snapshot = await db.collection('wechat_sessions')
      .where('wallet_address', '==', walletAddress)
      .where('status', '==', 'linked')
      .limit(1)
      .get();

    if (snapshot.empty) return res.json({ linked: false });

    const session = snapshot.docs[0].data();
    res.json({
      linked:  true,
      account: {
        openId:    session.wechat_open_id,
        nickname:  session.nickname,
        avatarUrl: session.avatar_url ?? null,
      },
    });
  } catch (err) {
    console.error('[wechat/linked]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/wechat/transfer/deposit ───────────────────────────────────────
// Initiates a WeChat Pay inbound payment. MDT is minted only after webhook
// confirms payment — not here.
// Body: { walletAddress, amount, signature, intentTimestamp }
app.post('/api/wechat/transfer/deposit', async (req, res) => {
  const { walletAddress, amount, signature, intentTimestamp } = req.body;
  if (!walletAddress || !amount || !signature || !intentTimestamp) {
    return res.status(400).json({ error: 'walletAddress, amount, signature, and intentTimestamp are required' });
  }

  // 1. Reject stale intents
  const ageSeconds = Math.floor(Date.now() / 1000) - Number(intentTimestamp);
  if (ageSeconds < 0 || ageSeconds > INTENT_TTL_S) {
    return res.status(401).json({ error: 'Deposit intent has expired. Please try again.' });
  }

  // 2. Verify EIP-712 signature
  let valid = false;
  try {
    valid = await verifyTypedData({
      address:     walletAddress,
      domain:      EIP712_DOMAIN,
      types:       EIP712_TYPES,
      primaryType: 'DepositIntent',
      message:     { walletAddress, amount: String(amount), timestamp: BigInt(intentTimestamp) },
      signature,
    });
  } catch (err) {
    return res.status(400).json({ error: 'Signature verification failed: ' + err.message });
  }
  if (!valid) return res.status(401).json({ error: 'Invalid signature — deposit intent not authorized.' });

  try {
    const transferId = crypto.randomUUID();
    const createdAt  = new Date().toISOString();

    // 3. Create WeChat Pay QR payment intent via Airwallex
    const { intentId, qrCodeUrl } = await createWechatPayIntent(
      transferId,
      parseFloat(amount),
      'Cairo MDT Deposit',
    );

    // 4. Persist transfer — MDT minted by webhook on payment confirmation
    await db.collection('wechat_transfers').doc(transferId).set({
      transfer_id:       transferId,
      wallet_address:    walletAddress,
      type:              'debit',
      amount:            parseFloat(amount),
      status:            'pending',
      provider_order_id: intentId,
      signature,
      intent_timestamp:  intentTimestamp,
      created_at:        createdAt,
    });

    res.json({ transferId, qr_code_url: qrCodeUrl, status: 'pending', amount: String(amount), createdAt });
  } catch (err) {
    console.error('[wechat/transfer/deposit]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/wechat/transfer/withdraw ──────────────────────────────────────
// Burns MDT on-chain then initiates a WeChat Pay payout to the linked account.
// Body: { walletAddress, amount, signature, intentTimestamp }
app.post('/api/wechat/transfer/withdraw', async (req, res) => {
  const { walletAddress, amount, signature, intentTimestamp } = req.body;
  if (!walletAddress || !amount || !signature || !intentTimestamp) {
    return res.status(400).json({ error: 'walletAddress, amount, signature, and intentTimestamp are required' });
  }

  // 1. Reject stale intents
  const ageSeconds = Math.floor(Date.now() / 1000) - Number(intentTimestamp);
  if (ageSeconds < 0 || ageSeconds > INTENT_TTL_S) {
    return res.status(401).json({ error: 'Intent has expired. Please try again.' });
  }

  // 2. Verify EIP-712 signature
  let valid = false;
  try {
    valid = await verifyTypedData({
      address:     walletAddress,
      domain:      EIP712_DOMAIN,
      types:       EIP712_TYPES,
      primaryType: 'DepositIntent',
      message:     { walletAddress, amount: String(amount), timestamp: BigInt(intentTimestamp) },
      signature,
    });
  } catch (err) {
    return res.status(400).json({ error: 'Signature verification failed: ' + err.message });
  }
  if (!valid) return res.status(401).json({ error: 'Invalid signature — withdraw not authorized.' });

  try {
    // 3. Require a linked WeChat account to send payout to
    const sessionSnap = await db.collection('wechat_sessions')
      .where('wallet_address', '==', walletAddress)
      .where('status', '==', 'linked')
      .limit(1)
      .get();
    if (sessionSnap.empty) {
      return res.status(400).json({ error: 'No linked WeChat account found for this wallet.' });
    }
    const linkedSession = sessionSnap.docs[0].data();

    // 4. Check on-chain MDT balance
    const mdtAddress  = process.env.MDT_CONTRACT_ADDRESS;
    const rpcUrl      = process.env.RPC_URL;
    const deployerKey = process.env.DEPLOYER_PRIVATE_KEY;
    if (!mdtAddress)  return res.status(500).json({ error: 'MDT_CONTRACT_ADDRESS not configured.' });
    if (!rpcUrl)      return res.status(500).json({ error: 'RPC_URL not configured.' });
    if (!deployerKey) return res.status(500).json({ error: 'DEPLOYER_PRIVATE_KEY not configured.' });

    const provider  = new JsonRpcProvider(rpcUrl);
    const owner     = new Wallet(deployerKey, provider);
    const mdt       = new Contract(mdtAddress, [
      'function balanceOf(address) view returns (uint256)',
      'function forceBurn(address from, uint256 amount) external',
    ], owner);

    const burnAmount = parseUnits(String(amount), 6);
    const balance    = await mdt.balanceOf(walletAddress);
    if (balance < burnAmount) {
      return res.status(400).json({ error: 'Insufficient MDT balance.' });
    }

    // 5. Force-burn MDT on-chain
    const tx = await mdt.forceBurn(walletAddress, burnAmount);
    console.log(`[wechat/withdraw] forceBurn tx submitted: ${tx.hash}`);
    await tx.wait();
    console.log(`[wechat/withdraw] burn confirmed: ${amount} MDT from ${walletAddress}`);

    const transferId = crypto.randomUUID();
    const createdAt  = new Date().toISOString();

    // 6. Initiate WeChat Pay payout via Airwallex
    await airwallexRequest('POST', '/transfers/create', {
      amount:           parseFloat(amount),
      currency:         'USD',
      payout_currency:  'CNY',
      reference:        transferId,
      beneficiary: {
        entity_type:     'PERSONAL',
        payment_methods: [{
          type:       'WECHATPAY',
          wechat_pay: { open_id: linkedSession.wechat_open_id },
        }],
      },
    });

    // 7. Record transfer
    await db.collection('wechat_transfers').doc(transferId).set({
      transfer_id:    transferId,
      wallet_address: walletAddress,
      type:           'credit',
      amount:         parseFloat(amount),
      status:         'pending',
      created_at:     createdAt,
    });

    res.json({ transferId, status: 'pending', amount: String(amount), type: 'credit', createdAt });
  } catch (err) {
    console.error('[wechat/transfer/withdraw]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/wechat/transfer/status ────────────────────────────────────────
// Body: { transferId }
app.post('/api/wechat/transfer/status', async (req, res) => {
  const { transferId } = req.body;
  if (!transferId) return res.status(400).json({ error: 'transferId is required' });

  try {
    const doc = await db.collection('wechat_transfers').doc(transferId).get();
    if (!doc.exists) return res.status(404).json({ error: 'Transfer not found' });

    const t = doc.data();

    // Re-fetch from Airwallex if still pending and we have a provider order id
    if (t.status === 'pending' && t.provider_order_id) {
      try {
        const intent = await airwallexRequest('GET', `/pa/payment_intents/${t.provider_order_id}`);
        if (intent.status === 'SUCCEEDED') {
          await db.collection('wechat_transfers').doc(transferId).set(
            { status: 'paid', updated_at: new Date().toISOString() },
            { merge: true },
          );
          t.status = 'paid';
        }
      } catch (e) {
        console.warn('[wechat/transfer/status] provider re-fetch failed:', e.message);
      }
    }

    res.json({ transferId: t.transfer_id, status: t.status, amount: String(t.amount) });
  } catch (err) {
    console.error('[wechat/transfer/status]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/wechat/transfer/history ───────────────────────────────────────
// Body: { walletAddress }
app.post('/api/wechat/transfer/history', async (req, res) => {
  const { walletAddress } = req.body;
  if (!walletAddress) return res.status(400).json({ error: 'walletAddress is required' });

  try {
    const snapshot = await db.collection('wechat_transfers')
      .where('wallet_address', '==', walletAddress)
      .orderBy('created_at', 'desc')
      .get();

    const transfers = snapshot.docs.map(doc => {
      const t = doc.data();
      return {
        transferId:  t.transfer_id,
        type:        t.type,
        amount:      String(t.amount),
        status:      t.status,
        description: t.description ?? null,
        createdAt:   t.created_at,
      };
    });

    res.json({ transfers });
  } catch (err) {
    console.error('[wechat/transfer/history]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/wechat/webhook ─────────────────────────────────────────────────
// Airwallex webhook: payment and payout notifications.
//
// On payment success → update transfer status to "paid", mint MDT on-chain.
//   Also handles session-link QR payments → marks session as "linked".
// On payout success → update transfer status to "settled".
app.post('/api/wechat/webhook', async (req, res) => {
  // 1. Verify Airwallex webhook signature (HMAC-SHA256 over timestamp + raw body)
  const webhookSecret = process.env.AIRWALLEX_WEBHOOK_SECRET;
  if (webhookSecret) {
    const signature = req.headers['x-signature'] ?? '';
    const timestamp = req.headers['x-timestamp'] ?? '';
    const rawBody   = (req.rawBody ?? Buffer.alloc(0)).toString('utf8');
    const expected  = crypto
      .createHmac('sha256', webhookSecret)
      .update(timestamp + rawBody)
      .digest('hex');

    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expected);
    const ok     = sigBuf.length === expBuf.length && crypto.timingSafeEqual(sigBuf, expBuf);
    if (!ok) {
      console.warn('[wechat/webhook] invalid signature');
      return res.status(401).json({ error: 'Invalid webhook signature' });
    }
  }

  // Acknowledge immediately so Airwallex won't retry
  res.sendStatus(200);

  const eventName = req.body?.name ?? req.body?.type ?? '';
  const data      = req.body?.data ?? req.body?.object ?? {};

  // 2. Payment succeeded — credit MDT or mark session linked
  if (['payment_intent.succeeded', 'PAYMENT_INTENT.SUCCEEDED'].includes(eventName)) {
    const merchantOrderId = data.merchant_order_id;
    if (!merchantOrderId) return;

    try {
      const transferRef = db.collection('wechat_transfers').doc(merchantOrderId);
      const transferDoc = await transferRef.get();

      if (!transferDoc.exists) {
        // No transfer found — check if this is a session-link QR payment
        const sessionDoc = await db.collection('wechat_sessions').doc(merchantOrderId).get();
        if (sessionDoc.exists && sessionDoc.data().status === 'pending') {
          await db.collection('wechat_sessions').doc(merchantOrderId).set({
            status:         'linked',
            wechat_open_id: data.payment_method?.wechatpay?.open_id ?? data.payer?.open_id ?? '',
            nickname:       data.payer?.nickname ?? '',
            avatar_url:     data.payer?.avatar_url ?? '',
            linked_at:      new Date().toISOString(),
          }, { merge: true });
          console.log(`[wechat/webhook] session ${merchantOrderId} linked`);
        }
        return;
      }

      const transfer = transferDoc.data();
      if (transfer.credited) return; // Idempotency guard

      await transferRef.set({ status: 'paid', updated_at: new Date().toISOString() }, { merge: true });

      // Only mint for inbound payments (debit = user paid us)
      if (transfer.type !== 'debit') return;

      const mdtAddress  = process.env.MDT_CONTRACT_ADDRESS;
      const rpcUrl      = process.env.RPC_URL;
      const deployerKey = process.env.DEPLOYER_PRIVATE_KEY;
      if (!mdtAddress || !rpcUrl || !deployerKey) {
        console.error('[wechat/webhook] missing on-chain config — cannot mint');
        return;
      }

      const provider   = new JsonRpcProvider(rpcUrl);
      const owner      = new Wallet(deployerKey, provider);
      const mdt        = new Contract(mdtAddress, ['function mint(address to, uint256 amount) external'], owner);
      const mintAmount = parseUnits(String(transfer.amount), 6);
      const tx         = await mdt.mint(transfer.wallet_address, mintAmount);
      console.log(`[wechat/webhook] mint tx submitted: ${tx.hash}`);
      await tx.wait();
      console.log(`[wechat/webhook] minted ${transfer.amount} MDT → ${transfer.wallet_address}`);

      await transferRef.set({ credited: true, tx_hash: tx.hash }, { merge: true });
    } catch (err) {
      console.error('[wechat/webhook] payment.succeeded handler failed:', err.message);
    }
    return;
  }

  // 3. Payout settled
  if (['transfer.succeeded', 'TRANSFER.SUCCEEDED', 'payout.succeeded', 'PAYOUT.SUCCEEDED'].includes(eventName)) {
    const reference = data.reference;
    if (!reference) return;
    try {
      await db.collection('wechat_transfers').doc(reference).set(
        { status: 'settled', updated_at: new Date().toISOString() },
        { merge: true },
      );
      console.log(`[wechat/webhook] payout settled: ${reference}`);
    } catch (err) {
      console.error('[wechat/webhook] payout.settled handler failed:', err.message);
    }
  }
});

// ─── Portfolio balance store (file-backed) ───────────────────────────────────
// ─── Portfolio auth — challenge / session token ───────────────────────────────

// Pending nonces: nonce → { address, expiresAt }
const _nonces = new Map();
// Active sessions: token → { address, expiresAt }
const _sessions = new Map();

// Prune expired entries every minute
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of _nonces)   if (v.expiresAt < now) _nonces.delete(k);
  for (const [k, v] of _sessions) if (v.expiresAt < now) _sessions.delete(k);
}, 60_000);

function buildAuthMessage(address, nonce) {
  return (
    `Sign in to Maritime\n\n` +
    `This request will not trigger a blockchain transaction or cost any gas fees.\n\n` +
    `Address: ${address.toLowerCase()}\n` +
    `Nonce: ${nonce}`
  );
}

// POST /api/portfolio-balance/auth/challenge
// Body: { address }  →  { nonce, message }
app.post('/api/portfolio-balance/auth/challenge', (req, res) => {
  const { address } = req.body ?? {};
  if (!address || !isAddress(address))
    return res.status(400).json({ error: 'valid address required' });

  const nonce = crypto.randomBytes(16).toString('hex');
  _nonces.set(nonce, { address: address.toLowerCase(), expiresAt: Date.now() + 5 * 60_000 });
  res.json({ nonce, message: buildAuthMessage(address, nonce) });
});

// POST /api/portfolio-balance/auth/verify
// Body: { address, nonce, signature }  →  returns { token, expiresAt } in body
// The proxy (Next.js route handler) sets the HttpOnly cookie; the backend never touches cookies.
app.post('/api/portfolio-balance/auth/verify', (req, res) => {
  const { address, nonce, signature } = req.body ?? {};
  if (!address || !nonce || !signature)
    return res.status(400).json({ error: 'address, nonce, and signature are required' });

  const pending = _nonces.get(nonce);
  if (!pending || pending.expiresAt < Date.now())
    return res.status(400).json({ error: 'unknown or expired nonce' });
  if (pending.address !== address.toLowerCase())
    return res.status(400).json({ error: 'address mismatch' });

  let recovered;
  try { recovered = verifyMessage(buildAuthMessage(address, nonce), signature); }
  catch { return res.status(400).json({ error: 'malformed signature' }); }

  if (recovered.toLowerCase() !== address.toLowerCase())
    return res.status(401).json({ error: 'signature does not match address' });

  _nonces.delete(nonce); // one-time use

  const token     = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + 24 * 60 * 60_000; // 24 h
  _sessions.set(token, { address: address.toLowerCase(), expiresAt });

  res.json({ token, expiresAt });
});

// POST /api/portfolio-balance/auth/logout — invalidates the session token
app.post('/api/portfolio-balance/auth/logout', (req, res) => {
  const token = req.headers['x-maritime-session'];
  if (token) _sessions.delete(token);
  res.json({ success: true });
});

// Middleware: require a valid x-maritime-session header (injected by the proxy from the HttpOnly cookie).
// Sets req.sessionAddress on success.
function requireSession(req, res, next) {
  const token = req.headers['x-maritime-session'];
  if (!token)
    return res.status(401).json({ error: 'not authenticated — sign in first' });

  const session = _sessions.get(token);
  if (!session || session.expiresAt < Date.now()) {
    _sessions.delete(token);
    return res.status(401).json({ error: 'session expired — sign in again' });
  }
  req.sessionAddress = session.address;
  next();
}

const PB_STORE_PATH = path.join(process.cwd(), 'data', 'portfolio-balances.json');

async function pbRead() {
  try { return JSON.parse(await fs.readFile(PB_STORE_PATH, 'utf8')) ?? {}; }
  catch { return {}; }
}
async function pbWrite(data) {
  await fs.mkdir(path.dirname(PB_STORE_PATH), { recursive: true });
  const tmp = `${PB_STORE_PATH}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await fs.rename(tmp, PB_STORE_PATH);
}
async function pbGet(address) {
  const store = await pbRead();
  return store[address.toLowerCase()] ?? null;
}
async function pbSet(address, balance) {
  // Ignore zero/negative values — they indicate an uninitialized loading state.
  if (!balance || balance <= 0) return null;

  const store    = await pbRead();
  const key      = address.toLowerCase();
  const existing = store[key];
  const now      = new Date().toISOString();
  const history  = existing?.history ?? [];
  const last     = history[history.length - 1];
  const next     = Math.round(balance * 100) / 100;

  if (last) {
    const ageSecs = (Date.now() - new Date(last.at).getTime()) / 1000;
    const delta   = Math.abs(last.balance - next);
    if (delta < 0.01) {
      // Negligible change — slide the last point's timestamp forward.
      history[history.length - 1] = { at: now, balance: next };
    } else if (ageSecs < 300 && delta < 1.0) {
      // Within 5 minutes and small drift — update in-place rather than adding noise.
      history[history.length - 1] = { at: now, balance: next };
    } else {
      // Enough time has passed, or a meaningful jump — record a new point.
      history.push({ at: now, balance: next });
    }
  } else {
    history.push({ at: now, balance: next });
  }

  const row = { balance: next, createdAt: existing?.createdAt ?? now, updatedAt: now, history };
  store[key] = row;
  await pbWrite(store);
  return row;
}

// ─── GET /api/portfolio-balance/:address ─────────────────────────────────────
app.get('/api/portfolio-balance/:address', async (req, res) => {
  try {
    const row = await pbGet(req.params.address);
    res.json({ address: req.params.address, balance: row?.balance ?? null, createdAt: row?.createdAt ?? null, updatedAt: row?.updatedAt ?? null });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── PUT /api/portfolio-balance/:address ─────────────────────────────────────
app.put('/api/portfolio-balance/:address', requireSession, async (req, res) => {
  // Session must belong to the address being written.
  if (req.sessionAddress !== req.params.address.toLowerCase())
    return res.status(403).json({ error: 'session address does not match' });

  const { balance, clientTime } = req.body ?? {};

  if (typeof balance !== 'number' || !isFinite(balance) || balance < 0)
    return res.status(400).json({ error: 'balance must be a non-negative finite number' });

  // clientTime must be within ±5 minutes of server time.
  if (!clientTime)
    return res.status(400).json({ error: 'clientTime is required' });
  const clientMs = new Date(clientTime).getTime();
  if (isNaN(clientMs))
    return res.status(400).json({ error: 'clientTime must be a valid ISO timestamp' });
  if (Math.abs(Date.now() - clientMs) > 5 * 60_000)
    return res.status(400).json({ error: 'clientTime is too far from server time' });

  try {
    const saved = await pbSet(req.params.address, balance);
    if (!saved) return res.json({ address: req.params.address, balance, skipped: true });
    res.json({ address: req.params.address, balance: saved.balance, createdAt: saved.createdAt, updatedAt: saved.updatedAt });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── GET /api/portfolio-balance/:address/history?days=30 ─────────────────────
app.get('/api/portfolio-balance/:address/history', async (req, res) => {
  const days     = Math.min(365, Math.max(1, parseInt(req.query.days, 10) || 30));
  const since    = Date.now() - days * 86_400_000;
  const bucketMs = days <= 1  ?       5 * 60_000   // ≤1 day   → 1 pt / 5 min
                 : days <= 7  ?      60 * 60_000   // ≤1 week  → 1 pt / hour
                 : days <= 30 ?   6 * 60 * 60_000  // ≤1 month → 1 pt / 6 hours
                 : days <= 90 ?  24 * 60 * 60_000  // ≤3 months→ 1 pt / day
                 :              72 * 60 * 60_000;  // >3 months→ 1 pt / 3 days
  try {
    const row = await pbGet(req.params.address);
    // Filter zeros (loading-state artifacts) and apply the time window.
    const raw = (row?.history ?? [])
      .filter(p => p.balance > 0 && new Date(p.at).getTime() >= since);
    // Downsample: keep the last reading within each time bucket.
    const buckets = new Map();
    for (const p of raw) {
      const bucket = Math.floor(new Date(p.at).getTime() / bucketMs);
      buckets.set(bucket, p);
    }
    const points = [...buckets.values()]
      .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
      .map(p => ({ time: p.at, value: p.balance }));
    res.json({ address: req.params.address, days, points });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Banking auth ─────────────────────────────────────────────────────────────
// Email + password login; sessions injected by the Next.js proxy as
// x-banking-session (HttpOnly cookie never touches this server).

const bcrypt = require('bcryptjs');
const BANKING_USERS_PATH = path.join(process.cwd(), 'data', 'banking-users.json');

async function readBankingUsers() {
  try { return JSON.parse(await fs.readFile(BANKING_USERS_PATH, 'utf8')); }
  catch { return {}; }
}
async function writeBankingUsers(users) {
  await fs.mkdir(path.dirname(BANKING_USERS_PATH), { recursive: true });
  await fs.writeFile(BANKING_USERS_PATH, JSON.stringify(users, null, 2));
}

const _bankingSessions = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of _bankingSessions) if (v.expiresAt < now) _bankingSessions.delete(k);
}, 60_000);

// POST /api/banking/auth/register — create account
app.post('/api/banking/auth/register', async (req, res) => {
  try {
    const { email, password, name } = req.body ?? {};
    if (!email || !password) return res.status(400).json({ error: 'email and password are required' });
    const users = await readBankingUsers();
    if (users[email.toLowerCase()]) return res.status(409).json({ error: 'an account with that email already exists' });
    const passwordHash = await bcrypt.hash(password, 12);
    users[email.toLowerCase()] = {
      id: crypto.randomUUID(), email: email.toLowerCase(),
      name: name ?? '', passwordHash, createdAt: new Date().toISOString(),
    };
    await writeBankingUsers(users);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/banking/auth/login — returns { token, expiresAt, user } in body
// The proxy reads `token` and sets the HttpOnly banking_session cookie.
app.post('/api/banking/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body ?? {};
    if (!email || !password) return res.status(400).json({ error: 'email and password are required' });
    const users = await readBankingUsers();
    const user = users[email.toLowerCase()];
    // Use a constant-time compare even on miss to avoid timing attacks
    const hash = user?.passwordHash ?? '$2a$12$invalidhashpadding000000000000000000000000000000000000000';
    const valid = await bcrypt.compare(password, hash);
    if (!user || !valid) return res.status(401).json({ error: 'incorrect email or password' });
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + 24 * 60 * 60_000;
    _bankingSessions.set(token, { email: user.email, name: user.name, customerId: user.customerId ?? null, expiresAt });
    res.json({ token, expiresAt, user: { email: user.email, name: user.name, customerId: user.customerId ?? null } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/banking/auth/logout — invalidate session
app.post('/api/banking/auth/logout', (req, res) => {
  const token = req.headers['x-banking-session'];
  if (token) _bankingSessions.delete(token);
  res.json({ success: true });
});

// GET /api/banking/auth/me — verify session, return user info
app.get('/api/banking/auth/me', (req, res) => {
  const token = req.headers['x-banking-session'];
  if (!token) return res.status(401).json({ error: 'not authenticated' });
  const session = _bankingSessions.get(token);
  if (!session || session.expiresAt < Date.now()) {
    _bankingSessions.delete(token);
    return res.status(401).json({ error: 'session expired' });
  }
  res.json({ email: session.email, name: session.name, customerId: session.customerId ?? null });
});

// ─── POST /api/bridge/customers ──────────────────────────────────────────────
// Creates a Bridge KYC individual customer (US) per the Customers API spec.
// Required body fields:
//   firstName, lastName, email, birthDate (YYYY-MM-DD),
//   street, city, subdivision (state abbrev), postalCode,
//   ssn ("xxx-xx-xxxx"), signedAgreementId
// Optional:
//   phone, country (ISO alpha-3, default "USA"),
//   streetLine2
// Auth: x-banking-session header (injected by Next.js proxy)
app.post('/api/bridge/customers', async (req, res) => {
  const apiKey = process.env.BRIDGE_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'BRIDGE_API_KEY not configured' });

  // Verify session
  const token = req.headers['x-banking-session'];
  if (!token) return res.status(401).json({ error: 'not authenticated' });
  const session = _bankingSessions.get(token);
  if (!session || session.expiresAt < Date.now()) {
    _bankingSessions.delete(token);
    return res.status(401).json({ error: 'session expired' });
  }

  const {
    firstName, lastName, email, birthDate,
    street, streetLine2, city, subdivision, postalCode, country = 'USA',
    ssn, signedAgreementId, phone,
  } = req.body ?? {};

  const missing = ['firstName','lastName','email','birthDate','street','city','subdivision','postalCode','ssn','signedAgreementId']
    .filter(f => !req.body?.[f]);
  if (missing.length)
    return res.status(400).json({ error: `Missing required fields: ${missing.join(', ')}` });

  try {
    const axios = require('axios');
    const body = {
      type:       'individual',
      first_name: firstName,
      last_name:  lastName,
      email,
      birth_date: birthDate,
      ...(phone && { phone }),
      residential_address: {
        street_line_1: street,
        ...(streetLine2 && { street_line_2: streetLine2 }),
        city,
        subdivision,   // ISO 3166-2 subdivision code without country prefix, e.g. "NY"
        postal_code:   postalCode,
        country,       // ISO alpha-3, e.g. "USA"
      },
      signed_agreement_id: signedAgreementId,
      identifying_information: [
        {
          type:            'ssn',
          issuing_country: 'usa',
          number:          ssn,
        },
      ],
    };

    const response = await axios.post('https://api.bridge.xyz/v0/customers', body, {
      headers: {
        'Api-Key':         apiKey,
        'Content-Type':    'application/json',
        'Accept':          'application/json',
        'Idempotency-Key': `cust-${session.email}-${Date.now()}`,
      },
    });

    const customerId = response.data?.id;
    if (!customerId) return res.status(502).json({ error: 'Bridge did not return a customer id', raw: response.data });

    // Persist customerId on the banking user record
    const users = await readBankingUsers();
    if (users[session.email]) {
      users[session.email].customerId = customerId;
      await writeBankingUsers(users);
    }

    // Update in-memory session so /me and external-account calls work immediately
    session.customerId = customerId;

    res.json({ customerId, kycStatus: response.data?.kyc_status, raw: response.data });
  } catch (err) {
    const status = err.response?.status ?? 500;
    const data   = err.response?.data ?? { error: err.message };
    console.error('[bridge/customers]', status, data);
    res.status(status).json(data);
  }
});

// ─── POST /api/bridge/external-accounts ──────────────────────────────────────
// Creates an external bank account for a Bridge customer.
// Required body fields:
//   customerId, firstName, lastName, bankName, accountName,
//   routingNumber, accountNumber, checkingOrSavings,
//   street, city, state, postalCode
// Optional:
//   idempotencyKey   (auto-generated if omitted)
//   accountOwnerName (defaults to "firstName lastName")
//   accountOwnerType (default: "individual")
//   currency         (default: "usd")
//   accountType      (default: "us")
//   country          (default: "USA")
app.post('/api/bridge/external-accounts', async (req, res) => {
  const apiKey = process.env.BRIDGE_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'BRIDGE_API_KEY not configured' });

  const {
    customerId,   idempotencyKey,
    firstName,    lastName,
    bankName,     accountName,
    accountOwnerName, accountOwnerType = 'individual',
    routingNumber, accountNumber, checkingOrSavings,
    street,       city,   state,  postalCode,
    currency     = 'usd',
    accountType  = 'us',
    country      = 'USA',
  } = req.body;

  const missing = ['customerId','firstName','lastName','bankName','accountName',
                   'routingNumber','accountNumber','checkingOrSavings',
                   'street','city','state','postalCode']
    .filter(f => !req.body[f]);
  if (missing.length)
    return res.status(400).json({ error: `Missing required fields: ${missing.join(', ')}` });

  try {
    const axios = require('axios');
    const response = await axios.post(
      `https://api.bridge.xyz/v0/customers/${customerId}/external_accounts`,
      {
        currency,
        account_type:        accountType,
        bank_name:           bankName,
        account_name:        accountName,
        first_name:          firstName,
        last_name:           lastName,
        account_owner_type:  accountOwnerType,
        account_owner_name:  accountOwnerName ?? `${firstName} ${lastName}`,
        account: {
          routing_number:      routingNumber,
          account_number:      accountNumber,
          checking_or_savings: checkingOrSavings,
        },
        address: {
          street_line_1: street,
          city,
          state,
          postal_code:   postalCode,
          country,
        },
      },
      {
        headers: {
          'Api-Key':         apiKey,
          'Idempotency-Key': idempotencyKey ?? `ea-${Date.now()}`,
          'Content-Type':    'application/json',
          'Accept':          'application/json',
        },
      }
    );
    res.status(response.status).json(response.data);
  } catch (err) {
    const status = err.response?.status ?? 500;
    const data   = err.response?.data ?? { error: err.message };
    console.error('[bridge/external-accounts]', status, data);
    res.status(status).json(data);
  }
});

// ─── GET /api/bridge/external-accounts/:customerId ───────────────────────────
// Lists all external accounts for a Bridge customer.
// Normalises the Bridge response shape for the frontend:
//   active (bool) → status ("active" | "inactive")
//   account_name null → falls back to account_owner_name
app.get('/api/bridge/external-accounts/:customerId', async (req, res) => {
  const apiKey = process.env.BRIDGE_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'BRIDGE_API_KEY not configured' });

  try {
    const axios = require('axios');
    const response = await axios.get(
      `https://api.bridge.xyz/v0/customers/${req.params.customerId}/external_accounts`,
      { headers: { 'Api-Key': apiKey, 'Accept': 'application/json' } }
    );
    const normalized = (response.data.data ?? []).map(a => ({
      id:           a.id,
      bank_name:    a.bank_name ?? 'Unknown Bank',
      account_name: a.account_name ?? a.account_owner_name ?? '',
      last_4:       a.last_4 ?? a.account?.last_4 ?? '••••',
      status:       a.active ? 'active' : 'inactive',
    }));
    res.json({ count: normalized.length, data: normalized });
  } catch (err) {
    const status = err.response?.status ?? 500;
    const data   = err.response?.data ?? { error: err.message };
    console.error('[bridge/external-accounts/list]', status, data);
    res.status(status).json(data);
  }
});

// ─── DELETE /api/bridge/external-accounts/:customerId/:accountId ─────────────
// Removes a stored external account.
app.delete('/api/bridge/external-accounts/:customerId/:accountId', async (req, res) => {
  const apiKey = process.env.BRIDGE_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'BRIDGE_API_KEY not configured' });

  try {
    const axios = require('axios');
    const response = await axios.delete(
      `https://api.bridge.xyz/v0/customers/${req.params.customerId}/external_accounts/${req.params.accountId}`,
      { headers: { 'Api-Key': apiKey, 'Accept': 'application/json' } }
    );
    res.status(response.status).json(response.data);
  } catch (err) {
    const status = err.response?.status ?? 500;
    const data   = err.response?.data ?? { error: err.message };
    console.error('[bridge/external-accounts/delete]', status, data);
    res.status(status).json(data);
  }
});

// ─── POST /api/bridge/customers/:customerId/wallets ──────────────────────────
// Creates a custodial wallet for a Bridge customer on a given chain.
// Supported chains: base, ethereum, solana, tempo, tron
// Body: { chain }
const SUPPORTED_WALLET_CHAINS = new Set(['base', 'ethereum', 'solana', 'tempo', 'tron']);

app.post('/api/bridge/customers/:customerId/wallets', async (req, res) => {
  const apiKey = process.env.BRIDGE_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'BRIDGE_API_KEY not configured' });

  const { customerId } = req.params;
  const { chain } = req.body ?? {};

  if (!chain) return res.status(400).json({ error: 'Missing required field: chain' });
  if (!SUPPORTED_WALLET_CHAINS.has(chain.toLowerCase()))
    return res.status(400).json({
      error: `Unsupported chain: "${chain}". Supported: ${[...SUPPORTED_WALLET_CHAINS].join(', ')}`,
    });

  try {
    const axios = require('axios');
    const response = await axios.post(
      `https://api.bridge.xyz/v0/customers/${customerId}/wallets`,
      { chain: chain.toLowerCase() },
      {
        headers: {
          'Api-Key':         apiKey,
          'Idempotency-Key': `wallet-${customerId}-${chain}-${Date.now()}`,
          'Content-Type':    'application/json',
          'Accept':          'application/json',
        },
      }
    );
    res.status(response.status).json(response.data);
  } catch (err) {
    const status = err.response?.status ?? 500;
    const data   = err.response?.data ?? { error: err.message };
    console.error('[bridge/customers/wallets]', status, data);
    res.status(status).json(data);
  }
});

// ─── GET /api/bridge/customers/:customerId/wallets ───────────────────────────
// Lists all custodial wallets for a Bridge customer.
app.get('/api/bridge/customers/:customerId/wallets', async (req, res) => {
  const apiKey = process.env.BRIDGE_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'BRIDGE_API_KEY not configured' });

  try {
    const axios = require('axios');
    const response = await axios.get(
      `https://api.bridge.xyz/v0/customers/${req.params.customerId}/wallets`,
      { headers: { 'Api-Key': apiKey, 'Accept': 'application/json' } }
    );
    res.status(response.status).json(response.data);
  } catch (err) {
    const status = err.response?.status ?? 500;
    const data   = err.response?.data ?? { error: err.message };
    console.error('[bridge/customers/wallets/list]', status, data);
    res.status(status).json(data);
  }
});

// ─── GET /api/bridge/customers/:customerId/wallets/:walletId ─────────────────
// Fetches a single wallet including balance info.
app.get('/api/bridge/customers/:customerId/wallets/:walletId', async (req, res) => {
  const apiKey = process.env.BRIDGE_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'BRIDGE_API_KEY not configured' });

  try {
    const axios = require('axios');
    const response = await axios.get(
      `https://api.bridge.xyz/v0/customers/${req.params.customerId}/wallets/${req.params.walletId}`,
      { headers: { 'Api-Key': apiKey, 'Accept': 'application/json' } }
    );
    res.status(response.status).json(response.data);
  } catch (err) {
    const status = err.response?.status ?? 500;
    const data   = err.response?.data ?? { error: err.message };
    console.error('[bridge/customers/wallets/get]', status, data);
    res.status(status).json(data);
  }
});

// ─── POST /api/bridge/send ────────────────────────────────────────────────────
// Sends crypto from a Bridge custodial wallet to any on-chain address.
// Required body fields:
//   amount          — decimal string, e.g. "10.0"
//   customerId      — Bridge customer the wallet belongs to
//   walletId        — source Bridge wallet ID
//   sourceCurrency  — currency held in the wallet, e.g. "usdb"
//   destChain       — destination payment rail, e.g. "ethereum", "base", "solana"
//   destCurrency    — currency to deliver, e.g. "usdc"
//   toAddress       — destination on-chain address
// Optional:
//   idempotencyKey  — auto-generated if omitted
app.post('/api/bridge/send', async (req, res) => {
  const apiKey = process.env.BRIDGE_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'BRIDGE_API_KEY not configured' });

  const {
    amount, customerId, walletId,
    sourceCurrency, destChain, destCurrency, toAddress,
    idempotencyKey,
  } = req.body ?? {};

  const missing = ['amount','customerId','walletId','sourceCurrency','destChain','destCurrency','toAddress']
    .filter(f => !req.body?.[f]);
  if (missing.length)
    return res.status(400).json({ error: `Missing required fields: ${missing.join(', ')}` });

  try {
    const axios = require('axios');
    const response = await axios.post(
      'https://api.bridge.xyz/v0/transfers',
      {
        amount,
        on_behalf_of: customerId,
        source: {
          payment_rail:    'bridge_wallet',
          currency:        sourceCurrency,
          bridge_wallet_id: walletId,
        },
        destination: {
          payment_rail: destChain,
          currency:     destCurrency,
          to_address:   toAddress,
        },
      },
      {
        headers: {
          'Api-Key':         apiKey,
          'Idempotency-Key': idempotencyKey ?? `send-${customerId}-${Date.now()}`,
          'Content-Type':    'application/json',
          'Accept':          'application/json',
        },
      }
    );
    res.status(response.status).json(response.data);
  } catch (err) {
    const status = err.response?.status ?? 500;
    const data   = err.response?.data ?? { error: err.message };
    console.error('[bridge/send]', status, data);
    res.status(status).json(data);
  }
});

// ─── POST /api/bridge/transfers ──────────────────────────────────────────────
// Initiates a crypto → fiat off-ramp transfer via Bridge.
// Body: { amount, customerId, sourceChain, sourceCurrency,
//         externalAccountId, destinationRail,
//         fromAddress?,        // omit if allowAnyFromAddress is true
//         allowAnyFromAddress?, // default true — recommended for crypto deposits
//         idempotencyKey? }
app.post('/api/bridge/transfers', async (req, res) => {
  const apiKey = process.env.BRIDGE_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'BRIDGE_API_KEY not configured' });

  const {
    amount, customerId,
    // external-wallet source fields
    sourceChain, sourceCurrency, fromAddress, allowAnyFromAddress = true,
    // bridge-wallet source fields
    walletId, walletCurrency,
    // destination
    externalAccountId, destinationRail,
    idempotencyKey,
  } = req.body ?? {};

  const VALID_RAILS = ['ach_push', 'wire'];
  if (!amount)             return res.status(400).json({ error: 'Missing required field: amount' });
  if (!customerId)         return res.status(400).json({ error: 'Missing required field: customerId' });
  if (!externalAccountId)  return res.status(400).json({ error: 'Missing required field: externalAccountId' });
  if (!destinationRail)    return res.status(400).json({ error: 'Missing required field: destinationRail' });
  if (!VALID_RAILS.includes(destinationRail))
    return res.status(400).json({ error: `destinationRail must be one of: ${VALID_RAILS.join(', ')}` });

  let source;
  let features;

  if (walletId) {
    // Source: Bridge custodial wallet
    if (!walletCurrency)
      return res.status(400).json({ error: 'walletCurrency is required when walletId is provided' });
    source = {
      payment_rail:     'bridge_wallet',
      currency:         walletCurrency.toLowerCase(),
      bridge_wallet_id: walletId,
    };
  } else {
    // Source: external crypto address
    const VALID_CHAINS     = ['ethereum', 'base', 'solana', 'tron', 'tempo'];
    const VALID_CURRENCIES = ['usdc', 'usdt', 'usdb', 'pyusd', 'dai', 'eurc'];
    if (!sourceChain)     return res.status(400).json({ error: 'Missing required field: sourceChain' });
    if (!sourceCurrency)  return res.status(400).json({ error: 'Missing required field: sourceCurrency' });
    if (!VALID_CHAINS.includes(sourceChain))
      return res.status(400).json({ error: `sourceChain must be one of: ${VALID_CHAINS.join(', ')}` });
    if (!VALID_CURRENCIES.includes(sourceCurrency.toLowerCase()))
      return res.status(400).json({ error: `sourceCurrency must be one of: ${VALID_CURRENCIES.join(', ')}` });
    if (!allowAnyFromAddress && !fromAddress)
      return res.status(400).json({ error: 'fromAddress is required when allowAnyFromAddress is false' });
    source = {
      payment_rail: sourceChain,
      currency:     sourceCurrency.toLowerCase(),
      ...(fromAddress ? { from_address: fromAddress } : {}),
    };
    if (allowAnyFromAddress) features = { allow_any_from_address: true };
  }

  const body = {
    amount:       String(amount),
    on_behalf_of: customerId,
    source,
    destination: {
      payment_rail:        destinationRail,
      currency:            'usd',
      external_account_id: externalAccountId,
    },
    ...(features ? { features } : {}),
  };

  try {
    const axios = require('axios');
    const response = await axios.post('https://api.bridge.xyz/v0/transfers', body, {
      headers: {
        'Api-Key':         apiKey,
        'Idempotency-Key': idempotencyKey ?? `transfer-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        'Content-Type':    'application/json',
        'Accept':          'application/json',
      },
    });
    res.status(response.status).json(response.data);
  } catch (err) {
    const status = err.response?.status ?? 500;
    const data   = err.response?.data ?? { error: err.message };
    console.error('[bridge/transfers]', status, data);
    res.status(status).json(data);
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Market API listening on http://localhost:${PORT}`));
