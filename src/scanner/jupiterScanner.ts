import axios from 'axios';
import { Config } from '../config';
import { AVO_MINT, JUPITER_QUOTE_URL } from '../config/constants';
import { JupiterQuoteResponse } from '../quotes/types';
import { getLogger } from '../telemetry/logger';

const MAX_RETRIES    = 2;
const RETRY_DELAY_MS = 400;

export class JupiterScanner {
  constructor(private config: Config) {}

  async getQuote(inputAmountLamports: number): Promise<JupiterQuoteResponse | null> {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const resp = await axios.get<JupiterQuoteResponse>(JUPITER_QUOTE_URL, {
          params: {
            inputMint:   AVO_MINT,
            outputMint:  this.config.USDC_MINT,
            amount:      inputAmountLamports,
            slippageBps: this.config.MAX_SLIPPAGE_BPS,
            onlyDirectRoutes: false,
            maxAccounts: 64,
          },
          timeout: 8_000,
        });

        const quote = resp.data;

        if (quote.inputMint !== AVO_MINT) {
          getLogger().warn({ inputMint: quote.inputMint, venue: 'jupiter' }, 'Jupiter returned wrong inputMint');
          return null;
        }

        return quote;
      } catch (err) {
        if (axios.isAxiosError(err) && err.response?.status === 400) {
          // 400 = no route found — don't retry
          getLogger().debug({ venue: 'jupiter' }, 'No Jupiter route available');
          return null;
        }

        if (attempt < MAX_RETRIES) {
          await sleep(RETRY_DELAY_MS);
        } else {
          getLogger().warn({ err, venue: 'jupiter', attempt }, 'Jupiter quote failed after retries');
          throw err;
        }
      }
    }
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
