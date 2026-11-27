import {
  Clock,
  MapPin,
  Navigation,
  Phone,
  PlugZap,
  X,
  Zap,
} from 'lucide-react';
import type { NacsStationWithDistance } from '../types';
import {
  buildKakaoMapUrl,
  buildNaverMapUrl,
  buildTmapUrl,
  formatDistance,
  formatStatUpdDt,
  getChargerStatusMeta,
  getChargerTypeLabel,
  isTeslaStation,
} from '../utils/geo';
import { TeslaEmblem } from './TeslaEmblem';

interface StationDetailProps {
  station: NacsStationWithDistance;
  onClose: () => void;
}

export function StationDetail({ station, onClose }: StationDetailProps) {
  const distanceLabel = formatDistance(station.distanceKm);
  const isTesla = isTeslaStation(station);

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
          <h2>{station.statNm}</h2>
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
        <span className={station.availableCount > 0 ? 'status-pill available' : 'status-pill busy'}>
          충전대기 {station.availableCount} / {station.totalCount}기
        </span>
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
            {station.parkingFree === 'Y' ? '무료주차' : '주차요금 별도/확인필요'} ·{' '}
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

      <div className="nav-actions">
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
      </div>

      <div className="charger-list-section">
        <div className="charger-list-title">
          <PlugZap size={14} /> NACS 충전기 현황 ({station.chargers.length}기)
        </div>
        <div className="charger-grid">
          {station.chargers.map((charger) => {
            const meta = getChargerStatusMeta(charger.stat);
            const updatedLabel = formatStatUpdDt(charger.statUpdDt);
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
                {updatedLabel && <div className="charger-updated">갱신 {updatedLabel}</div>}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
