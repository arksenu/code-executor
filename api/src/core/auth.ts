import Boom from '@hapi/boom';
import type { Request, Response, NextFunction } from 'express';

export interface AuthConfig {
  tokens: Record<string, { label: string; rateLimitRps: number; burst: number }>;
}

export class Authenticator {
  constructor(private readonly config: AuthConfig) {}

  public middleware() {
    return (req: Request, _res: Response, next: NextFunction) => {
      const header = req.headers['authorization'];
      if (!header?.startsWith('Bearer ')) {
        return next(Boom.unauthorized('missing bearer token'));
      }
      const token = header.slice('Bearer '.length).trim();
      const entry = this.config.tokens[token];
      if (!entry) {
        return next(Boom.unauthorized('invalid token'));
      }
      (req as Request & { apiKey?: string }).apiKey = token;
      return next();
    };
  }
}
