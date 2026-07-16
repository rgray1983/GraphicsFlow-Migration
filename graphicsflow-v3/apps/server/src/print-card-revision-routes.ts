import type { FastifyInstance } from 'fastify';
import { getPrintCardRevisionDetail, regeneratePrintCardRevision, updatePrintCardRevision, type PrintCardRevisionUpdate } from './print-card-revision-service.js';

const validId = (value: unknown): number | null => { const id = Number(value); return Number.isInteger(id) && id > 0 ? id : null; };

function parseUpdate(body: unknown): PrintCardRevisionUpdate | null {
  if (!body || typeof body !== 'object') return null;
  const value = body as Record<string, unknown>;
  const text = (key: string) => String(value[key] ?? '').trim();
  const parsed: PrintCardRevisionUpdate = {
    revisionLabel: text('revisionLabel'), revisionDate: text('revisionDate'), description: text('description'),
    specificationNumber: text('specificationNumber'), designNumber: text('designNumber'), csr: text('csr'), designer: text('designer'),
    artworkName: text('artworkName'), artworkRelativePath: text('artworkRelativePath'), artworkPdfBase64: text('artworkPdfBase64'),
  };
  if (!parsed.revisionLabel || !parsed.revisionDate || !parsed.description || !parsed.specificationNumber || !parsed.csr || !parsed.designer) return null;
  if (parsed.revisionLabel.length > 20 || parsed.description.length > 240 || parsed.artworkPdfBase64!.length > 40_000_000) return null;
  return parsed;
}

export function registerPrintCardRevisionRoutes(app: FastifyInstance): void {
  app.get('/api/graphics/:id/print-card/revisions/:revisionId', async (request, reply) => {
    const params = request.params as { id?: string; revisionId?: string }; const id = validId(params.id); const revisionId = validId(params.revisionId);
    if (!id || !revisionId) return reply.status(400).send({ error: 'Invalid Print Card revision request.' });
    const revision = getPrintCardRevisionDetail(id, revisionId);
    return revision ? { revision } : reply.status(404).send({ error: 'Print Card revision not found.' });
  });

  app.patch('/api/graphics/:id/print-card/revisions/:revisionId', async (request, reply) => {
    const params = request.params as { id?: string; revisionId?: string }; const id = validId(params.id); const revisionId = validId(params.revisionId);
    if (!id || !revisionId) return reply.status(400).send({ error: 'Invalid Print Card revision request.' });
    const parsed = parseUpdate(request.body);
    if (!parsed) return reply.status(400).send({ error: 'Complete the required Print Card revision information.' });
    try { return { revision: await updatePrintCardRevision(id, revisionId, parsed) }; }
    catch (error) { const message = error instanceof Error ? error.message : 'The Print Card revision could not be updated.'; request.log.error({ error, graphicId: id, revisionId }, 'Could not update Print Card revision'); return reply.status(/already exists|not found/i.test(message) ? 409 : 500).send({ error: message }); }
  });

  app.get('/api/graphics/:id/print-card/revisions/:revisionId.jpg', async (request, reply) => {
    const params = request.params as { id?: string; revisionId?: string }; const id = validId(params.id); const revisionId = validId(params.revisionId);
    if (!id || !revisionId) return reply.status(400).send({ error: 'Invalid Print Card revision request.' });
    try { const image = await regeneratePrintCardRevision(id, revisionId); return reply.header('Content-Type', 'image/jpeg').header('Content-Disposition', `inline; filename="${image.fileName.replace(/"/g, '')}"`).header('Cache-Control', 'private, no-store').send(image.data); }
    catch (error) { const message = error instanceof Error ? error.message : 'The Print Card could not be regenerated.'; request.log.error({ error, graphicId: id, revisionId }, 'Could not regenerate Print Card revision'); return reply.status(/not found|does not have|select|artwork/i.test(message) ? 409 : 500).send({ error: message }); }
  });
}
