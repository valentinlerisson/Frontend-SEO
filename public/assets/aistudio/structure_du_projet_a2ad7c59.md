{
  "$schema": "https://json.schemastore.org/project-structure.json",
  "projectName": "seo-geo-saas-audit",
  "version": "1.0.0",
  "architecture": "hexagonal",
  "framework": "nextjs-app-router",
  "directories": {
    "src/core/domain": {
      "description": "Cœur métier pur sans dépendance externe",
      "files": [
        "entities/project.entity.ts",
        "entities/audit.entity.ts",
        "entities/page.entity.ts",
        "entities/global-issue.entity.ts",
        "value-objects/url.vo.ts",
        "value-objects/http-status.vo.ts",
        "ports/in/start-crawl.port.ts",
        "ports/in/launch-ai-analysis.port.ts",
        "ports/in/get-project-overview.port.ts",
        "ports/out/project-repository.port.ts",
        "ports/out/audit-repository.port.ts",
        "ports/out/crawler.port.ts",
        "ports/out/llm-analyzer.port.ts"
      ]
    },
    "src/core/application": {
      "description": "Cas d'usage et orchestration du domaine",
      "files": [
        "use-cases/start-new-audit.use-case.ts",
        "use-cases/execute-ai-audit.use-case.ts",
        "use-cases/calculate-scores.use-case.ts",
        "use-cases/refresh-audit.use-case.ts",
        "dtos/project.dto.ts"
      ]
    },
    "src/infrastructure": {
      "description": "Adaptateurs secondaires (base de données, services tiers, worker)",
      "files": [
        "persistence/prisma/schema.prisma",
        "crawler/crawlee-cheerio.adapter.ts",
        "llm/anthropic-claude.adapter.ts",
        "llm/prompts/editorial-audit.prompt.ts",
        "llm/prompts/geo-audit.prompt.ts",
        "queue/bullmq-job.adapter.ts"
      ]
    },
    "src/presentation": {
      "description": "Adaptateurs primaires UI (Composants React, State, Hooks)",
      "files": [
        "hooks/use-page-inspection.ts",
        "components/layouts/agency-sidebar.tsx",
        "components/layouts/project-sidebar.tsx",
        "components/inspection-sheet/sheet-container.tsx",
        "components/shared/data-table.tsx"
      ]
    },
    "src/app": {
      "description": "Routage Next.js (App Router) et layouts",
      "files": [
        "layout.tsx",
        "(agency)/dashboard/page.tsx",
        "(agency)/projects/page.tsx",
        "projects/[projectId]/layout.tsx",
        "projects/[projectId]/overview/page.tsx",
        "projects/[projectId]/issues/page.tsx",
        "projects/[projectId]/subpages/page.tsx",
        "projects/[projectId]/editorial/page.tsx",
        "projects/[projectId]/geo/page.tsx",
        "api/audits/route.ts",
        "api/projects/[projectId]/ai-analysis/route.ts"
      ]
    }
  }
}