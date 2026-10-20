import { randomBytes } from "node:crypto";

function keyring(kid) {
  return JSON.stringify({ [kid]: randomBytes(32).toString("base64url") });
}

const capabilityKid = "gf-cap-v1";
const reconciliationKid = "gf-rec-v1";

const capabilityKeyring = keyring(capabilityKid);
const reconciliationKeyring = keyring(reconciliationKid);

process.stdout.write(`GROUP_FOCUS_CAPABILITY_KEYS_JSON='${capabilityKeyring}'\n`);
process.stdout.write(`GROUP_FOCUS_CAPABILITY_ACTIVE_KID=${capabilityKid}\n`);
process.stdout.write(`GROUP_FOCUS_RECONCILIATION_KEYS_JSON='${reconciliationKeyring}'\n`);
process.stdout.write(`GROUP_FOCUS_RECONCILIATION_ACTIVE_KID=${reconciliationKid}\n`);
