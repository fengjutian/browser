export type View = 'browser'|'library'|'search'|'ai'|'settings'
export interface BrowserTab { id:string; url:string; title:string; favicon?:string; loading:boolean; active:boolean; pinned:boolean; canGoBack?: boolean; canGoForward?: boolean; error?: BrowserTabError }
export type BrowserTabError = { kind: 'load-failed' | 'web-mode-required' | 'unsupported-protocol'; message: string }
export interface Document { id:string; title:string; url:string; source?:string; author?:string; summary?:string; markdown?:string; wordCount:number; status:'PENDING'|'PROCESSING'|'READY'|'FAILED'|'ARCHIVED'; tags:string[]; createdAt:string; starred:boolean }
export type TaskStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED'
export interface Task { id:string; kind:string; documentId?:string; payload:string; status:TaskStatus; attempts:number; maxAttempts:number; availableAt:string; startedAt?:string; finishedAt?:string; lastError?:string }
export type AIProviderType = 'openai-compatible' | 'ollama'
export interface AIProvider { id:string; type:AIProviderType; baseUrl:string; model:string; embeddingModel?:string; timeoutSeconds:number; hasApiKey:boolean; createdAt:string; updatedAt:string }
