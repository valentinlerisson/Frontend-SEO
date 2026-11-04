import { NextRequest, NextResponse } from 'next/server';
import { AuditService } from '@/core/services/audit-service';
import { SiteCrawler } from '@/adapters/secondary/crawler/site-crawler';

/**
 * Sitemaps d'un site et leur nombre de pages, lus avant le lancement d'un audit pour choisir le périmètre.
 * Rien n'est enregistré ni exploré.
 */
export async function GET(req: NextRequest) {
  const input = req.nextUrl.searchParams.get('domain');
  if (!input) return NextResponse.json({ error: 'Adresse du site requise' }, { status: 400 });
  try {
    const { url } = AuditService.normalizeDomain(input);
    const meta = await SiteCrawler.analyzeDomainMetadata(url);
    const sitemaps = await SiteCrawler.listSitemaps(new URL(url).origin, meta.robots?.sitemaps ?? []);
    return NextResponse.json({ sitemaps });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Lecture impossible' }, { status: 500 });
  }
}
