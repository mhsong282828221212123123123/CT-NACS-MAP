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
const DEFAULT_LIVE_DATA_URL =
  'https://mhsong282828221212123123123.github.io/CT-NACS-MAP/data/nacs.json';
const PERIOD_MINUTES = '10';
const MAX_STATUS_PAGES = 5;

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
    const res = await fetch(liveUrl, {
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

function pickBaseDataset(localData, liveData) {
  const candidates = [localData, liveData].filter((d) => d && Array.isArray(d.stations));
  if (candidates.length === 0) return null;

  const nonSample = candidates.filter((d) => d.isSample === false);
  const pool = nonSample.length > 0 ? nonSample : candidates;
  pool.sort((a, b) => getDatasetTimestamp(b) - getDatasetTimestamp(a));
  return pool[0];
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

  console.log(
    `최근 ${PERIOD_MINUTES}분 충전기 상태 조회 중... (기준 마스터: ${base.totalStations ?? base.stations.length}곳)`,
  );

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
  for (const item of statusItems) {
    const statId = normalizeText(item.statId);
    const chgerId = normalizeText(item.chgerId);
    if (!statId || !chgerId) continue;
    statusMap.set(`${statId}:${chgerId}`, {
      stat: normalizeText(item.stat) || '0',
      statUpdDt: normalizeText(item.statUpdDt),
    });
  }

  let patchedChargers = 0;
  for (const station of base.stations) {
    let availableCount = 0;
    let chargingCount = 0;

    for (const charger of station.chargers ?? []) {
      const update = statusMap.get(`${station.statId}:${charger.chgerId}`);
      if (update) {
        charger.stat = update.stat;
        if (update.statUpdDt) {
          charger.statUpdDt = update.statUpdDt;
        }
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
    `상태 동기화 완료: 전체 상태변경 ${statusItems.length.toLocaleString()}건(${totalPages}페이지) 중 NACS 충전기 ${patchedChargers.toLocaleString()}기 반영`,
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
