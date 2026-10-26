import { Issue, RawPageData, TechScoreResult } from '../types';

export class TechScoringEngine {
  public static calculate(page: RawPageData): TechScoreResult {
    const issues: Issue[] = [];
    let cwvScore = 0;
    let archScore = 0;
    let crawlScore = 0;
    let securityScore = 0;
    let htmlScore = 0;
    let metaScore = 0;

    // 1. Core Web Vitals (25 pts)
    const cwv = page.coreWebVitals ?? { lcp: 2.1, inp: 150, cls: 0.04 }; // Valeurs par défaut si indisponibles
    
    // LCP (10 pts)
    if (cwv.lcp <= 2.5) {
      cwvScore += 10;
    } else if (cwv.lcp <= 4.0) {
      cwvScore += 5;
      issues.push({
        id: `cwv-lcp-${page.path}`,
        pillar: 'TECH',
        severity: 'WARNING',
        code: 'CWV_LCP_SLOW',
        title: 'Largest Contentful Paint (LCP) modéré',
        description: `Le temps de chargement du plus grand élément visible (LCP) est de ${cwv.lcp.toFixed(1)}s (seuil optimal : <= 2.5s).`,
        recommendation: "Compressez l'image héro au format WebP/AVIF et appliquez fetchpriority='high'.",
        stepsToResolve: [
          "Convertir l'image héro au format moderne WebP ou AVIF.",
          "Ajouter l'attribut fetchpriority='high' et un preload dans le <head>.",
          "Différer les scripts JavaScript non critiques bloquant le rendu."
        ],
        affectedUrl: page.url,
        metadata: { lcp: cwv.lcp }
      });
    } else {
      cwvScore += 0;
      issues.push({
        id: `cwv-lcp-${page.path}`,
        pillar: 'TECH',
        severity: 'CRITICAL',
        code: 'CWV_LCP_CRITICAL',
        title: 'Largest Contentful Paint (LCP) critique',
        description: `Le LCP est de ${cwv.lcp.toFixed(1)}s (> 4.0s). Cela déclenche une forte pénalité algorithmique Google Page Experience sur mobile.`,
        recommendation: "Optimisez d'urgence les assets de tête de page et activez un cache CDN performant.",
        stepsToResolve: [
          "Optimiser et dimensionner strictement l'image LCP.",
          "Éliminer les ressources CSS bloquantes au-dessus de la ligne de flottaison.",
          "Vérifier le TTFB serveur et activer la mise en cache CDN (Cloudflare/Fastly)."
        ],
        affectedUrl: page.url,
        metadata: { lcp: cwv.lcp }
      });
    }

    // INP (8 pts)
    if (cwv.inp <= 200) {
      cwvScore += 8;
    } else if (cwv.inp <= 500) {
      cwvScore += 4;
      issues.push({
        id: `cwv-inp-${page.path}`,
        pillar: 'TECH',
        severity: 'WARNING',
        code: 'CWV_INP_SLOW',
        title: 'Interaction to Next Paint (INP) dégradé',
        description: `Le temps de réactivité aux interactions est de ${Math.round(cwv.inp)}ms (seuil : <= 200ms).`,
        recommendation: 'Allégez le thread principal en découpant les tâches JavaScript longues.',
        stepsToResolve: [
          'Découper les Long Tasks JavaScript de plus de 50ms via scheduler.yield().',
          'Déporter les scripts tiers (trackers, pixels) en mode async ou defer.',
          'Réduire la complexité des event listeners sur mobile.'
        ],
        affectedUrl: page.url,
        metadata: { inp: cwv.inp }
      });
    } else {
      cwvScore += 0;
      issues.push({
        id: `cwv-inp-${page.path}`,
        pillar: 'TECH',
        severity: 'CRITICAL',
        code: 'CWV_INP_CRITICAL',
        title: 'Interaction to Next Paint (INP) critique',
        description: `Le temps de réactivité est de ${Math.round(cwv.inp)}ms (> 500ms). L'interface freeze lors des interactions.`,
        recommendation: 'Refactorisez le JavaScript d’hydratation pour débloquer le thread principal.',
        stepsToResolve: [
          'Supprimer ou décaler le chargement des bibliothèques JavaScript lourdes.',
          'Utiliser des Web Workers pour les traitements de données complexes.',
          'Optimiser les animations CSS avec will-change et transform.'
        ],
        affectedUrl: page.url,
        metadata: { inp: cwv.inp }
      });
    }

    // CLS (7 pts)
    if (cwv.cls <= 0.1) {
      cwvScore += 7;
    } else if (cwv.cls <= 0.25) {
      cwvScore += 3;
      issues.push({
        id: `cwv-cls-${page.path}`,
        pillar: 'TECH',
        severity: 'WARNING',
        code: 'CWV_CLS_SHIFT',
        title: 'Sauts de mise en page perceptibles (CLS)',
        description: `Le score CLS est de ${cwv.cls.toFixed(2)} (seuil optimal : <= 0.1).`,
        recommendation: 'Réservez des dimensions explicites pour les images et bannières dynamiques.',
        stepsToResolve: [
          'Indiquer des attributs width et height explicites sur toutes les images et iframes.',
          'Réserver un min-height pour les encarts publicitaires ou widgets injectés.',
          'Utiliser font-display: optional ou swap avec métriques ajustées.'
        ],
        affectedUrl: page.url,
        metadata: { cls: cwv.cls }
      });
    } else {
      cwvScore += 0;
      issues.push({
        id: `cwv-cls-${page.path}`,
        pillar: 'TECH',
        severity: 'CRITICAL',
        code: 'CWV_CLS_CRITICAL',
        title: 'Instabilité visuelle sévère (CLS critique)',
        description: `Le score CLS est de ${cwv.cls.toFixed(2)} (> 0.25). Des éléments se décalent massivement au rendu.`,
        recommendation: 'Fixez immédiatement les ratios d’aspect de tous les conteneurs multimédias.',
        stepsToResolve: [
          'Définir aspect-ratio en CSS sur tous les blocs de contenu visuel.',
          'Ne jamais insérer de contenu DOM au-dessus d’éléments déjà rendus.',
          'Vérifier les polices web personnalisées provoquant des décalages textuels.'
        ],
        affectedUrl: page.url,
        metadata: { cls: cwv.cls }
      });
    }

    // 2. Architecture & Maillage Interne (20 pts)
    // Profondeur de clic (10 pts)
    if (page.depth <= 3) {
      archScore += 10;
    } else if (page.depth === 4) {
      archScore += 5;
      issues.push({
        id: `arch-depth-${page.path}`,
        pillar: 'TECH',
        severity: 'WARNING',
        code: 'CLICK_DEPTH_WARNING',
        title: 'Profondeur de clic élevée (4 clics)',
        description: `Cette page nécessite 4 clics depuis la page d'accueil pour être atteinte.`,
        recommendation: "Ajoutez un lien vers cette page dans un menu secondaire ou une page de catégorie de niveau 1.",
        stepsToResolve: [
          "Insérer un lien dans le menu de navigation ou le fil d'Ariane.",
          "Créer un maillage transversal depuis un article populaire de niveau 2."
        ],
        affectedUrl: page.url,
        metadata: { depth: page.depth }
      });
    } else {
      archScore += 0;
      issues.push({
        id: `arch-depth-${page.path}`,
        pillar: 'TECH',
        severity: 'CRITICAL',
        code: 'CLICK_DEPTH_CRITICAL',
        title: 'Page trop profondément enfouie (>= 5 clics)',
        description: `Cette page est située à ${page.depth} clics de la racine. Les robots risquent de l'ignorer.`,
        recommendation: "Rapprochez immédiatement cette page de la racine dans l'arborescence du site.",
        stepsToResolve: [
          "Inclure la page dans le sitemap XML et dans les liens de pied de page clés.",
          "Repenser l'architecture de navigation pour limiter la profondeur maximale à 3 clics."
        ],
        affectedUrl: page.url,
        metadata: { depth: page.depth }
      });
    }

    // Connexité & Pages Orphelines (10 pts)
    if (page.inlinksCount >= 3) {
      archScore += 10;
    } else if (page.inlinksCount >= 1) {
      archScore += 5;
      issues.push({
        id: `arch-inlinks-${page.path}`,
        pillar: 'TECH',
        severity: 'WARNING',
        code: 'LOW_INLINKS_COUNT',
        title: 'Faible maillage interne entrant',
        description: `Cette page ne reçoit que ${page.inlinksCount} lien(s) interne(s) sur tout le site.`,
        recommendation: 'Créez au moins 3 liens contextuels pointant vers cette page avec des ancres variées.',
        stepsToResolve: [
          'Identifier 2 ou 3 pages thématiquement proches.',
          'Insérer des liens contextuels naturels pointant vers cette URL.'
        ],
        affectedUrl: page.url,
        metadata: { inlinksCount: page.inlinksCount }
      });
    } else {
      archScore += 0;
      issues.push({
        id: `arch-orphan-${page.path}`,
        pillar: 'TECH',
        severity: 'CRITICAL',
        code: 'ORPHAN_PAGE',
        title: 'Page orpheline détectée (0 lien interne)',
        description: "Aucun lien interne ne pointe vers cette URL. Elle n'est accessible que via le sitemap ou un accès direct.",
        recommendation: "Reliez d'urgence cette page orpheline à la structure interne du site.",
        stepsToResolve: [
          'Ajouter un lien d’accès depuis une page pilier parente.',
          "Vérifier si l'URL doit être conservée ou redirigée en 301 si obsolète."
        ],
        affectedUrl: page.url,
        metadata: { inlinksCount: 0 }
      });
    }

    // 3. Crawlabilité & Indexation (15 pts)
    // robots.txt (5 pts)
    if (!page.isBlockedByRobotsTxt) {
      crawlScore += 5;
    } else {
      crawlScore += 0;
      issues.push({
        id: `crawl-robotstxt-${page.path}`,
        pillar: 'TECH',
        severity: 'CRITICAL',
        code: 'BLOCKED_BY_ROBOTS_TXT',
        title: 'URL bloquée par le fichier robots.txt',
        description: 'Une directive Disallow dans robots.txt interdit l’exploration de cette page par Googlebot.',
        recommendation: 'Supprimez la directive bloquante dans votre fichier robots.txt.',
        stepsToResolve: [
          'Ouvrir le fichier robots.txt à la racine du domaine.',
          'Retirer la ligne Disallow ciblant ce chemin.',
          'Tester la prise en compte dans Google Search Console.'
        ],
        affectedUrl: page.url
      });
    }

    // Sitemap XML (5 pts)
    if (page.inSitemap) {
      crawlScore += 5;
    } else {
      crawlScore += 2;
      issues.push({
        id: `crawl-sitemap-${page.path}`,
        pillar: 'TECH',
        severity: 'INFO',
        code: 'MISSING_FROM_SITEMAP',
        title: 'Page absente du sitemap XML',
        description: 'Cette URL canonique valide n’est pas déclarée dans vos sitemaps XML.',
        recommendation: 'Inscrivez cette URL dans le sitemap.xml avec une balise lastmod à jour.',
        stepsToResolve: [
          'Régénérer le sitemap dynamique pour y intégrer cette URL.',
          'Soumettre à nouveau le sitemap mis à jour à Google Search Console.'
        ],
        affectedUrl: page.url
      });
    }

    // Balise Canonique (5 pts)
    if (page.canonicalUrl && page.canonicalUrl === page.url) {
      crawlScore += 5;
    } else if (!page.canonicalUrl) {
      crawlScore += 2;
      issues.push({
        id: `crawl-canonical-missing-${page.path}`,
        pillar: 'TECH',
        severity: 'WARNING',
        code: 'MISSING_CANONICAL',
        title: 'Balise canonique absente',
        description: 'La page ne comporte aucune balise <link rel="canonical">.',
        recommendation: 'Déclarez une balise canonique auto-référente absolue dans le <head>.',
        stepsToResolve: [
          `Ajouter <link rel="canonical" href="${page.url}"> dans le <head>.`,
          'Veiller à utiliser impérativement l’URL absolue sécurisée en https://.'
        ],
        affectedUrl: page.url
      });
    } else {
      crawlScore += 3; // Canonique pointant vers une autre URL
    }

    // 4. Sécurité & Codes HTTP (15 pts)
    // SSL / HTTPS (5 pts)
    if (page.hasSsl) {
      securityScore += 5;
    } else {
      securityScore += 0;
      issues.push({
        id: `sec-ssl-${page.path}`,
        pillar: 'TECH',
        severity: 'CRITICAL',
        code: 'NO_HTTPS',
        title: 'Protocole HTTPS non sécurisé',
        description: 'La page est servie en HTTP non chiffré.',
        recommendation: 'Installez un certificat SSL et forcez la redirection 301 vers HTTPS.',
        stepsToResolve: [
          'Déployer un certificat SSL/TLS valide (Let’s Encrypt).',
          'Configurer la redirection permanente HTTP -> HTTPS dans Nginx/Apache/Vercel.'
        ],
        affectedUrl: page.url
      });
    }

    // Code de réponse HTTP (5 pts)
    if (page.httpStatus === 200) {
      securityScore += 5;
    } else if ([301, 308].includes(page.httpStatus)) {
      securityScore += 3;
    } else if ([302, 307].includes(page.httpStatus)) {
      securityScore += 1;
      issues.push({
        id: `sec-temp-redirect-${page.path}`,
        pillar: 'TECH',
        severity: 'WARNING',
        code: 'TEMPORARY_REDIRECT',
        title: 'Redirection temporaire 302/307',
        description: 'La page effectue une redirection temporaire au lieu d’une redirection permanente 301.',
        recommendation: 'Convertissez la redirection temporaire en 301 si le déplacement est définitif.',
        stepsToResolve: [
          'Changer le code de redirection en HTTP 301 dans vos règles de routage.'
        ],
        affectedUrl: page.url
      });
    } else {
      securityScore += 0;
      issues.push({
        id: `sec-http-error-${page.path}`,
        pillar: 'TECH',
        severity: 'CRITICAL',
        code: `HTTP_${page.httpStatus}`,
        title: `Erreur HTTP ${page.httpStatus}`,
        description: `La page répond avec le code d’erreur ${page.httpStatus}. Le contenu est inaccessible.`,
        recommendation: 'Corrigez la ressource manquante ou effectuez une redirection 301.',
        stepsToResolve: [
          'Si 404 : Créer la page ou rediriger en 301 vers l’équivalent le plus proche.',
          'Si 500 : Corriger l’erreur de serveur dans les logs applicatifs.'
        ],
        affectedUrl: page.url
      });
    }

    // Chaîne de redirection (5 pts)
    if (page.redirectHops === 0) {
      securityScore += 5;
    } else if (page.redirectHops === 1) {
      securityScore += 3;
    } else {
      securityScore += 0;
      issues.push({
        id: `sec-redirect-chain-${page.path}`,
        pillar: 'TECH',
        severity: 'WARNING',
        code: 'REDIRECT_CHAIN',
        title: `Chaîne de redirections (${page.redirectHops} sauts)`,
        description: `L’accès à cette page traverse ${page.redirectHops} redirections successives.`,
        recommendation: 'Pointez directement vers l’URL de destination finale.',
        stepsToResolve: [
          'Mettre à jour les liens internes pour pointer directement vers l’URL finale HTTP 200.'
        ],
        affectedUrl: page.url
      });
    }

    // 5. Structure HTML & Hiérarchie des Titres (15 pts)
    // H1 Unique (8 pts)
    if (page.h1Count === 1 && page.h1 && page.h1.trim().length >= 10 && page.h1.trim().length <= 70) {
      htmlScore += 8;
    } else if (page.h1Count > 1) {
      htmlScore += 3;
      issues.push({
        id: `html-multiple-h1-${page.path}`,
        pillar: 'TECH',
        severity: 'WARNING',
        code: 'MULTIPLE_H1',
        title: `Multiples balises H1 détectées (${page.h1Count})`,
        description: `La page comporte ${page.h1Count} balises <h1>, ce qui dilue le signal sémantique principal.`,
        recommendation: 'Conservez un seul H1 et convertissez les titres secondaires en H2.',
        stepsToResolve: [
          'Conserver une seule balise <h1> en haut de page.',
          'Rétrograder les autres balises <h1> en <h2>.'
        ],
        affectedUrl: page.url
      });
    } else {
      htmlScore += 0;
      issues.push({
        id: `html-missing-h1-${page.path}`,
        pillar: 'TECH',
        severity: 'CRITICAL',
        code: 'MISSING_H1',
        title: 'Balise H1 absente ou vide',
        description: 'La page ne possède aucun titre principal balisé en <h1>.',
        recommendation: 'Ajoutez une balise <h1> descriptive contenant le mot-clé principal.',
        stepsToResolve: [
          'Insérer une balise <h1> explicite de 20 à 60 caractères en haut du contenu.'
        ],
        affectedUrl: page.url
      });
    }

    // Hiérarchie H2-H6 (7 pts)
    if (page.headingHierarchyValid) {
      htmlScore += 7;
    } else if (page.headingHierarchyErrors.length <= 2) {
      htmlScore += 3;
      issues.push({
        id: `html-headings-hierarchy-${page.path}`,
        pillar: 'TECH',
        severity: 'WARNING',
        code: 'HEADING_HIERARCHY_SKIP',
        title: 'Saut dans la hiérarchie des titres (Hn)',
        description: `Des sauts de niveau de titres ont été détectés (${page.headingHierarchyErrors.join(', ')}).`,
        recommendation: 'Respectez l’arborescence sans sauter de niveau (ex: H2 puis H3).',
        stepsToResolve: [
          'Ne pas passer directement de H2 à H4 sans H3 intermédiaire.',
          'Utiliser des styles CSS pour la mise en forme sans détourner les balises Hn.'
        ],
        affectedUrl: page.url
      });
    } else {
      htmlScore += 0;
    }

    // 6. Balisage, Métadonnées & Médias (10 pts)
    // Title & Meta description (5 pts)
    const titleLen = page.title?.trim().length ?? 0;
    const descLen = page.metaDescription?.trim().length ?? 0;
    const titleOk = titleLen >= 30 && titleLen <= 65;
    const descOk = descLen >= 110 && descLen <= 165;

    if (titleOk && descOk) {
      metaScore += 5;
    } else if (titleLen > 0 && descLen > 0) {
      metaScore += 3;
      issues.push({
        id: `meta-lengths-${page.path}`,
        pillar: 'TECH',
        severity: 'WARNING',
        code: 'METADATA_LENGTH_UNOPTIMIZED',
        title: 'Balises Title ou Meta Description hors gabarit',
        description: `Title : ${titleLen} car. (optimal : 30-65) | Description : ${descLen} car. (optimal : 110-165).`,
        recommendation: 'Ajustez les longueurs de votre titre et description pour éviter la troncature dans la SERP.',
        stepsToResolve: [
          'Calibrer la balise <title> entre 45 et 60 caractères.',
          'Rédiger une meta description percutante entre 130 et 155 caractères.'
        ],
        affectedUrl: page.url
      });
    } else {
      metaScore += 0;
      issues.push({
        id: `meta-missing-${page.path}`,
        pillar: 'TECH',
        severity: 'CRITICAL',
        code: 'MISSING_METADATA',
        title: 'Balise Title ou Meta Description manquante',
        description: titleLen === 0 ? 'Balise <title> manquante.' : 'Meta description manquante.',
        recommendation: 'Renseignez impérativement ces métadonnées fondamentales.',
        stepsToResolve: [
          'Ajouter une balise <title> unique et descriptive dans le <head>.',
          'Ajouter une <meta name="description" content="..."> incitative.'
        ],
        affectedUrl: page.url
      });
    }

    // Images alt (5 pts)
    if (page.imagesTotal === 0 || page.imagesWithAlt / Math.max(1, page.imagesTotal) >= 0.9) {
      metaScore += 5;
    } else if (page.imagesWithAlt / page.imagesTotal >= 0.7) {
      metaScore += 3;
      const missing = page.imagesTotal - page.imagesWithAlt;
      issues.push({
        id: `media-alt-${page.path}`,
        pillar: 'TECH',
        severity: 'WARNING',
        code: 'IMAGES_MISSING_ALT',
        title: `${missing} image(s) sans texte alternatif`,
        description: `${page.imagesWithAlt}/${page.imagesTotal} images possèdent un attribut alt renseigné.`,
        recommendation: 'Ajoutez un texte alt descriptif sur toutes vos images éditoriales.',
        stepsToResolve: [
          'Renseigner l’attribut alt="Description du visuel" sur chaque balise <img>.',
          'Pour les visuels purement décoratifs, utiliser alt="" pour l’accessibilité.'
        ],
        affectedUrl: page.url
      });
    } else {
      metaScore += 0;
      const missing = page.imagesTotal - page.imagesWithAlt;
      issues.push({
        id: `media-alt-crit-${page.path}`,
        pillar: 'TECH',
        severity: 'CRITICAL',
        code: 'IMAGES_SEVERELY_MISSING_ALT',
        title: `Manque sévère de textes alternatifs (${missing} images sans alt)`,
        description: `Plus de 30% des images sont dépourvues d’attribut alt.`,
        recommendation: 'Complétez d’urgence les balises alt de vos visuels.',
        stepsToResolve: [
          'Identifier les images sans attribut alt dans le rapport détaillé.',
          'Renseigner une description pertinente pour chacune.'
        ],
        affectedUrl: page.url
      });
    }

    // Calcul du score technique brut
    let totalScore = cwvScore + archScore + crawlScore + securityScore + htmlScore + metaScore;

    // Pénalité bloquante : si 4xx/5xx ou non-indexable, plafonner le score technique à 20 max
    if (page.httpStatus >= 400 || !page.isIndexable) {
      totalScore = Math.min(20, totalScore);
    }

    return {
      score: Math.round(totalScore),
      breakdown: {
        coreWebVitals: cwvScore,
        architecture: archScore,
        crawlability: crawlScore,
        securityAndHttp: securityScore,
        htmlStructure: htmlScore,
        metadataAndMedia: metaScore
      },
      issues
    };
  }
}
