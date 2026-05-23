import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import {
  WhirlpoolContext,
  buildWhirlpoolClient,
  ORCA_WHIRLPOOL_PROGRAM_ID,
  swapQuoteByInputToken,
  PDAUtil,
} from '@orca-so/whirlpools-sdk';
import { AnchorProvider, Wallet } from '@coral-xyz/anchor';
import { Percentage } from '@orca-so/common-sdk';
import BN from 'bn.js';
import axios from 'axios';

import { Config } from '../config';
import { AVO_MINT, USDC_MINT } from '../config/constants';
import { OrcaRawQuote } from '../quotes/types';
import { getLogger } from '../telemetry/logger';

// Mainnet Orca Whirlpools global config
const ORCA_WHIRLPOOLS_CONFIG = new PublicKey('2LecshUwdy9xi7meFgHtFJQNSKk4KdTrcpvaB56dP2NQ');
// Common tick spacings to probe when pool address is unknown
const TICK_SPACINGS = [8, 64, 128, 1];

export class OrcaScanner {
  private ctx: WhirlpoolContext;
  private config: Config;
  /** Cached pool address once discovered */
  private resolvedPoolAddress: string | null = null;

  constructor(config: Config) {
    this.config = config;
    const connection = new Connection(config.SOLANA_RPC_URL, 'confirmed');
    // Read-only context — ephemeral keypair, never signs anything
    const wallet = new Wallet(Keypair.generate());
    const provider = new AnchorProvider(connection, wallet, { commitment: 'confirmed' });
    this.ctx = WhirlpoolContext.withProvider(provider, ORCA_WHIRLPOOL_PROGRAM_ID);
  }

  async getQuote(inputAmountLamports: number): Promise<OrcaRawQuote | null> {
    const poolAddr = await this.resolvePool();
    if (!poolAddr) {
      getLogger().warn({ venue: 'orca' }, 'No AVO/USDC Orca Whirlpool found — skipping');
      return null;
    }

    try {
      const client = buildWhirlpoolClient(this.ctx);
      const pool   = await client.getPool(new PublicKey(poolAddr));

      const slippage = Percentage.fromFraction(
        new BN(this.config.MAX_SLIPPAGE_BPS),
        new BN(10_000)
      );

      const sdkQuote = await swapQuoteByInputToken(
        pool,
        new PublicKey(AVO_MINT),
        new BN(inputAmountLamports),
        slippage,
        ORCA_WHIRLPOOL_PROGRAM_ID,
        this.ctx.fetcher
      );

      // Price impact: (1 - outAmount/inAmount / spotPrice) * 100
      // Approximate with fee-adjusted ratio versus spot (sqrtPrice derived)
      const priceImpactPct = estimatePriceImpact(
        sdkQuote.estimatedAmountIn,
        sdkQuote.estimatedAmountOut,
        sdkQuote.estimatedFeeAmount
      );

      const raw: OrcaRawQuote = {
        estimatedAmountIn:  sdkQuote.estimatedAmountIn.toString(),
        estimatedAmountOut: sdkQuote.estimatedAmountOut.toString(),
        estimatedFeeAmount: sdkQuote.estimatedFeeAmount.toString(),
        priceImpactPct:     priceImpactPct.toFixed(4),
        aToB:               sdkQuote.aToB,
        amountSpecifiedIsInput: sdkQuote.amountSpecifiedIsInput,
        poolAddress:        poolAddr,
        inputMint:          AVO_MINT,
        outputMint:         USDC_MINT,
      };

      getLogger().debug(
        {
          venue:      'orca',
          pool:       poolAddr,
          outAmount:  raw.estimatedAmountOut,
          priceImpact: raw.priceImpactPct,
        },
        'Orca quote received'
      );

      return raw;
    } catch (err) {
      getLogger().warn({ err, venue: 'orca', pool: poolAddr }, 'Orca quote failed');
      return null;
    }
  }

  // ── Pool resolution (cached) ────────────────────────────────────────────────

  private async resolvePool(): Promise<string | null> {
    if (this.resolvedPoolAddress) return this.resolvedPoolAddress;

    // 1. Try Orca REST API (most reliable)
    const fromApi = await this.discoverViaApi();
    if (fromApi) {
      this.resolvedPoolAddress = fromApi;
      getLogger().info({ pool: fromApi, method: 'orca-api' }, 'AVO/USDC Orca pool discovered');
      return fromApi;
    }

    // 2. Derive PDAs for common tick spacings and probe on-chain
    const fromPda = await this.discoverViaPda();
    if (fromPda) {
      this.resolvedPoolAddress = fromPda;
      getLogger().info({ pool: fromPda, method: 'pda-probe' }, 'AVO/USDC Orca pool found via PDA');
      return fromPda;
    }

    return null;
  }

  private async discoverViaApi(): Promise<string | null> {
    try {
      const resp = await axios.get<{
        whirlpools: Array<{ address: string; tokenA: { mint: string }; tokenB: { mint: string } }>;
      }>('https://api.mainnet.orca.so/v1/whirlpool/list', { timeout: 6_000 });

      const pools = resp.data.whirlpools ?? [];
      const match = pools.find(
        (p) =>
          (p.tokenA.mint === AVO_MINT && p.tokenB.mint === USDC_MINT) ||
          (p.tokenB.mint === AVO_MINT && p.tokenA.mint === USDC_MINT)
      );
      return match?.address ?? null;
    } catch {
      return null;
    }
  }

  private async discoverViaPda(): Promise<string | null> {
    const avoKey  = new PublicKey(AVO_MINT);
    const usdcKey = new PublicKey(USDC_MINT);

    // Whirlpool PDA requires mints in sorted order
    const [mintA, mintB] =
      avoKey.toBuffer().compare(usdcKey.toBuffer()) < 0
        ? [avoKey, usdcKey]
        : [usdcKey, avoKey];

    for (const tickSpacing of TICK_SPACINGS) {
      try {
        const pda = PDAUtil.getWhirlpool(
          ORCA_WHIRLPOOL_PROGRAM_ID,
          ORCA_WHIRLPOOLS_CONFIG,
          mintA,
          mintB,
          tickSpacing
        );
        const info = await this.ctx.provider.connection.getAccountInfo(pda.publicKey);
        if (info) return pda.publicKey.toBase58();
      } catch {
        // not found at this tick spacing — try next
      }
    }
    return null;
  }
}

/**
 * Rough price impact estimate using fee-adjusted ratio.
 * Returns a percentage (e.g. 0.019 = 0.019%).
 */
function estimatePriceImpact(amountIn: BN, amountOut: BN, fee: BN): number {
  if (amountIn.isZero()) return 0;
  const grossOut = amountOut.add(fee);
  const impact = 1 - grossOut.toNumber() / amountIn.toNumber();
  return Math.max(0, impact * 100);
}
