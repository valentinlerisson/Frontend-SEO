import { NextRequest, NextResponse } from 'next/server';
import { GeoShapes, type ShapeKind } from '@/adapters/secondary/geo/geo-shapes';

const KINDS: ShapeKind[] = ['commune', 'departement', 'region'];

/** Contour allégé d'une zone (IGN), pour la carte de l'onglet Positionnement. Pays et autres lieux : pas de contour */
export async function GET(req: NextRequest) {
  const kind = req.nextUrl.searchParams.get('kind') as ShapeKind | null;
  const code = req.nextUrl.searchParams.get('code') ?? '';
  if (!kind || !KINDS.includes(kind)) return NextResponse.json({ error: 'Type de zone sans contour' }, { status: 400 });
  const geometry = await GeoShapes.contour(kind, code);
  if (!geometry) return NextResponse.json({ error: 'Contour introuvable' }, { status: 404 });
  return NextResponse.json({ geometry }, { headers: { 'Cache-Control': 'public, max-age=86400' } });
}
