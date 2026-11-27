import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ExternalLink, MapPin } from 'lucide-react';
import type {
  Coordinates,
  NaverMapInstance,
  NaverMarkerInstance,
  NacsStationWithDistance,
} from '../types';
import { isTeslaStation } from '../utils/geo';

interface NaverMapProps {
  stations: NacsStationWithDistance[];
  selectedStation: NacsStationWithDistance | null;
  userLocation: Coordinates | null;
  centerTarget: { coords: Coordinates; zoom?: number; seq: number };
  isVisible?: boolean;
  onSelectStation: (station: NacsStationWithDistance) => void;
}

type SdkStatus = 'missing_key' | 'loading' | 'ready' | 'auth_error' | 'load_error';

let sdkPromise: Promise<void> | null = null;

function loadNaverMapsScript(clientId: string): Promise<void> {
  if (window.naver?.maps) {
    return Promise.resolve();
  }
  if (sdkPromise) {
    return sdkPromise;
  }

  sdkPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[data-naver-maps-sdk="true"]',
    );
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('Script load error')), {
        once: true,
      });
      return;
    }

    const script = document.createElement('script');
    script.type = 'text/javascript';
    script.async = true;
    script.dataset.naverMapsSdk = 'true';
    script.src = `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${encodeURIComponent(clientId)}`;
    script.onload = () => resolve();
    script.onerror = () => {
      sdkPromise = null;
      reject(new Error('네이버 지도 SDK 스크립트를 불러오지 못했습니다.'));
    };
    document.head.appendChild(script);
  });

  return sdkPromise;
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const TESLA_T_SVG = `<svg width="13" height="13" viewBox="0 0 24 24" fill="#ffffff" aria-hidden="true"><path d="M12 5.4c3.4 0 6.8.5 9.2 1.6l.8-2.2C19.1 3.7 15.6 3.2 12 3.2S4.9 3.7 2 4.8l.8 2.2C5.2 5.9 8.6 5.4 12 5.4zm0 2.3c-2.6 0-5.1.3-7.4.9l1.2 1.9c1.6-.3 3.2-.5 4.8-.6l1.4 11.4 1.4-11.4c1.6.1 3.2.3 4.8.6l1.2-1.9c-2.3-.6-4.8-.9-7.4-.9z"/></svg>`;

const COMPACT_TESLA_SVG = `<svg width="11" height="11" viewBox="0 0 24 24" fill="#ffffff" aria-hidden="true"><path d="M12 5.4c3.4 0 6.8.5 9.2 1.6l.8-2.2C19.1 3.7 15.6 3.2 12 3.2S4.9 3.7 2 4.8l.8 2.2C5.2 5.9 8.6 5.4 12 5.4zm0 2.3c-2.6 0-5.1.3-7.4.9l1.2 1.9c1.6-.3 3.2-.5 4.8-.6l1.4 11.4 1.4-11.4c1.6.1 3.2.3 4.8.6l1.2-1.9c-2.3-.6-4.8-.9-7.4-.9z"/></svg>`;

function createCompactMarkerHtml(station: NacsStationWithDistance): string {
  const isTesla = isTeslaStation(station);
  if (isTesla) {
    return `
      <div style="
        width:22px;
        height:22px;
        border-radius:9999px;
        background:#E31937;
        border:2px solid #ffffff;
        box-shadow:0 2px 6px rgba(227,25,55,0.45);
        display:flex;
        align-items:center;
        justify-content:center;
        cursor:pointer;
      " title="${escapeHtml(station.statNm)}">${COMPACT_TESLA_SVG}</div>
    `;
  }

  const bg = station.availableCount > 0 ? '#059669' : '#64748b';
  return `
    <div style="
      width:16px;
      height:16px;
      border-radius:9999px;
      background:${bg};
      border:2px solid #ffffff;
      box-shadow:0 2px 6px rgba(15,23,42,0.3);
      cursor:pointer;
    " title="${escapeHtml(station.statNm)}"></div>
  `;
}

