import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Crosshair,
  Download,
  ExternalLink,
  List,
  Map as MapIcon,
  RefreshCw,
  Search,
  ShieldAlert,
  X,
} from 'lucide-react';
import { NaverMap } from './components/NaverMap';
import { StationDetail } from './components/StationDetail';
import { TeslaEmblem } from './components/TeslaEmblem';
import type {
  Coordinates,
  FilterState,
  NacsDataset,
  NacsStationWithDistance,
} from './types';
import {
  calcDistanceKm,
  formatDistance,
  getOperatorShortName,
  isTeslaStation,
} from './utils/geo';
import {
  type AnalyticsConsent,
  disableGoogleAnalytics,
  enableGoogleAnalytics,
  getStoredConsent,
  saveConsent,
} from './utils/analytics';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

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
  const [gpsPermission, setGpsPermission] = useState<'unknown' | 'prompt' | 'granted' | 'denied'>(
    'unknown',
  );
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [showDisclaimerModal, setShowDisclaimerModal] = useState(false);
  const [installPromptEvent, setInstallPromptEvent] = useState<BeforeInstallPromptEvent | null>(
    null,
  );
  const [isStandalone, setIsStandalone] = useState(false);
  const [showIosInstallGuide, setShowIosInstallGuide] = useState(false);
  const [analyticsConsent, setAnalyticsConsent] = useState<AnalyticsConsent>(() =>
    getStoredConsent(),
  );

  useEffect(() => {
    if (analyticsConsent === 'accepted') {
      enableGoogleAnalytics();
    }
  }, [analyticsConsent]);

  const handleAcceptAnalytics = useCallback(() => {
    saveConsent('accepted');
    setAnalyticsConsent('accepted');
    enableGoogleAnalytics();
  }, []);

  const handleDeclineAnalytics = useCallback(() => {
    saveConsent('declined');
    setAnalyticsConsent('declined');
    disableGoogleAnalytics();
  }, []);

  const isIosSafari = useMemo(() => {
    if (typeof navigator === 'undefined') return false;
    return /iPhone|iPad|iPod/i.test(navigator.userAgent);
  }, []);

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
    onlySupercharger: false,
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
        setGpsPermission('granted');
        if (moveMap) {
          setCenterTarget((prev) => ({ coords, zoom: 13, seq: prev.seq + 1 }));
        }
      },
      (err) => {
        setGpsStatus('error');
        switch (err.code) {
          case err.PERMISSION_DENIED:
            setGpsPermission('denied');
            setGpsError('위치 권한이 거부되었습니다. 브라우저 주소창 왼쪽 설정에서 위치를 허용한 뒤 다시 시도해 주세요.');
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

    let permissionStatus: PermissionStatus | null = null;
    const handlePermChange = () => {
      if (!permissionStatus) return;
      setGpsPermission(permissionStatus.state);
      if (permissionStatus.state === 'granted') {
        requestGps(true);
      }
    };

    if ('permissions' in navigator && typeof navigator.permissions.query === 'function') {
      navigator.permissions
        .query({ name: 'geolocation' })
        .then((status) => {
          permissionStatus = status;
          setGpsPermission(status.state);
          status.addEventListener('change', handlePermChange);
          if (status.state !== 'denied') {
            requestGps(true);
          } else {
            setGpsStatus('error');
            setGpsError(
              '위치 권한이 차단되어 있습니다. 브라우저 사이트 설정에서 위치를 허용한 뒤 다시 시도해 주세요.',
            );
          }
        })
        .catch(() => {
          requestGps(true);
        });
    } else {
      requestGps(true);
    }

    return () => {
      permissionStatus?.removeEventListener('change', handlePermChange);
    };
  }, [loadDataset, requestGps]);

  useEffect(() => {
    const nav = navigator as Navigator & { standalone?: boolean };
    const standalone =
      window.matchMedia?.('(display-mode: standalone)').matches || Boolean(nav.standalone);
    setIsStandalone(standalone);

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setInstallPromptEvent(e as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      setIsStandalone(true);
      setInstallPromptEvent(null);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const handleInstallClick = useCallback(async () => {
    if (installPromptEvent) {
      await installPromptEvent.prompt();
      const choice = await installPromptEvent.userChoice;
      if (choice.outcome === 'accepted') {
        setInstallPromptEvent(null);
      }
      return;
    }
    if (isIosSafari) {
      setShowIosInstallGuide(true);
    }
  }, [installPromptEvent, isIosSafari]);

  const stationsWithDistance = useMemo<NacsStationWithDistance[]>(() => {
    const stations = dataset?.stations ?? [];
    const normalizedQuery = filters.query.trim().toLowerCase();

    const filtered = stations.filter((st) => {
      if (filters.type === '09' && !st.hasPureNacs) return false;
      if (filters.type === '10' && !st.hasComboNacs) return false;
      if (filters.onlySupercharger && !isTeslaStation(st)) return false;
      if (filters.onlyAvailable && (st.hasLiveStatus === false || st.availableCount === 0)) {
        return false;
      }
      if (filters.onlyFreeParking && st.parkingFree !== 'Y') return false;
      if (filters.onlyPublic && st.limitYn === 'Y') return false;

      if (normalizedQuery) {
        const haystack =
          `${st.statNm} ${st.addr} ${st.busiNm} ${st.location} ${st.stallSummary ?? ''}`.toLowerCase();
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
          <img
            src={`${import.meta.env.BASE_URL}icon-192.png`}
            alt="CT-NACS-MAP 아이콘"
            className="brand-icon-img"
            width={34}
            height={34}
          />
          <div>
            <div className="brand-title-row">
              <h1>CT-NACS-MAP</h1>
              <a
                className="brand-ext-link"
                href="https://mhsong282828221212123123123.github.io/CT-dashcam-studio-WEB/intro/kr/"
                target="_blank"
                rel="noreferrer"
              >
                Tesla 블박 뷰어
                <ExternalLink size={11} />
              </a>
            </div>
            <p className="brand-subtitle">
              GPS 기반 NACS(09·10) 전기차 충전소 지도 ·{' '}
              {dataset
                ? `${stationsWithDistance.length}/${dataset.totalStations}곳 (${formatUpdatedAt(dataset.statusUpdatedAt || dataset.updatedAt)} 기준)`
                : '불러오는 중'}
            </p>
          </div>
        </div>

        <div className="top-actions">
          <div className="top-actions-left">
            {!isStandalone && (installPromptEvent || isIosSafari) && (
              <button
                type="button"
                className="install-btn"
                onClick={() => void handleInstallClick()}
              >
                <Download size={15} />
                <span>앱 설치</span>
              </button>
            )}
            <button
              type="button"
              className={`gps-btn ${gpsStatus === 'ready' ? 'active' : ''}`}
              onClick={() => requestGps(true)}
              disabled={gpsStatus === 'locating'}
            >
              <Crosshair size={16} />
              <span>{gpsStatus === 'locating' ? '위치 확인중' : '내 위치'}</span>
            </button>
          </div>

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

      {(dataset?.isSample || (!userLocation && gpsStatus !== 'locating') || dataError) && (
        <div className="notice-strip">
          {dataset?.isSample && (
            <div className="notice-pill sample">
              샘플 데이터 표시 중 — <code>ENVIROMENT_GOV</code> 동기화 후 마스터 워크플로를 실행하면
              전국 실데이터로 전환됩니다.
            </div>
          )}
          {!userLocation && gpsStatus !== 'locating' && (
            <div className={`notice-pill ${gpsPermission === 'denied' ? 'warn' : 'gps-request'}`}>
              <Crosshair size={14} />
              <span>
                {gpsError ||
                  '내 주변 NACS 충전소를 거리순으로 찾으려면 위치 정보 권한이 필요합니다.'}
              </span>
              <button
                type="button"
                className="gps-allow-btn"
                onClick={() => requestGps(true)}
              >
                {gpsPermission === 'denied' ? '위치 다시 요청' : '위치 권한 허용하기'}
              </button>
            </div>
          )}
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
                className={`chip chip-tesla ${filters.onlySupercharger ? 'selected' : ''}`}
                onClick={() =>
                  setFilters((prev) => ({ ...prev, onlySupercharger: !prev.onlySupercharger }))
                }
              >
                슈퍼차저만
              </button>
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
                const isTesla = isTeslaStation(station);
                return (
                  <button
                    key={station.statId}
                    type="button"
                    className={`station-card ${isSelected ? 'selected' : ''}`}
                    onClick={() => handleSelectStation(station)}
                  >
                    <div className="station-card-top">
                      <span className="station-card-name">
                        {isTesla ? (
                          <span className="operator-tag tesla" title="테슬라코리아">
                            <TeslaEmblem size={10} />
                            <span>테슬라</span>
                          </span>
                        ) : (
                          <span className="operator-tag" title={station.busiNm}>
                            {getOperatorShortName(station)}
                          </span>
                        )}
                        {station.statNm}
                      </span>
                      {dist && <span className="station-card-dist">{dist}</span>}
                    </div>
                    <div className="station-card-addr">{station.addr}</div>
                    <div className="station-card-bottom">
                      {station.hasLiveStatus === false ? (
                        <span className="station-card-avail sc">총 {station.totalCount}기</span>
                      ) : (
                        <span
                          className={`station-card-avail ${
                            station.availableCount > 0 ? 'ok' : 'none'
                          }`}
                        >
                          대기 {station.availableCount}/{station.totalCount}
                        </span>
                      )}
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
            isVisible={mobileView === 'map'}
            onSelectStation={handleSelectStation}
          />

          {selectedStation && (
            <StationDetail station={selectedStation} onClose={() => setSelectedId(null)} />
          )}
        </section>
      </main>

      <footer className="disclaimer-bar" aria-label="법적 고지 및 면책 조항">
        <div className="disclaimer-text">
          <ShieldAlert size={13} />
          <span>
            비공식 독립 서비스 · 본 사이트는 <strong>Tesla, Inc. 및 테슬라코리아와 무관</strong>
            하며, 제공 정보의 정확성·실시간성 및 이용 결과에 대한 어떠한 법적 책임도 지지 않습니다.
          </span>
        </div>
        <button
          type="button"
          className="disclaimer-detail-btn"
          onClick={() => setShowDisclaimerModal(true)}
        >
          법적고지 상세
        </button>
      </footer>

      {analyticsConsent === 'unset' && (
        <aside className="consent-banner" role="region" aria-label="쿠키 및 방문 통계 동의">
          <div className="consent-banner-text">
            <strong>쿠키 및 방문 통계(Google Analytics) 안내</strong>
            <span>
              서비스 개선을 위해 쿠키 기반 익명 방문 통계를 사용합니다. GPS 위치 정보는 브라우저
              내에서만 사용되며 외부 서버로 전송되지 않습니다.
            </span>
          </div>
          <div className="consent-actions">
            <button
              type="button"
              className="consent-btn-decline"
              onClick={handleDeclineAnalytics}
            >
              거부
            </button>
            <button
              type="button"
              className="consent-btn-accept"
              onClick={handleAcceptAnalytics}
            >
              동의
            </button>
          </div>
        </aside>
      )}

      {showDisclaimerModal && (
        <div
          className="disclaimer-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="disclaimer-modal-title"
          onClick={() => setShowDisclaimerModal(false)}
        >
          <div className="disclaimer-modal" onClick={(e) => e.stopPropagation()}>
            <div className="disclaimer-modal-header">
              <h2 id="disclaimer-modal-title">법적 고지 및 면책 조항</h2>
              <button
                type="button"
                className="icon-close-btn"
                onClick={() => setShowDisclaimerModal(false)}
                aria-label="법적 고지 닫기"
              >
                <X size={18} />
              </button>
            </div>
            <ul>
              <li>
                <strong>비공식·독립 운영:</strong> 본 웹앱(CT-NACS-MAP)은 개인이 운영하는 비공식
                서비스이며, <strong>Tesla, Inc.</strong> 및 <strong>테슬라코리아(주)</strong>와
                제휴·후원·승인·연대 관계가 전혀 없습니다.
              </li>
              <li>
                <strong>상표권 안내:</strong> 본 서비스 내에 표시되는 Tesla, Supercharger 명칭 및
                심볼은 해당 권리자의 상표이며, 이용자에게 충전 규격 및 운영기관(한국환경공단 코드{' '}
                <code>TE</code> 등)을 식별·안내하기 위한 정보 제공 목적으로만 사용됩니다.
              </li>
              <li>
                <strong>데이터 정확성 및 면책:</strong> 충전소 위치·이용가능 여부·요금·출입제한
                정보는 한국환경공단 공공데이터(Open API)를 주기적으로 수집해 제공하므로 실제 현장
                상태와 다를 수 있습니다. 본 사이트의 정보 이용 또는 이용 불가로 인해 발생하는 직·간접적
                손해에 대해 제작자 및 운영자는 어떠한 법적 책임도 부담하지 않습니다.
              </li>
              <li>
                <strong>개인정보·위치정보 및 Google Analytics 안내:</strong> 사용자의 GPS 좌표는
                브라우저 내에서 거리 계산에만 쓰이며 서버로 전송·저장되지 않습니다. Google Analytics
                방문 통계 쿠키는 이용자가 동의한 경우에만 동작하며 언제든 변경할 수 있습니다. (현재
                상태:{' '}
                <strong>
                  {analyticsConsent === 'accepted'
                    ? '동의함'
                    : analyticsConsent === 'declined'
                      ? '거부함'
                      : '미선택'}
                </strong>
                )
                <div className="consent-modal-controls">
                  <button
                    type="button"
                    className={`consent-btn-accept ${
                      analyticsConsent === 'accepted' ? 'is-current' : ''
                    }`}
                    onClick={handleAcceptAnalytics}
                  >
                    통계 수집 동의
                  </button>
                  <button
                    type="button"
                    className={`consent-btn-decline ${
                      analyticsConsent === 'declined' ? 'is-current' : ''
                    }`}
                    onClick={handleDeclineAnalytics}
                  >
                    통계 수집 거부
                  </button>
                </div>
              </li>
            </ul>
          </div>
        </div>
      )}

      {showIosInstallGuide && (
        <div
          className="disclaimer-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="ios-install-modal-title"
          onClick={() => setShowIosInstallGuide(false)}
        >
          <div className="disclaimer-modal" onClick={(e) => e.stopPropagation()}>
            <div className="disclaimer-modal-header">
              <h2 id="ios-install-modal-title">아이폰·아이패드 홈 화면에 추가</h2>
              <button
                type="button"
                className="icon-close-btn"
                onClick={() => setShowIosInstallGuide(false)}
                aria-label="설치 안내 닫기"
              >
                <X size={18} />
              </button>
            </div>
            <ul>
              <li>
                1. Safari 또는 Chrome의 <strong>공유 버튼(□↑)</strong>을 누릅니다.
              </li>
              <li>
                2. 메뉴를 아래로 내려 <strong>홈 화면에 추가</strong>를 선택합니다.
              </li>
              <li>
                3. 오른쪽 상단 <strong>추가</strong>를 누르면 바탕화면에 앱 아이콘이 생성됩니다.
              </li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
