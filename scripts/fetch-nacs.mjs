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
const SUPERCHARGE_API_URL = 'https://supercharge.info/service/supercharge/allSites';
const CONCURRENCY = 3;
const NACS_TYPES = new Set(['09', '10']);

const KR_STATE_MAP = {
  Seoul: '서울특별시',
  Gyeonggi: '경기도',
  Busan: '부산광역시',
  Incheon: '인천광역시',
  Daegu: '대구광역시',
  Daejeon: '대전광역시',
  Gwangju: '광주광역시',
  Ulsan: '울산광역시',
  Sejong: '세종특별자치시',
  Jeju: '제주특별자치도',
  Gangwon: '강원특별자치도',
  Chungcheongbuk: '충청북도',
  Chungcheongnam: '충청남도',
  Jeollabuk: '전북특별자치도',
  Jeollanam: '전라남도',
  Gyeongsangbuk: '경상북도',
  Gyeongsangnam: '경상남도',
};

const KR_CITY_MAP = {
  Seoul: '서울',
  Busan: '부산',
  Incheon: '인천',
  Daegu: '대구',
  Daejeon: '대전',
  Gwangju: '광주',
  Ulsan: '울산',
  Sejong: '세종',
  Seongnam: '성남',
  Suwon: '수원',
  Yongin: '용인',
  Goyang: '고양',
  Hwaseong: '화성',
  Cheonan: '천안',
  Cheongju: '청주',
  Changwon: '창원',
  Pohang: '포항',
  Gangneung: '강릉',
  Wonju: '원주',
  Chuncheon: '춘천',
  Jeonju: '전주',
  Suncheon: '순천',
  Yeosu: '여수',
  Gongju: '공주',
  Pyeongtaek: '평택',
  Paju: '파주',
  Gimpo: '김포',
  Hanam: '하남',
  Bucheon: '부천',
  Anyang: '안양',
  Ansan: '안산',
  Namyangju: '남양주',
  Uijeongbu: '의정부',
  Siheung: '시흥',
  Gwangmyeong: '광명',
  Osan: '오산',
  Icheon: '이천',
  Guri: '구리',
  Gunpo: '군포',
  Uiwang: '의왕',
  Yangju: '양주',
  Gimhae: '김해',
  Jinju: '진주',
  Geoje: '거제',
  Gumi: '구미',
  Gyeongju: '경주',
  Andong: '안동',
  Gunsan: '군산',
  Iksan: '익산',
  Mokpo: '목포',
  Sokcho: '속초',
  Jeju: '제주',
  Seogwipo: '서귀포',
  Asan: '아산',
  Seosan: '서산',
  Dangjin: '당진',
  Chungju: '충주',
  Wonju: '원주',
  Yangpyeong: '양평',
  Gapyeong: '가평',
  Pocheon: '포천',
  Anseong: '안성',
  Yeoju: '여주',
  Tongyeong: '통영',
  Yangsan: '양산',
  Miryang: '밀양',
  Sacheon: '사천',
  Jecheon: '제천',
  Nonsan: '논산',
  Boryeong: '보령',
  Gimcheon: '김천',
  Yeongju: '영주',
  Yeongcheon: '영천',
  Sangju: '상주',
  Mungyeong: '문경',
  Gyeongsan: '경산',
  Namwon: '남원',
  Jeongeup: '정읍',
  Gimje: '김제',
  Naju: '나주',
  Gwangyang: '광양',
  Donghae: '동해',
  Taebaek: '태백',
  Samcheok: '삼척',
};

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

