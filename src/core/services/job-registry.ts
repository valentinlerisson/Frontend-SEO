/**
 * Travaux lancés en arrière-plan par ce processus : exploration et analyse IA d'un audit, mesure Google. Gardé sur
 * globalThis : le rechargement à chaud de Next.js recrée les modules mais pas le processus, un travail en cours y reste
 * connu. Après un arrêt du serveur, le registre est vide : tout travail marqué « en cours » en base est interrompu.
 * Un travail qui ne donne plus signe de vie (aucune avancée) pendant le délai fixé est aussi considéré comme interrompu.
 */
type Registry = { audits: Map<string, number>; serp: { running: boolean; heartbeat: number } };

const store = globalThis as typeof globalThis & { __auditlyJobs?: Registry };
const registry: Registry = (store.__auditlyJobs ??= { audits: new Map(), serp: { running: false, heartbeat: 0 } });

/** Exploration ou analyse IA sans avancée depuis 30 minutes : interrompue (une page ne prend pas si longtemps) */
export const AUDIT_STALE_MS = 30 * 60_000;
/** Mesure Google sans avancée depuis 15 minutes : interrompue (les pauses entre recherches durent quelques secondes) */
export const SERP_STALE_MS = 15 * 60_000;

export const jobRegistry = {
  startAudit(auditId: string) {
    registry.audits.set(auditId, Date.now());
  },
  /** Signe de vie : une page explorée ou analysée */
  beatAudit(auditId: string) {
    if (registry.audits.has(auditId)) registry.audits.set(auditId, Date.now());
  },
  endAudit(auditId: string) {
    registry.audits.delete(auditId);
  },
  auditAlive(auditId: string): boolean {
    const beat = registry.audits.get(auditId);
    return beat !== undefined && Date.now() - beat < AUDIT_STALE_MS;
  },

  startSerp() {
    registry.serp = { running: true, heartbeat: Date.now() };
  },
  /** Signe de vie : une recherche faite ou un relevé enregistré */
  beatSerp() {
    if (registry.serp.running) registry.serp.heartbeat = Date.now();
  },
  endSerp() {
    registry.serp = { running: false, heartbeat: 0 };
  },
  serpAlive(): boolean {
    return registry.serp.running && Date.now() - registry.serp.heartbeat < SERP_STALE_MS;
  }
};
