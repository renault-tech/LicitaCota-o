import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { NaoAutorizadoError, ProibidoError } from '../utils/errors.js';
import type { Role } from '@licitapreco/shared';

export interface JwtPayload {
  sub: string;
  role: Role;
  tipo: 'access';
}

declare global {
  namespace Express {
    interface Request {
      usuario: { id: string; role: Role };
    }
  }
}

export function autenticar(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    next(new NaoAutorizadoError());
    return;
  }
  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as JwtPayload;
    if (payload.tipo !== 'access') {
      next(new NaoAutorizadoError());
      return;
    }
    req.usuario = { id: payload.sub, role: payload.role };
    next();
  } catch {
    next(new NaoAutorizadoError());
  }
}

export function exigirRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.usuario || !roles.includes(req.usuario.role)) {
      next(new ProibidoError());
      return;
    }
    next();
  };
}
