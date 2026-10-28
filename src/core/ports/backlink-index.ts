/**
 * Index de liens entre domaines (graphe Common Crawl préparé localement). Ne donne que les domaines référents :
 * ni page source, ni texte du lien, ni attribut nofollow (voir la vérification en direct).
 */
export interface BacklinkIndexPort {
  /** Base préparée et lisible */
  isAvailable(): boolean;
  /** Version du graphe préparé (ex. cc-main-2026-aug-sep-oct) */
  release(): string | undefined;
  /** Domaines qui font un lien vers `domain` ; null si le domaine est absent du graphe */
  referringDomains(domain: string): Promise<{ release: string; domains: { domain: string; hosts: number }[] } | null>;
}
