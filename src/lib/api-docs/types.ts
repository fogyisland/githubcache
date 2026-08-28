import type { z } from 'zod';

export interface ParamDoc {
  name: string;
  in: 'path' | 'query' | 'header' | 'body';
  type: string;
  required: boolean;
  description: string;
}

export interface HeaderDoc {
  name: string;
  description: string;
  example: string;
}

export interface ErrorDoc {
  status: number;
  error: string;
  when: string;
}

export interface EndpointDoc {
  slug: string;
  path: string;
  method: 'GET' | 'POST';
  summary: string;
  description: string;
  auth: 'none' | 'X-API-Key';
  rateLimit: string;
  request?: ParamDoc[];
  response: z.ZodTypeAny;
  responseSamples: Record<string, unknown>;
  headers?: HeaderDoc[];
  errors: ErrorDoc[];
}
