import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcrypt';
import { createUser, findUserByEmail, findUserById } from '../db/users';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../utils/jwt';

export const authRouter = Router();

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

authRouter.post('/signup', async (req, res) => {
  const parsed = credentialsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const { email, password } = parsed.data;

  const existing = await findUserByEmail(email);
  if (existing) {
    return res.status(409).json({ error: 'Email already registered' });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await createUser(email, passwordHash);

  const accessToken = signAccessToken(user.id);
  const refreshToken = signRefreshToken(user.id);

  res.status(201).json({
    user: { id: user.id, email: user.email, createdAt: user.createdAt },
    accessToken,
    refreshToken,
  });
});

authRouter.post('/login', async (req, res) => {
  const parsed = credentialsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const { email, password } = parsed.data;

  const user = await findUserByEmail(email);
  if (!user) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const accessToken = signAccessToken(user.id);
  const refreshToken = signRefreshToken(user.id);

  res.json({
    user: { id: user.id, email: user.email, createdAt: user.createdAt },
    accessToken,
    refreshToken,
  });
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

authRouter.post('/refresh', async (req, res) => {
  const parsed = refreshSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  try {
    const payload = verifyRefreshToken(parsed.data.refreshToken);
    const user = await findUserById(payload.sub);
    if (!user) {
      return res.status(401).json({ error: 'User no longer exists' });
    }
    const accessToken = signAccessToken(user.id);
    const refreshToken = signRefreshToken(user.id);
    res.json({ accessToken, refreshToken });
  } catch {
    return res.status(401).json({ error: 'Invalid or expired refresh token' });
  }
});
