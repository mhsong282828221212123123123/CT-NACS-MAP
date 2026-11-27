import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const OUTPUT_PATH = path.join(ROOT_DIR, 'public', 'data', 'nacs.json');
const API_ENDPOINT = 'https://apis.data.go.kr/B552584/EvCharger/getChargerInfo';
const NUM_OF_ROWS = 9999;
const CONCURRENCY = 4;
const NACS_TYPES = new Set(['09', '10']);

/**
 * Loads `.env` and `.env.local` if present so local runs work without extra deps.
 */
async function loadEnvFiles() {
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

function buildApiUrl(rawKey, pageNo) {
  const encodedKey = rawKey.includes('%') ? rawKey : encodeURIComponent(rawKey);
  const params = new URLSearchParams({
    pageNo: String(pageNo),
    numOfRows: String(NUM_OF_ROWS),
    dataType: 'JSON',
  });
  return `${API_ENDPOINT}?serviceKey=${encodedKey}&${params.toString()}`;
}

async function fetchPageWithRetry(rawKey, pageNo, maxRetries = 3) {
  const url = buildApiUrl(rawKey, pageNo);
  let lastErr;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(30000),
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }

      const text = await res.text();
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
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 800 * attempt));
      }
    }
  }

  throw new Error(`Page ${pageNo} failed after ${maxRetries} attempts: ${lastErr?.message}`);
}

function normalizeText(value) {
  if (value === null || value === undefined) return '';
  const str = String(value).trim();
  return str === 'null' ? '' : str;
}

function parseNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function formatFloorLabel(floorType, floorNum) {
  const num = normalizeText(floorNum);
  const type = normalizeText(floorType).toUpperCase();
  if (!num) return '';
  const prefix = type === 'B' ? '지하 ' : type === 'F' ? '지상 ' : '';
  const suffix = num.endsWith('층') ? '' : '층';
  return `${prefix}${num}${suffix}`;
}

function groupNacsStations(rawItems) {
  const stationMap = new Map();

  for (const item of rawItems) {
    if (normalizeText(item.delYn).toUpperCase() === 'Y') continue;

    const chgerType = normalizeText(item.chgerType).padStart(2, '0');
    if (!NACS_TYPES.has(chgerType)) continue;

    const lat = Number(item.lat);
    const lng = Number(item.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat === 0 || lng === 0) {
      continue;
    }

    const statId = normalizeText(item.statId);
    if (!statId) continue;

    const floorLabel = formatFloorLabel(item.floorType, item.floorNum);

    let station = stationMap.get(statId);
    if (!station) {
      station = {
        statId,
        statNm: normalizeText(item.statNm) || '이름 없는 충전소',
        addr: normalizeText(item.addr),
        addrDetail: normalizeText(item.addrDetail),
        location: normalizeText(item.location),
        floorLabel,
        lat,
        lng,
        useTime: normalizeText(item.useTime) || '확인 필요',
        busiId: normalizeText(item.busiId),
        busiNm: normalizeText(item.busiNm) || normalizeText(item.bnm) || '운영기관 미상',
        busiCall: normalizeText(item.busiCall),
        parkingFree: normalizeText(item.parkingFree) || 'N',
        limitYn: normalizeText(item.limitYn) || 'N',
        limitDetail: normalizeText(item.limitDetail),
        note: normalizeText(item.note),
        zcode: normalizeText(item.zcode),
        maxOutput: 0,
        hasPureNacs: false,
        hasComboNacs: false,
        availableCount: 0,
        chargingCount: 0,
        totalCount: 0,
        chargers: [],
      };
      stationMap.set(statId, station);
    } else {
      if (!station.floorLabel && floorLabel) station.floorLabel = floorLabel;
      if (!station.busiId) station.busiId = normalizeText(item.busiId);
    }

    const output = parseNumber(item.output);
    const stat = normalizeText(item.stat) || '0';
    const charger = {
      chgerId: normalizeText(item.chgerId) || String(station.chargers.length + 1).padStart(2, '0'),
      chgerType,
      stat,
      statUpdDt: normalizeText(item.statUpdDt),
      output,
      method: normalizeText(item.method),
    };

    station.chargers.push(charger);
    station.totalCount += 1;
    if (output > station.maxOutput) station.maxOutput = output;
    if (chgerType === '09') station.hasPureNacs = true;
    if (chgerType === '10') station.hasComboNacs = true;
    if (stat === '2') station.availableCount += 1;
    if (stat === '3') station.chargingCount += 1;
  }

  const stations = Array.from(stationMap.values());
  for (const station of stations) {
    station.chargers.sort((a, b) => a.chgerId.localeCompare(b.chgerId));
  }
  stations.sort((a, b) => a.statNm.localeCompare(b.statNm, 'ko'));
  return stations;
}

async function main() {
  await loadEnvFiles();
  const strict = process.argv.includes('--strict');
  const apiKey = process.env.DATA_GO_KR_API_KEY?.trim();

  if (!apiKey) {
    const msg =
      'DATA_GO_KR_API_KEY가 설정되지 않았습니다. 기존 public/data/nacs.json을 유지합니다.';
    if (strict) {
      console.error(msg);
      process.exit(1);
    }
    console.log(msg);
    return;
  }

  console.log('환경부(한국환경공단) API에서 충전기 데이터를 조회 중입니다...');
  const firstPage = await fetchPageWithRetry(apiKey, 1);
  const totalCount = firstPage.totalCount;
  const totalPages = Math.max(1, Math.ceil(totalCount / NUM_OF_ROWS));

  console.log(`전체 충전기 수: ${totalCount.toLocaleString()}건 (${totalPages}페이지)`);

  const allItems = [...firstPage.items];
  const remainingPages = Array.from({ length: totalPages - 1 }, (_, i) => i + 2);

  for (let i = 0; i < remainingPages.length; i += CONCURRENCY) {
    const batch = remainingPages.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map((pageNo) => fetchPageWithRetry(apiKey, pageNo)));
    for (const res of results) {
      allItems.push(...res.items);
    }
    console.log(
      `진행률: ${Math.min(i + batch.length + 1, totalPages)}/${totalPages} 페이지 완료`,
    );
  }

  const stations = groupNacsStations(allItems);
  const totalChargers = stations.reduce((sum, st) => sum + st.totalCount, 0);

  const payload = {
    updatedAt: new Date().toISOString(),
    isSample: false,
    source: '한국환경공단 전기자동차 충전소 정보 (getChargerInfo, chgerType 09/10)',
    totalStations: stations.length,
    totalChargers,
    stations,
  };

  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(payload), 'utf8');

  console.log(
    `완료: NACS 충전소 ${stations.length.toLocaleString()}곳 / 충전기 ${totalChargers.toLocaleString()}기 저장 -> ${OUTPUT_PATH}`,
  );
}

main().catch((err) => {
  console.error('NACS 데이터 수집 실패:', err);
  process.exit(1);
});
