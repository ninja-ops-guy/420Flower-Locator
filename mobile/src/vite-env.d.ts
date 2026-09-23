/// <reference types="vite/client" />
interface ImportMetaEnv { readonly VITE_PROVIDER_CONFIG_URL?: string; }
interface ImportMeta { readonly env: ImportMetaEnv; }
declare module "magvar" { export function magvar(latitude:number,longitude:number,altitude?:number,when?:number|Date):number; }
