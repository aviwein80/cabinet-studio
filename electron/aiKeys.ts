/**
 * Vision-provider API keys, kept on this computer only: a separate file outside the shop data
 * folder (so backups and exports never carry them), encrypted with the OS keychain through
 * Electron safeStorage when it is available. Calls are made here, so keys never reach the page.
 */
import { app, safeStorage } from "electron";
import fs from "node:fs";
import path from "node:path";
import {
  AI_PROVIDERS,
  type AiCall,
  type AiProviderId,
  callProvider,
} from "../src/core/hardware/aiProviders";

type Stored = Partial<Record<AiProviderId, { enc: boolean; v: string }>>;

const file = () =>
  path.join(app.getPath("userData"), "secrets", "ai-keys.json");

function read(): Stored {
  try {
    return JSON.parse(fs.readFileSync(file(), "utf8")) as Stored;
  } catch {
    return {};
  }
}

function write(s: Stored) {
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  const tmp = `${file()}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(s), { mode: 0o600 });
  fs.renameSync(tmp, file());
}

function keyOf(id: AiProviderId): string {
  const e = read()[id];
  if (!e) return "";
  return e.enc ? safeStorage.decryptString(Buffer.from(e.v, "base64")) : e.v;
}

export function aiKeyStatus() {
  const s = read();
  return Object.fromEntries(
    AI_PROVIDERS.map((p) => [
      p.id,
      {
        saved: !!s[p.id],
        where: s[p.id]?.enc
          ? "this computer (encrypted by the system keychain)"
          : "this computer (not encrypted: no system keychain available)",
      },
    ]),
  );
}

export function aiSetKey(id: AiProviderId, key: string | null) {
  if (!AI_PROVIDERS.some((p) => p.id === id))
    throw new Error("Unknown provider");
  const s = read();
  if (key?.trim()) {
    const enc = safeStorage.isEncryptionAvailable();
    s[id] = {
      enc,
      v: enc
        ? safeStorage.encryptString(key.trim()).toString("base64")
        : key.trim(),
    };
  } else delete s[id];
  write(s);
  return aiKeyStatus();
}

export function aiCall(call: AiCall) {
  return callProvider(call, keyOf(call.provider));
}
