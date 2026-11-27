import fs from 'node:fs/promises';
import path from 'node:path';
import {
  NACS_JSON_PATH,
  NUM_OF_ROWS,
  fetchEvChargerPage,
  loadEnvFiles,
  normalizeText,
} from './lib/evcharger-api.mjs';

const API_ENDPOINT = 'https://apis.data.go.kr/B552584/EvCharger/getChargerInfo';
const CONCURRENCY = 4;
const NACS_TYPES = new Set(['09', '10']);

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

  console.log('환경부(한국환경공단) API에서 충전기 마스터 데이터를 조회 중입니다...');
  const firstPage = await fetchEvChargerPage(API_ENDPOINT, apiKey, 1);
  const totalCount = firstPage.totalCount;
  const totalPages = Math.max(1, Math.ceil(totalCount / NUM_OF_ROWS));

  console.log(`전체 충전기 수: ${totalCount.toLocaleString()}건 (${totalPages}페이지)`);

  const allItems = [...firstPage.items];
  const remainingPages = Array.from({ length: totalPages - 1 }, (_, i) => i + 2);

  for (let i = 0; i < remainingPages.length; i += CONCURRENCY) {
    const batch = remainingPages.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map((pageNo) => fetchEvChargerPage(API_ENDPOINT, apiKey, pageNo)),
    );
    for (const res of results) {
      allItems.push(...res.items);
    }
    console.log(
      `진행률: ${Math.min(i + batch.length + 1, totalPages)}/${totalPages} 페이지 완료`,
    );
  }

  const stations = groupNacsStations(allItems);
  const totalChargers = stations.reduce((sum, st) => sum + st.totalCount, 0);
  const nowIso = new Date().toISOString();

  const payload = {
    updatedAt: nowIso,
    statusUpdatedAt: nowIso,
    isSample: false,
    source: '한국환경공단 전기자동차 충전소 정보 (getChargerInfo, chgerType 09/10)',
    totalStations: stations.length,
    totalChargers,
    stations,
  };

  await fs.mkdir(path.dirname(NACS_JSON_PATH), { recursive: true });
  await fs.writeFile(NACS_JSON_PATH, JSON.stringify(payload), 'utf8');

  console.log(
    `완료: NACS 충전소 ${stations.length.toLocaleString()}곳 / 충전기 ${totalChargers.toLocaleString()}기 저장 -> ${NACS_JSON_PATH}`,
  );
}

main().catch((err) => {
  const msg = err?.message ?? String(err);
  console.error('NACS 마스터 데이터 수집 실패:', msg);
  if (msg.includes('SERVICE_KEY_IS_NOT_REGISTERED_ERROR')) {
    console.error(
      '안내: 공공데이터포털 신규 발급 인증키는 서버 동기화에 10~60분 정도 걸릴 수 있습니다. ENVIROMENT_GOV 값 확인 후 잠시 뒤 워크플로를 다시 실행해 주세요.',
    );
  }
  process.exit(1);
});
