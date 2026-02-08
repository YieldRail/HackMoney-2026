# Yieldo

A cross-chain yield vault aggregator with comprehensive risk scoring and one-tap deposits.

## Problem

Users face three core challenges when interacting with yield vaults:

1. **Chain Fragmentation**: Vaults exist on different chains, requiring users to bridge assets and switch networks manually
2. **Information Asymmetry**: No unified system to compare vaults across protocols using standardized metrics
3. **Trust Gaps**: Limited visibility into vault risk factors, performance history, and user behavior patterns

## Solution

Yieldo aggregates yield vaults across multiple chains and protocols, enabling:

- **Cross-chain deposits** from any chain to any vault via LI.FI contract calls
- **Unified comparison** using a composite scoring system based on capital, performance, risk, and user trust metrics
- **Risk transparency** through detailed metrics, flags, and historical analytics

## Architecture

### Frontend (`frontend/`)

Next.js 14 application with:
- **Wagmi/Viem** for blockchain interactions
- **RainbowKit** for wallet connections
- **LI.FI SDK** for cross-chain routing
- **ENS resolution** for human-readable referrer addresses

### Smart Contracts (`contracts/`)

**DepositRouter** - EIP-712 based deposit intent system

- Handles deposit intents with signature verification
- Supports both Lagoon and ERC4626 vault standards
- Implements referral fee distribution (50% to referrer, 50% to protocol)
- Fee: 10 basis points (0.1%)
- Reentrancy protection via OpenZeppelin's `ReentrancyGuard`

**EIP-712 Signature Structure:**
```
DepositIntent(
  address user,
  address vault,
  address asset,
  uint256 amount,
  uint256 nonce,
  uint256 deadline
)
```

### Indexer (`indexer/`)

Node.js service that:
- Indexes deposit/withdrawal events from vaults
- Calculates user analytics (retention, holding periods, farming detection)
- Updates MongoDB with transaction history and user behavior metrics

### Vault KPI (`vault-kpi/`)

Scoring engine that:
- Fetches vault data from protocol APIs (Morpho GraphQL, Lagoon subgraphs)
- Calculates composite scores based on:
  - **Capital** (20-25%): TVL, liquidity ratios, position counts
  - **Performance** (30-35%): APY metrics (daily, weekly, monthly, all-time)
  - **Risk** (30-40%): Depeg flags, fees, governance, warnings
  - **User Trust** (20%): Retention rates, holding periods, user behavior patterns
- Exposes REST API for frontend consumption

## Workflow

```
┌─────────────┐
│   User      │
│  (Wallet)   │
└──────┬──────┘
       │
       │ 1. Select vault + amount
       ▼
┌─────────────────┐
│   Frontend      │
│  (Next.js)      │
└──────┬──────────┘
       │
       │ 2. Check chain match
       ├─ Same Chain? ──┐
       │                 │
       │ Cross-Chain?    │
       ▼                 ▼
┌──────────────┐  ┌──────────────┐
│  LI.FI API   │  │  EIP-712    │
│  Get Quote   │  │  Signature  │
└──────┬───────┘  └──────┬──────┘
       │                 │
       │ 3. User signs   │ 3. User signs
       │    transaction │    typed data
       ▼                 ▼
┌─────────────────────────────────┐
│      LI.FI Contract Call         │
│  ┌─────────┐  ┌──────────────┐  │
│  │  Swap   │→ │    Bridge    │  │
│  │ (Src)   │  │  (Cross-Ch)  │  │
│  └─────────┘  └──────┬───────┘  │
└──────────────────────┼───────────┘
                       │
                       │ 4. Tokens arrive
                       ▼
            ┌──────────────────────┐
            │   DepositRouter      │
            │  (Smart Contract)    │
            └──────┬───────────────┘
                   │
                   │ 5. Verify signature
                   │ 6. Collect fee (0.1%)
                   │ 7. Forward to vault
                   ▼
            ┌──────────────────────┐
            │   Vault Contract       │
            │  (Lagoon/ERC4626)      │
            └──────┬─────────────────┘
                   │
                   │ 8. Emit events
                   ▼
            ┌──────────────────────┐
            │   Indexer Service     │
            │  (Event Listener)    │
            └──────────────────────┘
```

