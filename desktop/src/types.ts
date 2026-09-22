export type View = 'browser'|'library'|'search'|'ai'|'settings'
export interface BrowserTab { id:string; url:string; title:string; favicon?:string; loading:boolean; active:boolean; pinned:boolean }
export interface Document { id:string; title:string; url:string; source?:string; author?:string; summary?:string; markdown?:string; wordCount:number; status:'PENDING'|'PROCESSING'|'READY'|'FAILED'|'ARCHIVED'; tags:string[]; createdAt:string; starred:boolean }
