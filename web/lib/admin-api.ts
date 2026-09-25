export class AdminApiError extends Error { constructor(public status:number){ super(`Admin API returned ${status}`) } }
export async function adminGet<T>(path:string, signal?:AbortSignal):Promise<T>{ const response=await fetch(path,{cache:"no-store",credentials:"same-origin",signal}); if(!response.ok) throw new AdminApiError(response.status); return response.json() }
