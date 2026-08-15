import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({
    ok: true,
    db: 'up',
    tokens: { active: 0, exhausted: 0 },
  });
}
