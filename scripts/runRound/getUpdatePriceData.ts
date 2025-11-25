import { HermesClient } from "@pythnetwork/hermes-client";
import { loadConfig } from "../lib/loadConfig";
import { fetchOracle } from "./fetchOracle";

const config = loadConfig();

const HERMES_URL = "https://hermes.pyth.network";
const PRICE_IDS = [config.priceId];

export async function getUpdatePriceData(): Promise<string[]> {
  const client = new HermesClient(HERMES_URL);

  const result = await client.getLatestPriceUpdates(PRICE_IDS);

  if (!result.binary || !Array.isArray(result.binary.data)) {
    throw new Error("Hermes response missing binary.data");
  }

  return result.binary.data.map((d: string) =>
    d.startsWith("0x") ? d : `0x${d}`
  );
}

export async function updatePriceData() {
  const now = Date.now() / 1000;
  console.log(`Updating price data at time: ${now}...`);
  const { Oracle: pyth } = await fetchOracle();
  const priceUpdateData = await getUpdatePriceData();
  const fee = pyth.getUpdateFee(priceUpdateData);
  const tx = await pyth.updatePriceFeeds(priceUpdateData, { value: fee });
  await tx.wait();
  const spentTime = Math.round(Date.now() / 1000 - now);
  console.log(`Price data updated in ${spentTime}s`);
}
