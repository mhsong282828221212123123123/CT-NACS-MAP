const INFO_ENDPOINT = 'https://apis.data.go.kr/B552584/EvCharger/getChargerInfo';
const STATUS_ENDPOINT = 'https://apis.data.go.kr/B552584/EvCharger/getChargerStatus';

const KV_SNAPSHOT_KEY = 'status_snapshot';
const KV_MASTER_INDEX_KEY = 'master_index';

const MASTER_TTL_MS = 6 * 60 * 60 * 1000;
const BATCH_SIZE = 25;
const BATCH_CONCURRENCY = 4;
const MAX_STATUS_PAGES = 5;
const PERIOD_MINUTES = '10';
const NUM_OF_ROWS = 9999;
const STATION_CACHE_TTL_SECONDS = 30;

function normalizeText(value) {
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
          'User-Agent': 'CT-NACS-MAP-Worker/1.0',
        },
        signal: AbortSignal.timeout(22000),
      });

      const text = await res.text();
      if (!res.ok) {
        const snippet = text.slice(0, 200).replace(/\s+/g, ' ');
        const err = new Error(
          `HTTP ${res.status} ${res.statusText}${snippet ? ` - ${snippet}` : ''}`,
        );
        err.status = res.status;
        err.noRetry = res.status === 401 || res.status === 403;
        throw err;
      }

      const data = JSON.parse(text);
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
      await new Promise((r) => setTimeout(r, 400 * attempt));
    }
  }

  throw lastErr;
}

async function fetchEvChargerPage(endpoint, rawKey, pageNo, extraParams = {}, maxRetries = 2) {
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

  throw new Error(`Page ${pageNo} failed: ${lastErr?.message ?? 'Unknown error'}`);
}

function getCorsHeaders(request, env) {
  const origin = request.headers.get('Origin') ?? '';
  const allowedOrigin = (env.ALLOWED_ORIGIN ?? '').trim();
  const isLocal = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
  const matched =
    origin && ((allowedOrigin && origin === allowedOrigin) || isLocal) ? origin : '';

  const headers = {
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  };
  if (matched) {
    headers['Access-Control-Allow-Origin'] = matched;
  }
  return headers;
}

function jsonResponse(payload, status, request, env, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...getCorsHeaders(request, env),
      ...extraHeaders,
    },
  });
}

function extractChargerState(item) {
  return {
    stat: normalizeText(item.stat) || '0',
    statUpdDt: normalizeText(item.statUpdDt),
    lastTsdt: normalizeText(item.lastTsdt),
    lastTedt: normalizeText(item.lastTedt),
    nowTsdt: normalizeText(item.nowTsdt),
  };
}

function pickNewerText(a, b) {
  if (a && b) return a >= b ? a : b;
  return a || b || '';
}

function mergeChargerRecords(prev, incoming) {
  if (!prev) return incoming;
  if (!incoming) return prev;
  const prevUpd = prev.statUpdDt || '';
  const nextUpd = incoming.statUpdDt || '';
  const keepPrev = Boolean(prevUpd && nextUpd && nextUpd < prevUpd);
  const winningStat = keepPrev ? prev.stat : incoming.stat || prev.stat || '0';
  const winningUpd = keepPrev ? prevUpd : nextUpd || prevUpd;
  const nowTsdt = winningStat === '3' ? pickNewerText(prev.nowTsdt, incoming.nowTsdt) : '';
  return {
    stat: winningStat,
    statUpdDt: winningUpd,
    lastTsdt: pickNewerText(prev.lastTsdt, incoming.lastTsdt),
    lastTedt: pickNewerText(prev.lastTedt, incoming.lastTedt),
    nowTsdt,
  };
}

function recomputeStationCounts(stationEntry) {
  let availableCount = 0;
  let chargingCount = 0;
  for (const ch of Object.values(stationEntry.chargers ?? {})) {
    if (ch?.stat === '2') availableCount += 1;
    if (ch?.stat === '3') chargingCount += 1;
  }
  stationEntry.availableCount = availableCount;
  stationEntry.chargingCount = chargingCount;
}

