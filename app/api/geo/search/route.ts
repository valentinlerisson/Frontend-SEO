import { NextRequest, NextResponse } from 'next/server';
import { GeoApi } from '@/adapters/secondary/geo/geo-api';

/** Zones proposées pour une saisie (ville, code postal, département, région), via l'API Géo officielle */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q') ?? '';
  if (q.trim().length < 2) return NextResponse.json({ zones: [] });
  return NextResponse.json({ zones: await GeoApi.search(q.slice(0, 80)) });
}