function haversineMeters(lat1, lng1, lat2, lng2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function groupNacsStations(rawItems) {
  const stationMap = new Map();
  let teItemCount = 0;
  const teTypeCounts = {};

  for (const item of rawItems) {
    if (normalizeText(item.delYn).toUpperCase() === 'Y') continue;

    const chgerType = normalizeText(item.chgerType).padStart(2, '0');
    const busiId = normalizeText(item.busiId).toUpperCase();

    if (busiId === 'TE') {
      teItemCount += 1;
      teTypeCounts[chgerType] = (teTypeCounts[chgerType] || 0) + 1;
    }

    const includeByType = NACS_TYPES.has(chgerType);
    const includeByTesla = busiId === 'TE' && chgerType !== '02';
    if (!includeByType && !includeByTesla) continue;

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
        busiId,
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
        dataSource: 'evcharger',
        hasLiveStatus: true,
        chargers: [],
      };
      stationMap.set(statId, station);
    } else {
      if (!station.floorLabel && floorLabel) station.floorLabel = floorLabel;
      if (!station.busiId && busiId) station.busiId = busiId;
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
    if (chgerType === '09' || busiId === 'TE') station.hasPureNacs = true;
    if (chgerType === '10') station.hasComboNacs = true;
    if (stat === '2') station.availableCount += 1;
    if (stat === '3') station.chargingCount += 1;
  }

  console.log(
    `환경부 API 내 테슬라(TE) 충전기 수: ${teItemCount}기 (타입 분포: ${JSON.stringify(teTypeCounts)})`,
  );

  const stations = Array.from(stationMap.values());
  for (const station of stations) {
    station.chargers.sort((a, b) => a.chgerId.localeCompare(b.chgerId));
  }
  return stations;
}

function buildStallSummary(site) {
  const parts = [];
  if (site.stalls) {
    for (const [ver, count] of Object.entries(site.stalls)) {
      if (Number(count) > 0 && ['v2', 'v3', 'v4', 'urban'].includes(ver)) {
        const label = ver === 'urban' ? '어반' : ver.toUpperCase();
        parts.push(`${label} ${count}기`);
      }
    }
  }
  if (parts.length === 0 && Number(site.stallCount) > 0) {
    parts.push(`총 ${site.stallCount}기`);
  }
  parts.push(site.otherEVs === true ? '타사 전기차 개방' : '테슬라 차량 전용');
  return parts.join(' · ');
}

function formatSuperchargerSite(site) {
  const lat = Number(site.gps?.latitude);
  const lng = Number(site.gps?.longitude);
  const rawCity = normalizeText(site.address?.city);
  const rawState = normalizeText(site.address?.state);
  const street = normalizeText(site.address?.street);
  const krState = KR_STATE_MAP[rawState] || rawState;
  const krCity = KR_CITY_MAP[rawCity] || rawCity;

  const cleanName = normalizeText(site.name)
    .replace(/,\s*South Korea/i, '')
    .replace(/\bSouth Korea\b\s*-?\s*/i, '')
    .trim();

  const displayName =
    krCity && !cleanName.includes(krCity)
      ? `${krCity} 슈퍼차저 · ${cleanName}`
      : `슈퍼차저 ${cleanName}`;

  const regionPrefix = [krState, krCity && !krState.includes(krCity) ? krCity : '']
    .filter(Boolean)
    .join(' ');
  const addr = [regionPrefix, street].filter(Boolean).join(' · ');
  const stallSummary = buildStallSummary(site);
  const stallCount = Math.max(1, parseNumber(site.stallCount) || 1);
  const otherEVs = site.otherEVs === true;
  const hasCcs1 = otherEVs || Number(site.plugs?.ccs1 ?? 0) > 0;

  return {
    statId: `SC-${site.id}`,
    statNm: displayName,
    addr: addr || cleanName,
    addrDetail: '',
    location: stallSummary,
    floorLabel: '',
    lat,
    lng,
    useTime: '상세 운영시간은 Tesla 앱 확인',
    busiId: 'TE',
    busiNm: '테슬라코리아',
    busiCall: '080-617-1399',
    parkingFree: '',
    limitYn: otherEVs ? 'N' : 'Y',
    limitDetail: otherEVs ? '' : '테슬라 차량 전용',
    note: '',
    zcode: '',
    maxOutput: parseNumber(site.powerKilowatt) || 250,
    hasPureNacs: true,
    hasComboNacs: hasCcs1,
    availableCount: 0,
    chargingCount: 0,
    totalCount: stallCount,
    dataSource: 'supercharge.info',
    hasLiveStatus: false,
    otherEVs,
    stallSummary,
    chargers: [],
  };
}

