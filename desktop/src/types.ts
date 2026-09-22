export type View = 'browser'|'library'|'search'|'ai'|'settings'
export interface BrowserTab { id:string; url:string; title:string; favicon?:string; loading:boolean; active:boolean; pinned:boolean; canGoBack?: boolean; canGoForward?: boolean; error?: BrowserTabError }
export type BrowserTabError = { kind: 'load-failed' | 'web-mode-required' | 'unsupported-protocol'; message: string }
export interface Document { id:string; title:string; url:string; source?:string; author?:string; summary?:string; markdown?:string; wordCount:number; status:'PENDING'|'PROCESSING'|'READY'|'FAILED'|'ARCHIVED'; tags:string[]; createdAt:string; starred:boolean }