function createClusterMarkerHtml(
  count: number,
  teslaCount: number,
  nonTeslaCount: number,
): string {
  const size = count >= 30 ? 42 : count >= 10 ? 36 : 30;
  const fontSize = count >= 30 ? 13 : count >= 10 ? 12 : 11;
  const fontStyle = `font-family:-apple-system,BlinkMacSystemFont,'Pretendard','Noto Sans KR',sans-serif;font-size:${fontSize}px;font-weight:800;line-height:1;color:#ffffff;`;

  if (nonTeslaCount === 0) {
    return `
      <div style="
        width:${size}px;
        height:${size}px;
        border-radius:9999px;
        background:#E31937;
        border:2px solid #ffffff;
        box-shadow:0 3px 10px rgba(227,25,55,0.4);
        display:flex;
        align-items:center;
        justify-content:center;
        cursor:pointer;
        ${fontStyle}
      " title="충전소 ${count}곳 (확대하려면 클릭)">${count}</div>
    `;
  }

  if (teslaCount === 0) {
    return `
      <div style="
        width:${size}px;
        height:${size}px;
        border-radius:9999px;
        background:#059669;
        border:2px solid #ffffff;
        box-shadow:0 3px 10px rgba(5,150,105,0.38);
        display:flex;
        align-items:center;
        justify-content:center;
        cursor:pointer;
        ${fontStyle}
      " title="충전소 ${count}곳 (확대하려면 클릭)">${count}</div>
    `;
  }

  const teslaDeg = Math.round((teslaCount / count) * 360);
  return `
    <div style="
      width:${size}px;
      height:${size}px;
      padding:3px;
      box-sizing:border-box;
      border-radius:9999px;
      background:conic-gradient(#E31937 0deg ${teslaDeg}deg, #059669 ${teslaDeg}deg 360deg);
      box-shadow:0 3px 10px rgba(15,23,42,0.35);
      display:flex;
      align-items:center;
      justify-content:center;
      cursor:pointer;
    " title="충전소 ${count}곳 · 슈퍼차저 ${teslaCount} · 일반 NACS ${nonTeslaCount}">
      <div style="
        width:100%;
        height:100%;
        border-radius:9999px;
        background:#0f172a;
        display:flex;
        align-items:center;
        justify-content:center;
        ${fontStyle}
      ">${count}</div>
    </div>
  `;
}

function getClusterCellLat(zoom: number, isCompact: boolean): number {
  if (zoom <= 6) return isCompact ? 1.15 : 0.95;
  if (zoom === 7) return isCompact ? 0.68 : 0.55;
  if (zoom === 8) return isCompact ? 0.36 : 0.28;
  if (zoom === 9) return isCompact ? 0.19 : 0.14;
  return 0.075;
}

function createStationMarkerHtml(
  station: NacsStationWithDistance,
  isSelected: boolean,
): string {
  const hasLive = station.hasLiveStatus !== false;
  const hasAvail = hasLive && station.availableCount > 0;
  const isTesla = isTeslaStation(station);

  if (isTesla) {
    const badgeText = hasLive
      ? `${station.availableCount}/${station.totalCount}`
      : `${station.totalCount}기`;
    const redBg = isSelected ? '#7f1d1d' : !hasLive || hasAvail ? '#E31937' : '#9f1239';
    const emblemBg = isSelected ? '#991b1b' : '#E31937';
    const border = isSelected ? '#fecaca' : '#ffffff';

    return `
      <div style="
        display:inline-flex;
        flex-direction:column;
        align-items:center;
        transform:${isSelected ? 'scale(1.12)' : 'scale(1)'};
        transition:transform 0.15s ease;
        cursor:pointer;
      " title="${escapeHtml(station.statNm)}">
        <div style="
          width:22px;
          height:22px;
          border-radius:9999px;
          background:${emblemBg};
          border:2px solid ${border};
          display:flex;
          align-items:center;
          justify-content:center;
          box-shadow:0 3px 8px rgba(227,25,55,0.45);
          margin-bottom:-4px;
          position:relative;
          z-index:2;
        ">${TESLA_T_SVG}</div>
        <div style="
          display:inline-flex;
          align-items:center;
          gap:4px;
          padding:4px 9px;
          border-radius:9999px;
          background:${redBg};
          color:#ffffff;
          border:2px solid ${border};
          box-shadow:0 4px 12px rgba(227,25,55,0.35);
          font-family:-apple-system,BlinkMacSystemFont,'Pretendard','Noto Sans KR',sans-serif;
          font-size:12px;
          font-weight:700;
          line-height:1;
          white-space:nowrap;
        ">
          <span style="font-size:10px;opacity:0.95;">SC</span>
          <span>${badgeText}</span>
        </div>
      </div>
    `;
  }

  const badgeText = `${station.availableCount}/${station.totalCount}`;
  const bg = isSelected ? '#0f172a' : hasAvail ? '#059669' : '#64748b';
  const border = isSelected ? '#38bdf8' : '#ffffff';
  const label = station.hasPureNacs && !station.hasComboNacs ? 'NACS' : 'NACS+';

  return `
    <div style="
      display:inline-flex;
      align-items:center;
      gap:4px;
      padding:4px 8px;
      border-radius:9999px;
      background:${bg};
      color:#ffffff;
      border:2px solid ${border};
      box-shadow:0 4px 12px rgba(15,23,42,0.28);
      font-family:-apple-system,BlinkMacSystemFont,'Pretendard','Noto Sans KR',sans-serif;
      font-size:12px;
      font-weight:700;
      line-height:1;
      white-space:nowrap;
      transform:${isSelected ? 'scale(1.12)' : 'scale(1)'};
      transition:transform 0.15s ease;
      cursor:pointer;
    " title="${escapeHtml(station.statNm)}">
      <span style="font-size:10px;opacity:0.9;">${label}</span>
      <span>${badgeText}</span>
    </div>
  `;
}

