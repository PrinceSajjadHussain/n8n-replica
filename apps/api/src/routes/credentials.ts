import { Router } from 'express';
import { z } from 'zod';
import type { AuthedRequest } from '../middleware/auth';
import { requireAuth } from '../middleware/auth';
import { createCredential, listCredentials, deleteCredential } from '../db/credentials';

export const credentialsRouter = Router();
credentialsRouter.use(requireAuth);

const createSchema = z.object({
  type: z.string().min(1),
  data: z.record(z.unknown()),
});

credentialsRouter.get('/', async (req: AuthedRequest, res) => {
  const credentials = await listCredentials(req.userId!);
  res.json({ credentials }); // never includes encryptedData or decrypted secrets
});

credentialsRouter.post('/', async (req: AuthedRequest, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const credential = await createCredential(req.userId!, parsed.data.type, parsed.data.data);
  res.status(201).json({ credential });
});

credentialsRouter.delete('/:id', async (req: AuthedRequest, res) => {
  const deleted = await deleteCredential(req.params.id, req.userId!);
  if (!deleted) return res.status(404).json({ error: 'Credential not found' });
  res.status(204).send();
});
