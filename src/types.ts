export interface NacsCharger {
  chgerId: string;
  chgerType: string;
  stat: string;
  statUpdDt: string;
  output: number;
  method: string;
}

export interface NacsStation {
  statId: string;
  statNm: string;
  addr: string;
  addrDetail?: string;
  location: string;
  floorLabel?: string;
  lat: number;
  lng: number;
  useTime: string;
  busiId?: string;
  busiNm: string;
  busiCall: string;
  parkingFree: string;
  limitYn: string;
  limitDetail: string;
  note: string;
  zcode: string;
  maxOutput: number;
  hasPureNacs: boolean;
  hasComboNacs: boolean;
  availableCount: number;
  chargingCount: number;
  totalCount: number;
  dataSource?: 'evcharger' | 'supercharge.info';
  hasLiveStatus?: boolean;
  otherEVs?: boolean;
  stallSummary?: string;
  chargers: NacsCharger[];
}

export interface NacsStationWithDistance extends NacsStation {
  distanceKm: number | null;
}

export interface NacsDataset {
  updatedAt: string;
  statusUpdatedAt?: string;
  isSample: boolean;
  source: string;
  totalStations: number;
  totalChargers: number;
  stations: NacsStation[];
}

export type NacsTypeFilter = 'all' | '09' | '10';

export interface FilterState {
  query: string;
  type: NacsTypeFilter;
  onlySupercharger: boolean;
  onlyAvailable: boolean;
  onlyFreeParking: boolean;
  onlyPublic: boolean;
}

export interface Coordinates {
  lat: number;
  lng: number;
}

declare global {
  interface Window {
    naver?: {
      maps: {
        LatLng: new (lat: number, lng: number) => unknown;
        Point: new (x: number, y: number) => unknown;
        Map: new (
          el: HTMLElement,
          options: {
            center: unknown;
            zoom: number;
            minZoom?: number;
            maxZoom?: number;
            zoomControl?: boolean;
            zoomControlOptions?: { position?: unknown };
            mapDataControl?: boolean;
            scaleControl?: boolean;
          },
        ) => NaverMapInstance;
        Marker: new (options: {
          position: unknown;
          map: NaverMapInstance;
          title?: string;
          zIndex?: number;
          icon?: {
            content: string;
            anchor?: unknown;
          };
        }) => NaverMarkerInstance;
        Event: {
          addListener: (target: unknown, eventName: string, handler: () => void) => void;
          clearInstanceListeners: (target: unknown) => void;
          trigger?: (target: unknown, eventName: string) => void;
        };
        Position?: {
          TOP_RIGHT?: unknown;
        };
      };
    };
    navermap_authFailure?: () => void;
  }
}

export interface NaverMapInstance {
  panTo: (latLng: unknown, options?: { duration?: number }) => void;
  morph?: (latLng: unknown, zoom?: number, options?: { duration?: number }) => void;
  setCenter: (latLng: unknown) => void;
  setZoom: (zoom: number, effect?: boolean) => void;
  getZoom?: () => number;
  getCenter: () => { lat: () => number; lng: () => number };
  destroy?: () => void;
}

export interface NaverMarkerInstance {
  setMap: (map: NaverMapInstance | null) => void;
}
