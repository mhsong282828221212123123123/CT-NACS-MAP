import type { Coordinates, NacsStation } from '../types';

const EARTH_RADIUS_KM = 6371;

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Haversine distance in kilometers between two GPS coordinates.
 */
export function calcDistanceKm(from: Coordinates, to: Coordinates): number {
  const dLat = toRadians(to.lat - from.lat);
  const dLng = toRadians(to.lng - from.lng);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(from.lat)) *
      Math.cos(toRadians(to.lat)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

export function formatDistance(distanceKm: number | null): string {
  if (distanceKm === null || !Number.isFinite(distanceKm)) return '';
  if (distanceKm < 1) {
    return `${Math.round(distanceKm * 1000)}m`;
  }
  if (distanceKm < 10) {
    return `${distanceKm.toFixed(1)}km`;
  }
  return `${Math.round(distanceKm)}km`;
}

export function getChargerTypeLabel(chgerType: string): string {
  switch (chgerType.padStart(2, '0')) {
    case '09':
      return 'NACS';
    case '10':
      return 'DC콤보+NACS';
    default:
      return `타입 ${chgerType}`;
  }
}

export interface ChargerStatusMeta {
  label: string;
  tone: 'available' | 'charging' | 'warning' | 'offline';
}

export function getChargerStatusMeta(stat: string): ChargerStatusMeta {
  switch (stat) {
    case '0':
      return { label: '알수없음', tone: 'offline' };
    case '1':
      return { label: '통신이상', tone: 'offline' };
    case '2':
      return { label: '충전대기', tone: 'available' };
    case '3':
      return { label: '충전중', tone: 'charging' };
    case '4':
      return { label: '운영중지', tone: 'offline' };
    case '5':
      return { label: '점검중', tone: 'warning' };
    case '6':
      return { label: '예약중', tone: 'warning' };
    case '9':
    default:
      return { label: '상태미확인', tone: 'offline' };
  }
}

export function formatStatUpdDt(raw: string): string {
  if (!raw || raw.length < 12) return '';
  const yyyy = raw.slice(0, 4);
  const mm = raw.slice(4, 6);
  const dd = raw.slice(6, 8);
  const hh = raw.slice(8, 10);
  const mi = raw.slice(10, 12);
  return `${yyyy}.${mm}.${dd} ${hh}:${mi}`;
}

export function buildNaverMapUrl(station: NacsStation): string {
  const name = encodeURIComponent(station.statNm);
  return `https://map.naver.com/v5/?c=${station.lng},${station.lat},16,0,0,0,dh&title=${name}`;
}

export function buildKakaoMapUrl(station: NacsStation): string {
  const name = encodeURIComponent(station.statNm);
  return `https://map.kakao.com/link/to/${name},${station.lat},${station.lng}`;
}

export function buildTmapUrl(station: NacsStation): string {
  const name = encodeURIComponent(station.statNm);
  return `tmap://route?goalname=${name}&goalx=${station.lng}&goaly=${station.lat}`;
}

export function buildGoogleMapsUrl(station: NacsStation): string {
  return `https://maps.google.com/?q=${station.lat},${station.lng}`;
}

export function isMobileDevice(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)) return true;
  return navigator.maxTouchPoints > 1 && Boolean(window.matchMedia?.('(pointer: coarse)').matches);
}

export function isTeslaStation(station: Pick<NacsStation, 'busiId' | 'busiNm'>): boolean {
  if (station.busiId?.trim().toUpperCase() === 'TE') return true;
  return /테슬라|tesla/i.test(station.busiNm ?? '');
}

const OPERATOR_SHORT_NAMES: Record<string, string> = {
  TE: '테슬라',
  BE: '워터',
  CV: '채비',
  ST: 'SK일렉링크',
  SG: 'SK시그넷',
  PK: '펌프킨',
};

export function getOperatorShortName(station: Pick<NacsStation, 'busiId' | 'busiNm'>): string {
  const busiId = station.busiId?.trim().toUpperCase();
  if (busiId && OPERATOR_SHORT_NAMES[busiId]) {
    return OPERATOR_SHORT_NAMES[busiId];
  }
  const cleaned = (station.busiNm ?? '')
    .replace(/^\s*(주식회사|\(주\)|㈜)\s*/g, '')
    .replace(/\s*(주식회사|\(주\)|㈜)\s*$/g, '')
    .trim();
  return cleaned || '운영사';
}
