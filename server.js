import express from 'express';

const app = express();
const PORT = process.env.PORT || 3000;

const BASE_RPC = 'https://mainnet.base.org';
const EAS_GRAPHQL = 'https://base.easscan.org/graphql';

// Etherscan removed free-tier API access for Base (chain 8453) in late 2025.
// Blockscout's Base explorer is open-source, Etherscan-API-compatible, and
// requires no key at all — direct drop-in replacement, no account needed.
const BLOCKSCOUT_API = 'https://base.blockscout.com/api';

// Simple in-memory cache so repeated /score calls for the same address
// (e.g. during a demo, or a UI re-render) don't re-hit three external
// APIs every time. Not persistent across restarts — that's fine for an
// MVP; swap for Redis if this ever needs to survive redeploys.
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const cache = new Map();

function getCached(address) {
  const entry = cache.get(address);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    cache.delete(address);
    return null;
  }
  return entry.data;
}

function setCached(address, data) {
  cache.set(address, { data, timestamp: Date.now() });
}

async function rpcCall(method, params) {
  const res = await fetch(BASE_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
  });
  const data = await res.json();
  return data.result;
}

async function getTxCount(address) {
  const hex = await rpcCall('eth_getTransactionCount', [address, 'latest']);
  return parseInt(hex, 16);
}

async function getBalance(address) {
  const hex = await rpcCall('eth_getBalance', [address, 'latest']);
  return parseInt(hex, 16) / 1e18;
}

// Wallet age + distinct-contract-diversity signals, sourced from Blockscout's
// free Etherscan-compatible txlist endpoint. No API key required.
async function getTxHistory(address) {
  const url = `${BLOCKSCOUT_API}?module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&sort=asc`;
  const res = await fetch(url);
  const data = await res.json();
  return Array.isArray(data.result) ? data.result : [];
}

async function getAttestations(address) {
  const query = `
    query Attestations($recipient: String!) {
      attestations(where: { recipient: { equals: $recipient } }) {
        id
        schemaId
        attester
        time
        revoked
      }
    }
  `;
  const res = await fetch(EAS_GRAPHQL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables: { recipient: address } })
  });
  const data = await res.json();
  return data?.data?.attestations || [];
}

function scoreWallet({ txCount, balance, walletAgeDays, distinctContracts, attestations }) {
  const breakdown = {};

  breakdown.age = Math.min(25, Math.round((walletAgeDays / 365) * 25));
  breakdown.activity = Math.min(20, Math.round(Math.log10(txCount + 1) * 10));
  breakdown.contracts = Math.min(15, Math.round(Math.log10(distinctContracts + 1) * 12));
  breakdown.attestations = Math.min(25, attestations.filter(a => !a.revoked).length * 8);
  breakdown.balance = balance > 0 ? 5 : 0;
  breakdown.notEmpty = txCount > 0 ? 10 : 0;

  const total = Object.values(breakdown).reduce((a, b) => a + b, 0);
  return { score: Math.min(100, total), breakdown };
}

app.get('/score/:address', async (req, res) => {
  const address = req.params.address;
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return res.status(400).json({ error: 'Invalid address' });
  }

  const cached = getCached(address);
  if (cached) {
    return res.json({ ...cached, cached: true });
  }

  try {
    // Promise.allSettled instead of Promise.all: if EAS's GraphQL endpoint
    // or Blockscout has a bad moment, one flaky source shouldn't 500 the
    // whole score. Each signal degrades to a safe default independently,
    // same philosophy the original code already used for missing history.
    const [txCountResult, balanceResult, historyResult, attestationsResult] =
      await Promise.allSettled([
        getTxCount(address),
        getBalance(address),
        getTxHistory(address),
        getAttestations(address)
      ]);

    const txCount = txCountResult.status === 'fulfilled' ? txCountResult.value : 0;
    const balance = balanceResult.status === 'fulfilled' ? balanceResult.value : 0;
    const history = historyResult.status === 'fulfilled' ? historyResult.value : [];
    const attestations = attestationsResult.status === 'fulfilled' ? attestationsResult.value : [];

    let walletAgeDays = 0;
    let distinctContracts = 0;

    if (history.length > 0) {
      const firstTimestamp = parseInt(history[0].timeStamp, 10) * 1000;
      walletAgeDays = (Date.now() - firstTimestamp) / (1000 * 60 * 60 * 24);
      distinctContracts = new Set(history.map(tx => (tx.to || '').toLowerCase())).size;
    }

    const result = scoreWallet({ txCount, balance, walletAgeDays, distinctContracts, attestations });

    const payload = {
      address,
      score: result.score,
      breakdown: result.breakdown,
      raw: {
        txCount,
        balance,
        walletAgeDays: Math.round(walletAgeDays),
        distinctContracts,
        attestationCount: attestations.length
      }
    };

    setCached(address, payload);
    res.json(payload);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to score wallet' });
  }
});

app.get('/', (req, res) => res.send('BasePulse Trust API is running'));

app.listen(PORT, () => console.log(`BasePulse Trust API running on port ${PORT}`));