export function NaverMap({
  stations,
  selectedStation,
  userLocation,
  centerTarget,
  isVisible = true,
  onSelectStation,
}: NaverMapProps) {
  const clientId = (import.meta.env.VITE_NAVER_MAP_CLIENT_ID ?? '').trim();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<NaverMapInstance | null>(null);
  const stationMarkersRef = useRef<NaverMarkerInstance[]>([]);
  const userMarkerRef = useRef<NaverMarkerInstance | null>(null);
  const onSelectRef = useRef(onSelectStation);
  onSelectRef.current = onSelectStation;

  const [sdkStatus, setSdkStatus] = useState<SdkStatus>(
    clientId ? 'loading' : 'missing_key',
  );
  const [isCompactViewport, setIsCompactViewport] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth <= 820 : false,
  );
  const [mapZoom, setMapZoom] = useState<number>(() => Math.round(centerTarget.zoom ?? 12));

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(max-width: 820px)');
    const handleChange = () => setIsCompactViewport(mq.matches);
    handleChange();

    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', handleChange);
      return () => mq.removeEventListener('change', handleChange);
    }
    mq.addListener(handleChange);
    return () => mq.removeListener(handleChange);
  }, []);

  useEffect(() => {
    if (!clientId) {
      setSdkStatus('missing_key');
      return;
    }

    let cancelled = false;
    window.navermap_authFailure = () => {
      if (!cancelled) {
        setSdkStatus('auth_error');
      }
    };

    loadNaverMapsScript(clientId)
      .then(() => {
        if (!cancelled && window.naver?.maps) {
          setSdkStatus((prev) => (prev === 'auth_error' ? 'auth_error' : 'ready'));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSdkStatus('load_error');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [clientId]);

  useEffect(() => {
    if (sdkStatus !== 'ready' || !containerRef.current || !window.naver?.maps || mapRef.current) {
      return;
    }

    const { maps } = window.naver;
    const initialCenter = new maps.LatLng(centerTarget.coords.lat, centerTarget.coords.lng);

    const map = new maps.Map(containerRef.current, {
      center: initialCenter,
      zoom: centerTarget.zoom ?? 12,
      minZoom: 6,
      maxZoom: 19,
      zoomControl: true,
      zoomControlOptions: {
        position: maps.Position?.TOP_RIGHT,
      },
      mapDataControl: false,
      scaleControl: true,
    });
    mapRef.current = map;

    const syncZoom = () => {
      const currentZoom = map.getZoom?.();
      if (typeof currentZoom === 'number' && Number.isFinite(currentZoom)) {
        const rounded = Math.round(currentZoom);
        setMapZoom((prev) => (prev === rounded ? prev : rounded));
      }
    };

    syncZoom();
    maps.Event.addListener(map, 'zoom_changed', syncZoom);
    maps.Event.addListener(map, 'idle', syncZoom);
  }, [sdkStatus, centerTarget]);

  useEffect(() => {
    if (sdkStatus !== 'ready' || !mapRef.current || !window.naver?.maps || !isVisible) return;
    const { maps } = window.naver;
    const rafId = window.requestAnimationFrame(() => {
      if (mapRef.current) {
        maps.Event.trigger?.(mapRef.current, 'resize');
      }
    });
    return () => window.cancelAnimationFrame(rafId);
  }, [sdkStatus, isVisible]);

  useEffect(() => {
    if (sdkStatus !== 'ready' || !mapRef.current || !window.naver?.maps) return;
    if (centerTarget.seq === 0) return;

    const { maps } = window.naver;
    const rafId = window.requestAnimationFrame(() => {
      const map = mapRef.current;
      if (!map) return;
      maps.Event.trigger?.(map, 'resize');
      const latLng = new maps.LatLng(centerTarget.coords.lat, centerTarget.coords.lng);
      if (centerTarget.zoom !== undefined) {
        if (typeof map.morph === 'function') {
          map.morph(latLng, centerTarget.zoom, { duration: 350 });
        } else {
          map.setCenter(latLng);
          map.setZoom(centerTarget.zoom, false);
        }
      } else {
        map.panTo(latLng, { duration: 350 });
      }
    });
    return () => window.cancelAnimationFrame(rafId);
  }, [sdkStatus, centerTarget]);

  useEffect(() => {
    if (sdkStatus !== 'ready' || !mapRef.current || !window.naver?.maps) return;
    const { maps } = window.naver;

    if (userMarkerRef.current) {
      userMarkerRef.current.setMap(null);
      userMarkerRef.current = null;
    }

    if (!userLocation) return;

    userMarkerRef.current = new maps.Marker({
      position: new maps.LatLng(userLocation.lat, userLocation.lng),
      map: mapRef.current,
      zIndex: 200,
      title: '내 위치',
      icon: {
        content: `
          <div style="
            width:18px;
            height:18px;
            border-radius:9999px;
            background:#2563eb;
            border:3px solid #ffffff;
            box-shadow:0 0 0 6px rgba(37,99,235,0.24), 0 2px 6px rgba(15,23,42,0.35);
          "></div>
        `,
        anchor: new maps.Point(9, 9),
      },
    });
  }, [sdkStatus, userLocation]);

  useEffect(() => {
    if (sdkStatus !== 'ready' || !mapRef.current || !window.naver?.maps) return;
    const { maps } = window.naver;
    const map = mapRef.current;

    for (const marker of stationMarkersRef.current) {
      maps.Event.clearInstanceListeners(marker);
      marker.setMap(null);
    }
    stationMarkersRef.current = [];

    const selectedId = selectedStation?.statId ?? null;
    const clusterMaxZoom = isCompactViewport ? 10 : 9;
    const compactMaxZoom = 11;
    const nextMarkers: NaverMarkerInstance[] = [];

    const addStationMarker = (station: NacsStationWithDistance, compact: boolean) => {
      const isSelected = station.statId === selectedId;
      const isTesla = isTeslaStation(station);
      const useCompact = compact && !isSelected;

      const content = useCompact
        ? createCompactMarkerHtml(station)
        : createStationMarkerHtml(station, isSelected);

      const anchor = useCompact
        ? isTesla
          ? new maps.Point(11, 11)
          : new maps.Point(8, 8)
        : isTesla
          ? new maps.Point(34, 34)
          : new maps.Point(34, 14);

      const marker = new maps.Marker({
        position: new maps.LatLng(station.lat, station.lng),
        map,
        title: station.statNm,
        zIndex: isSelected ? 170 : isTesla ? 120 : station.availableCount > 0 ? 100 : 50,
        icon: {
          content,
          anchor,
        },
      });

      maps.Event.addListener(marker, 'click', () => {
        onSelectRef.current(station);
      });

      nextMarkers.push(marker);
    };

    if (mapZoom <= clusterMaxZoom) {
      const cellLat = getClusterCellLat(mapZoom, isCompactViewport);
      const cellLng = cellLat / 0.804;
      const buckets = new Map<string, NacsStationWithDistance[]>();

      let selectedInList: NacsStationWithDistance | null = null;
      for (const station of stations) {
        if (station.statId === selectedId) {
          selectedInList = station;
          continue;
        }
        const key = `${Math.floor(station.lat / cellLat)}:${Math.floor(station.lng / cellLng)}`;
        const bucket = buckets.get(key);
        if (bucket) {
          bucket.push(station);
        } else {
          buckets.set(key, [station]);
        }
      }

      for (const bucket of buckets.values()) {
        if (bucket.length === 1) {
          addStationMarker(bucket[0], true);
          continue;
        }

        let latSum = 0;
        let lngSum = 0;
        let teslaCount = 0;
        for (const station of bucket) {
          latSum += station.lat;
          lngSum += station.lng;
          if (isTeslaStation(station)) {
            teslaCount += 1;
          }
        }
        const count = bucket.length;
        const nonTeslaCount = count - teslaCount;
        const centerLat = latSum / count;
        const centerLng = lngSum / count;
        const size = count >= 30 ? 42 : count >= 10 ? 36 : 30;
        const centroidLatLng = new maps.LatLng(centerLat, centerLng);

        const clusterMarker = new maps.Marker({
          position: centroidLatLng,
          map,
          title: `충전소 ${count}곳`,
          zIndex: 110 + Math.min(40, count),
          icon: {
            content: createClusterMarkerHtml(count, teslaCount, nonTeslaCount),
            anchor: new maps.Point(size / 2, size / 2),
          },
        });

        maps.Event.addListener(clusterMarker, 'click', () => {
          const targetZoom = Math.min(12, mapZoom + 2);
          if (typeof map.morph === 'function') {
            map.morph(centroidLatLng, targetZoom, { duration: 300 });
          } else {
            map.setCenter(centroidLatLng);
            map.setZoom(targetZoom, false);
          }
        });

        nextMarkers.push(clusterMarker);
      }

      if (selectedInList) {
        addStationMarker(selectedInList, false);
      }
    } else {
      const compact = mapZoom <= compactMaxZoom;
      for (const station of stations) {
        addStationMarker(station, compact);
      }
    }

    stationMarkersRef.current = nextMarkers;
  }, [sdkStatus, stations, selectedStation, mapZoom, isCompactViewport]);

  const currentOrigin =
    typeof window !== 'undefined' ? window.location.origin : 'https://<username>.github.io';

  if (sdkStatus === 'missing_key' || sdkStatus === 'auth_error' || sdkStatus === 'load_error') {
    return (
      <div className="map-fallback">
        <div className="map-fallback-card">
          <div className="map-fallback-icon">
            {sdkStatus === 'missing_key' ? <MapPin size={28} /> : <AlertTriangle size={28} />}
          </div>
          <h2>
            {sdkStatus === 'missing_key'
              ? '네이버 지도 Client ID가 설정되지 않았습니다'
              : sdkStatus === 'auth_error'
                ? '네이버 지도 API 인증 실패'
                : '네이버 지도 스크립트 로드 실패'}
          </h2>
          {sdkStatus === 'missing_key' ? (
            <p>
              GitHub Repository의 <strong>Settings → Secrets and variables → Actions</strong>에{' '}
              <code>NAVER_MAP_CLIENT_ID</code>를 추가하거나, 로컬 개발 시 <code>.env.local</code>에{' '}
              <code>VITE_NAVER_MAP_CLIENT_ID</code>를 입력해 주세요.
            </p>
          ) : (
            <p>
              네이버 클라우드 플랫폼 콘솔의 <strong>Maps → Application → Web 서비스 URL</strong>에
              현재 접속 도메인(<code>{currentOrigin}</code>)이 등록되어 있는지 확인해 주세요.
              (구형 AI NAVER API가 아닌 신규 <strong>Maps</strong> 상품의 Client ID여야 합니다.)
            </p>
          )}
          <div className="map-fallback-meta">
            <span>현재 Origin</span>
            <code>{currentOrigin}</code>
          </div>
          <a
            className="map-fallback-link"
            href="https://console.ncloud.com/maps/application"
            target="_blank"
            rel="noreferrer"
          >
            네이버 클라우드 Maps 콘솔 열기
            <ExternalLink size={14} />
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="map-wrapper">
      <div ref={containerRef} className="map-canvas" />
      {sdkStatus === 'loading' && (
        <div className="map-loading-overlay">네이버 지도를 불러오는 중...</div>
      )}
    </div>
  );
}
