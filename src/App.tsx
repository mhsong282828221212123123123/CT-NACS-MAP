import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Crosshair,
  List,
  Map as MapIcon,
  RefreshCw,
  Search,
  Zap,
} from 'lucide-react';
import { NaverMap } from './components/NaverMap';
import { StationDetail } from './components/StationDetail';
import type {
  Coordinates,
  FilterState,
  NacsDataset,
  NacsStationWithDistance,
} from './types';
import { calcDistanceKm, formatDistance } from './utils/geo';

const DEFAULT_CENTER: Coordinates = { lat: 37.5665, lng: 126.978 };

function formatUpdatedAt(iso: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('ko-KR', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function App() {
  const [dataset, setDataset] = useState<NacsDataset | null>(null);
  const [dataError, setDataError] = useState<string | null>(null);
  const [loadingData, setLoadingData] = useState(true);

  const [userLocation, setUserLocation] = useState<Coordinates | null>(null);
  const [gpsStatus, setGpsStatus] = useState<'idle' | 'locating' | 'ready' | 'error'>('idle');
  const [gpsError, setGpsError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mobileView, setMobileView] = useState<'map' | 'list'>('map');
  const [centerTarget, setCenterTarget] = useState<{
    coords: Coordinates;
    zoom?: number;
    seq: number;
  }>({
    coords: DEFAULT_CENTER,
    zoom: 12,
    seq: 0,
  });

  const [filters, setFilters] = useState<FilterState>({
    query: '',
    type: 'all',
    onlyAvailable: false,
    onlyFreeParking: false,
    onlyPublic: false,
  });

  const loadDataset = useCallback(async () => {
    setLoadingData(true);
    setDataError(null);
    try {
      const url = `${import.meta.env.BASE_URL}data/nacs.json`;
      const res = await fetch(url, { cache: 'no-cache' });
      if (!res.ok) {
        throw new Error(`데이터 로드 실패 (HTTP ${res.status})`);
      }
      const json = (await res.json()) as NacsDataset;
      setDataset(json);
    } catch (err) {
      setDataError(err instanceof Error ? err.message : '충전소 데이터를 불러오지 못했습니다.');
    } finally {
      setLoadingData(false);
    }
  }, []);

  const requestGps = useCallback((moveMap = true) => {
    if (!('geolocation' in navigator)) {
      setGpsStatus('error');
      setGpsError('이 브라우저는 GPS 위치 기능을 지원하지 않습니다.');
      return;
    }

    setGpsStatus('locating');
    setGpsError(null);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const coords: Coordinates = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        };
        setUserLocation(coords);
        setGpsStatus('ready');
        if (moveMap) {
          setCenterTarget((prev) => ({ coords, zoom: 13, seq: prev.seq + 1 }));
        }
      },
      (err) => {
        setGpsStatus('error');
        switch (err.code) {
          case err.PERMISSION_DENIED:
            setGpsError('위치 권한이 거부되었습니다. 브라우저 설정에서 위치 권한을 허용해 주세요.');
            break;
          case err.POSITION_UNAVAILABLE:
            setGpsError('현재 위치 정보를 가져올 수 없습니다.');
            break;
          case err.TIMEOUT:
            setGpsError('위치 확인 시간이 초과되었습니다.');
            break;
          default:
            setGpsError('위치 확인 중 오류가 발생했습니다.');
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 60000,
      },
    );
  }, []);

  useEffect(() => {
    void loadDataset();
    requestGps(true);
  }, [loadDataset, requestGps]);

  const stationsWithDistance = useMemo<NacsStationWithDistance[]>(() => {
    const stations = dataset?.stations ?? [];
    const normalizedQuery = filters.query.trim().toLowerCase();

    const filtered = stations.filter((st) => {
      if (filters.type === '09' && !st.hasPureNacs) return false;
      if (filters.type === '10' && !st.hasComboNacs) return false;
      if (filters.onlyAvailable && st.availableCount === 0) return false;
      if (filters.onlyFreeParking && st.parkingFree !== 'Y') return false;
      if (filters.onlyPublic && st.limitYn === 'Y') return false;

      if (normalizedQuery) {
        const haystack = `${st.statNm} ${st.addr} ${st.busiNm} ${st.location}`.toLowerCase();
        if (!haystack.includes(normalizedQuery)) return false;
      }
      return true;
    });

    const mapped = filtered.map((st) => ({
      ...st,
      distanceKm: userLocation ? calcDistanceKm(userLocation, { lat: st.lat, lng: st.lng }) : null,
    }));

    mapped.sort((a, b) => {
      if (a.distanceKm !== null && b.distanceKm !== null) {
        return a.distanceKm - b.distanceKm;
      }
      if (b.availableCount !== a.availableCount) {
        return b.availableCount - a.availableCount;
      }
      return a.statNm.localeCompare(b.statNm, 'ko');
    });

    return mapped;
  }, [dataset, filters, userLocation]);

  const selectedStation = useMemo(
    () => stationsWithDistance.find((st) => st.statId === selectedId) ?? null,
    [stationsWithDistance, selectedId],
  );

  const handleSelectStation = useCallback((station: NacsStationWithDistance) => {
    setSelectedId(station.statId);
    setMobileView('map');
    setCenterTarget((prev) => ({
      coords: { lat: station.lat, lng: station.lng },
      zoom: 15,
      seq: prev.seq + 1,
    }));
  }, []);

  return (
    <div className="app-shell">
      <header className="top-bar">
        <div className="brand">
          <div className="brand-icon">
            <Zap size={18} />
          </div>
          <div>
            <h1>CT-NACS-MAP</h1>
            <p className="brand-subtitle">
              GPS 기반 NACS(09·10) 전기차 충전소 지도 ·{' '}
              {dataset
                ? `${stationsWithDistance.length}/${dataset.totalStations}곳 (${formatUpdatedAt(dataset.updatedAt)} 기준)`
                : '불러오는 중'}
            </p>
          </div>
        </div>

        <div className="top-actions">
          <button
            type="button"
            className={`gps-btn ${gpsStatus === 'ready' ? 'active' : ''}`}
            onClick={() => requestGps(true)}
            disabled={gpsStatus === 'locating'}
          >
            <Crosshair size={16} />
            <span>{gpsStatus === 'locating' ? '위치 확인중' : '내 위치'}</span>
          </button>

          <div className="mobile-view-toggle" role="tablist" aria-label="화면 전환">
            <button
              type="button"
              className={mobileView === 'map' ? 'active' : ''}
              onClick={() => setMobileView('map')}
            >
              <MapIcon size={15} /> 지도
            </button>
            <button
              type="button"
              className={mobileView === 'list' ? 'active' : ''}
              onClick={() => setMobileView('list')}
            >
              <List size={15} /> 목록 ({stationsWithDistance.length})
            </button>
          </div>
        </div>
      </header>

      {(dataset?.isSample || gpsError || dataError) && (
        <div className="notice-strip">
          {dataset?.isSample && (
            <div className="notice-pill sample">
              샘플 데이터 표시 중 — GitHub Secret <code>DATA_GO_KR_API_KEY</code>를 등록하면 전국
              실데이터로 자동 전환됩니다.
            </div>
          )}
          {gpsError && <div className="notice-pill warn">{gpsError}</div>}
          {dataError && (
            <div className="notice-pill error">
              {dataError}{' '}
              <button type="button" onClick={() => void loadDataset()}>
                <RefreshCw size={12} /> 다시 시도
              </button>
            </div>
          )}
        </div>
      )}

      <main className="main-layout">
        <aside className={`sidebar ${mobileView === 'list' ? 'mobile-visible' : ''}`}>
          <div className="search-filter-box">
            <label className="search-input-wrap">
              <Search size={16} />
              <input
                type="search"
                value={filters.query}
                onChange={(e) => setFilters((prev) => ({ ...prev, query: e.target.value }))}
                placeholder="충전소명, 주소, 운영사 검색"
              />
            </label>

            <div className="chip-row">
              {(
                [
                  { id: 'all', label: '전체 NACS' },
                  { id: '09', label: 'NACS 전용(09)' },
                  { id: '10', label: 'DC콤보+NACS(10)' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  className={`chip ${filters.type === opt.id ? 'selected' : ''}`}
                  onClick={() => setFilters((prev) => ({ ...prev, type: opt.id }))}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <div className="chip-row">
              <button
                type="button"
                className={`chip ${filters.onlyAvailable ? 'selected' : ''}`}
                onClick={() =>
                  setFilters((prev) => ({ ...prev, onlyAvailable: !prev.onlyAvailable }))
                }
              >
                충전대기만
              </button>
              <button
                type="button"
                className={`chip ${filters.onlyFreeParking ? 'selected' : ''}`}
                onClick={() =>
                  setFilters((prev) => ({ ...prev, onlyFreeParking: !prev.onlyFreeParking }))
                }
              >
                무료주차
              </button>
              <button
                type="button"
                className={`chip ${filters.onlyPublic ? 'selected' : ''}`}
                onClick={() => setFilters((prev) => ({ ...prev, onlyPublic: !prev.onlyPublic }))}
              >
                외부인 개방
              </button>
            </div>
          </div>

          <div className="station-list">
            {loadingData ? (
              <div className="empty-state">충전소 데이터를 불러오는 중입니다...</div>
            ) : stationsWithDistance.length === 0 ? (
              <div className="empty-state">조건에 맞는 NACS 충전소가 없습니다.</div>
            ) : (
              stationsWithDistance.map((station) => {
                const isSelected = station.statId === selectedId;
                const dist = formatDistance(station.distanceKm);
                return (
                  <button
                    key={station.statId}
                    type="button"
                    className={`station-card ${isSelected ? 'selected' : ''}`}
                    onClick={() => handleSelectStation(station)}
                  >
                    <div className="station-card-top">
                      <span className="station-card-name">{station.statNm}</span>
                      {dist && <span className="station-card-dist">{dist}</span>}
                    </div>
                    <div className="station-card-addr">{station.addr}</div>
                    <div className="station-card-bottom">
                      <span
                        className={`station-card-avail ${
                          station.availableCount > 0 ? 'ok' : 'none'
                        }`}
                      >
                        대기 {station.availableCount}/{station.totalCount}
                      </span>
                      <span className="station-card-meta">
                        {station.maxOutput > 0 ? `${station.maxOutput}kW · ` : ''}
                        {station.busiNm}
                      </span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        <section className={`map-stage ${mobileView === 'map' ? 'mobile-visible' : ''}`}>
          <NaverMap
            stations={stationsWithDistance}
            selectedStation={selectedStation}
            userLocation={userLocation}
            centerTarget={centerTarget}
            onSelectStation={handleSelectStation}
          />

          {selectedStation && (
            <StationDetail station={selectedStation} onClose={() => setSelectedId(null)} />
          )}
        </section>
      </main>
    </div>
  );
}

export default App;
