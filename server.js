import express from 'express';

const app = express();
const PORT = process.env.PORT || 3000;

const BASE_RPC = 'https://mainnet.base.org';
const EAS_GRAPHQL = 'https://base.easscan.org/graphql';
const ETHERSCAN_API = 'https://api.etherscan.io/v2/api';
const ETHERSCAN_KEY = process.env.ETHERSCAN_API_KEY || '';

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

// Optional: needs a free Etherscan API key (no cost, just signup at etherscan.io)
// Without it, walletAgeDays and distinctContracts default to 0 — app still works.
async function getTxHistory(address) {
  if (!ETHERSCAN_KEY) return null;
  const url = `${ETHERSCAN_API}?chainid=8453&module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&sort=asc&apikey=${ETHERSCAN_KEY}`;
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

  try {
    const [txCount, balance, history, attestations] = await Promise.all([
      getTxCount(address),
      getBalance(address),
      getTxHistory(address),
      getAttestations(address)
    ]);

    let walletAgeDays = 0;
    let distinctContracts = 0;

    if (history && history.length > 0) {
      const firstTimestamp = parseInt(history[0].timeStamp, 10) * 1000;
      walletAgeDays = (Date.now() - firstTimestamp) / (1000 * 60 * 60 * 24);
      distinctContracts = new Set(history.map(tx => (tx.to || '').toLowerCase())).size;
    }

    const result = scoreWallet({ txCount, balance, walletAgeDays, distinctContracts, attestations });

    res.json({
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
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to score wallet' });
  }
});

app.get('/', (req, res) => res.send('BasePulse Trust API is running'));

app.listen(PORT, () => console.log(`BasePulse Trust API running on port ${PORT}`));
