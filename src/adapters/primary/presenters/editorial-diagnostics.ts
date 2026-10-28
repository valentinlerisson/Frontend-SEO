import type { InspectionData } from '@/lib/audit-data';
import type { ContentQualityInsights, EditorialSignals, PageRole } from '@/core/domain/types';

type Accordion = InspectionData['editorial']['accordions'][number];

const ZONE_LABEL = { TITLE: 'Title', H1: 'H1', CONTENT: 'contenu' } as const;
const LEVEL_LABEL = { LOW: 'faible', MEDIUM: 'moyen', HIGH: 'élevé' } as const;

const DIAGNOSTIC_NOTE =
  'Diagnostic hors barème : il n’influence pas le score sur 100.';

/** Accordéon affiché quand la donnée n'existe pas (ancien audit ou analyse IA indisponible) */
export function unavailableAccordion(title: string, reason: string): Accordion {
  return { title, scoreText: 'Non disponible', aiReasoning: reason, items: [] };
}

export function freshnessAccordion(signals: EditorialSignals): Accordion {
  const { outdatedMentions, lastUpdated } = signals.freshness;
  const items: Accordion['items'] = [];

  if (lastUpdated) {
    const ageYears = (Date.now() - new Date(lastUpdated).getTime()) / (365.25 * 24 * 3600 * 1000);
    items.push({
      text: `Dernière mise à jour déclarée : ${lastUpdated.slice(0, 10)}`,
      status: ageYears >= 2 ? 'warning' : 'valid',
    });
  } else {
    items.push({
      text: 'Aucune date de mise à jour déclarée sur la page',
      status: outdatedMentions.length > 0 ? 'warning' : 'valid',
    });
  }

  if (outdatedMentions.length === 0) {
    items.push({ text: 'Aucune année révolue détectée dans le Title, le H1 ou le contenu', status: 'valid' });
  }
  for (const mention of outdatedMentions) {
    items.push({
      text: `${mention.year} (${ZONE_LABEL[mention.zone]}) : « …${mention.excerpt}… »`,
      status: 'warning',
    });
  }

  return {
    title: '8. Fraîcheur & obsolescence',
    scoreText: outdatedMentions.length > 0 ? `${outdatedMentions.length} mention(s)` : 'RAS',
    aiReasoning: `Détection automatique des années vieilles d'au moins deux ans, avec leur contexte : une date historique légitime peut rester. ${DIAGNOSTIC_NOTE}`,
    items,
  };
}

export function readabilityAccordion(signals: EditorialSignals, wordCount: number): Accordion {
  const r = signals.readability;
  const reliable = r.paragraphCount >= 3;
  const items: Accordion['items'] = [
    {
      text: reliable
        ? `Longueur moyenne d'un paragraphe : ${r.avgParagraphWords} mots (${r.longParagraphs}/${r.paragraphCount} dépassent 100 mots)`
        : `${r.paragraphCount} paragraphe(s) <p> détecté(s) : mesure peu fiable`,
      status: reliable && (r.avgParagraphWords > 80 || r.longParagraphs / r.paragraphCount > 0.4) ? 'warning' : 'valid',
    },
    {
      text:
        r.sentenceCount > 0
          ? `${Math.round(r.longSentenceRatio * 100)} % de phrases de plus de 25 mots (${r.sentenceCount} phrases)`
          : 'Aucune phrase analysable',
      status: r.sentenceCount >= 10 && r.longSentenceRatio > 0.35 ? 'warning' : 'valid',
    },
    {
      text: `${r.listCount} liste(s) à puces ou numérotées, ${r.tableCount} tableau(x)`,
      status: wordCount >= 600 && r.listCount + r.tableCount === 0 ? 'warning' : 'valid',
    },
  ];

  return {
    title: '9. Lisibilité & scannabilité',
    scoreText: reliable ? `${r.avgParagraphWords} mots/§` : 'Peu fiable',
    aiReasoning: `Mesures objectives sur le contenu principal (hors menu, en-tête et pied de page). ${DIAGNOSTIC_NOTE}`,
    items,
  };
}

