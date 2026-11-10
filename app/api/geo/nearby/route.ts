import { NextRequest, NextResponse } from 'next/server';
import { GeoShapes } from '@/adapters/secondary/geo/geo-shapes';
import { clampRadius, communesInRadius } from '@/core/domain/geo-radius';

/** Communes dans un rayon autour d'un point (les plus peuplées d'abord), pour la carte de l'onglet Positionnement */
export async function GET(req: NextRequest) {
  const latitude = Number(req.nextUrl.searchParams.get('lat'));
  const longitude = Number(req.nextUrl.searchParams.get('lon'));
  const radius = clampRadius(Number(req.nextUrl.searchParams.get('radius')));
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    return NextResponse.json({ error: 'Coordonnées invalides' }, { status: 400 });
  }
  try {
    const result = communesInRadius(await GeoShapes.communes(), { latitude, longitude }, radius);
    return NextResponse.json({ radius, ...result });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Liste des communes indisponible' }, { status: 503 });
  }
}
