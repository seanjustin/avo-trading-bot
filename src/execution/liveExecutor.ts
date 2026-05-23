import fs from 'fs';
import axios from 'axios';
import { Connection, Keypair, VersionedTransaction } from '@solana/web3.js';

import { Config } from '../config';
import { JUPITER_QUOTE_URL } from '../config/constants';
import { JupiterQuoteResponse } from '../quotes/types';
import { StrategySignal } from '../strategy/avoRouteMonitor';
import { getLogger } from '../telemetry/logger';

const JUPITER_SWAP_URL = `${JUPITER_QUOTE_URL.replace('/quote', '')}/swap`;

interface JupiterSwapResponse {
  swapTransaction: string; // base64-encoded versioned transaction
}

export class LiveExecutor {
  private keypair: Keypair;
  private connection: Connection;

  constructor(private config: Config) {
    this.keypair   = loadKeypair(config.SOLANA_KEYPAIR_PATH);
    this.connection = new Connection(config.SOLANA_RPC_URL, 'confirmed');
  }

  async execute(signal: StrategySignal): Promise<string> {
    const { selectedQuote: q } = signal.decision;

    if (q.venue !== 'jupiter') {
      throw new Error(
        `Live execution only supports Jupiter quotes — got venue="${q.venue}". ` +
        'Orca live swaps are not yet implemented.'
      );
    }

    const quoteResponse = q.rawQuote as JupiterQuoteResponse;

    const swapResp = await axios.post<JupiterSwapResponse>(
      JUPITER_SWAP_URL,
      {
        quoteResponse,
        userPublicKey:            this.keypair.publicKey.toBase58(),
        dynamicComputeUnitLimit:  true,
        dynamicSlippage:          { maxBps: this.config.MAX_SLIPPAGE_BPS },
        prioritizationFeeLamports: 'auto',
      },
      { timeout: 10_000 }
    );

    const txBytes = Buffer.from(swapResp.data.swapTransaction, 'base64');
    const tx = VersionedTransaction.deserialize(txBytes);
    tx.sign([this.keypair]);

    const sig = await this.connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: false,
      maxRetries:    2,
    });

    const confirmation = await this.connection.confirmTransaction(sig, 'confirmed');
    if (confirmation.value.err) {
      throw new Error(`Transaction ${sig} failed on-chain: ${JSON.stringify(confirmation.value.err)}`);
    }

    getLogger().info(
      {
        sig,
        venue:         q.venue,
        outputUsdc:    (Number(q.expectedOutputAmount) / 1e6).toFixed(4),
        effectivePrice: q.effectivePrice.toFixed(6),
        service:       'live-executor',
      },
      'Live fill confirmed'
    );

    return sig;
  }
}

function loadKeypair(path: string): Keypair {
  let raw: string;
  try {
    raw = fs.readFileSync(path, 'utf8');
  } catch (err) {
    throw new Error(
      `Failed to load keypair from "${path}": ${(err as Error).message}. ` +
      'Set SOLANA_KEYPAIR_PATH in your .env file.'
    );
  }

  let bytes: number[];
  try {
    bytes = JSON.parse(raw) as number[];
  } catch {
    throw new Error(`Keypair file at "${path}" is not valid JSON.`);
  }

  return Keypair.fromSecretKey(Uint8Array.from(bytes));
}
