import jwt from 'jsonwebtoken';

export interface AccessTokenPayload {
  sub: string; // userId
  type: 'access';
}
export interface RefreshTokenPayload {
  sub: string;
  type: 'refresh';
}

export function signAccessToken(userId: string): string {
  const secret = process.env.JWT_ACCESS_SECRET!;
  return jwt.sign({ sub: userId, type: 'access' } satisfies AccessTokenPayload, secret, {
    expiresIn: (process.env.JWT_ACCESS_EXPIRES_IN ?? '15m') as jwt.SignOptions['expiresIn'],
  });
}

export function signRefreshToken(userId: string): string {
  const secret = process.env.JWT_REFRESH_SECRET!;
  return jwt.sign({ sub: userId, type: 'refresh' } satisfies RefreshTokenPayload, secret, {
    expiresIn: (process.env.JWT_REFRESH_EXPIRES_IN ?? '7d') as jwt.SignOptions['expiresIn'],
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  const secret = process.env.JWT_ACCESS_SECRET!;
  const payload = jwt.verify(token, secret) as AccessTokenPayload;
  if (payload.type !== 'access') throw new Error('Invalid token type');
  return payload;
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  const secret = process.env.JWT_REFRESH_SECRET!;
  const payload = jwt.verify(token, secret) as RefreshTokenPayload;
  if (payload.type !== 'refresh') throw new Error('Invalid token type');
  return payload;
}
