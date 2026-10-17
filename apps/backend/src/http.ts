import type { Context } from "hono";
import { z } from "zod";

/** 想定内のエラー。app.onError が { detail } 付きで返す */
export class HttpError extends Error {
  constructor(
    readonly status: 400 | 404,
    message: string,
  ) {
    super(message);
  }
}

/** JSON の body を zod で検査する。形が違えば 400 */
export async function readBody<T extends z.ZodType>(
  c: Context,
  schema: T,
): Promise<z.infer<T>> {
  const parsed = schema.safeParse(await c.req.json().catch(() => undefined));
  if (!parsed.success) {
    throw new HttpError(
      400,
      `入力が正しくありません: ${z.prettifyError(parsed.error).slice(0, 200)}`,
    );
  }
  return parsed.data;
}