export function inContentLinksAccordion(signals: EditorialSignals, wordCount: number): Accordion {
  const l = signals.inContentLinks;
  const items: Accordion['items'] = [
    {
      text: `${l.total} lien(s) dans le contenu principal : ${l.internal} interne(s), ${l.external} externe(s)`,
      status: 'valid',
      details: l.links.map((link) => ({
        label: link.text || '(lien sans texte d’ancre)',
        note: link.href,
        href: link.href,
        tag: `${link.internal ? 'Interne' : 'Externe'}${link.generic ? ' · ancre générique' : ''}`,
        status: link.generic ? ('warning' as const) : ('valid' as const),
      })),
    },
    {
      text:
        l.genericAnchors > 0
          ? `${l.genericAnchors} ancre(s) vide(s) ou générique(s) (« en savoir plus », « cliquez ici »…)`
          : 'Aucune ancre générique',
      status: l.genericAnchors > 0 ? 'warning' : 'valid',
      details: l.links
        .filter((link) => link.generic)
        .map((link) => ({
          label: link.text || '(lien sans texte d’ancre)',
          note: link.href,
          href: link.href,
          tag: link.internal ? 'Interne' : 'Externe',
          status: 'warning' as const,
        })),
    },
    {
      text:
        l.internal === 0
          ? 'Aucun lien interne dans le contenu principal'
          : `${l.internal} lien(s) interne(s) vers d'autres pages du site`,
      status: wordCount >= 500 && l.internal === 0 ? 'warning' : 'valid',
    },
  ];

  return {
    title: '10. Maillage dans le contenu',
    scoreText: `${l.total} lien(s)`,
    aiReasoning: `Seuls les liens du corps de la page comptent ici : menu, en-tête, pied de page et encarts latéraux sont exclus. ${DIAGNOSTIC_NOTE}`,
    items,
  };
}

export function qualityAccordion(quality: ContentQualityInsights, role: PageRole): Accordion {
  const { firstHandExperience: exp, informationGain: gain } = quality;
  // L'expérience vécue n'est attendue que d'un article, d'une offre ou d'une réalisation
  const expectsExperience = role === 'article' || role === 'offer' || role === 'case';

  const items: Accordion['items'] = [
    {
      text: exp.detected
        ? `Expérience vécue détectée (confiance ${LEVEL_LABEL[exp.confidence]})`
        : 'Peu de preuves d’expérience vécue',
      status: exp.detected ? 'valid' : expectsExperience ? 'warning' : 'info',
      details: exp.evidence.map((quote) => ({ label: `« ${quote} »`, tag: 'Extrait', status: 'valid' as const })),
    },
    {
      text: `Gain d'information ${LEVEL_LABEL[gain.level]} par rapport à un contenu générique`,
      status: gain.level === 'LOW' ? 'warning' : 'valid',
    },
    {
      text: gain.hasOriginalData ? 'Données ou méthode propres présentes' : 'Aucune donnée ni méthode propre repérée',
      status: gain.hasOriginalData ? 'valid' : 'warning',
    },
    {
      text: gain.hasConcreteCases ? 'Cas concrets ou exemples présents' : 'Aucun cas concret repéré',
      status: gain.hasConcreteCases ? 'valid' : 'warning',
    },
    // Évoquer les limites d'une méthode ou d'un produit n'est attendu que d'un article
    ...(role === 'article'
      ? [
          {
            text: gain.mentionsLimits ? 'Limites et contraintes évoquées' : 'Aucune limite ni contrainte évoquée',
            status: gain.mentionsLimits ? ('valid' as const) : ('info' as const),
          },
        ]
      : []),
  ];

  if (gain.genericFluff.length > 0) {
    items.push({
      text: `${gain.genericFluff.length} passage(s) générique(s) repéré(s)`,
      status: 'warning',
      details: gain.genericFluff.map((passage) => ({ label: `« ${passage} »`, tag: 'Générique', status: 'warning' as const })),
    });
  }

  return {
    title: '11. Expérience vécue & gain d’information',
    scoreText: `Gain ${LEVEL_LABEL[gain.level]}`,
    aiReasoning: `${exp.advice} ${gain.advice} Indices fournis par l'IA, sans comparaison avec les pages concurrentes. ${DIAGNOSTIC_NOTE}`.replace(/\s+/g, ' '),
    items,
  };
}
