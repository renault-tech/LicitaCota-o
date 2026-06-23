import { NextResponse } from 'next/server';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export async function GET() {
  try {
    const res = await fetch(`${API_URL}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(10_000),
    });
    return NextResponse.json({ ok: res.ok, status: res.status, ts: new Date().toISOString() });
  } catch {
    return NextResponse.json({ ok: false, ts: new Date().toISOString() }, { status: 200 });
  }
}
