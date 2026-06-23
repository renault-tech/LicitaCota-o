import { NextResponse } from 'next/server';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export async function GET() {
  try {
    const res = await fetch(`${API_URL}/api/health`, {
      signal: AbortSignal.timeout(10_000),
    });
    const data = await res.json() as Record<string, unknown>;
    return NextResponse.json({ ok: true, api: data, ts: new Date().toISOString() });
  } catch (e) {
    return NextResponse.json({ ok: false, erro: String(e) }, { status: 503 });
  }
}
