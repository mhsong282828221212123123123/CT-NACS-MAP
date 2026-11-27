import { useEffect, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Clock,
  MapPin,
  Navigation,
  Phone,
  PlugZap,
  Share2,
  X,
  Zap,
} from 'lucide-react';
import type { NacsStationWithDistance } from '../types';
import {
  buildGoogleMapsUrl,
  buildKakaoMapUrl,
  buildNaverMapUrl,
  buildTmapUrl,
  formatDistance,
  formatStatUpdDt,
  getChargerStatusMeta,
  getChargerTypeLabel,
  getOperatorShortName,
  isMobileDevice,
  isTeslaStation,
} from '../utils/geo';
import { TeslaEmblem } from './TeslaEmblem';

interface StationDetailProps {
  station: NacsStationWithDistance;
  statusUpdatedAt?: string;
  liveChecking?: boolean;
  liveCheckedAt?: string;
  onClose: () => void;
}

function parseKstYmdhms(raw: string): number {
  if (!raw || raw.length < 14) return Number.NaN;
  const iso = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T${raw.slice(8, 10)}:${raw.slice(10, 12)}:${raw.slice(12, 14)}+09:00`;
  return Date.parse(iso);
}

export function StationDetail({
  station,
  statusUpdatedAt,
  liveChecking = false,
  liveCheckedAt,
  onClose,
}: StationDetailProps) {
  const distanceLabel = formatDistance(station.distanceKm);
  const isTesla = isTeslaStation(station);
  const showMobileShare = isMobileDevice();
  const [showMoreApps, setShowMoreApps] = useState(false);
  const [shareFeedback, setShareFeedback] = useState<string | null>(null);

  const effectiveTimeIso = liveCheckedAt || statusUpdatedAt;
  const parsedPollTs = effectiveTimeIso ? Date.parse(effectiveTimeIso) : Number.NaN;
  const hasPollTime = Number.isFinite(parsedPollTs);
  const pollLabel = hasPollTime
    ? new Intl.DateTimeFormat('ko-KR', {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(new Date(parsedPollTs))
    : '';
  const isStale = !liveCheckedAt && hasPollTime && Date.now() - parsedPollTs > 15 * 60 * 1000;

  useEffect(() => {
    setShowMoreApps(false);
    setShareFeedback(null);
  }, [station.statId]);

  const handleMobileShare = async () => {
    const mapsUrl = buildGoogleMapsUrl(station);
    const shareData = {
      title: station.statNm,
      text: `${station.statNm}\n${station.addr}`,
      url: mapsUrl,
    };

    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share(shareData);
        return;
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return;
        }
      }
    }

    try {
      await navigator.clipboard?.writeText(mapsUrl);
      setShareFeedback('위치 링크가 복사되었습니다.');
    } catch {
      window.open(mapsUrl, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <section className="detail-sheet" aria-label="충전소 상세 정보">
      <div className="detail-header">
        <div className="detail-title-group">
          <div className="detail-badges">
            {isTesla && (
              <span className="badge badge-tesla">
                <TeslaEmblem size={11} /> 테슬라 슈퍼차저
              </span>
            )}
            {station.hasPureNacs && <span className="badge badge-nacs">NACS (09)</span>}
            {station.hasComboNacs && <span className="badge badge-combo">DC콤보+NACS (10)</span>}
            {station.maxOutput > 0 && (
              <span className="badge badge-power">
                <Zap size={12} /> 최대 {station.maxOutput}kW
              </span>
            )}
          </div>
          <h2>
            {isTesla ? (
              <span className="operator-tag tesla" title="테슬라코리아">
                <TeslaEmblem size={11} />
                <span>테슬라</span>
              </span>
            ) : (
              <span className="operator-tag" title={station.busiNm}>
                {getOperatorShortName(station)}
              </span>
            )}
            {station.statNm}
          </h2>
        </div>
        <button
          type="button"
          className="icon-close-btn"
          onClick={onClose}
          aria-label="상세 정보 닫기"
        >
          <X size={18} />
        </button>
      </div>

      <div className="detail-summary-row">
        {station.hasLiveStatus === false ? (
          <span className="status-pill sc">총 {station.totalCount}기 · 실시간 미제공</span>
        ) : (
          <span className={station.availableCount > 0 ? 'status-pill available' : 'status-pill busy'}>
            충전대기 {station.availableCount} / {station.totalCount}기
          </span>
        )}
        {distanceLabel && <span className="distance-pill">{distanceLabel}</span>}
        <span className="operator-name">{station.busiNm}</span>
      </div>

      <div className="detail-info-list">
        <div className="detail-info-item">
          <MapPin size={15} />
          <div>
            <div>{station.addr || '주소 정보 없음'}</div>
            {(station.addrDetail || station.floorLabel || station.location) && (
              <div className="detail-subtext">
                {Array.from(
                  new Set(
                    [station.addrDetail, station.floorLabel, station.location].filter(Boolean),
                  ),
                ).join(' · ')}
              </div>
            )}
          </div>
        </div>

        <div className="detail-info-item">
          <Clock size={15} />
          <span>
            {station.useTime || '이용시간 정보 없음'} ·{' '}
            {station.parkingFree === 'Y'
              ? '무료주차'
              : station.parkingFree === 'N'
                ? '주차요금 별도/확인필요'
                : '주차요금 현장확인'}{' '}
            ·{' '}
            {station.limitYn === 'Y'
              ? `이용제한(${station.limitDetail || '상세확인'})`
              : '외부인 개방'}
          </span>
        </div>

        {station.busiCall && (
          <div className="detail-info-item">
            <Phone size={15} />
            <a href={`tel:${station.busiCall}`}>{station.busiCall}</a>
          </div>
        )}
      </div>

      {showMobileShare && (
        <div className="mobile-share-box">
          <div className="mobile-share-row">
            <button
              type="button"
              className="share-primary-btn"
              onClick={() => void handleMobileShare()}
            >
              <Share2 size={15} /> 공유 (Tesla · 앱 전송)
            </button>
            <button
              type="button"
              className="share-more-btn"
              onClick={() => setShowMoreApps((prev) => !prev)}
              aria-expanded={showMoreApps}
            >
              더보기 {showMoreApps ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
            </button>
          </div>

          {shareFeedback && <div className="share-feedback">{shareFeedback}</div>}

          {showMoreApps && (
            <div className="share-more-grid">
              <a
                className="nav-btn nav-naver"
                href={buildNaverMapUrl(station)}
                target="_blank"
                rel="noreferrer"
              >
                <Navigation size={14} /> 네이버지도
              </a>
              <a
                className="nav-btn nav-kakao"
                href={buildKakaoMapUrl(station)}
                target="_blank"
                rel="noreferrer"
              >
                <Navigation size={14} /> 카카오맵
              </a>
              <a className="nav-btn nav-tmap" href={buildTmapUrl(station)}>
                <Navigation size={14} /> 티맵
              </a>
              <a
                className="nav-btn nav-google"
                href={buildGoogleMapsUrl(station)}
                target="_blank"
                rel="noreferrer"
              >
                <Navigation size={14} /> 구글지도
              </a>
            </div>
          )}
        </div>
      )}

      <div className="charger-list-section">
        <div className="charger-list-title">
          <span className="charger-list-title-left">
            <PlugZap size={14} />
            <span>
              {station.hasLiveStatus === false
                ? `충전소 구성 (총 ${station.totalCount}기)`
                : `NACS 충전기 현황 (${station.chargers.length}기)`}
            </span>
          </span>
          {station.hasLiveStatus !== false &&
            (liveChecking ? (
              <span className="charger-sync-time live-checking">실시간 확인중...</span>
            ) : (
              pollLabel && (
                <span
                  className={`charger-sync-time ${
                    liveCheckedAt ? 'live' : isStale ? 'stale' : ''
                  }`}
                >
                  {liveCheckedAt ? '실시간' : '조회'} {pollLabel}
                  {!liveCheckedAt && isStale ? ' (지연)' : ''}
                </span>
              )
            ))}
        </div>
        {station.hasLiveStatus === false ? (
          <div className="sc-info-note">
            {station.stallSummary && <div className="sc-stall-summary">{station.stallSummary}</div>}
            <p>
              출처: supercharge.info · 실시간 빈자리 및 요금은 Tesla 앱에서 확인해 주세요.
            </p>
          </div>
        ) : (
          <div className="charger-grid">
            {station.chargers.map((charger) => {
              const meta = getChargerStatusMeta(charger.stat);
              const formattedNow = formatStatUpdDt(charger.nowTsdt ?? '');
              const formattedEnd = formatStatUpdDt(charger.lastTedt ?? '');
              const formattedUpd = formatStatUpdDt(charger.statUpdDt ?? '');
              const updTs = parseKstYmdhms(charger.statUpdDt ?? '');
              const endTs = parseKstYmdhms(charger.lastTedt ?? '');
              const nowTs = parseKstYmdhms(charger.nowTsdt ?? '');
              const maxDriftMs = 30 * 60 * 1000;

              let eventLabel = '';
              if (
                charger.stat === '3' &&
                formattedNow &&
                (!Number.isFinite(updTs) || !Number.isFinite(nowTs) || updTs - nowTs <= maxDriftMs)
              ) {
                eventLabel = `충전 시작 ${formattedNow}`;
              } else if (
                charger.stat === '2' &&
                formattedEnd &&
                (!Number.isFinite(updTs) || !Number.isFinite(endTs) || updTs - endTs <= maxDriftMs)
              ) {
                eventLabel = `최근 종료 ${formattedEnd}`;
              } else if (formattedUpd) {
                eventLabel = `상태변경 ${formattedUpd}`;
              }

              return (
                <div key={charger.chgerId} className={`charger-item tone-${meta.tone}`}>
                  <div className="charger-item-top">
                    <span className="charger-id">#{charger.chgerId}</span>
                    <span className={`charger-status tone-${meta.tone}`}>{meta.label}</span>
                  </div>
                  <div className="charger-item-meta">
                    <span>{getChargerTypeLabel(charger.chgerType)}</span>
                    {charger.output > 0 && <span>{charger.output}kW</span>}
                  </div>
                  {eventLabel && <div className="charger-updated">{eventLabel}</div>}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
