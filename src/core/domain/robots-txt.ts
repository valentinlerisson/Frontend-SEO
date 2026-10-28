/**
 * Lecture du robots.txt selon les règles de Google : le groupe le plus précis pour le robot
 * (« googlebot », à défaut « * »), motifs avec `*` et `$`, règle la plus longue prioritaire,
 * `Allow` l'emporte à longueur égale.
 */

export interface RobotsRules {
  rules: { allow: boolean; pattern: string }[];
  /** URL de sitemaps déclarées par des lignes `Sitemap:` */
  sitemaps: string[];
}

type Group = { agents: string[]; rules: RobotsRules['rules'] };

export function parseRobotsTxt(text: string, agent = 'googlebot'): RobotsRules {
  const groups: Group[] = [];
  const sitemaps: string[] = [];
  let current: Group | null = null;
  let collectingAgents = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, '').trim();
    const separator = line.indexOf(':');
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    if (key === 'sitemap') {
      if (value) sitemaps.push(value);
    } else if (key === 'user-agent') {
      // Des lignes user-agent consécutives partagent les mêmes règles
      if (!current || !collectingAgents) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      collectingAgents = true;
    } else if ((key === 'allow' || key === 'disallow') && current) {
      collectingAgents = false;
      // « Disallow: » vide : tout est autorisé, aucune règle à retenir
      if (value) current.rules.push({ allow: key === 'allow', pattern: value });
    } else {
      collectingAgents = false;
    }
  }

  const specific = groups.filter((group) => group.agents.includes(agent));
  const selected = specific.length > 0 ? specific : groups.filter((group) => group.agents.includes('*'));
  return { rules: selected.flatMap((group) => group.rules), sitemaps };
}

function patternToRegExp(pattern: string): RegExp {
  const anchored = pattern.endsWith('$');
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');
  return new RegExp(`^${body}${anchored ? '$' : ''}`);
}

/** Chemin (avec la requête éventuelle) autorisé ou non pour le robot */
export function isPathAllowed(robots: RobotsRules, pathWithQuery: string): boolean {
  let best: { allow: boolean; length: number } | null = null;
  for (const rule of robots.rules) {
    if (!patternToRegExp(rule.pattern).test(pathWithQuery)) continue;
    const length = rule.pattern.length;
    if (!best || length > best.length || (length === best.length && rule.allow)) {
      best = { allow: rule.allow, length };
    }
  }
  return best ? best.allow : true;
}