**Same-Chain Flow:**
1. User approves token spend
2. Frontend generates EIP-712 signature
3. DepositRouter verifies and executes deposit

**Cross-Chain Flow:**
1. Frontend requests LI.FI quote
2. User signs single transaction
3. LI.FI executes: Swap → Bridge → DepositRouter call
4. DepositRouter receives tokens and completes deposit

## Technical Integrations

### LI.FI

Cross-chain routing via contract calls. When user deposits from Chain A to vault on Chain B:

1. Frontend requests quote from LI.FI API
2. LI.FI returns transaction data including:
   - Swap contract call on source chain
   - Bridge contract call
   - Final deposit call to DepositRouter on destination chain
3. User signs single transaction
4. LI.FI executes multi-step flow atomically
5. Tokens arrive at DepositRouter on destination chain
6. DepositRouter completes vault deposit

### ENS

- Referrer addresses can be entered as ENS names (e.g., `vitalik.eth`)
- Frontend resolves ENS to address before submitting deposit
- Batch resolution for efficient ENS lookups
- ENS avatar display for better UX

### Rating System

Composite score calculation:

**Capital Score (20-25%)**
- TVL size and growth
- Liquidity ratios (for Morpho vaults)
- Position count and distribution

**Performance Score (30-35%)**
- Current APY vs historical averages
- Daily/weekly/monthly APY consistency
- Net APY (after fees)
- Rewards APR contribution

**Risk Score (30-40%)**
- Asset depeg detection
- Vault pause status
- Fee structure (management + performance)
- Governance parameters (timelock, guardian)
- Warning flags from protocol

**User Trust Score (20%)**
- Retention rate (users who stay >30 days)
- Average holding period
- Quick exit rate (farming detection)
- Long-term holder percentage

## Deployed Contracts

### DepositRouter

**Avalanche (43114)**
- `0x0f71f178E5fF53c0Dca2f02BE672750C1870C4DB`

**Ethereum (1)**
- `0xc4418Da01AD12130273d72aC7BC77aaEcf2Cc6C0`

**Base (8453)**
- `0xdE064d1D41e4d30B913b27f147E228fEe8fd31dc`

**Arbitrum (42161)**
- `0xC75e95201bC574299a3C849181469B5B3B20cc97`

## Integrated Vaults

### Lagoon Protocol
- **Turtle Avalanche USDC**: `0x3048925b3ea5a8c12eecccb8810f5f7544db54af` (Avalanche)
- **9Summits Flagship USDC**: `0x03d1ec0d01b659b89a87eabb56e4af5cb6e14bfc` (Ethereum)

### Morpho Protocol
- **Spark USDC Vault**: `0x7BfA7C4f149E7415b73bdeDfe609237e29CBF34A` (Base)
- **Steakhouse USDC**: `0xBEEF01735c132Ada46AA9aA4c54623cAA92A64CB` (Ethereum)
- **Gauntlet USDC Frontier**: `0xc582F04d8a82795aa2Ff9c8bb4c1c889fe7b754e` (Ethereum)
- **Steakhouse Prime USDC**: `0xBEEFE94c8aD530842bfE7d8B397938fFc1cb83b2` (Base)
- **Hyperithm USDC**: `0x4B6F1C9E5d470b97181786b26da0d0945A7cf027` (Arbitrum)

## Development

### Prerequisites
- Node.js 18+
- Hardhat for contract development
- MongoDB for indexer data
- Environment variables (see `.env.example`)

### Setup

```bash
# Install dependencies
cd frontend && npm install
cd ../contracts && npm install
cd ../indexer && npm install
cd ../vault-kpi && npm install

# Deploy contracts (configure networks in hardhat.config.js)
cd contracts
npx hardhat run scripts/deploy.js --network <network>

# Start indexer
cd indexer
npm start

# Start frontend
cd frontend
npm run dev
```

## Future Roadmap

- Multi-vault position management dashboard
- Advanced filtering and sorting by score components
- Real-time APY tracking and alerts
- Historical performance charts
- Gas optimization for cross-chain flows
- Additional protocol integrations (Aave, Compound, etc.)
- Mobile app for on-the-go deposits


