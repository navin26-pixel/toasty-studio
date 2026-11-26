/**
 * BACKEND INTEGRATION POINT: Moxie AI.
 * While moxieService is null the interface shows "Coming soon", disables Send and never fakes a reply.
 * To connect it, export an object with ask() (for example one that calls a future /api/moxie endpoint)
 * and the chat panel starts working with no UI change.
 */
export interface MoxieService {
  ask(prompt: string): Promise<string>;
}

export const moxieService = null as MoxieService | null;