import fs from 'node:fs/promises';
import path from 'node:path';
import {
  NACS_JSON_PATH,
  NUM_OF_ROWS,
  fetchEvChargerPage,
  loadEnvFiles,
  normalizeText,
} from './lib/evcharger-api.mjs';

const STATUS_ENDPOINT = 'https://apis.data.go.kr/B552584/EvCharger/getChargerStatus';
const INFO_ENDPOINT = 'https://apis.data.go.kr/B552584/EvCharger/getChargerInfo';
const DEFAULT_LIVE_DATA_URL =
  'https://mhsong282828221212123123123.github.io/CT-NACS-MAP/data/nacs.json';
const PERIOD_MINUTES = '10';
const MAX_STATUS_PAGES = 5;
const STAT_ID_CONCURRENCY = 6;
const STAT_ID_NUM_OF_ROWS = '100';

async function writeGithubOutput(key, value) {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (!outputFile) return;
  await fs.appendFile(outputFile, `${key}=${value}\n`, 'utf8');
}

async function readLocalDataset() {
  try {
    const raw = await fs.readFile(NACS_JSON_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function fetchLiveDataset(liveUrl) {
  if (!liveUrl) return null;
  try {
    const sep = liveUrl.includes('?') ? '&' : '?';
    const bustedUrl = `${liveUrl}${sep}t=${Date.now()}`;
    const res = await fetch(bustedUrl, {
      cache: 'no-store',
      headers: { Accept: 'application/json', 'User-Agent': 'CT-NACS-MAP/1.0' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function getDatasetTimestamp(dataset) {
  const ts = Date.parse(dataset?.statusUpdatedAt || dataset?.updatedAt || '');
  return Number.isFinite(ts) ? ts : 0;
}

function hasSuperchargerData(dataset) {
  return Boolean(dataset?.stations?.some((st) => st.dataSource === 'supercharge.info'));
}

function pickBaseDataset(localData, liveData) {
  const candidates = [localData, liveData].filter((d) => d && Array.isArray(d.stations));
  if (candidates.length === 0) return null;

  const nonSample = candidates.filter((d) => d.isSample === false);
  const pool = nonSample.length > 0 ? nonSample : candidates;
  const withSc = pool.filter(hasSuperchargerData);
  const finalPool = withSc.length > 0 ? withSc : pool;
  finalPool.sort((a, b) => getDatasetTimestamp(b) - getDatasetTimestamp(a));
  return finalPool[0];
}

function recordStatusItems(statusMap, items) {
  for (const item of items) {
    const statId = normalizeText(item.statId);
    const chgerId = normalizeText(item.chgerId);
    if (!statId || !chgerId) continue;
    statusMap.set(`${statId}:${chgerId}`, {
      stat: normalizeText(item.stat) || '0',
      statUpdDt: normalizeText(item.statUpdDt),
      lastTsdt: normalizeText(item.lastTsdt),
      lastTedt: normalizeText(item.lastTedt),
      nowTsdt: normalizeText(item.nowTsdt),
    });
  }
}

async function fetchSingleStatId(apiKey, statId, firstPageResult = null) {
  const firstPage =
    firstPageResult ??
    (await fetchEvChargerPage(
      INFO_ENDPOINT,
      apiKey,
      1,
      { statId, numOfRows: STAT_ID_NUM_OF_ROWS },
      3,
    ));

  const items = [...firstPage.items];
  const rowsPerPage = Number(STAT_ID_NUM_OF_ROWS);
  const totalPages = Math.max(1, Math.ceil(firstPage.totalCount / rowsPerPage));
  for (let pageNo = 2; pageNo <= totalPages; pageNo++) {
    const page = await fetchEvChargerPage(
      INFO_ENDPOINT,
      apiKey,
      pageNo,
      { statId, numOfRows: STAT_ID_NUM_OF_ROWS },
      3,
    );
    items.push(...page.items);
  }
  return items;
}

async function fetchByStatIds(apiKey, liveStations) {
  const uniqueStatIds = Array.from(
    new Set(liveStations.map((st) => normalizeText(st.statId)).filter(Boolean)),
  );
  const statusMap = new Map();
  if (uniqueStatIds.length === 0) {
    return {
      supported: false,
      statusMap,
      succeededStations: 0,
      failedStations: 0,
      totalStations: 0,
    };
  }

  const firstStatId = uniqueStatIds[0];
  let probe;
  try {
    probe = await fetchEvChargerPage(
      INFO_ENDPOINT,
      apiKey,
      1,
      { statId: firstStatId, numOfRows: STAT_ID_NUM_OF_ROWS },
      3,
    );
  } catch (err) {
    console.warn(`statId 탐색 조회 실패 (${firstStatId}): ${err?.message ?? err} → period=${PERIOD_MINUTES} 폴백`);
    return {
      supported: false,
      statusMap,
      succeededStations: 0,
      failedStations: 1,
      totalStations: uniqueStatIds.length,
    };
  }

  const matchesFirst = probe.items.some((item) => normalizeText(item.statId) === firstStatId);
  const isFiltered = probe.totalCount > 0 && probe.totalCount <= 200 && matchesFirst;
  if (!isFiltered) {
    console.log(
      `statId 필터 미지원 응답(totalCount=${probe.totalCount}) → period=${PERIOD_MINUTES} 폴백`,
    );
    return {
      supported: false,
      statusMap,
      succeededStations: 0,
      failedStations: 0,
      totalStations: uniqueStatIds.length,
    };
  }

  let succeededStations = 0;
  let failedStations = 0;

  try {
    const firstItems = await fetchSingleStatId(apiKey, firstStatId, probe);
    recordStatusItems(statusMap, firstItems);
    succeededStations += 1;
  } catch (err) {
    failedStations += 1;
    console.warn(`충전소 ${firstStatId} 조회 실패:`, err?.message ?? err);
  }

  const remaining = uniqueStatIds.slice(1);
  let cursor = 0;

  const workers = Array.from({ length: Math.min(STAT_ID_CONCURRENCY, remaining.length) }, async () => {
    while (cursor < remaining.length) {
      const idx = cursor++;
      const statId = remaining[idx];
      try {
        const items = await fetchSingleStatId(apiKey, statId);
        recordStatusItems(statusMap, items);
        succeededStations += 1;
      } catch (err) {
        failedStations += 1;
        console.warn(`충전소 ${statId} 조회 실패:`, err?.message ?? err);
      }
    }
  });

  await Promise.all(workers);

  return {
    supported: true,
    statusMap,
    succeededStations,
    failedStations,
    totalStations: uniqueStatIds.length,
  };
}

async function fetchByPeriodFallback(apiKey) {
  const firstPage = await fetchEvChargerPage(STATUS_ENDPOINT, apiKey, 1, {
    period: PERIOD_MINUTES,
  });
  const totalPages = Math.min(
    MAX_STATUS_PAGES,
    Math.max(1, Math.ceil(firstPage.totalCount / NUM_OF_ROWS)),
  );

  const statusItems = [...firstPage.items];
  for (let pageNo = 2; pageNo <= totalPages; pageNo++) {
    const page = await fetchEvChargerPage(STATUS_ENDPOINT, apiKey, pageNo, {
      period: PERIOD_MINUTES,
    });
    statusItems.push(...page.items);
  }

  const statusMap = new Map();
  recordStatusItems(statusMap, statusItems);
  return { statusMap, totalCount: statusItems.length, totalPages };
}

async function main() {
  await loadEnvFiles();
  const apiKey = process.env.DATA_GO_KR_API_KEY?.trim();

  if (!apiKey) {
    console.log('DATA_GO_KR_API_KEY가 설정되지 않아 상태 동기화를 건너뜁니다.');
    await writeGithubOutput('updated', 'false');
    return;
  }

  const liveUrl = (process.env.LIVE_DATA_URL ?? DEFAULT_LIVE_DATA_URL).trim();
  const [localData, liveData] = await Promise.all([readLocalDataset(), fetchLiveDataset(liveUrl)]);
  const base = pickBaseDataset(localData, liveData);

  if (!base || base.isSample === true) {
    console.log(
      '마스터 NACS 실데이터(isSample: false)가 아직 없어 상태 동기화를 건너뜁니다. 먼저 sync-master 워크플로를 실행해 주세요.',
    );
    await writeGithubOutput('updated', 'false');
    return;
  }

  const liveStations = base.stations.filter((st) => st.hasLiveStatus !== false);
  console.log(
    `실시간 NACS 충전소 ${liveStations.length}곳 상태 직접 조회 중... (전체 마스터: ${base.totalStations ?? base.stations.length}곳)`,
  );

  let syncModeLabel = '';
  let statusMap;

  const statIdResult = await fetchByStatIds(apiKey, liveStations);
  if (
    statIdResult.supported &&
    statIdResult.succeededStations >= Math.ceil(statIdResult.totalStations * 0.8)
  ) {
    statusMap = statIdResult.statusMap;
    syncModeLabel = `statId 직조회 (${statIdResult.succeededStations}/${statIdResult.totalStations}곳 성공${statIdResult.failedStations > 0 ? `, 실패 ${statIdResult.failedStations}곳` : ''})`;
  } else {
    const fallback = await fetchByPeriodFallback(apiKey);
    statusMap = fallback.statusMap;
    syncModeLabel = `period=${PERIOD_MINUTES} 폴백 (${fallback.totalCount.toLocaleString()}건, ${fallback.totalPages}페이지)`;
  }

  let patchedChargers = 0;
  let changedChargers = 0;
  for (const station of liveStations) {
    let availableCount = 0;
    let chargingCount = 0;

    for (const charger of station.chargers ?? []) {
      const update = statusMap.get(`${station.statId}:${charger.chgerId}`);
      if (update) {
        if (charger.stat !== update.stat) {
          changedChargers += 1;
        }
        charger.stat = update.stat;
        if (update.statUpdDt) charger.statUpdDt = update.statUpdDt;
        if (update.lastTsdt) charger.lastTsdt = update.lastTsdt;
        if (update.lastTedt) charger.lastTedt = update.lastTedt;
        if (update.nowTsdt) charger.nowTsdt = update.nowTsdt;
        patchedChargers += 1;
      }
      if (charger.stat === '2') availableCount += 1;
      if (charger.stat === '3') chargingCount += 1;
    }

    station.availableCount = availableCount;
    station.chargingCount = chargingCount;
  }

  const nowIso = new Date().toISOString();
  base.updatedAt = nowIso;
  base.statusUpdatedAt = nowIso;

  await fs.mkdir(path.dirname(NACS_JSON_PATH), { recursive: true });
  await fs.writeFile(NACS_JSON_PATH, JSON.stringify(base), 'utf8');
  await writeGithubOutput('updated', 'true');

  console.log(
    `상태 동기화 완료 [${syncModeLabel}]: NACS 충전기 ${patchedChargers.toLocaleString()}기 반영 (상태 변경 ${changedChargers.toLocaleString()}기)`,
  );
}

main().catch(async (err) => {
  const msg = err?.message ?? String(err);
  console.error('NACS 상태 동기화 실패:', msg);
  if (msg.includes('SERVICE_KEY_IS_NOT_REGISTERED_ERROR')) {
    console.error(
      '안내: 공공데이터포털 인증키가 아직 동기화 중이거나 ENVIROMENT_GOV 확인이 필요합니다.',
    );
  }
  await writeGithubOutput('updated', 'false');
  process.exit(1);
});
