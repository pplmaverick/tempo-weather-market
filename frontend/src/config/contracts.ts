export const CONTRACTS = {
  mainnet: '0x072a3a0c04cf8cdcaf5b4a73a4ed4ff5a841531f' as `0x${string}`,
  testnet: '0xcAC5B9d2817325E78090E3Ce4b9C299C819cF953' as `0x${string}`,
} as const

export const STABLECOINS = {
  mainnet: { symbol: 'USDCE', decimals: 6 },
  testnet: { symbol: 'pathUSD', decimals: 6 },
} as const

export const CITIES = [
  { name: 'Taipei',   marketId: 1n, code: 'taipei',  oracleCity: 'Taipei'   },
  { name: 'Tokyo',    marketId: 3n, code: 'tokyo',    oracleCity: 'Tokyo'    },
  { name: 'New York', marketId: 2n, code: 'new-york', oracleCity: 'New York' },
  { name: 'Seoul',    marketId: 4n, code: 'seoul',    oracleCity: 'Seoul'    },
] as const

export const BUCKET_LABELS = [
  '< 25°C',
  '25–28°C',
  '28–31°C',
  '31–34°C',
  '> 34°C',
]

export const BUCKET_BOUNDARIES = [250n, 280n, 310n, 340n] as const

export const MARKET_STATUS = { OPEN: 0, LOCKED: 1, SETTLED: 2 } as const

export const WEATHER_MARKET_ABI = [
  {
    name: 'getMarket',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'marketId', type: 'uint256' }],
    outputs: [
      { name: '', type: 'string' },    // [0] city
      { name: '', type: 'string' },    // [1] predictionType
      { name: '', type: 'uint256' },   // [2] targetDate
      { name: '', type: 'uint256' },   // [3] lockTime
      { name: '', type: 'uint8' },     // [4] status (0=OPEN 1=LOCKED 2=SETTLED)
      { name: '', type: 'uint256' },   // [5] totalPool
      { name: '', type: 'int256' },    // [6] finalTemp (x10, e.g. 300 = 30.0°C)
      { name: '', type: 'uint8' },     // [7] winningBucket
      { name: '', type: 'int256[]' },  // [8] buckets
      { name: '', type: 'bool' },      // [9] noWinner
      { name: '', type: 'string' },    // [10] settleMemo
    ],
  },
  {
    name: 'bucketTotals',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: '', type: 'uint256' },
      { name: '', type: 'uint8' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'bets',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: '', type: 'uint256' },
      { name: '', type: 'uint8' },
      { name: '', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'claimed',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: '', type: 'uint256' },
      { name: '', type: 'address' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'userTotalBets',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: '', type: 'uint256' },
      { name: '', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'stablecoin',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'placeBet',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'marketId', type: 'uint256' },
      { name: 'bucket', type: 'uint8' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'claimWinnings',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'marketId', type: 'uint256' }],
    outputs: [],
  },
] as const

export const ERC20_ABI = [
  {
    name: 'allowance',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const