async function getMasterIndex(env) {
  const cached = await env.STATUS_KV.get(KV_MASTER_INDEX_KEY, { type: 'json' });
  const cachedTs = cached?.updatedAt ? Date.parse(cached.updatedAt) : Number.NaN;
  if (
    cached &&
    Array.isArray(cached.statIds) &&
    cached.statIds.length > 0 &&
    Number.isFinite(cachedTs) &&
    Date.now() - cachedTs < MASTER_TTL_MS
  ) {
    return cached;
  }

  const masterUrl = (env.MASTER_JSON_URL ?? '').trim();
  if (!masterUrl) {
    return cached ?? { updatedAt: new Date().toISOString(), statIds: [], seedStations: {} };
  }

  const sep = masterUrl.includes('?') ? '&' : '?';
  const res = await fetch(`${masterUrl}${sep}t=${Date.now()}`, {
    headers: { Accept: 'application/json', 'User-Agent': 'CT-NACS-MAP-Worker/1.0' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    if (cached) return cached;
    throw new Error(`Master JSON fetch failed: HTTP ${res.status}`);
  }

  const data = await res.json();
  const statIds = [];
  const seedStations = {};

  for (const st of data.stations ?? []) {
    if (st.hasLiveStatus === false || !st.statId) continue;
    const statId = normalizeText(st.statId);
    if (!statId) continue;
    statIds.push(statId);

    const chargers = {};
    for (const ch of st.chargers ?? []) {
      const chgerId = normalizeText(ch.chgerId);
      if (!chgerId) continue;
      chargers[chgerId] = extractChargerState(ch);
    }

    const entry = {
      availableCount: 0,
      chargingCount: 0,
      chargers,
    };
    recomputeStationCounts(entry);
    seedStations[statId] = entry;
  }

  const nextIndex = {
    updatedAt: new Date().toISOString(),
    statIds,
    seedStations,
  };
  await env.STATUS_KV.put(KV_MASTER_INDEX_KEY, JSON.stringify(nextIndex));
  return nextIndex;
}

async function runSync(env) {
  const apiKey = (env.DATA_GO_KR_API_KEY ?? '').trim();
  if (!apiKey) {
    return { ok: false, configured: false };
  }

  const masterIndex = await getMasterIndex(env);
  const existing = await env.STATUS_KV.get(KV_SNAPSHOT_KEY, { type: 'json' });

  const stations = {};
  for (const statId of masterIndex.statIds) {
    const seed = masterIndex.seedStations?.[statId] ?? { chargers: {} };
    const prev = existing?.stations?.[statId];
    const chargers = {};

    const allChgerIds = new Set([
      ...Object.keys(seed.chargers ?? {}),
      ...Object.keys(prev?.chargers ?? {}),
    ]);
    for (const chgerId of allChgerIds) {
      chargers[chgerId] = prev?.chargers?.[chgerId] ?? seed.chargers?.[chgerId];
    }

    stations[statId] = {
      availableCount: 0,
      chargingCount: 0,
      chargers,
    };
  }

  let periodMatched = 0;
  const applyPeriodItems = (items) => {
    for (const item of items) {
      const statId = normalizeText(item.statId);
      const chgerId = normalizeText(item.chgerId);
      if (!statId || !chgerId || !stations[statId]) continue;
      const prev = stations[statId].chargers[chgerId];
      if (!prev) continue;

      const nextStat = normalizeText(item.stat) || '0';
      const nextUpd = normalizeText(item.statUpdDt);
      stations[statId].chargers[chgerId] = mergeChargerRecords(prev, {
        stat: nextStat,
        statUpdDt: nextUpd,
        lastTsdt: '',
        lastTedt: '',
        nowTsdt: '',
      });
      periodMatched += 1;
    }
  };

  try {
    const firstPage = await fetchEvChargerPage(
      STATUS_ENDPOINT,
      apiKey,
      1,
      { period: PERIOD_MINUTES },
      2,
    );
    applyPeriodItems(firstPage.items);

    const totalPages = Math.min(
      MAX_STATUS_PAGES,
      Math.max(1, Math.ceil(firstPage.totalCount / NUM_OF_ROWS)),
    );
    if (totalPages > 1) {
      const pageNumbers = Array.from({ length: totalPages - 1 }, (_, i) => i + 2);
      const pageResults = await Promise.allSettled(
        pageNumbers.map((pageNo) =>
          fetchEvChargerPage(STATUS_ENDPOINT, apiKey, pageNo, { period: PERIOD_MINUTES }, 1),
        ),
      );
      for (const res of pageResults) {
        if (res.status === 'fulfilled') {
          applyPeriodItems(res.value.items);
        } else {
          console.warn('period page warning:', res.reason?.message ?? res.reason);
        }
      }
    }
  } catch (err) {
    console.warn('period sync warning:', err?.message ?? err);
  }

  let batchSucceeded = 0;
  let nextCursor = 0;
  if (masterIndex.statIds.length > 0) {
    const total = masterIndex.statIds.length;
    const startCursor = Number.isInteger(existing?.batchCursor) ? existing.batchCursor % total : 0;
    const count = Math.min(BATCH_SIZE, total);
    const batch = [];
    for (let i = 0; i < count; i++) {
      batch.push(masterIndex.statIds[(startCursor + i) % total]);
    }
    nextCursor = (startCursor + count) % total;

    let idx = 0;
    const workers = Array.from({ length: Math.min(BATCH_CONCURRENCY, batch.length) }, async () => {
      while (idx < batch.length) {
        const statId = batch[idx++];
        try {
          const page = await fetchEvChargerPage(
            INFO_ENDPOINT,
            apiKey,
            1,
            { statId, numOfRows: '100' },
            1,
          );
          for (const item of page.items) {
            if (normalizeText(item.statId) !== statId) continue;
            const chgerId = normalizeText(item.chgerId);
            const prev = stations[statId].chargers[chgerId];
            if (!chgerId || !prev) continue;
            const nextState = extractChargerState(item);
            stations[statId].chargers[chgerId] = mergeChargerRecords(prev, nextState);
          }
          batchSucceeded += 1;
        } catch (err) {
          console.warn(`batch statId ${statId} failed:`, err?.message ?? err);
        }
      }
    });
    await Promise.all(workers);
  }

  for (const stationEntry of Object.values(stations)) {
    recomputeStationCounts(stationEntry);
  }

  const snapshot = {
    ok: true,
    updatedAt: new Date().toISOString(),
    stationCount: masterIndex.statIds.length,
    batchCursor: nextCursor,
    periodMatched,
    batchSucceeded,
    stations,
  };

  await env.STATUS_KV.put(KV_SNAPSHOT_KEY, JSON.stringify(snapshot));
  return snapshot;
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: getCorsHeaders(request, env) });
    }

    if (request.method !== 'GET') {
      return jsonResponse({ ok: false, error: 'Method Not Allowed' }, 405, request, env);
    }

    try {
      const url = new URL(request.url);
      const apiKey = (env.DATA_GO_KR_API_KEY ?? '').trim();

      if (url.pathname === '/' || url.pathname === '/health') {
        const snapshot = env.STATUS_KV
          ? await env.STATUS_KV.get(KV_SNAPSHOT_KEY, { type: 'json' }).catch(() => null)
          : null;
        return jsonResponse(
          {
            ok: true,
            configured: Boolean(apiKey),
            updatedAt: snapshot?.updatedAt ?? null,
            stationCount: snapshot?.stationCount ?? 0,
          },
          200,
          request,
          env,
          { 'Cache-Control': 'no-store' },
        );
      }

      if (!apiKey) {
        return jsonResponse(
          { ok: false, configured: false, error: 'DATA_GO_KR_API_KEY not configured' },
          503,
          request,
          env,
          { 'Cache-Control': 'no-store' },
        );
      }

      if (url.pathname === '/status') {
        let snapshot = await env.STATUS_KV.get(KV_SNAPSHOT_KEY, { type: 'json' });
        if (!snapshot) {
          snapshot = await runSync(env);
        }
        return jsonResponse(snapshot, 200, request, env, {
          'Cache-Control': 'no-store',
        });
      }

      if (url.pathname === '/station') {
        const statId = normalizeText(url.searchParams.get('statId'));
        if (!/^[A-Za-z0-9_-]{2,40}$/.test(statId)) {
          return jsonResponse({ ok: false, error: 'Invalid statId' }, 400, request, env);
        }

        const cacheKey = new Request(
          `https://cache.ct-nacs-status.local/v2/station?statId=${encodeURIComponent(statId)}`,
        );
        const cachedRes = await caches.default.match(cacheKey);
        if (cachedRes) {
          const body = await cachedRes.text();
          return new Response(body, {
            status: cachedRes.status,
            headers: {
              'Content-Type': 'application/json; charset=utf-8',
              'Cache-Control': `public, max-age=${STATION_CACHE_TTL_SECONDS}`,
              'X-Worker-Cache': 'HIT',
              ...getCorsHeaders(request, env),
            },
          });
        }

        const [page, snapshot] = await Promise.all([
          fetchEvChargerPage(INFO_ENDPOINT, apiKey, 1, { statId, numOfRows: '100' }, 2),
          env.STATUS_KV
            ? env.STATUS_KV.get(KV_SNAPSHOT_KEY, { type: 'json' }).catch(() => null)
            : Promise.resolve(null),
        ]);

        const infoChargers = {};
        for (const item of page.items) {
          if (normalizeText(item.statId) !== statId) continue;
          const chgerId = normalizeText(item.chgerId);
          if (!chgerId) continue;
          infoChargers[chgerId] = extractChargerState(item);
        }

        const kvChargers = snapshot?.stations?.[statId]?.chargers ?? {};
        const chargers = {};
        const allIds = new Set([...Object.keys(kvChargers), ...Object.keys(infoChargers)]);
        for (const chgerId of allIds) {
          chargers[chgerId] = mergeChargerRecords(kvChargers[chgerId], infoChargers[chgerId]);
        }

        const payload = {
          ok: true,
          statId,
          fetchedAt: new Date().toISOString(),
          chargers,
        };
        const serialized = JSON.stringify(payload);

        ctx.waitUntil(
          caches.default.put(
            cacheKey,
            new Response(serialized, {
              status: 200,
              headers: {
                'Content-Type': 'application/json; charset=utf-8',
                'Cache-Control': `public, max-age=${STATION_CACHE_TTL_SECONDS}`,
              },
            }),
          ),
        );

        return new Response(serialized, {
          status: 200,
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': `public, max-age=${STATION_CACHE_TTL_SECONDS}`,
            'X-Worker-Cache': 'MISS',
            ...getCorsHeaders(request, env),
          },
        });
      }

      return jsonResponse({ ok: false, error: 'Not Found' }, 404, request, env);
    } catch (err) {
      return jsonResponse(
        { ok: false, error: err?.message ?? 'Upstream error' },
        502,
        request,
        env,
        { 'Cache-Control': 'no-store' },
      );
    }
  },

  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(runSync(env));
  },
};
