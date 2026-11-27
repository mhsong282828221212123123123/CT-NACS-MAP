import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(__dirname, '..', '..');
export const NACS_JSON_PATH = path.join(ROOT_DIR, 'public', 'data', 'nacs.json');
export const NUM_OF_ROWS = 9999;

/**
 * Loads `.env` and `.env.local` if present so local runs work without extra deps.
 */
export async function loadEnvFiles() {
  for (const filename of ['.env', '.env.local']) {
    const filePath = path.join(ROOT_DIR, filename);
    try {
      const content = await fs.readFile(filePath, 'utf8');
      for (const rawLine of content.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const eqIdx = line.indexOf('=');
        if (eqIdx === -1) continue;
        const key = line.slice(0, eqIdx).trim();
        let val = line.slice(eqIdx + 1).trim();
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.slice(1, -1);
        }
        if (!(key in process.env) || !process.env[key]) {
          process.env[key] = val;
        }
      }
    } catch {
      // File absent, skip silently.
    }
  }
}

export function normalizeText(value) {
  if (value === null || value === undefined) return '';
  const str = String(value).trim();
  return str === 'null' ? '' : str;
}

function sanitizeApiKey(rawKey) {
  let cleaned = String(rawKey ?? '').trim();
  if (
    (cleaned.startsWith('"') && cleaned.endsWith('"')) ||
    (cleaned.startsWith("'") && cleaned.endsWith("'"))
  ) {
    cleaned = cleaned.slice(1, -1).trim();
  }
  if (/^serviceKey=/i.test(cleaned)) {
    cleaned = cleaned.slice('serviceKey='.length);
  }
  return cleaned.replace(/\s+/g, '');
}

function decodeURIComponentSafe(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function buildKeyCandidates(rawKey) {
  const cleaned = sanitizeApiKey(rawKey);
  const list = [];
  const pushUnique = (val) => {
    if (val && !list.includes(val)) list.push(val);
  };

  if (cleaned.includes('%')) {
    pushUnique(cleaned);
    pushUnique(encodeURIComponent(decodeURIComponentSafe(cleaned)));
    pushUnique(decodeURIComponentSafe(cleaned));
  } else {
    pushUnique(encodeURIComponent(cleaned));
    pushUnique(cleaned);
  }

  return list;
}

/**
 * Returns non-secret metadata only (never logs any characters of the key).
 */
function describeApiKeySafely(rawKey, cleaned) {
  const raw = String(rawKey ?? '');
  return {
    rawLength: raw.length,
    length: cleaned.length,
    isHex: /^[0-9a-f]+$/i.test(cleaned),
    hasPercent: cleaned.includes('%'),
    hasPlusSlash: /[+/]/.test(cleaned),
    hasEquals: cleaned.includes('='),
    hadWhitespace: /\s/.test(raw),
    hadQuotes: /^["']|["']$/.test(raw.trim()),
    startsWithHttp: /^https?:\/\//i.test(cleaned),
  };
}

function buildApiUrl(endpoint, encodedServiceKey, pageNo, extraParams = {}) {
  const params = new URLSearchParams({
    pageNo: String(pageNo),
    numOfRows: String(NUM_OF_ROWS),
    dataType: 'JSON',
    ...extraParams,
  });
  return `${endpoint}?serviceKey=${encodedServiceKey}&${params.toString()}`;
}

async function requestSinglePage(endpoint, encodedKey, pageNo, extraParams, maxRetries) {
  const url = buildApiUrl(endpoint, encodedKey, pageNo, extraParams);
  let lastErr;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'CT-NACS-MAP/1.0',
        },
        signal: AbortSignal.timeout(30000),
      });

      const text = await res.text();
      if (!res.ok) {
        const snippet = text.slice(0, 300).replace(/\s+/g, ' ');
        const err = new Error(
          `HTTP ${res.status} ${res.statusText}${snippet ? ` - ${snippet}` : ''}`,
        );
        err.status = res.status;
        err.noRetry = res.status === 401 || res.status === 403;
        throw err;
      }

      let data;
      try {
        data = JSON.parse(text);
      } catch {
        const snippet = text.slice(0, 240).replace(/\s+/g, ' ');
        throw new Error(`Non-JSON API response: ${snippet}`);
      }

      if (data.resultCode && data.resultCode !== '00') {
        throw new Error(`API error ${data.resultCode}: ${data.resultMsg ?? 'Unknown error'}`);
      }

      const itemsRaw = data.items?.item ?? [];
      const items = Array.isArray(itemsRaw) ? itemsRaw : itemsRaw ? [itemsRaw] : [];
      const totalCount = Number(data.totalCount ?? 0);

      return { items, totalCount };
    } catch (err) {
      lastErr = err;
      if (err?.noRetry || attempt >= maxRetries) {
        break;
      }
      await new Promise((r) => setTimeout(r, 800 * attempt));
    }
  }

  throw lastErr;
}

export async function fetchEvChargerPage(
  endpoint,
  rawKey,
  pageNo,
  extraParams = {},
  maxRetries = 3,
) {
  const cleaned = sanitizeApiKey(rawKey);
  const candidates = buildKeyCandidates(rawKey);
  let lastErr;

  for (const candidateKey of candidates) {
    try {
      return await requestSinglePage(endpoint, candidateKey, pageNo, extraParams, maxRetries);
    } catch (err) {
      lastErr = err;
      const isKeyRegErr =
        err?.status === 403 && String(err.message).includes('SERVICE_KEY_IS_NOT_REGISTERED_ERROR');
      if (!isKeyRegErr) {
        break;
      }
    }
  }

  if (
    lastErr?.status === 403 &&
    String(lastErr.message).includes('SERVICE_KEY_IS_NOT_REGISTERED_ERROR')
  ) {
    console.error('키 진단 메타데이터(값 비공개):', JSON.stringify(describeApiKeySafely(rawKey, cleaned)));
  }

  throw new Error(`Page ${pageNo} failed: ${lastErr?.message}`);
}
