import { CoreWebVitals, Issue, RawPageData, TechScoreResult } from '../types';
import { TECH_THRESHOLDS } from './thresholds';

const stripTrailingSlash = (url: string) => url.replace(/\/+$/, '');

export class TechScoringEngine {
  public static calculate(page: RawPageData): TechScoreResult {
    const issues: Issue[] = [];

    // Aucune réponse HTTP : les balises ne peuvent pas être jugées (évite une cascade de fausses alertes)
    if (page.fetchError) {
      issues.push({
        id: `fetch-failed-${page.path}`,
        pillar: 'TECH',
        severity: 'CRITICAL',
        code: 'FETCH_FAILED',
        title: 'Page injoignable lors du crawl',
        description: `Aucune réponse HTTP n'a été reçue (${page.fetchError}). Le contenu de la page n'a pas pu être analysé.`,
        recommendation: 'Vérifiez que la page répond rapidement (moins de 10 s) puis relancez l’audit.',
        stepsToResolve: [
          'Ouvrir l’URL dans un navigateur pour confirmer qu’elle répond.',
          'Contrôler le temps de réponse du serveur et les éventuelles limitations de débit (pare-feu, CDN).',
          'Relancer l’audit.'
        ],
        affectedUrl: page.url
      });
      return {
        score: 0,
        unmeasuredPoints: 0,
        breakdown: {
          coreWebVitals: 0,
          architecture: 0,
          crawlability: 0,
          securityAndHttp: 0,
          htmlStructure: 0,
          metadataAndMedia: 0
        },
        issues
      };
    }

    // Critères que le crawl ne mesure pas : exclus du score plutôt que crédités de points fictifs
    let unmeasuredPoints = 0;
    let cwvScore = 0;
    let archScore = 0;
    let crawlScore = 0;
    let securityScore = 0;
    let htmlScore = 0;
    let metaScore = 0;

    // 1. Core Web Vitals (25 pts)
    // Core Web Vitals : non mesurés par le crawl HTTP (nécessite PageSpeed Insights)
    const cwv: CoreWebVitals = page.coreWebVitals ?? {};
    
    // LCP (10 pts)
    if (typeof cwv.lcp !== 'number') {
      unmeasuredPoints += 10;
    } else if (cwv.lcp <= 2.5) {
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

    // INP (8 pts) : seulement disponible en données de terrain (trafic suffisant)
    if (typeof cwv.inp !== 'number') {
      unmeasuredPoints += 8;
    } else if (cwv.inp <= 200) {
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
    if (typeof cwv.cls !== 'number') {
      unmeasuredPoints += 7;
    } else if (cwv.cls <= 0.1) {
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
    // Profondeur de clic (10 pts). Une page atteinte seulement par le sitemap n'a pas de profondeur mesurable.
    if (page.depth < 0) {
      unmeasuredPoints += 10;
    } else if (page.depth <= 3) {
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

    // Connexité & Pages Orphelines (10 pts). La page d'accueil est le point d'entrée du crawl : jamais orpheline.
    // Si le crawl a été tronqué (limite de pages), les liens entrants sont un minimum : un compte faible n'est pas
    // une preuve, le critère sort du dénominateur au lieu de pénaliser à tort.
    const graphComplete = page.linkGraphComplete !== false;
    if (page.depth === 0 || page.inlinksCount >= TECH_THRESHOLDS.goodInlinks) {
      archScore += 10;
    } else if (page.discoveredVia === 'sitemap' && page.httpStatus >= 400) {
      // URL du sitemap en erreur : l'anomalie HTTP suffit, le maillage d'une page inexistante n'a pas de sens
      unmeasuredPoints += 10;
    } else if (page.discoveredVia === 'sitemap' && graphComplete) {
      archScore += 0;
      issues.push({
        id: `arch-orphan-${page.path}`,
        pillar: 'TECH',
        severity: 'CRITICAL',
        code: 'ORPHAN_PAGE',
        title: 'Page orpheline : listée dans le sitemap, aucun lien depuis le site',
        description:
          "Cette URL figure dans le sitemap, mais aucune page accessible depuis l'accueil ne pointe vers elle (tous les liens du site ont été suivis).",
        recommendation: "Reliez cette page à la structure interne du site, ou retirez-la du sitemap si elle est obsolète.",
        stepsToResolve: [
          'Ajouter un lien d’accès depuis une page pilier parente.',
          "Vérifier si l'URL doit être conservée ou redirigée en 301 si obsolète."
        ],
        affectedUrl: page.url,
        metadata: { inlinksCount: page.inlinksCount }
      });
    } else if (!graphComplete) {
      unmeasuredPoints += 10;
    } else {
      archScore += 5;
      issues.push({
        id: `arch-inlinks-${page.path}`,
        pillar: 'TECH',
        severity: 'WARNING',
        code: 'LOW_INLINKS_COUNT',
        title: 'Faible maillage interne entrant',
        description: `Seules ${page.inlinksCount} page(s) du site pointent vers cette page (tous les liens du site ont été suivis).`,
        recommendation: 'Créez au moins 3 liens contextuels pointant vers cette page avec des ancres variées.',
        stepsToResolve: [
          'Identifier 2 ou 3 pages thématiquement proches.',
          'Insérer des liens contextuels naturels pointant vers cette URL.'
        ],
        affectedUrl: page.url,
        metadata: { inlinksCount: page.inlinksCount }
      });
    }

    // 3. Crawlabilité & Indexation (15 pts)
    // robots.txt (5 pts)
    if (page.isBlockedByRobotsTxt === undefined) {
      unmeasuredPoints += 5;
    } else if (!page.isBlockedByRobotsTxt) {
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
    if (page.inSitemap === undefined) {
      unmeasuredPoints += 5;
    } else if (page.inSitemap) {
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

    // Balise Canonique (5 pts). Une canonique vers une autre URL peut retirer la page de l'index : c'est plus
    // grave qu'une canonique absente, souvent bénigne. Comparaison sans protocole ni www, sur l'URL finale.
    const canonicalKey = (url: string) => stripTrailingSlash(url.replace(/^https?:\/\/(www\.)?/, ''));
    if (page.canonicalUrl && canonicalKey(page.canonicalUrl) === canonicalKey(page.finalUrl ?? page.url)) {
      crawlScore += 5;
    } else if (!page.canonicalUrl) {
      crawlScore += 3;
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
      crawlScore += 0;
      issues.push({
        id: `crawl-canonical-elsewhere-${page.path}`,
        pillar: 'TECH',
        severity: 'WARNING',
        code: 'CANONICAL_ELSEWHERE',
        title: 'Canonique vers une autre URL',
        description: `La balise canonique désigne ${page.canonicalUrl} : Google risque d’indexer cette autre URL à la place de la page.`,
        recommendation: 'Si la page doit être indexée, faites pointer sa canonique vers elle-même.',
        stepsToResolve: [
          'Vérifier que l’URL désignée est bien la version de référence voulue.',
          `Sinon, remplacer la canonique par <link rel="canonical" href="${page.finalUrl ?? page.url}">.`
        ],
        affectedUrl: page.url
      });
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

    // Code de réponse HTTP (5 pts) : réponse finale en 2xx ; si des redirections sont traversées, leurs codes comptent
    const redirects = page.redirectStatuses ?? [];
    const temporary = redirects.some((status) => ![301, 308].includes(status));
    if (page.httpStatus >= 200 && page.httpStatus < 300 && redirects.length === 0) {
      securityScore += 5;
    } else if (page.httpStatus >= 200 && page.httpStatus < 300 && !temporary) {
      securityScore += 3;
    } else if (page.httpStatus < 400) {
      securityScore += 1;
      issues.push({
        id: `sec-temp-redirect-${page.path}`,
        pillar: 'TECH',
        severity: 'WARNING',
        code: 'TEMPORARY_REDIRECT',
        title: `Redirection temporaire (${redirects.filter((status) => ![301, 308].includes(status)).join(', ') || page.httpStatus})`,
        description: `L’URL liée passe par une redirection temporaire (codes : ${redirects.join(' puis ') || page.httpStatus}) au lieu d’une redirection permanente 301.`,
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
        description: `La page répond avec le code d’erreur ${page.httpStatus}. Le contenu est inaccessible.${page.discoveredVia === 'sitemap' ? ' Cette URL est listée dans le sitemap XML : corrigez-la ou retirez-la du sitemap.' : ''}`,
        recommendation: 'Corrigez la ressource manquante ou effectuez une redirection 301.',
        stepsToResolve: [
          'Si 404 : Créer la page ou rediriger en 301 vers l’équivalent le plus proche.',
          'Si 500 : Corriger l’erreur de serveur dans les logs applicatifs.'
        ],
        affectedUrl: page.url
      });
    }

    // Chaîne de redirection (5 pts). Une redirection unique est déjà comptée dans « Code HTTP » : seule une chaîne
    // (2 sauts ou plus) coûte des points ici, pour ne pas pénaliser deux fois le même fait.
    if (page.redirectHops <= 1) {
      securityScore += 5;
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
    // Un H1 unique et non vide suffit : sa longueur n'a aucun effet démontré sur le classement
    if (page.h1Count === 1 && page.h1 && page.h1.trim().length > 0) {
      htmlScore += 8;
      const h1Length = page.h1.trim().length;
      if (h1Length < TECH_THRESHOLDS.h1.min || h1Length > TECH_THRESHOLDS.h1.max) {
        issues.push({
          id: `html-h1-length-${page.path}`,
          pillar: 'TECH',
          severity: 'INFO',
          code: 'H1_LENGTH_UNOPTIMIZED',
          title: `H1 ${h1Length > TECH_THRESHOLDS.h1.max ? 'long' : 'court'} (${h1Length} caractères)`,
          description: `Le H1 compte ${h1Length} caractères. Google ne classe pas selon la longueur du H1 ; un H1 de ${TECH_THRESHOLDS.h1.min} à ${TECH_THRESHOLDS.h1.max} caractères reste plus lisible.`,
          recommendation: 'Optionnel : reformuler le H1 pour qu’il soit plus lisible.',
          stepsToResolve: ['Reformuler le H1 en plaçant le sujet principal au début.'],
          affectedUrl: page.url
        });
      }
    } else if (page.h1Count > 1) {
      htmlScore += 8;
      issues.push({
        id: `html-multiple-h1-${page.path}`,
        pillar: 'TECH',
        severity: 'INFO',
        code: 'MULTIPLE_H1',
        title: `Multiples balises H1 détectées (${page.h1Count})`,
        description: `La page comporte ${page.h1Count} balises <h1>. Google l'accepte, mais un H1 unique clarifie le sujet principal.`,
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
        severity: 'WARNING',
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

    // Hiérarchie H2-H6 : aucun effet démontré sur le classement, utile pour l'accessibilité.
    // Diagnostic hors score : ses 7 points sortent du dénominateur au lieu d'être accordés d'office.
    unmeasuredPoints += 7;
    if (!page.headingHierarchyValid) {
      issues.push({
        id: `html-headings-hierarchy-${page.path}`,
        pillar: 'TECH',
        severity: 'INFO',
        code: 'HEADING_HIERARCHY_SKIP',
        title: 'Saut dans la hiérarchie des titres (Hn)',
        description: `Des sauts de niveau de titres ont été détectés (${page.headingHierarchyErrors.slice(0, 5).join(', ')}${page.headingHierarchyErrors.length > 5 ? '…' : ''}).`,
        recommendation: 'Respectez l’arborescence sans sauter de niveau (ex: H2 puis H3).',
        stepsToResolve: [
          'Ne pas passer directement de H2 à H4 sans H3 intermédiaire.',
          'Utiliser des styles CSS pour la mise en forme sans détourner les balises Hn.'
        ],
        affectedUrl: page.url
      });
    }

    // 6. Balisage, Métadonnées & Médias (10 pts)
    // Title & Meta description (5 pts)
    const titleLen = page.title?.trim().length ?? 0;
    const descLen = page.metaDescription?.trim().length ?? 0;
    const { title: titleRange, metaDescription: descRange } = TECH_THRESHOLDS;
    const titleOk = titleLen >= titleRange.min && titleLen <= titleRange.max;
    const descOk = descLen >= descRange.min && descLen <= descRange.max;

    if (titleOk && descOk) {
      metaScore += 5;
    } else if (titleLen > 0 && descLen > 0) {
      metaScore += 3;
      issues.push({
        id: `meta-lengths-${page.path}`,
        pillar: 'TECH',
        severity: 'INFO',
        code: 'METADATA_LENGTH_UNOPTIMIZED',
        title: 'Balises Title ou Meta Description hors gabarit',
        description: `Title : ${titleLen} car. (optimal : ${titleRange.min}-${titleRange.max}) | Description : ${descLen} car. (optimal : ${descRange.min}-${descRange.max}).`,
        recommendation: 'Ajustez les longueurs de votre titre et description pour éviter la troncature dans la SERP.',
        stepsToResolve: [
          `Calibrer la balise <title> entre ${titleRange.min} et ${titleRange.max} caractères.`,
          `Rédiger une meta description percutante entre ${descRange.min} et ${descRange.max} caractères.`
        ],
        affectedUrl: page.url
      });
    } else {
      metaScore += 0;
      issues.push({
        id: `meta-missing-${page.path}`,
        pillar: 'TECH',
        severity: titleLen === 0 ? 'CRITICAL' : 'INFO',
        code: 'MISSING_METADATA',
        title: 'Balise Title ou Meta Description manquante',
        description:
          titleLen === 0 && descLen === 0
            ? 'Balise <title> et meta description manquantes.'
            : titleLen === 0
              ? 'Balise <title> manquante.'
              : 'Meta description manquante.',
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
    // Les critères non mesurés sortent du dénominateur : le score reste sur 100
    const rawScore = cwvScore + archScore + crawlScore + securityScore + htmlScore + metaScore;
    let totalScore = (rawScore / Math.max(1, 100 - unmeasuredPoints)) * 100;

    // Pénalité bloquante : si 4xx/5xx ou non-indexable, plafonner le score technique à 20 max
    if (page.httpStatus >= 400 || !page.isIndexable) {
      totalScore = Math.min(20, totalScore);
    }

    // Page en erreur 4xx/5xx : son contenu est une page d'erreur, les contrôles de H1, méta ou images n'ont pas
    // de sens. Seules les anomalies d'accès sont gardées (pas de fausses alertes en cascade).
    const reported =
      page.httpStatus >= 400
        ? issues.filter((issue) => issue.code.startsWith('HTTP_') || issue.code === 'BLOCKED_BY_ROBOTS_TXT')
        : issues;

    return {
      score: Math.round(totalScore),
      unmeasuredPoints,
      breakdown: {
        coreWebVitals: cwvScore,
        architecture: archScore,
        crawlability: crawlScore,
        securityAndHttp: securityScore,
        htmlStructure: htmlScore,
        metadataAndMedia: metaScore
      },
      issues: reported
    };
  }
}
