import db from "../db.server";

const MATCHING_ENABLED_KEY = "matching_enabled";

export async function isMatchingEnabled() {
  const setting = await db.appSetting.findUnique({ where: { key: MATCHING_ENABLED_KEY } });
  return setting?.value !== "false";
}

export async function setMatchingEnabled(enabled) {
  await db.appSetting.upsert({
    where: { key: MATCHING_ENABLED_KEY },
    update: { value: String(enabled) },
    create: { key: MATCHING_ENABLED_KEY, value: String(enabled) },
  });
}
