export type OsmType = "node" | "way" | "relation";
export interface LatLon { latitude: number; longitude: number; }
export interface Poi { id:string; osmType:OsmType; osmId:number; name:string|null; latitude:number; longitude:number; address?:string; openingHours?:string; website?:string; phone?:string; recreational?:boolean; medical?:boolean; cbd?:"yes"|"no"|"only"; }
export interface Dispensary extends Poi { distanceMeters:number; bearingDegrees:number; }
export interface Fix extends LatLon { accuracy:number; timestamp:number; source:"device"|"sample"; label?:string; }
export type ThemeMode="system"|"light"|"dark";
export type Units="mi"|"km";
export type TypeFilter="any"|"recreational"|"medical";
export type LocationPermission="unknown"|"prompt"|"requesting"|"granted"|"denied"|"unsupported"|"insecure";
export type Phase="BOOT"|"CHECK_PERMISSION"|"NEEDS_CONSENT"|"REQUESTING"|"LOCATION_REQUIRED"|"LOCATING"|"GPS_UNAVAILABLE"|"SEARCHING"|"EXPAND_RADIUS"|"NO_RESULTS"|"SEARCH_FAILED"|"DESTINATION_FOUND";
