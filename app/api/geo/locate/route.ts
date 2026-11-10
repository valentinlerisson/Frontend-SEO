import { NextRequest, NextResponse } from 'next/server';
import { GeoShapes } from '@/adapters/secondary/geo/geo-shapes';

/** Centre de la commune d'une adresse (code postal et ville), pour placer le siège sur la carte */
export async function GET(req: NextRequest) {
  const postalCode = req.nextUrl.searchParams.get('postalCode') ?? '';
  const city = (req.nextUrl.searchParams.get('city') ?? '').slice(0, 80);
  const point = await GeoShapes.locate(postalCode, city);
  if (!point) return NextResponse.json({ error: 'Commune introuvable' }, { status: 404 });
  return NextResponse.json(point, { headers: { 'Cache-Control': 'public, max-age=86400' } });
}
