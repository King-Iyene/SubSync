import { handle } from "@/lib/api/router";

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
