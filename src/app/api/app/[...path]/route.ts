import { handle } from "@/lib/api/router";

// Sync now runs a slice of work inside the request, so give it room.
export const maxDuration = 60;

type Ctx = { params: Promise<{ path: string[] }> };

export async function GET(request: Request, ctx: Ctx) {
  return handle(request, (await ctx.params).path);
}

export async function POST(request: Request, ctx: Ctx) {
  return handle(request, (await ctx.params).path);
}

export async function PUT(request: Request, ctx: Ctx) {
  return handle(request, (await ctx.params).path);
}

export async function DELETE(request: Request, ctx: Ctx) {
  return handle(request, (await ctx.params).path);
}