async function fetchKoreaSuperchargers(existingStations) {
  try {
    console.log('supercharge.info에서 국내 테슬라 슈퍼차저 목록을 조회 중입니다...');
    const res = await fetch(SUPERCHARGE_API_URL, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'CT-NACS-MAP/1.0',
      },
      signal: AbortSignal.timeout(25000),
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }
    const allSites = await res.json();
    const krOpen = allSites.filter(
      (site) =>
        site.address?.country === 'South Korea' &&
        site.status === 'OPEN' &&
        Number.isFinite(Number(site.gps?.latitude)) &&
        Number.isFinite(Number(site.gps?.longitude)),
    );

    const teStations = existingStations.filter((st) => st.busiId === 'TE');
    const merged = [];
    let skippedDup = 0;

    for (const site of krOpen) {
      const lat = Number(site.gps.latitude);
      const lng = Number(site.gps.longitude);
      const hasNearbyTe = teStations.some(
        (te) => haversineMeters(te.lat, te.lng, lat, lng) <= 150,
      );
      if (hasNearbyTe) {
        skippedDup += 1;
        continue;
      }
      merged.push(formatSuperchargerSite(site));
    }

    console.log(
      `supercharge.info 국내 OPEN 슈퍼차저 ${krOpen.length}곳 중 ${merged.length}곳 병합 (중복 제외 ${skippedDup}곳)`,
    );
    return merged;
  } catch (err) {
    console.warn(`supercharge.info 조회 실패(환경부 데이터만 유지): ${err?.message ?? err}`);
    return [];
  }
}

async function main() {
  await loadEnvFiles();
  const superchargersOnly = process.argv.includes('--superchargers-only');

  if (superchargersOnly) {
    const raw = await fs.readFile(NACS_JSON_PATH, 'utf8');
    const existing = JSON.parse(raw);
    const evStations = (existing.stations ?? []).filter(
      (st) => st.dataSource !== 'supercharge.info',
    );
    const scStations = await fetchKoreaSuperchargers(evStations);
    const stations = [...evStations, ...scStations].sort((a, b) =>
      a.statNm.localeCompare(b.statNm, 'ko'),
    );
    const totalChargers = stations.reduce((sum, st) => sum + st.totalCount, 0);
    const nowIso = new Date().toISOString();

    const payload = {
      updatedAt: nowIso,
      statusUpdatedAt: nowIso,
      isSample: Boolean(existing.isSample),
      source: '한국환경공단 EvCharger Open API + supercharge.info (국내 슈퍼차저)',
      totalStations: stations.length,
      totalChargers,
      stations,
    };

    await fs.writeFile(NACS_JSON_PATH, JSON.stringify(payload), 'utf8');
    console.log(
      `슈퍼차저 병합 완료: 총 ${stations.length.toLocaleString()}곳 (기존 ${evStations.length}곳 + 슈퍼차저 ${scStations.length}곳) / ${totalChargers.toLocaleString()}기`,
    );
    return;
  }

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

  const evStations = groupNacsStations(allItems);
  const scStations = await fetchKoreaSuperchargers(evStations);
  const stations = [...evStations, ...scStations].sort((a, b) =>
    a.statNm.localeCompare(b.statNm, 'ko'),
  );
  const totalChargers = stations.reduce((sum, st) => sum + st.totalCount, 0);
  const nowIso = new Date().toISOString();

  const payload = {
    updatedAt: nowIso,
    statusUpdatedAt: nowIso,
    isSample: false,
    source: '한국환경공단 EvCharger Open API + supercharge.info (국내 슈퍼차저)',
    totalStations: stations.length,
    totalChargers,
    stations,
  };

  await fs.mkdir(path.dirname(NACS_JSON_PATH), { recursive: true });
  await fs.writeFile(NACS_JSON_PATH, JSON.stringify(payload), 'utf8');

  console.log(
    `완료: 총 ${stations.length.toLocaleString()}곳 (환경부 ${evStations.length}곳 + 슈퍼차저 ${scStations.length}곳) / ${totalChargers.toLocaleString()}기 저장 -> ${NACS_JSON_PATH}`,
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
