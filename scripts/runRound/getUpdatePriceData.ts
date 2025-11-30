import { HermesClient } from "@pythnetwork/hermes-client";
import { loadConfig } from "../lib/loadConfig";
import { fetchOracle } from "./fetchOracle";
import { withTimeout } from "./withTimeout";

const config = loadConfig();

const HERMES_URL = "https://hermes.pyth.network";
const PRICE_IDS = [config.priceId];
const PRICE_UPDATE_TIMEOUT_MS = 25_000;

export async function getUpdatePriceData(): Promise<string[]> {
  const client = new HermesClient(HERMES_URL);

  console.log("Fetching latest price updates from Hermes...");
  const now = Date.now() / 1000;
  const result = await withTimeout(
    client.getLatestPriceUpdates(PRICE_IDS),
    PRICE_UPDATE_TIMEOUT_MS,
    "Fetching latest price updates from Hermes timed out after 25s"
  );
  const spentTime = Math.round(Date.now() / 1000 - now);
  console.log(`Latest price updates fetched from Hermes in ${spentTime}s.`);

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
