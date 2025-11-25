import { promises as fs } from "fs";

export const updateHyperPredictV1PairAddress = async (
  filePath: string,
  address: string,
  networkName: string,
  logLabel = filePath
) => {
  try {
    const fileContent = await fs.readFile(filePath, "utf8");
    const pairRegex = new RegExp(
      `(HyperPredictV1Pair\\s*:\\s*{[\\s\\S]*?${networkName}\\s*:\\s*)(["'])[^"']*(\\2)`,
      "m"
    );
    const match = fileContent.match(pairRegex);
    if (!match) {
      console.warn(
        `Could not find HyperPredictV1Pair entry for ${networkName} in ${logLabel}`
      );
      return;
    }

    const updatedContent = fileContent.replace(
      pairRegex,
      (_, prefix: string, quote: string) => `${prefix}${quote}${address}${quote}`
    );

    if (updatedContent === fileContent) {
      console.log(
        `HyperPredictV1Pair.${networkName} already set to ${address} in ${logLabel}`
      );
      return;
    }

    await fs.writeFile(filePath, updatedContent);
    console.log(`Updated HyperPredictV1Pair.${networkName} to ${address} in ${logLabel}`);
  } catch (error) {
    console.warn(
      `Failed to update HyperPredictV1Pair.${networkName} in ${logLabel}:`,
      error
    );
  }
};
